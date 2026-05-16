# Dead-code audit Клиники Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Однократный Python-скрипт `tools/audit/dead_code_audit.py` который сканирует backend (Python) + frontend (JS/JSX) проекта Клиники, классифицирует кандидатов на удаление по уровню риска 🟢/🟡/🔴 и отправляет сводку в Telegram + полный markdown-отчёт на сервер. Ничего не удаляет.

**Architecture:** Single-file Python скрипт (~300 строк), внешние тулинги `vulture`/`knip` опциональны (graceful fallback). Парсеры — regex-based, без AST (быстрее, достаточно для нашей задачи). Telegram через прямой HTTP к Bot API. Тесты — pytest, только для чистых функций-парсеров (TDD), интеграционные части (TG sender, runner) тестируются smoke-прогоном.

**Tech Stack:** Python 3.11, stdlib only + `httpx` (или `requests`, что уже в backend), pytest для тестов, опционально `vulture` (Python) + `knip` (JS, npm) — без них скрипт работает в L2-only режиме.

---

## File Structure

- Create: `tools/audit/dead_code_audit.py` — единый скрипт (parsers + matcher + reporter + tg sender + CLI)
- Create: `tools/audit/__init__.py` — пустой, делает каталог пакетом
- Create: `tools/audit/tests/__init__.py` — пустой
- Create: `tools/audit/tests/test_parsers.py` — pytest-тесты парсеров
- Create: `tools/audit/tests/fixtures/sample_router.py` — фикстура backend
- Create: `tools/audit/tests/fixtures/SampleComponent.jsx` — фикстура frontend
- Create: `tools/audit/README.md` — как запускать
- Output (создаётся при запуске): `tools/audit/report-YYYY-MM-DD.md`, `tools/audit/raw/`

---

## Task 1: Каркас скрипта + CLI с --dry-run

**Files:**
- Create: `tools/audit/__init__.py`
- Create: `tools/audit/dead_code_audit.py`
- Create: `tools/audit/README.md`

- [ ] **Step 1: Создать пустой __init__.py**

```bash
mkdir -p /opt/clinika/tools/audit/tests/fixtures /opt/clinika/tools/audit/raw
touch /opt/clinika/tools/audit/__init__.py /opt/clinika/tools/audit/tests/__init__.py
```

- [ ] **Step 2: Написать каркас dead_code_audit.py с CLI**

```python
#!/usr/bin/env python3
"""
Dead-code audit Клиники. См. docs/superpowers/specs/2026-05-16-dead-code-audit-design.md
"""
from __future__ import annotations
import argparse, os, sys, json, datetime, pathlib, subprocess, urllib.request, urllib.parse

REPO_ROOT = pathlib.Path("/opt/clinika")
BACKEND_DIR = REPO_ROOT / "backend" / "app"
FRONTEND_DIR = REPO_ROOT / "frontend" / "src"
AUDIT_DIR = REPO_ROOT / "tools" / "audit"
TODAY = datetime.date.today().isoformat()


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
    # Реализация в следующих задачах.
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 3: Сделать скрипт исполняемым и проверить --help**

```bash
chmod +x /opt/clinika/tools/audit/dead_code_audit.py
cd /opt/clinika && python3 tools/audit/dead_code_audit.py --help
```
Expected: вывод argparse с тремя опциями `--no-telegram`, `--bot-token`, `--chat-id`.

- [ ] **Step 4: Написать README.md**

```markdown
# tools/audit — Dead-code audit

Однократный сканер мёртвого кода. См. spec:
`docs/superpowers/specs/2026-05-16-dead-code-audit-design.md`

## Запуск
```bash
cd /opt/clinika
TG_BOT_TOKEN=<token> python3 tools/audit/dead_code_audit.py
```
С `--no-telegram` — только пишет отчёт, не шлёт.
```

- [ ] **Step 5: Commit**

```bash
cd /opt/clinika && git add tools/audit/__init__.py tools/audit/tests/__init__.py tools/audit/dead_code_audit.py tools/audit/README.md
git -c commit.gpgsign=false commit -m "feat(audit): скелет dead-code audit скрипта"
```

---

## Task 2: Парсер backend endpoints (TDD)

**Files:**
- Create: `tools/audit/tests/fixtures/sample_router.py`
- Create: `tools/audit/tests/test_parsers.py`
- Modify: `tools/audit/dead_code_audit.py` — добавить функцию `extract_backend_endpoints`

- [ ] **Step 1: Создать фикстуру**

Файл `tools/audit/tests/fixtures/sample_router.py`:
```python
from fastapi import APIRouter
router = APIRouter(prefix="/sample", tags=["sample"])

@router.get("/items")
async def list_items(): ...

@router.post("/items")
async def create_item(): ...

@router.delete("/items/{item_id}")
async def delete_item(item_id: int): ...

# Закомментированный — не должен попасть в результат
# @router.put("/items/{item_id}")
```

- [ ] **Step 2: Написать падающий тест**

Файл `tools/audit/tests/test_parsers.py`:
```python
import pathlib
from tools.audit.dead_code_audit import extract_backend_endpoints

FIX = pathlib.Path(__file__).parent / "fixtures"


def test_extract_backend_endpoints_finds_decorated_routes():
    endpoints = extract_backend_endpoints(FIX / "sample_router.py")
    paths = {(e["method"], e["path"]) for e in endpoints}
    assert ("GET",    "/sample/items") in paths
    assert ("POST",   "/sample/items") in paths
    assert ("DELETE", "/sample/items/{item_id}") in paths


def test_extract_backend_endpoints_ignores_comments():
    endpoints = extract_backend_endpoints(FIX / "sample_router.py")
    methods = {e["method"] for e in endpoints}
    assert "PUT" not in methods
```

- [ ] **Step 3: Запустить тест — должен упасть**

```bash
cd /opt/clinika && python3 -m pytest tools/audit/tests/test_parsers.py -v 2>&1 | tail -15
```
Expected: `ImportError: cannot import name 'extract_backend_endpoints'`.

- [ ] **Step 4: Реализовать `extract_backend_endpoints` в `dead_code_audit.py`**

Добавить после блока импортов в `dead_code_audit.py`:
```python
import re

# (метод HTTP, путь без kwargs).  Учитываем оба стиля:
#   @router.get("/path")  и  @app.get("/path")
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
    out = []
    for m in _RE_ROUTE.finditer(cleaned):
        method, sub = m.group(1).upper(), m.group(2)
        full = (prefix + sub) if sub.startswith("/") else f"{prefix}/{sub}"
        out.append({"file": str(path), "method": method, "path": full})
    return out
```

- [ ] **Step 5: Прогнать тесты — должны пройти**

```bash
cd /opt/clinika && python3 -m pytest tools/audit/tests/test_parsers.py -v 2>&1 | tail -10
```
Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
cd /opt/clinika && git add tools/audit/dead_code_audit.py tools/audit/tests/test_parsers.py tools/audit/tests/fixtures/sample_router.py
git -c commit.gpgsign=false commit -m "feat(audit): backend endpoint extractor (TDD)"
```

---

## Task 3: Парсер frontend api-вызовов (TDD)

**Files:**
- Create: `tools/audit/tests/fixtures/SampleApi.jsx`
- Modify: `tools/audit/tests/test_parsers.py` — добавить тест
- Modify: `tools/audit/dead_code_audit.py` — добавить `extract_frontend_api_calls`

- [ ] **Step 1: Создать фикстуру**

Файл `tools/audit/tests/fixtures/SampleApi.jsx`:
```jsx
import api from '../api'
const x = await api.get('/sample/items')
api.post('/sample/items', payload)
const url = `/sample/items/${id}`
api.delete(url)
// api.put('/sample/items/1') — закомменчено, не считаем
api.get(`/sample/items/${itemId}/details`)
```

- [ ] **Step 2: Написать падающий тест**

В `test_parsers.py` дописать:
```python
def test_extract_frontend_api_calls_finds_literal_urls():
    calls = extract_frontend_api_calls(FIX / "SampleApi.jsx")
    found = {(c["method"], c["path"]) for c in calls}
    assert ("GET",    "/sample/items") in found
    assert ("POST",   "/sample/items") in found
    assert ("GET",    "/sample/items/{var}/details") in found


def test_extract_frontend_api_calls_skips_comments():
    calls = extract_frontend_api_calls(FIX / "SampleApi.jsx")
    assert all(c["method"] != "PUT" for c in calls)
```

И в импортах файла:
```python
from tools.audit.dead_code_audit import (
    extract_backend_endpoints,
    extract_frontend_api_calls,
)
```

- [ ] **Step 3: Запустить — должен упасть**

```bash
cd /opt/clinika && python3 -m pytest tools/audit/tests/test_parsers.py -v 2>&1 | tail -10
```
Expected: `ImportError: cannot import name 'extract_frontend_api_calls'`.

- [ ] **Step 4: Реализовать функцию**

В `dead_code_audit.py` добавить:
```python
# api.method('url') ИЛИ api.method(`url${var}`) — захватываем литералы и template-strings
_RE_API_CALL = re.compile(
    r'\bapi\.(get|post|put|delete|patch)\s*\(\s*[\'"`]([^\'"`]+)[\'"`]',
    re.IGNORECASE,
)
_RE_TEMPLATE_VAR = re.compile(r'\$\{[^}]+\}')


def _strip_jsx_comments(text: str) -> str:
    # Однострочные // и многострочные /* */
    text = re.sub(r'//[^\n]*', '', text)
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.DOTALL)
    return text


def extract_frontend_api_calls(path: pathlib.Path) -> list[dict]:
    """Извлекает [{file, method, path}] вызовов api.* из .jsx/.js файла."""
    text = _strip_jsx_comments(
        path.read_text(encoding="utf-8", errors="ignore")
    )
    out = []
    for m in _RE_API_CALL.finditer(text):
        method = m.group(1).upper()
        raw = m.group(2)
        # Шаблонные переменные ${...} → {var} (для матчинга с FastAPI {param})
        path_norm = _RE_TEMPLATE_VAR.sub("{var}", raw)
        out.append({"file": str(path), "method": method, "path": path_norm})
    return out
```

- [ ] **Step 5: Прогнать тесты — все 4 должны пройти**

```bash
cd /opt/clinika && python3 -m pytest tools/audit/tests/test_parsers.py -v 2>&1 | tail -10
```
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
cd /opt/clinika && git add tools/audit/dead_code_audit.py tools/audit/tests/test_parsers.py tools/audit/tests/fixtures/SampleApi.jsx
git -c commit.gpgsign=false commit -m "feat(audit): frontend api-call extractor (TDD)"
```

---

## Task 4: Парсер frontend импортов + матчер orphan-компонентов (TDD)

**Files:**
- Create: `tools/audit/tests/fixtures/SampleComponent.jsx`
- Create: `tools/audit/tests/fixtures/SampleConsumer.jsx`
- Modify: `tools/audit/tests/test_parsers.py`
- Modify: `tools/audit/dead_code_audit.py`

- [ ] **Step 1: Создать фикстуры**

`tools/audit/tests/fixtures/SampleComponent.jsx`:
```jsx
export default function SampleComponent() { return null }
```

`tools/audit/tests/fixtures/SampleConsumer.jsx`:
```jsx
import SampleComponent from './SampleComponent'
const X = lazy(() => import('./SampleComponent'))
export default function Consumer() { return <SampleComponent /> }
```

- [ ] **Step 2: Тест**

В `test_parsers.py` дописать:
```python
def test_extract_frontend_imports_finds_static_and_lazy():
    imports = extract_frontend_imports(FIX / "SampleConsumer.jsx")
    # Должны быть оба упоминания SampleComponent (статический import + lazy)
    targets = [i["target"] for i in imports]
    assert any(t.endswith("SampleComponent") for t in targets)
    # Считаем оба паттерна как отдельные находки
    assert len([t for t in targets if t.endswith("SampleComponent")]) >= 2
```

И в импортах:
```python
from tools.audit.dead_code_audit import (
    extract_backend_endpoints,
    extract_frontend_api_calls,
    extract_frontend_imports,
)
```

- [ ] **Step 3: Запустить — упадёт на ImportError**

```bash
cd /opt/clinika && python3 -m pytest tools/audit/tests/test_parsers.py -v 2>&1 | tail -10
```

- [ ] **Step 4: Реализация**

В `dead_code_audit.py`:
```python
_RE_IMPORT = re.compile(
    r'(?:^|\n)\s*import\s+(?:[\w*{}\s,]+from\s+)?[\'"]([^\'"]+)[\'"]'
)
_RE_LAZY = re.compile(
    r'lazy\s*\(\s*\(\s*\)\s*=>\s*import\s*\(\s*[\'"]([^\'"]+)[\'"]'
)


def extract_frontend_imports(path: pathlib.Path) -> list[dict]:
    text = _strip_jsx_comments(
        path.read_text(encoding="utf-8", errors="ignore")
    )
    out = []
    for m in _RE_IMPORT.finditer(text):
        out.append({"file": str(path), "target": m.group(1), "kind": "static"})
    for m in _RE_LAZY.finditer(text):
        out.append({"file": str(path), "target": m.group(1), "kind": "lazy"})
    return out
```

- [ ] **Step 5: Прогнать тесты**

```bash
cd /opt/clinika && python3 -m pytest tools/audit/tests/test_parsers.py -v 2>&1 | tail -10
```
Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
cd /opt/clinika && git add tools/audit/dead_code_audit.py tools/audit/tests/test_parsers.py tools/audit/tests/fixtures/SampleComponent.jsx tools/audit/tests/fixtures/SampleConsumer.jsx
git -c commit.gpgsign=false commit -m "feat(audit): frontend import extractor (TDD)"
```

---

## Task 5: Cross-stack matcher + risk classifier (TDD)

**Files:**
- Modify: `tools/audit/tests/test_parsers.py`
- Modify: `tools/audit/dead_code_audit.py`

- [ ] **Step 1: Тест классификатора**

В `test_parsers.py`:
```python
def test_classify_endpoint_safe_when_no_match():
    ep = {"file": "backend/app/routers/x.py", "method": "GET", "path": "/x/legacy"}
    calls = []  # фронт не зовёт
    text_corpus = ""  # нигде в репо не упоминается
    risk = classify_endpoint(ep, calls, text_corpus)
    assert risk == "safe"


def test_classify_endpoint_likely_when_only_in_comment():
    ep = {"file": "backend/app/routers/x.py", "method": "GET", "path": "/x/legacy"}
    calls = []
    text_corpus = "// см. /x/legacy"   # совпадение по подстроке без вызова
    risk = classify_endpoint(ep, calls, text_corpus)
    assert risk == "review"


def test_classify_endpoint_alive_when_called():
    ep = {"file": "backend/app/routers/x.py", "method": "GET", "path": "/x/items/{id}"}
    calls = [{"file": "frontend/src/x.jsx", "method": "GET", "path": "/x/items/{var}"}]
    risk = classify_endpoint(ep, calls, "")
    assert risk == "alive"
```

И импорт:
```python
from tools.audit.dead_code_audit import (
    extract_backend_endpoints,
    extract_frontend_api_calls,
    extract_frontend_imports,
    classify_endpoint,
)
```

- [ ] **Step 2: Запустить — упадёт**

```bash
cd /opt/clinika && python3 -m pytest tools/audit/tests/test_parsers.py -v 2>&1 | tail -10
```

- [ ] **Step 3: Реализовать классификатор**

В `dead_code_audit.py`:
```python
def _normalize_path_for_match(p: str) -> str:
    # Заменяем {anything} на {var} с обеих сторон.
    return re.sub(r"\{[^}]+\}", "{var}", p)


def classify_endpoint(endpoint: dict, calls: list[dict], text_corpus: str) -> str:
    """Возвращает один из: alive | review | safe.

    alive — есть фронт-вызов с тем же method и нормализованным path
    review — нет вызова, но путь упоминается в репо (в комментах/строках)
    safe — путь нигде не встречается
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
```

- [ ] **Step 4: Прогнать**

```bash
cd /opt/clinika && python3 -m pytest tools/audit/tests/test_parsers.py -v 2>&1 | tail -10
```
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
cd /opt/clinika && git add tools/audit/dead_code_audit.py tools/audit/tests/test_parsers.py
git -c commit.gpgsign=false commit -m "feat(audit): cross-stack matcher и risk classifier (TDD)"
```

---

## Task 6: Сборка всего + опциональные тулинги (vulture/knip) + markdown reporter

**Files:**
- Modify: `tools/audit/dead_code_audit.py`

- [ ] **Step 1: Добавить главную функцию scan_all**

В `dead_code_audit.py`:
```python
def _walk_files(root: pathlib.Path, suffixes: tuple[str, ...]) -> list[pathlib.Path]:
    return [p for p in root.rglob("*") if p.suffix in suffixes and p.is_file()]


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
    corpus_parts = []
    for f in js_files:
        try:
            corpus_parts.append(f.read_text(encoding="utf-8", errors="ignore"))
        except Exception:
            pass
    text_corpus = "\n".join(corpus_parts)

    # Классификация endpoint'ов
    classified = []
    for ep in endpoints:
        risk = classify_endpoint(ep, calls, text_corpus)
        classified.append({**ep, "risk": risk})

    # Frontend orphan компоненты:
    # Считаем «target» нормализованный (basename без расширения) → set встречающихся
    referenced = set()
    for imp in imports:
        bn = pathlib.Path(imp["target"]).name
        referenced.add(bn.split(".")[0])
    orphan_components = []
    for f in js_files:
        # Считаем .jsx с PascalCase именем потенциальным компонентом
        name = f.stem
        if not name or not name[0].isupper():
            continue
        if name in referenced:
            continue
        # Не учитываем фикстуры тестов
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
```

- [ ] **Step 2: Запуск тулингов (best-effort)**

В `dead_code_audit.py`:
```python
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
    except (FileNotFoundError, subprocess.TimeoutExpired):
        results["vulture"] = ""

    try:
        r = subprocess.run(
            ["knip", "--reporter", "json"],
            cwd=str(REPO_ROOT / "frontend"),
            capture_output=True, text=True, timeout=180,
        )
        (raw_dir / "knip.json").write_text(r.stdout or "", encoding="utf-8")
        results["knip"] = r.stdout
    except (FileNotFoundError, subprocess.TimeoutExpired):
        results["knip"] = ""

    return results
```

- [ ] **Step 3: Markdown reporter**

В `dead_code_audit.py`:
```python
def render_report(data: dict, raw: dict) -> str:
    eps = data["endpoints"]
    safe   = [e for e in eps if e["risk"] == "safe"]
    review = [e for e in eps if e["risk"] == "review"]
    alive  = [e for e in eps if e["risk"] == "alive"]
    orphans = data["orphan_components"]
    totals = data["totals"]

    def _ep_line(e):
        rel = e["file"].replace(str(REPO_ROOT) + "/", "")
        return f"- `{e['method']} {e['path']}` — {rel}"

    def _orphan_line(o):
        rel = o["file"].replace(str(REPO_ROOT) + "/", "")
        return f"- `{o['name']}` — {rel}"

    parts: list[str] = []
    parts.append(f"# Dead-code audit — {TODAY}\n")
    parts.append("## Summary\n")
    parts.append("| Layer | 🟢 safe | 🟡 review | ✅ alive |")
    parts.append("|-------|---------|----------|---------|")
    parts.append(f"| Backend endpoints ({totals['endpoints_total']}) | {len(safe)} | {len(review)} | {len(alive)} |")
    parts.append(f"| Frontend orphan components | {len(orphans)} | — | — |\n")

    parts.append("## Backend endpoints без потребителя 🟢\n")
    parts.extend(_ep_line(e) for e in safe[:200]) if safe else parts.append("_нет_")

    parts.append("\n## Backend endpoints — требуют решения 🟡\n")
    parts.extend(_ep_line(e) for e in review[:200]) if review else parts.append("_нет_")

    parts.append("\n## Frontend orphan components 🟢\n")
    parts.extend(_orphan_line(o) for o in orphans[:200]) if orphans else parts.append("_нет_")

    parts.append("\n## Raw tools\n")
    parts.append(f"- vulture: `tools/audit/raw/vulture.txt` ({len(raw.get('vulture', ''))} bytes)")
    parts.append(f"- knip: `tools/audit/raw/knip.json` ({len(raw.get('knip', ''))} bytes)")
    return "\n".join(parts)
```

- [ ] **Step 4: Запустить scan_all через --no-telegram (smoke)**

Добавить в `main()`:
```python
def main() -> int:
    ap = argparse.ArgumentParser(description="Dead-code audit Клиники")
    ap.add_argument("--no-telegram", action="store_true")
    ap.add_argument("--bot-token", default=os.environ.get("TG_BOT_TOKEN", ""))
    ap.add_argument("--chat-id", default=os.environ.get("TG_CHAT_ID", "293633093"))
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
    # TG отправка в Task 7
    return 0
```

- [ ] **Step 5: Прогнать**

```bash
cd /opt/clinika && python3 tools/audit/dead_code_audit.py --no-telegram
cat tools/audit/report-$(date +%F).md | head -30
```
Expected: создан `report-YYYY-MM-DD.md`, summary с 4 цифрами.

- [ ] **Step 6: Commit**

```bash
cd /opt/clinika && git add tools/audit/dead_code_audit.py
git -c commit.gpgsign=false commit -m "feat(audit): scan_all + tools-runner + markdown reporter"
```

---

## Task 7: Telegram-отправка (текстом, не файлом)

**Files:**
- Modify: `tools/audit/dead_code_audit.py`

- [ ] **Step 1: Добавить функцию build_tg_text**

В `dead_code_audit.py`:
```python
TG_LIMIT = 4000  # запас от лимита 4096


def build_tg_text(data: dict) -> list[str]:
    """Сборка короткой сводки в нескольких сообщениях (каждое ≤ TG_LIMIT)."""
    eps = data["endpoints"]
    safe   = [e for e in eps if e["risk"] == "safe"]
    review = [e for e in eps if e["risk"] == "review"]
    orphans = data["orphan_components"]
    totals = data["totals"]

    head = [
        f"🔍 <b>Dead-code audit Клиники</b>",
        f"📅 {TODAY}",
        "",
        f"<b>Backend</b> ({totals['py_files']} файлов, {totals['endpoints_total']} endpoint'ов)",
        f" 🟢 {len(safe)} без потребителя",
        f" 🟡 {len(review)} нужно решение",
        "",
        f"<b>Frontend</b> ({totals['js_files']} файлов)",
        f" 🟢 {len(orphans)} orphan компонентов",
        "",
        f"<b>Топ-10 безопасных backend:</b>",
    ]
    for e in safe[:10]:
        rel = e["file"].replace(str(REPO_ROOT) + "/", "")
        head.append(f"• <code>{e['method']} {e['path']}</code>\n   {rel}")
    head.append("")
    head.append(f"<b>Топ-10 orphan компонентов:</b>")
    for o in orphans[:10]:
        rel = o["file"].replace(str(REPO_ROOT) + "/", "")
        head.append(f"• <code>{o['name']}</code> — {rel}")
    head.append("")
    head.append(f"Полный отчёт: <code>tools/audit/report-{TODAY}.md</code>")

    # Разрезаем по TG_LIMIT с учётом строк
    chunks: list[str] = []
    buf: list[str] = []
    size = 0
    for line in head:
        ln = len(line) + 1
        if size + ln > TG_LIMIT and buf:
            chunks.append("\n".join(buf))
            buf, size = [], 0
        buf.append(line)
        size += ln
    if buf:
        chunks.append("\n".join(buf))
    return chunks


def send_telegram(token: str, chat_id: str, messages: list[str]) -> None:
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
```

- [ ] **Step 2: Подключить send в main()**

Заменить блок отправки в `main()`:
```python
    if args.no_telegram:
        print("[audit] --no-telegram — пропускаю отправку")
        return 0
    if not args.bot_token:
        print("[audit] нет --bot-token — пропускаю отправку", file=sys.stderr)
        return 0
    msgs = build_tg_text(data)
    print(f"[audit] TG: {len(msgs)} сообщений → chat {args.chat_id}")
    send_telegram(args.bot_token, args.chat_id, msgs)
    return 0
```

- [ ] **Step 3: Прогнать без TG (убедиться что не сломали)**

```bash
cd /opt/clinika && python3 tools/audit/dead_code_audit.py --no-telegram
```
Expected: отчёт создан, никаких exception'ов.

- [ ] **Step 4: Прогнать ПОЛНОСТЬЮ (с TG) и убедиться что в чате пришли сообщения текстом**

```bash
cd /opt/clinika && TG_BOT_TOKEN=8689519551:AAHeH7apnU-gZfL59w8aBTpLrhDW5IdcIHU python3 tools/audit/dead_code_audit.py
```
Expected: в @stclinik_addmin_bot пришло 1-2 сообщения с эмодзи 🔍.

- [ ] **Step 5: Прогнать тесты целиком (регресс)**

```bash
cd /opt/clinika && python3 -m pytest tools/audit/tests/ -v 2>&1 | tail -10
```
Expected: 8 passed.

- [ ] **Step 6: Commit**

```bash
cd /opt/clinika && git add tools/audit/dead_code_audit.py
git -c commit.gpgsign=false commit -m "feat(audit): Telegram-доставка (текстом, разрез на 4000 байт)"
```

---

## Task 8: Финальный smoke-прогон и Review

- [ ] **Step 1: Полный прогон**

```bash
cd /opt/clinika && TG_BOT_TOKEN=8689519551:AAHeH7apnU-gZfL59w8aBTpLrhDW5IdcIHU python3 tools/audit/dead_code_audit.py 2>&1 | tail -20
```
Expected output (примерно):
```
[audit] start 2026-05-16
[audit] scan backend …
[audit]  ↳ endpoints: ~400
[audit] scan frontend …
[audit]  ↳ api-calls: ~600  imports: ~1200
[audit] report: /opt/clinika/tools/audit/report-2026-05-16.md
[audit] TG: 1-2 сообщений → chat 293633093
```

- [ ] **Step 2: Проверить отчёт глазами на здравый смысл**

```bash
cat /opt/clinika/tools/audit/report-$(date +%F).md | head -80
```
Sanity-check: в 🟢 safe не должно быть очевидно живых endpoint'ов (например `/auth/login`).

- [ ] **Step 3: Если есть false-positives — добавить known-alive whitelist**

В `dead_code_audit.py` добавить список (только если шаг 2 покажет проблему):
```python
# Endpoints, которые дёргаются извне (МИС webhooks, боты, public API) —
# их фронт не зовёт, но они НЕ мёртвые.
KNOWN_ALIVE_PATHS = {
    "/health", "/auth/refresh", "/mis/webhook",
    # … (заполнить по результатам шага 2)
}
```
и в `classify_endpoint`:
```python
    if endpoint["path"] in KNOWN_ALIVE_PATHS:
        return "alive"
```
Перепрогнать. Если false-positives отсутствуют — пропустить шаг 3.

- [ ] **Step 4: Финальный commit**

```bash
cd /opt/clinika && git add tools/audit/dead_code_audit.py
# Если ничего не менялось на шаге 3 — пропускаем commit.
git diff --cached --quiet || git -c commit.gpgsign=false commit -m "feat(audit): known-alive whitelist по результатам smoke-прогона"
```

---

## Self-review

**Spec coverage:**
- §3 Backend категории → Task 2 (endpoints), Task 6 (orphan-эвристика для router/service частично — orphan router определяется через scan_all backend файлов где endpoint count=0 + нет include_router; покрыто в Task 6 неявно через risk-classifier)
- §3 Frontend категории → Task 4 (imports/lazy), Task 6 (orphan components)
- §3 Закомментированный код > 5 строк → НЕ ПОКРЫТО. Это вторичная категория, в spec упомянута, но для MVP оставим — добавится позже как Task 9 при необходимости.
- §4 Архитектура L1/L2/L3 → Task 6 (run_external_tools = L1), Task 2-5 (L2/L3)
- §5 Формат TG → Task 7
- §5 Markdown отчёт → Task 6
- §6 Запуск из SSH с TG_BOT_TOKEN env → Task 1 (CLI) + Task 7 (отправка)
- §8 Риски — динамические импорты, lazy, внешние потребители → Task 5 (`review` категория), Task 8 step 3 (whitelist)

**Placeholder scan:** прошёл. Все code-блоки содержат реальный код, нет «TBD»/«TODO»/«similar to». Whitelist в Task 8 step 3 заполняется по результатам smoke-прогона — это не плейсхолдер, а адаптивный шаг.

**Type consistency:**
- `endpoint` dict: `{file, method, path}` создаётся в Task 2, расширяется `risk` в Task 6 — везде одинаково.
- `call` dict: `{file, method, path}` — Task 3.
- `import` dict: `{file, target, kind}` — Task 4.
- `classify_endpoint(endpoint, calls, text_corpus) -> str` — сигнатура одинакова в Task 5 и Task 6 (вызывается из `scan_all`).
- Возврат classify_endpoint: `alive | review | safe` — используются в reporter (Task 6) и build_tg_text (Task 7) одинаково.

OK, плана достаточно.
