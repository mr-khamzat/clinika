"""
MIS Renovatio client (mis.stoclinic.ru:3010)
POST /api/public/METHOD + api_key in form body.

Поддерживает как глобальный конфиг (из env settings), так и
per-tenant параметры (api_url, api_key из базы настроек).
"""
import httpx
from app.config import settings

# Дефолтные значения из конфига (для обратной совместимости)
DEFAULT_MIS_BASE = "https://mis.stoclinic.ru:3010/api/public"
MIS_CLINIC_IDS = {1, 4, 26}


def _get_base(api_url: str = "") -> str:
    """Получить base URL МИС: из параметра, конфига или дефолт."""
    if api_url and api_url.strip():
        url = api_url.strip().rstrip("/")
        # Если передан базовый URL без пути — добавляем стандартный путь
        if not url.endswith("/api/public"):
            url = url + "/api/public"
        return url
    return DEFAULT_MIS_BASE


async def _post(method: str, api_url: str = "", api_key: str = "", ssl_verify: bool = True, **params) -> dict:
    key = api_key.strip() if api_key else settings.mis_api_key
    base = _get_base(api_url)
    data = {"api_key": key, **{k: v for k, v in params.items() if v is not None}}
    async with httpx.AsyncClient(verify=ssl_verify, timeout=30) as client:
        resp = await client.post(f"{base}/{method}", data=data)
        resp.raise_for_status()
        return resp.json()


async def test_connection(api_url: str = "", api_key: str = "") -> dict:
    """Проверить соединение с МИС. Возвращает {status, message, count}."""
    try:
        result = await _post("getClinics", api_url=api_url, api_key=api_key, show_all=1)
        if result.get("error") == 0:
            clinics = result.get("data") or []
            return {"status": "ok", "message": f"Подключено, клиник в МИС: {len(clinics)}", "count": len(clinics)}
        return {"status": "error", "message": f"МИС вернула ошибку: {result.get('error')}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


async def get_services(clinic_id: int, api_url: str = "", api_key: str = "") -> list[dict]:
    result = await _post("getServices", api_url=api_url, api_key=api_key, clinic_id=clinic_id)
    if result.get("error") == 0:
        return result["data"] or []
    return []


async def find_patient_by_phone(phone: str, api_url: str = "", api_key: str = "") -> dict | None:
    from app.utils.phone import normalize_phone
    digits = normalize_phone(phone)
    for fmt in [digits, "+" + digits]:
        try:
            result = await _post("getPatient", api_url=api_url, api_key=api_key, mobile=fmt)
            if result.get("error") == 0 and result.get("data"):
                data = result["data"]
                patients = data if isinstance(data, list) else [data]
                if patients:
                    return patients[0]
        except Exception:
            continue
    return None


async def get_appointments(clinic_id: int, date_from: str, date_to: str, api_url: str = "", api_key: str = "") -> list[dict]:
    result = await _post(
        "getAppointments", api_url=api_url, api_key=api_key,
        clinic_id=clinic_id,
        date_updated_from=date_from,
        date_updated_to=date_to,
    )
    if result.get("error") == 0:
        return result.get("data") or []
    return []


async def get_clinics(api_url: str = "", api_key: str = "") -> list[dict]:
    result = await _post("getClinics", api_url=api_url, api_key=api_key, show_all=1)
    if result.get("error") == 0:
        return result["data"] or []
    return []


async def get_patient_visits(patient_id: int, api_url: str = "", api_key: str = "") -> list[dict]:
    """Get patient visit history from MIS by patient_id."""
    try:
        result = await _post("getPatientAppointments", api_url=api_url, api_key=api_key, patient_id=patient_id, limit=50)
        if result.get("error") == 0:
            return result.get("data") or []
    except Exception:
        pass
    # Fallback: search all clinics for this patient
    try:
        from datetime import datetime, timedelta
        date_to = datetime.now().strftime("%d.%m.%Y")
        date_from = (datetime.now() - timedelta(days=730)).strftime("%d.%m.%Y")
        all_appts = []
        for clinic_id in MIS_CLINIC_IDS:
            try:
                appts = await get_appointments(clinic_id, date_from, date_to, api_url=api_url, api_key=api_key)
                for a in appts:
                    if str(a.get("patient_id")) == str(patient_id):
                        all_appts.append({**a, "clinic_id": clinic_id})
            except Exception:
                continue
        return sorted(all_appts, key=lambda x: x.get("date", ""), reverse=True)[:30]
    except Exception:
        return []


async def get_patient_analyses(patient_id: int, api_url: str = "", api_key: str = "") -> list[dict]:
    """Get patient lab results from MIS by patient_id."""
    try:
        result = await _post("getPatientAnalyses", api_url=api_url, api_key=api_key, patient_id=patient_id, limit=50)
        if result.get("error") == 0:
            return result.get("data") or []
    except Exception:
        return []
    return []
