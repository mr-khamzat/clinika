"""
Module Monitoring Service — health-checks для платных модулей.

Архитектура:
  1) Адаптер на каждый модуль — функция `check_<key>(db, tenant_id) -> dict`
     возвращает {status, message, metrics}. Логика домен-специфичная.
  2) `run_health_checks_for_tenant(db, tenant_id)` — обходит все active
     подписки тенанта и сохраняет/обновляет ModuleHealthCheck.
  3) `run_health_checks_all_tenants(db)` — для всех active tenants. Cron 30 мин.
  4) `send_alert(...)` — Telegram админу при переходе ok→error (дедуп 1 час).

Принципы:
  - Адаптер НЕ должен падать наружу: try/except → status=error внутри.
  - 0 событий за 7 дней при активной подписке = idle (не error).
  - Реальные ошибки (исключения) = error; warnings = degraded.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta
from typing import Awaitable, Callable

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.commercial import ModuleStatus, TenantModuleSubscription
from app.models.module_health import ModuleHealthCheck, ModuleHealthStatus
from app.models.tenant import Tenant

log = logging.getLogger("module_health_service")

# Если за этот период не было событий — считаем idle (informational, не error)
IDLE_THRESHOLD_DAYS = 7
# Дедуп Telegram-алертов: один и тот же (tenant, module) — не чаще 1 раза в час
ALERT_COOLDOWN_HOURS = 1


# ─── Утилиты ──────────────────────────────────────────────────────────────────

def _ok(message: str = "OK", metrics: dict | None = None) -> dict:
    return {"status": ModuleHealthStatus.OK.value, "message": message,
            "metrics": metrics or {}}


def _idle(message: str = "Не используется", metrics: dict | None = None) -> dict:
    return {"status": ModuleHealthStatus.IDLE.value, "message": message,
            "metrics": metrics or {}}


def _degraded(message: str, metrics: dict | None = None) -> dict:
    return {"status": ModuleHealthStatus.DEGRADED.value, "message": message,
            "metrics": metrics or {}}


def _error(message: str, metrics: dict | None = None) -> dict:
    return {"status": ModuleHealthStatus.ERROR.value, "message": message,
            "metrics": metrics or {}}


def _unknown(message: str = "Адаптер не реализован",
             metrics: dict | None = None) -> dict:
    return {"status": ModuleHealthStatus.UNKNOWN.value, "message": message,
            "metrics": metrics or {}}


def _cutoff(days: int = IDLE_THRESHOLD_DAYS) -> datetime:
    return datetime.utcnow() - timedelta(days=days)


# ─── Адаптеры на конкретные модули ───────────────────────────────────────────

async def check_telemedicine(db: AsyncSession, tenant_id: uuid.UUID) -> dict:
    """Telemedicine — count активных сессий за 7 дней."""
    try:
        from app.models.telemedicine import (
            TelemedicineSession,
            TelemedicineSessionStatus,
        )
        cutoff = _cutoff()
        total = (await db.execute(
            select(func.count(TelemedicineSession.id))
            .where(TelemedicineSession.tenant_id == tenant_id)
            .where(TelemedicineSession.created_at >= cutoff)
        )).scalar() or 0
        ended = (await db.execute(
            select(func.count(TelemedicineSession.id))
            .where(TelemedicineSession.tenant_id == tenant_id)
            .where(TelemedicineSession.created_at >= cutoff)
            .where(TelemedicineSession.status == TelemedicineSessionStatus.ENDED)
        )).scalar() or 0
        last_at = (await db.execute(
            select(func.max(TelemedicineSession.started_at))
            .where(TelemedicineSession.tenant_id == tenant_id)
        )).scalar()
        metrics = {"sessions_7d": int(total), "ended_7d": int(ended),
                   "last_started_at": last_at.isoformat() if last_at else None}
        if total == 0:
            return _idle("Нет сессий за 7 дней", metrics)
        return _ok(f"{total} сессий за 7 дней (завершено {ended})", metrics)
    except Exception as e:
        return _error(f"Сбой проверки telemedicine: {e}")


async def _check_ads_common(db: AsyncSession, tenant_id: uuid.UUID,
                            label: str) -> dict:
    """Общий чек для ads_basic / ads_agency."""
    try:
        from app.models.advertising import Ad, AdEvent, AdEventType, AdStatus
        active = (await db.execute(
            select(func.count(Ad.id))
            .where(Ad.tenant_id == tenant_id)
            .where(Ad.status == AdStatus.ACTIVE)
        )).scalar() or 0
        cutoff_24h = datetime.utcnow() - timedelta(hours=24)
        impressions_24h = (await db.execute(
            select(func.count(AdEvent.id))
            .join(Ad, Ad.id == AdEvent.ad_id)
            .where(Ad.tenant_id == tenant_id)
            .where(AdEvent.event_type == AdEventType.IMPRESSION)
            .where(AdEvent.created_at >= cutoff_24h)
        )).scalar() or 0
        last_at = (await db.execute(
            select(func.max(Ad.last_impression_at))
            .where(Ad.tenant_id == tenant_id)
        )).scalar()
        metrics = {"active_ads": int(active),
                   "impressions_24h": int(impressions_24h),
                   "last_impression_at": last_at.isoformat() if last_at else None}
        if active == 0 and impressions_24h == 0:
            return _idle(f"{label}: нет активных объявлений", metrics)
        if active > 0 and impressions_24h == 0 and last_at and \
                (datetime.utcnow() - last_at).days >= 3:
            return _degraded(f"{label}: 0 показов за 24ч при {active} активных",
                             metrics)
        return _ok(f"{label}: {active} активных, {impressions_24h} показов 24ч",
                   metrics)
    except Exception as e:
        return _error(f"Сбой проверки ads: {e}")


async def check_ads_basic(db: AsyncSession, tenant_id: uuid.UUID) -> dict:
    return await _check_ads_common(db, tenant_id, "ads_basic")


async def check_ads_agency(db: AsyncSession, tenant_id: uuid.UUID) -> dict:
    return await _check_ads_common(db, tenant_id, "ads_agency")


async def check_inventory(db: AsyncSession, tenant_id: uuid.UUID) -> dict:
    """Inventory: count items + low_stock alerts."""
    try:
        from decimal import Decimal
        from app.models.inventory import InventoryItem, InventoryStock
        items = (await db.execute(
            select(func.count(InventoryItem.id))
            .where(InventoryItem.tenant_id == tenant_id)
            .where(InventoryItem.is_active.is_(True))
        )).scalar() or 0
        # low-stock = sum(quantity) по всем партиям ниже порога
        low_stock_rows = (await db.execute(
            select(InventoryItem.id, InventoryItem.min_stock_threshold,
                   func.coalesce(func.sum(InventoryStock.quantity), 0).label("qty"))
            .select_from(InventoryItem)
            .outerjoin(InventoryStock,
                       InventoryStock.item_id == InventoryItem.id)
            .where(InventoryItem.tenant_id == tenant_id)
            .where(InventoryItem.is_active.is_(True))
            .group_by(InventoryItem.id, InventoryItem.min_stock_threshold)
        )).all()
        low_count = sum(
            1 for r in low_stock_rows
            if (r.min_stock_threshold or Decimal("0")) > Decimal("0")
            and Decimal(str(r.qty)) < (r.min_stock_threshold or Decimal("0"))
        )
        metrics = {"items": int(items), "low_stock_alerts": int(low_count)}
        if items == 0:
            return _idle("Нет позиций каталога", metrics)
        if low_count > 0:
            return _degraded(f"{low_count} позиций ниже порога остатка", metrics)
        return _ok(f"{items} позиций, остатки в норме", metrics)
    except Exception as e:
        return _error(f"Сбой проверки inventory: {e}")


async def check_loyalty_pro(db: AsyncSession, tenant_id: uuid.UUID) -> dict:
    """Loyalty: count аккаунтов с балансом."""
    try:
        from decimal import Decimal
        from app.models.loyalty import LoyaltyAccount
        total = (await db.execute(
            select(func.count(LoyaltyAccount.id))
            .where(LoyaltyAccount.tenant_id == tenant_id)
        )).scalar() or 0
        with_balance = (await db.execute(
            select(func.count(LoyaltyAccount.id))
            .where(LoyaltyAccount.tenant_id == tenant_id)
            .where(LoyaltyAccount.points_balance > 0)
        )).scalar() or 0
        metrics = {"accounts_total": int(total),
                   "accounts_with_balance": int(with_balance)}
        if total == 0:
            return _idle("Нет loyalty-аккаунтов", metrics)
        return _ok(f"{total} аккаунтов, {with_balance} с балансом", metrics)
    except Exception as e:
        return _error(f"Сбой проверки loyalty_pro: {e}")


async def check_mis_sync(db: AsyncSession, tenant_id: uuid.UUID) -> dict:
    """MIS Sync: last_tested_at + test_status интеграции."""
    try:
        from app.models.commercial import TenantIntegration
        rows = (await db.execute(
            select(TenantIntegration)
            .where(TenantIntegration.tenant_id == tenant_id)
            .where(TenantIntegration.is_active.is_(True))
        )).scalars().all()
        if not rows:
            return _idle("Интеграции не настроены")
        last_tested = max((r.last_tested_at for r in rows if r.last_tested_at),
                          default=None)
        errored = [r for r in rows if (r.test_status or "") == "error"]
        metrics = {
            "integrations_count": len(rows),
            "last_tested_at": last_tested.isoformat() if last_tested else None,
            "errored": len(errored),
            "last_errors": [r.test_error for r in errored[:3] if r.test_error],
        }
        if errored:
            msg = errored[0].test_error or "test_status=error"
            return _error(f"{len(errored)} интеграций в ошибке: {msg[:200]}",
                          metrics)
        if last_tested and (datetime.utcnow() - last_tested).days > 1:
            return _degraded(
                f"Последний тест {(datetime.utcnow() - last_tested).days}д назад",
                metrics
            )
        return _ok(f"{len(rows)} интеграций активны", metrics)
    except Exception as e:
        return _error(f"Сбой проверки mis_sync: {e}")


async def check_sms_marketing(db: AsyncSession, tenant_id: uuid.UUID) -> dict:
    """SMS-marketing: last campaign + delivery rate."""
    try:
        from app.models.sms_marketing import (
            SmsCampaign,
            SmsCampaignStatus,
            SmsMessageLog,
            SmsMessageStatus,
        )
        cutoff = _cutoff()
        last_camp = (await db.execute(
            select(SmsCampaign)
            .where(SmsCampaign.tenant_id == tenant_id)
            .order_by(SmsCampaign.created_at.desc())
            .limit(1)
        )).scalar_one_or_none()
        recent_count = (await db.execute(
            select(func.count(SmsCampaign.id))
            .where(SmsCampaign.tenant_id == tenant_id)
            .where(SmsCampaign.created_at >= cutoff)
        )).scalar() or 0
        # delivery rate за 7 дней по сообщениям (через JOIN)
        sent = (await db.execute(
            select(func.count(SmsMessageLog.id))
            .join(SmsCampaign, SmsCampaign.id == SmsMessageLog.campaign_id)
            .where(SmsCampaign.tenant_id == tenant_id)
            .where(SmsMessageLog.created_at >= cutoff)
        )).scalar() or 0
        delivered = (await db.execute(
            select(func.count(SmsMessageLog.id))
            .join(SmsCampaign, SmsCampaign.id == SmsMessageLog.campaign_id)
            .where(SmsCampaign.tenant_id == tenant_id)
            .where(SmsMessageLog.created_at >= cutoff)
            .where(SmsMessageLog.status == SmsMessageStatus.DELIVERED)
        )).scalar() or 0
        rate = (delivered / sent * 100) if sent else None
        metrics = {
            "campaigns_7d": int(recent_count),
            "messages_7d": int(sent),
            "delivered_7d": int(delivered),
            "delivery_rate_pct": round(rate, 1) if rate is not None else None,
            "last_campaign_at": last_camp.created_at.isoformat() if last_camp else None,
            "last_campaign_status": last_camp.status.value if last_camp and last_camp.status else None,
        }
        if not last_camp:
            return _idle("Нет кампаний", metrics)
        if recent_count == 0:
            return _idle("Нет кампаний за 7 дней", metrics)
        if rate is not None and rate < 50:
            return _degraded(f"Delivery rate {rate:.1f}%", metrics)
        return _ok(f"{recent_count} кампаний 7д, delivery {rate:.1f}%"
                   if rate is not None else f"{recent_count} кампаний 7д",
                   metrics)
    except Exception as e:
        return _error(f"Сбой проверки sms_marketing: {e}")


async def check_cross_clinic_audio(db: AsyncSession,
                                   tenant_id: uuid.UUID) -> dict:
    """Cross-clinic audio: call_logs за 24ч + успех."""
    try:
        from app.models.presence import CallLog
        cutoff_24h = datetime.utcnow() - timedelta(hours=24)
        total = (await db.execute(
            select(func.count(CallLog.id))
            .where(CallLog.tenant_id == tenant_id)
            .where(CallLog.started_at >= cutoff_24h)
            .where(CallLog.call_type == "audio")
        )).scalar() or 0
        answered = (await db.execute(
            select(func.count(CallLog.id))
            .where(CallLog.tenant_id == tenant_id)
            .where(CallLog.started_at >= cutoff_24h)
            .where(CallLog.call_type == "audio")
            .where(CallLog.outcome == "answered")
        )).scalar() or 0
        rate = (answered / total * 100) if total else None
        metrics = {"calls_24h": int(total), "answered_24h": int(answered),
                   "success_rate_pct": round(rate, 1) if rate is not None else None}
        if total == 0:
            return _idle("Нет звонков за 24ч", metrics)
        if rate is not None and rate < 30:
            return _degraded(f"Success rate {rate:.1f}% за 24ч", metrics)
        return _ok(f"{total} звонков 24ч, {answered} отвечено", metrics)
    except Exception as e:
        return _error(f"Сбой проверки cross_clinic_audio: {e}")


async def check_telephony_basic(db: AsyncSession, tenant_id: uuid.UUID) -> dict:
    """Telephony basic: общая активность звонков за 24ч."""
    try:
        from app.models.presence import CallLog
        cutoff_24h = datetime.utcnow() - timedelta(hours=24)
        total = (await db.execute(
            select(func.count(CallLog.id))
            .where(CallLog.tenant_id == tenant_id)
            .where(CallLog.started_at >= cutoff_24h)
        )).scalar() or 0
        metrics = {"calls_24h": int(total)}
        if total == 0:
            return _idle("Нет звонков за 24ч", metrics)
        return _ok(f"{total} звонков за 24ч", metrics)
    except Exception as e:
        return _error(f"Сбой проверки telephony_basic: {e}")


async def check_video_calls(db: AsyncSession, tenant_id: uuid.UUID) -> dict:
    """Video calls 1:1 (через CallLog с типом video)."""
    try:
        from app.models.presence import CallLog
        cutoff = _cutoff()
        total = (await db.execute(
            select(func.count(CallLog.id))
            .where(CallLog.tenant_id == tenant_id)
            .where(CallLog.started_at >= cutoff)
            .where(CallLog.call_type == "video")
        )).scalar() or 0
        metrics = {"video_calls_7d": int(total)}
        if total == 0:
            return _idle("Нет видео-звонков за 7 дней", metrics)
        return _ok(f"{total} видео-звонков за 7 дней", metrics)
    except Exception as e:
        return _error(f"Сбой проверки video_calls: {e}")


async def check_video_conference(db: AsyncSession, tenant_id: uuid.UUID) -> dict:
    """Video conference — пока считаем активные комнаты по telemedicine_sessions
    (модуль ещё не имеет своих таблиц)."""
    try:
        from app.models.telemedicine import TelemedicineSession
        cutoff = _cutoff()
        total = (await db.execute(
            select(func.count(TelemedicineSession.id))
            .where(TelemedicineSession.tenant_id == tenant_id)
            .where(TelemedicineSession.created_at >= cutoff)
        )).scalar() or 0
        metrics = {"rooms_7d": int(total)}
        if total == 0:
            return _idle("Нет видеоконференций за 7 дней", metrics)
        return _ok(f"{total} комнат за 7 дней", metrics)
    except Exception as e:
        return _error(f"Сбой проверки video_conference: {e}")


async def check_call_recording(db: AsyncSession, tenant_id: uuid.UUID) -> dict:
    """Call recording: count записей + статусы."""
    try:
        from app.models.call_recording import (
            CallRecording,
            CallRecordingStatus,
        )
        cutoff = _cutoff()
        total = (await db.execute(
            select(func.count(CallRecording.id))
            .where(CallRecording.tenant_id == tenant_id)
            .where(CallRecording.created_at >= cutoff)
        )).scalar() or 0
        failed = (await db.execute(
            select(func.count(CallRecording.id))
            .where(CallRecording.tenant_id == tenant_id)
            .where(CallRecording.created_at >= cutoff)
            .where(CallRecording.status == CallRecordingStatus.FAILED)
        )).scalar() or 0 if hasattr(CallRecordingStatus, "FAILED") else 0
        metrics = {"recordings_7d": int(total), "failed_7d": int(failed)}
        if total == 0:
            return _idle("Нет записей за 7 дней", metrics)
        if failed and failed / total > 0.2:
            return _degraded(
                f"Доля fail {failed}/{total} > 20%", metrics)
        return _ok(f"{total} записей за 7 дней", metrics)
    except Exception as e:
        return _error(f"Сбой проверки call_recording: {e}")


async def _check_ai_common(db: AsyncSession, tenant_id: uuid.UUID,
                           analysis_types: list[str] | None,
                           label: str) -> dict:
    """Общий чек AI-аналитики (basic/pro) по AIAnalysisHistory."""
    try:
        from app.models.ai_history import AIAnalysisHistory
        cutoff = _cutoff()
        q = (select(func.count(AIAnalysisHistory.id))
             .where(AIAnalysisHistory.tenant_id == tenant_id)
             .where(AIAnalysisHistory.created_at >= cutoff))
        if analysis_types:
            q = q.where(AIAnalysisHistory.analysis_type.in_(analysis_types))
        total = (await db.execute(q)).scalar() or 0
        last_at = (await db.execute(
            select(func.max(AIAnalysisHistory.created_at))
            .where(AIAnalysisHistory.tenant_id == tenant_id)
        )).scalar()
        metrics = {"requests_7d": int(total),
                   "last_request_at": last_at.isoformat() if last_at else None}
        if total == 0:
            return _idle(f"{label}: нет запросов за 7 дней", metrics)
        return _ok(f"{label}: {total} запросов 7д", metrics)
    except Exception as e:
        return _error(f"Сбой проверки {label}: {e}")


async def check_ai_analytics_basic(db: AsyncSession,
                                   tenant_id: uuid.UUID) -> dict:
    return await _check_ai_common(db, tenant_id, None, "ai_analytics_basic")


async def check_ai_analytics_pro(db: AsyncSession,
                                 tenant_id: uuid.UUID) -> dict:
    return await _check_ai_common(db, tenant_id, None, "ai_analytics_pro")


async def check_ai_assistant(db: AsyncSession, tenant_id: uuid.UUID) -> dict:
    """AI assistant пациентам — count диалогов."""
    try:
        from app.models.ai_assistant import AiConversation
        cutoff = _cutoff()
        total = (await db.execute(
            select(func.count(AiConversation.id))
            .where(AiConversation.tenant_id == tenant_id)
            .where(AiConversation.created_at >= cutoff)
        )).scalar() or 0
        metrics = {"conversations_7d": int(total)}
        if total == 0:
            return _idle("Нет AI-диалогов за 7 дней", metrics)
        return _ok(f"{total} диалогов за 7 дней", metrics)
    except Exception as e:
        return _error(f"Сбой проверки ai_assistant: {e}")


async def check_fiscal_54fz_pro(db: AsyncSession, tenant_id: uuid.UUID) -> dict:
    """Fiscal 54-ФЗ: last receipt + ofd error rate."""
    try:
        from app.models.payments_clinic import FiscalReceipt
        cutoff = _cutoff()
        total = (await db.execute(
            select(func.count(FiscalReceipt.id))
            .where(FiscalReceipt.tenant_id == tenant_id)
            .where(FiscalReceipt.received_at >= cutoff)
        )).scalar() or 0
        last_at = (await db.execute(
            select(func.max(FiscalReceipt.received_at))
            .where(FiscalReceipt.tenant_id == tenant_id)
        )).scalar()
        metrics = {"receipts_7d": int(total),
                   "last_receipt_at": last_at.isoformat() if last_at else None}
        if total == 0:
            return _idle("Нет чеков за 7 дней", metrics)
        # Если последний чек > 2 дней — возможно ОФД отвалился
        if last_at and (datetime.utcnow() - last_at).days > 2:
            return _degraded(
                f"Последний чек {(datetime.utcnow() - last_at).days}д назад",
                metrics)
        return _ok(f"{total} чеков за 7 дней", metrics)
    except Exception as e:
        return _error(f"Сбой проверки fiscal_54fz_pro: {e}")


async def check_ltv_pro(db: AsyncSession, tenant_id: uuid.UUID) -> dict:
    """LTV: count snapshots за 7 дней."""
    try:
        from app.models.ltv import PatientLtvSnapshot
        cutoff = _cutoff()
        total = (await db.execute(
            select(func.count(PatientLtvSnapshot.id))
            .where(PatientLtvSnapshot.tenant_id == tenant_id)
        )).scalar() or 0
        recent = (await db.execute(
            select(func.count(PatientLtvSnapshot.id))
            .where(PatientLtvSnapshot.tenant_id == tenant_id)
            .where(PatientLtvSnapshot.computed_at >= cutoff)
        )).scalar() or 0 if hasattr(PatientLtvSnapshot, "computed_at") else 0
        metrics = {"snapshots_total": int(total),
                   "snapshots_7d": int(recent)}
        if total == 0:
            return _idle("Нет LTV-снапшотов", metrics)
        return _ok(f"{total} снапшотов всего", metrics)
    except Exception as e:
        return _error(f"Сбой проверки ltv_pro: {e}")


async def check_white_label(db: AsyncSession, tenant_id: uuid.UUID) -> dict:
    """White-Label: проверяем заполненность TenantBranding."""
    try:
        from app.models.tenant import TenantBranding
        b = (await db.execute(
            select(TenantBranding).where(TenantBranding.tenant_id == tenant_id)
        )).scalar_one_or_none()
        if not b:
            return _idle("Branding не настроен")
        return _ok("Branding настроен")
    except Exception as e:
        return _error(f"Сбой проверки white_label: {e}")


async def check_webhooks(db: AsyncSession, tenant_id: uuid.UUID) -> dict:
    """Webhooks: count активных endpoints + delivery status за 7 дней."""
    try:
        from app.models.webhook import WebhookDelivery, WebhookEndpoint
        endpoints = (await db.execute(
            select(func.count(WebhookEndpoint.id))
            .where(WebhookEndpoint.tenant_id == tenant_id)
        )).scalar() or 0
        cutoff = _cutoff()
        delivered = (await db.execute(
            select(func.count(WebhookDelivery.id))
            .where(WebhookDelivery.tenant_id == tenant_id)
            .where(WebhookDelivery.delivered_at >= cutoff)
        )).scalar() or 0
        metrics = {"endpoints": int(endpoints), "deliveries_7d": int(delivered)}
        if endpoints == 0:
            return _idle("Нет настроенных webhook-endpoints", metrics)
        return _ok(f"{endpoints} endpoints, {delivered} доставок 7д", metrics)
    except Exception as e:
        return _error(f"Сбой проверки webhooks: {e}")


async def check_online_payments_pro(db: AsyncSession,
                                    tenant_id: uuid.UUID) -> dict:
    """Online payments: count успешных + общий объём за 7 дней."""
    try:
        from app.models.payments_clinic import (
            ClinicPayment,
            ClinicPaymentStatus,
        )
        cutoff = _cutoff()
        total = (await db.execute(
            select(func.count(ClinicPayment.id))
            .where(ClinicPayment.tenant_id == tenant_id)
            .where(ClinicPayment.created_at >= cutoff)
        )).scalar() or 0
        completed = (await db.execute(
            select(func.count(ClinicPayment.id))
            .where(ClinicPayment.tenant_id == tenant_id)
            .where(ClinicPayment.created_at >= cutoff)
            .where(ClinicPayment.status == ClinicPaymentStatus.SUCCEEDED)
        )).scalar() or 0
        metrics = {"payments_7d": int(total), "completed_7d": int(completed)}
        if total == 0:
            return _idle("Нет платежей за 7 дней", metrics)
        if completed == 0 and total > 0:
            return _degraded(f"0 успешных из {total}", metrics)
        rate = completed / total * 100
        if rate < 50:
            return _degraded(f"Success rate {rate:.1f}%", metrics)
        return _ok(f"{completed}/{total} успешных", metrics)
    except Exception as e:
        return _error(f"Сбой проверки online_payments_pro: {e}")


# ─── Реестр адаптеров ────────────────────────────────────────────────────────


async def check_health_apple(db: AsyncSession, tenant_id: uuid.UUID) -> dict:
    """Apple Health: count записей с source='apple_health' за 7 дней.
    Если 0 — idle (нет приложения / пациенты не синхронизируют)."""
    try:
        from app.models.patient_vital import PatientVital
        from sqlalchemy import func
        cnt = (await db.execute(
            select(func.count(PatientVital.id)).where(
                PatientVital.tenant_id == tenant_id,
                PatientVital.source == "apple_health",
                PatientVital.created_at >= datetime.utcnow() - timedelta(days=7),
            )
        )).scalar() or 0
        if cnt == 0:
            return _idle("Нет sync с Apple Health за 7 дней (нужно iOS-приложение)")
        return _ok(f"Синхронизаций за 7 дн: {cnt}", {"syncs_7d": cnt})
    except Exception as e:
        return _error(f"Сбой проверки apple health: {e}")


async def check_health_google(db: AsyncSession, tenant_id: uuid.UUID) -> dict:
    """Google Fit: count записей с source='google_fit' за 7 дней."""
    try:
        from app.models.patient_vital import PatientVital
        from sqlalchemy import func
        cnt = (await db.execute(
            select(func.count(PatientVital.id)).where(
                PatientVital.tenant_id == tenant_id,
                PatientVital.source == "google_fit",
                PatientVital.created_at >= datetime.utcnow() - timedelta(days=7),
            )
        )).scalar() or 0
        if cnt == 0:
            return _idle("Нет sync с Google Fit за 7 дней (нужно Android-приложение)")
        return _ok(f"Синхронизаций за 7 дн: {cnt}", {"syncs_7d": cnt})
    except Exception as e:
        return _error(f"Сбой проверки google fit: {e}")


AdapterFn = Callable[[AsyncSession, uuid.UUID], Awaitable[dict]]

_ADAPTERS: dict[str, AdapterFn] = {
    "telemedicine":         check_telemedicine,
    "ads_basic":            check_ads_basic,
    "ads_agency":           check_ads_agency,
    "inventory":            check_inventory,
    "loyalty_pro":          check_loyalty_pro,
    "mis_sync":             check_mis_sync,
    "sms_marketing":        check_sms_marketing,
    "cross_clinic_audio":   check_cross_clinic_audio,
    "telephony_basic":      check_telephony_basic,
    "video_calls":          check_video_calls,
    "video_conference":     check_video_conference,
    "call_recording":       check_call_recording,
    "ai_analytics_basic":   check_ai_analytics_basic,
    "ai_analytics_pro":     check_ai_analytics_pro,
    "ai_assistant":         check_ai_assistant,
    "fiscal_54fz_pro":      check_fiscal_54fz_pro,
    "online_payments_pro":  check_online_payments_pro,
    "ltv_pro":              check_ltv_pro,
    "white_label":          check_white_label,
    "webhooks":             check_webhooks,
    "health_apple":         check_health_apple,
    "health_google":        check_health_google,
}


# ─── Telegram alert ──────────────────────────────────────────────────────────

async def send_alert(db: AsyncSession,
                     check: ModuleHealthCheck,
                     tenant_name: str,
                     status: str,
                     message: str) -> bool:
    """Уведомить админа платформы об изменении статуса (с дедупом 1 час)."""
    now = datetime.utcnow()
    if check.last_alert_at and (
        now - check.last_alert_at < timedelta(hours=ALERT_COOLDOWN_HOURS)
    ):
        return False
    try:
        from app.services import alert_service
        emoji = {"error": "❌", "degraded": "⚠️"}.get(status, "ℹ️")
        text = (
            f"{emoji} <b>Модуль {check.module_key}: {status.upper()}</b>\n"
            f"Тенант: <b>{tenant_name}</b>\n"
            f"Сообщение: {message[:300]}"
        )
        await alert_service.notify_admin(
            text,
            dedup_key=f"module_health:{check.tenant_id}:{check.module_key}:{status}",
        )
        check.last_alert_at = now
        return True
    except Exception as e:
        log.error(f"send_alert failed: {e}")
        return False


# ─── Сохранение результата + триггер алерта ──────────────────────────────────

async def _upsert_result(db: AsyncSession,
                         tenant_id: uuid.UUID,
                         tenant_name: str,
                         module_key: str,
                         result: dict) -> ModuleHealthCheck:
    """Создаёт/обновляет ModuleHealthCheck. Если переход в error — алерт."""
    new_status = result.get("status") or ModuleHealthStatus.UNKNOWN.value
    message = result.get("message") or ""
    metrics = result.get("metrics") or {}
    now = datetime.utcnow()

    existing = (await db.execute(
        select(ModuleHealthCheck)
        .where(ModuleHealthCheck.tenant_id == tenant_id)
        .where(ModuleHealthCheck.module_key == module_key)
    )).scalar_one_or_none()

    prev_status = existing.status if existing else None

    if existing is None:
        existing = ModuleHealthCheck(
            tenant_id=tenant_id, module_key=module_key,
            status=new_status, last_check_at=now, metrics=metrics,
        )
        db.add(existing)
    else:
        existing.status = new_status
        existing.last_check_at = now
        existing.metrics = metrics

    # last_used_at — оцениваем по metrics (если адаптер вернул last_*_at)
    last_used_keys = ("last_started_at", "last_request_at", "last_campaign_at",
                      "last_receipt_at", "last_impression_at")
    for k in last_used_keys:
        v = metrics.get(k)
        if isinstance(v, str):
            try:
                existing.last_used_at = datetime.fromisoformat(v)
                break
            except Exception:
                pass

    if new_status == ModuleHealthStatus.OK.value:
        existing.last_success_at = now
    if new_status == ModuleHealthStatus.ERROR.value:
        existing.last_error_at = now
        existing.last_error_message = message[:1000]
        existing.error_count_24h = (existing.error_count_24h or 0) + 1

    # Триггер алерта: переход не-error → error/degraded
    if (new_status in (ModuleHealthStatus.ERROR.value,
                       ModuleHealthStatus.DEGRADED.value)
            and prev_status != new_status):
        await send_alert(db, existing, tenant_name, new_status, message)

    return existing


# ─── Top-level orchestrators ─────────────────────────────────────────────────

async def run_health_checks_for_tenant(db: AsyncSession,
                                       tenant_id: uuid.UUID) -> dict:
    """Обходит все active подписки тенанта, обновляет health-таблицу.

    Возвращает stats {checked, ok, degraded, error, idle, unknown}.
    """
    tenant = (await db.execute(
        select(Tenant).where(Tenant.id == tenant_id)
    )).scalar_one_or_none()
    if not tenant:
        return {"checked": 0, "error": "tenant not found"}
    tenant_name = tenant.name or tenant.slug

    subs = (await db.execute(
        select(TenantModuleSubscription)
        .where(TenantModuleSubscription.tenant_id == tenant_id)
        .where(TenantModuleSubscription.status.in_(
            [ModuleStatus.ACTIVE.value, ModuleStatus.TRIAL.value,
             ModuleStatus.GRACE.value]
        ))
    )).scalars().all()

    stats = {"checked": 0, "ok": 0, "degraded": 0, "error": 0,
             "idle": 0, "unknown": 0}
    for s in subs:
        adapter = _ADAPTERS.get(s.module_key)
        if adapter is None:
            result = _unknown(f"Адаптер для {s.module_key} не реализован")
        else:
            try:
                result = await adapter(db, tenant_id)
            except Exception as e:
                log.error(f"adapter {s.module_key} for {tenant_id}: {e}")
                result = _error(f"Сбой адаптера: {e}")
        await _upsert_result(db, tenant_id, tenant_name, s.module_key, result)
        stats["checked"] += 1
        stats[result["status"]] = stats.get(result["status"], 0) + 1

    await db.commit()
    return stats


async def run_health_checks_all_tenants(db: AsyncSession) -> dict:
    """Обходит все active tenants. Cron 30 мин."""
    tenants = (await db.execute(
        select(Tenant.id).where(Tenant.is_active.is_(True))
    )).scalars().all()
    grand = {"tenants": 0, "checked": 0, "ok": 0, "degraded": 0,
             "error": 0, "idle": 0, "unknown": 0}
    for tid in tenants:
        try:
            s = await run_health_checks_for_tenant(db, tid)
            grand["tenants"] += 1
            for k in ("checked", "ok", "degraded", "error", "idle", "unknown"):
                grand[k] = grand.get(k, 0) + int(s.get(k) or 0)
        except Exception as e:
            log.error(f"tenant {tid} health check: {e}")
    return grand


async def get_modules_health_for_tenant(db: AsyncSession,
                                        tenant_id: uuid.UUID) -> list[dict]:
    """Список модулей тенанта с подписками и текущим health-статусом."""
    subs = (await db.execute(
        select(TenantModuleSubscription)
        .where(TenantModuleSubscription.tenant_id == tenant_id)
    )).scalars().all()
    sub_keys = [s.module_key for s in subs]
    checks = {}
    if sub_keys:
        rows = (await db.execute(
            select(ModuleHealthCheck)
            .where(ModuleHealthCheck.tenant_id == tenant_id)
            .where(ModuleHealthCheck.module_key.in_(sub_keys))
        )).scalars().all()
        checks = {c.module_key: c for c in rows}
    out = []
    for s in subs:
        c = checks.get(s.module_key)
        out.append({
            "module_key": s.module_key,
            "subscription_status": s.status,
            "expires_at": s.expires_at.isoformat() if s.expires_at else None,
            "health": {
                "status": c.status if c else ModuleHealthStatus.UNKNOWN.value,
                "last_check_at": c.last_check_at.isoformat()
                                  if c and c.last_check_at else None,
                "last_used_at": c.last_used_at.isoformat()
                                 if c and c.last_used_at else None,
                "last_success_at": c.last_success_at.isoformat()
                                    if c and c.last_success_at else None,
                "last_error_at": c.last_error_at.isoformat()
                                  if c and c.last_error_at else None,
                "last_error_message": c.last_error_message if c else None,
                "error_count_24h": c.error_count_24h if c else 0,
                "metrics": c.metrics if c else {},
            } if c else {
                "status": ModuleHealthStatus.UNKNOWN.value,
                "last_check_at": None,
                "last_used_at": None,
                "last_success_at": None,
                "last_error_at": None,
                "last_error_message": None,
                "error_count_24h": 0,
                "metrics": {},
            },
        })
    return out


async def get_modules_health_all_tenants(db: AsyncSession) -> list[dict]:
    """Heatmap для super_admin: [{tenant, modules[]}]."""
    tenants = (await db.execute(
        select(Tenant).where(Tenant.is_active.is_(True))
        .order_by(Tenant.name)
    )).scalars().all()
    out = []
    for t in tenants:
        modules = await get_modules_health_for_tenant(db, t.id)
        out.append({
            "tenant_id": str(t.id),
            "tenant_slug": t.slug,
            "tenant_name": t.name,
            "modules": modules,
        })
    return out


def list_known_module_keys() -> list[str]:
    """Все ключи, для которых реализован адаптер."""
    return list(_ADAPTERS.keys())
