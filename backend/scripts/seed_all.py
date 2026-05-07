"""
Объединённый seed-скрипт: все каталожные данные одним вызовом.

Заменяет россыпь отдельных seed-скриптов:
  - backend/scripts/seed_wiki.py
  - backend/app/services/seed_plans.py
  - backend/app/services/seed_ltv_module.py
  - backend/app/services/seed_payment_modules.py

Старые скрипты оставлены для совместимости с существующими docker-командами,
но помечены как deprecated в их docstring.

Запуск:
  # Засеять всё (рекомендуется на свежем окружении)
  docker exec clinika-backend python -m scripts.seed_all --all

  # Только нужные блоки (флаги комбинируются)
  docker exec clinika-backend python -m scripts.seed_all --wiki --modules
  docker exec clinika-backend python -m scripts.seed_all --plans
  docker exec clinika-backend python -m scripts.seed_all --ltv --payments

Флаги:
  --wiki        — Wiki-страницы из markdown (scripts/seed_wiki.py)
  --plans       — Тарифные планы basic/pro/ent (services/seed_plans.py)
  --modules     — Псевдоним для --ltv --payments (все коммерческие модули)
  --ltv         — Модуль ltv_pro (services/seed_ltv_module.py)
  --payments    — Модули online_payments_pro и fiscal_54fz_pro (services/seed_payment_modules.py)
  --all         — Запустить все блоки (--wiki --plans --ltv --payments)

Все вызовы идемпотентны — повторный запуск безопасен (ON CONFLICT DO NOTHING /
проверка существования по ключу).
"""
import argparse
import asyncio
import sys
from pathlib import Path

# Корень бэкенда = родитель папки scripts/
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


async def run_wiki(args) -> int:
    """Засеять Wiki-страницы из markdown-файлов."""
    from scripts.seed_wiki import seed as seed_wiki_fn  # сигнатура: async seed(content_dir: Path)
    print("[seed_all] === Wiki ===")
    result = await seed_wiki_fn(Path(args.content_dir))
    print(f"[seed_all] Wiki: {result}")
    return result


async def run_plans() -> None:
    """Засеять тарифные планы (через app.services.seed_plans.main — он сам открывает сессию)."""
    from app.services.seed_plans import main as seed_plans_main
    print("[seed_all] === Tariff Plans ===")
    await seed_plans_main()


async def run_ltv() -> None:
    """Засеять модуль ltv_pro."""
    from app.services.seed_ltv_module import seed_ltv_module
    print("[seed_all] === Commercial Module: ltv_pro ===")
    await seed_ltv_module()


async def run_payments() -> None:
    """Засеять модули online_payments_pro и fiscal_54fz_pro."""
    from app.services.seed_payment_modules import seed_payment_modules
    print("[seed_all] === Commercial Modules: payments + 54-ФЗ ===")
    await seed_payment_modules()


async def main():
    parser = argparse.ArgumentParser(description="Объединённый seed-скрипт")
    parser.add_argument("--wiki",     action="store_true", help="Засеять Wiki")
    parser.add_argument("--plans",    action="store_true", help="Засеять тарифные планы")
    parser.add_argument("--modules",  action="store_true", help="Псевдоним --ltv --payments")
    parser.add_argument("--ltv",      action="store_true", help="Засеять модуль ltv_pro")
    parser.add_argument("--payments", action="store_true", help="Засеять платёжные модули")
    parser.add_argument("--all",      action="store_true", help="Все флаги сразу")
    parser.add_argument(
        "--content-dir",
        type=str,
        default="/app/wiki_content",
        help="Директория с .md файлами для Wiki (по умолчанию /app/wiki_content)",
    )
    args = parser.parse_args()

    # Если ни одного флага не задано — печатаем help и выходим
    if not any([args.wiki, args.plans, args.modules, args.ltv, args.payments, args.all]):
        parser.print_help()
        sys.exit(1)

    # --all → включаем всё
    if args.all:
        args.wiki = args.plans = args.ltv = args.payments = True

    # --modules → ltv + payments
    if args.modules:
        args.ltv = args.payments = True

    if args.wiki:
        await run_wiki(args)
    if args.plans:
        await run_plans()
    if args.ltv:
        await run_ltv()
    if args.payments:
        await run_payments()

    print("[seed_all] Done.")


if __name__ == "__main__":
    asyncio.run(main())
