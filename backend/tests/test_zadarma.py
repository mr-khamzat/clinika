import base64
import hashlib
import hmac
import urllib.parse

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.mark.asyncio
async def test_zadarma_signature_base64_hmac_sha1():
    from app.services.telephony.zadarma import ZadarmaProvider, CALLBACK_PATH
    p = ZadarmaProvider(user_key="KEY", secret="SECRET")
    params = {"from": "100", "to": "+79001234567"}
    sig = p._signature(CALLBACK_PATH, params)
    # Эталон: base64(hmac_sha1(method_path + sorted_qs + md5(""), secret))
    sorted_qs = urllib.parse.urlencode(sorted(params.items()))
    body_md5 = hashlib.md5(b"").hexdigest()
    assert body_md5 == "d41d8cd98f00b204e9800998ecf8427e"
    raw = CALLBACK_PATH + sorted_qs + body_md5
    expected = base64.b64encode(
        hmac.new(b"SECRET", raw.encode("utf-8"), hashlib.sha1).digest()
    ).decode("ascii")
    assert sig == expected


@pytest.mark.asyncio
async def test_zadarma_initiate_success():
    from app.services.telephony.zadarma import ZadarmaProvider
    p = ZadarmaProvider(user_key="K", secret="S")
    fake_resp = MagicMock(status_code=200)
    fake_resp.json = MagicMock(return_value={"status": "success", "request_id": 12345})
    with patch("httpx.AsyncClient") as Client:
        client_inst = AsyncMock()
        client_inst.get = AsyncMock(return_value=fake_resp)
        Client.return_value.__aenter__.return_value = client_inst
        r = await p.initiate_call(from_user_phone="100", to_number="+79001234567")
    assert r.success is True
    assert r.provider_call_id == "12345"


@pytest.mark.asyncio
async def test_zadarma_initiate_error_response():
    from app.services.telephony.zadarma import ZadarmaProvider
    p = ZadarmaProvider(user_key="K", secret="S")
    fake_resp = MagicMock(status_code=200)
    fake_resp.json = MagicMock(return_value={"status": "error", "message": "invalid auth"})
    with patch("httpx.AsyncClient") as Client:
        client_inst = AsyncMock()
        client_inst.get = AsyncMock(return_value=fake_resp)
        Client.return_value.__aenter__.return_value = client_inst
        r = await p.initiate_call(from_user_phone="100", to_number="+79001234567")
    assert r.success is False
    assert "invalid auth" in (r.error or "")


@pytest.mark.asyncio
async def test_zadarma_webhook_disposition_maps():
    from app.services.telephony.zadarma import ZadarmaProvider
    p = ZadarmaProvider(user_key="K", secret="S")
    out_ans = await p.handle_incoming_webhook({
        "event": "NOTIFY_END", "pbx_call_id": "abc1", "duration": "42",
        "disposition": "ANSWERED",
    })
    assert out_ans["status"] == "answered"
    assert out_ans["provider_call_id"] == "abc1"
    assert out_ans["duration_sec"] == 42

    out_miss = await p.handle_incoming_webhook({
        "event": "NOTIFY_END", "pbx_call_id": "abc2", "disposition": "NO ANSWER",
    })
    assert out_miss["status"] == "missed"

    out_busy = await p.handle_incoming_webhook({
        "event": "NOTIFY_END", "pbx_call_id": "abc3", "disposition": "BUSY",
    })
    assert out_busy["status"] == "rejected"
