"""
Сервис API-ключей тенантов.

Генерация: `clk_live_<32 url-safe chars>` → sha256 → в БД.
Сырой ключ возвращается только один раз — при создании.

Скоупы:
  read:referrals / write:referrals
  read:patients  / write:patients
  read:appointments
  read:finance
"""
import hashlib
import ipaddress
import secrets
import uuid
from datetime import datetime, timedelta
from typing import Iterable

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tenant_api_key import TenantApiKey


# ── Разрешённые скоупы ───────────────────────────────────────────────────────
ALLOWED_SCOPES: tuple[str, ...] = (
    "read:referrals",
    "write:referrals",
    "read:patients",
    "write:patients",
    "read:appointments",
    "read:finance",
)

SCOPE_LABELS: dict[str, str] = {
    "read:referrals":     "Чтение направлений",
    "write:referrals":    "Создание направлений",
    "read:patients":      "Чтение пациентов",
    "write:patients":     "Изменение пациентов",
    "read:appointments":  "Чтение записей",
    "read:finance":       "Чтение финсводки",
}


# ── Hash / generate ──────────────────────────────────────────────────────────
KEY_PREFIX = "clk_live_"


def _hash_raw(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def generate_raw_key() -> tuple[str, str, str]:
    """
    Возвращает (raw_key, key_hash, key_prefix).
    raw_key = «clk_live_<32 chars>» (отображается клиенту 1 раз).
    key_prefix = первые 8 chars после префикса — для UI.
    """
    body = secrets.token_urlsafe(24)[:32]
    raw = f"{KEY_PREFIX}{body}"
    return raw, _hash_raw(raw), body[:8]


# ── Валидация скоупов ────────────────────────────────────────────────────────
def validate_scopes(scopes: Iterable[str]) -> list[str]:
    """Возвращает нормализованный список или бросает ValueError."""
    if not scopes:
        return []
    result: list[str] = []
    for s in scopes:
        s = (s or "").strip()
        if not s:
            continue
        if s not in ALLOWED_SCOPES:
            raise ValueError(f"Неизвестный scope: {s}")
        if s not in result:
            result.append(s)
    return result


# ── IP allowlist ─────────────────────────────────────────────────────────────
def ip_allowed(client_ip: str | None, allowlist: list | None) -> bool:
    """Проверяет, входит ли IP в allowlist (поддержка одиночных IP и CIDR)."""
    if not allowlist:
        return True
    if not client_ip:
        return False
    try:
        ip_obj = ipaddress.ip_address(client_ip)
    except ValueError:
        return False
    for entry in allowlist:
        if not entry:
            continue
        try:
            if "/" in str(entry):
                if ip_obj in ipaddress.ip_network(str(entry), strict=False):
                    return True
            else:
                if ip_obj == ipaddress.ip_address(str(entry)):
                    return True
        except ValueError:
            continue
    return False


# ── CRUD-операции ────────────────────────────────────────────────────────────
async def create_key(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    name: str,
    scopes: list[str],
    ttl_days: int | None,
    allowed_ips: list[str] | None,
    created_by_id: uuid.UUID | None,
) -> tuple[TenantApiKey, str]:
    """Создаёт API-ключ. Возвращает (model, raw_key). raw_key показывается ОДИН раз."""
    norm_scopes = validate_scopes(scopes)
    raw, key_hash, key_prefix = generate_raw_key()
    expires_at: datetime | None = None
    if ttl_days and ttl_days > 0:
        expires_at = datetime.utcnow() + timedelta(days=int(ttl_days))
    obj = TenantApiKey(
        tenant_id=tenant_id,
        key_hash=key_hash,
        key_prefix=key_prefix,
        name=(name or "").strip()[:200] or "API key",
        scopes=norm_scopes,
        created_by_id=created_by_id,
        expires_at=expires_at,
        allowed_ips=(allowed_ips or None),
    )
    db.add(obj)
    await db.flush()
    return obj, raw


async def revoke_key(db: AsyncSession, *, key_id: uuid.UUID, tenant_id: uuid.UUID) -> TenantApiKey | None:
    res = await db.execute(
        select(TenantApiKey).where(
            TenantApiKey.id == key_id,
            TenantApiKey.tenant_id == tenant_id,
        )
    )
    obj = res.scalar_one_or_none()
    if obj is None:
        return None
    if obj.revoked_at is None:
        obj.revoked_at = datetime.utcnow()
    return obj


async def verify_raw_key(
    db: AsyncSession,
    raw: str,
    *,
    client_ip: str | None = None,
) -> TenantApiKey | None:
    """
    Проверяет сырой ключ.
    Возвращает модель если ключ валиден (не revoked, не expired, IP разрешён),
    обновляет last_used_at / last_used_ip / request_count. Иначе None.
    """
    if not raw or not raw.startswith(KEY_PREFIX):
        return None
    key_hash = _hash_raw(raw)
    res = await db.execute(select(TenantApiKey).where(TenantApiKey.key_hash == key_hash))
    obj = res.scalar_one_or_none()
    if obj is None:
        return None
    now = datetime.utcnow()
    if obj.revoked_at is not None:
        return None
    if obj.expires_at is not None and obj.expires_at < now:
        return None
    if not ip_allowed(client_ip, obj.allowed_ips):
        return None
    # обновляем телеметрию (отдельным UPDATE — чтобы не вмешиваться в основную транзакцию)
    await db.execute(
        update(TenantApiKey)
        .where(TenantApiKey.id == obj.id)
        .values(
            last_used_at=now,
            last_used_ip=client_ip,
            request_count=TenantApiKey.request_count + 1,
        )
    )
    return obj


def key_status(obj: TenantApiKey) -> str:
    """active / revoked / expired."""
    if obj.revoked_at is not None:
        return "revoked"
    if obj.expires_at is not None and obj.expires_at < datetime.utcnow():
        return "expired"
    return "active"


def serialize(obj: TenantApiKey) -> dict:
    return {
        "id": str(obj.id),
        "name": obj.name,
        "key_prefix": f"{KEY_PREFIX}{obj.key_prefix}…",
        "scopes": obj.scopes or [],
        "status": key_status(obj),
        "created_at": obj.created_at.isoformat() if obj.created_at else None,
        "last_used_at": obj.last_used_at.isoformat() if obj.last_used_at else None,
        "last_used_ip": obj.last_used_ip,
        "expires_at": obj.expires_at.isoformat() if obj.expires_at else None,
        "revoked_at": obj.revoked_at.isoformat() if obj.revoked_at else None,
        "allowed_ips": obj.allowed_ips or [],
        "request_count": int(obj.request_count or 0),
    }
