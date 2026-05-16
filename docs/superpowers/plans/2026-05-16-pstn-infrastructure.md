# PSTN Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать инфраструктуру PSTN-телефонии (модели, API, provider-абстракция, UI настроек) согласно spec `docs/superpowers/specs/2026-05-16-pstn-infrastructure-design.md` (commit 925f172). Реальные SIP-провайдеры подключаются отдельной сессией.

**Architecture:** 3 новые модели + 1 alembic-миграция. Pluggable provider-pattern с `NullProvider` как заглушкой. 4 новых router endpoint-блока. Frontend — 1 новая страница в кабинете менеджера с 3 табами.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 async, alembic, Fernet (encryption_service уже есть), pytest, React 18, axios.

---

## File Structure

**Backend:**
| Файл | Ответственность |
|------|----------------|
| `backend/app/models/telephony.py` (новый) | 3 модели: TelephonyConfig, DidNumber, PhoneCall |
| `backend/app/models/__init__.py` | Экспорт |
| `backend/alembic/versions/2026_05_16_tel01_telephony_models.py` | Миграция всех 3 таблиц |
| `backend/app/services/telephony/__init__.py` | Экспорт фабрики `get_provider` |
| `backend/app/services/telephony/base.py` | ABC `TelephonyProvider` + dataclass'ы |
| `backend/app/services/telephony/null.py` | `NullProvider` — заглушка |
| `backend/app/services/telephony/factory.py` | `get_provider(db, tenant_id)` |
| `backend/app/routers/tenant_telephony.py` (новый) | Endpoints конфига + DID + dial + history |
| `backend/app/main.py` | include_router |
| `backend/tests/test_telephony.py` | 8 тестов |

**Frontend:**
| Файл | Ответственность |
|------|----------------|
| `frontend/src/pages/ManagerTelephony.jsx` (новый) | Страница с 3 табами |
| `frontend/src/App.jsx` | Route /manager/telephony |
| `frontend/src/pages/_ManagerShell.jsx` | Пункт меню |

---

## Task 1: Модели + миграция

**Files:**
- Create: `backend/app/models/telephony.py`
- Modify: `backend/app/models/__init__.py`
- Create: `backend/alembic/versions/2026_05_16_tel01_telephony_models.py`

- [ ] **Step 1: Найти current head**

```bash
sshpass -p 'Kh@mzat88712' ssh root@212.57.118.126 'cd /opt/clinika && docker compose exec -T clinika-backend alembic heads'
```
Expected: `sf04_pinned (head)`.

- [ ] **Step 2: Модель telephony.py**

`backend/app/models/telephony.py`:
```python
"""Telephony — модели PSTN-интеграции (TelephonyConfig, DidNumber, PhoneCall)."""
import uuid
from datetime import datetime
from typing import Any
from sqlalchemy import String, Boolean, DateTime, Integer, Text, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class TelephonyConfig(Base):
    __tablename__ = "telephony_configs"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False, unique=True, index=True,
    )
    provider: Mapped[str] = mapped_column(String(20), nullable=False, default="null")
    api_url: Mapped[str | None] = mapped_column(String(300), nullable=True)
    api_key_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    api_secret_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    features: Mapped[Any] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class DidNumber(Base):
    __tablename__ = "did_numbers"
    __table_args__ = (UniqueConstraint("tenant_id", "number", name="uq_did_tenant_number"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    clinic_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clinics.id", ondelete="SET NULL"), nullable=True,
    )
    number: Mapped[str] = mapped_column(String(20), nullable=False)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    default_assignee_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    ivr_config: Mapped[Any | None] = mapped_column(JSONB, nullable=True)
    record_calls: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class PhoneCall(Base):
    __tablename__ = "phone_calls"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    clinic_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clinics.id", ondelete="SET NULL"), nullable=True,
    )
    direction: Mapped[str] = mapped_column(String(3), nullable=False)  # 'in' | 'out'
    external_number: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    internal_did: Mapped[str | None] = mapped_column(String(20), nullable=True)
    operator_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    patient_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("patient_accounts.id", ondelete="SET NULL"), nullable=True,
    )
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    answered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    duration_sec: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="initiated")
    recording_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    provider_call_id: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
```

- [ ] **Step 3: Экспорт в `__init__.py`**

В `backend/app/models/__init__.py` добавить:
```python
from app.models.telephony import TelephonyConfig, DidNumber, PhoneCall  # noqa: F401
```

- [ ] **Step 4: Миграция**

`backend/alembic/versions/2026_05_16_tel01_telephony_models.py`:
```python
"""tel01: telephony_configs + did_numbers + phone_calls"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = 'tel01_telephony'
down_revision = 'sf04_pinned'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('telephony_configs',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True),
            sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False, unique=True, index=True),
        sa.Column('provider', sa.String(20), nullable=False, server_default='null'),
        sa.Column('api_url', sa.String(300), nullable=True),
        sa.Column('api_key_encrypted', sa.Text, nullable=True),
        sa.Column('api_secret_encrypted', sa.Text, nullable=True),
        sa.Column('is_active', sa.Boolean, nullable=False, server_default='false'),
        sa.Column('features', JSONB, nullable=False, server_default='{}'),
        sa.Column('created_at', sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime, server_default=sa.func.now(), nullable=False),
    )
    op.create_table('did_numbers',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True),
            sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('clinic_id', UUID(as_uuid=True),
            sa.ForeignKey('clinics.id', ondelete='SET NULL'), nullable=True),
        sa.Column('number', sa.String(20), nullable=False),
        sa.Column('display_name', sa.String(200), nullable=False),
        sa.Column('default_assignee_id', UUID(as_uuid=True),
            sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('ivr_config', JSONB, nullable=True),
        sa.Column('record_calls', sa.Boolean, nullable=False, server_default='true'),
        sa.Column('is_active', sa.Boolean, nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('tenant_id', 'number', name='uq_did_tenant_number'),
    )
    op.create_table('phone_calls',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True),
            sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('clinic_id', UUID(as_uuid=True),
            sa.ForeignKey('clinics.id', ondelete='SET NULL'), nullable=True),
        sa.Column('direction', sa.String(3), nullable=False),
        sa.Column('external_number', sa.String(20), nullable=False, index=True),
        sa.Column('internal_did', sa.String(20), nullable=True),
        sa.Column('operator_id', UUID(as_uuid=True),
            sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('patient_id', UUID(as_uuid=True),
            sa.ForeignKey('patient_accounts.id', ondelete='SET NULL'), nullable=True),
        sa.Column('started_at', sa.DateTime, server_default=sa.func.now(), nullable=False, index=True),
        sa.Column('answered_at', sa.DateTime, nullable=True),
        sa.Column('ended_at', sa.DateTime, nullable=True),
        sa.Column('duration_sec', sa.Integer, nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='initiated'),
        sa.Column('recording_url', sa.String(500), nullable=True),
        sa.Column('provider_call_id', sa.String(100), nullable=True, index=True),
        sa.Column('notes', sa.Text, nullable=True),
        sa.Column('created_at', sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime, server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_phone_calls_started', 'phone_calls', ['tenant_id', 'started_at'])


def downgrade():
    op.drop_index('ix_phone_calls_started', table_name='phone_calls')
    op.drop_table('phone_calls')
    op.drop_table('did_numbers')
    op.drop_table('telephony_configs')
```

- [ ] **Step 5: Применить + commit**

```bash
sshpass scp .../tel01_*.py + telephony.py + __init__.py root@...:/opt/clinika/...
ssh root@... 'cd /opt/clinika && docker compose exec -T clinika-backend alembic upgrade head'
git add backend/app/models/telephony.py backend/app/models/__init__.py backend/alembic/versions/2026_05_16_tel01_telephony_models.py
git -c commit.gpgsign=false commit -m "feat(telephony): миграция + 3 модели (TelephonyConfig, DidNumber, PhoneCall)"
```

Expected: `Running upgrade sf04_pinned -> tel01_telephony`.

---

## Task 2: Provider-абстракция (NullProvider)

**Files:**
- Create: `backend/app/services/telephony/__init__.py`
- Create: `backend/app/services/telephony/base.py`
- Create: `backend/app/services/telephony/null.py`
- Create: `backend/app/services/telephony/factory.py`

- [ ] **Step 1: ABC и dataclasses**

`backend/app/services/telephony/base.py`:
```python
"""TelephonyProvider — pluggable интерфейс. Реальные provider'ы — отдельные модули."""
from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class CallInitiateResult:
    success: bool
    provider_call_id: str | None = None
    error: str | None = None


@dataclass
class CallStatusResult:
    status: str  # 'ringing'|'answered'|'completed'|'failed'|'unknown'
    duration_sec: int | None = None
    recording_url: str | None = None


class TelephonyProvider(ABC):
    @abstractmethod
    async def initiate_call(self, *, from_user_phone: str, to_number: str) -> CallInitiateResult: ...

    @abstractmethod
    async def get_call_status(self, provider_call_id: str) -> CallStatusResult: ...

    @abstractmethod
    async def fetch_recording(self, provider_call_id: str) -> bytes | None: ...

    @abstractmethod
    async def handle_incoming_webhook(self, payload: dict) -> dict: ...
```

- [ ] **Step 2: NullProvider**

`backend/app/services/telephony/null.py`:
```python
"""NullProvider — заглушка когда провайдер не настроен."""
from .base import TelephonyProvider, CallInitiateResult, CallStatusResult


class NullProvider(TelephonyProvider):
    async def initiate_call(self, *, from_user_phone: str, to_number: str) -> CallInitiateResult:
        return CallInitiateResult(success=False, error="Провайдер телефонии не настроен")

    async def get_call_status(self, provider_call_id: str) -> CallStatusResult:
        return CallStatusResult(status="unknown")

    async def fetch_recording(self, provider_call_id: str) -> bytes | None:
        return None

    async def handle_incoming_webhook(self, payload: dict) -> dict:
        return {"ok": False, "reason": "no_provider"}
```

- [ ] **Step 3: Factory**

`backend/app/services/telephony/factory.py`:
```python
"""Фабрика провайдеров. Сейчас всегда NullProvider. Реальные — отдельные сессии."""
import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.telephony import TelephonyConfig
from .base import TelephonyProvider
from .null import NullProvider


async def get_provider(db: AsyncSession, tenant_id: uuid.UUID) -> TelephonyProvider:
    """Возвращает провайдер для тенанта. Если нет config / не активен / unknown — NullProvider."""
    if not tenant_id:
        return NullProvider()
    cfg = (await db.execute(
        select(TelephonyConfig).where(TelephonyConfig.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not cfg or not cfg.is_active or cfg.provider in ("null", ""):
        return NullProvider()
    # TODO: реальные провайдеры — отдельные сессии (mango.py, zadarma.py, sipuni.py)
    return NullProvider()
```

- [ ] **Step 4: Экспорт**

`backend/app/services/telephony/__init__.py`:
```python
from .base import TelephonyProvider, CallInitiateResult, CallStatusResult  # noqa: F401
from .null import NullProvider  # noqa: F401
from .factory import get_provider  # noqa: F401
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/telephony/
git -c commit.gpgsign=false commit -m "feat(telephony): pluggable provider-абстракция + NullProvider + factory"
```

---

## Task 3: Endpoints + tests (TDD)

**Files:**
- Create: `backend/app/routers/tenant_telephony.py`
- Modify: `backend/app/main.py` (include_router)
- Create: `backend/tests/test_telephony.py`

- [ ] **Step 1: Тесты**

`backend/tests/test_telephony.py`:
```python
import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock


@pytest.mark.asyncio
async def test_null_provider_returns_error_on_dial():
    from app.services.telephony.null import NullProvider
    r = await NullProvider().initiate_call(from_user_phone="+79991234567", to_number="+79007777777")
    assert r.success is False
    assert "не настроен" in (r.error or "")


@pytest.mark.asyncio
async def test_get_provider_returns_null_when_no_config():
    from app.services.telephony.factory import get_provider
    from app.services.telephony.null import NullProvider
    db = AsyncMock()
    db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=lambda: None))
    p = await get_provider(db, uuid.uuid4())
    assert isinstance(p, NullProvider)


@pytest.mark.asyncio
async def test_get_provider_returns_null_when_inactive():
    from app.services.telephony.factory import get_provider
    from app.services.telephony.null import NullProvider
    cfg = MagicMock(provider="mango", is_active=False)
    db = AsyncMock()
    db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=lambda: cfg))
    p = await get_provider(db, uuid.uuid4())
    assert isinstance(p, NullProvider)


def test_normalize_phone_valid():
    from app.routers.tenant_telephony import _normalize_phone
    assert _normalize_phone("+7 (999) 123-45-67") == "+79991234567"
    assert _normalize_phone("8 999 123 45 67") == "+79991234567"
    assert _normalize_phone("9991234567") == "+79991234567"


def test_normalize_phone_invalid_raises():
    from app.routers.tenant_telephony import _normalize_phone, InvalidPhoneError
    with pytest.raises(InvalidPhoneError):
        _normalize_phone("123")  # слишком короткий
    with pytest.raises(InvalidPhoneError):
        _normalize_phone("")


@pytest.mark.asyncio
async def test_get_telephony_config_returns_no_secrets():
    from app.routers.tenant_telephony import _serialize_config
    cfg = MagicMock(
        id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        provider="mango",
        api_url="https://app.mango-office.ru",
        api_key_encrypted="encrypted_KEY",
        api_secret_encrypted="encrypted_SECRET",
        is_active=True,
        features={"record_calls": True},
    )
    out = _serialize_config(cfg)
    # Секреты — только has_*, не сами значения
    assert "api_key_encrypted" not in out
    assert "api_secret_encrypted" not in out
    assert out["has_api_key"] is True
    assert out["has_api_secret"] is True
    assert out["provider"] == "mango"


def test_serialize_config_returns_defaults_when_none():
    from app.routers.tenant_telephony import _serialize_config
    out = _serialize_config(None)
    assert out["provider"] == "null"
    assert out["is_active"] is False
    assert out["has_api_key"] is False
    assert out["has_api_secret"] is False


@pytest.mark.asyncio
async def test_dial_creates_phone_call_record():
    """При попытке dial должен создаться PhoneCall record (даже если провайдер NullProvider)."""
    from app.routers.tenant_telephony import _create_outgoing_call
    db = AsyncMock()
    user = MagicMock(id=uuid.uuid4(), tenant_id=uuid.uuid4(), clinic_id=None)
    call = await _create_outgoing_call(db, user, to_number="+79007777777", provider_call_id=None, status="failed")
    # PhoneCall должен быть добавлен в db
    db.add.assert_called_once()
    added = db.add.call_args[0][0]
    assert added.direction == "out"
    assert added.external_number == "+79007777777"
    assert added.tenant_id == user.tenant_id
    assert added.operator_id == user.id


def test_did_validation_via_pydantic():
    from app.routers.tenant_telephony import DidIn
    # Корректный
    d = DidIn(number="+79991234567", display_name="Тест")
    assert d.number == "+79991234567"
    # Некорректный — должен либо нормализоваться, либо raise
    with pytest.raises(ValueError):
        DidIn(number="abc", display_name="x")
```

- [ ] **Step 2: Запустить — упадут**

```bash
docker compose exec -T clinika-backend pytest tests/test_telephony.py -v
```
Expected: ImportError на функции из tenant_telephony.

- [ ] **Step 3: Router**

`backend/app/routers/tenant_telephony.py`:
```python
"""Telephony — конфиг, DID-номера, история звонков, dial endpoint."""
import re
import uuid
from datetime import datetime
from typing import Optional, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select, desc, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.database import get_db
from app.models.telephony import TelephonyConfig, DidNumber, PhoneCall
from app.models.user import User, UserRole
from app.services.telephony.factory import get_provider
from app.services import encryption_service as enc  # Fernet helpers

router = APIRouter(tags=["telephony"])


class InvalidPhoneError(ValueError):
    pass


_RE_PHONE_ANY = re.compile(r"\D+")


def _normalize_phone(raw: str) -> str:
    """Нормализует РФ-номер в формат +7XXXXXXXXXX. Raises InvalidPhoneError."""
    if not raw or not isinstance(raw, str):
        raise InvalidPhoneError("Пустой номер")
    digits = _RE_PHONE_ANY.sub("", raw)
    if not digits:
        raise InvalidPhoneError("Нет цифр в номере")
    # 8XXXXXXXXXX -> 7XXXXXXXXXX
    if digits.startswith("8") and len(digits) == 11:
        digits = "7" + digits[1:]
    # 10 цифр без кода -> добавим 7
    if len(digits) == 10:
        digits = "7" + digits
    if len(digits) != 11 or not digits.startswith("7"):
        raise InvalidPhoneError(f"Неверный формат: {raw}")
    return "+" + digits


def _require_settings_role(user: User) -> None:
    role_val = user.role.value if hasattr(user.role, "value") else str(user.role)
    if role_val not in ("manager", "franchise_owner", "super_admin"):
        raise HTTPException(403, "Только manager/owner")
    if role_val != "super_admin" and not user.tenant_id:
        raise HTTPException(403, "Нет привязки к тенанту")


def _serialize_config(cfg: TelephonyConfig | None) -> dict:
    if not cfg:
        return {
            "provider": "null",
            "api_url": None,
            "has_api_key": False,
            "has_api_secret": False,
            "is_active": False,
            "features": {},
        }
    return {
        "id": str(cfg.id),
        "provider": cfg.provider,
        "api_url": cfg.api_url,
        "has_api_key": bool(cfg.api_key_encrypted),
        "has_api_secret": bool(cfg.api_secret_encrypted),
        "is_active": bool(cfg.is_active),
        "features": cfg.features or {},
    }


def _serialize_did(d: DidNumber) -> dict:
    return {
        "id": str(d.id),
        "number": d.number,
        "display_name": d.display_name,
        "clinic_id": str(d.clinic_id) if d.clinic_id else None,
        "default_assignee_id": str(d.default_assignee_id) if d.default_assignee_id else None,
        "record_calls": bool(d.record_calls),
        "is_active": bool(d.is_active),
    }


# ── Schemas ───────────────────────────────────────────────────────────────────

class ConfigIn(BaseModel):
    provider: Optional[str] = Field(default=None, pattern=r"^(null|mango|sipuni|zadarma|onlinepbx|custom)$")
    api_url: Optional[str] = Field(default=None, max_length=300)
    api_key: Optional[str] = Field(default=None, max_length=500)
    api_secret: Optional[str] = Field(default=None, max_length=500)
    is_active: Optional[bool] = None
    features: Optional[dict] = None


class DidIn(BaseModel):
    number: str = Field(min_length=10, max_length=20)
    display_name: str = Field(min_length=1, max_length=200)
    clinic_id: Optional[uuid.UUID] = None
    default_assignee_id: Optional[uuid.UUID] = None
    record_calls: bool = True
    is_active: bool = True

    @field_validator("number")
    @classmethod
    def _norm(cls, v: str) -> str:
        try:
            return _normalize_phone(v)
        except InvalidPhoneError as e:
            raise ValueError(str(e))


class DialIn(BaseModel):
    to_number: str = Field(min_length=5, max_length=30)
    from_user_phone: Optional[str] = None  # если оператор хочет с конкретного номера


# ── Telephony config endpoints ────────────────────────────────────────────────

@router.get("/tenant/settings/telephony")
async def get_config(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_settings_role(user)
    cfg = (await db.execute(
        select(TelephonyConfig).where(TelephonyConfig.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    return _serialize_config(cfg)


@router.patch("/tenant/settings/telephony")
async def update_config(
    body: ConfigIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_settings_role(user)
    cfg = (await db.execute(
        select(TelephonyConfig).where(TelephonyConfig.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if not cfg:
        cfg = TelephonyConfig(tenant_id=user.tenant_id, provider="null")
        db.add(cfg)
    if body.provider is not None:
        cfg.provider = body.provider
    if body.api_url is not None:
        cfg.api_url = body.api_url
    if body.api_key is not None:
        cfg.api_key_encrypted = enc.encrypt(body.api_key) if body.api_key else None
    if body.api_secret is not None:
        cfg.api_secret_encrypted = enc.encrypt(body.api_secret) if body.api_secret else None
    if body.is_active is not None:
        cfg.is_active = body.is_active
    if body.features is not None:
        cfg.features = body.features
    await db.commit()
    await db.refresh(cfg)
    return _serialize_config(cfg)


# ── DID number CRUD ───────────────────────────────────────────────────────────

@router.get("/tenant/did-numbers")
async def list_dids(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_settings_role(user)
    rows = (await db.execute(
        select(DidNumber).where(DidNumber.tenant_id == user.tenant_id).order_by(DidNumber.created_at)
    )).scalars().all()
    return {"dids": [_serialize_did(d) for d in rows]}


@router.post("/tenant/did-numbers", status_code=201)
async def create_did(
    body: DidIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_settings_role(user)
    d = DidNumber(
        tenant_id=user.tenant_id,
        number=body.number,
        display_name=body.display_name,
        clinic_id=body.clinic_id,
        default_assignee_id=body.default_assignee_id,
        record_calls=body.record_calls,
        is_active=body.is_active,
    )
    db.add(d)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(409, "Номер уже добавлен")
    await db.refresh(d)
    return _serialize_did(d)


@router.patch("/tenant/did-numbers/{did_id}")
async def update_did(
    did_id: uuid.UUID,
    body: DidIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_settings_role(user)
    d = (await db.execute(
        select(DidNumber).where(DidNumber.id == did_id, DidNumber.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if not d:
        raise HTTPException(404, "DID не найден")
    d.number = body.number
    d.display_name = body.display_name
    d.clinic_id = body.clinic_id
    d.default_assignee_id = body.default_assignee_id
    d.record_calls = body.record_calls
    d.is_active = body.is_active
    await db.commit()
    return _serialize_did(d)


@router.delete("/tenant/did-numbers/{did_id}", status_code=204)
async def delete_did(
    did_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_settings_role(user)
    d = (await db.execute(
        select(DidNumber).where(DidNumber.id == did_id, DidNumber.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if not d:
        raise HTTPException(404, "DID не найден")
    await db.delete(d)
    await db.commit()
    return None


# ── Dial + history ────────────────────────────────────────────────────────────

async def _create_outgoing_call(
    db: AsyncSession, user: User, *, to_number: str,
    provider_call_id: str | None, status: str,
) -> PhoneCall:
    """Создаёт PhoneCall record для исходящего. Возвращает несохранённый объект (commit делает caller)."""
    call = PhoneCall(
        tenant_id=user.tenant_id,
        clinic_id=getattr(user, "clinic_id", None),
        direction="out",
        external_number=to_number,
        operator_id=user.id,
        status=status,
        provider_call_id=provider_call_id,
        started_at=datetime.utcnow(),
    )
    db.add(call)
    return call


@router.post("/calls/dial", status_code=200)
async def dial(
    body: DialIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Инициирует исходящий звонок. Если провайдер не настроен — 503."""
    if not user.tenant_id:
        raise HTTPException(403, "Нет тенанта")
    try:
        to_norm = _normalize_phone(body.to_number)
    except InvalidPhoneError as e:
        raise HTTPException(400, str(e))
    provider = await get_provider(db, user.tenant_id)
    from_phone = body.from_user_phone or getattr(user, "phone", None) or ""
    result = await provider.initiate_call(from_user_phone=from_phone, to_number=to_norm)
    if not result.success:
        # Всё равно создаём record (для аудита неуспешных попыток)
        await _create_outgoing_call(
            db, user, to_number=to_norm,
            provider_call_id=result.provider_call_id, status="failed",
        )
        await db.commit()
        raise HTTPException(
            503,
            result.error or "Провайдер телефонии не настроен. Откройте /manager/telephony",
        )
    call = await _create_outgoing_call(
        db, user, to_number=to_norm,
        provider_call_id=result.provider_call_id, status="initiated",
    )
    await db.commit()
    await db.refresh(call)
    return {
        "call_id": str(call.id),
        "provider_call_id": result.provider_call_id,
        "status": call.status,
        "to_number": to_norm,
    }


@router.get("/telephony/calls")
async def list_calls(
    direction: Optional[str] = Query(None, pattern=r"^(in|out)$"),
    status: Optional[str] = Query(None, max_length=20),
    q: Optional[str] = Query(None, max_length=30),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_settings_role(user)
    stmt = select(PhoneCall).where(PhoneCall.tenant_id == user.tenant_id)
    if direction:
        stmt = stmt.where(PhoneCall.direction == direction)
    if status:
        stmt = stmt.where(PhoneCall.status == status)
    if q:
        stmt = stmt.where(PhoneCall.external_number.ilike(f"%{q}%"))
    stmt = stmt.order_by(desc(PhoneCall.started_at)).offset((page - 1) * limit).limit(limit)
    rows = (await db.execute(stmt)).scalars().all()
    return {
        "calls": [
            {
                "id": str(c.id),
                "direction": c.direction,
                "external_number": c.external_number,
                "started_at": c.started_at.isoformat() if c.started_at else None,
                "duration_sec": c.duration_sec,
                "status": c.status,
                "operator_id": str(c.operator_id) if c.operator_id else None,
                "patient_id": str(c.patient_id) if c.patient_id else None,
                "recording_url": c.recording_url,
            } for c in rows
        ],
        "page": page,
    }
```

- [ ] **Step 4: include_router в main.py**

В `backend/app/main.py`:
```python
from app.routers.tenant_telephony import router as _telephony_router
app.include_router(_telephony_router)
```

- [ ] **Step 5: Запустить тесты**

```bash
docker compose build clinika-backend
docker compose up -d clinika-backend
sleep 8
docker compose exec -T clinika-backend pytest tests/test_telephony.py -v
```
Expected: 8 passed.

- [ ] **Step 6: Smoke**

```bash
for ep in "/tenant/settings/telephony GET" "/tenant/did-numbers GET" "/calls/dial POST" "/telephony/calls GET"; do
  p=$(echo $ep | cut -d' ' -f1); m=$(echo $ep | cut -d' ' -f2)
  printf "%-50s " "$m $p"
  curl -s -o /dev/null -w "%{http_code}\n" -X $m "http://127.0.0.1:8900$p"
done
```
Expected: всё 403 (auth required).

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/tenant_telephony.py backend/app/main.py backend/tests/test_telephony.py
git -c commit.gpgsign=false commit -m "feat(telephony): endpoints + 8 unit-тестов"
```

---

## Task 4: Frontend — ManagerTelephony page

**Files:**
- Create: `frontend/src/pages/ManagerTelephony.jsx`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/pages/_ManagerShell.jsx`

- [ ] **Step 1: Создать страницу**

`frontend/src/pages/ManagerTelephony.jsx`:
```jsx
/**
 * Manager: Телефония (3 таба: Провайдер / DID / История)
 * Route: /manager/telephony
 */
import { useEffect, useState } from 'react'
import api from '../api'
import { useToast } from '../design'
import ManagerShell from './_ManagerShell'

const PROVIDERS = [
  { value: 'null',      label: 'Отключено' },
  { value: 'mango',     label: 'Mango Office' },
  { value: 'sipuni',    label: 'Sipuni' },
  { value: 'zadarma',   label: 'Zadarma' },
  { value: 'onlinepbx', label: 'OnlinePBX' },
  { value: 'custom',    label: 'Свой SIP-trunk' },
]

const FEATURES_DEFAULT = { record_calls: true, ivr_enabled: false, voicemail: false, callback: false }

export default function ManagerTelephony() {
  const { toast } = useToast() || {}
  const [tab, setTab] = useState('provider')

  return (
    <ManagerShell active="telephony" title="Телефония" icon="phone">
      <div className="flex gap-2 mb-4 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {[
          ['provider', 'Провайдер', 'settings'],
          ['dids',     'Номера (DID)', 'dialpad'],
          ['history',  'История звонков', 'history'],
        ].map(([k, l, ic]) => (
          <button key={k} onClick={() => setTab(k)}
            className="px-4 py-2 rounded-xl font-semibold whitespace-nowrap"
            style={{
              background: tab === k ? 'var(--accent, #0097A7)' : 'var(--bg-1, #f1f5f9)',
              color: tab === k ? '#fff' : 'var(--fg-2, #475569)', fontSize: 13,
            }}>
            <span className="material-symbols-outlined" style={{ fontSize: 14, verticalAlign: 'middle', marginRight: 6 }}>{ic}</span>
            {l}
          </button>
        ))}
      </div>
      {tab === 'provider' && <ProviderTab toast={toast} />}
      {tab === 'dids'     && <DidTab toast={toast} />}
      {tab === 'history'  && <HistoryTab />}
    </ManagerShell>
  )
}


function ProviderTab({ toast }) {
  const [cfg, setCfg] = useState({ provider: 'null', api_url: '', is_active: false, features: FEATURES_DEFAULT, has_api_key: false, has_api_secret: false })
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.get('/tenant/settings/telephony').then(r => {
      setCfg({ ...r.data, features: r.data.features || FEATURES_DEFAULT })
    }).catch(() => {})
  }, [])

  const save = async () => {
    setBusy(true)
    try {
      const payload = {
        provider: cfg.provider,
        api_url: cfg.api_url || null,
        is_active: cfg.is_active,
        features: cfg.features,
      }
      if (apiKey)    payload.api_key = apiKey
      if (apiSecret) payload.api_secret = apiSecret
      const r = await api.patch('/tenant/settings/telephony', payload)
      setCfg({ ...r.data, features: r.data.features || FEATURES_DEFAULT })
      setApiKey(''); setApiSecret('')
      toast?.('Сохранено', 'success')
    } catch (e) {
      toast?.(e?.response?.data?.detail || 'Ошибка', 'error')
    } finally { setBusy(false) }
  }

  const input = {
    background: 'var(--bg-1, #f6f6f8)',
    border: '1px solid var(--border, rgba(0,0,0,.08))',
    color: 'var(--fg, #0F172A)',
    fontSize: 14, width: '100%', padding: '8px 12px', borderRadius: 10,
  }

  return (
    <div className="grid gap-3 max-w-lg">
      <label>
        <div style={{ fontSize: 12, color: 'var(--fg-2)', marginBottom: 4 }}>Провайдер</div>
        <select value={cfg.provider} onChange={e => setCfg({ ...cfg, provider: e.target.value })} style={input}>
          {PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </label>
      <label>
        <div style={{ fontSize: 12, color: 'var(--fg-2)', marginBottom: 4 }}>API URL</div>
        <input value={cfg.api_url || ''} onChange={e => setCfg({ ...cfg, api_url: e.target.value })}
               placeholder="https://app.mango-office.ru" style={input}/>
      </label>
      <label>
        <div style={{ fontSize: 12, color: 'var(--fg-2)', marginBottom: 4 }}>
          API Key {cfg.has_api_key && <span style={{ color: 'var(--good, #22c55e)' }}>✓ сохранён</span>}
        </div>
        <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
               placeholder={cfg.has_api_key ? '••••••••' : 'Введите API Key'} style={input}/>
      </label>
      <label>
        <div style={{ fontSize: 12, color: 'var(--fg-2)', marginBottom: 4 }}>
          API Secret {cfg.has_api_secret && <span style={{ color: 'var(--good, #22c55e)' }}>✓ сохранён</span>}
        </div>
        <input type="password" value={apiSecret} onChange={e => setApiSecret(e.target.value)}
               placeholder={cfg.has_api_secret ? '••••••••' : 'Введите API Secret'} style={input}/>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" checked={!!cfg.is_active}
               onChange={e => setCfg({ ...cfg, is_active: e.target.checked })}/>
        <span style={{ fontSize: 14 }}>Активна</span>
      </label>
      <div style={{ fontSize: 12, color: 'var(--fg-2)', marginTop: 8 }}>Опции:</div>
      {[
        ['record_calls', 'Запись звонков'],
        ['ivr_enabled',  'IVR (голосовое меню)'],
        ['voicemail',    'Голосовая почта'],
        ['callback',     'Callback'],
      ].map(([k, l]) => (
        <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={!!cfg.features?.[k]}
                 onChange={e => setCfg({ ...cfg, features: { ...cfg.features, [k]: e.target.checked } })}/>
          <span style={{ fontSize: 13 }}>{l}</span>
        </label>
      ))}
      <button onClick={save} disabled={busy}
              className="px-4 py-2.5 rounded-xl text-white font-semibold disabled:opacity-50 mt-2"
              style={{ background: 'linear-gradient(135deg, #0097A7, #0A2342)' }}>
        {busy ? 'Сохраняем…' : 'Сохранить'}
      </button>
      <div className="rounded-xl p-3" style={{ background: 'rgba(0,151,167,.08)', fontSize: 12, color: 'var(--fg-2)' }}>
        ℹ️ Реальные провайдеры (Mango/Sipuni/Zadarma) пока не подключены — выбор сохранится в конфиге, dial вернёт 503. Подключение — отдельной задачей.
      </div>
    </div>
  )
}


function DidTab({ toast }) {
  const [dids, setDids] = useState([])
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState(null)

  const load = async () => {
    setLoading(true)
    try { const r = await api.get('/tenant/did-numbers'); setDids(r.data?.dids || []) }
    catch { setDids([]) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const save = async () => {
    if (!edit?.number?.trim() || !edit?.display_name?.trim()) {
      toast?.('Заполните номер и название', 'error'); return
    }
    const payload = {
      number: edit.number.trim(), display_name: edit.display_name.trim(),
      clinic_id: edit.clinic_id || null, default_assignee_id: edit.default_assignee_id || null,
      record_calls: !!edit.record_calls, is_active: edit.is_active !== false,
    }
    try {
      if (edit.id) await api.patch(`/tenant/did-numbers/${edit.id}`, payload)
      else await api.post('/tenant/did-numbers', payload)
      toast?.('Сохранено', 'success'); setEdit(null); load()
    } catch (e) { toast?.(e?.response?.data?.detail || 'Ошибка', 'error') }
  }

  const remove = async (id) => {
    if (!confirm('Удалить номер?')) return
    try { await api.delete(`/tenant/did-numbers/${id}`); load() }
    catch (e) { toast?.(e?.response?.data?.detail || 'Ошибка', 'error') }
  }

  const input = {
    background: 'var(--bg-1)', border: '1px solid var(--border)',
    color: 'var(--fg)', fontSize: 14, width: '100%', padding: '8px 12px', borderRadius: 10,
  }

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button onClick={() => setEdit({ number: '', display_name: '', record_calls: true, is_active: true })}
                className="px-4 py-2 rounded-xl text-white font-semibold"
                style={{ background: 'linear-gradient(135deg, #0097A7, #0A2342)' }}>
          + Добавить номер
        </button>
      </div>
      {loading ? <div style={{ color: 'var(--fg-3)' }}>Загрузка…</div>
       : dids.length === 0 ? <div style={{ color: 'var(--fg-3)' }}>Номера не добавлены</div>
       : (
        <div className="grid gap-2">
          {dids.map(d => (
            <div key={d.id} className="p-3 rounded-2xl flex items-center gap-3"
                 style={{ background: 'var(--surface, #fff)', border: '1px solid var(--border)' }}>
              <div className="flex-1 min-w-0">
                <div style={{ fontWeight: 700, fontSize: 15 }}>{d.number}</div>
                <div style={{ fontSize: 12, color: 'var(--fg-2)' }}>{d.display_name}</div>
                <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 2 }}>
                  {d.is_active ? '✅ активен' : '⏸ выключен'}
                  {d.record_calls ? ' · 🎙 запись' : ''}
                </div>
              </div>
              <button onClick={() => setEdit({ ...d })} className="px-3 py-1 rounded-lg"
                      style={{ background: 'var(--bg-1)', fontSize: 12 }}>Изменить</button>
              <button onClick={() => remove(d.id)} className="px-3 py-1 rounded-lg"
                      style={{ background: '#fee2e2', color: '#991b1b', fontSize: 12 }}>Удалить</button>
            </div>
          ))}
        </div>
       )}
      {edit && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4"
             style={{ background: 'rgba(15,23,42,.55)' }} onClick={() => setEdit(null)}>
          <div onClick={e => e.stopPropagation()}
               className="w-full max-w-md rounded-3xl overflow-hidden p-5 space-y-3"
               style={{ background: 'var(--bg, #fff)' }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>
              {edit.id ? 'Изменить номер' : 'Новый номер'}
            </div>
            <input placeholder="+7XXX..." value={edit.number || ''}
                   onChange={e => setEdit({ ...edit, number: e.target.value })} style={input}/>
            <input placeholder="Название (Регистратура Назрань)" value={edit.display_name || ''}
                   onChange={e => setEdit({ ...edit, display_name: e.target.value })} style={input}/>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={!!edit.record_calls}
                     onChange={e => setEdit({ ...edit, record_calls: e.target.checked })}/>
              <span style={{ fontSize: 13 }}>Записывать звонки</span>
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={edit.is_active !== false}
                     onChange={e => setEdit({ ...edit, is_active: e.target.checked })}/>
              <span style={{ fontSize: 13 }}>Активен</span>
            </label>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setEdit(null)} className="flex-1 py-2.5 rounded-xl"
                      style={{ background: 'var(--bg-1)' }}>Отмена</button>
              <button onClick={save} className="flex-1 py-2.5 rounded-xl text-white font-semibold"
                      style={{ background: 'linear-gradient(135deg, #0097A7, #0A2342)' }}>
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


function HistoryTab() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [direction, setDirection] = useState('')
  const [q, setQ] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const params = { page: 1, limit: 100 }
      if (direction) params.direction = direction
      if (q) params.q = q
      const r = await api.get('/telephony/calls', { params })
      setItems(r.data?.calls || [])
    } catch { setItems([]) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [direction])

  return (
    <div>
      <div className="flex gap-2 mb-3 flex-wrap">
        {[['', 'Все'], ['in', '⬇ Входящие'], ['out', '⬆ Исходящие']].map(([v, l]) => (
          <button key={v} onClick={() => setDirection(v)}
                  className="px-3 py-1.5 rounded-full text-xs"
                  style={{
                    background: direction === v ? 'var(--accent)' : 'var(--bg-1)',
                    color: direction === v ? '#fff' : 'var(--fg-2)',
                  }}>{l}</button>
        ))}
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()}
               placeholder="Поиск по номеру… (Enter)"
               className="px-3 py-1.5 rounded-full"
               style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', fontSize: 12, flex: 1, minWidth: 180 }}/>
      </div>
      {loading ? <div style={{ color: 'var(--fg-3)' }}>Загрузка…</div>
       : items.length === 0 ? <div style={{ color: 'var(--fg-3)' }}>Звонков пока нет</div>
       : (
        <div className="grid gap-1">
          {items.map(c => (
            <div key={c.id} className="p-2 rounded-xl flex items-center gap-3"
                 style={{ background: 'var(--surface, #fff)', border: '1px solid var(--border)' }}>
              <span style={{ fontSize: 18 }}>{c.direction === 'in' ? '⬇' : '⬆'}</span>
              <div className="flex-1 min-w-0">
                <div style={{ fontWeight: 600 }}>{c.external_number}</div>
                <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                  {c.started_at && new Date(c.started_at).toLocaleString('ru-RU')} · {c.status}
                  {c.duration_sec ? ` · ${c.duration_sec}s` : ''}
                </div>
              </div>
              {c.recording_url && <a href={c.recording_url} target="_blank" rel="noreferrer"
                                     style={{ fontSize: 12, color: 'var(--accent)' }}>▶</a>}
            </div>
          ))}
        </div>
       )}
    </div>
  )
}
```

- [ ] **Step 2: Route в App.jsx**

В блоке `{user?.role === 'manager' && (...)}` добавь:
```jsx
<Route path="manager/telephony" element={
  <Suspense fallback={<div style={{minHeight:'100vh'}}/>}><ManagerTelephony /></Suspense>
} />
```

В импорты (lazy):
```jsx
const ManagerTelephony = lazy(() => import('./pages/ManagerTelephony'))
```

- [ ] **Step 3: Меню в _ManagerShell.jsx**

В `MENU_ITEMS` или `MGR_NAV` массиве добавить:
```jsx
{ key: 'telephony', label: 'Телефония', icon: 'phone', path: '/manager/telephony', group: 'integrations' },
```

- [ ] **Step 4: Build + smoke**

```bash
docker compose build --no-cache clinika-frontend
docker compose up -d clinika-frontend
sleep 6
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:8901/
```
Expected: HTTP 200.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/ManagerTelephony.jsx frontend/src/App.jsx frontend/src/pages/_ManagerShell.jsx
git -c commit.gpgsign=false commit -m "feat(telephony): UI /manager/telephony — 3 таба (провайдер, DID, история)"
```

---

## Task 5: Финальный smoke + TG-отчёт

- [ ] **Step 1: Прогон всех тестов**

```bash
docker compose exec -T clinika-backend pytest tests/test_telephony.py tests/test_staffchat_*.py tests/test_workflow_*.py tests/test_clinic_chat_quick_wins.py tests/test_push.py -v 2>&1 | tail -3
```
Expected: 55 + 8 = 63 passed.

- [ ] **Step 2: Smoke endpoints**

```bash
for ep in "/tenant/settings/telephony GET" "/tenant/did-numbers GET" "/tenant/did-numbers POST" \
          "/calls/dial POST" "/telephony/calls GET"; do
  p=$(echo $ep | cut -d' ' -f1); m=$(echo $ep | cut -d' ' -f2)
  printf "%-50s " "$m $p"
  curl -s -o /dev/null -w "%{http_code}\n" -X $m "http://127.0.0.1:8900$p"
done
```
Expected: всё 403.

- [ ] **Step 3: TG report**

Скрипт по аналогии с предыдущими батчами — несколько сообщений по 4KB через @stclinik_addmin_bot.

---

## Self-Review

**1. Spec coverage:**
- §3.1 модели → Task 1 (миграция + 3 модели)
- §3.2 provider-абстракция → Task 2 (base + null + factory)
- §3.3 API endpoints (9 шт) → Task 3
- §3.4 Frontend (3 таба + route + меню) → Task 4
- §5 8 тестов → Task 3 Step 1
- §6 миграция tel01 от sf04_pinned → Task 1 Step 4

**2. Placeholder scan:**
Все шаги содержат полный код. Пометка «TODO: реальные провайдеры — отдельные сессии» в factory.py — НЕ плейсхолдер плана, а указатель будущего расширения (NullProvider возвращается всегда).

**3. Type consistency:**
- `TelephonyConfig`, `DidNumber`, `PhoneCall` — Task 1 определяет, Task 3 использует
- `CallInitiateResult(success, provider_call_id, error)` — Task 2 dataclass, Task 3 использует
- `get_provider(db, tenant_id) -> TelephonyProvider` — Task 2, Task 3
- `_normalize_phone(raw) -> str` — Task 3 (определена и тестируется + используется в endpoints)
- `_serialize_config(cfg) -> dict` — Task 3 (тестируется + используется в GET/PATCH)
- `_serialize_did(d) -> dict` — Task 3
- `_create_outgoing_call(db, user, *, to_number, provider_call_id, status) -> PhoneCall` — Task 3
- API ответ конфига отдаёт `has_api_key/has_api_secret` (не сами секреты) — frontend Task 4 ожидает то же

Всё согласовано.
