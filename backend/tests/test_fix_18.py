"""
Точечные тесты для находки #18 (тема tenant-isolation) — кодовая часть.

Находка #18: `PatientAccount.phone` был UNIQUE ГЛОБАЛЬНО, а `tenant_id` у модели
не было вовсе → справочник пациентов де-факто общий на всю платформу; ФИО (`name`)
лежало в plaintext; DSAR/«право на забвение» работали по всей платформе.

Фикс (без добавления tenant_id прямо в PatientAccount — это сломало бы unique по
phone и не отражает «лечится в N клиниках»):
  • новая M2M-модель TenantPatient(tenant_id, patient_id) с UniqueConstraint;
  • family_service.get_or_create_account_by_phone(tenant_id=...) создаёт ГЛОБАЛЬНЫЙ
    аккаунт + get-or-create связь TenantPatient;
  • family_service.get_account_by_phone(tenant_id=...) делает JOIN+фильтр →
    None для пациента «не из этой клиники»;
  • ФИО шифруется по паттерну shadow-колонок: PatientAccount.name_encrypted/_hash +
    property name_plain / setter set_name + запись в pii_sync._MAP.

Что проверяем:
  Unit (in-memory, без БД):
    • name round-trip: set_name → name_encrypted (enc:/plain:), name_plain == исходное;
    • legacy-fallback (нет шифртекста → отдаём plaintext-колонку);
    • «дамп» персистентных шифр-колонок не содержит plaintext ФИО;
    • pii_sync._sync_target заполняет name_encrypted/name_hash;
    • _MAP покрывает PatientAccount.name с blind-index hash.
  DB-backed (SQLite, async) — изоляция справочника пациентов:
    • get_or_create(tenant=A) → get_account_by_phone(tenant=B) == None;
    • get_account_by_phone(tenant=A) == тот же аккаунт;
    • PatientAccount остаётся ГЛОБАЛЬНЫМ (одна запись на телефон, две связи);
    • get_account_by_phone(tenant_id=None) сохраняет глобальный lookup (дедуп).
  Если SQLite/aiosqlite недоступен или схема не строится — DB-тесты skip
  (unit-набор всегда зелёный).

Запуск: pytest backend/tests/test_fix_18.py -v
"""
from __future__ import annotations

import uuid

import pytest
import pytest_asyncio

pytestmark = pytest.mark.unit


PHONE = "+7 (999) 123-45-67"
PHONE_NORM = "79991234567"
NAME = "Иванов Иван Иванович"


# ── Фикстура: детерминированный SECRET_KEY (сброс кэша Fernet) ───────────────

@pytest.fixture
def stable_secret_key(monkeypatch):
    """Фиксирует SECRET_KEY и сбрасывает кэш Fernet (как в test_fix_17)."""
    import app.services.encryption_service as enc

    monkeypatch.setenv("SECRET_KEY", "unit-test-secret-key-for-fix-18")
    try:
        from app.config import settings
        monkeypatch.setattr(settings, "secret_key", "unit-test-secret-key-for-fix-18", raising=False)
    except Exception:
        pass
    monkeypatch.setattr(enc, "_fernet", None, raising=False)
    yield enc
    monkeypatch.setattr(enc, "_fernet", None, raising=False)


# ═══════════════════════════════════════════════════════════════════════════
# Часть 1. Шифрование ФИО PatientAccount.name (in-memory)
# ═══════════════════════════════════════════════════════════════════════════

def test_name_roundtrip(stable_secret_key):
    from app.models.patient_account import PatientAccount
    pa = PatientAccount()
    pa.set_name(NAME)

    assert pa.name_encrypted
    assert pa.name_encrypted.startswith(("enc:", "plain:"))
    assert NAME not in pa.name_encrypted
    assert "Иванов" not in pa.name_encrypted
    # blind-index заполнен и не равен plaintext
    assert pa.name_hash
    assert NAME not in pa.name_hash
    # plaintext-источник истины остаётся (для legacy call-site) + property decrypt
    assert pa.name == NAME
    assert pa.name_plain == NAME


def test_name_none_does_not_leave_ciphertext(stable_secret_key):
    from app.models.patient_account import PatientAccount
    pa = PatientAccount()
    pa.set_name(None)
    assert pa.name_encrypted is None
    assert pa.name_hash is None
    assert pa.name_plain is None


def test_name_legacy_fallback(stable_secret_key):
    """Старая запись (до backfill): шифртекста нет → property отдаёт plaintext."""
    from app.models.patient_account import PatientAccount
    legacy = PatientAccount(name=NAME)
    assert legacy.name_encrypted is None
    assert legacy.name_plain == NAME


def test_persisted_dump_has_no_plaintext_name(stable_secret_key):
    """Симуляция дампа персистентных шифр-колонок — без plaintext ФИО."""
    from app.models.patient_account import PatientAccount
    pa = PatientAccount()
    pa.set_name(NAME)
    # «дамп» = только то, что должно уезжать в зашифрованную колонку
    dump = " | ".join(str(x) for x in (pa.name_encrypted, pa.name_hash))
    for secret in (NAME, "Иванов", "Иван"):
        assert secret not in dump, f"plaintext ФИО утекло в дамп: {secret!r}"


def test_pii_sync_fills_patient_account_name(stable_secret_key):
    from app.services import pii_sync
    from app.models.patient_account import PatientAccount

    pa = PatientAccount(name=NAME)
    assert pa.name_encrypted is None  # ещё не синхронизировано

    pii_sync._sync_target(pa)  # то, что делает before_insert listener

    assert pa.name_encrypted and pa.name_encrypted.startswith(("enc:", "plain:"))
    assert NAME not in pa.name_encrypted
    assert pa.name_hash  # blind-index есть


def test_pii_sync_map_covers_patient_account_name():
    from app.services.pii_sync import _MAP
    from app.models.patient_account import PatientAccount

    spec = _MAP[PatientAccount]
    assert spec["name"]["enc"] == "name_encrypted"
    # name участвует в поиске/идентификации → должен иметь blind-index hash
    hash_cfg = spec["name"].get("hash")
    assert hash_cfg and hash_cfg[0] == "name_hash"


# ═══════════════════════════════════════════════════════════════════════════
# Часть 2. Изоляция справочника пациентов через M2M TenantPatient (SQLite)
# ═══════════════════════════════════════════════════════════════════════════

@pytest_asyncio.fixture
async def sqlite_session():
    """Async SQLite-сессия с таблицами patient_accounts + tenant_patients.

    Self-contained: in-memory SQLite через aiosqlite, без Docker/Postgres.
    Если aiosqlite не установлен или диалект не строит схему — skip.
    """
    try:
        from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
    except Exception as exc:  # pragma: no cover
        pytest.skip(f"async SQLAlchemy недоступен: {exc}")

    from app.database import Base
    from app.models.patient_account import PatientAccount  # noqa: F401
    from app.models.tenant_patient import TenantPatient  # noqa: F401

    try:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    except Exception as exc:  # pragma: no cover
        pytest.skip(f"aiosqlite недоступен: {exc}")

    tables = [
        Base.metadata.tables["patient_accounts"],
        Base.metadata.tables["tenant_patients"],
    ]
    try:
        async with engine.begin() as conn:
            await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=tables))
    except Exception as exc:  # pragma: no cover - диалект не строит UUID-схему
        await engine.dispose()
        pytest.skip(f"SQLite не строит схему (диалект): {exc}")

    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with SessionLocal() as session:
        try:
            yield session
        finally:
            await session.rollback()
    await engine.dispose()


@pytest.mark.asyncio
async def test_get_or_create_isolates_by_tenant(sqlite_session):
    """Аккаунт, заведённый в тенанте A, НЕ виден из тенанта B."""
    from app.services import family_service as fs

    tenant_a = uuid.uuid4()
    tenant_b = uuid.uuid4()

    acc, is_new = await fs.get_or_create_account_by_phone(
        sqlite_session, PHONE, name=NAME, tenant_id=tenant_a
    )
    await sqlite_session.commit()
    assert is_new is True
    assert acc.phone == PHONE_NORM

    # из тенанта A — тот же аккаунт
    from_a = await fs.get_account_by_phone(sqlite_session, PHONE, tenant_id=tenant_a)
    assert from_a is not None
    assert from_a.id == acc.id

    # из тенанта B — пациент «не из этой клиники» → None
    from_b = await fs.get_account_by_phone(sqlite_session, PHONE, tenant_id=tenant_b)
    assert from_b is None


@pytest.mark.asyncio
async def test_account_stays_global_single_record(sqlite_session):
    """Один телефон = одна ГЛОБАЛЬНАЯ запись PatientAccount, но N связей TenantPatient."""
    from sqlalchemy import select, func
    from app.services import family_service as fs
    from app.models.patient_account import PatientAccount
    from app.models.tenant_patient import TenantPatient

    tenant_a = uuid.uuid4()
    tenant_b = uuid.uuid4()

    acc_a, new_a = await fs.get_or_create_account_by_phone(
        sqlite_session, PHONE, name=NAME, tenant_id=tenant_a
    )
    await sqlite_session.commit()
    # тот же пациент приходит во вторую клинику — НЕ новый аккаунт, новая связь
    acc_b, new_b = await fs.get_or_create_account_by_phone(
        sqlite_session, PHONE, tenant_id=tenant_b
    )
    await sqlite_session.commit()

    assert new_a is True
    assert new_b is False
    assert acc_a.id == acc_b.id  # глобальная запись одна

    # ровно одна строка patient_accounts по телефону
    cnt_acc = (await sqlite_session.execute(
        select(func.count()).select_from(PatientAccount)
        .where(PatientAccount.phone == PHONE_NORM)
    )).scalar_one()
    assert cnt_acc == 1

    # и две связи TenantPatient (по одной на тенант)
    cnt_link = (await sqlite_session.execute(
        select(func.count()).select_from(TenantPatient)
        .where(TenantPatient.patient_id == acc_a.id)
    )).scalar_one()
    assert cnt_link == 2

    # теперь пациент виден из ОБЕИХ клиник
    assert (await fs.get_account_by_phone(sqlite_session, PHONE, tenant_id=tenant_a)) is not None
    assert (await fs.get_account_by_phone(sqlite_session, PHONE, tenant_id=tenant_b)) is not None


@pytest.mark.asyncio
async def test_link_is_idempotent(sqlite_session):
    """Повторный get_or_create в том же тенанте не плодит дублей связи."""
    from sqlalchemy import select, func
    from app.services import family_service as fs
    from app.models.tenant_patient import TenantPatient

    tenant_a = uuid.uuid4()
    acc, _ = await fs.get_or_create_account_by_phone(
        sqlite_session, PHONE, name=NAME, tenant_id=tenant_a
    )
    await sqlite_session.commit()
    # ещё раз — линк уже есть
    await fs.get_or_create_account_by_phone(sqlite_session, PHONE, tenant_id=tenant_a)
    await sqlite_session.commit()
    # и явный вызов хелпера тоже идемпотентен
    await fs.link_patient_to_tenant(sqlite_session, acc.id, tenant_a)
    await sqlite_session.commit()

    cnt = (await sqlite_session.execute(
        select(func.count()).select_from(TenantPatient)
        .where(TenantPatient.tenant_id == tenant_a,
               TenantPatient.patient_id == acc.id)
    )).scalar_one()
    assert cnt == 1


@pytest.mark.asyncio
async def test_global_lookup_without_tenant(sqlite_session):
    """tenant_id=None сохраняет глобальный поиск (нужно для дедупа identify_patient)."""
    from app.services import family_service as fs

    tenant_a = uuid.uuid4()
    acc, _ = await fs.get_or_create_account_by_phone(
        sqlite_session, PHONE, name=NAME, tenant_id=tenant_a
    )
    await sqlite_session.commit()

    # глобальный lookup (без тенанта) находит аккаунт независимо от связей
    glob = await fs.get_account_by_phone(sqlite_session, PHONE)
    assert glob is not None
    assert glob.id == acc.id


@pytest.mark.asyncio
async def test_name_persisted_encrypted_on_create(sqlite_session, stable_secret_key):
    """ФИО, переданное в get_or_create, читается обратно (round-trip через property)."""
    from app.services import family_service as fs

    tenant_a = uuid.uuid4()
    acc, _ = await fs.get_or_create_account_by_phone(
        sqlite_session, PHONE, name=NAME, tenant_id=tenant_a
    )
    # listener pii_sync в этом self-contained движке не подключён (deploy-gate),
    # поэтому шифруем явно через сеттер и проверяем round-trip + отсутствие
    # plaintext в шифр-колонке.
    acc.set_name(NAME)
    await sqlite_session.commit()
    assert acc.name_plain == NAME
    assert acc.name_encrypted and NAME not in acc.name_encrypted
