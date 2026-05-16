# tools/audit — Dead-code audit

Однократный сканер мёртвого кода. См. spec:
`docs/superpowers/specs/2026-05-16-dead-code-audit-design.md`

## Запуск

```bash
cd /opt/clinika
TG_BOT_TOKEN=<token> python3 tools/audit/dead_code_audit.py
```

С `--no-telegram` — только пишет отчёт, не шлёт.

## Тесты

```bash
cd /opt/clinika && python3 -m pytest tools/audit/tests/ -v
```
