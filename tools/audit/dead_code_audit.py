#!/usr/bin/env python3
"""
Dead-code audit Клиники.
См. docs/superpowers/specs/2026-05-16-dead-code-audit-design.md
"""
from __future__ import annotations
import argparse
import datetime
import json
import os
import pathlib
import re
import subprocess
import sys
import urllib.parse
import urllib.request

REPO_ROOT = pathlib.Path("/opt/clinika")
BACKEND_DIR = REPO_ROOT / "backend" / "app"
FRONTEND_DIR = REPO_ROOT / "frontend" / "src"
AUDIT_DIR = REPO_ROOT / "tools" / "audit"
TODAY = datetime.date.today().isoformat()


# ── Парсеры ─────────────────────────────────────────────────────────────────

# @router.get("/path") или @app.get("/path")
_RE_ROUTE = re.compile(
    r'^\s*@(?:router|app)\.(get|post|put|delete|patch|options|head)'
    r'\(\s*[\'"]([^\'"]+)[\'"]',
    re.MULTILINE,
)
_RE_PREFIX = re.compile(
    r'APIRouter\s*\(\s*[^)]*prefix\s*=\s*[\'"]([^\'"]+)[\'"]'
)


def extract_backend_endpoints(path: pathlib.Path) -> list[dict]:
    """Извлекает [{file, method, path}] из одного .py файла."""
    text = path.read_text(encoding="utf-8", errors="ignore")
    # Удаляем строки-комментарии (полные #-строки) перед матчингом.
    cleaned = "\n".join(
        line for line in text.splitlines()
        if not line.lstrip().startswith("#")
    )
    prefix_match = _RE_PREFIX.search(cleaned)
    prefix = prefix_match.group(1) if prefix_match else ""
    out: list[dict] = []
    for m in _RE_ROUTE.finditer(cleaned):
        method, sub = m.group(1).upper(), m.group(2)
        if sub.startswith("/"):
            full = prefix + sub
        else:
            full = f"{prefix}/{sub}"
        # «/» в конце префикса + «/» в начале sub → двойной слеш, чиним
        full = re.sub(r"//+", "/", full)
        out.append({"file": str(path), "method": method, "path": full})
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Dead-code audit Клиники")
    ap.add_argument("--no-telegram", action="store_true",
                    help="Не отправлять в TG, только записать отчёт")
    ap.add_argument("--bot-token", default=os.environ.get("TG_BOT_TOKEN", ""),
                    help="Token для Telegram Bot API (по умолч. из ENV TG_BOT_TOKEN)")
    ap.add_argument("--chat-id", default=os.environ.get("TG_CHAT_ID", "293633093"),
                    help="Chat ID получателя")
    args = ap.parse_args()
    print(f"[audit] start {TODAY}")
    # Реализация в Task 2+.
    return 0


if __name__ == "__main__":
    sys.exit(main())
