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


from app.utils.phone import normalize_phone as _normalize_phone, mask_phone, mask_name


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
    """Подтверждение направлений конкретного тенанта по списку выполненных МИС-визитов.

    Фикс #6/#7 (audit Фаза 1): раньше _confirm не писал Ledger/ICI/BillingLedger/
    RecruiterBonus, и вдобавок использовал service.bonus_amount, тогда как ручной
    confirm применяет service.referral_payout. Это давало рассогласование сумм
    и недостающие финансовые записи. Теперь обе ветки используют общий
    referral_service._finalize_bonus_and_ledger.
    """
    from app.models.referral import Referral, ReferralStatus
    from sqlalchemy import select
    from app.services.referral_service import _finalize_bonus_and_ledger

    confirmed_count = 0
    if True:
        # Открытые направления только этого тенанта.
        # FOR UPDATE SKIP LOCKED — параллельные jobs не подтверждают одно и то же.
        result = await db.execute(
            select(Referral).where(
                Referral.status == ReferralStatus.CREATED,
                Referral.tenant_id == tenant.id,
            ).with_for_update(skip_locked=True)
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

        async def _confirm(referral: Referral):
            nonlocal confirmed_count
            if referral.status != ReferralStatus.CREATED:
                return  # уже подтверждено параллельно
            referral.status = ReferralStatus.CONFIRMED
            referral.confirmed_at = datetime.utcnow()
            # confirmed_by_admin_id = None (авто)

            # Делегируем все денежные эффекты shared helper'у — он умеет
            # service.referral_payout, doctor-каскад, Ledger, RecruiterBonus,
            # ICI и BillingLedger platform_fee. Per-tenant settings — внутри.
            try:
                await _finalize_bonus_and_ledger(db, referral, confirmed_by_admin_id=None)
            except Exception:
                logger.exception("auto_confirm: _finalize_bonus_and_ledger failed referral_id=%s", referral.id)

            confirmed_count += 1
            logger.info(f"Авто-подтверждение направления {referral.id} (пациент {mask_name(referral.patient_name)} {mask_phone(referral.patient_phone)})")

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
