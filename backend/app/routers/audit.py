"""
Аудит-журнал — API.
Этап 8 SaaS-трансформации.

Эндпоинты:
  GET /audit/log                         — все события (manager)
  GET /audit/log/export.csv              — выгрузка журнала в CSV (UTF-8 BOM)
  GET /audit/log/{entity_type}/{id}      — история конкретной сущности
  GET /audit/log/actor/{user_id}         — действия конкретного актора
  GET /audit/actions                     — список известных типов действий
"""
import csv
import io
import uuid
from typing import Optional
from datetime import datetime, date, timedelta

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import require_manager, get_tenant_db
from app.core.tenant import require_feature
from app.models.audit import AuditEntry
from app.models.user import User

router = APIRouter(prefix="/audit", tags=["audit"])

_feat = Depends(require_feature("audit_log"))


def _entry_out(e: AuditEntry) -> dict:
    return {
        "id":               str(e.id),
        "action":           e.action,
        "entity_type":      e.entity_type,
        "entity_id":        str(e.entity_id) if e.entity_id else None,
        "actor_id":         str(e.actor_id) if e.actor_id else None,
        "actor_name":       e.actor_name,
        "before":           e.before,
        "after":             e.after,
        "comment":          e.comment,
        "ip_address":       e.ip_address,
        # Гео-IP (могут быть None если mmdb отсутствует или приватный IP)
        "geo_country":      e.geo_country,
        "geo_country_name": e.geo_country_name,
        "geo_region":       e.geo_region,
        "geo_city":         e.geo_city,
        "geo_lat":          float(e.geo_lat) if e.geo_lat is not None else None,
        "geo_lon":          float(e.geo_lon) if e.geo_lon is not None else None,
        "created_at":       e.created_at.isoformat(),
    }


@router.get("/log", dependencies=[_feat])
async def get_audit_log(
    action: Optional[str]  = Query(None, description="Фильтр по типу действия"),
    entity_type: Optional[str] = Query(None),
    days: int = Query(30, ge=1, le=365),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Общий журнал аудита с фильтрацией."""
    d_from = datetime.utcnow() - timedelta(days=days)
    filters = [AuditEntry.created_at >= d_from]
    # Tenant isolation
    if current_user.tenant_id is not None:
        filters.append(AuditEntry.tenant_id == current_user.tenant_id)
    if action:
        filters.append(AuditEntry.action == action)
    if entity_type:
        filters.append(AuditEntry.entity_type == entity_type)

    q = await db.execute(
        select(AuditEntry)
        .where(and_(*filters))
        .order_by(AuditEntry.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    entries = q.scalars().all()

    # Общий count для пагинации
    count_q = await db.execute(
        select(AuditEntry.id).where(and_(*filters))
    )
    total = len(count_q.scalars().all())

    return {
        "total":   total,
        "limit":   limit,
        "offset":  offset,
        "items":   [_entry_out(e) for e in entries],
    }


# ───────────────────────────────────────────────────────────────────────────
# GET /audit/log/export.csv — выгрузка журнала в CSV (UTF-8 BOM, ; для Excel)
# Зарегистрирован ДО /log/{entity_type}/{entity_id}, чтобы FastAPI выбирал
# статический путь "export.csv" — хотя сегментов разное число, явный порядок
# защищает от регрессий при будущих правках сигнатур.
# ───────────────────────────────────────────────────────────────────────────
@router.get("/log/export.csv", dependencies=[_feat])
async def export_audit_log_csv(
    action: Optional[str]      = Query(None, description="Фильтр по типу действия"),
    entity_type: Optional[str] = Query(None),
    days: int = Query(30, ge=1, le=365),
    limit: int = Query(5000, ge=1, le=20000),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    """CSV-выгрузка аудит-журнала. UTF-8 BOM + разделитель «;» для Excel."""
    d_from = datetime.utcnow() - timedelta(days=days)
    filters = [AuditEntry.created_at >= d_from]
    if current_user.tenant_id is not None:
        filters.append(AuditEntry.tenant_id == current_user.tenant_id)
    if action:
        filters.append(AuditEntry.action == action)
    if entity_type:
        filters.append(AuditEntry.entity_type == entity_type)

    q = await db.execute(
        select(AuditEntry)
        .where(and_(*filters))
        .order_by(AuditEntry.created_at.desc())
        .limit(limit)
    )
    rows = q.scalars().all()

    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=";", quoting=csv.QUOTE_MINIMAL)
    writer.writerow([
        "Дата", "Действие", "Тип сущности", "ID сущности",
        "Актор", "IP", "Страна", "Город",
        "Состояние до", "Состояние после", "Комментарий",
    ])
    for r in rows:
        writer.writerow([
            r.created_at.strftime("%d.%m.%Y %H:%M:%S") if r.created_at else "",
            r.action or "",
            r.entity_type or "",
            str(r.entity_id) if r.entity_id else "",
            r.actor_name or (str(r.actor_id) if r.actor_id else ""),
            r.ip_address or "",
            r.geo_country_name or r.geo_country or "",
            r.geo_city or "",
            (str(r.before)[:500] if r.before else ""),
            (str(r.after)[:500]  if r.after  else ""),
            (r.comment or "")[:300],
        ])

    # UTF-8 BOM для корректного Excel
    body = ("﻿" + buf.getvalue()).encode("utf-8")
    filename = f"audit-{datetime.utcnow().strftime('%Y-%m-%d')}.csv"
    return Response(
        content=body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/log/{entity_type}/{entity_id}", dependencies=[_feat])
async def get_entity_history(
    entity_type: str,
    entity_id: uuid.UUID,
    limit: int = Query(50, ge=1, le=200),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    """История изменений конкретной сущности."""
    filters = [AuditEntry.entity_type == entity_type, AuditEntry.entity_id == entity_id]
    if current_user.tenant_id is not None:
        filters.append(AuditEntry.tenant_id == current_user.tenant_id)
    q = await db.execute(
        select(AuditEntry)
        .where(*filters)
        .order_by(AuditEntry.created_at.desc())
        .limit(limit)
    )
    return [_entry_out(e) for e in q.scalars().all()]


@router.get("/log/actor/{actor_id}", dependencies=[_feat])
async def get_actor_history(
    actor_id: uuid.UUID,
    days: int = Query(30, ge=1, le=365),
    limit: int = Query(50, ge=1, le=200),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Все действия конкретного пользователя."""
    # Tenant isolation: проверяем принадлежность актора нашему тенанту
    if current_user.tenant_id is not None:
        actor_obj = (await db.execute(select(User).where(User.id == actor_id))).scalar_one_or_none()
        if not actor_obj or actor_obj.tenant_id != current_user.tenant_id:
            return []
    d_from = datetime.utcnow() - timedelta(days=days)
    filters = [AuditEntry.actor_id == actor_id, AuditEntry.created_at >= d_from]
    if current_user.tenant_id is not None:
        filters.append(AuditEntry.tenant_id == current_user.tenant_id)
    q = await db.execute(
        select(AuditEntry)
        .where(*filters)
        .order_by(AuditEntry.created_at.desc())
        .limit(limit)
    )
    return [_entry_out(e) for e in q.scalars().all()]


@router.get("/actions", dependencies=[_feat, Depends(require_manager)])
async def list_audit_actions():
    """Список всех известных типов действий."""
    from app.services.audit_service import AuditAction
    actions = [v for k, v in vars(AuditAction).items() if not k.startswith("_")]
    return sorted(actions)

@router.get("/feed")
async def get_audit_feed(
    days: int = Query(30, ge=1, le=365),
    limit: int = Query(100, ge=1, le=500),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Объединённый журнал: audit_log + activity_log, сортировка по времени."""
    from datetime import timedelta
    from app.models.audit import AuditEntry
    from app.models.activity_log import ActivityLog
    from sqlalchemy import text

    d_from = (datetime.utcnow() - timedelta(days=days)).isoformat()

    # audit_log
    audit_filters = [AuditEntry.created_at >= datetime.utcnow() - timedelta(days=days)]
    if current_user.tenant_id is not None:
        audit_filters.append(AuditEntry.tenant_id == current_user.tenant_id)
    aq = await db.execute(
        select(AuditEntry)
        .where(*audit_filters)
        .order_by(AuditEntry.created_at.desc())
        .limit(limit)
    )
    audit_entries = [
        {
            "source": "audit",
            "id": str(e.id),
            "action": e.action,
            "actor_name": e.actor_name,
            "entity_type": e.entity_type,
            "entity_id": str(e.entity_id) if e.entity_id else None,
            "before": e.before,
            "after": e.after,
            "ip_address": e.ip_address,
            "geo_country":      e.geo_country,
            "geo_country_name": e.geo_country_name,
            "geo_region":       e.geo_region,
            "geo_city":         e.geo_city,
            "geo_lat":          float(e.geo_lat) if e.geo_lat is not None else None,
            "geo_lon":          float(e.geo_lon) if e.geo_lon is not None else None,
            "comment": e.comment,
            "created_at": e.created_at.isoformat(),
        }
        for e in aq.scalars().all()
    ]

    # activity_log
    activity_filters = [ActivityLog.created_at >= datetime.utcnow() - timedelta(days=days)]
    if current_user.tenant_id is not None:
        activity_filters.append(ActivityLog.tenant_id == current_user.tenant_id)
    lq = await db.execute(
        select(ActivityLog)
        .where(*activity_filters)
        .order_by(ActivityLog.created_at.desc())
        .limit(limit)
    )
    activity_entries = [
        {
            "source": "activity",
            "id": str(e.id),
            "action": e.action,
            "actor_name": e.user_name,
            "entity_type": e.entity_type,
            "entity_id": str(e.entity_id) if e.entity_id else None,
            "before": None,
            "after": None,
            "ip_address": getattr(e, 'ip_address', None),
            "geo_country":      getattr(e, 'geo_country', None),
            "geo_country_name": getattr(e, 'geo_country_name', None),
            "geo_region":       getattr(e, 'geo_region', None),
            "geo_city":         getattr(e, 'geo_city', None),
            "geo_lat":          None,
            "geo_lon":          None,
            "comment": None,
            "created_at": e.created_at.isoformat(),
        }
        for e in lq.scalars().all()
    ]

    # Merge & sort
    all_entries = sorted(
        audit_entries + activity_entries,
        key=lambda x: x["created_at"],
        reverse=True
    )[:limit]

    return {"total": len(all_entries), "items": all_entries}



@router.get("/by-tenant-geo")
async def get_by_tenant_geo(
    days: int = Query(30, ge=1, le=365),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Гео-статистика по тенантам/франшизам.

    Группирует события audit_log + activity_log по tenant + geo_region/city,
    возвращает по каждому тенанту:
      - имя
      - всего событий
      - топ-5 регионов (страна/регион/город) с количеством
      - уникальных IP
      - последний вход

    Только для super_admin (видит все тенанты) или manager в своём тенанте.
    """
    from datetime import timedelta
    from app.models.audit import AuditEntry
    from app.models.activity_log import ActivityLog
    from app.models.tenant import Tenant
    from app.models.franchise import Franchise
    from app.models.user import UserRole
    from app.services.region_lock_service import _matches as _region_matches

    cutoff = datetime.utcnow() - timedelta(days=days)
    is_superadmin = current_user.role == UserRole.SUPER_ADMIN

    # Тенант-скоуп
    tenant_filter = None if is_superadmin else (current_user.tenant_id,)

    # Тянем все события с гео за период
    audit_q = select(AuditEntry).where(AuditEntry.created_at >= cutoff)
    if not is_superadmin and current_user.tenant_id:
        audit_q = audit_q.where(AuditEntry.tenant_id == current_user.tenant_id)
    audit_rows = (await db.execute(audit_q)).scalars().all()

    activity_q = select(ActivityLog).where(ActivityLog.created_at >= cutoff)
    if not is_superadmin and current_user.tenant_id:
        activity_q = activity_q.where(ActivityLog.tenant_id == current_user.tenant_id)
    activity_rows = (await db.execute(activity_q)).scalars().all()

    # Тенанты — для имён
    tenants_q = select(Tenant)
    if not is_superadmin and current_user.tenant_id:
        tenants_q = tenants_q.where(Tenant.id == current_user.tenant_id)
    tenant_map = {str(t.id): t for t in (await db.execute(tenants_q)).scalars().all()}

    # Франшизы — для allowed_region/region_strict (для каждого тенанта берём через franchise_id)
    franchise_map: dict[str, Franchise] = {}
    franchise_ids = {t.franchise_id for t in tenant_map.values() if t.franchise_id}
    if franchise_ids:
        franchise_rows = (
            await db.execute(select(Franchise).where(Franchise.id.in_(franchise_ids)))
        ).scalars().all()
        franchise_map = {str(f.id): f for f in franchise_rows}

    # Агрегация по тенанту
    by_tenant: dict[str, dict] = {}
    NULL_KEY = '__null__'

    def add_event(tenant_id, ip, geo_country, geo_country_name, geo_region, geo_city, ts, action=None):
        key = str(tenant_id) if tenant_id else NULL_KEY
        bucket = by_tenant.setdefault(key, {
            'tenant_id': str(tenant_id) if tenant_id else None,
            'tenant_name': None,
            'events_count': 0,
            'unique_ips': set(),
            'last_event_at': None,
            'regions': {},
            'violations_count': 0,
            'last_violation_at': None,
        })
        bucket['events_count'] += 1
        if ip:
            bucket['unique_ips'].add(ip)
        if ts and (not bucket['last_event_at'] or ts > bucket['last_event_at']):
            bucket['last_event_at'] = ts
        # Регион — ключ "страна/регион/город"
        rkey = (geo_country or '?', geo_region or '', geo_city or '')
        rbucket = bucket['regions'].setdefault(rkey, {
            'country': geo_country, 'country_name': geo_country_name,
            'region': geo_region, 'city': geo_city, 'count': 0,
        })
        rbucket['count'] += 1
        # Подсчёт нарушений region.violation
        if action == "region.violation":
            bucket['violations_count'] += 1
            if ts and (not bucket['last_violation_at'] or ts > bucket['last_violation_at']):
                bucket['last_violation_at'] = ts

    for e in audit_rows:
        add_event(
            e.tenant_id, e.ip_address, e.geo_country, e.geo_country_name,
            e.geo_region, e.geo_city, e.created_at, action=e.action,
        )
    for e in activity_rows:
        add_event(
            getattr(e, 'tenant_id', None),
            getattr(e, 'ip_address', None),
            getattr(e, 'geo_country', None),
            getattr(e, 'geo_country_name', None),
            getattr(e, 'geo_region', None),
            getattr(e, 'geo_city', None),
            e.created_at,
        )

    # Финальное форматирование
    out = []
    for key, b in by_tenant.items():
        tid = b['tenant_id']
        t = tenant_map.get(tid) if tid else None
        franchise = None
        if t and t.franchise_id:
            franchise = franchise_map.get(str(t.franchise_id))
        allowed_region = franchise.allowed_region if franchise else None
        # Если allowed_region задан — пересчитаем violations через _matches:
        # топовые регионы где geo_region не подпадает под allowed.
        out_of_region_count = 0
        if allowed_region:
            for r in b['regions'].values():
                if not _region_matches(r['region'], allowed_region):
                    out_of_region_count += r['count']
        regions_list = sorted(b['regions'].values(), key=lambda r: r['count'], reverse=True)[:5]
        # Помечаем регионы вне зоны разрешённой франшизы — для подсветки в UI
        if allowed_region:
            for r in regions_list:
                r['out_of_region'] = not _region_matches(r['region'], allowed_region)
        out.append({
            'tenant_id': tid,
            'tenant_name': (t.name if t else None) or (t.slug if t else 'Без тенанта'),
            'tenant_slug': t.slug if t else None,
            'franchise_id': str(franchise.id) if franchise else None,
            'franchise_name': franchise.name if franchise else None,
            'allowed_region': allowed_region,
            'region_strict': franchise.region_strict if franchise else False,
            'events_count': b['events_count'],
            'unique_ips': len(b['unique_ips']),
            'last_event_at': b['last_event_at'].isoformat() if b['last_event_at'] else None,
            'regions': regions_list,
            'violations_count': b['violations_count'],
            'out_of_region_events': out_of_region_count,
            'last_violation_at': b['last_violation_at'].isoformat() if b['last_violation_at'] else None,
        })

    out.sort(key=lambda x: (x['violations_count'], x['events_count']), reverse=True)
    return {'total_tenants': len(out), 'days': days, 'tenants': out}


@router.get("/region-violations")
async def list_region_violations(
    days: int = Query(30, ge=1, le=365),
    limit: int = Query(200, ge=1, le=1000),
    tenant_id: uuid.UUID | None = Query(None),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Лента событий action='region.violation' за период.

    Возвращает по каждому событию: when, tenant, franchise, allowed_region,
    detected_region/city/country, original_action, IP, actor.
    Только super_admin видит все тенанты, manager — только свой.
    """
    from datetime import timedelta
    from app.models.audit import AuditEntry
    from app.models.tenant import Tenant
    from app.models.franchise import Franchise
    from app.models.user import UserRole

    cutoff = datetime.utcnow() - timedelta(days=days)
    is_superadmin = current_user.role == UserRole.SUPER_ADMIN

    q = (
        select(AuditEntry)
        .where(AuditEntry.action == "region.violation")
        .where(AuditEntry.created_at >= cutoff)
        .order_by(AuditEntry.created_at.desc())
        .limit(limit)
    )
    if tenant_id is not None:
        q = q.where(AuditEntry.tenant_id == tenant_id)
    if not is_superadmin and current_user.tenant_id:
        q = q.where(AuditEntry.tenant_id == current_user.tenant_id)
    rows = (await db.execute(q)).scalars().all()

    # Подгружаем имена тенантов и франшиз батчем
    tenant_ids = {r.tenant_id for r in rows if r.tenant_id}
    tenant_map: dict[str, Tenant] = {}
    franchise_map: dict[str, Franchise] = {}
    if tenant_ids:
        tenants = (
            await db.execute(select(Tenant).where(Tenant.id.in_(tenant_ids)))
        ).scalars().all()
        tenant_map = {str(t.id): t for t in tenants}
        franchise_ids = {t.franchise_id for t in tenants if t.franchise_id}
        if franchise_ids:
            franchises = (
                await db.execute(select(Franchise).where(Franchise.id.in_(franchise_ids)))
            ).scalars().all()
            franchise_map = {str(f.id): f for f in franchises}

    # Подгружаем для каждой пары (franchise, ip) — есть ли запись в whitelist.
    # Один запрос: WHERE (franchise_id, ip) ∈ pairs. Используем VALUES + JOIN.
    whitelist_pairs: set[tuple[str, str]] = set()
    pairs_to_check = {
        (str(franchise_map.get(str(t.franchise_id)).id), e.ip_address)
        for e in rows
        if e.ip_address and e.tenant_id
        and (t := tenant_map.get(str(e.tenant_id)))
        and t.franchise_id
        and franchise_map.get(str(t.franchise_id))
    }
    if pairs_to_check:
        from sqlalchemy import text as sa_text
        # Проверяем каждую пару, попадает ли IP в один из cidr этой франшизы
        for fid, ip in pairs_to_check:
            try:
                hit = (await db.execute(
                    sa_text(
                        "SELECT 1 FROM franchise_ip_allowlist "
                        "WHERE franchise_id = :fid AND CAST(:ip AS inet) <<= ip_cidr LIMIT 1"
                    ),
                    {"fid": fid, "ip": ip},
                )).first()
                if hit:
                    whitelist_pairs.add((fid, ip))
            except Exception:
                pass

    items = []
    for e in rows:
        after = e.after or {}
        t = tenant_map.get(str(e.tenant_id)) if e.tenant_id else None
        f = (
            franchise_map.get(str(t.franchise_id))
            if (t and t.franchise_id) else None
        )
        items.append({
            'id': str(e.id),
            'created_at': e.created_at.isoformat() if e.created_at else None,
            'tenant_id': str(e.tenant_id) if e.tenant_id else None,
            'tenant_name': t.name if t else None,
            'franchise_id': str(f.id) if f else None,
            'franchise_name': f.name if f else after.get('franchise_name'),
            'allowed_region': (f.allowed_region if f else None) or after.get('allowed_region'),
            'franchise_is_blocked': bool(f.is_blocked) if f else False,
            'franchise_blocked_until': (f.blocked_until.isoformat() if (f and f.blocked_until) else None),
            'detected_region': e.geo_region or after.get('detected_region'),
            'detected_city': e.geo_city or after.get('detected_city'),
            'detected_country': e.geo_country_name or after.get('detected_country'),
            'original_action': after.get('original_action'),
            'region_strict': after.get('region_strict', False),
            'ip_address': e.ip_address,
            'actor_id': str(e.actor_id) if e.actor_id else None,
            'actor_name': e.actor_name,
            'comment': e.comment,
            '_whitelisted': (
                f is not None and e.ip_address is not None
                and (str(f.id), e.ip_address) in whitelist_pairs
            ),
        })

    return {'total': len(items), 'days': days, 'items': items}
