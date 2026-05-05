"""Loyalty program service.

1 point = 100 rub spent. Tiers: bronze=0, silver=20000, gold=80000, platinum=200000.
Transactions are append-only (immutable).
"""
import uuid
from decimal import Decimal
from datetime import datetime
from typing import Optional
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.loyalty import LoyaltyAccount, LoyaltyTransaction, LoyaltyTier
from app.utils.phone import normalize_phone


RUB_PER_POINT = Decimal("100")
TIER_ORDER = ["bronze", "silver", "gold", "platinum"]
