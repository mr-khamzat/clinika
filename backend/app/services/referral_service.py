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
    tenant_id: uuid.UUID | None = None,
) -> Referral:
    referral = Referral(
        from_clinic_id=from_clinic_id,
        to_clinic_id=to_clinic_id,
        service_id=service_id,
        patient_phone=patient_phone,
        patient_name=patient_name,
        mis_patient_id=mis_patient_id,
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
    patient_url = f"{settings.mini_app_url}/p/{referral.id}?t={token}"
    referral.patient_qr_code = generate_url_qr_base64(patient_url)
    await db.commit()
    await db.refresh(referral)
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
                    pass

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
        pass

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
        pass

    await db.commit()
    await db.refresh(referral)
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
