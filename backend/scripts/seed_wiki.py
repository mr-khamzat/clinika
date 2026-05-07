"""
Сид Wiki-страниц из markdown-файлов в таблицу wiki_pages.

Читает все .md файлы из директории wiki_content/ и метаданные
из _index.json (slug, title, order). Если страница со slug уже
существует — пропускает (idempotent).

Запуск:
  docker exec clinika-backend python -m scripts.seed_wiki
  docker exec clinika-backend python -m scripts.seed_wiki --content-dir /app/wiki_content

Замечание по архитектуре:
  Модель WikiPage хранит страницы глобально (без tenant_id) — Wiki
  является общей документацией платформы для всех тенантов.
  Параметр --tenant принимается для совместимости с CLI, но не
  влияет на запись (slug у WikiPage UNIQUE на уровне таблицы).
"""
import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

# Корень проекта = родитель папки scripts/
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from sqlalchemy import select  # noqa: E402

from app.database import AsyncSessionLocal  # noqa: E402
from app.models.wiki import WikiPage  # noqa: E402


# ── Маппинг иконок по категориям из _index.json ──────────────────────────────
ICON_BY_CATEGORY = {
    "role": "person",
    "concepts": "lightbulb",
    "setup": "rocket_launch",
}


async def seed(content_dir: Path) -> dict:
    """Читает .md файлы и складывает в wiki_pages. Возвращает статистику."""
    index_path = content_dir / "_index.json"
    if not index_path.exists():
        raise FileNotFoundError(f"Не найден {index_path} — нужен индекс с метаданными")

    index = json.loads(index_path.read_text(encoding="utf-8"))
    print(f"[seed_wiki] Найдено {len(index)} записей в _index.json")

    created = 0
    skipped = 0
    missing = 0

    async with AsyncSessionLocal() as db:
        for entry in index:
            slug = entry["slug"]
            title = entry["title"]
            category = entry.get("category", "role")
            order = int(entry.get("order", 0))

            md_path = content_dir / f"{slug}.md"
            if not md_path.exists():
                print(f"  [MISS] {slug}.md — файл не найден, пропуск")
                missing += 1
                continue

            content_md = md_path.read_text(encoding="utf-8")

            # Проверяем уникальность slug — если есть, пропускаем (idempotent)
            existing = (await db.execute(
                select(WikiPage).where(WikiPage.slug == slug)
            )).scalar_one_or_none()

            if existing:
                print(f"  [SKIP] {slug} — уже есть в БД")
                skipped += 1
                continue

            page = WikiPage(
                slug=slug,
                title=title,
                content_md=content_md,
                icon=ICON_BY_CATEGORY.get(category, "article"),
                # Сортируем: roles → concepts → setup, внутри по order
                sort_order=(
                    1000 if category == "role" else
                    2000 if category == "concepts" else
                    3000 if category == "setup" else 4000
                ) + order,
                is_published=True,
            )
            db.add(page)
            created += 1
            print(f"  [ADD]  {slug} → {title[:50]}")

        await db.commit()

    return {"created": created, "skipped": skipped, "missing": missing, "total": len(index)}


def main():
    parser = argparse.ArgumentParser(description="Seed Wiki pages from markdown files")
    parser.add_argument(
        "--content-dir",
        default=os.environ.get("WIKI_CONTENT_DIR", str(ROOT / "wiki_content")),
        help="Путь к директории с .md файлами и _index.json",
    )
    parser.add_argument(
        "--tenant",
        default=None,
        help="Slug тенанта (для совместимости; WikiPage глобальна)",
    )
    args = parser.parse_args()

    content_dir = Path(args.content_dir)
    if not content_dir.exists():
        print(f"ERROR: директория {content_dir} не найдена", file=sys.stderr)
        sys.exit(1)

    if args.tenant:
        print(f"[seed_wiki] (info) tenant={args.tenant} — Wiki глобальна, параметр игнорируется")

    print(f"[seed_wiki] content_dir = {content_dir}")
    stats = asyncio.run(seed(content_dir))
    print(
        f"[seed_wiki] DONE: created={stats['created']} "
        f"skipped={stats['skipped']} missing={stats['missing']} total={stats['total']}"
    )


if __name__ == "__main__":
    main()
