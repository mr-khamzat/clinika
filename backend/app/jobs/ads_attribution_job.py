"""
Ads conversion attribution job (adspro01).

Логика:
- Берём все referral.confirmed_at за последние N дней (max attribution_window_days рекламы)
- Для каждого ищем: был ли у этого пациента (по phone/user_id/ip) клик на любую рекламу
  ЭТОГО tenant'а в окне [referral.created_at - window, referral.created_at]
- Если был — создаём AdEvent(type=conversion, ad_id=..., referral_id=..., revenue=service.price)
  и инкрементим ads.revenue_attributed += revenue, ads.conversions_count += 1
- Дубликаты предотвращаются проверкой существования event(referral_id, type=conversion)
"""
import logging
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger("ads_attribution")


async def run_attribution(db: AsyncSession, lookback_days: int = 30) -> dict:
    """Привязать конверсии к кликам по рекламе. Возвращает stats dict."""
    from app.models.advertising import Ad, AdEvent, AdEventType
    from app.models.referral import Referral, ReferralStatus
    from app.models.service import Service

    since = datetime.utcnow() - timedelta(days=lookback_days)
    refs = (await db.execute(
        select(Referral).where(
            Referral.confirmed_at.isnot(None),
            Referral.confirmed_at >= since,
        )
    )).scalars().all()

    attributed = 0
    skipped_already = 0
    no_match = 0

    for ref in refs:
        # Уже атрибутировано?
        existing = (await db.execute(
            select(func.count(AdEvent.id)).where(
                AdEvent.referral_id == ref.id,
                AdEvent.event_type == AdEventType.CONVERSION,
            )
        )).scalar() or 0
        if existing:
            skipped_already += 1
            continue

        # Ищем последний клик за окно атрибуции
        # Окно берётся максимальное по всем рекламам tenant'а (потом фильтр)
        ref_created = ref.created_at or ref.confirmed_at
        # Кандидаты: AdEvent где tenant совпадает, type=click, в окне до ref_created
        # User_id мы можем получить через User по phone (если зарегистрирован)
        candidates = (await db.execute(
            select(AdEvent, Ad).join(Ad, AdEvent.ad_id == Ad.id).where(
                AdEvent.tenant_id == ref.tenant_id,
                AdEvent.event_type == AdEventType.CLICK,
                AdEvent.created_at <= ref.confirmed_at,
            ).order_by(AdEvent.created_at.desc())
        )).all()

        matched_ad = None
        matched_event = None
        for ev, ad in candidates:
            window = ad.attribution_window_days or 7
            if (ref.confirmed_at - ev.created_at).days > window:
                continue
            # Match по user_id если совпадает; иначе пропускаем (без user — нет привязки)
            # TODO: добавить ip_hash matching через cookies, сейчас strict
            # Если у клика был user_id и он совпадает с patient_user_id — атрибутируем
            # У referral нет user_id, но есть patient_phone; ищем User by phone
            if ev.user_id:
                # Найдём пациента (User) по telegram или phone из referral
                # Для упрощения: если telegram-пользователь когда-то кликнул и его phone === ref.patient_phone
                from app.models.user import User as _U
                u = await db.get(_U, ev.user_id)
                if u and u.phone_number and ref.patient_phone:
                    # Нормализуем оба номера
                    from app.utils.phone import normalize_phone as _np
                    if _np(u.phone_number) == _np(ref.patient_phone):
                        matched_ad = ad
                        matched_event = ev
                        break

        if not matched_ad:
            no_match += 1
            continue

        # Расчёт выручки: для типа service - Service.price; для doctor/lab - 0 пока
        revenue = Decimal("0")
        if ref.service_id:
            svc = await db.get(Service, ref.service_id)
            if svc and svc.price:
                revenue = Decimal(str(svc.price))

        # Создаём conversion event
        conv = AdEvent(
            ad_id=matched_ad.id,
            tenant_id=matched_ad.tenant_id,
            user_id=matched_event.user_id,
            event_type=AdEventType.CONVERSION,
            ip_hash=matched_event.ip_hash,
            referral_id=ref.id,
            revenue=revenue,
            meta={"matched_click_id": str(matched_event.id)},
        )
        db.add(conv)

        # Инкрементируем агрегаты
        matched_ad.conversions_count = (matched_ad.conversions_count or 0) + 1
        matched_ad.revenue_attributed = (matched_ad.revenue_attributed or Decimal("0")) + revenue
        attributed += 1

    await db.commit()
    logger.info("ads attribution: attributed=%s skipped=%s no_match=%s", attributed, skipped_already, no_match)
    return {"attributed": attributed, "skipped_already": skipped_already, "no_match": no_match}
