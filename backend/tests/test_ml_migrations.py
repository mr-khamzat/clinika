"""
Точечные тесты пакета "migrations" (находка #44 + сопутствующий replay-баг).

Контекст
--------
Реплей миграций «с нуля» (чистая БД) падал: начальная миграция
`bdc4ea7233ff_initial_schema` и следующая за ней `3bb50c97a428_etap1_tenant_multi`
содержали авто-сгенерированный
    op.drop_index('ix_mis_log_created', table_name='mis_integration_log')
без IF EXISTS. На пустой БД таблицы/индекса ещё нет → DROP INDEX без IF EXISTS
кидает ошибку и обрывает `alembic upgrade head` с нуля.

Фикс (по паттерну проекта — ср. acct01_cashshift, bonusunique01 и др.):
заменить на идемпотентный
    op.execute("DROP INDEX IF EXISTS ix_mis_log_created")
без смены revision/down_revision.

Что проверяем (unit, без Docker/Postgres — читаем исходники миграций как текст
и парсим AST; никакого подключения к БД):
  • ни одна миграция больше не делает неидемпотентный drop индекса
    `ix_mis_log_created` через op.drop_index(...);
  • затронутые файлы используют идемпотентный «DROP INDEX IF EXISTS
    ix_mis_log_created»;
  • правки НЕ сменили revision/down_revision затронутых ревизий
    (history-граф не поехал);
  • merge-миграция secmerge01 остаётся валидной склейкой без DDL
    (находка #44: семь merge-узлов при единственном head — сам файл корректен).

Запуск: pytest backend/tests/test_ml_migrations.py -v
"""
from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest

pytestmark = pytest.mark.unit

# .../backend/tests/test_ml_migrations.py -> .../backend/alembic/versions
VERSIONS_DIR = Path(__file__).resolve().parents[1] / "alembic" / "versions"

# Миграции, которые трогали ix_mis_log_created (начальная + etap1).
TOUCHED = {
    "bdc4ea7233ff_initial_schema.py": ("bdc4ea7233ff", None),
    "3bb50c97a428_etap1_tenant_multi.py": ("3bb50c97a428", "bdc4ea7233ff"),
}


def _read(name: str) -> str:
    return (VERSIONS_DIR / name).read_text(encoding="utf-8")


def _all_migration_sources():
    for p in VERSIONS_DIR.glob("*.py"):
        if p.name == "__init__.py":
            continue
        yield p.name, p.read_text(encoding="utf-8")


# ── 1. Ни одна миграция не делает неидемпотентный drop ix_mis_log_created ────

def test_no_nonidempotent_drop_of_mis_log_index():
    offenders = []
    pat = re.compile(r"op\.drop_index\(\s*['\"]ix_mis_log_created['\"]")
    for name, src in _all_migration_sources():
        if pat.search(src):
            offenders.append(name)
    assert not offenders, (
        "Неидемпотентный op.drop_index('ix_mis_log_created') ломает реплей с нуля; "
        f"используйте DROP INDEX IF EXISTS. Нарушители: {offenders}"
    )


# ── 2. Затронутые файлы используют идемпотентный DROP INDEX IF EXISTS ────────

@pytest.mark.parametrize("fname", sorted(TOUCHED))
def test_touched_migration_uses_if_exists(fname):
    src = _read(fname)
    assert re.search(
        r"DROP\s+INDEX\s+IF\s+EXISTS\s+ix_mis_log_created",
        src,
        re.IGNORECASE,
    ), f"{fname}: ожидался идемпотентный 'DROP INDEX IF EXISTS ix_mis_log_created'"


# ── 3. revision/down_revision затронутых ревизий не изменились ───────────────

def _module_assignments(src: str) -> dict:
    """Возвращает значения простых присваиваний верхнего уровня (revision/...)."""
    tree = ast.parse(src)
    out: dict = {}
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for tgt in node.targets:
                if isinstance(tgt, ast.Name):
                    try:
                        out[tgt.id] = ast.literal_eval(node.value)
                    except Exception:
                        pass
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            if node.value is not None:
                try:
                    out[node.target.id] = ast.literal_eval(node.value)
                except Exception:
                    pass
    return out


@pytest.mark.parametrize("fname", sorted(TOUCHED))
def test_revision_graph_unchanged(fname):
    rev, down = TOUCHED[fname]
    asg = _module_assignments(_read(fname))
    assert asg.get("revision") == rev, f"{fname}: revision сменился ({asg.get('revision')!r})"
    assert asg.get("down_revision") == down, (
        f"{fname}: down_revision сменился ({asg.get('down_revision')!r})"
    )


# ── 4. merge-миграция secmerge01 — валидная склейка без DDL (находка #44) ────

def test_secmerge01_is_pure_noddl_merge():
    src = _read("secmerge01_merge_heads.py")
    asg = _module_assignments(src)
    assert asg.get("revision") == "secmerge01"
    # склейка трёх параллельных веток в один head
    assert set(asg.get("down_revision") or ()) == {"marketplace01", "tenantapi01", "security01"}

    tree = ast.parse(src)
    funcs = {n.name: n for n in tree.body if isinstance(n, ast.FunctionDef)}
    for fn in ("upgrade", "downgrade"):
        assert fn in funcs, f"secmerge01: нет функции {fn}()"
        # тело — только pass (+ возможный docstring): никакого DDL в merge-узле
        body = [s for s in funcs[fn].body if not (
            isinstance(s, ast.Expr) and isinstance(s.value, ast.Constant)
        )]
        assert len(body) == 1 and isinstance(body[0], ast.Pass), (
            f"secmerge01.{fn}() должна быть пустой склейкой (pass), без DDL"
        )
