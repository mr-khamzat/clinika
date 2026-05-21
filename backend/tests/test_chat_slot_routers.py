"""
chatslot01: smoke-тесты роутеров — RBAC + 401/403 без auth.

Полный end-to-end через httpx ASGITransport (фикстура `client` из conftest).
Без токенов/сессий должны получать 401 (clinic_chat через HTTPBearer,
patient_chat через `Patient session required`).
"""
import pytest


pytestmark = pytest.mark.asyncio


async def test_slot_offer_requires_auth(client):
    """POST /clinic-chat/threads/{tid}/slot-offer без токена → 401/403."""
    resp = await client.post(
        "/clinic-chat/threads/00000000-0000-0000-0000-000000000000/slot-offer",
        json={
            "doctor_id": "00000000-0000-0000-0000-000000000000",
            "service_id": "00000000-0000-0000-0000-000000000000",
            "slots": [
                {
                    "idx": 0,
                    "start_at": "2026-06-01T10:00:00",
                    "duration_min": 30,
                }
            ],
        },
    )
    assert resp.status_code in (401, 403), resp.text


async def test_book_slot_requires_patient_auth(client):
    """POST /patient/chat/threads/{tid}/book-slot без токена → 401/403."""
    resp = await client.post(
        "/patient/chat/threads/00000000-0000-0000-0000-000000000000/book-slot",
        json={
            "message_id": "00000000-0000-0000-0000-000000000000",
            "slot_idx": 0,
        },
    )
    assert resp.status_code in (401, 403), resp.text


async def test_slot_request_requires_patient_auth(client):
    """POST /patient/chat/threads/{tid}/slot-request без токена → 401/403."""
    resp = await client.post(
        "/patient/chat/threads/00000000-0000-0000-0000-000000000000/slot-request",
        json={"preferred_dates": ["2026-06-01"]},
    )
    assert resp.status_code in (401, 403), resp.text
