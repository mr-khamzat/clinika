import json
import hashlib
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.mark.asyncio
async def test_mango_signature_sha256():
    from app.services.telephony.mango import MangoProvider
    p = MangoProvider(api_key="KEY", api_salt="SALT")
    body = '{"a":1}'
    sig = p._signature(body)
    expected = hashlib.sha256(b"KEY" + body.encode() + b"SALT").hexdigest()
    assert sig == expected


@pytest.mark.asyncio
async def test_mango_initiate_ok():
    from app.services.telephony.mango import MangoProvider
    p = MangoProvider(api_key="KEY", api_salt="SALT")
    fake_resp = MagicMock(status_code=200, text="")
    with patch("httpx.AsyncClient") as Client:
        client_inst = AsyncMock()
        client_inst.post = AsyncMock(return_value=fake_resp)
        Client.return_value.__aenter__.return_value = client_inst
        r = await p.initiate_call(from_user_phone="100", to_number="+79001234567")
    assert r.success is True
    assert r.provider_call_id  # uuid hex
    # Проверяем что был передан правильный заголовок и тело
    call_args = client_inst.post.call_args
    headers = call_args.kwargs["headers"]
    sent_body = call_args.kwargs["content"]
    assert headers["X-MPBX-API-Key"] == "KEY"
    expected_sig = hashlib.sha256(b"KEY" + sent_body.encode() + b"SALT").hexdigest()
    assert headers["X-MPBX-Signature"] == expected_sig
    parsed = json.loads(sent_body)
    assert parsed["from"]["number"] == "100"
    assert parsed["to_number"] == "+79001234567"


@pytest.mark.asyncio
async def test_mango_initiate_error():
    from app.services.telephony.mango import MangoProvider
    p = MangoProvider(api_key="KEY", api_salt="SALT")
    fake_resp = MagicMock(status_code=401, text="Unauthorized")
    with patch("httpx.AsyncClient") as Client:
        client_inst = AsyncMock()
        client_inst.post = AsyncMock(return_value=fake_resp)
        Client.return_value.__aenter__.return_value = client_inst
        r = await p.initiate_call(from_user_phone="100", to_number="+79001234567")
    assert r.success is False
    assert "401" in (r.error or "")


@pytest.mark.asyncio
async def test_mango_webhook_maps_state():
    from app.services.telephony.mango import MangoProvider
    p = MangoProvider(api_key="K", api_salt="S")
    out = await p.handle_incoming_webhook({
        "command_id": "cmd-abc",
        "state": "Connected",
        "duration": "37",
        "recording": "https://mango/rec/abc.mp3",
    })
    assert out["ok"] is True
    assert out["provider_call_id"] == "cmd-abc"
    assert out["status"] == "answered"
    assert out["duration_sec"] == 37
    assert out["recording_url"].endswith(".mp3")
    # Disappeared → completed, NoAnswer → missed
    out2 = await p.handle_incoming_webhook({"command_id": "x", "state": "NoAnswer"})
    assert out2["status"] == "missed"
    out3 = await p.handle_incoming_webhook({"entry_id": "e1", "state": "Disappeared"})
    assert out3["provider_call_id"] == "e1"
    assert out3["status"] == "completed"
