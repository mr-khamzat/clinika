"""
Сервис партнёрской программы агрегаторов.

Содержит:
  - generate_api_key  / hash_api_key — создание + sha256-хэш
  - find_active_partnership          — ищет активный partnership по plaintext-ключу
  - update_lead_status               — переход статуса лида
  - stats_for_period                 — leads count / conversion / total commission
"""
import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, date
from decimal import Decimal
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from app.models.aggregator import AggregatorPartnership, AggregatorLead


KEY_PREFIX = "agg_live_"


def generate_api_key() -> tuple[str, str, str]:
    """
    Создаёт пару (plaintext_key, sha256_hash, key_prefix_for_display).

    Plaintext-ключ показывается УЗЕРУ ОДИН РАЗ при создании партнёрства.
    В БД хранится только sha256.
    """
    raw = secrets.token_urlsafe(32)
    plaintext = f"{KEY_PREFIX}{raw}"
    hashed = hashlib.sha256(plaintext.encode()).hexdigest()
    display = plaintext[: len(KEY_PREFIX) + 8] + "..."
    return plaintext, hashed[:80], display


def hash_api_key(plaintext: str) -> str:
    return hashlib.sha256(plaintext.encode()).hexdigest()[:80]


async def find_active_partnership(
    db: AsyncSession, plaintext_key: str
) -> AggregatorPartnership | None:
    """Ищет активное партнёрство по plaintext-ключу (через хэш)."""
    h = hash_api_key(plaintext_key)
    q = select(AggregatorPartnership).where(
        AggregatorPartnership.api_key_hash == h,
        AggregatorPartnership.status == "active",
    )
    return (await db.execute(q)).scalar_one_or_none()


async def update_lead_status(
    db: AsyncSession,
    lead: AggregatorLead,
    new_status: str,
    appointment_id: uuid.UUID | None = None,
    commission_amount: Decimal | None = None,
) -> AggregatorLead:
    """Обновляет статус лида + опционально привязывает запись/комиссию."""
    lead.status = new_status
    if appointment_id is not None:
        lead.appointment_id = appointment_id
    if commission_amount is not None:
        lead.commission_amount = commission_amount
    lead.updated_at = datetime.utcnow()
    await db.flush()
    return lead


def _parse_period(period: str) -> int:
    """'30d' → 30, '7d' → 7, '90d' → 90 и т.д."""
    try:
        if period.endswith("d"):
            return max(1, int(period[:-1]))
    except Exception:
        pass
    return 30


async def stats_for_period(
    db: AsyncSession, tenant_id: uuid.UUID, period: str = "30d"
) -> dict:
    days = _parse_period(period)
    since = datetime.utcnow() - timedelta(days=days)

    # Все лиды тенанта за период
    q = (
        select(
            AggregatorLead.status.label("status"),
            func.count(AggregatorLead.id).label("cnt"),
            func.coalesce(func.sum(AggregatorLead.commission_amount), 0).label("commission"),
        )
        .join(
            AggregatorPartnership,
            AggregatorPartnership.id == AggregatorLead.partnership_id,
        )
        .where(
            AggregatorPartnership.tenant_id == tenant_id,
            AggregatorLead.created_at >= since,
        )
        .group_by(AggregatorLead.status)
    )
    rows = (await db.execute(q)).all()

    total = 0
    completed = 0
    scheduled = 0
    lost = 0
    total_commission = Decimal("0")
    by_status: dict[str, int] = {}
    for r in rows:
        by_status[r.status] = int(r.cnt)
        total += int(r.cnt)
        total_commission += Decimal(str(r.commission or 0))
        if r.status == "completed":
            completed = int(r.cnt)
        elif r.status == "scheduled":
            scheduled = int(r.cnt)
        elif r.status == "lost":
            lost = int(r.cnt)

    conversion_pct = round((completed / total) * 100, 2) if total else 0.0
    scheduled_pct = round(((completed + scheduled) / total) * 100, 2) if total else 0.0

    return {
        "period": period,
        "since": since.isoformat(),
        "total_leads": total,
        "completed": completed,
        "scheduled": scheduled,
        "lost": lost,
        "by_status": by_status,
        "conversion_pct": conversion_pct,
        "scheduled_pct": scheduled_pct,
        "total_commission": float(total_commission),
    }
