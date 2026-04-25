"""Тесты изоляции тенантов и JWT-токенов Clinika backend.

Проверяют:
- создание access token с tenant_id
- наличие jti в payload для blacklist
- decode_token возвращает None для невалидного токена
"""
import os
import pytest

# Переменные окружения для импорта app.core.security
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost/test")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-pytest-32chars!!")
os.environ.setdefault("QR_SECRET", "test-qr-secret")
os.environ.setdefault("SUPERADMIN_USERNAME", "testadmin")
os.environ.setdefault("SUPERADMIN_PASSWORD", "testpass")
os.environ.setdefault("SUPERADMIN_FULL_NAME", "Test Admin")

pytestmark = pytest.mark.asyncio


def test_tenant_id_in_token_payload():
    """tenant_id (поле tid) попадает в JWT payload и корректно декодируется."""
    from app.core.security import create_access_token, decode_token

    token = create_access_token(data={"sub": "user@test.com", "tid": "tenant-abc"})
    payload = decode_token(token)

    assert payload is not None
    assert payload.get("tid") == "tenant-abc"
    assert payload.get("sub") == "user@test.com"


def test_create_access_token_has_jti():
    """Access token содержит jti для revocation через blacklist."""
    from app.core.security import create_access_token, decode_token

    token = create_access_token(data={"sub": "user@test.com"})
    payload = decode_token(token)

    assert payload is not None
    assert "jti" in payload
    assert len(payload["jti"]) > 0


def test_create_access_token_has_exp():
    """Access token содержит exp (время истечения)."""
    from app.core.security import create_access_token, decode_token

    token = create_access_token(data={"sub": "user@test.com"})
    payload = decode_token(token)

    assert payload is not None
    assert "exp" in payload
    assert payload["exp"] > 0


def test_create_access_token_type():
    """Access token содержит type=access."""
    from app.core.security import create_access_token, decode_token

    token = create_access_token(data={"sub": "user@test.com"})
    payload = decode_token(token)

    assert payload is not None
    assert payload.get("type") == "access"


def test_decode_token_invalid():
    """decode_token возвращает None для невалидного токена."""
    from app.core.security import decode_token

    result = decode_token("invalid.token.here")
    assert result is None


def test_decode_token_tampered():
    """decode_token возвращает None для подделанного токена."""
    from app.core.security import create_access_token, decode_token

    token = create_access_token(data={"sub": "user@test.com"})
    # Меняем последний символ — нарушаем подпись
    tampered = token[:-1] + ("X" if token[-1] != "X" else "Y")
    result = decode_token(tampered)
    assert result is None


def test_two_tokens_have_different_jti():
    """Каждый токен получает уникальный jti."""
    from app.core.security import create_access_token, decode_token

    token1 = create_access_token(data={"sub": "user1@test.com"})
    token2 = create_access_token(data={"sub": "user2@test.com"})

    payload1 = decode_token(token1)
    payload2 = decode_token(token2)

    assert payload1["jti"] != payload2["jti"]


def test_hash_refresh_token_deterministic():
    """hash_refresh_token детерминирован: один и тот же raw → один и тот же hash."""
    from app.core.security import hash_refresh_token

    raw = "some-raw-refresh-token-value"
    h1 = hash_refresh_token(raw)
    h2 = hash_refresh_token(raw)
    assert h1 == h2


def test_create_refresh_token_returns_tuple():
    """create_refresh_token возвращает (raw, hash) и hash совпадает с hash_refresh_token."""
    from app.core.security import create_refresh_token, hash_refresh_token

    raw, token_hash = create_refresh_token("user-id-123")
    assert len(raw) > 10
    assert token_hash == hash_refresh_token(raw)
