import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from app.database import get_db
from app.models.user import User, UserRole
from app.models.referral import Referral, ReferralStatus
from app.models.bonus import Bonus, BonusStatus
from app.schemas.user import UserResponse, UserUpdate
from app.core.deps import get_current_user, require_manager

router = APIRouter(prefix="/admins", tags=["admins"])


@router.get("/me")
async def get_me(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    from app.models.tenant import Tenant as TenantModel
    from app.config import settings
    tenant_slug = None
    tenant_obj = None
    if current_user.tenant_id:

        from sqlalchemy import select as _sel
        t_r = await db.execute(_sel(TenantModel).where(TenantModel.id == current_user.tenant_id))
        tenant_obj = t_r.scalar_one_or_none()
        tenant_slug = tenant_obj.slug if tenant_obj else None

    role = current_user.role.value
    superadmin_uname = getattr(settings, "superadmin_username", "khamzat")
    is_super = (role == "super_admin" or current_user.username == superadmin_uname)

    data = UserResponse.model_validate(current_user).model_dump()
    data["tenant_slug"] = tenant_slug
    data["tenant_id"] = str(current_user.tenant_id) if current_user.tenant_id else None
    data["is_super"] = is_super
    if is_super:
        data["redirect_url"] = "/admin"
    elif role == "manager" and tenant_slug:
        data["redirect_url"] = f"/{tenant_slug}/manager"
    elif role in ("doctor", "recruiter") and tenant_slug:
        data["redirect_url"] = f"/{tenant_slug}/admin"
    elif tenant_slug:
        data["redirect_url"] = f"/{tenant_slug}/"
    else:
        data["redirect_url"] = "/arc/"

    # ── Trial status (Глава 2: Self-service onboarding) ─────────────────
    # Возвращаем активному пользователю состояние триала его тенанта,
    # чтобы фронт мог рисовать TrialBanner (expiring_soon/expired) без
    # дополнительных запросов. См. services/onboarding_service.trial_status_for.
    try:
        from app.services.onboarding_service import trial_status_for
        # План — из активной подписки (если есть).
        plan = None
        if current_user.tenant_id:
            from app.models.billing import Subscription as _Sub
            from sqlalchemy import select as _sel2
            sub_r = await db.execute(_sel2(_Sub).where(_Sub.tenant_id == current_user.tenant_id))
            sub = sub_r.scalars().first()
            if sub:
                plan = sub.plan
        data["trial_status"] = trial_status_for(tenant_obj, plan=plan)
    except Exception:
        # Не критично — старые клиенты не используют поле.
        data["trial_status"] = {"plan": None, "status": "none", "days_left": None, "trial_ends_at": None}

    return data


@router.patch("/me", response_model=UserResponse)
async def update_me(
    data: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    for key, value in data.model_dump(exclude_none=True).items():
        setattr(current_user, key, value)
    await db.commit()
    await db.refresh(current_user)
    return current_user


# ---------------------------------------------------------------------------
# Feature 12: Дашборд сотрудника — личная статистика
# ---------------------------------------------------------------------------

@router.get("/me/stats")
async def get_my_stats(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Личная статистика сотрудника: текущий месяц, прошлый месяц, за всё время."""
    from datetime import date
    from sqlalchemy import extract

    now = date.today()
    this_month_start = now.replace(day=1)
    last_month_end = this_month_start
    last_month_start = (this_month_start.replace(day=1) - __import__('datetime').timedelta(days=1)).replace(day=1)

    async def count_refs(date_from, date_to):
        q = await db.execute(
            select(Referral.status, func.count(Referral.id))
            .where(
                Referral.created_by_admin_id == current_user.id,
                Referral.created_at >= date_from,
                Referral.created_at < date_to,
            )
            .group_by(Referral.status)
        )
        return {row[0]: row[1] for row in q.all()}

    async def sum_bonuses(date_from, date_to):
        ref_ids_q = select(Referral.id).where(
            Referral.created_by_admin_id == current_user.id,
            Referral.created_at >= date_from,
            Referral.created_at < date_to,
        )
        q = await db.execute(
            select(Bonus.status, func.coalesce(func.sum(Bonus.amount), 0))
            .where(
                Bonus.admin_id == current_user.id,
                Bonus.referral_id.in_(ref_ids_q),
            )
            .group_by(Bonus.status)
        )
        return {row[0]: float(row[1]) for row in q.all()}

    from datetime import datetime, timedelta
    this_start = datetime(now.year, now.month, 1)
    next_month = (this_start + timedelta(days=32)).replace(day=1)
    last_start = datetime(last_month_start.year, last_month_start.month, 1)

    this_refs = await count_refs(this_start, next_month)
    last_refs = await count_refs(last_start, this_start)
    all_refs_q = await db.execute(
        select(Referral.status, func.count(Referral.id))
        .where(Referral.created_by_admin_id == current_user.id)
        .group_by(Referral.status)
    )
    all_refs = {row[0]: row[1] for row in all_refs_q.all()}

    this_bonuses = await sum_bonuses(this_start, next_month)
    all_bonuses_q = await db.execute(
        select(Bonus.status, func.coalesce(func.sum(Bonus.amount), 0))
        .where(Bonus.admin_id == current_user.id)
        .group_by(Bonus.status)
    )
    all_bonuses = {row[0]: float(row[1]) for row in all_bonuses_q.all()}

    # Best month — find month with max confirmed (use raw SQL to avoid date_trunc parameterization)
    from sqlalchemy import text as sa_text
    best_q = await db.execute(
        sa_text("""
            SELECT COUNT(*) as cnt
            FROM referrals
            WHERE created_by_admin_id = :admin_id AND status = 'confirmed'
            GROUP BY date_trunc('month', created_at)
            ORDER BY cnt DESC
            LIMIT 1
        """),
        {"admin_id": str(current_user.id)}
    )
    best_row = best_q.first()

    # Статистика за сегодня
    from datetime import datetime, date, timedelta
    today_start = datetime.combine(date.today(), datetime.min.time())
    tomorrow_start = today_start + timedelta(days=1)
    today_refs = await count_refs(today_start, tomorrow_start)

    return {
        "this_month": {
            "total": sum(this_refs.values()),
            "confirmed": this_refs.get(ReferralStatus.CONFIRMED, 0),
            "pending_bonus": this_bonuses.get(BonusStatus.PENDING, 0.0),
        },
        "last_month": {
            "total": sum(last_refs.values()),
            "confirmed": last_refs.get(ReferralStatus.CONFIRMED, 0),
        },
        "all_time": {
            "total": sum(all_refs.values()),
            "confirmed": all_refs.get(ReferralStatus.CONFIRMED, 0),
            "paid_bonus": all_bonuses.get(BonusStatus.PAID, 0.0),
        },
        "best_month_confirmed": best_row.cnt if best_row else 0,
        "today": {
            "total": sum(today_refs.values()),
            "confirmed": today_refs.get(ReferralStatus.CONFIRMED, 0),
        },
    }


# ---------------------------------------------------------------------------
# Feature: KPI прогресс текущего сотрудника за текущий месяц
# ---------------------------------------------------------------------------

@router.get("/me/kpi")
async def get_my_kpi(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """KPI цель текущего сотрудника за текущий месяц."""
    from app.models.kpi_target import KpiTarget
    from datetime import datetime, date, timedelta

    now = date.today()
    month_str = now.replace(day=1)  # date объект начала месяца (совпадает с полем month в модели)

    result = await db.execute(
        select(KpiTarget).where(
            KpiTarget.admin_id == current_user.id,
            KpiTarget.month == month_str,
        )
    )
    kpi = result.scalar_one_or_none()
    if not kpi:
        return {"has_target": False, "target_referrals": 0, "target_confirmed": 0}

    # Границы текущего месяца
    month_start = datetime(now.year, now.month, 1)
    next_month_start = (month_start + timedelta(days=32)).replace(day=1)

    # Прогресс: направления, созданные текущим сотрудником за текущий месяц
    refs_q = await db.execute(
        select(Referral.status, func.count(Referral.id))
        .where(
            Referral.created_by_admin_id == current_user.id,
            Referral.created_at >= month_start,
            Referral.created_at < next_month_start,
        )
        .group_by(Referral.status)
    )
    refs_by_status = {row[0]: row[1] for row in refs_q.all()}

    current_referrals = sum(refs_by_status.values())
    current_confirmed = refs_by_status.get(ReferralStatus.CONFIRMED, 0)

    return {
        "has_target": True,
        "target_referrals": kpi.target_referrals,
        "target_confirmed": kpi.target_confirmed,
        "current_referrals": current_referrals,
        "current_confirmed": current_confirmed,
    }


# ---------------------------------------------------------------------------
# Manager-only endpoints
# ---------------------------------------------------------------------------

@router.get("/", response_model=list[UserResponse])
async def list_admins(
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Список сотрудников (admin/manager). Партнёры исключены — они в /manager/partners/."""
    # Только активные сотрудники (деактивированные видит только super_admin)
    q = select(User).where(User.is_active == True).order_by(User.full_name)
    # Тенант-изоляция
    if current_user.tenant_id is not None:
        q = q.where(User.tenant_id == current_user.tenant_id)
    # Менеджер с clinic_id видит только свою клинику
    if current_user.clinic_id is not None:
        q = q.where(User.clinic_id == current_user.clinic_id)
    result = await db.execute(q)
    return result.scalars().all()


@router.get("/{admin_id}/stats")
async def get_admin_stats(
    admin_id: uuid.UUID,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Stats for a specific admin: referral counts and bonus totals. Manager only."""
    result = await db.execute(select(User).where(User.id == admin_id))
    admin = result.scalar_one_or_none()
    if not admin or (current_user.tenant_id is not None and admin.tenant_id != current_user.tenant_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Администратор не найден")

    # Referral counts by status
    ref_q = await db.execute(
        select(Referral.status, func.count(Referral.id))
        .where(Referral.created_by_admin_id == admin_id)
        .group_by(Referral.status)
    )
    status_counts: dict[str, int] = {row[0]: row[1] for row in ref_q.all()}

    # Bonus totals by status
    bonus_q = await db.execute(
        select(Bonus.status, func.coalesce(func.sum(Bonus.amount), 0))
        .where(Bonus.admin_id == admin_id)
        .group_by(Bonus.status)
    )
    bonus_sums: dict[str, float] = {row[0]: float(row[1]) for row in bonus_q.all()}

    return {
        "admin_id": admin.id,
        "full_name": admin.full_name,
        "clinic_id": admin.clinic_id,
        "is_active": admin.is_active,
        "total_referrals": sum(status_counts.values()),
        "confirmed_referrals": status_counts.get(ReferralStatus.CONFIRMED, 0),
        "expired_referrals": status_counts.get(ReferralStatus.EXPIRED, 0),
        "pending_referrals": status_counts.get(ReferralStatus.CREATED, 0),
        "pending_bonuses": bonus_sums.get(BonusStatus.PENDING, 0.0),
        "paid_bonuses": bonus_sums.get(BonusStatus.PAID, 0.0),
    }


# ── Модерация заявок на привлечённых врачей ────────────────────────────────────

@router.get("/doctor-requests")
async def list_doctor_requests(
    status_filter: str | None = None,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Список заявок на регистрацию врача от менеджеров по привлечению."""
    from app.models.external_doctor import DoctorRequest
    q = select(DoctorRequest).where(DoctorRequest.tenant_id == current_user.tenant_id)
    if status_filter:
        q = q.where(DoctorRequest.status == status_filter)
    q = q.order_by(DoctorRequest.created_at.desc())
    rows = (await db.execute(q)).scalars().all()
    result = []
    for r in rows:
        manager = None
        if r.manager_id:
            m = (await db.execute(select(User).where(User.id == r.manager_id))).scalar_one_or_none()
            manager = m.full_name if m else None
        result.append({
            "id": r.id,
            "manager_id": r.manager_id,
            "manager_name": manager,
            "doctor_name": r.doctor_name,
            "phone": r.phone,
            "clinic_name": r.clinic_name,
            "specialization": r.specialization,
            "notes": r.notes,
            "status": r.status,
            "created_at": r.created_at,
            "approved_at": r.approved_at,
        })
    return result


@router.post("/doctor-requests/{request_id}/approve")
async def approve_doctor_request(
    request_id: uuid.UUID,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Одобрить заявку — создать аккаунт external_doctor и обновить статус заявки."""
    from app.models.external_doctor import DoctorRequest
    import secrets, hashlib
    from datetime import datetime, timezone

    req = (await db.execute(
        select(DoctorRequest).where(
            DoctorRequest.id == request_id,
            DoctorRequest.tenant_id == current_user.tenant_id,
        )
    )).scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    if req.status != "pending":
        raise HTTPException(status_code=400, detail="Заявка уже обработана")

    # Создаём пользователя
    raw_pass = secrets.token_urlsafe(8)
    hashed = hashlib.sha256(raw_pass.encode()).hexdigest()  # auth_utils недоступен напрямую
    try:
        from app.core.security import get_password_hash
        hashed = get_password_hash(raw_pass)
    except Exception:
        try:
            from app.core.auth import get_password_hash
            hashed = get_password_hash(raw_pass)
        except Exception:
            pass

    username = "doc_" + req.phone.replace("+", "").replace(" ", "")[-8:]
    new_user = User(
        full_name=req.doctor_name,
        username=username,
        hashed_password=hashed,
        role=UserRole.PARTNER_DOCTOR,
        tenant_id=current_user.tenant_id,
        manager_id=req.manager_id,
        is_active=True,
    )
    db.add(new_user)
    await db.flush()

    req.status = "approved"
    req.approved_at = datetime.now(timezone.utc)
    req.approved_by_id = current_user.id
    req.created_user_id = new_user.id
    await db.commit()

    return {
        "status": "approved",
        "user_id": new_user.id,
        "username": username,
        "temp_password": raw_pass,
    }


@router.post("/doctor-requests/{request_id}/reject")
async def reject_doctor_request(
    request_id: uuid.UUID,
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Отклонить заявку."""
    from app.models.external_doctor import DoctorRequest
    req = (await db.execute(
        select(DoctorRequest).where(
            DoctorRequest.id == request_id,
            DoctorRequest.tenant_id == current_user.tenant_id,
        )
    )).scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    req.status = "rejected"
    await db.commit()
    return {"status": "rejected"}


@router.get("/external-doctors")
async def list_external_doctors(
    current_user: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Список всех external/visiting врачей тенанта."""
    q = select(User).where(
        User.tenant_id == current_user.tenant_id,
        User.role.in_([UserRole.PARTNER_DOCTOR, UserRole.VISITING_DOCTOR]),
        User.is_active == True,
    ).order_by(User.full_name)
    rows = (await db.execute(q)).scalars().all()
    return [
        {
            "id": u.id,
            "full_name": u.full_name,
            "username": u.username,
            "role": u.role.value,
            "doctor_type": u.doctor_type,
            "manager_id": u.manager_id,
            "clinic_id": u.clinic_id,
            "is_active": u.is_active,
            "is_suspended": getattr(u, "is_suspended", False),
        }
        for u in rows
    ]
