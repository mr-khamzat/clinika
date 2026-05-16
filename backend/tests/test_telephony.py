"""Unit-тесты для telephony: NullProvider, factory, нормализация телефонов, serializers."""
import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock


@pytest.mark.asyncio
async def test_null_provider_returns_error_on_dial():
    from app.services.telephony.null import NullProvider
    r = await NullProvider().initiate_call(from_user_phone="+79991234567", to_number="+79007777777")
    assert r.success is False
    assert "не настроен" in (r.error or "")


@pytest.mark.asyncio
async def test_get_provider_returns_null_when_no_config():
    from app.services.telephony.factory import get_provider
    from app.services.telephony.null import NullProvider
    db = AsyncMock()
    db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=lambda: None))
    p = await get_provider(db, uuid.uuid4())
    assert isinstance(p, NullProvider)


@pytest.mark.asyncio
async def test_get_provider_returns_null_when_inactive():
    from app.services.telephony.factory import get_provider
    from app.services.telephony.null import NullProvider
    cfg = MagicMock(provider="mango", is_active=False)
    db = AsyncMock()
    db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=lambda: cfg))
    p = await get_provider(db, uuid.uuid4())
    assert isinstance(p, NullProvider)


def test_normalize_phone_valid():
    from app.routers.tenant_telephony import _normalize_phone
    assert _normalize_phone("+7 (999) 123-45-67") == "+79991234567"
    assert _normalize_phone("8 999 123 45 67") == "+79991234567"
    assert _normalize_phone("9991234567") == "+79991234567"


def test_normalize_phone_invalid_raises():
    from app.routers.tenant_telephony import _normalize_phone, InvalidPhoneError
    with pytest.raises(InvalidPhoneError):
        _normalize_phone("123")  # слишком короткий
    with pytest.raises(InvalidPhoneError):
        _normalize_phone("")


@pytest.mark.asyncio
async def test_get_telephony_config_returns_no_secrets():
    from app.routers.tenant_telephony import _serialize_config
    cfg = MagicMock(
        id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        provider="mango",
        api_url="https://app.mango-office.ru",
        api_key_encrypted="encrypted_KEY",
        api_secret_encrypted="encrypted_SECRET",
        is_active=True,
        features={"record_calls": True},
    )
    out = _serialize_config(cfg)
    # Секреты — только has_*, не сами значения
    assert "api_key_encrypted" not in out
    assert "api_secret_encrypted" not in out
    assert out["has_api_key"] is True
    assert out["has_api_secret"] is True
    assert out["provider"] == "mango"


def test_serialize_config_returns_defaults_when_none():
    from app.routers.tenant_telephony import _serialize_config
    out = _serialize_config(None)
    assert out["provider"] == "null"
    assert out["is_active"] is False
    assert out["has_api_key"] is False
    assert out["has_api_secret"] is False


@pytest.mark.asyncio
async def test_dial_creates_phone_call_record():
    """При попытке dial должен создаться PhoneCall record (даже если провайдер NullProvider)."""
    from app.routers.tenant_telephony import _create_outgoing_call
    db = AsyncMock()
    db.add = MagicMock()
    user = MagicMock(id=uuid.uuid4(), tenant_id=uuid.uuid4(), clinic_id=None)
    call = await _create_outgoing_call(db, user, to_number="+79007777777", provider_call_id=None, status="failed")
    # PhoneCall должен быть добавлен в db
    db.add.assert_called_once()
    added = db.add.call_args[0][0]
    assert added.direction == "out"
    assert added.external_number == "+79007777777"
    assert added.tenant_id == user.tenant_id
    assert added.operator_id == user.id


def test_did_validation_via_pydantic():
    from app.routers.tenant_telephony import DidIn
    # Корректный
    d = DidIn(number="+79991234567", display_name="Тест")
    assert d.number == "+79991234567"
    # Некорректный — должен либо нормализоваться, либо raise
    with pytest.raises(ValueError):
        DidIn(number="abc", display_name="x")
