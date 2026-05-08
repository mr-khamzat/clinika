"""
Единая нормализация телефонных номеров.
Используется во всех сервисах вместо дублированного кода.
"""


def normalize_phone(phone: str) -> str:
    """Нормализует номер к формату 7XXXXXXXXXX (11 цифр без плюса)."""
    digits = "".join(c for c in phone if c.isdigit())
    if len(digits) == 10:
        digits = "7" + digits
    elif len(digits) == 11 and digits.startswith("8"):
        digits = "7" + digits[1:]
    return digits


def phone_variants(phone: str) -> list[str]:
    """Возвращает все форматы номера для поиска в БД (7..., +7..., 8...)."""
    norm = normalize_phone(phone)
    variants = [norm]
    if len(norm) == 11 and norm.startswith("7"):
        variants.append("+" + norm)
        variants.append("8" + norm[1:])
    return list(dict.fromkeys(variants))  # убираем дубли, сохраняя порядок


def mask_phone(phone) -> str:
    """Маскирует номер для логов: +79991234567 → +7999***4567.
    Соответствие 152-ФЗ: храним хвост (распознаваемость для саппорта),
    скрываем середину чтобы по логам нельзя было восстановить полный номер.
    None/пустую строку возвращаем как '∅'.
    """
    if not phone:
        return "∅"
    s = str(phone)
    if len(s) <= 7:
        return s[:2] + "***"
    return s[:4] + "***" + s[-4:]


def mask_name(name) -> str:
    """Маскирует ФИО для логов: 'Иван Петров Сергеевич' → 'Иван П.'.
    Полное имя — PII, но для дебага полезно знать кого именно.
    None/пустую строку → '∅'.
    """
    if not name:
        return "∅"
    parts = str(name).strip().split()
    if not parts:
        return "∅"
    if len(parts) == 1:
        return parts[0]
    return f"{parts[0]} {parts[1][0]}."
