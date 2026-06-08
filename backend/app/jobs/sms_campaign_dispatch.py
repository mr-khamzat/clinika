"""
Воркер отправки SMS-кампаний.

Запускается scheduler'ом раз в минуту. Алгоритм:
1. Поднимает scheduled-кампании, у которых scheduled_at <= now → переводит в sending.
2. Для каждой sending-кампании отправляет batch (LIMIT) сообщений.
3. Провайдер сейчас стаб (`internal`) — пишет в SmsMessageLog со status='sent'.
   Реальная интеграция (smsc.ru / smsaero / plivo) — отдельным модулем.
4. Когда обработаны все получатели — статус кампании = 'sent', finished_at=now.

ВНИМАНИЕ: реализация одиночная (LIMIT_PER_TICK = 100), без проверки timezone и
opt-out — это всё в следующих итерациях.
"""
import logging
from app.utils.phone import mask_phone
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger("sms_campaign_dispatch")

# Сколько сообщений обрабатываем за один тик scheduler'а
LIMIT_PER_TICK = 100
# Максимальное число получателей в одной кампании (синхронизировано с config_schema)
MAX_RECIPIENTS_PER_CAMPAIGN = 5000


def _render_template(body: str, ctx: dict) -> str:
    """Простая подстановка плейсхолдеров {{key}} → значения из ctx."""
    out = body
    for k, v in (ctx or {}).items():
        out = out.replace("{{" + str(k) + "}}", str(v) if v is not None else "")
    return out


async def _fetch_audience_phones(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    audience_type: str,
    audience_filter: dict | None,
    limit: int,
) -> list[str]:
    """
    Получить список телефонов для рассылки. Стаб-сегментация:
    - custom_phones — явно из audience_filter['phones']
    - остальные — distinct phone из appointments тенанта.
    """
    from app.models.doctor import Appointment

    if audience_type == "custom_phones":
        phones = (audience_filter or {}).get("phones") or []
        return list(phones)[:limit]

    # TODO(#2 PHI): аудитория рассылки строится из plaintext-телефонов.
    # После миграции для DISTINCT-набора получателей выбирать пары
    # (patient_phone_hash, patient_phone_encrypted) и расшифровывать номер
    # перед отправкой через encryption_service.decrypt — distinct по хэшу,
    # plaintext в БД не читаем.
    result = await db.execute(
        select(func.distinct(Appointment.patient_phone))
        .where(Appointment.tenant_id == tenant_id)
        .limit(limit)
    )
    return [r[0] for r in result.all() if r[0]]


async def _send_via_provider(
    phone: str, text: str
) -> tuple[bool, Optional[str], Optional[str]]:
    """
    Стаб-провайдер. Возвращает (ok, provider_message_id, error_message).
    Реальный провайдер (smsc.ru) подключается отдельным сервисом.
    """
    # Формат логирования удобен для отладки сегментации.
    logger.info(f"sms.stub → {mask_phone(phone)}: {text[:60]!r}")
    return True, uuid.uuid4().hex, None


async def _process_one_campaign(db: AsyncSession, camp) -> int:
    """
    Обработать один тик одной кампании. Возвращает количество отправленных
    сообщений за этот тик.
    """
    from app.models.sms_marketing import (
        SmsCampaign,
        SmsCampaignStatus,
        SmsMessageLog,
        SmsMessageStatus,
        SmsProvider,
        SmsTemplate,
    )

    # Загружаем шаблон
    tpl = (
        await db.execute(
            select(SmsTemplate).where(SmsTemplate.id == camp.template_id)
        )
    ).scalar_one_or_none()
    if not tpl:
        logger.warning(
            f"campaign {camp.id}: шаблон {camp.template_id} не найден, "
            f"переводим в failed"
        )
        camp.status = SmsCampaignStatus.FAILED
        camp.finished_at = datetime.utcnow()
        return 0

    # Сколько уже отправили
    already_sent = (
        await db.execute(
            select(func.count(SmsMessageLog.id)).where(
                SmsMessageLog.campaign_id == camp.id
            )
        )
    ).scalar() or 0

    # Сколько ещё отправить за этот тик
    remaining_total = max(
        0, min(camp.total_recipients or 0, MAX_RECIPIENTS_PER_CAMPAIGN) - already_sent
    )
    if remaining_total <= 0:
        # Нечего отправлять — финализируем.
        camp.status = SmsCampaignStatus.SENT
        camp.finished_at = datetime.utcnow()
        return 0

    batch_size = min(LIMIT_PER_TICK, remaining_total)

    # Берём телефоны: чтобы избежать дубликатов между тиками — пропускаем уже
    # обработанные (грубо: исключаем те, что уже в логах кампании).
    sent_phones_q = await db.execute(
        select(SmsMessageLog.patient_phone).where(
            SmsMessageLog.campaign_id == camp.id
        )
    )
    sent_phones = {r[0] for r in sent_phones_q.all()}

    # На стабе берём всех distinct и фильтруем уже отправленных.
    candidates = await _fetch_audience_phones(
        db,
        camp.tenant_id,
        camp.audience_type.value if hasattr(camp.audience_type, "value") else str(camp.audience_type),
        camp.audience_filter,
        limit=batch_size + len(sent_phones),
    )
    fresh_phones = [p for p in candidates if p not in sent_phones][:batch_size]

    if not fresh_phones:
        # Не нашли свежих — финализируем.
        camp.status = SmsCampaignStatus.SENT
        camp.finished_at = datetime.utcnow()
        return 0

    sent_count = 0
    failed_count = 0
    for phone in fresh_phones:
        ctx = {"patient_phone": phone, "date": datetime.utcnow().strftime("%d.%m.%Y")}
        text = _render_template(tpl.body, ctx)
        ok, pid, err = await _send_via_provider(phone, text)
        log_entry = SmsMessageLog(
            campaign_id=camp.id,
            patient_phone=phone,
            message_text=text,
            status=SmsMessageStatus.SENT if ok else SmsMessageStatus.FAILED,
            provider=SmsProvider.INTERNAL,
            provider_message_id=pid,
            error_message=err,
            sent_at=datetime.utcnow() if ok else None,
        )
        db.add(log_entry)
        if ok:
            sent_count += 1
        else:
            failed_count += 1

    camp.sent_count = (camp.sent_count or 0) + sent_count
    camp.failed_count = (camp.failed_count or 0) + failed_count

    # Если в этом тике обработали меньше batch_size — значит, аудитория исчерпана.
    if len(fresh_phones) < batch_size or (already_sent + len(fresh_phones)) >= remaining_total + already_sent:
        # Финализируем, если все плановые отправлены.
        if (already_sent + len(fresh_phones)) >= (camp.total_recipients or 0):
            camp.status = SmsCampaignStatus.SENT
            camp.finished_at = datetime.utcnow()

    return sent_count


async def run_sms_campaign_dispatch() -> int:
    """
    Главный entry-point job. Возвращает кол-во отправленных сообщений за тик.
    """
    from app.database import AsyncSessionLocal
    from app.models.sms_marketing import SmsCampaign, SmsCampaignStatus

    total_sent = 0
    try:
        async with AsyncSessionLocal() as db:
            now = datetime.utcnow()

            # 1. Активируем scheduled-кампании, у которых наступил час.
            await db.execute(
                update(SmsCampaign)
                .where(
                    SmsCampaign.status == SmsCampaignStatus.SCHEDULED,
                    SmsCampaign.scheduled_at <= now,
                )
                .values(status=SmsCampaignStatus.SENDING, started_at=now)
            )
            await db.commit()

            # 2. Берём все sending-кампании и отправляем по батчу каждой.
            sending = (
                await db.execute(
                    select(SmsCampaign).where(
                        SmsCampaign.status == SmsCampaignStatus.SENDING
                    )
                )
            ).scalars().all()

            for camp in sending:
                try:
                    sent = await _process_one_campaign(db, camp)
                    total_sent += sent
                    await db.commit()
                except Exception as e:
                    logger.exception(f"sms dispatch campaign {camp.id} fail: {e}")
                    await db.rollback()
    except Exception as e:
        logger.exception(f"run_sms_campaign_dispatch fatal: {e}")
    return total_sent
