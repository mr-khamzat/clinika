"""RLS-покрытие тенант-таблиц — мета-тест + интеграционные проверки.

Находка #1 (RLS на 3 из 126 таблиц + мёртвый RLS-контекст), Часть B (runtime).

Состоит из двух блоков:

1. **Unit (мета-проверка)** — без БД. Гарантирует, что КАЖДАЯ тенант-таблица
   (есть колонка ``tenant_id``), кроме осознанного whitelist, либо входит в
   зафиксированный baseline покрытых RLS таблиц, либо явно вайтлистнута.
   Падает, когда в моделях появляется НОВАЯ тенант-таблица без обновления
   покрытия — то есть превентивно ловит «добавили модель, забыли RLS-политику».
   Дополнительно сверяется со списком таблиц, реально покрытых RLS-миграциями
   (скан исходников ``alembic/versions/*.py``), если миграция «RLS на всех
   таблицах» уже влита (её делает отдельный агент — Часть A).

2. **Integration** (``@pytest.mark.integration``, реальный PostgreSQL, скип без
   Docker) — на живой таблице с RLS проверяет рантайм-семантику:
     • под ``app.tenant_id = A`` SELECT отдаёт ТОЛЬКО строки тенанта A;
     • при НЕзаданном ``app.tenant_id`` (пустая строка) — видны все строки
       (permissive-when-unset → super_admin/джобы видят всё);
     • negative на запись: INSERT/UPDATE строки чужого тенанта под ``app.tenant_id=A``
       отклоняется политикой ``WITH CHECK``.

   На SQLite RLS отсутствует — поэтому интеграционный блок завязан на фикстуры
   ``pg_engine``/``db_session`` из conftest (скипаются без Docker/testcontainers).
"""
from __future__ import annotations

import re
import uuid
from pathlib import Path

import pytest


# ─────────────────────────────────────────────────────────────────────────────
# Общие хелперы: множество тенант-таблиц + whitelist + скан миграций
# ─────────────────────────────────────────────────────────────────────────────

def _load_metadata():
    """Импортируем модели как это делает приложение и возвращаем Base.metadata.

    Используем import app.main, т.к. отдельные пакеты моделей не подтягивают
    весь граф (часть FK-целей лежит в других модулях). app.main импортирует
    все роутеры → все модели → metadata полон.
    """
    import app.main  # noqa: F401  - сторонний эффект: регистрация всех моделей
    from app.database import Base

    return Base.metadata


def _tenant_tables(metadata) -> set[str]:
    """Все таблицы с колонкой ``tenant_id`` (используем .tables, не sorted_tables:
    последний резолвит FK и падает, если какая-то связанная таблица не импортнута)."""
    return {
        name
        for name, table in metadata.tables.items()
        if "tenant_id" in table.columns
    }


# Таблицы, СОЗНАТЕЛЬНО глобальные (RLS не нужен) — мирроринг whitelist миграции
# Части A. Если позже сюда добавится новая глобальная таблица — расширить и тут,
# и в whitelist миграции (они должны совпадать). Сейчас все 118 tenant-таблиц
# обязаны иметь tenant-политику, явных исключений среди НИХ нет (patient_accounts
# из находки #18 вообще не имеет tenant_id → не попадёт в _tenant_tables).
WHITELIST_GLOBAL: set[str] = set()


# Зафиксированный baseline тенант-таблиц на момент внедрения находки #1/Часть B.
# Назначение: ЛЮБАЯ новая тенант-таблица, не попавшая в baseline и не вайтлистнутая,
# роняет мета-тест → разработчик обязан осознанно либо добавить её в покрытие RLS
# (миграция Части A делает это автоматически по Base.metadata), либо вайтлистнуть.
KNOWN_TENANT_TABLES: frozenset[str] = frozenset({
    # tenant_patients добавлена миграцией tpat01 (#18) ПОСЛЕ rlsall01 и покрыта
    # RLS там же (ENABLE+FORCE+policy tenant_isolation) — поэтому в baseline.
    "tenant_patients",
    "activity_log", "ad_events", "ad_spend_entries", "ads",
    "aggregator_partnerships", "ai_analysis_history", "ai_conversations",
    "ai_doctor_logs", "ai_knowledge_entries", "appointment_costs",
    "appointments", "audit_log", "billing_ledger", "bonuses", "call_logs",
    "call_permissions", "call_recordings", "call_rules", "cash_shifts",
    "chat_global_settings", "chat_threads", "clinic_payments", "clinics",
    "did_numbers", "direct_bills", "discounts", "doctor_requests", "doctors",
    "engagement_suggestions", "family_groups", "fiscal_receipts",
    "franchise_internal_acts", "franchise_module_grants", "internal_referrals",
    "inventory_batches", "inventory_import_logs", "inventory_items",
    "inventory_movements", "inventory_receipts", "inventory_stocks", "invoices",
    "lab_orders", "lab_providers", "ledger_entries", "loyalty_accounts",
    "loyalty_accounts_ext", "loyalty_rewards", "loyalty_rules", "loyalty_tiers",
    "loyalty_transactions", "marketing_channels", "message_templates",
    "mis_payment_imports", "module_health_checks", "notification_settings",
    "nps_responses", "ofd_configs", "partner_categories",
    "partner_service_offers", "patient_ai_conversations", "patient_allergies",
    "patient_attribution", "patient_chats", "patient_comm_prefs",
    "patient_diagnoses", "patient_documents", "patient_family_members",
    "patient_ltv_snapshots", "patient_notes", "patient_prescription_cache",
    "patient_segments", "patient_sessions", "patient_subscriptions",
    "patient_tags", "patient_vaccinations", "patient_vitals",
    "payment_gateway_configs", "payments", "pending_subscription_requests",
    "phone_calls", "push_campaigns", "push_subscriptions", "push_templates",
    "recruiter_bonuses", "referral_templates", "referrals", "regulations",
    "reviews", "service_consumables", "services", "signup_requests",
    "sms_campaigns", "sms_templates", "spendings", "staff_chat_rooms",
    "subscription_plan_discounts", "subscription_plans", "subscriptions",
    "suppliers", "telemedicine_sessions", "telephony_configs",
    "tenant_api_keys", "tenant_branding", "tenant_cms_pages",
    "tenant_integrations", "tenant_licenses",
    "tenant_mis_subscription_webhooks", "tenant_module_subscriptions",
    "tenant_modules", "tenant_permission_overrides",
    "tenant_plugin_subscriptions", "tenant_plugins", "tenant_pricing_rules",
    "treatment_plans", "users", "visiting_doctor_settings", "webhook_deliveries",
    "webhook_endpoints",
})


def _versions_dir() -> Path:
    # tests/ -> backend/ -> backend/alembic/versions
    return Path(__file__).resolve().parent.parent / "alembic" / "versions"


def _rls_covered_tables_from_migrations() -> set[str]:
    """Скан исходников миграций: какие таблицы реально получают RLS-политику.

    Ловим:
      • статические объявления вида ``RLS_TABLES = ["a", "b"]``;
      • литералы ``ENABLE ROW LEVEL SECURITY`` / ``CREATE POLICY ... ON <t>``.

    Динамические миграции (Часть A итерирует Base.metadata) НЕ перечисляют имена
    статически — для них этот скан вернёт пусто, и мета-тест опирается на baseline
    (KNOWN_TENANT_TABLES). Поэтому функция используется как ДОПОЛНИТЕЛЬНАЯ сверка,
    а не единственный источник истины.
    """
    covered: set[str] = set()
    vdir = _versions_dir()
    if not vdir.exists():
        return covered
    list_re = re.compile(r"RLS_TABLES\s*=\s*\[([^\]]*)\]", re.DOTALL)
    str_re = re.compile(r"['\"]([a-z_][a-z0-9_]*)['\"]")
    enable_re = re.compile(
        r"ALTER\s+TABLE\s+([a-z_][a-z0-9_]*)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY",
        re.IGNORECASE,
    )
    policy_re = re.compile(
        r"CREATE\s+POLICY\s+\w+\s+ON\s+([a-z_][a-z0-9_]*)", re.IGNORECASE
    )
    for path in vdir.glob("*.py"):
        text = path.read_text(encoding="utf-8", errors="ignore")
        for m in list_re.finditer(text):
            covered.update(str_re.findall(m.group(1)))
        covered.update(t.lower() for t in enable_re.findall(text))
        covered.update(t.lower() for t in policy_re.findall(text))
    return covered


# ─────────────────────────────────────────────────────────────────────────────
# 1) UNIT / мета-тесты (без БД)
# ─────────────────────────────────────────────────────────────────────────────

def test_no_new_tenant_table_without_rls_coverage():
    """Каждая тенант-таблица должна быть либо в baseline покрытия, либо в whitelist.

    Новая модель с ``tenant_id``, не добавленная ни туда, ни сюда → тест падает
    и заставляет осознанно решить судьбу RLS для этой таблицы.
    """
    metadata = _load_metadata()
    tenant_tables = _tenant_tables(metadata)

    uncovered = tenant_tables - KNOWN_TENANT_TABLES - WHITELIST_GLOBAL
    assert not uncovered, (
        "Обнаружены НОВЫЕ тенант-таблицы без RLS-покрытия: "
        f"{sorted(uncovered)}.\n"
        "Добавьте их в RLS-миграцию (Часть A покрывает все таблицы с tenant_id "
        "по Base.metadata автоматически) и внесите в KNOWN_TENANT_TABLES; либо, "
        "если таблица сознательно глобальная, добавьте её в WHITELIST_GLOBAL "
        "(и в whitelist миграции — они должны совпадать)."
    )


def test_baseline_is_not_stale():
    """Baseline не должен содержать «призраков» — таблиц, которых уже нет в моделях.

    Если таблицу удалили/переименовали, baseline нужно почистить, иначе он
    перестаёт отражать реальность и маскирует регрессии.
    """
    metadata = _load_metadata()
    tenant_tables = _tenant_tables(metadata)
    ghosts = (KNOWN_TENANT_TABLES | WHITELIST_GLOBAL) - tenant_tables
    assert not ghosts, (
        f"В baseline/whitelist есть таблицы, отсутствующие среди тенант-таблиц: "
        f"{sorted(ghosts)}. Удалите их из KNOWN_TENANT_TABLES/WHITELIST_GLOBAL."
    )


def test_whitelist_tables_have_no_tenant_id_requirement():
    """Whitelist — только для СОЗНАТЕЛЬНО глобальных таблиц.

    Здесь же фиксируем инвариант: whitelist и baseline не пересекаются
    (таблица либо тенантная-и-покрыта, либо глобальная — не одновременно).
    """
    overlap = KNOWN_TENANT_TABLES & WHITELIST_GLOBAL
    assert not overlap, (
        f"Таблицы одновременно в baseline и whitelist: {sorted(overlap)}. "
        "Уберите из одного из множеств."
    )


def test_legacy_rls_migration_covered_tables_are_in_baseline():
    """Всё, что реально покрыто RLS в миграциях, должно быть частью baseline.

    Защищает от ситуации «миграция включила RLS на таблице, которой нет в
    baseline» (рассинхрон). Для динамической миграции Части A скан вернёт пусто
    — тогда проверка тривиально проходит (источник истины — baseline).
    """
    metadata = _load_metadata()
    tenant_tables = _tenant_tables(metadata)
    covered = _rls_covered_tables_from_migrations()
    # Сверяем только пересечение с реальными тенант-таблицами (миграции могут
    # упоминать и нетенантные имена в комментариях/служебных DDL).
    covered_tenant = covered & tenant_tables
    missing = covered_tenant - (KNOWN_TENANT_TABLES | WHITELIST_GLOBAL)
    assert not missing, (
        f"Миграции включают RLS на таблицах, отсутствующих в baseline: "
        f"{sorted(missing)}. Добавьте их в KNOWN_TENANT_TABLES."
    )


# ─────────────────────────────────────────────────────────────────────────────
# 2) INTEGRATION (реальный PostgreSQL; скип без Docker/testcontainers)
# ─────────────────────────────────────────────────────────────────────────────
#
# Используем фикстуру pg_engine из conftest (она поднимает PG 16 в Docker и
# create_all по Base.metadata). RLS-политику навешиваем в самом тесте на
# изолированную временную таблицу — не зависим от конкретной миграции Части A
# и от состояния прод-схемы; проверяем именно семантику RLS + наш begin-listener.

_RLS_DDL = """
CREATE TABLE IF NOT EXISTS _rls_probe (
    id uuid PRIMARY KEY,
    tenant_id uuid,
    note text
);
ALTER TABLE _rls_probe ENABLE ROW LEVEL SECURITY;
ALTER TABLE _rls_probe FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON _rls_probe;
CREATE POLICY tenant_isolation ON _rls_probe
    USING (
        current_setting('app.tenant_id', true) IS NULL
        OR current_setting('app.tenant_id', true) = ''
        OR tenant_id::text = current_setting('app.tenant_id', true)
    )
    WITH CHECK (
        current_setting('app.tenant_id', true) IS NULL
        OR current_setting('app.tenant_id', true) = ''
        OR tenant_id::text = current_setting('app.tenant_id', true)
    );
"""


@pytest.mark.integration
@pytest.mark.asyncio
async def test_rls_select_isolation_and_permissive_and_write_check(pg_engine):
    """Полный рантайм-контракт RLS на реальном PostgreSQL.

    1) SELECT под app.tenant_id=A → видны только строки A (не B);
    2) при пустом app.tenant_id → видны ВСЕ строки (permissive-when-unset);
    3) WITH CHECK: INSERT/UPDATE строки чужого тенанта под app.tenant_id=A → отказ.
    """
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    tenant_a = uuid.uuid4()
    tenant_b = uuid.uuid4()
    row_a = uuid.uuid4()
    row_b = uuid.uuid4()

    # ── setup: создаём таблицу + политику и сеем по строке на тенант ──
    # Сидим под суперролью (владелец), временно ОТКЛЮЧАЯ force, чтобы вставить
    # обе строки независимо от контекста.
    async with pg_engine.begin() as conn:
        for stmt in filter(None, (s.strip() for s in _RLS_DDL.split(";"))):
            await conn.execute(text(stmt))
        await conn.execute(text("ALTER TABLE _rls_probe NO FORCE ROW LEVEL SECURITY"))
        await conn.execute(
            text("INSERT INTO _rls_probe (id, tenant_id, note) VALUES (:i, :t, 'A')"),
            {"i": row_a, "t": tenant_a},
        )
        await conn.execute(
            text("INSERT INTO _rls_probe (id, tenant_id, note) VALUES (:i, :t, 'B')"),
            {"i": row_b, "t": tenant_b},
        )
        await conn.execute(text("ALTER TABLE _rls_probe FORCE ROW LEVEL SECURITY"))

    SessionLocal = async_sessionmaker(pg_engine, class_=AsyncSession, expire_on_commit=False)

    try:
        # 1) Изоляция чтения: под тенантом A видим только строку A
        async with SessionLocal() as s:
            await s.execute(
                text("SELECT set_config('app.tenant_id', :t, true)"),
                {"t": str(tenant_a)},
            )
            rows = (await s.execute(text("SELECT note FROM _rls_probe ORDER BY note"))).scalars().all()
            assert rows == ["A"], f"под tenant=A должны видеть только 'A', получили {rows}"

        # под тенантом B — только строку B
        async with SessionLocal() as s:
            await s.execute(
                text("SELECT set_config('app.tenant_id', :t, true)"),
                {"t": str(tenant_b)},
            )
            rows = (await s.execute(text("SELECT note FROM _rls_probe ORDER BY note"))).scalars().all()
            assert rows == ["B"], f"под tenant=B должны видеть только 'B', получили {rows}"

        # 2) Permissive-when-unset: пустой контекст → видны обе строки
        async with SessionLocal() as s:
            await s.execute(text("SELECT set_config('app.tenant_id', '', true)"))
            rows = (await s.execute(text("SELECT note FROM _rls_probe ORDER BY note"))).scalars().all()
            assert rows == ["A", "B"], f"при пустом контексте видны все строки, получили {rows}"

        # 3) WITH CHECK (negative на запись): под tenant=A нельзя вставить строку tenant=B
        async with SessionLocal() as s:
            await s.execute(
                text("SELECT set_config('app.tenant_id', :t, true)"),
                {"t": str(tenant_a)},
            )
            with pytest.raises(Exception):
                await s.execute(
                    text("INSERT INTO _rls_probe (id, tenant_id, note) VALUES (:i, :t, 'X')"),
                    {"i": uuid.uuid4(), "t": tenant_b},
                )
                await s.flush()
            await s.rollback()

        # 3b) UPDATE строки A на чужой tenant_id=B под контекстом A → отказ WITH CHECK
        async with SessionLocal() as s:
            await s.execute(
                text("SELECT set_config('app.tenant_id', :t, true)"),
                {"t": str(tenant_a)},
            )
            with pytest.raises(Exception):
                await s.execute(
                    text("UPDATE _rls_probe SET tenant_id = :b WHERE id = :i"),
                    {"b": tenant_b, "i": row_a},
                )
                await s.flush()
            await s.rollback()
    finally:
        async with pg_engine.begin() as conn:
            await conn.execute(text("DROP TABLE IF EXISTS _rls_probe"))


@pytest.mark.integration
@pytest.mark.asyncio
async def test_begin_listener_reapplies_tenant_after_commit(pg_engine):
    """Регрессия на корень находки #1/Часть B: контекст переживает mid-handler commit.

    Воспроизводит сценарий PHI-роутеров (medcard/patient_documents/patient_chat),
    где db.commit() вызывается В СЕРЕДИНЕ хэндлера. Старая одноразовая установка
    app.tenant_id после первого commit терялась → RLS становился permissive.
    Здесь проверяем, что begin-listener переустанавливает контекст для КАЖДОЙ
    новой транзакции той же сессии.
    """
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    import app.database as db_mod

    tenant_a = uuid.uuid4()
    tenant_b = uuid.uuid4()

    async with pg_engine.begin() as conn:
        for stmt in filter(None, (s.strip() for s in _RLS_DDL.split(";"))):
            await conn.execute(text(stmt))
        await conn.execute(text("ALTER TABLE _rls_probe NO FORCE ROW LEVEL SECURITY"))
        await conn.execute(
            text("INSERT INTO _rls_probe (id, tenant_id, note) VALUES (:i, :t, 'A')"),
            {"i": uuid.uuid4(), "t": tenant_a},
        )
        await conn.execute(
            text("INSERT INTO _rls_probe (id, tenant_id, note) VALUES (:i, :t, 'B')"),
            {"i": uuid.uuid4(), "t": tenant_b},
        )
        await conn.execute(text("ALTER TABLE _rls_probe FORCE ROW LEVEL SECURITY"))

    # Навешиваем тот же begin-listener на pg_engine (conftest-движок отдельный
    # от app.database.engine — у него listener не зарегистрирован).
    from sqlalchemy import event
    if not event.contains(pg_engine.sync_engine, "begin", db_mod._apply_tenant_on_begin):
        event.listen(pg_engine.sync_engine, "begin", db_mod._apply_tenant_on_begin)

    SessionLocal = async_sessionmaker(pg_engine, class_=AsyncSession, expire_on_commit=False)
    token = db_mod.current_tenant_id.set(str(tenant_a))
    try:
        async with SessionLocal() as s:
            # Транзакция №1 (begin-listener применил app.tenant_id=A)
            rows1 = (await s.execute(text("SELECT note FROM _rls_probe"))).scalars().all()
            assert rows1 == ["A"], f"txn#1 под A: {rows1}"
            # mid-handler commit → SET LOCAL сброшен, autobegin откроет txn№2
            await s.commit()
            # Транзакция №2: listener ДОЛЖЕН снова применить app.tenant_id=A
            rows2 = (await s.execute(text("SELECT note FROM _rls_probe"))).scalars().all()
            assert rows2 == ["A"], (
                f"txn#2 после commit под A: {rows2} — если ['A','B'], контекст "
                "потерян (регрессия находки #1/Часть B)"
            )
    finally:
        db_mod.current_tenant_id.reset(token)
        async with pg_engine.begin() as conn:
            await conn.execute(text("DROP TABLE IF EXISTS _rls_probe"))
