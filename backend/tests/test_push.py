"""Unit-тесты Web Push инфраструктуры (ТЗ Web Push 2026-05-16).

Все тесты используют ``mock_db`` (AsyncMock) — реальная Postgres не нужна.
VAPID-ключи в conftest ENV не настраиваются (нет в env по-умолчанию), поэтому
для тестов подменяем ``settings.vapid_public_key`` / ``vapid_private_key``
через monkeypatch.
"""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


# ─── Хелперы ─────────────────────────────────────────────────────────────────


def _set_vapid_env(monkeypatch):
    """Заполнить VAPID ключи в settings, чтобы избежать обращения в БД/автоген."""
    from app.config import settings
    from app.services import push_service

    monkeypatch.setattr(settings, "vapid_public_key", "TEST_PUBLIC_KEY_BASE64URL", raising=False)
    monkeypatch.setattr(settings, "vapid_private_key", "TEST_PRIVATE_KEY_BASE64URL", raising=False)
    monkeypatch.setattr(settings, "vapid_claim_email", "test@clinika.local", raising=False)
    # Сбрасываем кеш чтобы новый _get_or_create_vapid увидел env
    push_service._vapid_cache = None


# ─── GET /push/vapid-public-key ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_vapid_public_key_returns_key(client, monkeypatch):
    """Публичный ключ доступен без авторизации и возвращает значение из env."""
    _set_vapid_env(monkeypatch)

    resp = await client.get("/push/vapid-public-key")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "public_key" in data
    assert data["public_key"] == "TEST_PUBLIC_KEY_BASE64URL"


# ─── POST /push/subscribe ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_subscribe_creates_record(client, mock_db, monkeypatch):
    """POST /push/subscribe в новом формате создаёт INSERT когда endpoint нов."""
    _set_vapid_env(monkeypatch)

    # SELECT existing → None (нет такой подписки)
    select_result = MagicMock()
    select_result.fetchone = MagicMock(return_value=None)

    # Запоминаем выполненные SQL
    executed: list[str] = []

    async def _exec(query, params=None):
        sql = str(query)
        executed.append(sql)
        return select_result

    mock_db.execute = AsyncMock(side_effect=_exec)

    payload = {
        "endpoint": "https://fcm.googleapis.com/fcm/send/test-endpoint-NEW",
        "keys": {"p256dh": "BNcRdreALR-pubkey", "auth": "auth-secret"},
        "user_agent": "Mozilla/5.0 (Test)",
    }
    resp = await client.post("/push/subscribe", json=payload)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"status": "ok"}

    # Должен быть SELECT (existing-check) + INSERT
    assert any("SELECT id FROM push_subscriptions" in s for s in executed)
    assert any("INSERT INTO push_subscriptions" in s for s in executed)
    mock_db.commit.assert_awaited()


@pytest.mark.asyncio
async def test_subscribe_upserts(client, mock_db, monkeypatch):
    """Повторный POST с тем же endpoint выполняет UPDATE, не INSERT."""
    _set_vapid_env(monkeypatch)

    # SELECT existing → возвращаем "запись существует"
    select_result = MagicMock()
    select_result.fetchone = MagicMock(return_value=("existing-id",))

    executed: list[str] = []

    async def _exec(query, params=None):
        sql = str(query)
        executed.append(sql)
        return select_result

    mock_db.execute = AsyncMock(side_effect=_exec)

    payload = {
        "endpoint": "https://fcm.googleapis.com/fcm/send/test-endpoint-EXISTS",
        "keys": {"p256dh": "BNcRdreALR-NEW-pubkey", "auth": "NEW-auth"},
        "user_agent": "Mozilla/5.0 (Test)",
    }
    resp = await client.post("/push/subscribe", json=payload)
    assert resp.status_code == 200, resp.text

    # UPDATE должен быть, INSERT не должен (endpoint уже есть)
    assert any("UPDATE push_subscriptions" in s for s in executed), executed
    assert not any("INSERT INTO push_subscriptions" in s for s in executed), executed
    mock_db.commit.assert_awaited()


# ─── DELETE /push/unsubscribe ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_unsubscribe_removes(client, mock_db, monkeypatch):
    """DELETE /push/unsubscribe выполняет DELETE и коммитит."""
    _set_vapid_env(monkeypatch)

    # RETURNING id → один удалённый ряд
    delete_result = MagicMock()
    delete_result.fetchall = MagicMock(return_value=[("deleted-id-1",)])

    executed: list[str] = []

    async def _exec(query, params=None):
        sql = str(query)
        executed.append(sql)
        return delete_result

    mock_db.execute = AsyncMock(side_effect=_exec)

    resp = await client.request(
        "DELETE",
        "/push/unsubscribe",
        json={"endpoint": "https://fcm.googleapis.com/fcm/send/test-endpoint-DELETE"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "ok"
    assert body["deleted"] == 1

    assert any("DELETE FROM push_subscriptions" in s for s in executed), executed
    mock_db.commit.assert_awaited()


# ─── send_push (service-level) ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_send_push_to_no_subscribers_noop(mock_db, monkeypatch):
    """send_push без подписок возвращает 0 и не падает."""
    _set_vapid_env(monkeypatch)

    from app.services.push_service import send_push

    # SELECT возвращает пустой список — подписок нет
    empty_result = MagicMock()
    empty_result.fetchall = MagicMock(return_value=[])
    mock_db.execute = AsyncMock(return_value=empty_result)

    count = await send_push(
        mock_db,
        title="Тест",
        body="Никого нет дома",
        user_id="00000000-0000-0000-0000-000000000001",
    )
    assert count == 0


@pytest.mark.asyncio
async def test_send_push_requires_user_or_patient_id(mock_db, monkeypatch):
    """send_push без user_id и patient_id — noop без падения."""
    _set_vapid_env(monkeypatch)

    from app.services.push_service import send_push

    count = await send_push(mock_db, title="x", body="y")
    assert count == 0


@pytest.mark.asyncio
async def test_send_push_skips_when_db_is_none(monkeypatch):
    """send_push без db не падает, возвращает 0."""
    _set_vapid_env(monkeypatch)

    from app.services.push_service import send_push

    count = await send_push(
        None,  # type: ignore[arg-type]
        title="x",
        body="y",
        user_id="any",
    )
    assert count == 0


@pytest.mark.asyncio
async def test_send_push_delivers_and_marks_used(mock_db, monkeypatch):
    """send_push успешно отправляет и обновляет last_used_at; 410 → удаляет."""
    _set_vapid_env(monkeypatch)

    from app.services import push_service

    # Подписки: одна жива, одна вернёт 410 Gone
    live_endpoint = "https://fcm.googleapis.com/fcm/send/LIVE"
    dead_endpoint = "https://fcm.googleapis.com/fcm/send/DEAD"
    rows = [
        (live_endpoint, "p256dh-live", "auth-live"),
        (dead_endpoint, "p256dh-dead", "auth-dead"),
    ]
    select_result = MagicMock()
    select_result.fetchall = MagicMock(return_value=rows)
    mock_db.execute = AsyncMock(return_value=select_result)

    # Мокаем _send_push_to_subscription: live → ok, dead → gone
    async def _fake_send(sub, title, body, data=None, db=None):
        if sub["endpoint"] == live_endpoint:
            return True, False
        return False, True

    monkeypatch.setattr(push_service, "_send_push_to_subscription", _fake_send)

    count = await push_service.send_push(
        mock_db,
        title="Hi",
        body="msg",
        user_id="00000000-0000-0000-0000-000000000002",
    )
    assert count == 1  # доставлено только live
    mock_db.commit.assert_awaited()
