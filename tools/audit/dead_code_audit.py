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


# api/apiClient/client.method('url'). Список известных имён клиентов в этом репо.
_API_CLIENT_NAMES = (
    "api", "apiClient", "axiosClient",
    "client", "httpClient", "http",
)
_RE_API_CALL = re.compile(
    r'\b(?:' + "|".join(_API_CLIENT_NAMES) + r')'
    r'\.(get|post|put|delete|patch)\s*\(\s*[\'"`]([^\'"`]+)[\'"`]',
)
_RE_TEMPLATE_VAR = re.compile(r'\$\{[^}]+\}')


def _strip_jsx_comments(text: str) -> str:
    """Однострочные // и многострочные /* */ комментарии."""
    text = re.sub(r'//[^\n]*', '', text)
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.DOTALL)
    return text


def _normalize_path_for_match(p: str) -> str:
    """Заменяем {anything} → {var} (унификация path-параметров)."""
    return re.sub(r"\{[^}]+\}", "{var}", p)


def classify_endpoint(endpoint: dict, calls: list[dict], text_corpus: str) -> str:
    """Возвращает один из: alive | review | safe.

    alive  — есть фронт-вызов с тем же method и нормализованным path
    review — нет вызова, но путь упоминается в репо (в комментах/строках)
    safe   — путь нигде не встречается
    """
    target = _normalize_path_for_match(endpoint["path"])
    for c in calls:
        if c["method"] != endpoint["method"]:
            continue
        if _normalize_path_for_match(c["path"]) == target:
            return "alive"
    if endpoint["path"] in text_corpus:
        return "review"
    return "safe"


_RE_IMPORT = re.compile(
    r'(?:^|\n)\s*import\s+(?:[\w*{}\s,]+from\s+)?[\'"]([^\'"]+)[\'"]'
)
_RE_LAZY = re.compile(
    r'lazy\s*\(\s*\(\s*\)\s*=>\s*import\s*\(\s*[\'"]([^\'"]+)[\'"]'
)


def extract_frontend_imports(path: pathlib.Path) -> list[dict]:
    """Извлекает [{file, target, kind}] импортов из .jsx/.js файла.

    kind: 'static' (обычный import) | 'lazy' (React.lazy)
    """
    text = _strip_jsx_comments(
        path.read_text(encoding="utf-8", errors="ignore")
    )
    out: list[dict] = []
    for m in _RE_IMPORT.finditer(text):
        out.append({"file": str(path), "target": m.group(1), "kind": "static"})
    for m in _RE_LAZY.finditer(text):
        out.append({"file": str(path), "target": m.group(1), "kind": "lazy"})
    return out


def extract_frontend_api_calls(path: pathlib.Path) -> list[dict]:
    """Извлекает [{file, method, path}] вызовов api.* из .jsx/.js файла."""
    text = _strip_jsx_comments(
        path.read_text(encoding="utf-8", errors="ignore")
    )
    out: list[dict] = []
    for m in _RE_API_CALL.finditer(text):
        method = m.group(1).upper()
        raw = m.group(2)
        path_norm = _RE_TEMPLATE_VAR.sub("{var}", raw)
        out.append({"file": str(path), "method": method, "path": path_norm})
    return out


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
