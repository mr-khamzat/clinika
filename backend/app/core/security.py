import hmac
import hashlib
import secrets
from datetime import datetime, timedelta
from jose import jwt, JWTError
from app.config import settings


def hash_password(password: str) -> str:
    """PBKDF2-SHA256 с солью — совместимо без внешних зависимостей."""
    salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260000)
    return f"{salt}:{h.hex()}"


def verify_password(plain: str, stored: str) -> bool:
    try:
        salt, hash_val = stored.split(":", 1)
        h = hashlib.pbkdf2_hmac("sha256", plain.encode(), salt.encode(), 260000)
        return hmac.compare_digest(h.hex(), hash_val)
    except Exception:
        return False


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(hours=settings.jwt_expire_hours)
    to_encode["exp"] = expire
    return jwt.encode(to_encode, settings.secret_key, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError:
        return None


def sign_qr(referral_id: str) -> str:
    return hmac.new(
        settings.qr_secret.encode(),
        referral_id.encode(),
        hashlib.sha256
    ).hexdigest()[:32]


def verify_qr_signature(referral_id: str, signature: str) -> bool:
    expected = sign_qr(referral_id)
    return hmac.compare_digest(expected, signature)


def make_patient_token(referral_id: str, phone: str) -> str:
    """JWT-токен для доступа пациента к личному кабинету. Срок: 90 дней."""
    payload = {
        "sub": phone,
        "ref": referral_id,
        "exp": datetime.utcnow() + timedelta(days=90),
        "iat": datetime.utcnow(),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def verify_patient_token(referral_id: str, phone: str, token: str) -> bool:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
        return payload.get("sub") == phone and payload.get("ref") == referral_id
    except JWTError:
        return False


def _is_dev_mode() -> bool:
    """Режим разработки: бот-токен не настроен или является заглушкой."""
    token = settings.telegram_bot_token
    return not token or token == "YOUR_BOT_TOKEN_HERE"


def verify_telegram_init_data(init_data: str) -> bool:
    """
    Верифицирует подпись Telegram Mini App initData.

    Алгоритм (по документации Telegram):
      1. Разбираем URL-encoded строку, извлекаем hash.
      2. Формируем data-check-string: отсортированные пары key=value через \\n.
      3. secret_key = HMAC-SHA256(key="WebAppData", msg=bot_token)
      4. Вычисляем HMAC-SHA256(key=secret_key, msg=data_check_string).
      5. Сравниваем с hash из initData.

    В режиме разработки (бот-токен не настроен) верификация пропускается.
    """
    if _is_dev_mode():
        return True  # Разработка без Telegram

    if not init_data:
        return False  # Продакшн без init_data — отклоняем

    from urllib.parse import parse_qsl
    try:
        parsed = dict(parse_qsl(init_data, keep_blank_values=True))
        check_hash = parsed.pop("hash", "")
        if not check_hash:
            return False
        data_check_string = "\n".join(
            f"{k}={v}" for k, v in sorted(parsed.items())
        )
        secret_key = hmac.new(
            b"WebAppData",
            settings.telegram_bot_token.encode(),
            hashlib.sha256
        ).digest()
        computed = hmac.new(
            secret_key,
            data_check_string.encode(),
            hashlib.sha256
        ).hexdigest()
        return hmac.compare_digest(computed, check_hash)
    except Exception:
        return False
