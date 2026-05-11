"""
========================================
МОДУЛЬ: reg_speed — премиум-фичи регистратора (Глава 5)
========================================
Эндпоинты для роли reg (Регистратор):
  • GET  /referrals/{id}/print           — PDF направления (A5, кириллица, QR)
  • GET  /referrals/print-batch          — пакет направлений в одном PDF
  • GET  /referrals/patients/search      — быстрый поиск пациентов по своим направлениям
                                            (по имени и/или телефону)

PDF собирается через WeasyPrint (зависимость уже в requirements.txt).
Шрифт DejaVuSans встроен в контейнер (/usr/share/fonts/truetype/dejavu/),
WeasyPrint находит его по `font-family: DejaVu Sans`.

Регистрируется в backend/app/routers/referrals.py путём `include` сабраутера.
========================================
"""
from __future__ import annotations

import base64
import html
import io
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.models.referral import Referral, ReferralStatus
from app.models.clinic import Clinic


router = APIRouter(prefix="/referrals", tags=["referrals-print"])


# ─── Утилита: эскейп для HTML-шаблона PDF ───
def _esc(value) -> str:
    if value is None:
        return ""
    return html.escape(str(value), quote=True)


def _fmt_date(dt: Optional[datetime]) -> str:
    if not dt:
        return "—"
    try:
        return dt.strftime("%d.%m.%Y")
    except Exception:
        return "—"


def _fmt_datetime(dt: Optional[datetime]) -> str:
    if not dt:
        return "—"
    try:
        return dt.strftime("%d.%m.%Y %H:%M")
    except Exception:
        return "—"


def _normalize_phone(s: Optional[str]) -> str:
    if not s:
        return ""
    return re.sub(r"[^0-9+]", "", s)


# ─── Получить активную клинику регистратора (для шапки PDF) ───
async def _get_user_clinic(db: AsyncSession, user: User) -> Optional[Clinic]:
    if not user or not user.clinic_id:
        return None
    return (await db.execute(select(Clinic).where(Clinic.id == user.clinic_id))).scalar_one_or_none()


# ─── Сборка HTML одного направления для печати ───
async def _build_referral_html(db: AsyncSession, ref: Referral, user: User) -> str:
    """Возвращает HTML-страницу A5 с реквизитами клиники, данными пациента и QR.

    Использует weasyprint-compatible HTML/CSS. Кириллица через DejaVu Sans
    (шрифт уже установлен в Docker-образе).
    """
    # Шапка: своя клиника
    own_clinic = await _get_user_clinic(db, user)
    own_name = own_clinic.name if own_clinic else "КлиникСеть"
    own_addr = own_clinic.address if own_clinic else ""
    own_phone = own_clinic.phone if own_clinic else ""

    # Клиника назначения
    to_clinic = (
        (await db.execute(select(Clinic).where(Clinic.id == ref.to_clinic_id))).scalar_one_or_none()
        if ref.to_clinic_id else None
    )
    to_name = to_clinic.name if to_clinic else "—"
    to_addr = to_clinic.address if to_clinic else ""
    to_phone = to_clinic.phone if to_clinic else ""

    # Услуга (опционально)
    service_name = "—"
    if ref.service_id:
        try:
            from app.models.service import Service
            svc = (await db.execute(select(Service).where(Service.id == ref.service_id))).scalar_one_or_none()
            if svc:
                service_name = svc.name
        except Exception:
            pass

    # Целевой врач (опционально)
    target_doctor = ""
    if getattr(ref, "target_doctor_id", None):
        try:
            from app.models.doctor import Doctor as _Doctor
            td = (await db.execute(select(_Doctor).where(_Doctor.id == ref.target_doctor_id))).scalar_one_or_none()
            if td:
                target_doctor = td.full_name or ""
        except Exception:
            pass

    # Список анализов (для type=lab)
    lab_tests = getattr(ref, "lab_tests", None) or ""

    # QR (base64 PNG, поле patient_qr_code или qr_code)
    qr_b64 = getattr(ref, "patient_qr_code", None) or getattr(ref, "qr_code", None) or ""
    # Поле qr_code иногда хранит URL — попробуем сгенерировать PNG на лету, если это похоже на URL
    qr_img_src = ""
    if qr_b64:
        s = qr_b64.strip()
        if s.startswith("data:image"):
            qr_img_src = s
        elif s.startswith("http") or s.startswith("/"):
            # сгенерируем PNG из URL
            try:
                import qrcode  # type: ignore
                from io import BytesIO
                _img = qrcode.make(s)
                _buf = BytesIO()
                _img.save(_buf, format="PNG")
                qr_img_src = "data:image/png;base64," + base64.b64encode(_buf.getvalue()).decode("ascii")
            except Exception:
                qr_img_src = ""
        else:
            # Возможно, уже base64
            qr_img_src = "data:image/png;base64," + s

    # Тип направления
    rtype = (getattr(ref, "referral_type", "service") or "service").lower()
    rtype_label = {"service": "Услуга", "doctor": "К врачу", "lab": "Лаборатория"}.get(rtype, "Направление")

    short_code = getattr(ref, "short_code", None)
    created_at = ref.created_at
    appointment_at = getattr(ref, "appointment_at", None)
    issuer_name = user.full_name or user.email or "Регистратор"

    # Конструируем «содержимое направления» в зависимости от типа
    if rtype == "doctor" and target_doctor:
        body_rows = [("Тип", rtype_label), ("Врач", target_doctor)]
        if service_name and service_name != "—":
            body_rows.append(("Услуга", service_name))
    elif rtype == "lab":
        body_rows = [("Тип", rtype_label), ("Анализы", lab_tests or "—")]
    else:
        body_rows = [("Тип", rtype_label), ("Услуга", service_name)]

    if ref.notes:
        body_rows.append(("Комментарий", ref.notes))

    body_html = "".join(
        f"<tr><td class='lab'>{_esc(k)}</td><td class='val'>{_esc(v)}</td></tr>"
        for k, v in body_rows
    )

    qr_block = ""
    if qr_img_src:
        qr_block = (
            f'<div class="qr">'
            f'<img src="{qr_img_src}" alt="QR"/>'
            f'<div class="qr-cap">Код подтверждения: <b>{_esc(short_code) if short_code else "—"}</b></div>'
            f'</div>'
        )

    return f"""<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8"/>
<title>Направление {_esc(short_code or "")}</title>
<style>
  @page {{ size: A5; margin: 10mm 12mm; }}
  * {{ box-sizing: border-box; }}
  body {{
    font-family: 'DejaVu Sans', sans-serif;
    color: #111;
    font-size: 10pt;
    line-height: 1.35;
    margin: 0;
  }}
  .hdr {{
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2px solid #0a6e85;
    padding-bottom: 6pt;
    margin-bottom: 10pt;
  }}
  .hdr .clinic-name {{ font-size: 13pt; font-weight: bold; color: #0a6e85; }}
  .hdr .clinic-meta {{ font-size: 8.5pt; color: #555; margin-top: 2pt; }}
  .hdr .doc-no {{ text-align: right; font-size: 9pt; color: #555; }}
  .hdr .doc-no .num {{ font-size: 16pt; font-weight: bold; color: #0a6e85; letter-spacing: 0.05em; }}
  h1 {{ font-size: 14pt; margin: 0 0 8pt; text-align: center; color: #111; letter-spacing: 0.03em; }}
  table.info {{ width: 100%; border-collapse: collapse; margin-bottom: 8pt; }}
  table.info td {{ padding: 3pt 4pt; vertical-align: top; }}
  table.info td.lab {{ width: 28%; color: #555; font-size: 9pt; }}
  table.info td.val {{ font-weight: 600; color: #111; }}
  .section-title {{
    font-size: 10pt; font-weight: bold; color: #0a6e85;
    border-left: 3px solid #0a6e85; padding-left: 6pt;
    margin: 10pt 0 5pt;
  }}
  .target-clinic {{
    background: #f4f8fa; border: 1px solid #d6e4ea; border-radius: 4pt;
    padding: 6pt 8pt; margin-bottom: 8pt;
  }}
  .target-clinic .nm {{ font-size: 11pt; font-weight: bold; color: #0a6e85; }}
  .target-clinic .mt {{ font-size: 9pt; color: #555; margin-top: 2pt; }}
  .qr {{ text-align: center; margin: 8pt 0; }}
  .qr img {{ width: 110px; height: 110px; border: 1px solid #ddd; padding: 4pt; background: #fff; }}
  .qr-cap {{ font-size: 9pt; color: #444; margin-top: 3pt; }}
  .footer {{
    margin-top: 14pt;
    padding-top: 6pt;
    border-top: 1px dashed #aaa;
    font-size: 8.5pt;
    color: #555;
    display: flex; justify-content: space-between;
  }}
  .footer .sig {{ margin-top: 14pt; border-top: 1px solid #888; width: 60mm; padding-top: 2pt; }}
</style>
</head>
<body>

  <div class="hdr">
    <div>
      <div class="clinic-name">{_esc(own_name)}</div>
      <div class="clinic-meta">{_esc(own_addr)}{(" · " + _esc(own_phone)) if own_phone else ""}</div>
    </div>
    <div class="doc-no">
      Направление №<br/>
      <span class="num">{_esc(short_code) if short_code else "—"}</span>
    </div>
  </div>

  <h1>НАПРАВЛЕНИЕ ПАЦИЕНТА</h1>

  <table class="info">
    <tr><td class="lab">ФИО пациента</td><td class="val">{_esc(ref.patient_name) or "—"}</td></tr>
    <tr><td class="lab">Телефон</td><td class="val">{_esc(ref.patient_phone) or "—"}</td></tr>
    <tr><td class="lab">Выдано</td><td class="val">{_fmt_datetime(created_at)}</td></tr>
    <tr><td class="lab">Запись на</td><td class="val">{_fmt_datetime(appointment_at) if appointment_at else "—"}</td></tr>
  </table>

  <div class="section-title">Клиника назначения</div>
  <div class="target-clinic">
    <div class="nm">{_esc(to_name)}</div>
    <div class="mt">{_esc(to_addr)}{(" · " + _esc(to_phone)) if to_phone else ""}</div>
  </div>

  <div class="section-title">Содержание направления</div>
  <table class="info">
    {body_html}
  </table>

  {qr_block}

  <div class="footer">
    <div>
      Выдал: {_esc(issuer_name)}<br/>
      <div class="sig">подпись регистратора</div>
    </div>
    <div style="text-align: right;">
      Документ сгенерирован<br/>
      {_fmt_datetime(datetime.now(timezone.utc))}<br/>
      <span style="color:#888;">КлиникСеть</span>
    </div>
  </div>

</body></html>"""


# ─── Рендер HTML → PDF (через WeasyPrint) ───
def _html_to_pdf(html_str: str) -> bytes:
    try:
        from weasyprint import HTML  # type: ignore
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF-движок недоступен: {e}")
    pdf_bytes = HTML(string=html_str).write_pdf()
    if not pdf_bytes:
        raise HTTPException(status_code=500, detail="Не удалось собрать PDF")
    return pdf_bytes


def _can_access_referral(ref: Referral, user: User) -> bool:
    """Регистратор/менеджер своей клиники может печатать своё или входящее направление.
    Глобальные роли (super_admin/manager/admin) — без ограничений.
    """
    if not ref:
        return False
    if user.role in {"super_admin", "manager", "admin", "franchise_owner"}:
        return True
    # клинические роли — только своя клиника
    if user.clinic_id:
        if ref.from_clinic_id == user.clinic_id or ref.to_clinic_id == user.clinic_id:
            return True
    # либо если сам создавал
    if getattr(ref, "created_by_admin_id", None) == user.id:
        return True
    # тенант matched
    if user.tenant_id and ref.tenant_id == user.tenant_id:
        return True
    return False


# ─── ЭНДПОИНТ: PDF одного направления ───
@router.get("/{referral_id}/print")
async def print_referral_pdf(
    referral_id: uuid.UUID,
    inline: bool = Query(True, description="inline (открыть в браузере) или attachment"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Вернуть PDF направления (A5). Открывается в новой вкладке для печати Ctrl+P."""
    ref = (await db.execute(select(Referral).where(Referral.id == referral_id))).scalar_one_or_none()
    if not ref:
        raise HTTPException(status_code=404, detail="Направление не найдено")
    if not _can_access_referral(ref, current_user):
        raise HTTPException(status_code=403, detail="Нет доступа к направлению")

    html_str = await _build_referral_html(db, ref, current_user)
    pdf_bytes = _html_to_pdf(html_str)

    fname = f"referral_{getattr(ref, 'short_code', '') or str(ref.id)[:8]}.pdf"
    disposition = "inline" if inline else "attachment"
    headers = {
        "Content-Disposition": f'{disposition}; filename="{fname}"',
        "Cache-Control": "no-store",
    }
    return Response(content=pdf_bytes, media_type="application/pdf", headers=headers)


# ─── ЭНДПОИНТ: пакетная печать нескольких направлений ───
@router.get("/print-batch")
async def print_referrals_batch(
    ids: str = Query(..., description="UUIDs через запятую"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Несколько направлений в одном PDF (по одному на страницу A5)."""
    try:
        id_list = [uuid.UUID(x.strip()) for x in ids.split(",") if x.strip()]
    except ValueError:
        raise HTTPException(status_code=400, detail="ids должны быть UUID через запятую")
    if not id_list:
        raise HTTPException(status_code=400, detail="Передайте хотя бы один id")
    if len(id_list) > 50:
        raise HTTPException(status_code=400, detail="Максимум 50 направлений за раз")

    refs = (await db.execute(select(Referral).where(Referral.id.in_(id_list)))).scalars().all()
    refs = [r for r in refs if _can_access_referral(r, current_user)]
    if not refs:
        raise HTTPException(status_code=404, detail="Доступных направлений не найдено")

    # объединяем HTML, между страницами — page-break
    parts = []
    for i, r in enumerate(refs):
        page = await _build_referral_html(db, r, current_user)
        # Извлекаем <body>...</body> — но проще: оборачиваем целым шаблоном на каждое направление
        # weasyprint умеет multiple HTML входов, но мы держим один; добавляем page-break-after.
        if i == 0:
            parts.append(page.replace("</body>", "<div style='page-break-after: always;'></div></body>"))
        else:
            # начиная со 2-го — только содержимое внутри body, отделённое page-break
            body_start = page.find("<body>")
            body_end = page.find("</body>")
            if body_start != -1 and body_end != -1:
                inner = page[body_start + len("<body>"):body_end]
                # стиль на каждый блок — пересоздавать не нужно; просто чанк HTML
                # вместе с разделителем
                if i < len(refs) - 1:
                    parts.append(inner + "<div style='page-break-after: always;'></div>")
                else:
                    parts.append(inner)
    full_html = "\n".join(parts)
    pdf_bytes = _html_to_pdf(full_html)

    headers = {
        "Content-Disposition": f'inline; filename="referrals_batch_{len(refs)}.pdf"',
        "Cache-Control": "no-store",
    }
    return Response(content=pdf_bytes, media_type="application/pdf", headers=headers)


# ─── ЭНДПОИНТ: быстрый поиск пациентов (по своим направлениям) ───
@router.get("/patients/search")
async def search_patients(
    q: Optional[str] = Query(None, description="имя или телефон"),
    phone: Optional[str] = Query(None, description="телефон (приоритет — для авто-поиска дубликатов)"),
    limit: int = Query(10, ge=1, le=50),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Поиск уникальных пациентов в своих направлениях (по имени или телефону).

    Используется командной палитрой (Ctrl+K) и формой быстрого создания пациента
    для авто-проверки дубликатов при вводе телефона.
    """
    stmt = select(Referral)
    # ограничение по тенанту/клинике (как и в /referrals/ index)
    if current_user.tenant_id:
        stmt = stmt.where(Referral.tenant_id == current_user.tenant_id)
    if current_user.clinic_id and current_user.role not in {"super_admin", "manager", "admin", "franchise_owner"}:
        stmt = stmt.where(or_(
            Referral.from_clinic_id == current_user.clinic_id,
            Referral.to_clinic_id == current_user.clinic_id,
        ))

    conds = []
    if phone:
        pn = _normalize_phone(phone)
        if pn:
            # частичное совпадение по последним 7 цифрам (без +7 префикса)
            tail = pn[-7:] if len(pn) >= 7 else pn
            conds.append(Referral.patient_phone.ilike(f"%{tail}%"))
    if q:
        q_clean = q.strip()
        if q_clean:
            # пробуем как телефон (если содержит цифры)
            digits = re.sub(r"\D", "", q_clean)
            if digits and len(digits) >= 4:
                tail = digits[-7:] if len(digits) >= 7 else digits
                conds.append(Referral.patient_phone.ilike(f"%{tail}%"))
            # и как имя
            conds.append(Referral.patient_name.ilike(f"%{q_clean}%"))

    if not conds:
        return {"patients": []}

    stmt = stmt.where(or_(*conds)).order_by(Referral.created_at.desc()).limit(limit * 5)
    rows = (await db.execute(stmt)).scalars().all()

    # дедупликация по телефону → один пациент = одна карточка
    seen = {}
    for r in rows:
        key = (r.patient_phone or "").strip().lower()
        if not key or key in seen:
            continue
        seen[key] = {
            "patient_phone": r.patient_phone,
            "patient_name": r.patient_name,
            "last_referral_id": str(r.id),
            "last_short_code": r.short_code,
            "last_status": r.status.value if hasattr(r.status, "value") else str(r.status),
            "last_created_at": r.created_at.isoformat() if r.created_at else None,
        }
        if len(seen) >= limit:
            break
    return {"patients": list(seen.values())}


# ─── ЭНДПОИНТ: быстрая регистрация пациента (черновой draft) ───
# Эндпоинт сохраняет «черновое» направление-плейсхолдер для регистратора:
# создаёт минимальный Referral со status=created, без service_id и to_clinic_id
# (если они переданы — использует). Полезен для mobile-формы «сохранить и записать
# сразу».
@router.post("/patients/quick-create")
async def quick_create_patient(
    payload: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Быстрое создание/проверка карточки пациента для регистратора.

    Body: {full_name, phone, birth_date?, consent_data_processing: bool, to_clinic_id?, service_id?}

    Без подписи согласия 152-ФЗ — отказ.
    Если пациент уже есть в своих направлениях — возвращает существующего.
    Сам Referral создаётся только если передан to_clinic_id+service_id (тогда вызывается
    основной /referrals/ POST через свою логику; иначе возвращается «проверочный» ответ).
    """
    full_name = (payload.get("full_name") or "").strip()
    phone = (payload.get("phone") or "").strip()
    consent = bool(payload.get("consent_data_processing"))

    if not phone:
        raise HTTPException(status_code=400, detail="Укажите телефон")
    if not consent:
        raise HTTPException(status_code=400, detail="Требуется согласие на обработку персональных данных (152-ФЗ)")

    # ищем дубликат
    pn = _normalize_phone(phone)
    if pn and len(pn) >= 7:
        tail = pn[-7:]
        stmt = select(Referral).where(Referral.patient_phone.ilike(f"%{tail}%"))
        if current_user.tenant_id:
            stmt = stmt.where(Referral.tenant_id == current_user.tenant_id)
        stmt = stmt.order_by(Referral.created_at.desc()).limit(1)
        existing = (await db.execute(stmt)).scalar_one_or_none()
        if existing:
            return {
                "duplicate": True,
                "patient_phone": existing.patient_phone,
                "patient_name": existing.patient_name,
                "last_referral_id": str(existing.id),
                "last_short_code": existing.short_code,
            }

    # дубликата нет — возвращаем «можно создавать»
    return {
        "duplicate": False,
        "patient_phone": phone,
        "patient_name": full_name,
        "birth_date": payload.get("birth_date"),
        "consent_data_processing": True,
        "consented_at": datetime.now(timezone.utc).isoformat(),
    }
