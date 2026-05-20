import logging
import uuid
import random
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from app.models.referral import Referral, ReferralStatus
from app.models.bonus import Bonus, BonusType
from app.models.service import Service
from app.models.settings import SystemSettings
from app.services.qr_service import generate_qr_image_base64, generate_url_qr_base64
from app.core.security import verify_qr_signature, make_patient_token
from app.config import settings

logger = logging.getLogger(__name__)


async def _generate_short_code(db: AsyncSession) -> int:
    """Случайный 5-значный код, уникальный в таблице.

    Фикс #8 (audit Фаза 1): даже если SELECT не нашёл коллизию, между ним и
    INSERT может вклиниться другая транзакция и захватить тот же код. Защищаемся:
    1) Сначала SELECT — отсекает 99% случаев на пустом пространстве кодов.
    2) При commit/flush, если всё-таки получили IntegrityError на short_code —
       вызывающий код в create_referral поймает её, сгенерирует новый код и
       обновит referral.short_code. Здесь же мы лишь стараемся быстро дать
       свободный код.
    """
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
    service_id: uuid.UUID | None,
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
    referral_type: str = "service",
    target_doctor_id: uuid.UUID | None = None,
    lab_tests: str | None = None,
) -> Referral:
    # Если указан target_doctor — берём его mis_id для МИС-записи и тип=doctor
    if target_doctor_id and referral_type == "service":
        referral_type = "doctor"
    if referral_type == "doctor" and target_doctor_id and not mis_doctor_id:
        from sqlalchemy import select as _sel_doc
        from app.models.doctor import Doctor as _DocM
        _td = (await db.execute(_sel_doc(_DocM).where(_DocM.id == target_doctor_id))).scalar_one_or_none()
        if _td and getattr(_td, "mis_id", None):
            mis_doctor_id = _td.mis_id

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
        referral_type=referral_type,
        target_doctor_id=target_doctor_id,
        lab_tests=lab_tests,
    )
    db.add(referral)
    await db.flush()
    # ── Snapshot партнёрского payout для cross-clinic направлений ──────────
    is_external = bool(
        referral.from_clinic_id and referral.to_clinic_id
        and referral.from_clinic_id != referral.to_clinic_id
    )
    if is_external and referral.service_id:
        from app.models.partner_offer import PartnerServiceOffer as _Offer
        offer = (await db.execute(
            select(_Offer).where(
                _Offer.clinic_id == referral.to_clinic_id,
                _Offer.service_id == referral.service_id,
                _Offer.is_active.is_(True),
            )
        )).scalar_one_or_none()
        if not offer:
            raise ValueError("Услуга не входит в партнёрский прайс этой клиники")
        referral.partner_offer_id = offer.id
        referral.bonus_snapshot_amount = offer.payout_amount
    # QR для администратора (подтверждение по скану)
    referral.qr_code = generate_qr_image_base64(str(referral.id))
    # ── Короткий 5-значный код: фикс #8 ───────────────────────────────────
    # Если параллельно создаётся два направления и оба угадали один код,
    # commit упадёт с IntegrityError на UNIQUE(short_code). Делаем до 5
    # повторов: каждый раз rollback partial → новая попытка.
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
    _commit_attempts = 0
    while True:
        try:
            await db.commit()
            break
        except IntegrityError as ie:
            await db.rollback()
            _commit_attempts += 1
            if _commit_attempts >= 5:
                raise
            # Перечитываем referral, ставим новый short_code и пробуем снова.
            r2 = (await db.execute(select(Referral).where(Referral.id == referral.id))).scalar_one_or_none()
            if not r2:
                raise ie
            referral = r2
            referral.short_code = await _generate_short_code(db)
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


# ── Per-tenant settings helper ─────────────────────────────────────────────
# Фикс #5: глобальные настройки commission_*/platform_fee_floor разваливают
# изоляцию тенантов. Все вызовы внутри _apply_confirmation/_finalize_bonus
# теперь читают через app.services.settings_service.get_setting с tenant_id.
async def _get_setting(db: AsyncSession, key: str, default: str = "", tenant_id=None) -> str:
    """Совместимый враппер: при tenant_id берёт из tenant-scoped настроек."""
    from app.services.settings_service import get_setting
    return await get_setting(db, key, default, tenant_id=tenant_id)


async def _apply_confirmation(
    db: AsyncSession,
    referral: Referral,
    confirmed_by_admin_id: uuid.UUID | None,
) -> Referral:
    """Общая логика: проверка статуса, подтверждение, начисление бонуса.

    Фикс #1 (audit Фаза 1) — race condition двойного бонуса:
    Берём referral под FOR UPDATE и перечитываем статус из БД. Если уже
    CONFIRMED — выходим как успех (idempotent), без повторных начислений.
    """
    # ── PG advisory_xact_lock: гарантия сериализации даже под asyncio.gather ──
    # FOR UPDATE сам по себе блокирует строку, но в asyncpg/SQLAlchemy при
    # concurrent двух регистраторов одновременно lock может не сериализовать.
    # Advisory lock — PostgreSQL-level mutex, освобождается при COMMIT/ROLLBACK.
    from sqlalchemy import text as _text_lock
    await db.execute(
        _text_lock("SELECT pg_advisory_xact_lock(hashtext(:rid))"),
        {"rid": str(referral.id)}
    )
    # ── FOR UPDATE: блокируем строку до конца транзакции ─────────────────
    locked_q = await db.execute(
        select(Referral).where(Referral.id == referral.id).with_for_update()
    )
    locked = locked_q.scalar_one_or_none()
    if locked is None:
        raise ValueError("Направление не найдено")
    referral = locked

    # Идемпотентный выход — если уже подтверждено, просто возвращаем referral.
    if referral.status == ReferralStatus.CONFIRMED:
        return referral
    if referral.status == ReferralStatus.EXPIRED or (referral.expires_at and referral.expires_at < datetime.utcnow()):
        referral.status = ReferralStatus.EXPIRED
        await db.commit()
        raise ValueError("Направление истекло")
    if referral.status not in (ReferralStatus.CREATED,):
        raise ValueError("Нельзя подтвердить направление в текущем статусе")

    referral.status = ReferralStatus.CONFIRMED
    referral.confirmed_at = datetime.utcnow()
    referral.confirmed_by_admin_id = confirmed_by_admin_id

    # Делегируем расчёт + запись Bonus/RecruiterBonus/ICI/BillingLedger
    # в общий helper _finalize_bonus_and_ledger.
    await _finalize_bonus_and_ledger(db, referral, confirmed_by_admin_id=confirmed_by_admin_id)

    # Глава 8: начисление баллов лояльности (+100) пациенту за приведённого
    try:
        from app.services import loyalty_ext_service as _ls
        await _ls.award_referral(db, referral.tenant_id, referral.patient_phone, referral.id)
    except Exception:
        pass

    await db.commit()
    await db.refresh(referral)

    # ── МИС-синхронизация при подтверждении (fire-and-forget) ──
    try:
        from app.services.mis_client import (
            _post as _mis_post2,
            find_patient_by_phone as _mis_find2,
            add_patient as _mis_add,
        )
        from app.services.settings_service import get_setting as _get_s2
        _api_url2 = await _get_s2(db, "mis_api_url", "", tenant_id=referral.tenant_id) if referral.tenant_id else ""
        _api_key2 = await _get_s2(db, "mis_api_key", "", tenant_id=referral.tenant_id) if referral.tenant_id else ""

        if not referral.mis_patient_id and referral.patient_phone:
            try:
                _pt = await _mis_find2(referral.patient_phone, api_url=_api_url2, api_key=_api_key2)
                if _pt:
                    referral.mis_patient_id = _pt.get("patient_id") or _pt.get("id")
                else:
                    # Резолвим mis_id принимающей клиники — Renovatio может
                    # привязать создаваемого пациента к ней (если поддерживает).
                    _mis_clinic_id_for_add: int | None = None
                    if referral.to_clinic_id:
                        from app.models.clinic import Clinic as _ClinicAdd
                        _tcl = (await db.execute(
                            select(_ClinicAdd).where(_ClinicAdd.id == referral.to_clinic_id)
                        )).scalar_one_or_none()
                        if _tcl and _tcl.mis_id:
                            _mis_clinic_id_for_add = int(_tcl.mis_id)
                    _new = await _mis_add(
                        referral.patient_phone,
                        full_name=referral.patient_name or "",
                        api_url=_api_url2,
                        api_key=_api_key2,
                        clinic_id=_mis_clinic_id_for_add,
                    )
                    if _new and _new.get("patient_id"):
                        referral.mis_patient_id = int(_new["patient_id"])
                        logger.info("МИС: создан пациент %s для referral=%s", referral.mis_patient_id, referral.id)
                if referral.mis_patient_id:
                    await db.commit()
            except Exception:
                logger.exception("МИС auto-onboard не удался для referral_id=%s", referral.id)

        if referral.mis_appointment_id:
            await _mis_post2("confirmAppointment",
                api_url=_api_url2, api_key=_api_key2,
                appointment_id=referral.mis_appointment_id,
            )
    except Exception:
        logger.exception("Не удалось подтвердить запись в МИС для referral_id=%s mis_appointment_id=%s", referral.id, referral.mis_appointment_id)

    return referral


# ── Общий helper расчёта и записи финансов (фикс #6) ───────────────────────
# Используется и в _apply_confirmation (ручное подтверждение по QR/short-code),
# и в auto_confirm._confirm (автоматическое подтверждение по МИС). Делает:
#   1. Подсчёт payout_amount/bonus_total с учётом referral_type=service|doctor.
#   2. Создание Bonus(REGULAR) + опционально Bonus(COMMISSION).
#   3. Запись Ledger BONUS_ACCRUED.
#   4. Создание RecruiterBonus при наличии рекрутера.
#   5. Авто-создание InterClinicInvoice для cross-clinic направлений.
#   6. Запись platform_fee в BillingLedger (для франшизного биллинга).
async def _finalize_bonus_and_ledger(
    db: AsyncSession,
    referral: Referral,
    *,
    confirmed_by_admin_id: uuid.UUID | None,
) -> None:
    """Все денежные эффекты подтверждения направления — в одном месте."""
    # ── Guard: бонус только за наружные направления ────────────────────────
    is_external = bool(
        referral.from_clinic_id and referral.to_clinic_id
        and referral.from_clinic_id != referral.to_clinic_id
    )
    if not is_external:
        return  # внутреннее направление — Bonus / ICI / RecruiterBonus не создаём
    from decimal import Decimal as _D

    # Сервис (если type=service)
    svc_result = await db.execute(select(Service).where(Service.id == referral.service_id)) if referral.service_id else None
    service = svc_result.scalar_one_or_none() if svc_result else None

    payout_amount = 0.0
    bonus_total = 0.0    # полный пирог (для doctor-flow и каскада)
    use_cascade = False  # каскадная модель (платформа удерживает floor)

    rtype = (getattr(referral, "referral_type", None) or "service").lower()
    if rtype == "doctor" and getattr(referral, "target_doctor_id", None):
        from app.models.doctor import Doctor as _DocM
        td = (await db.execute(select(_DocM).where(_DocM.id == referral.target_doctor_id))).scalar_one_or_none()
        if td and (td.referral_bonus_type or "none") != "none":
            if td.referral_bonus_type == "fixed" and td.referral_bonus_amount:
                bonus_total = float(td.referral_bonus_amount)
            elif td.referral_bonus_type == "percent" and td.referral_bonus_percent and td.visit_price:
                bonus_total = float(td.visit_price) * float(td.referral_bonus_percent) / 100.0
        if bonus_total > 0:
            try:
                # Фикс #5: per-tenant settings.
                fee_floor_str = await _get_setting(db, "platform_fee_floor", "100", tenant_id=referral.tenant_id)
                fee_floor = float(fee_floor_str) if fee_floor_str else 100.0
            except Exception:
                fee_floor = 100.0
            intermediate = max(bonus_total - fee_floor, 0.0)
            payout_amount = intermediate
            use_cascade = True
    elif service is not None:
        # Приоритет — snapshot из partner_service_offer (записан при create_referral).
        # Это гарантирует иммутабельность: изменение payout оффера задним числом
        # не меняет уже созданные направления.
        if referral.bonus_snapshot_amount is not None:
            payout_amount = float(referral.bonus_snapshot_amount)
        elif service.referral_payout is not None:
            # Legacy fallback (направления, созданные до partner_offers).
            payout_amount = float(service.referral_payout)
        else:
            payout_amount = float(service.bonus_amount or 0)

    if (service or use_cascade) and payout_amount > 0:
        full_amount = payout_amount

        # Каскад: автор привлечён рекрутом — вычитаем долю рекрутера из бонуса автора.
        cascade_recruiter_cut = 0.0
        if use_cascade:
            try:
                from app.models.user import User as _UserM
                _author = (await db.execute(
                    select(_UserM).where(_UserM.id == referral.created_by_admin_id)
                )).scalar_one_or_none()
                if _author and _author.recruiter_id:
                    _recr = (await db.execute(
                        select(_UserM).where(_UserM.id == _author.recruiter_id)
                    )).scalar_one_or_none()
                    if _recr and _recr.bonus_percent:
                        cascade_recruiter_cut = round(
                            full_amount * float(_recr.bonus_percent) / 100.0, 2
                        )
            except Exception:
                cascade_recruiter_cut = 0.0
            full_amount = max(full_amount - cascade_recruiter_cut, 0.0)

        applied_commission = False

        # Фикс #5: per-tenant settings.
        commission_enabled = (await _get_setting(db, "commission_enabled", "false", tenant_id=referral.tenant_id)) == "true"
        if commission_enabled:
            rate = float(await _get_setting(db, "commission_rate", "10", tenant_id=referral.tenant_id))
            receiver_id_str = await _get_setting(db, "commission_receiver_id", "", tenant_id=referral.tenant_id)
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
                        tenant_id=referral.tenant_id,
                    ))
                    db.add(Bonus(
                        admin_id=receiver_uuid,
                        referral_id=referral.id,
                        bonus_type=BonusType.COMMISSION,
                        amount=commission_amount,
                        tenant_id=referral.tenant_id,
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
                tenant_id=referral.tenant_id,
            ))

    # Записываем начисление в финансовый реестр
    await db.flush()  # чтобы бонусы получили id
    try:
        from app.services.ledger_service import add_entry, OpType
        bonuses_result = await db.execute(
            select(Bonus).where(Bonus.referral_id == referral.id)
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
                    if use_cascade and cascade_recruiter_cut > 0:
                        rec_amount = cascade_recruiter_cut
                    else:
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

    # Авто-создание межклиничного счёта при cross-clinic.
    is_cross_clinic = (
        service
        and payout_amount > 0
        and referral.from_clinic_id
        and referral.to_clinic_id
        and referral.from_clinic_id != referral.to_clinic_id
    )
    try:
        if is_cross_clinic:
            from app.services.inter_clinic_invoice_service import auto_create_from_referral
            from app.models.clinic import Clinic as _Clinic2
            _fc = await db.execute(select(_Clinic2).where(_Clinic2.id == referral.from_clinic_id))
            _from_clinic = _fc.scalar_one_or_none()
            _tc = await db.execute(select(_Clinic2).where(_Clinic2.id == referral.to_clinic_id))
            _to_clinic = _tc.scalar_one_or_none()
            invoice = await auto_create_from_referral(
                db,
                referral_id=referral.id,
                from_clinic_id=referral.from_clinic_id,
                from_tenant_id=_from_clinic.tenant_id if _from_clinic else referral.tenant_id,
                to_clinic_id=referral.to_clinic_id,
                to_tenant_id=_to_clinic.tenant_id if _to_clinic else None,
                bonus_amount=payout_amount,
                service_name=service.name if hasattr(service, 'name') else None,
                created_by_id=referral.created_by_admin_id,
            )
            try:
                from app.services import audit_service
                await audit_service.write_safe(
                    db,
                    "interclinic_invoice.created",
                    actor_id=confirmed_by_admin_id,
                    tenant_id=referral.tenant_id,
                    entity_type="inter_clinic_invoice",
                    entity_id=invoice.id if invoice else None,
                    after={
                        "referral_id": str(referral.id),
                        "amount": payout_amount,
                        "from_clinic_id": str(referral.from_clinic_id),
                        "to_clinic_id": str(referral.to_clinic_id),
                    },
                )
            except Exception:
                logger.exception("Не удалось записать аудит interclinic_invoice.created")
    except Exception:
        logger.exception("Не удалось создать межклиничный счёт для referral_id=%s from=%s to=%s", referral.id, referral.from_clinic_id, referral.to_clinic_id)

    # ── Накопление platform_fee для франшизного биллинга ──────────────────
    try:
        if (service or use_cascade) and payout_amount > 0:
            from app.models.franchise import Franchise
            from app.models.tenant import Tenant
            from app.models.billing_ledger import BillingLedger

            author_bonus_q = await db.execute(
                select(Bonus).where(
                    Bonus.referral_id == referral.id,
                    Bonus.admin_id == referral.created_by_admin_id,
                )
            )
            anchor_bonus = author_bonus_q.scalar_one_or_none()

            if anchor_bonus and referral.tenant_id:
                tenant_q = await db.execute(select(Tenant).where(Tenant.id == referral.tenant_id))
                tenant = tenant_q.scalar_one_or_none()
                franchise_fee = _D("0")
                if tenant and tenant.franchise_id:
                    fr_q = await db.execute(select(Franchise).where(Franchise.id == tenant.franchise_id))
                    fr = fr_q.scalar_one_or_none()
                    if fr:
                        franchise_fee = _D(str(fr.platform_fee_per_bonus or 0))

                # Фикс #11: max(spread, franchise_fee, 0) — защита от отрицательного значения.
                if use_cascade and bonus_total > 0:
                    try:
                        from app.models.recruiter_bonus import RecruiterBonus as _RB
                        rb = (await db.execute(
                            select(_RB).where(_RB.referral_id == referral.id)
                        )).scalar_one_or_none()
                        rcut = float(rb.amount) if rb else 0.0
                    except Exception:
                        rcut = 0.0
                    spread = _D(str(bonus_total - payout_amount - rcut))
                    effective_fee = max(spread, franchise_fee, _D("0"))
                else:
                    spread = _D("0")
                    if service and service.price is not None:
                        spread = _D(str(service.price)) - _D(str(payout_amount))
                    effective_fee = max(spread, franchise_fee, _D("0"))

                if effective_fee > 0:
                    _service_id_str = str(service.id) if service else None
                    _service_price = float(service.price) if (service and service.price is not None) else None
                    entry = BillingLedger(
                        tenant_id=referral.tenant_id,
                        clinic_id=referral.from_clinic_id,
                        entry_type="platform_fee_per_bonus",
                        direction="debit",
                        amount=effective_fee,
                        currency="RUB",
                        reference_type="bonus",
                        reference_id=anchor_bonus.id,
                        description=(
                            f"Комиссия платформы за направление #{str(referral.id)[:8]} "
                            + (f"(тип=doctor, bonus_total={bonus_total})" if use_cascade
                               else f"(price={_service_price}, payout={payout_amount})")
                        ),
                        meta={
                            "referral_id": str(referral.id),
                            "service_id": _service_id_str,
                            "price": _service_price,
                            "referral_payout": payout_amount,
                            "franchise_fee_floor": float(franchise_fee),
                            "cascade": bool(use_cascade),
                            "bonus_total": float(bonus_total) if use_cascade else None,
                        },
                    )
                    db.add(entry)
                    await db.flush()
    except Exception:
        logger.exception("Не удалось записать platform_fee_per_bonus для referral_id=%s", referral.id)


async def confirm_referral(
    db: AsyncSession,
    qr_string: str,
    confirmed_by_admin_id: uuid.UUID | None = None,
    confirming_user_tenant_id: uuid.UUID | None = None,
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
    # Tenant isolation: super_admin (confirming_user_tenant_id is None) пропускается;
    # обычный пользователь может подтвердить только направление своего тенанта.
    if confirming_user_tenant_id is not None and referral.tenant_id != confirming_user_tenant_id:
        raise ValueError("Направление не найдено")
    return await _apply_confirmation(db, referral, confirmed_by_admin_id)


async def confirm_referral_by_short_code(
    db: AsyncSession,
    short_code: int,
    confirmed_by_admin_id: uuid.UUID | None = None,
    confirming_user_tenant_id: uuid.UUID | None = None,
) -> Referral:
    """Подтвердить направление по 5-значному коду (альтернатива QR-сканированию)."""
    result = await db.execute(select(Referral).where(Referral.short_code == short_code))
    referral = result.scalar_one_or_none()
    if not referral:
        raise ValueError("Направление с таким кодом не найдено")
    # Tenant isolation
    if confirming_user_tenant_id is not None and referral.tenant_id != confirming_user_tenant_id:
        raise ValueError("Направление с таким кодом не найдено")
    return await _apply_confirmation(db, referral, confirmed_by_admin_id)
