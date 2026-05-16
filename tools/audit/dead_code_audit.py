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


# ── Scanning ────────────────────────────────────────────────────────────────

def _walk_files(root: pathlib.Path, suffixes: tuple[str, ...]) -> list[pathlib.Path]:
    return [
        p for p in root.rglob("*")
        if p.suffix in suffixes and p.is_file()
        and "/node_modules/" not in str(p)
        and "/__pycache__/" not in str(p)
    ]


def scan_all() -> dict:
    print("[audit] scan backend …")
    py_files = _walk_files(BACKEND_DIR, (".py",))
    endpoints: list[dict] = []
    for f in py_files:
        endpoints.extend(extract_backend_endpoints(f))
    print(f"[audit]  ↳ endpoints: {len(endpoints)}")

    print("[audit] scan frontend …")
    js_files = _walk_files(FRONTEND_DIR, (".jsx", ".js", ".ts", ".tsx"))
    calls: list[dict] = []
    imports: list[dict] = []
    for f in js_files:
        calls.extend(extract_frontend_api_calls(f))
        imports.extend(extract_frontend_imports(f))
    print(f"[audit]  ↳ api-calls: {len(calls)}  imports: {len(imports)}")

    # Текстовый корпус всего фронта (для эвристики "review")
    corpus_parts: list[str] = []
    for f in js_files:
        try:
            corpus_parts.append(f.read_text(encoding="utf-8", errors="ignore"))
        except Exception:
            pass
    text_corpus = "\n".join(corpus_parts)

    classified = [
        {**ep, "risk": classify_endpoint(ep, calls, text_corpus)}
        for ep in endpoints
    ]

    # Frontend orphan компоненты
    referenced: set[str] = set()
    for imp in imports:
        bn = pathlib.Path(imp["target"]).name
        referenced.add(bn.split(".")[0])
    orphan_components: list[dict] = []
    for f in js_files:
        name = f.stem
        # Компонентами считаем .jsx с PascalCase именем
        if not name or not name[0].isupper():
            continue
        if name in referenced:
            continue
        if "/tests/" in str(f) or "/__tests__/" in str(f):
            continue
        orphan_components.append({"file": str(f), "name": name, "risk": "safe"})

    return {
        "endpoints": classified,
        "orphan_components": orphan_components,
        "totals": {
            "py_files": len(py_files),
            "js_files": len(js_files),
            "endpoints_total": len(endpoints),
        },
    }


# ── External tools ──────────────────────────────────────────────────────────

def run_external_tools() -> dict:
    """vulture (Python) + knip (JS) — best-effort, не блокирует основной flow."""
    raw_dir = AUDIT_DIR / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    results: dict[str, str] = {}

    try:
        r = subprocess.run(
            ["vulture", str(BACKEND_DIR), "--min-confidence", "70"],
            capture_output=True, text=True, timeout=120,
        )
        (raw_dir / "vulture.txt").write_text(r.stdout, encoding="utf-8")
        results["vulture"] = r.stdout
        print(f"[audit] vulture: {len(r.stdout.splitlines())} строк")
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        results["vulture"] = ""
        print(f"[audit] vulture: пропущен ({type(e).__name__})")

    try:
        r = subprocess.run(
            ["knip", "--reporter", "json"],
            cwd=str(REPO_ROOT / "frontend"),
            capture_output=True, text=True, timeout=180,
        )
        (raw_dir / "knip.json").write_text(r.stdout or "", encoding="utf-8")
        results["knip"] = r.stdout
        print(f"[audit] knip: {len(r.stdout)} bytes")
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        results["knip"] = ""
        print(f"[audit] knip: пропущен ({type(e).__name__})")

    return results


# ── Reporter ────────────────────────────────────────────────────────────────

def render_report(data: dict, raw: dict) -> str:
    eps = data["endpoints"]
    safe   = [e for e in eps if e["risk"] == "safe"]
    review = [e for e in eps if e["risk"] == "review"]
    alive  = [e for e in eps if e["risk"] == "alive"]
    orphans = data["orphan_components"]
    totals = data["totals"]

    def _rel(p: str) -> str:
        return p.replace(str(REPO_ROOT) + "/", "")

    def _ep_line(e: dict) -> str:
        return f"- `{e['method']} {e['path']}` — {_rel(e['file'])}"

    def _orphan_line(o: dict) -> str:
        return f"- `{o['name']}` — {_rel(o['file'])}"

    parts: list[str] = []
    parts.append(f"# Dead-code audit — {TODAY}\n")
    parts.append("## Summary\n")
    parts.append("| Layer | 🟢 safe | 🟡 review | ✅ alive |")
    parts.append("|-------|---------|----------|---------|")
    parts.append(f"| Backend endpoints ({totals['endpoints_total']}) | {len(safe)} | {len(review)} | {len(alive)} |")
    parts.append(f"| Frontend orphan components | {len(orphans)} | — | — |\n")

    parts.append("## Backend endpoints без потребителя 🟢\n")
    if safe:
        parts.extend(_ep_line(e) for e in safe[:200])
    else:
        parts.append("_нет_")

    parts.append("\n## Backend endpoints — требуют решения 🟡\n")
    if review:
        parts.extend(_ep_line(e) for e in review[:200])
    else:
        parts.append("_нет_")

    parts.append("\n## Frontend orphan components 🟢\n")
    if orphans:
        parts.extend(_orphan_line(o) for o in orphans[:200])
    else:
        parts.append("_нет_")

    parts.append("\n## Raw tools\n")
    parts.append(f"- vulture: `tools/audit/raw/vulture.txt` ({len(raw.get('vulture', ''))} bytes)")
    parts.append(f"- knip: `tools/audit/raw/knip.json` ({len(raw.get('knip', ''))} bytes)")
    return "\n".join(parts)


# ── Telegram ────────────────────────────────────────────────────────────────

TG_LIMIT = 4000  # запас от лимита 4096


def _html_escape(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def build_tg_text(data: dict) -> list[str]:
    """Сборка короткой сводки в нескольких сообщениях (≤ TG_LIMIT)."""
    eps = data["endpoints"]
    safe   = [e for e in eps if e["risk"] == "safe"]
    review = [e for e in eps if e["risk"] == "review"]
    orphans = data["orphan_components"]
    totals = data["totals"]

    def _rel(p: str) -> str:
        return p.replace(str(REPO_ROOT) + "/", "")

    lines: list[str] = [
        "🔍 <b>Dead-code audit Клиники</b>",
        f"📅 {TODAY}",
        "",
        f"<b>Backend</b> ({totals['py_files']} файлов, {totals['endpoints_total']} endpoint'ов)",
        f" 🟢 {len(safe)} без потребителя",
        f" 🟡 {len(review)} нужно решение",
        "",
        f"<b>Frontend</b> ({totals['js_files']} файлов)",
        f" 🟢 {len(orphans)} orphan компонентов",
        "",
        "<b>Топ-10 безопасных backend:</b>",
    ]
    for e in safe[:10]:
        lines.append(
            f"• <code>{_html_escape(e['method'])} {_html_escape(e['path'])}</code>"
        )
        lines.append(f"   {_html_escape(_rel(e['file']))}")
    lines.append("")
    lines.append("<b>Топ-10 orphan компонентов:</b>")
    for o in orphans[:10]:
        lines.append(
            f"• <code>{_html_escape(o['name'])}</code> — {_html_escape(_rel(o['file']))}"
        )
    lines.append("")
    lines.append(
        f"Полный отчёт: <code>tools/audit/report-{TODAY}.md</code>"
    )

    # Нарезаем по TG_LIMIT с учётом строк
    chunks: list[str] = []
    buf: list[str] = []
    size = 0
    for line in lines:
        ln = len(line) + 1
        if size + ln > TG_LIMIT and buf:
            chunks.append("\n".join(buf))
            buf, size = [], 0
        buf.append(line)
        size += ln
    if buf:
        chunks.append("\n".join(buf))
    return chunks


def _install_proxy_if_configured() -> None:
    """Подхватывает HTTPS_PROXY/HTTP_PROXY из env (urllib не делает это сам)."""
    proxy_url = (
        os.environ.get("HTTPS_PROXY")
        or os.environ.get("https_proxy")
        or os.environ.get("HTTP_PROXY")
        or os.environ.get("http_proxy")
    )
    if not proxy_url:
        return
    handler = urllib.request.ProxyHandler({"https": proxy_url, "http": proxy_url})
    opener = urllib.request.build_opener(handler)
    urllib.request.install_opener(opener)


def send_telegram(token: str, chat_id: str, messages: list[str]) -> None:
    _install_proxy_if_configured()
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    for msg in messages:
        data = urllib.parse.urlencode({
            "chat_id": chat_id,
            "text": msg,
            "parse_mode": "HTML",
            "disable_web_page_preview": "true",
        }).encode("utf-8")
        req = urllib.request.Request(url, data=data, method="POST")
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = resp.read().decode("utf-8")
        r = json.loads(body)
        if not r.get("ok"):
            raise RuntimeError(f"TG sendMessage failed: {body}")


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
    data = scan_all()
    raw = run_external_tools()
    report = render_report(data, raw)
    report_path = AUDIT_DIR / f"report-{TODAY}.md"
    report_path.write_text(report, encoding="utf-8")
    print(f"[audit] report: {report_path}")
    if args.no_telegram:
        print("[audit] --no-telegram — пропускаю отправку")
        return 0
    if not args.bot_token:
        print("[audit] нет --bot-token / TG_BOT_TOKEN — пропускаю отправку",
              file=sys.stderr)
        return 0
    msgs = build_tg_text(data)
    print(f"[audit] TG: {len(msgs)} сообщений → chat {args.chat_id}")
    send_telegram(args.bot_token, args.chat_id, msgs)
    print("[audit] TG: доставлено")
    return 0


if __name__ == "__main__":
    sys.exit(main())
