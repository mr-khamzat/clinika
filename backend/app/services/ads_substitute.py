"""Подстановка переменных вида {{key}} в title/body баннеров."""
import re
from typing import Optional

_VAR_RE = re.compile(r"\{\{\s*([a-z_]+)\s*\}\}")
ALLOWED_VARS = {
    "patient_name", "patient_first_name", "branch_phone", "branch_address",
    "doctor_name", "clinic_name", "service_name", "city",
}


def substitute(text: Optional[str], ctx: dict) -> Optional[str]:
    """Подставляет {{key}} в значение из ctx если ключ в ALLOWED_VARS.

    Неизвестные ключи или None-значения остаются как {{var}} (graceful fallback).
    """
    if not text:
        return text

    def repl(m):
        key = m.group(1)
        if key not in ALLOWED_VARS:
            return m.group(0)
        val = ctx.get(key)
        return str(val) if val is not None else m.group(0)

    return _VAR_RE.sub(repl, text)


def extract_vars(text: Optional[str]) -> list[str]:
    """Возвращает список переменных {{var}} в тексте (только из ALLOWED_VARS)."""
    if not text:
        return []
    return list({m.group(1) for m in _VAR_RE.finditer(text) if m.group(1) in ALLOWED_VARS})
