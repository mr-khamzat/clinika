import hmac
import hashlib
import secrets
from datetime import datetime, timedelta
from jose import jwt, JWTError
from app.config import settings

# Access token: 30 минут (вместо 24 часов)
ACCESS_TOKEN_EXPIRE_MINUTES = 30
# Refresh token: 30 дней
REFRESH_TOKEN_EXPIRE_DAYS = 30


def hash_password(password: str) -> str:
    """PBKDF2-SHA256 с солью."""
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
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode["exp"] = expire
    to_encode["type"] = "access"
    return jwt.encode(to_encode, settings.secret_key, algorithm=settings.jwt_algorithm)


def create_refresh_token(user_id: str) -> tuple[str, str]:
    """
    Возвращает (raw_token, token_hash).
    raw_token отдаётся клиенту, hash хранится в БД.
    """
    raw = secrets.token_urlsafe(48)
    token_hash = hashlib.sha256(raw.encode()).hexdigest()
    return raw, token_hash


def hash_refresh_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


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
    payload = {
        "sub": phone,
        "ref": referral_id,
        "exp": datetime.utcnow() + timedelta(days=90),
        "iat": datetime.utcnow(),
        "type": "patient",
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def verify_patient_token(referral_id: str, phone: str, token: str) -> bool:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
        return payload.get("sub") == phone and payload.get("ref") == referral_id
    except JWTError:
        return False


def _is_dev_mode() -> bool:
    token = settings.telegram_bot_token
    return not token or token == "YOUR_BOT_TOKEN_HERE"


def verify_telegram_init_data(init_data: str) -> bool:
    if _is_dev_mode():
        return True
    if not init_data:
        return False
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
