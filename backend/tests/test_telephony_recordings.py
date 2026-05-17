"""Тесты fetch_recording — Sipuni / Mango / Zadarma.

По 2 теста на каждого провайдера:
  - happy path: HTTP 200 + audio/* → возвращает bytes
  - HTTP 404 / network exception → возвращает None, ничего не падает.
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


# ── Sipuni ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_sipuni_fetch_recording_ok_returns_bytes():
    from app.services.telephony.sipuni import SipuniProvider
    p = SipuniProvider(sipuni_id="u1", secret_key="s1")
    audio_bytes = b"ID3\x03\x00\x00fake-mp3-payload"
    fake_resp = MagicMock(
        status_code=200,
        headers={"content-type": "audio/mpeg"},
        content=audio_bytes,
        text="",
    )
    with patch("httpx.AsyncClient") as Client:
        client_inst = AsyncMock()
        client_inst.post = AsyncMock(return_value=fake_resp)
        Client.return_value.__aenter__.return_value = client_inst
        out = await p.fetch_recording("call-abc")
    assert out == audio_bytes


@pytest.mark.asyncio
async def test_sipuni_fetch_recording_404_returns_none():
    from app.services.telephony.sipuni import SipuniProvider
    p = SipuniProvider(sipuni_id="u1", secret_key="s1")
    fake_resp = MagicMock(
        status_code=404,
        headers={"content-type": "application/json"},
        content=b"",
        text='{"error":"not found"}',
    )
    with patch("httpx.AsyncClient") as Client:
        client_inst = AsyncMock()
        client_inst.post = AsyncMock(return_value=fake_resp)
        Client.return_value.__aenter__.return_value = client_inst
        out = await p.fetch_recording("call-zzz")
    assert out is None


# ── Mango ─────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_mango_fetch_recording_ok_returns_bytes():
    from app.services.telephony.mango import MangoProvider
    p = MangoProvider(api_key="k", api_salt="s")
    audio_bytes = b"\xff\xfbfake-mango-mp3"
    fake_resp = MagicMock(
        status_code=200,
        headers={"content-type": "audio/mpeg"},
        content=audio_bytes,
        text="",
    )
    with patch("httpx.AsyncClient") as Client:
        client_inst = AsyncMock()
        client_inst.post = AsyncMock(return_value=fake_resp)
        Client.return_value.__aenter__.return_value = client_inst
        out = await p.fetch_recording("rec-123")
    assert out == audio_bytes


@pytest.mark.asyncio
async def test_mango_fetch_recording_network_error_returns_none():
    from app.services.telephony.mango import MangoProvider
    p = MangoProvider(api_key="k", api_salt="s")
    with patch("httpx.AsyncClient") as Client:
        client_inst = AsyncMock()
        client_inst.post = AsyncMock(side_effect=Exception("connection refused"))
        Client.return_value.__aenter__.return_value = client_inst
        out = await p.fetch_recording("rec-xxx")
    assert out is None


# ── Zadarma ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_zadarma_fetch_recording_ok_two_step_returns_bytes():
    from app.services.telephony.zadarma import ZadarmaProvider
    p = ZadarmaProvider(user_key="uk", secret="sec")
    audio_bytes = b"OggS\x00\x02fake-zadarma-audio"
    # Шаг 1: API возвращает JSON с signed link
    step1_resp = MagicMock(
        status_code=200,
        headers={"content-type": "application/json"},
        text='{"status":"success","link":"https://cdn.zadarma.com/rec/abc.mp3"}',
    )
    step1_resp.json = MagicMock(
        return_value={"status": "success", "link": "https://cdn.zadarma.com/rec/abc.mp3"}
    )
    # Шаг 2: signed link отдаёт bytes
    step2_resp = MagicMock(
        status_code=200,
        headers={"content-type": "audio/mpeg"},
        content=audio_bytes,
        text="",
    )
    with patch("httpx.AsyncClient") as Client:
        client_inst = AsyncMock()
        client_inst.get = AsyncMock(side_effect=[step1_resp, step2_resp])
        Client.return_value.__aenter__.return_value = client_inst
        out = await p.fetch_recording("pbx-call-1")
    assert out == audio_bytes


@pytest.mark.asyncio
async def test_zadarma_fetch_recording_404_returns_none():
    from app.services.telephony.zadarma import ZadarmaProvider
    p = ZadarmaProvider(user_key="uk", secret="sec")
    step1_resp = MagicMock(
        status_code=404,
        headers={"content-type": "application/json"},
        text='{"status":"error","message":"not found"}',
    )
    step1_resp.json = MagicMock(
        return_value={"status": "error", "message": "not found"}
    )
    with patch("httpx.AsyncClient") as Client:
        client_inst = AsyncMock()
        client_inst.get = AsyncMock(return_value=step1_resp)
        Client.return_value.__aenter__.return_value = client_inst
        out = await p.fetch_recording("pbx-call-zzz")
    assert out is None
