import logging
import uuid
import random
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.referral import Referral, ReferralStatus
from app.models.bonus import Bonus, BonusType
from app.models.service import Service
from app.models.settings import SystemSettings
from app.services.qr_service import generate_qr_image_base64, generate_url_qr_base64
from app.core.security import verify_qr_signature, make_patient_token
from app.config import settings

logger = logging.getLogger(__name__)


async def _generate_short_code(db: AsyncSession) -> int:
    """Случайный 5-значный код, уникальный в таблице."""
    for _ in range(100):
        code = random.randint(10000, 99999)
        existing = await db.execute(select(Referral).where(Referral.short_code == code))
        if not existing.scalar_one_or_none():
            return code
    raise RuntimeError("Не удалось сгенерировать уникальный короткий код")


async def create_referral(
    db: AsyncSession,
    from_clinic_id: uuid.UUID,
    to_clinic_id: uuid.UUID,
    service_id: uuid.UUID,
    patient_phone: str,
    created_by_admin_id: uuid.UUID,
    notes: str | None = None,
    appointment_at: datetime | None = None,
    patient_name: str | None = None,
    mis_patient_id: int | None = None,
    mis_doctor_id: int | None = None,
    tenant_id: uuid.UUID | None = None,
    tenant_slug: str | None = None,
    base_url: str | None = None,
) -> Referral:
    referral = Referral(
        from_clinic_id=from_clinic_id,
        to_clinic_id=to_clinic_id,
        service_id=service_id,
        patient_phone=patient_phone,
        patient_name=patient_name,
        mis_patient_id=mis_patient_id,
        mis_doctor_id=mis_doctor_id,
        created_by_admin_id=created_by_admin_id,
        notes=notes,
        appointment_at=appointment_at,
        tenant_id=tenant_id,
    )
    db.add(referral)
    await db.flush()
    # QR для администратора (подтверждение по скану)
    referral.qr_code = generate_qr_image_base64(str(referral.id))
    # Короткий 5-значный код для пациентов без QR-сканера
    referral.short_code = await _generate_short_code(db)
    # QR для пациента (ссылка на личный кабинет)
    token = make_patient_token(str(referral.id), referral.patient_phone)
    _origin = (base_url or settings.mini_app_url).rstrip("/")
    _slug = tenant_slug or ""
    if _slug:
        patient_url = f"{_origin}/{_slug}/p/{referral.id}?t={token}"
    else:
        patient_url = f"{_origin}/p/{referral.id}?t={token}"
    referral.patient_qr_code = generate_url_qr_base64(patient_url)
    await db.commit()
    await db.refresh(referral)

    # Создаём запись в МИС (fire-and-forget, не прерывает создание направления)
    try:
        from sqlalchemy import select as _select
        from app.models.clinic import Clinic as _Clinic
        from app.services.mis_client import _post as _mis_post, find_patient_by_phone as _mis_find
        from app.services.settings_service import get_setting as _get_s
        _api_url = await _get_s(db, "mis_api_url", "", tenant_id=tenant_id) if tenant_id else ""
        _api_key = await _get_s(db, "mis_api_key", "", tenant_id=tenant_id) if tenant_id else ""
        # Найти пациента в МИС, если ещё не привязан
        if not referral.mis_patient_id:
            _pt = await _mis_find(patient_phone, api_url=_api_url, api_key=_api_key)
            if _pt:
                referral.mis_patient_id = _pt.get("patient_id")
                await db.commit()
        # Создать запись в расписании МИС
        if appointment_at and mis_doctor_id:
            _clinic_r = await db.execute(_select(_Clinic).where(_Clinic.id == to_clinic_id))
            _clinic = _clinic_r.scalar_one_or_none()
            if _clinic and _clinic.mis_id:
                from datetime import timedelta as _td
                _ts = appointment_at.strftime("%d.%m.%Y %H:%M")
                _te = (appointment_at + _td(minutes=30)).strftime("%d.%m.%Y %H:%M")
                _r = await _mis_post("createAppointment",
                    api_url=_api_url, api_key=_api_key,
                    mobile=patient_phone,
                    clinic_id=_clinic.mis_id,
                    doctor_id=mis_doctor_id,
                    time_start=_ts,
                    time_end=_te,
                )
                if _r.get("error") == 0 and _r.get("data"):
                    referral.mis_appointment_id = int(_r["data"])
                    await db.commit()
    except Exception:
        logger.exception("Не удалось создать запись в МИС для referral_id=%s phone=%s", referral.id, patient_phone)

    return referral


async def _get_setting(db: AsyncSession, key: str, default: str = "") -> str:
    result = await db.execute(select(SystemSettings).where(SystemSettings.key == key))
    row = result.scalar_one_or_none()
    return row.value if row else default


async def _apply_confirmation(
    db: AsyncSession,
    referral: Referral,
    confirmed_by_admin_id: uuid.UUID | None,
) -> Referral:
    """Общая логика: проверка статуса, подтверждение, начисление бонуса."""
    if referral.status == ReferralStatus.CONFIRMED:
        raise ValueError("Направление уже подтверждено")
    if referral.status == ReferralStatus.EXPIRED or referral.expires_at < datetime.utcnow():
        referral.status = ReferralStatus.EXPIRED
        await db.commit()
        raise ValueError("Направление истекло")
    if referral.status not in (ReferralStatus.CREATED,):
        raise ValueError("Нельзя подтвердить направление в текущем статусе")

    referral.status = ReferralStatus.CONFIRMED
    referral.confirmed_at = datetime.utcnow()
    referral.confirmed_by_admin_id = confirmed_by_admin_id

    # Бонус за услугу
    svc_result = await db.execute(select(Service).where(Service.id == referral.service_id))
    service = svc_result.scalar_one_or_none()

    if service and service.bonus_amount > 0:
        full_amount = float(service.bonus_amount)
        applied_commission = False

        commission_enabled = (await _get_setting(db, "commission_enabled", "false")) == "true"
        if commission_enabled:
            rate = float(await _get_setting(db, "commission_rate", "10"))
            receiver_id_str = await _get_setting(db, "commission_receiver_id", "")
            if receiver_id_str:
                try:
                    receiver_uuid = uuid.UUID(receiver_id_str)
                    commission_amount = round(full_amount * rate / 100, 2)
                    admin_amount = full_amount - commission_amount
                    db.add(Bonus(
                        admin_id=referral.created_by_admin_id,
                        referral_id=referral.id,
                        bonus_type=BonusType.REGULAR,
                        amount=admin_amount,
                    ))
                    db.add(Bonus(
                        admin_id=receiver_uuid,
                        referral_id=referral.id,
                        bonus_type=BonusType.COMMISSION,
                        amount=commission_amount,
                    ))
                    applied_commission = True
                except Exception:
                    logger.exception("Не удалось применить комиссию для referral_id=%s receiver_id=%s", referral.id, receiver_id_str)

        if not applied_commission:
            db.add(Bonus(
                admin_id=referral.created_by_admin_id,
                referral_id=referral.id,
                bonus_type=BonusType.REGULAR,
                amount=full_amount,
            ))

    # Записываем начисление в финансовый реестр
    await db.flush()  # чтобы бонусы получили id
    try:
        from app.services.ledger_service import add_entry, OpType
        bonuses_result = await db.execute(
            __import__('sqlalchemy', fromlist=['select']).select(Bonus)
            .where(Bonus.referral_id == referral.id)
        )
        new_bonuses = bonuses_result.scalars().all()
        for b in new_bonuses:
            await add_entry(
                db=db,
                user_id=b.admin_id,
                amount=float(b.amount),
                operation_type=OpType.BONUS_ACCRUED,
                reference_id=referral.id,
                reference_type='referral',
                description=f'Начисление по направлению #{str(referral.id)[:8]}',
            )
    except Exception:
        logger.exception("Не удалось записать ledger BONUS_ACCRUED для referral_id=%s", referral.id)

    # Начисление бонуса рекрутеру (если у автора направления есть рекрутер с %)
    try:
        from app.models.user import User as UserModel
        from app.models.recruiter_bonus import RecruiterBonus
        author_result = await db.execute(
            select(UserModel).where(UserModel.id == referral.created_by_admin_id)
        )
        author = author_result.scalar_one_or_none()
        if author and author.recruiter_id and author.bonus_percent:
            recruiter_result = await db.execute(
                select(UserModel).where(UserModel.id == author.recruiter_id)
            )
            recruiter = recruiter_result.scalar_one_or_none()
            if recruiter and recruiter.bonus_percent:
                # Базовый бонус автора направления
                author_bonus_result = await db.execute(
                    select(Bonus).where(
                        Bonus.referral_id == referral.id,
                        Bonus.admin_id == referral.created_by_admin_id,
                        Bonus.bonus_type == BonusType.REGULAR,
                    )
                )
                author_bonus = author_bonus_result.scalar_one_or_none()
                if author_bonus:
                    rec_percent = float(recruiter.bonus_percent)
                    rec_amount = round(float(author_bonus.amount) * rec_percent / 100, 2)
                    if rec_amount > 0:
                        rec_bonus = RecruiterBonus(
                            tenant_id=referral.tenant_id,
                            recruiter_id=recruiter.id,
                            doctor_id=author.id,
                            referral_id=referral.id,
                            source_bonus_id=author_bonus.id,
                            percent_applied=rec_percent,
                            amount=rec_amount,
                        )
                        db.add(rec_bonus)
                        await db.flush()
    except Exception:
        logger.exception("Не удалось начислить бонус рекрутеру для referral_id=%s author_id=%s", referral.id, referral.created_by_admin_id)

    # Автоматически создаём межклиничный счёт при начислении бонуса
    try:
        if service and service.bonus_amount > 0 and referral.from_clinic_id and referral.to_clinic_id and referral.from_clinic_id != referral.to_clinic_id:
            from app.services.inter_clinic_invoice_service import auto_create_from_referral
            from app.models.clinic import Clinic as _Clinic2
            _fc = await db.execute(select(_Clinic2).where(_Clinic2.id == referral.from_clinic_id))
            _from_clinic = _fc.scalar_one_or_none()
            _tc = await db.execute(select(_Clinic2).where(_Clinic2.id == referral.to_clinic_id))
            _to_clinic = _tc.scalar_one_or_none()
            await auto_create_from_referral(
                db,
                referral_id=referral.id,
                from_clinic_id=referral.from_clinic_id,
                from_tenant_id=_from_clinic.tenant_id if _from_clinic else referral.tenant_id,
                to_clinic_id=referral.to_clinic_id,
                to_tenant_id=_to_clinic.tenant_id if _to_clinic else None,
                bonus_amount=float(service.bonus_amount),
                service_name=service.name if hasattr(service, 'name') else None,
                created_by_id=referral.created_by_admin_id,
            )
    except Exception:
        logger.exception("Не удалось создать межклиничный счёт для referral_id=%s from=%s to=%s", referral.id, referral.from_clinic_id, referral.to_clinic_id)

    await db.commit()
    await db.refresh(referral)

    # Подтверждаем запись в МИС (fire-and-forget)
    try:
        if referral.mis_appointment_id:
            from app.services.mis_client import _post as _mis_post2
            from app.services.settings_service import get_setting as _get_s2
            _api_url2 = await _get_s2(db, "mis_api_url", "", tenant_id=referral.tenant_id) if referral.tenant_id else ""
            _api_key2 = await _get_s2(db, "mis_api_key", "", tenant_id=referral.tenant_id) if referral.tenant_id else ""
            await _mis_post2("confirmAppointment",
                api_url=_api_url2, api_key=_api_key2,
                appointment_id=referral.mis_appointment_id,
            )
    except Exception:
        logger.exception("Не удалось подтвердить запись в МИС для referral_id=%s mis_appointment_id=%s", referral.id, referral.mis_appointment_id)

    return referral


async def confirm_referral(
    db: AsyncSession,
    qr_string: str,
    confirmed_by_admin_id: uuid.UUID | None = None,
) -> Referral:
    from app.services.qr_service import parse_qr_data
    parsed = parse_qr_data(qr_string)
    if not parsed:
        raise ValueError("Неверный формат QR-кода")

    referral_id, signature = parsed
    if not verify_qr_signature(referral_id, signature):
        raise ValueError("Подпись QR-кода недействительна")

    result = await db.execute(
        select(Referral).where(Referral.id == uuid.UUID(referral_id))
    )
    referral = result.scalar_one_or_none()
    if not referral:
        raise ValueError("Направление не найдено")
    return await _apply_confirmation(db, referral, confirmed_by_admin_id)


async def confirm_referral_by_short_code(
    db: AsyncSession,
    short_code: int,
    confirmed_by_admin_id: uuid.UUID | None = None,
) -> Referral:
    """Подтвердить направление по 5-значному коду (альтернатива QR-сканированию)."""
    result = await db.execute(select(Referral).where(Referral.short_code == short_code))
    referral = result.scalar_one_or_none()
    if not referral:
        raise ValueError("Направление с таким кодом не найдено")
    return await _apply_confirmation(db, referral, confirmed_by_admin_id)
