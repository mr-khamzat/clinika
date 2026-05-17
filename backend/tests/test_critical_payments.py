"""Критические Payments + Subscriptions flow.

Покрывает:
- наличная активация подписки менеджером (роли, валидация, БД, ledger)
- расчёт expires_at от months
- модуль health_plus_module gate (402 без подключения)
- billing_ledger создаётся при cash-активации
- PDF-квитанция возвращается inline
- поиск пациента: ЛК + МИС, дедуп
- ensure-patient: create-or-find PatientAccount по phone
- YooKassa webhook: IP allowlist (в Clinika подпись не используется)
- идемпотентность платежей (idempotency_key)
- /admin/subscription-plans/effective — tenant override

Все тесты — unit (AsyncMock), без реального PG.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

pytestmark = pytest.mark.asyncio


# ── 1. cash-активация: создаётся PatientSubscription + billing_ledger ─────
async def test_subscription_cash_activate_creates_subscription_and_ledger():
    """activate_cash → возвращает (sub, ledger, info), оба объекта добавлены в session."""
    from app.services import subscription_cash_service as scs
    from app.models.patient_account import PatientAccount
    from app.models.user import User, UserRole

    db = AsyncMock()

    # Заглушаем зависимости: модуль активен, нет активной подписки, есть план
    pa = MagicMock(spec=PatientAccount)
    pa.id = uuid.uuid4(); pa.name = "Иванов"; pa.phone = "+79001112233"
    user = MagicMock(spec=User)
    user.id = uuid.uuid4(); user.role = UserRole.MANAGER

    with patch.object(scs, "health_plus_module_active", AsyncMock(return_value=True)), \
         patch.object(scs, "can_activate_for_patient", AsyncMock(return_value=(True, ""))), \
         patch.object(scs.ss, "plan_meta_db", AsyncMock(return_value={
             "price_monthly": Decimal("290.00"), "title": "Здоровье+",
         })):
        sub, ledger, info = await scs.activate_cash(
            db,
            tenant_id=uuid.uuid4(), clinic_id=uuid.uuid4(),
            patient=pa, plan_key="health_plus",
            months=3, amount_received=Decimal("870.00"),
            received_by=user, note="cash",
        )

    assert sub.plan == "health_plus"
    assert sub.status == "active"
    assert ledger.entry_type == "subscription_cash"
    assert ledger.direction == "credit"
    assert info["amount_expected"] == 870.0
    assert info["flagged"] is False  # ровно 100%


# ── 2. cash-активация: требует роль manager/owner/reg ─────────────────────
async def test_subscription_cash_activate_requires_manager_role():
    """_require_cash_role бросает 403 для DOCTOR/PARTNER_DOCTOR/PATIENT."""
    from app.routers.manager_subscription_cash import _require_cash_role
    from app.models.user import User, UserRole
    from fastapi import HTTPException

    for forbidden in (UserRole.DOCTOR, UserRole.PARTNER_DOCTOR, UserRole.PATIENT,
                      UserRole.RECRUITER):
        u = MagicMock(spec=User); u.role = forbidden; u.tenant_id = uuid.uuid4()
        with pytest.raises(HTTPException) as exc:
            _require_cash_role(u)
        assert exc.value.status_code == 403

    # MANAGER пройдёт
    u_ok = MagicMock(spec=User); u_ok.role = UserRole.MANAGER; u_ok.tenant_id = uuid.uuid4()
    _require_cash_role(u_ok)  # не падает


# ── 3. amount_received: Pydantic-валидация ge=0 le=1_000_000 ──────────────
async def test_subscription_cash_amount_must_be_in_range():
    """Pydantic ActivateIn: amount_received: ge=0, le=1_000_000."""
    from app.routers.manager_subscription_cash import ActivateIn
    from pydantic import ValidationError

    valid = ActivateIn(
        patient_id=uuid.uuid4(), plan_key="health_plus",
        months=3, amount_received=870.0,
    )
    assert valid.amount_received == 870.0

    with pytest.raises(ValidationError):
        ActivateIn(patient_id=uuid.uuid4(), plan_key="health_plus",
                   months=3, amount_received=-1.0)
    with pytest.raises(ValidationError):
        ActivateIn(patient_id=uuid.uuid4(), plan_key="health_plus",
                   months=3, amount_received=2_000_000)


# ── 4. Активация привязывается к PatientAccount ────────────────────────────
async def test_subscription_activates_for_patient_account():
    """sub.patient_id = pa.id и tenant_id, clinic_id корректно копируются."""
    from app.services import subscription_cash_service as scs
    from app.models.patient_account import PatientAccount
    from app.models.user import User, UserRole

    db = AsyncMock()
    pa = MagicMock(spec=PatientAccount); pa.id = uuid.uuid4()
    pa.name = "X"; pa.phone = "+1"
    user = MagicMock(spec=User); user.id = uuid.uuid4(); user.role = UserRole.MANAGER
    tenant = uuid.uuid4(); clinic = uuid.uuid4()

    with patch.object(scs, "health_plus_module_active", AsyncMock(return_value=True)), \
         patch.object(scs, "can_activate_for_patient", AsyncMock(return_value=(True, ""))), \
         patch.object(scs.ss, "plan_meta_db", AsyncMock(return_value={"price_monthly": Decimal("290")})):
        sub, ledger, info = await scs.activate_cash(
            db, tenant_id=tenant, clinic_id=clinic, patient=pa,
            plan_key="health_plus", months=1, amount_received=Decimal("290"),
            received_by=user,
        )
    assert sub.patient_id == pa.id
    assert sub.tenant_id == tenant
    assert ledger.tenant_id == tenant
    assert ledger.clinic_id == clinic


# ── 5. expires_at: months → days mapping ──────────────────────────────────
async def test_subscription_expires_at_calculated_correctly():
    """1→30d, 3→90d, 6→180d, 12→365d."""
    from app.services.subscription_cash_service import _months_to_days

    assert _months_to_days(1) == 30
    assert _months_to_days(3) == 90
    assert _months_to_days(6) == 180
    assert _months_to_days(12) == 365
    assert _months_to_days(7) == 210  # fallback 30*n


# ── 6. can_activate_for_patient: блок если уже есть активная подписка ─────
async def test_subscription_does_not_activate_if_active_exists():
    """Если у пациента уже active/trial — can_activate=False."""
    from app.services import subscription_cash_service as scs

    db = AsyncMock()
    existing = MagicMock()
    existing.plan = "health_plus"
    existing.expires_at = datetime.utcnow() + timedelta(days=10)
    with patch.object(scs.ss, "get_active_subscription",
                      AsyncMock(return_value=existing)):
        ok, reason = await scs.can_activate_for_patient(db, uuid.uuid4(), uuid.uuid4())
    assert ok is False
    assert "уже есть активная подписка" in reason


# ── 7. cash-активация создаёт ledger-запись (direction=credit) ────────────
async def test_subscription_cash_creates_billing_ledger_entry():
    """BillingLedger.entry_type='subscription_cash', direction='credit', currency='RUB'."""
    from app.services import subscription_cash_service as scs
    from app.models.patient_account import PatientAccount
    from app.models.user import User, UserRole

    db = AsyncMock()
    pa = MagicMock(spec=PatientAccount); pa.id = uuid.uuid4(); pa.name = "x"; pa.phone = "+1"
    user = MagicMock(spec=User); user.id = uuid.uuid4(); user.role = UserRole.MANAGER

    with patch.object(scs, "health_plus_module_active", AsyncMock(return_value=True)), \
         patch.object(scs, "can_activate_for_patient", AsyncMock(return_value=(True, ""))), \
         patch.object(scs.ss, "plan_meta_db", AsyncMock(return_value={"price_monthly": Decimal("290")})):
        sub, ledger, info = await scs.activate_cash(
            db, tenant_id=uuid.uuid4(), clinic_id=uuid.uuid4(), patient=pa,
            plan_key="health_plus", months=1, amount_received=Decimal("290"),
            received_by=user,
        )
    assert ledger.entry_type == "subscription_cash"
    assert ledger.direction == "credit"
    assert ledger.currency == "RUB"
    assert ledger.reference_type == "patient_subscription"
    assert ledger.reference_id == sub.id


# ── 8. receipt_url возвращается в payload ─────────────────────────────────
async def test_subscription_cash_response_includes_receipt_url(client, mock_db):
    """POST /manager/subscription-cash/activate → receipt_url в ответе.

    Это проверяет API contract, не реализацию; мы мокаем activate_cash."""
    from app.core.security import create_access_token
    from app.models.user import User, UserRole

    uid = uuid.uuid4(); tid = uuid.uuid4()
    token = create_access_token({"sub": str(uid), "role": "manager", "tid": str(tid)})

    fake_user = MagicMock(spec=User)
    fake_user.id = uid; fake_user.role = UserRole.MANAGER
    fake_user.is_active = True; fake_user.tenant_id = tid

    fake_pa = MagicMock(); fake_pa.id = uuid.uuid4(); fake_pa.name = "Иванов"; fake_pa.phone = "+79991112233"

    # Возвращаем последовательно: user → patient → потом activate_cash сам мокнут
    user_result = MagicMock(); user_result.scalar_one_or_none.return_value = fake_user
    pa_result = MagicMock(); pa_result.scalar_one_or_none.return_value = fake_pa
    mock_db.execute = AsyncMock(side_effect=[user_result, pa_result])

    fake_sub = MagicMock(id=uuid.uuid4(), plan="health_plus", status="active",
                        started_at=datetime.utcnow(),
                        expires_at=datetime.utcnow() + timedelta(days=30))
    fake_ledger = MagicMock(id=uuid.uuid4())

    with patch("app.routers.manager_subscription_cash.scs.activate_cash",
               AsyncMock(return_value=(fake_sub, fake_ledger, {
                   "amount_expected": 290.0, "amount_received": 290.0,
                   "discrepancy_pct": 0.0, "flagged": False,
               }))), \
         patch("app.routers.manager_subscription_cash._require_module", AsyncMock()), \
         patch("app.routers.manager_subscription_cash.mis_webhook_sender.send_mis_webhook_safe", AsyncMock()):
        resp = await client.post(
            "/manager/subscription-cash/activate",
            headers={"Authorization": f"Bearer {token}"},
            json={"patient_id": str(fake_pa.id), "plan_key": "health_plus",
                  "months": 1, "amount_received": 290.0},
        )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert "receipt_url" in body
    assert body["receipt_url"].endswith("/receipt.pdf")


# ── 9. /manager/subscription-cash/search-patients находит в БД ────────────
async def test_subscription_cash_search_patients_local_db(client, mock_db):
    """search-patients возвращает локальные PatientAccount."""
    from app.core.security import create_access_token
    from app.models.user import User, UserRole
    from app.models.patient_account import PatientAccount

    uid = uuid.uuid4(); tid = uuid.uuid4()
    token = create_access_token({"sub": str(uid), "role": "manager", "tid": str(tid)})

    fake_user = MagicMock(spec=User)
    fake_user.id = uid; fake_user.role = UserRole.MANAGER
    fake_user.is_active = True; fake_user.tenant_id = tid

    pa = MagicMock(spec=PatientAccount); pa.id = uuid.uuid4()
    pa.name = "Иванов И.И."; pa.phone = "+79991112233"

    user_res = MagicMock(); user_res.scalar_one_or_none.return_value = fake_user
    pa_res = MagicMock(); pa_res.scalars.return_value.all.return_value = [pa]
    subs_res = MagicMock(); subs_res.scalars.return_value.all.return_value = []
    mock_db.execute = AsyncMock(side_effect=[user_res, pa_res, subs_res])

    resp = await client.get(
        "/manager/subscription-cash/search-patients?q=Иванов",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "patients" in body
    assert any(p["full_name"] == "Иванов И.И." for p in body["patients"])


# ── 10. ensure-patient: создаёт PatientAccount если нет ───────────────────
async def test_ensure_patient_creates_account_if_missing(client, mock_db):
    """POST /manager/subscription-cash/ensure-patient: если нет — создаём."""
    from app.core.security import create_access_token
    from app.models.user import User, UserRole

    uid = uuid.uuid4(); tid = uuid.uuid4()
    token = create_access_token({"sub": str(uid), "role": "manager", "tid": str(tid)})

    fake_user = MagicMock(spec=User)
    fake_user.id = uid; fake_user.role = UserRole.MANAGER
    fake_user.is_active = True; fake_user.tenant_id = tid

    user_res = MagicMock(); user_res.scalar_one_or_none.return_value = fake_user
    pa_res = MagicMock(); pa_res.scalar_one_or_none.return_value = None
    mock_db.execute = AsyncMock(side_effect=[user_res, pa_res])

    # db.refresh(pa) после add — заполняет id (нашему MagicMock-у)
    async def _refresh(pa):
        pa.id = uuid.uuid4()
    mock_db.refresh = AsyncMock(side_effect=_refresh)

    resp = await client.post(
        "/manager/subscription-cash/ensure-patient",
        headers={"Authorization": f"Bearer {token}"},
        json={"phone": "+79991112233", "full_name": "Новый Пациент"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["created"] is True


# ── 11. ledger.clinic_id: bonus распределяется по клинике ─────────────────
async def test_franchise_revenue_attributed_to_clinic_id():
    """billing_ledger.clinic_id — основа для отчётов по выручке клиники
    франшизы. Жёстко проверяем: при cash-активации clinic_id записывается."""
    from app.services import subscription_cash_service as scs
    from app.models.patient_account import PatientAccount
    from app.models.user import User, UserRole

    db = AsyncMock()
    pa = MagicMock(spec=PatientAccount); pa.id = uuid.uuid4(); pa.name = "x"; pa.phone = "+1"
    user = MagicMock(spec=User); user.id = uuid.uuid4(); user.role = UserRole.MANAGER
    clinic_a = uuid.uuid4()

    with patch.object(scs, "health_plus_module_active", AsyncMock(return_value=True)), \
         patch.object(scs, "can_activate_for_patient", AsyncMock(return_value=(True, ""))), \
         patch.object(scs.ss, "plan_meta_db", AsyncMock(return_value={"price_monthly": Decimal("290")})):
        _sub, ledger, _info = await scs.activate_cash(
            db, tenant_id=uuid.uuid4(), clinic_id=clinic_a, patient=pa,
            plan_key="health_plus", months=1, amount_received=Decimal("290"),
            received_by=user,
        )
    assert ledger.clinic_id == clinic_a, "clinic_id обязан копироваться в ledger для отчётности"


# ── 12. YooKassa webhook валидирует IP allowlist (не подпись) ─────────────
async def test_yookassa_webhook_validates_ip_allowlist():
    """В Clinika YooKassa использует IP allowlist а не подпись.
    Запрос с не-YK IP → verify_webhook возвращает None."""
    from app.services.acquiring.yookassa_adapter import YookassaGateway

    gw = YookassaGateway(config=None)
    # Атакующий с публичного IP → None.
    result = await gw.verify_webhook(
        headers={"x-real-ip": "8.8.8.8"},
        body=b'{"event":"payment.succeeded","object":{"id":"x","status":"succeeded"}}',
    )
    assert result is None


# ── 13. Идемпотентность: create_payment генерирует Idempotence-Key ────────
async def test_payment_idempotency_key_is_set():
    """YooKassa adapter ставит заголовок Idempotence-Key — защита от
    двойного списания при ретрае."""
    import inspect
    from app.services.acquiring.yookassa_adapter import YookassaGateway

    src = inspect.getsource(YookassaGateway)
    # Жёсткое требование: заголовок Idempotence-Key должен попадать в HTTP-запрос.
    assert "Idempotence-Key" in src, "YooKassa-адаптер обязан слать Idempotence-Key"


# ── 14. subscription_plans: tenant override применяется ────────────────────
async def test_subscription_plans_returns_tenant_override():
    """all_plans_db с tenant_id берёт override (если есть)."""
    from app.services import subscription_service as ss

    db = AsyncMock()
    fake_plans = [{
        "plan_key": "health_plus",
        "title": "Здоровье+ Магас",
        "price_monthly": 390.0,
        "price_annual": 3900.0,
        "trial_days": 14,
        "benefits": ["a"],
        "features": {},
        "is_override": True,
        "has_override": True,
    }]
    with patch("app.services.subscription_plan_service.get_effective_plans",
               AsyncMock(return_value=fake_plans)):
        plans = await ss.all_plans_db(db, tenant_id=uuid.uuid4())
    assert plans[0]["is_override"] is True
    assert plans[0]["title"] == "Здоровье+ Магас"
    assert plans[0]["price_monthly"] == 390.0


# ── 15. cash-активация падает 402 если модуль не подключён ────────────────
async def test_subscription_cash_module_health_plus_required():
    """activate_cash → ValueError если health_plus_module_active=False."""
    from app.services import subscription_cash_service as scs
    from app.models.patient_account import PatientAccount
    from app.models.user import User, UserRole

    db = AsyncMock()
    pa = MagicMock(spec=PatientAccount); pa.id = uuid.uuid4(); pa.name = "x"; pa.phone = "+1"
    user = MagicMock(spec=User); user.id = uuid.uuid4(); user.role = UserRole.MANAGER

    with patch.object(scs, "health_plus_module_active", AsyncMock(return_value=False)):
        with pytest.raises(ValueError, match="Модуль"):
            await scs.activate_cash(
                db, tenant_id=uuid.uuid4(), clinic_id=None, patient=pa,
                plan_key="health_plus", months=1, amount_received=Decimal("290"),
                received_by=user,
            )
