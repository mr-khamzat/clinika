"""rlsall01 — RLS tenant_isolation на ВСЕХ таблицах с tenant_id (находка #1, Часть A)

Revision ID: rlsall01
Revises: apptphi01
Create Date: 2026-06-08

Контекст (Волна 2, security-remediation-wave0):
Находка #1 (critical, tenant-isolation) — Row Level Security был включён лишь на
3 таблицах из ~79 моделей (referrals / bonuses / audit_log, миграция
`l2m3n4o5p6q7`), тогда как колонка `tenant_id` присутствует в ~118 таблицах.
БОЛЕЕ ТОГО, прежняя политика (`l2m3n4o5p6q7:32`) явно пропускала строки с
`tenant_id IS NULL` ВСЕМ тенантам — кросс-тенантная утечка ПДн на уровне БД.

Эта миграция реализует ЧАСТЬ A находки #1 — политики на уровне БД:
навешивает единую политику `tenant_isolation` на ВСЕ таблицы с колонкой
`tenant_id` (кроме явного whitelist глобальных таблиц), унифицируя 3 старые
таблицы под тот же предикат.

Часть B (реальная установка `app.tenant_id` в рантайме — починка
`get_tenant_db`/`get_db_for_tenant` + перевод роутеров с `Depends(get_db)` на
tenant-aware зависимость) — ОТДЕЛЬНАЯ прикладная задача; A и B выкатываются
СИНХРОННО (см. residualRisk и REMEDIATION-PLAN #1).

────────────────────────────────────────────────────────────────────────────
КЛЮЧЕВОЙ ПРИНЦИП БЕЗОПАСНОСТИ (поэтапный, не-ломающий выкат):

Политика ПРОПУСКАЕТ все строки таблицы, когда GUC `app.tenant_id` НЕ задан
(NULL или пустая строка). Логика выката:

  • Роутеры, ещё НЕ подключённые к tenant-контексту (Часть B), продолжают
    работать на своих ручных `WHERE tenant_id = ...` фильтрах — RLS их не
    ломает, потому что `app.tenant_id` у них пуст → политика пропускает всё
    (как и сегодня без RLS).
  • Где контекст УЖЕ задан (`SET LOCAL app.tenant_id = '<uuid>'`), RLS ЖЁСТКО
    изолирует: видны только строки своего тенанта.
  • Суперадмин-сессии (get_db без установки GUC) видят всё — это осознанный
    супер-режим (фоновые джобы, миграции, аналитика платформы).

Предикат (идентичен для USING и WITH CHECK):

    current_setting('app.tenant_id', true) IS NULL
    OR current_setting('app.tenant_id', true) = ''
    OR tenant_id::text = current_setting('app.tenant_id', true)

  • `current_setting(..., true)` — режим missing_ok=true: НЕ кидает ошибку,
    если GUC не определён, а возвращает NULL (иначе FORCE RLS уронил бы любой
    запрос без выставленного контекста).
  • `tenant_id::text` — `tenant_id` в моделях UUID; приводим обе стороны к
    text, чтобы сравнение не зависело от типа GUC (строка).

ВНИМАНИЕ: в отличие от старой политики `l2m3n4o5p6q7`, здесь НЕТ ветки
`tenant_id IS NULL` (которая пропускала осиротевшие строки всем). Закрытие
NULL-утечки — отдельные находки #7 (backfill + guard) и #2 (NOT NULL на
appointments). Поэтому ПОЛНЫЙ backfill NULL tenant_id (#7) обязан быть выкачен
ДО включения tenant-контекста в Части B — иначе при заданном `app.tenant_id`
исторические NULL-строки станут невидимы их же клинике.

────────────────────────────────────────────────────────────────────────────
КАК СОБИРАЕТСЯ СПИСОК ТАБЛИЦ:

Из `Base.metadata` — БЕЗ подключения к БД (engine SQLAlchemy ленив; читаются
только декларативные метаданные). Однако `from app.models import *`
(как в env.py) импортирует НЕ все модули моделей: ряд таблиц
(patient_accounts, medcard, patient_*, patient_session, blocked_ip и др.)
регистрируется на `Base.metadata` только через свои модули. Поэтому здесь
явно прогружаем ВСЕ модули пакета `app.models` через pkgutil.walk_packages.
Это критично:
  (1) иначе RLS молча не навесится на незагруженные таблицы (под-покрытие);
  (2) иначе обращение к метаданным таблицы с FK на незагруженную цель
      (например chat_threads → patient_accounts) даёт NoReferencedTableError.

Идемпотентность: ENABLE/FORCE ROW LEVEL SECURITY повторно не падает,
а политика всегда DROP POLICY IF EXISTS перед CREATE.
"""
import importlib
import pkgutil

from alembic import op
import sqlalchemy as sa

revision = "rlsall01"
down_revision = "apptphi01"
branch_labels = None
depends_on = None


# ─────────────────────────────────────────────────────────────────────────────
# WHITELIST — заведомо ГЛОБАЛЬНЫЕ таблицы: RLS НЕ навешиваем.
#
# Перечислено явной константой (а не вычисляется), чтобы исключение было
# осознанным и ревьюируемым. Все элементы — таблицы без тенант-скоупа:
#
#   • patient_accounts   — глобальный справочник пациентов по телефону
#                          (находка #18: у него ВООБЩЕ нет колонки tenant_id,
#                          изоляция вводится отдельно через M2M tenant_patients).
#                          Из-за отсутствия tenant_id он и так не попал бы в
#                          выборку ниже — но фиксируем явно как защиту от
#                          случайного добавления tenant_id в эту модель.
#   • alembic_version    — служебная таблица Alembic, без tenant_id; не
#                          управляется ORM (нет в Base.metadata), включаем в
#                          whitelist лишь для документированной полноты.
#
# Прочих «справочников без тенант-скоупа» в metadata с колонкой tenant_id не
# обнаружено (cities/services/discounts/loyalty_tiers — все тенант-скоупны).
# При появлении нового глобального справочника с tenant_id — добавить сюда.
# ─────────────────────────────────────────────────────────────────────────────
WHITELIST_GLOBAL_TABLES = frozenset({
    "patient_accounts",
    "alembic_version",
})


# Предикат политики (USING == WITH CHECK). Один источник истины.
_POLICY_PREDICATE = (
    "current_setting('app.tenant_id', true) IS NULL "
    "OR current_setting('app.tenant_id', true) = '' "
    "OR tenant_id::text = current_setting('app.tenant_id', true)"
)


def _tenant_tables() -> list[str]:
    """Имена всех таблиц с колонкой tenant_id, кроме whitelist.

    Читает ТОЛЬКО декларативные метаданные (без подключения к БД). Перед
    чтением явно прогружает все модули app.models, чтобы:
      • покрыть таблицы, не реэкспортируемые через app.models.__init__;
      • зарегистрировать FK-цели (иначе доступ к metadata может упасть
        NoReferencedTableError).
    """
    # app.database определяет Base и создаёт ЛЕНИВЫЙ async-engine (соединение
    # не открывается при импорте) — безопасно в alembic-контексте.
    from app.database import Base
    import app.models as models_pkg

    for module_info in pkgutil.walk_packages(
        models_pkg.__path__, models_pkg.__name__ + "."
    ):
        importlib.import_module(module_info.name)

    # Используем .tables.values() (а НЕ sorted_tables): топологическая
    # сортировка для DDL RLS не нужна, а .tables устойчив к циклам FK
    # (в схеме есть взаимозависимые таблицы clinics/users/...).
    names = [
        table.name
        for table in Base.metadata.tables.values()
        if "tenant_id" in table.columns
        and table.name not in WHITELIST_GLOBAL_TABLES
    ]
    # Детерминированный порядок применения (для предсказуемых логов миграции).
    return sorted(names)


def upgrade() -> None:
    # Только реально существующие таблицы: список из Base.metadata может включать
    # таблицы, создаваемые ПОЗЖЕ в цепочке (tenant_patients из tpat01 — он сам
    # навешивает RLS). Иначе ALTER TABLE упадёт «relation does not exist».
    existing_tables = set(sa.inspect(op.get_bind()).get_table_names())
    for table in _tenant_tables():
        if table not in existing_tables:
            continue
        # Включаем RLS. Повторный ENABLE не падает → идемпотентно.
        op.execute(sa.text(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY'))
        # FORCE — политика применяется И к владельцу таблицы (иначе owner/
        # суперпользователь БД обходит RLS). Совместимо с супер-режимом:
        # при пустом app.tenant_id политика всё равно пропускает всё.
        op.execute(sa.text(f'ALTER TABLE "{table}" FORCE ROW LEVEL SECURITY'))
        # Унификация: дропаем существующую политику (в т.ч. старую с веткой
        # tenant_id IS NULL на referrals/bonuses/audit_log) перед пересозданием.
        op.execute(sa.text(f'DROP POLICY IF EXISTS tenant_isolation ON "{table}"'))
        op.execute(sa.text(
            f'CREATE POLICY tenant_isolation ON "{table}" '
            f"USING ({_POLICY_PREDICATE}) "
            f"WITH CHECK ({_POLICY_PREDICATE})"
        ))


def downgrade() -> None:
    existing_tables = set(sa.inspect(op.get_bind()).get_table_names())
    for table in _tenant_tables():
        if table not in existing_tables:
            continue
        op.execute(sa.text(f'DROP POLICY IF EXISTS tenant_isolation ON "{table}"'))
        # Снимаем FORCE и сам RLS (NO FORCE неявно сбрасывается DISABLE).
        op.execute(sa.text(f'ALTER TABLE "{table}" NO FORCE ROW LEVEL SECURITY'))
        op.execute(sa.text(f'ALTER TABLE "{table}" DISABLE ROW LEVEL SECURITY'))
