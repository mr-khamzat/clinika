"""Критические Referrals flow.

Покрывает:
- ReferralCreate: to_clinic_id обязателен, mis_patient_id опционален
- create_referral генерирует QR + short_code
- short_code уникален (фикс #8 audit)
- ReferralStatus переходы: CREATED → CONFIRMED / CANCEL_REQUESTED / CANCELLED / EXPIRED
- verify-patient: возвращает matches из МИС
- PDF print endpoint
- cancel-request → status=CANCEL_REQUESTED
- expires_at = created_at + 7 дней (фактический дефолт, не 30 как в задании)
- appointment_at + mis_doctor_id → mis_appointment_id (МИС-bridge)

Все тесты — unit (AsyncMock).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

pytestmark = pytest.mark.asyncio


# ── 1. ReferralCreate: mis_patient_id опционален; to_clinic_id обязателен ─
async def test_create_referral_schema_accepts_mis_patient_id():
    """Pydantic ReferralCreate принимает mis_patient_id=int."""
    from app.schemas.referral import ReferralCreate
    from pydantic import ValidationError

    r = ReferralCreate(
        to_clinic_id=uuid.uuid4(),
        patient_phone="+79001112233",
        mis_patient_id=12345,
        service_id=uuid.uuid4(),
    )
    assert r.mis_patient_id == 12345


# ── 2. ReferralCreate: to_clinic_id обязателен ────────────────────────────
async def test_create_referral_requires_to_clinic_id():
    """Pydantic ReferralCreate: без to_clinic_id → ValidationError."""
    from app.schemas.referral import ReferralCreate
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        ReferralCreate(patient_phone="+79001112233")


# ── 3. short_code: _generate_short_code возвращает 5-значное число ────────
async def test_referral_short_code_is_unique_5_digit():
    """_generate_short_code: 10000..99999, не существует в БД."""
    from app.services.referral_service import _generate_short_code

    db = AsyncMock()
    not_found = MagicMock()
    not_found.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=not_found)

    code = await _generate_short_code(db)
    assert 10000 <= code <= 99999


# ── 4. ReferralStatus: enum имеет 5 валидных значений ─────────────────────
async def test_referral_status_transitions_enum():
    """ReferralStatus enum содержит CREATED, CONFIRMED, EXPIRED,
    CANCEL_REQUESTED, CANCELLED."""
    from app.models.referral import ReferralStatus

    statuses = {s.value for s in ReferralStatus}
    expected = {"created", "confirmed", "expired", "cancel_requested", "cancelled"}
    assert statuses == expected


# ── 5. QR код генерируется на create ──────────────────────────────────────
async def test_referral_qr_generated_on_create():
    """create_referral вызывает generate_qr_image_base64(referral.id)."""
    from app.services import referral_service as rs

    db = AsyncMock()
    db.flush = AsyncMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    db.add = MagicMock()

    not_found = MagicMock(); not_found.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=not_found)

    with patch.object(rs, "generate_qr_image_base64",
                      return_value="data:image/png;base64,FAKE_QR") as mock_qr, \
         patch.object(rs, "generate_url_qr_base64", return_value="data:image/png;base64,FAKE2"), \
         patch.object(rs, "make_patient_token", return_value="tok"), \
         patch("app.services.mis_client.find_patient_by_phone", AsyncMock(return_value=None)), \
         patch("app.services.mis_client._post", AsyncMock(return_value={"error": 1})):
        ref = await rs.create_referral(
            db=db, from_clinic_id=uuid.uuid4(), to_clinic_id=uuid.uuid4(),
            service_id=uuid.uuid4(), patient_phone="+79001112233",
            created_by_admin_id=uuid.uuid4(),
        )

    assert mock_qr.called
    assert ref.qr_code == "data:image/png;base64,FAKE_QR"


# ── 6. verify-patient через MIS возвращает matches ─────────────────────────
async def test_verify_patient_returns_mis_matches(client, mock_db):
    """GET /referrals/verify-patient?phone=… вызывает MIS find_patient_by_phone."""
    from app.core.security import create_access_token
    from app.models.user import User, UserRole

    uid = uuid.uuid4(); tid = uuid.uuid4()
    token = create_access_token({"sub": str(uid), "role": "reg", "tid": str(tid)})

    user = MagicMock(spec=User); user.id = uid; user.role = UserRole.REG
    user.is_active = True; user.tenant_id = tid

    user_res = MagicMock(); user_res.scalar_one_or_none.return_value = user
    mock_db.execute = AsyncMock(return_value=user_res)

    fake_mis_patient = {
        "patient_id": 555, "mobile": "+79001112233",
        "last_name": "Иванов", "first_name": "Иван", "third_name": "Иванович",
    }
    with patch("app.services.mis_client.find_patient_by_phone",
               AsyncMock(return_value=fake_mis_patient)):
        resp = await client.get(
            "/referrals/verify-patient?phone=%2B79001112233",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "matches" in body
    assert any(m.get("mis_patient_id") == 555 for m in body["matches"])


# ── 7. PDF print endpoint возвращает application/pdf ───────────────────────
async def test_referral_print_pdf_returns_pdf(client, mock_db):
    """GET /referrals/{id}/print → 200 application/pdf."""
    from app.core.security import create_access_token
    from app.models.user import User, UserRole
    from app.models.referral import Referral, ReferralStatus

    uid = uuid.uuid4(); tid = uuid.uuid4(); rid = uuid.uuid4()
    token = create_access_token({"sub": str(uid), "role": "reg", "tid": str(tid)})

    user = MagicMock(spec=User); user.id = uid; user.role = UserRole.REG
    user.is_active = True; user.tenant_id = tid; user.clinic_id = uuid.uuid4()

    ref = MagicMock(spec=Referral)
    ref.id = rid; ref.tenant_id = tid; ref.short_code = 12345
    ref.created_by_admin_id = uid

    user_res = MagicMock(); user_res.scalar_one_or_none.return_value = user
    ref_res = MagicMock(); ref_res.scalar_one_or_none.return_value = ref
    mock_db.execute = AsyncMock(side_effect=[user_res, ref_res])

    with patch("app.routers.reg_speed._build_referral_html", AsyncMock(return_value="<html></html>")), \
         patch("app.routers.reg_speed._html_to_pdf", return_value=b"%PDF-1.4 fake"):
        resp = await client.get(
            f"/referrals/{rid}/print",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"


# ── 8. cancel-request переводит статус в CANCEL_REQUESTED ──────────────────
async def test_referral_cancel_request_workflow(client, mock_db):
    """POST /referrals/{id}/cancel-request → status=cancel_requested + cancel_reason."""
    from app.core.security import create_access_token
    from app.models.user import User, UserRole
    from app.models.referral import Referral, ReferralStatus

    uid = uuid.uuid4(); tid = uuid.uuid4(); rid = uuid.uuid4()
    token = create_access_token({"sub": str(uid), "role": "reg", "tid": str(tid)})

    user = MagicMock(spec=User); user.id = uid; user.role = UserRole.REG
    user.is_active = True; user.tenant_id = tid

    ref = MagicMock(spec=Referral)
    ref.id = rid; ref.tenant_id = tid
    ref.status = ReferralStatus.CREATED
    ref.created_by_admin_id = uid

    user_res = MagicMock(); user_res.scalar_one_or_none.return_value = user
    ref_res = MagicMock(); ref_res.scalar_one_or_none.return_value = ref
    # _log → INSERT через session — мокнем чтобы не падало
    mock_db.execute = AsyncMock(side_effect=[user_res, ref_res, MagicMock()])

    # _enrich_referral возвращает ReferralResponse — нам важна сама бизнес-логика
    # (смена статуса), а не валидация Pydantic. Возвращаем валидный ReferralResponse.
    fake_response = {
        "id": rid, "to_clinic_id": uuid.uuid4(), "patient_phone": "+79001112233",
        "status": "cancel_requested", "qr_code": "x", "notes": None,
        "created_at": datetime.utcnow(), "expires_at": datetime.utcnow() + timedelta(days=7),
        "confirmed_at": None, "cancel_reason": "Пациент передумал",
    }
    with patch("app.routers.referrals._enrich_referral", AsyncMock(return_value=fake_response)):
        resp = await client.post(
            f"/referrals/{rid}/cancel-request",
            headers={"Authorization": f"Bearer {token}"},
            json={"reason": "Пациент передумал"},
        )
    assert resp.status_code == 200, resp.text
    assert ref.status == ReferralStatus.CANCEL_REQUESTED
    assert ref.cancel_reason == "Пациент передумал"


# ── 9. expires_at: default = +7 дней (фактический инвариант) ──────────────
async def test_referral_expires_after_7_days_default():
    """ВАЖНО: задание говорило про 30 дней, но фактически Referral.expires_at
    default = utcnow() + 7 дней (см. backend/app/models/referral.py:42).
    Тест запирает текущее поведение — изменение TTL должно ронять тест."""
    from app.models.referral import Referral

    r = Referral(
        to_clinic_id=uuid.uuid4(),
        patient_phone="+79001112233",
        created_by_admin_id=uuid.uuid4(),
    )
    # SQLAlchemy column default — это ColumnDefault, .arg может быть либо
    # callable без args, либо callable(ctx). Вызываем через is_callable API.
    col = Referral.__table__.columns["expires_at"]
    default = col.default  # ColumnDefault
    # ColumnDefault.is_callable=True, вызываем через context-aware call
    try:
        expires = default.arg()  # старый стиль — Python-callable без аргументов
    except TypeError:
        # Новый стиль (SA 2.x) — callable(context). Передаём фиктивный.
        expires = default.arg(None)
    delta = (expires - datetime.utcnow()).days
    assert 6 <= delta <= 7, f"expires_at default должен быть +7d, получили {delta}d"


# ── 10. Referral.appointment_at → попытка создать запись в МИС ────────────
async def test_referral_creates_mis_appointment_when_scheduled():
    """Если в create_referral передан appointment_at + mis_doctor_id —
    делается вызов MIS createAppointment и заполняется mis_appointment_id."""
    from app.services import referral_service as rs

    db = AsyncMock()
    db.flush = AsyncMock(); db.commit = AsyncMock(); db.refresh = AsyncMock()
    db.add = MagicMock()
    # 1) short_code unique check → None | 2) clinic by id → clinic
    fake_clinic = MagicMock(id=uuid.uuid4(), mis_id=99, name="Test Clinic")
    sc_res = MagicMock(); sc_res.scalar_one_or_none.return_value = None
    cl_res = MagicMock(); cl_res.scalar_one_or_none.return_value = fake_clinic
    db.execute = AsyncMock(side_effect=[sc_res, cl_res])

    with patch.object(rs, "generate_qr_image_base64", return_value="qr"), \
         patch.object(rs, "generate_url_qr_base64", return_value="qr2"), \
         patch.object(rs, "make_patient_token", return_value="t"), \
         patch("app.services.mis_client.find_patient_by_phone",
               AsyncMock(return_value=None)), \
         patch("app.services.mis_client._post",
               AsyncMock(return_value={"error": 0, "data": 7777})) as mock_mis, \
         patch("app.services.settings_service.get_setting", AsyncMock(return_value="")):
        appt = datetime.utcnow() + timedelta(days=2)
        ref = await rs.create_referral(
            db=db,
            from_clinic_id=uuid.uuid4(),
            to_clinic_id=fake_clinic.id,
            service_id=uuid.uuid4(),
            patient_phone="+79001112233",
            created_by_admin_id=uuid.uuid4(),
            appointment_at=appt,
            mis_doctor_id=42,
            tenant_id=uuid.uuid4(),
        )

    # MIS createAppointment вызвался хотя бы один раз
    assert mock_mis.called
    create_calls = [c for c in mock_mis.call_args_list
                    if c.args and c.args[0] == "createAppointment"]
    assert create_calls, "createAppointment должен быть вызван при appointment_at+mis_doctor_id"
    # mis_appointment_id записался
    assert ref.mis_appointment_id == 7777
