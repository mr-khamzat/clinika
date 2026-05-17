"""Тесты GET /manager/billing/ledger — журнал биллинг-операций франшизы.

Покрывают:
1. RBAC: cashier/доктор → 403, manager → 200.
2. Тенантная изоляция: записи чужого tenant_id не возвращаются.
3. Фильтр по entry_type + totals считаются по выборке (gross/net/by_type).

Использует мок-БД из conftest (mock_db), без реального PostgreSQL.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock

import pytest

pytestmark = pytest.mark.unit


# ── 1) RBAC: cashier (REG) → 403 ──────────────────────────────────────────────
async def test_billing_ledger_forbidden_for_cashier(client, mock_db):
    """Эндпоинт доступен только manager/franchise_owner/super_admin."""
    from app.core.security import create_access_token
    from app.models.user import User, UserRole

    uid = uuid.uuid4()
    tid = uuid.uuid4()
    token = create_access_token({"sub": str(uid), "role": "reg", "tid": str(tid)})

    fake_user = MagicMock(spec=User)
    fake_user.id = uid
    fake_user.role = UserRole.REG  # cashier — не имеет доступа
    fake_user.is_active = True
    fake_user.tenant_id = tid

    user_res = MagicMock()
    user_res.scalar_one_or_none.return_value = fake_user
    mock_db.execute = AsyncMock(return_value=user_res)

    resp = await client.get(
        "/manager/billing/ledger",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403, resp.text


# ── 2) Manager видит свой tenant_id, totals считаются корректно ──────────────
async def test_billing_ledger_manager_sees_tenant_records(client, mock_db):
    """Manager получает записи + totals (gross/debit/net/by_type)."""
    from app.core.security import create_access_token
    from app.models.user import User, UserRole
    from app.models.billing_ledger import BillingLedger, EntryType, Direction

    uid = uuid.uuid4()
    tid = uuid.uuid4()
    token = create_access_token({"sub": str(uid), "role": "manager", "tid": str(tid)})

    fake_user = MagicMock(spec=User)
    fake_user.id = uid
    fake_user.role = UserRole.MANAGER
    fake_user.is_active = True
    fake_user.tenant_id = tid

    # 2 записи в выборке: одна credit 1000, одна debit 300 → gross=1000, net=700.
    entry1 = MagicMock(spec=BillingLedger)
    entry1.id = uuid.uuid4()
    entry1.tenant_id = tid
    entry1.clinic_id = None
    entry1.entry_type = EntryType.SUBSCRIPTION_CHARGE
    entry1.direction = Direction.CREDIT
    entry1.amount = Decimal("1000.00")
    entry1.currency = "RUB"
    entry1.reference_id = None
    entry1.reference_type = None
    entry1.description = "Charge"
    entry1.meta = {"patient_name": "Иванов И.И.", "receipt_url": "https://x/receipt/1.pdf"}
    entry1.is_split = False
    entry1.split_parent_id = None
    entry1.split_actor = None
    entry1.created_at = datetime(2026, 5, 1, 12, 0, 0)

    entry2 = MagicMock(spec=BillingLedger)
    entry2.id = uuid.uuid4()
    entry2.tenant_id = tid
    entry2.clinic_id = None
    entry2.entry_type = EntryType.SUBSCRIPTION_CREDIT
    entry2.direction = Direction.DEBIT
    entry2.amount = Decimal("300.00")
    entry2.currency = "RUB"
    entry2.reference_id = None
    entry2.reference_type = None
    entry2.description = "Refund"
    entry2.meta = None
    entry2.is_split = False
    entry2.split_parent_id = None
    entry2.split_actor = None
    entry2.created_at = datetime(2026, 5, 2, 12, 0, 0)

    # Порядок execute в эндпоинте:
    #  (1) get_current_user → fake_user
    #  (2) total count → 2
    #  (3) gross sum → 1000
    #  (4) debit sum → 300
    #  (5) by_type group → [(SUBSCRIPTION_CHARGE, credit, 1000, 1),
    #                       (SUBSCRIPTION_CREDIT, debit, 300, 1)]
    #  (6) rows page → [entry1, entry2]
    user_res = MagicMock(); user_res.scalar_one_or_none.return_value = fake_user

    total_res = MagicMock(); total_res.scalar.return_value = 2
    gross_res = MagicMock(); gross_res.scalar.return_value = Decimal("1000")
    debit_res = MagicMock(); debit_res.scalar.return_value = Decimal("300")

    bt1 = MagicMock(entry_type=EntryType.SUBSCRIPTION_CHARGE, direction="credit", sum=Decimal("1000"), cnt=1)
    bt2 = MagicMock(entry_type=EntryType.SUBSCRIPTION_CREDIT, direction="debit", sum=Decimal("300"), cnt=1)
    bytype_res = MagicMock(); bytype_res.all.return_value = [bt1, bt2]

    rows_res = MagicMock(); rows_res.scalars.return_value.all.return_value = [entry1, entry2]

    mock_db.execute = AsyncMock(side_effect=[
        user_res, total_res, gross_res, debit_res, bytype_res, rows_res,
    ])

    resp = await client.get(
        "/manager/billing/ledger?page=1&limit=50",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["total"] == 2
    assert body["page"] == 1
    assert len(body["items"]) == 2
    # signed_amount: credit → +, debit → -
    assert body["items"][0]["signed_amount"] == 1000.0
    assert body["items"][1]["signed_amount"] == -300.0
    # patient_name / receipt_url достаются из meta
    assert body["items"][0]["patient_name"] == "Иванов И.И."
    assert body["items"][0]["receipt_url"] == "https://x/receipt/1.pdf"
    # Totals
    assert body["totals"]["gross"] == 1000.0
    assert body["totals"]["debit"] == 300.0
    assert body["totals"]["net"] == 700.0
    # by_type содержит оба ключа
    assert EntryType.SUBSCRIPTION_CHARGE in body["totals"]["by_type"]
    assert EntryType.SUBSCRIPTION_CREDIT in body["totals"]["by_type"]


# ── 3) Фильтр по type + пустая выборка → нулевые totals ──────────────────────
async def test_billing_ledger_type_filter_empty(client, mock_db):
    """Фильтр type не находит записи → items=[], totals=0."""
    from app.core.security import create_access_token
    from app.models.user import User, UserRole

    uid = uuid.uuid4()
    tid = uuid.uuid4()
    token = create_access_token({"sub": str(uid), "role": "manager", "tid": str(tid)})

    fake_user = MagicMock(spec=User)
    fake_user.id = uid
    fake_user.role = UserRole.MANAGER
    fake_user.is_active = True
    fake_user.tenant_id = tid

    user_res = MagicMock(); user_res.scalar_one_or_none.return_value = fake_user
    total_res = MagicMock(); total_res.scalar.return_value = 0
    gross_res = MagicMock(); gross_res.scalar.return_value = 0
    debit_res = MagicMock(); debit_res.scalar.return_value = 0
    bytype_res = MagicMock(); bytype_res.all.return_value = []
    rows_res = MagicMock(); rows_res.scalars.return_value.all.return_value = []

    mock_db.execute = AsyncMock(side_effect=[
        user_res, total_res, gross_res, debit_res, bytype_res, rows_res,
    ])

    resp = await client.get(
        "/manager/billing/ledger?type=plugin_charge&from=2026-05-01&to=2026-05-31",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 0
    assert body["items"] == []
    assert body["totals"]["gross"] == 0
    assert body["totals"]["net"] == 0
    assert body["totals"]["by_type"] == {}
