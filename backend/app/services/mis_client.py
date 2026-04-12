"""
Клиент МИС Renovatio (mis.stoclinic.ru:3010)
POST /api/public/METHOD  +  api_key в теле формы.

API ключ берётся из переменной окружения MIS_API_KEY (не из кода!).
SSL верификация управляется через MIS_SSL_VERIFY.
"""
import httpx
from app.config import settings

MIS_BASE = "https://mis.stoclinic.ru:3010/api/public"

# Клиники МИС которые нас интересуют
MIS_CLINIC_IDS = {1, 4, 26}


async def _post(method: str, **params) -> dict:
    data = {"api_key": settings.mis_api_key, **{k: v for k, v in params.items() if v is not None}}
    async with httpx.AsyncClient(verify=settings.mis_ssl_verify, timeout=30) as client:
        resp = await client.post(f"{MIS_BASE}/{method}", data=data)
        resp.raise_for_status()
        return resp.json()


async def get_services(clinic_id: int) -> list[dict]:
    """Список услуг клиники из МИС."""
    result = await _post("getServices", clinic_id=clinic_id)
    if result.get("error") == 0:
        return result["data"] or []
    return []


async def find_patient_by_phone(phone: str) -> dict | None:
    """
    Поиск пациента по телефону.
    Пробуем несколько форматов: 79001234567 и +79001234567.
    """
    from app.utils.phone import normalize_phone
    digits = normalize_phone(phone)

    # МИС использует параметр mobile (не phone) для поиска по номеру
    for fmt in [digits, "+" + digits]:
        try:
            result = await _post("getPatient", mobile=fmt)
            if result.get("error") == 0 and result.get("data"):
                data = result["data"]
                patients = data if isinstance(data, list) else [data]
                if patients:
                    return patients[0]
        except Exception:
            continue
    return None


async def get_appointments(clinic_id: int, date_from: str, date_to: str) -> list[dict]:
    """
    Визиты (приёмы) пациентов из МИС.
    date_from / date_to — формат DD.MM.YYYY.
    Возвращает записи со статусом 'Выполнено' (status_id=4 или status=Выполнено).
    """
    result = await _post(
        "getAppointments",
        clinic_id=clinic_id,
        date_updated_from=date_from,
        date_updated_to=date_to,
    )
    if result.get("error") == 0:
        return result.get("data") or []
    return []


async def get_clinics() -> list[dict]:
    """Список всех клиник МИС (включая скрытые)."""
    result = await _post("getClinics", show_all=1)
    if result.get("error") == 0:
        return result["data"] or []
    return []
