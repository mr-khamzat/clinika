import pytest
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.mark.asyncio
async def test_sipuni_signature_md5_correct_order():
    from app.services.telephony.sipuni import SipuniProvider
    p = SipuniProvider(sipuni_id="123", secret_key="SECRET")
    sig = p._signature(from_num="100", to_num="+79001234567", ts=1000)
    # Ожидаем md5("100" + "123" + "1000" + "+79001234567" + "SECRET")
    import hashlib
    expected = hashlib.md5(b"1001231000+79001234567SECRET").hexdigest()
    assert sig == expected


@pytest.mark.asyncio
async def test_sipuni_initiate_ok_returns_success():
    from app.services.telephony.sipuni import SipuniProvider
    p = SipuniProvider(sipuni_id="x", secret_key="y")
    fake_resp = MagicMock(status_code=200, text="callId-12345\n")
    with patch("httpx.AsyncClient") as Client:
        client_inst = AsyncMock()
        client_inst.post = AsyncMock(return_value=fake_resp)
        Client.return_value.__aenter__.return_value = client_inst
        r = await p.initiate_call(from_user_phone="100", to_number="+79001234567")
    assert r.success is True
    assert r.provider_call_id == "callId-12345"


@pytest.mark.asyncio
async def test_sipuni_initiate_error_response():
    from app.services.telephony.sipuni import SipuniProvider
    p = SipuniProvider(sipuni_id="x", secret_key="y")
    fake_resp = MagicMock(status_code=200, text="Error: incorrect signature")
    with patch("httpx.AsyncClient") as Client:
        client_inst = AsyncMock()
        client_inst.post = AsyncMock(return_value=fake_resp)
        Client.return_value.__aenter__.return_value = client_inst
        r = await p.initiate_call(from_user_phone="100", to_number="+79001234567")
    assert r.success is False
    assert "Error" in (r.error or "")


@pytest.mark.asyncio
async def test_sipuni_initiate_network_exception():
    from app.services.telephony.sipuni import SipuniProvider
    p = SipuniProvider(sipuni_id="x", secret_key="y")
    with patch("httpx.AsyncClient") as Client:
        client_inst = AsyncMock()
        client_inst.post = AsyncMock(side_effect=Exception("connection refused"))
        Client.return_value.__aenter__.return_value = client_inst
        r = await p.initiate_call(from_user_phone="100", to_number="+79001234567")
    assert r.success is False
    assert "недоступен" in (r.error or "")


@pytest.mark.asyncio
async def test_webhook_maps_status():
    from app.services.telephony.sipuni import SipuniProvider
    p = SipuniProvider(sipuni_id="x", secret_key="y")
    out = await p.handle_incoming_webhook({
        "call_id": "abc123", "status": "CONNECTED", "duration": "42",
        "record_url": "https://sipuni.com/rec/abc.mp3",
    })
    assert out["status"] == "answered"
    assert out["duration_sec"] == 42
    assert out["recording_url"].endswith(".mp3")
    out2 = await p.handle_incoming_webhook({"call_id": "x", "status": "NOANSWER"})
    assert out2["status"] == "missed"
