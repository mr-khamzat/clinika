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
