"""
Авто-подтверждение направлений по данным МИС Renovatio.

Логика:
  Каждые 10 минут опрашиваем МИС за последние 2 часа.
  Для каждого выполненного визита ищем открытое направление (CREATED).
  Совпадение: mis_patient_id точно (приоритет) или phone+ФИО (нечёткое).
  При совпадении — направление переводим в CONFIRMED, начисляем бонус.
"""
import asyncio
import logging
from datetime import datetime, timedelta

logger = logging.getLogger("auto_confirm")

# Интервал опроса МИС
POLL_INTERVAL = 600  # 10 минут


from app.utils.phone import normalize_phone as _normalize_phone


def _normalize_name(name: str) -> str:
    return " ".join(name.strip().lower().split())


async def run_auto_confirm() -> int:
    """
    Один цикл автоподтверждения. Возвращает количество подтверждённых направлений.

    Архитектура (Волна 2.4): итерируемся по тенантам — у каждого свой mis_clinic_ids
    в Tenant.mis_clinic_ids (JSONB). Если у тенанта поле NULL — пропускаем,
    МИС не настроен.
    """
    from app.database import AsyncSessionLocal
    from app.models.tenant import Tenant
    from app.models.referral import Referral, ReferralStatus
    from app.models.service import Service
    from app.models.settings import SystemSettings
    from app.models.bonus import Bonus, BonusType
    from app.services.mis_client import get_appointments
    from app.services.settings_service import get_setting as _get_s
    from sqlalchemy import select

    now = datetime.utcnow()
    date_from = (now - timedelta(days=1)).strftime("%d.%m.%Y")
    date_to = now.strftime("%d.%m.%Y")

    confirmed_count = 0

    async with AsyncSessionLocal() as db:
        tenants = (await db.execute(
            select(Tenant).where(Tenant.is_active == True)
        )).scalars().all()

        if not tenants:
            return 0

        for tenant in tenants:
            tenant_clinic_ids = tenant.mis_clinic_ids or []
            if not tenant_clinic_ids:
                continue

            # MIS-настройки тенанта (если нет — пропустим этот тенант)
            try:
                tenant_api_url = await _get_s(db, "mis_api_url", "", tenant_id=tenant.id)
                tenant_api_key = await _get_s(db, "mis_api_key", "", tenant_id=tenant.id)
            except Exception:
                tenant_api_url, tenant_api_key = "", ""

            # Собираем выполненные визиты по клиникам тенанта
            appointments: list[dict] = []
            for clinic_id in tenant_clinic_ids:
                try:
                    items = await get_appointments(
                        int(clinic_id), date_from, date_to,
                        api_url=tenant_api_url, api_key=tenant_api_key,
                    )
                    appointments.extend(items)
                except Exception as e:
                    logger.warning(f"Тенант {tenant.slug} МИС клиника {clinic_id}: ошибка — {e}")

            if not appointments:
                continue

            done = [
                a for a in appointments
                if str(a.get("status_id")) == "4"
                or str(a.get("status", "")).lower() in ("выполнено", "завершено", "completed")
            ]
            if not done:
                continue

            tenant_confirmed = await _process_tenant_confirmations(db, tenant, done)
            confirmed_count += tenant_confirmed

    return confirmed_count


async def _process_tenant_confirmations(db, tenant, done: list[dict]) -> int:
    """Подтверждение направлений конкретного тенанта по списку выполненных МИС-визитов."""
    from app.models.referral import Referral, ReferralStatus
    from app.models.service import Service
    from app.models.settings import SystemSettings
    from app.models.bonus import Bonus, BonusType
    from sqlalchemy import select

    confirmed_count = 0
    if True:
        # Открытые направления только этого тенанта
        result = await db.execute(
            select(Referral).where(
                Referral.status == ReferralStatus.CREATED,
                Referral.tenant_id == tenant.id,
            )
        )
        open_referrals: list[Referral] = list(result.scalars().all())

        if not open_referrals:
            return 0

        # Строим индексы для быстрого поиска
        by_patient_id: dict[int, list[Referral]] = {}
        by_phone: dict[str, list[Referral]] = {}
        for ref in open_referrals:
            if ref.mis_patient_id:
                by_patient_id.setdefault(ref.mis_patient_id, []).append(ref)
            phone_norm = _normalize_phone(ref.patient_phone)
            by_phone.setdefault(phone_norm, []).append(ref)

        # Настройки комиссии (читаем один раз)
        def _get_setting_sync(rows: dict, key: str, default: str = "") -> str:
            return rows.get(key, default)

        settings_rows = {}
        settings_result = await db.execute(select(SystemSettings))
        for row in settings_result.scalars().all():
            settings_rows[row.key] = row.value

        async def _confirm(referral: Referral):
            nonlocal confirmed_count
            if referral.status != ReferralStatus.CREATED:
                return  # уже подтверждено параллельно
            referral.status = ReferralStatus.CONFIRMED
            referral.confirmed_at = datetime.utcnow()
            # confirmed_by_admin_id = None (авто)

            svc_result = await db.execute(select(Service).where(Service.id == referral.service_id))
            service = svc_result.scalar_one_or_none()

            if service and service.bonus_amount > 0:
                full_amount = float(service.bonus_amount)
                applied_commission = False
                commission_enabled = _get_setting_sync(settings_rows, "commission_enabled") == "true"
                if commission_enabled:
                    rate = float(_get_setting_sync(settings_rows, "commission_rate", "10"))
                    receiver_id_str = _get_setting_sync(settings_rows, "commission_receiver_id", "")
                    if receiver_id_str:
                        try:
                            import uuid
                            receiver_uuid = uuid.UUID(receiver_id_str)
                            commission_amount = round(full_amount * rate / 100, 2)
                            admin_amount = full_amount - commission_amount  # без повторного округления
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
                            logger.exception("Не удалось применить комиссию (auto-confirm) для referral_id=%s receiver_id=%s", referral.id, receiver_id_str)
                if not applied_commission:
                    db.add(Bonus(
                        admin_id=referral.created_by_admin_id,
                        referral_id=referral.id,
                        bonus_type=BonusType.REGULAR,
                        amount=full_amount,
                    ))

            confirmed_count += 1
            logger.info(f"Авто-подтверждение направления {referral.id} (пациент {referral.patient_name or referral.patient_phone})")

        matched_ref_ids: set = set()

        for appt in done:
            # Уровень 1: точное совпадение по mis_patient_id
            pid = appt.get("patient_id")
            if pid and int(pid) in by_patient_id:
                for ref in by_patient_id[int(pid)]:
                    if ref.id not in matched_ref_ids:
                        matched_ref_ids.add(ref.id)
                        await _confirm(ref)
                        break
                continue

            # Уровень 2: совпадение по телефону + ФИО (нечёткое)
            appt_phone = _normalize_phone(str(appt.get("mobile", "") or appt.get("phone", "") or ""))
            if appt_phone and appt_phone in by_phone:
                appt_name = _normalize_name(
                    " ".join(filter(None, [
                        appt.get("last_name"), appt.get("first_name"), appt.get("third_name")
                    ]))
                )
                for ref in by_phone[appt_phone]:
                    if ref.id in matched_ref_ids:
                        continue
                    if ref.patient_name:
                        ref_name = _normalize_name(ref.patient_name)
                        # Имена должны совпадать хотя бы на 2 слова
                        ref_words = set(ref_name.split())
                        appt_words = set(appt_name.split())
                        if len(ref_words & appt_words) >= 2:
                            matched_ref_ids.add(ref.id)
                            await _confirm(ref)
                            break
                    else:
                        # Нет имени в направлении — подтверждаем только по телефону
                        matched_ref_ids.add(ref.id)
                        await _confirm(ref)
                        break

        if confirmed_count > 0:
            await db.commit()

    return confirmed_count


async def auto_confirm_loop():
    """Фоновая задача: запускается раз в POLL_INTERVAL секунд."""
    await asyncio.sleep(60)  # Даём бэкенду 60 сек на старт
    while True:
        try:
            count = await run_auto_confirm()
            if count:
                logger.info(f"Авто-подтверждение: подтверждено {count} направлений")
        except Exception as e:
            logger.error(f"Ошибка авто-подтверждения: {e}", exc_info=True)
        await asyncio.sleep(POLL_INTERVAL)
