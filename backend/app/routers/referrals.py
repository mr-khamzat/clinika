from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.user import User, UserRole
from app.models.referral import Referral, ReferralStatus
from app.models.referral_comment import ReferralComment
from app.schemas.referral import ReferralCreate, ReferralResponse, QRScanRequest, CancelRequestBody
from app.services.referral_service import create_referral, confirm_referral, confirm_referral_by_short_code
from app.core.deps import get_current_user
from app.core.region_lock import enforce_region_lock
from app.services import webhook_service
from datetime import datetime
from pydantic import BaseModel
import uuid


async def _log(db, user, action, entity_type=None, entity_id=None):
    from app.models.activity_log import ActivityLog
    db.add(ActivityLog(
        user_id=user.id if user else None,
        user_name=user.full_name if user else None,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
    ))

class CommentBody(BaseModel):
    text: str

class ShortCodeRequest(BaseModel):
    short_code: int

router = APIRouter(prefix="/referrals", tags=["referrals"])


@router.get("/verify-patient")
async def verify_patient(
    phone: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Проверить наличие пациента в МИС Renovatio по номеру телефона.
    Возвращает данные пациента если найден, иначе found=false.
    """
    from app.services.mis_client import find_patient_by_phone
    try:
        patient = await find_patient_by_phone(phone)
    except Exception:
        return {"found": False, "error": "МИС недоступна"}

    if not patient:
        return {"found": False}

    return {
        "found": True,
        "mis_patient_id": patient.get("patient_id"),
        "mis_number": patient.get("number"),
        "name": " ".join(filter(None, [
            patient.get("last_name"),
            patient.get("first_name"),
            patient.get("third_name"),
        ])).strip(),
        "birth_date": patient.get("birth_date"),
        "gender": "М" if patient.get("gender") == 1 else "Ж" if patient.get("gender") == 2 else None,
    }


@router.post("/", response_model=ReferralResponse, dependencies=[Depends(enforce_region_lock)])
async def create_new_referral(
    data: ReferralCreate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    from_clinic_id = current_user.clinic_id or data.from_clinic_id
    # Партнёры (role=partner) не привязаны к клинике — from_clinic_id остаётся None
    if not from_clinic_id and current_user.role != UserRole.PARTNER_DOCTOR:
        raise HTTPException(status_code=400, detail="Укажите клинику-отправителя")

    # Получаем slug тенанта для URL пациента
    _tenant_slug = None
    if current_user.tenant_id:
        from app.models.tenant import Tenant as _Tenant
        _tenant = await db.get(_Tenant, current_user.tenant_id)
        _tenant_slug = _tenant.slug if _tenant else None
    _base_url = request.headers.get("origin") or request.headers.get("referer", "").rstrip("/").rsplit("/", 2)[0] or None

    referral = await create_referral(
        db=db,
        from_clinic_id=from_clinic_id,
        to_clinic_id=data.to_clinic_id,
        service_id=data.service_id,
        patient_phone=data.patient_phone,
        patient_name=data.patient_name,
        mis_patient_id=data.mis_patient_id,
        mis_doctor_id=getattr(data, "mis_doctor_id", None),
        created_by_admin_id=current_user.id,
        notes=data.notes,
        appointment_at=data.appointment_at,
        tenant_id=current_user.tenant_id,
        tenant_slug=_tenant_slug,
        base_url=_base_url,
    )
    await _log(db, current_user, "Создано направление", "referral", referral.id)
    if current_user.tenant_id:
        await webhook_service.send_event(db, current_user.tenant_id, "referral_created",
            {"referral_id": str(referral.id), "patient_name": referral.patient_name, "status": "created"})
    await db.commit()
    return await _enrich_referral(referral, db)

@router.post("/confirm-by-code", response_model=ReferralResponse, dependencies=[Depends(enforce_region_lock)])
async def confirm_by_short_code(
    data: ShortCodeRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Подтвердить направление по 5-значному коду (без сканирования QR)."""
    try:
        referral = await confirm_referral_by_short_code(
            db, data.short_code, current_user.id,
            confirming_user_tenant_id=current_user.tenant_id,
        )
        await _log(db, current_user, "Подтверждено направление по коду", "referral", referral.id)
        await db.commit()
        return await _enrich_referral(referral, db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/scan", response_model=ReferralResponse, dependencies=[Depends(enforce_region_lock)])
async def scan_qr(
    data: QRScanRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    try:
        referral = await confirm_referral(
            db, data.qr_data, current_user.id,
            confirming_user_tenant_id=current_user.tenant_id,
        )
        await _log(db, current_user, "Подтверждено направление", "referral", referral.id)
        await db.commit()
        return await _enrich_referral(referral, db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/", response_model=list[ReferralResponse])
async def get_my_referrals(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Referral)
        .where(Referral.created_by_admin_id == current_user.id)
        .order_by(Referral.created_at.desc())
        .limit(50)
    )
    referrals = result.scalars().all()
    return [await _enrich_referral(r, db) for r in referrals]

@router.get("/incoming", response_model=list[ReferralResponse])
async def get_incoming_referrals(
    status: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Входящие направления — направленные В клинику текущего пользователя.
    Используется для уведомлений и просмотра ожидаемых пациентов.
    """
    if not current_user.clinic_id:
        return []
    q = (
        select(Referral)
        .where(
            Referral.to_clinic_id == current_user.clinic_id,
            Referral.created_by_admin_id != current_user.id,  # исключаем свои
        )
        .order_by(Referral.created_at.desc())
        .limit(100)
    )
    if status:
        from app.models.referral import ReferralStatus as RS
        try:
            q = q.where(Referral.status == RS(status))
        except ValueError:
            pass
    result = await db.execute(q)
    referrals = result.scalars().all()
    return [await _enrich_referral(r, db) for r in referrals]

@router.get("/{referral_id}", response_model=ReferralResponse)
async def get_referral(
    referral_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    q = select(Referral).where(Referral.id == referral_id)
    if current_user.tenant_id is not None:
        q = q.where(
            (Referral.tenant_id == current_user.tenant_id) |
            (Referral.tenant_id == None)
        )
    result = await db.execute(q)
    referral = result.scalar_one_or_none()
    if not referral:
        raise HTTPException(status_code=404, detail="Направление не найдено")
    return await _enrich_referral(referral, db)

@router.post("/{referral_id}/cancel-request", response_model=ReferralResponse)
async def request_cancel(
    referral_id: uuid.UUID,
    body: CancelRequestBody,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Администратор запрашивает отмену направления — уходит на подтверждение руководителю."""
    result = await db.execute(select(Referral).where(Referral.id == referral_id))
    referral = result.scalar_one_or_none()
    if not referral or (current_user.tenant_id is not None and referral.tenant_id != current_user.tenant_id):
        raise HTTPException(status_code=404, detail="Направление не найдено")
    if referral.created_by_admin_id != current_user.id and current_user.role != UserRole.MANAGER:
        raise HTTPException(status_code=403, detail="Нет доступа")
    if referral.status not in (ReferralStatus.CREATED, ReferralStatus.CONFIRMED):
        raise HTTPException(status_code=400, detail="Нельзя запросить отмену для этого направления")
    if not body.reason or not body.reason.strip():
        raise HTTPException(status_code=400, detail="Укажите причину отмены")

    referral.status = ReferralStatus.CANCEL_REQUESTED
    referral.cancel_reason = body.reason.strip()
    referral.cancel_requested_at = datetime.utcnow()
    await _log(db, current_user, "Запрос на отмену направления", "referral", referral.id)
    await db.commit()
    await db.refresh(referral)
    return await _enrich_referral(referral, db)

# ---------------------------------------------------------------------------
# Feature 11: Комментарии к направлению
# ---------------------------------------------------------------------------

@router.get("/{referral_id}/comments")
async def get_comments(
    referral_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # Tenant isolation
    ref_obj = (await db.execute(select(Referral).where(Referral.id == referral_id))).scalar_one_or_none()
    if not ref_obj or (current_user.tenant_id is not None and ref_obj.tenant_id != current_user.tenant_id):
        raise HTTPException(status_code=404, detail="Направление не найдено")
    result = await db.execute(
        select(ReferralComment)
        .where(ReferralComment.referral_id == referral_id)
        .order_by(ReferralComment.created_at)
    )
    comments = result.scalars().all()
    out = []
    for c in comments:
        author = (await db.execute(select(User).where(User.id == c.author_id))).scalar_one_or_none()
        out.append({
            "id": str(c.id),
            "text": c.text,
            "author_name": author.full_name if author else "—",
            "created_at": c.created_at.isoformat(),
        })
    return out


@router.post("/{referral_id}/comments")
async def add_comment(
    referral_id: uuid.UUID,
    body: CommentBody,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    if not body.text or not body.text.strip():
        raise HTTPException(status_code=400, detail="Пустой комментарий")
    result = await db.execute(select(Referral).where(Referral.id == referral_id))
    ref_obj = result.scalar_one_or_none()
    if not ref_obj or (current_user.tenant_id is not None and ref_obj.tenant_id != current_user.tenant_id):
        raise HTTPException(status_code=404, detail="Направление не найдено")

    comment = ReferralComment(
        referral_id=referral_id,
        author_id=current_user.id,
        text=body.text.strip(),
    )
    db.add(comment)
    await db.commit()
    await db.refresh(comment)
    return {
        "id": str(comment.id),
        "text": comment.text,
        "author_name": current_user.full_name,
        "created_at": comment.created_at.isoformat(),
    }


async def _enrich_referral(referral: Referral, db: AsyncSession) -> ReferralResponse:
    from app.models.clinic import Clinic
    from app.models.service import Service
    from app.models.bonus import Bonus, BonusType

    from_clinic = (
        (await db.execute(select(Clinic).where(Clinic.id == referral.from_clinic_id))).scalar_one_or_none()
        if referral.from_clinic_id else None
    )
    to_clinic = (await db.execute(select(Clinic).where(Clinic.id == referral.to_clinic_id))).scalar_one_or_none()
    service = (await db.execute(select(Service).where(Service.id == referral.service_id))).scalar_one_or_none()
    # Берём только основной бонус сотрудника (REGULAR) — комиссионный не показываем
    bonus_result = await db.execute(
        select(Bonus).where(
            Bonus.referral_id == referral.id,
            Bonus.bonus_type == BonusType.REGULAR,
        ).limit(1)
    )
    bonus = bonus_result.scalars().first()

    # SLA: дедлайн направления = created_at + service.sla_days
    from datetime import timedelta as _td
    sla_days_val = int(getattr(service, "sla_days", 14) or 14) if service else 14
    sla_deadline_val = referral.created_at + _td(days=sla_days_val) if referral.created_at else None

    return ReferralResponse(
        id=referral.id,
        from_clinic_id=referral.from_clinic_id,
        to_clinic_id=referral.to_clinic_id,
        service_id=referral.service_id,
        patient_phone=referral.patient_phone,
        patient_name=referral.patient_name,
        mis_patient_id=referral.mis_patient_id,
        status=referral.status,
        patient_qr_code=referral.patient_qr_code,
        short_code=referral.short_code,
        qr_code=referral.qr_code,
        notes=referral.notes,
        cancel_reason=referral.cancel_reason,
        appointment_at=referral.appointment_at,
        created_at=referral.created_at,
        expires_at=referral.expires_at,
        confirmed_at=referral.confirmed_at,
        cancelled_at=referral.cancelled_at,
        from_clinic_name=from_clinic.name if from_clinic else None,
        to_clinic_name=to_clinic.name if to_clinic else None,
        service_name=service.name if service else None,
        bonus_amount=float(bonus.amount) if bonus else None,
        sla_days=sla_days_val,
        sla_deadline=sla_deadline_val,
    )
