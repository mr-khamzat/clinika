"""encryption_service — обёртка над Fernet для шифрования секретов в БД.

Ключ берётся из settings.secret_key (или env SECRET_KEY). Если cryptography не установлен
или ключ отсутствует — fallback на `plain:<value>` (для разработки/тестов).

API:
    encrypt(plain: str) -> str         # вернёт строку с префиксом 'enc:' либо 'plain:'
    decrypt(token: str) -> str | None  # обратное преобразование
"""
from __future__ import annotations

import base64
import hashlib
import logging
from typing import Optional

log = logging.getLogger(__name__)


def _derive_fernet_key() -> Optional[bytes]:
    """Вычисляет 32-байтный base64 url-safe ключ Fernet из settings.secret_key."""
    try:
        from app.config import settings
        raw = (settings.secret_key or "").encode("utf-8")
    except Exception:
        import os
        raw = (os.environ.get("SECRET_KEY") or "").encode("utf-8")
    if not raw:
        return None
    # Fernet требует 32 байта в base64 url-safe
    digest = hashlib.sha256(raw).digest()
    return base64.urlsafe_b64encode(digest)


_fernet = None


def _get_fernet():
    global _fernet
    if _fernet is not None:
        return _fernet
    try:
        from cryptography.fernet import Fernet  # type: ignore
        key = _derive_fernet_key()
        if not key:
            return None
        _fernet = Fernet(key)
        return _fernet
    except Exception as e:  # pragma: no cover
        log.warning("encryption_service: Fernet недоступен (%s) — fallback на plain", e)
        return None


def encrypt(plain: str) -> str:
    """Шифрует строку. Возвращает 'enc:<token>' либо 'plain:<value>' (fallback)."""
    if plain is None:
        return ""
    if not isinstance(plain, str):
        plain = str(plain)
    f = _get_fernet()
    if f is None:
        return f"plain:{plain}"
    try:
        token = f.encrypt(plain.encode("utf-8")).decode("ascii")
        return f"enc:{token}"
    except Exception as e:  # pragma: no cover
        log.error("encrypt failed: %s", e)
        return f"plain:{plain}"


def decrypt(token: str) -> Optional[str]:
    """Расшифровывает строку. Возвращает plaintext или None при ошибке."""
    if not token:
        return None
    if token.startswith("plain:"):
        return token[len("plain:"):]
    if token.startswith("enc:"):
        f = _get_fernet()
        if f is None:
            return None
        try:
            return f.decrypt(token[len("enc:"):].encode("ascii")).decode("utf-8")
        except Exception as e:  # pragma: no cover
            log.error("decrypt failed: %s", e)
            return None
    # Совместимость со старыми записями без префикса
    return token
