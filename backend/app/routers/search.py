"""
Глобальный поиск /search — для CommandPalette (Cmd+K).
Возвращает короткие сводки по 4 коллекциям: пациенты, врачи, направления, услуги.
Каждая — макс 5 элементов, чтобы дроп быстро рендерился.

Доступ: manager+, super_admin, franchise_owner.
Tenant isolation — везде, где есть tenant_id.
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, or_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import require_manager
from app.models.user import User, UserRole
from app.models.referral import Referral
from app.models.service import Service

router = APIRouter(tags=["search"])


def _norm_phone(s: str) -> str:
    """Оставляем только цифры — для поиска по телефону без зависимости от форматирования."""
    return "".join(ch for ch in (s or "") if ch.isdigit())


@router.get("/search")
async def global_search(
    q: str = Query(..., min_length=1, max_length=80),
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """
    Универсальный поиск для CommandPalette.
    Возвращает {patients, doctors, referrals, services} — каждый макс 5.
    """
    q_text = (q or "").strip()
    q_phone = _norm_phone(q_text)
    like = f"%{q_text.lower()}%"

    tenant = current_user.tenant_id

    # ─── Пациенты ─── (User.role=PATIENT, по имени или телефону)
    pf = [User.role == UserRole.PATIENT]
    if tenant is not None:
        pf.append(User.tenant_id == tenant)
    cond = []
    if q_text:
        cond.append(func.lower(User.full_name).like(like))
    if q_phone:
        cond.append(User.phone_number.like(f"%{q_phone}%"))
    if cond:
        pf.append(or_(*cond))
    pq = await db.execute(select(User).where(*pf).limit(5))
    patients = [
        {"id": str(u.id), "name": u.full_name, "phone": u.phone_number or ""}
        for u in pq.scalars().all()
    ]

    # ─── Врачи ─── (User.role в DOCTOR/PARTNER_DOCTOR/VISITING_DOCTOR)
    df = [User.role.in_([UserRole.DOCTOR, UserRole.PARTNER_DOCTOR, UserRole.VISITING_DOCTOR, UserRole.LAB_CT, UserRole.LAB_XRAY])]
    if tenant is not None:
        df.append(User.tenant_id == tenant)
    if q_text:
        df.append(func.lower(User.full_name).like(like))
    dq = await db.execute(select(User).where(*df).limit(5))
    doctors = [
        {
            "id": str(u.id),
            "full_name": u.full_name,
            "specialty": u.specialization or "",
        }
        for u in dq.scalars().all()
    ]

    # ─── Направления ─── (по short_code, либо по фрагменту имени пациента)
    rf = []
    if tenant is not None:
        rf.append(Referral.tenant_id == tenant)
    rcond = []
    # short_code — целое число; ищем точное совпадение
    if q_text.isdigit() and len(q_text) <= 9:
        try:
            rcond.append(Referral.short_code == int(q_text))
        except ValueError:
            pass
    if q_text:
        rcond.append(func.lower(Referral.patient_name).like(like))
    if q_phone:
        rcond.append(Referral.patient_phone.like(f"%{q_phone}%"))
    if rcond:
        rf.append(or_(*rcond))
    rq = await db.execute(
        select(Referral).where(*rf).order_by(Referral.created_at.desc()).limit(5)
    )
    refs_raw = rq.scalars().all()

    # Подгрузим имена услуг батчем
    svc_ids = [r.service_id for r in refs_raw if r.service_id]
    svc_map: dict[uuid.UUID, str] = {}
    if svc_ids:
        sq = await db.execute(select(Service).where(Service.id.in_(svc_ids)))
        for s in sq.scalars().all():
            svc_map[s.id] = s.name

    referrals = [
        {
            "id":            str(r.id),
            "short_code":    r.short_code,
            "patient_name":  r.patient_name or "",
            "phone":         r.patient_phone or "",
            "service_name":  svc_map.get(r.service_id, ""),
            "status":        r.status.value if r.status else "",
        }
        for r in refs_raw
    ]

    # ─── Услуги ─── (по name, code)
    sf = []
    if tenant is not None:
        sf.append(Service.tenant_id == tenant)
    scond = []
    if q_text:
        scond.append(func.lower(Service.name).like(like))
        scond.append(func.lower(Service.code).like(like))
    if scond:
        sf.append(or_(*scond))
    sq2 = await db.execute(select(Service).where(*sf).limit(5))
    services = [
        {"id": str(s.id), "name": s.name, "code": s.code or ""}
        for s in sq2.scalars().all()
    ]

    return {
        "patients":  patients,
        "doctors":   doctors,
        "referrals": referrals,
        "services":  services,
    }
