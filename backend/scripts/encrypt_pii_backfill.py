"""
encrypt_pii_backfill — идемпотентный backfill шифрования ИСТОРИЧЕСКИХ ПДн.

[Находки #2 / #17 / #18 — 152-ФЗ]
Миграции уже добавили shadow-колонки *_encrypted / *_hash, а listener pii_sync
(app/services/pii_sync.py) шифрует НОВЫЕ/изменяемые записи прозрачно. Но
СУЩЕСТВУЮЩИЕ строки, созданные до deploy, остаются с пустыми shadow-колонками —
их нельзя зашифровать в DDL-миграции вслепую (нужен стабильный SECRET_KEY и
контролируемое maintenance-окно). Этот скрипт делает разовый (повторяемый)
backfill таких строк.

ЧТО ШИФРУЕТ (берётся 1:1 из pii_sync._MAP — единый источник истины, чтобы
схема backfill и схема listener'а никогда не расходились):
  • appointments       — patient_phone(+hash), patient_name(+hash), notes
  • patient_diagnoses  — name, notes
  • patient_allergies  — allergen, reaction
  • patient_vaccinations— vaccine_name
  • lab_results        — value, reference_range, raw_json (JSONB→JSON-строка)
  • patient_vitals     — value_extra (JSONB→JSON-строка), note
  • patient_accounts   — name(+hash)

ИДЕМПОТЕНТНОСТЬ (можно безопасно перезапускать):
  Обрабатывается ПОЛЕ, а не строка целиком. Поле берётся в работу, только если
  его *_encrypted ещё НЕ финально зашифровано (NULL или не начинается с 'enc:')
  И есть непустой plaintext-источник. Уже зашифрованные ('enc:...') поля
  пропускаются. Пустой/NULL plaintext не трогается (shadow остаётся NULL).
  Это корректно обрабатывает и частично зашифрованные строки (одно поле уже
  'enc:', другое ещё нет), и повторный прогон после сбоя.

БЕЗОПАСНОСТЬ:
  • НЕ переименовывает и НЕ удаляет plaintext-колонки (это сделает поздняя миграция).
  • НЕ падает на NULL/пустых значениях.
  • Шифрует ровно тем же encryption_service, что и listener → значения совместимы.
  • Требует СТАБИЛЬНЫЙ SECRET_KEY: ключ Fernet и blind-index hash деривируются
    из settings.secret_key. Если SECRET_KEY пуст/недоступен, encryption_service
    отдаёт 'plain:<value>' — такие поля скрипт НЕ считает зашифрованными и не
    запишет их (см. _is_encrypted). См. README_encrypt_backfill.md.

ЗАПУСК (в maintenance-окне, ПОСЛЕ применения миграций shadow-колонок):
    docker compose exec clinika-backend python -m scripts.encrypt_pii_backfill
    # сухой прогон (только счёт, ничего не пишет):
    docker compose exec clinika-backend python -m scripts.encrypt_pii_backfill --dry-run
    # один тип/таблица:
    python -m scripts.encrypt_pii_backfill --only appointments
    # размер батча:
    python -m scripts.encrypt_pii_backfill --batch-size 1000
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys

# /app в PYTHONPATH (если запускают как ./scripts/encrypt_pii_backfill.py)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select  # noqa: E402

from app.database import AsyncSessionLocal  # noqa: E402
# Переиспользуем единую карту полей и helper шифрования listener'а — НЕ дублируем
# схему, иначе backfill и listener рискуют разойтись при будущих правках.
from app.services.pii_sync import _MAP, _enc  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("encrypt_pii_backfill")

DEFAULT_BATCH = 500

# Человекочитаемое имя таблицы для CLI-флага --only (по __tablename__ модели).
_MODELS_BY_TABLE = {m.__tablename__: m for m in _MAP}


def _is_encrypted(token) -> bool:
    """True, если значение УЖЕ финально зашифровано ('enc:...').

    'plain:...' (fallback при отсутствующем SECRET_KEY) и любое другое значение
    зашифрованным НЕ считаются — такое поле будет перешифровано при корректно
    настроенном ключе на следующем прогоне (идемпотентно «вперёд к шифру»).
    """
    return isinstance(token, str) and token.startswith("enc:")


def _is_empty_plain(value) -> bool:
    """True для значений, которые шифровать НЕ нужно (NULL / пустая строка).

    Для JSONB-полей (dict/list) пустой считается только None — пустой dict/list
    listener тоже сериализует (json.dumps), поэтому здесь только None == пусто.
    """
    return value is None or value == ""


def _field_needs_backfill(target, plain_attr: str, dst: dict) -> bool:
    """Нужно ли (пере)шифровать конкретное поле строки.

    Берём поле в работу, только если:
      • его *_encrypted ещё НЕ 'enc:...' (NULL или legacy/plain), И
      • есть непустой plaintext-источник.
    """
    enc_attr = dst["enc"]
    if _is_encrypted(getattr(target, enc_attr, None)):
        return False
    value = getattr(target, plain_attr, None)
    if dst.get("json"):
        # JSONB: пусто только если None (пустой dict/list — валидные данные).
        return value is not None
    return not _is_empty_plain(value)


def _apply_field(target, plain_attr: str, dst: dict) -> None:
    """Заполнить shadow-колонки одного поля (шифр + опц. blind-index hash).

    Логика идентична pii_sync._sync_target, но применяется выборочно к полям,
    прошедшим _field_needs_backfill (не перетираем уже-'enc:' и не пишем пустые).
    """
    value = getattr(target, plain_attr, None)
    setattr(target, dst["enc"], _enc(value, as_json=dst.get("json", False)))
    hash_cfg = dst.get("hash")
    if hash_cfg:
        hash_attr, hash_fn = hash_cfg
        setattr(target, hash_attr, hash_fn(value))


async def _backfill_model(model, *, batch_size: int, dry_run: bool) -> tuple[int, int, int]:
    """Backfill одной модели keyset-пагинацией по id.

    Returns: (seen_rows, touched_rows, encrypted_fields)
    """
    spec = _MAP[model]
    table = model.__tablename__
    seen = 0
    touched_rows = 0
    enc_fields = 0
    last_id = None

    while True:
        async with AsyncSessionLocal() as db:
            stmt = select(model).order_by(model.id).limit(batch_size)
            if last_id is not None:
                stmt = stmt.where(model.id > last_id)
            rows = (await db.execute(stmt)).scalars().all()
            if not rows:
                break

            batch_touched = 0
            batch_fields = 0
            for target in rows:
                seen += 1
                last_id = target.id
                row_touched = False
                for plain_attr, dst in spec.items():
                    if not _field_needs_backfill(target, plain_attr, dst):
                        continue
                    batch_fields += 1
                    row_touched = True
                    if not dry_run:
                        _apply_field(target, plain_attr, dst)
                if row_touched:
                    batch_touched += 1

            if dry_run:
                # Ничего не пишем — откатываем любые случайные autoflush-изменения.
                await db.rollback()
            else:
                # Listener pii_sync на before_update перепишет shadow-колонки из
                # plaintext тем же образом — это безопасно (тот же результат).
                await db.commit()

            touched_rows += batch_touched
            enc_fields += batch_fields
            log.info(
                "%s: батч %d строк (last_id=%s) — %s %d строк / %d полей "
                "(итого: %d строк, %d полей из %d просм.)",
                table, len(rows), last_id,
                "НАШёл к шифрованию" if dry_run else "зашифровано",
                batch_touched, batch_fields,
                touched_rows, enc_fields, seen,
            )

            if len(rows) < batch_size:
                break

    return seen, touched_rows, enc_fields


async def backfill(*, batch_size: int, dry_run: bool, only: str | None) -> None:
    if only:
        model = _MODELS_BY_TABLE.get(only)
        if model is None:
            valid = ", ".join(sorted(_MODELS_BY_TABLE))
            raise SystemExit(f"--only: неизвестная таблица '{only}'. Доступно: {valid}")
        models = [model]
    else:
        models = list(_MAP)

    mode = "DRY-RUN (ничего не пишется)" if dry_run else "ЗАПИСЬ"
    log.info("encrypt_pii_backfill старт [%s], batch=%d, таблиц=%d",
             mode, batch_size, len(models))

    grand_seen = grand_rows = grand_fields = 0
    for model in models:
        seen, rows, fields = await _backfill_model(
            model, batch_size=batch_size, dry_run=dry_run
        )
        grand_seen += seen
        grand_rows += rows
        grand_fields += fields
        log.info("%s: ГОТОВО — просмотрено %d, затронуто %d строк, %d полей",
                 model.__tablename__, seen, rows, fields)

    log.info(
        "encrypt_pii_backfill ВСЁ ГОТОВО [%s] — просмотрено %d строк, "
        "%s %d строк / %d полей",
        mode, grand_seen,
        "к шифрованию" if dry_run else "зашифровано",
        grand_rows, grand_fields,
    )
    if dry_run:
        log.info("DRY-RUN: повторите без --dry-run в maintenance-окне для записи.")


def _parse_args(argv=None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Идемпотентный backfill шифрования историч. ПДн (#2/#17/#18).",
    )
    p.add_argument(
        "--dry-run", action="store_true",
        help="Только посчитать, сколько строк/полей подлежит шифрованию (ничего не пишет).",
    )
    p.add_argument(
        "--batch-size", type=int, default=DEFAULT_BATCH,
        help=f"Размер батча keyset-пагинации (по умолчанию {DEFAULT_BATCH}).",
    )
    p.add_argument(
        "--only", default=None,
        help="Обработать только одну таблицу (например: appointments). "
             f"Доступно: {', '.join(sorted(_MODELS_BY_TABLE))}.",
    )
    args = p.parse_args(argv)
    if args.batch_size < 1:
        p.error("--batch-size должен быть >= 1")
    return args


if __name__ == "__main__":
    ns = _parse_args()
    asyncio.run(backfill(batch_size=ns.batch_size, dry_run=ns.dry_run, only=ns.only))
