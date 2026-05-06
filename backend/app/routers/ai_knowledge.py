"""
CRUD для базы знаний AI (FAQ).

Роли:
* super_admin — видит/правит ВСЕ записи (свои платформенные + любые тенантские).
  При создании может оставить tenant_id = null (платформенная FAQ),
  либо явно указать конкретный tenant_id.
* franchise_owner / supervisor / manager — работают со своими записями.
  Создают записи в собственный tenant_id (берётся из user.tenant_id);
  видят свои + платформенные.

Эндпоинты:
* GET    /ai/knowledge            — список (фильтры q, tenant_id, is_active)
* POST   /ai/knowledge            — создать запись
* PATCH  /ai/knowledge/{id}       — частичное обновление
* DELETE /ai/knowledge/{id}       — удалить
* GET    /ai/knowledge/stats      — топ по hits (аналитика экономии токенов)
* POST   /ai/knowledge/import     — массовый импорт CSV/JSON

TODO: подключить require_feature('ai_assistant') когда модуль будет добавлен.
"""
from __future__ import annotations

import csv
import io
import json
import logging
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Body
from pydantic import BaseModel, Field
from sqlalchemy import select, or_, desc, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import get_current_user
from app.models.user import User, UserRole
from app.models.ai_knowledge import AIKnowledgeEntry


logger = logging.getLogger("ai_knowledge_router")

router = APIRouter(prefix="/ai/knowledge", tags=["ai-knowledge"])


# ── Pydantic-схемы ──────────────────────────────────────────────────────────

class KnowledgeOut(BaseModel):
    id: uuid.UUID
    tenant_id: Optional[uuid.UUID]
    franchise_owner_id: Optional[uuid.UUID]
    question: str
    answer: str
    keywords: Optional[str]
    priority: int
    hits: int
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class KnowledgeCreate(BaseModel):
    question: str = Field(..., min_length=2, max_length=500)
    answer: str = Field(..., min_length=2)
    keywords: Optional[str] = None
    priority: int = Field(5, ge=1, le=10)
    is_active: bool = True
    tenant_id: Optional[uuid.UUID] = None  # уважается только super_admin


class KnowledgePatch(BaseModel):
    question: Optional[str] = Field(None, min_length=2, max_length=500)
    answer: Optional[str] = Field(None, min_length=2)
    keywords: Optional[str] = None
    priority: Optional[int] = Field(None, ge=1, le=10)
    is_active: Optional[bool] = None


class ImportItem(BaseModel):
    question: str
    answer: str
    keywords: Optional[str] = None
    priority: int = 5


# ── Хелперы доступа ─────────────────────────────────────────────────────────

def _is_super_admin(user: User) -> bool:
    """super_admin — платформенный уровень (роль или системный username)."""
    try:
        from app.config import settings
        if user.username and user.username == settings.superadmin_username:
            return True
    except Exception:
        pass
    return user.role == UserRole.SUPER_ADMIN


def _can_manage(user: User) -> bool:
    """Кто может создавать/редактировать FAQ (роли с админскими правами)."""
    if _is_super_admin(user):
        return True
    return user.role in (
        UserRole.FRANCHISE_OWNER,
        UserRole.MANAGER,
    )


def _entry_belongs_to_user(entry: AIKnowledgeEntry, user: User) -> bool:
    """Проверка, что пользователь имеет право работать с записью."""
    if _is_super_admin(user):
        return True
    # Тенантский менеджер/владелец видит только свой тенант.
    if entry.tenant_id is None:
        # Платформенная запись — править могут только super_admin.
        return False
    return entry.tenant_id == user.tenant_id


# ── GET /ai/knowledge ──────────────────────────────────────────────────────

@router.get("", response_model=list[KnowledgeOut])
async def list_entries(
    q: Optional[str] = Query(None, description="Поиск по question/keywords (ILIKE)"),
    tenant_id: Optional[uuid.UUID] = Query(None, description="Фильтр по тенанту (super_admin)"),
    is_active: Optional[bool] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Список записей FAQ с учётом ролей."""
    if not _can_manage(user):
        raise HTTPException(403, "forbidden")

    stmt = select(AIKnowledgeEntry)

    # Видимость по роли:
    if _is_super_admin(user):
        if tenant_id is not None:
            stmt = stmt.where(AIKnowledgeEntry.tenant_id == tenant_id)
        # без фильтра — видит всё
    else:
        # franchise_owner / manager / supervisor — свой тенант + платформенные
        if not user.tenant_id:
            # Без тенанта (странный кейс) — только платформенные
            stmt = stmt.where(AIKnowledgeEntry.tenant_id.is_(None))
        else:
            stmt = stmt.where(or_(
                AIKnowledgeEntry.tenant_id == user.tenant_id,
                AIKnowledgeEntry.tenant_id.is_(None),
            ))

    if is_active is not None:
        stmt = stmt.where(AIKnowledgeEntry.is_active.is_(is_active))

    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(
            func.lower(AIKnowledgeEntry.question).like(like),
            func.lower(AIKnowledgeEntry.keywords).like(like),
        ))

    stmt = stmt.order_by(
        desc(AIKnowledgeEntry.priority),
        desc(AIKnowledgeEntry.updated_at),
    ).limit(limit).offset(offset)

    rows = (await db.execute(stmt)).scalars().all()
    return rows


# ── POST /ai/knowledge ──────────────────────────────────────────────────────

@router.post("", response_model=KnowledgeOut, status_code=201)
async def create_entry(
    body: KnowledgeCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Создать запись. tenant_id определяется ролью."""
    if not _can_manage(user):
        raise HTTPException(403, "forbidden")

    # Определяем target tenant_id
    if _is_super_admin(user):
        # super_admin сам решает — может создать платформенную (tenant_id=None)
        # или назначить конкретному тенанту.
        target_tenant_id = body.tenant_id
        franchise_owner_id = None
    else:
        if not user.tenant_id:
            raise HTTPException(400, "у пользователя нет tenant_id")
        target_tenant_id = user.tenant_id
        franchise_owner_id = (
            user.id if user.role == UserRole.FRANCHISE_OWNER else None
        )

    entry = AIKnowledgeEntry(
        id=uuid.uuid4(),
        tenant_id=target_tenant_id,
        franchise_owner_id=franchise_owner_id,
        question=body.question.strip(),
        answer=body.answer.strip(),
        keywords=(body.keywords or "").strip() or None,
        priority=body.priority,
        is_active=body.is_active,
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return entry


# ── PATCH /ai/knowledge/{id} ────────────────────────────────────────────────

@router.patch("/{entry_id}", response_model=KnowledgeOut)
async def patch_entry(
    entry_id: uuid.UUID,
    body: KnowledgePatch,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Частичное обновление записи."""
    if not _can_manage(user):
        raise HTTPException(403, "forbidden")

    entry = await db.get(AIKnowledgeEntry, entry_id)
    if not entry:
        raise HTTPException(404, "not found")
    if not _entry_belongs_to_user(entry, user):
        raise HTTPException(403, "forbidden (other tenant)")

    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        if k == "keywords":
            v = (v or "").strip() or None
        elif k in ("question", "answer") and isinstance(v, str):
            v = v.strip()
        setattr(entry, k, v)

    entry.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(entry)
    return entry


# ── DELETE /ai/knowledge/{id} ───────────────────────────────────────────────

@router.delete("/{entry_id}", status_code=204)
async def delete_entry(
    entry_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not _can_manage(user):
        raise HTTPException(403, "forbidden")

    entry = await db.get(AIKnowledgeEntry, entry_id)
    if not entry:
        raise HTTPException(404, "not found")
    if not _entry_belongs_to_user(entry, user):
        raise HTTPException(403, "forbidden (other tenant)")

    await db.delete(entry)
    await db.commit()


# ── GET /ai/knowledge/stats ─────────────────────────────────────────────────

@router.get("/stats")
async def get_stats(
    limit: int = Query(20, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Топ-N записей по количеству использований (hits desc).

    Помогает понять, насколько FAQ помогает экономить токены LLM
    и какие вопросы стоит расширить.
    """
    if not _can_manage(user):
        raise HTTPException(403, "forbidden")

    stmt = select(AIKnowledgeEntry)
    if not _is_super_admin(user):
        if user.tenant_id:
            stmt = stmt.where(or_(
                AIKnowledgeEntry.tenant_id == user.tenant_id,
                AIKnowledgeEntry.tenant_id.is_(None),
            ))
        else:
            stmt = stmt.where(AIKnowledgeEntry.tenant_id.is_(None))

    stmt = stmt.order_by(desc(AIKnowledgeEntry.hits)).limit(limit)
    rows = (await db.execute(stmt)).scalars().all()

    total_hits = sum(int(r.hits or 0) for r in rows)
    return {
        "top": [
            {
                "id": str(r.id),
                "question": r.question,
                "hits": int(r.hits or 0),
                "priority": r.priority,
                "tenant_id": str(r.tenant_id) if r.tenant_id else None,
            }
            for r in rows
        ],
        "total_hits": total_hits,
        # Грубая оценка экономии: средний LLM-ответ ≈ 300 токенов вход + 200 выход.
        # Считаем только выходные токены — они дороже.
        "estimated_tokens_saved": total_hits * 200,
    }


# ── POST /ai/knowledge/import ───────────────────────────────────────────────

@router.post("/import")
async def import_entries(
    items: Optional[list[ImportItem]] = Body(None),
    file: Optional[UploadFile] = File(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Массовый импорт записей.

    Принимает либо JSON-массив (`items`), либо файл CSV/JSON через `file`.
    CSV-формат: question,answer,keywords,priority (UTF-8, разделитель — запятая).
    """
    if not _can_manage(user):
        raise HTTPException(403, "forbidden")

    parsed: list[ImportItem] = []

    if items:
        parsed.extend(items)

    if file is not None:
        raw = await file.read()
        try:
            text_data = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            try:
                text_data = raw.decode("cp1251")
            except Exception:
                raise HTTPException(400, "не удалось декодировать файл (UTF-8 / CP1251)")

        fname = (file.filename or "").lower()
        if fname.endswith(".json"):
            try:
                data = json.loads(text_data)
            except Exception as e:
                raise HTTPException(400, f"JSON parse error: {e}")
            if not isinstance(data, list):
                raise HTTPException(400, "JSON должен быть массивом объектов")
            for row in data:
                if not isinstance(row, dict):
                    continue
                try:
                    parsed.append(ImportItem(**row))
                except Exception:
                    continue
        else:
            # CSV (default)
            reader = csv.DictReader(io.StringIO(text_data))
            for row in reader:
                # Поддерживаем варианты ключей с пробелами/регистром
                norm = {(k or "").strip().lower(): (v or "").strip() for k, v in row.items()}
                q = norm.get("question") or norm.get("вопрос")
                a = norm.get("answer") or norm.get("ответ")
                if not q or not a:
                    continue
                try:
                    pr = int(norm.get("priority") or norm.get("приоритет") or 5)
                except Exception:
                    pr = 5
                parsed.append(ImportItem(
                    question=q,
                    answer=a,
                    keywords=norm.get("keywords") or norm.get("ключи") or None,
                    priority=pr,
                ))

    if not parsed:
        raise HTTPException(400, "пустой импорт (ни items, ни файл не дали записей)")

    if _is_super_admin(user):
        # Импорт супер-админа — платформенные записи (tenant_id=None) если в payload
        # явный tenant_id не передан. Тут принципиально не лезем в payload —
        # если super_admin хочет залить в конкретный тенант, использует UI с фильтром.
        target_tenant_id = None
        franchise_owner_id = None
    else:
        if not user.tenant_id:
            raise HTTPException(400, "у пользователя нет tenant_id")
        target_tenant_id = user.tenant_id
        franchise_owner_id = (
            user.id if user.role == UserRole.FRANCHISE_OWNER else None
        )

    created = 0
    for item in parsed:
        try:
            entry = AIKnowledgeEntry(
                id=uuid.uuid4(),
                tenant_id=target_tenant_id,
                franchise_owner_id=franchise_owner_id,
                question=item.question.strip(),
                answer=item.answer.strip(),
                keywords=(item.keywords or "").strip() or None,
                priority=max(1, min(10, int(item.priority or 5))),
                is_active=True,
            )
            db.add(entry)
            created += 1
        except Exception as e:
            logger.warning(f"ai_knowledge import: skip row: {e}")

    await db.commit()
    return {"imported": created, "received": len(parsed)}
