"""
MIS Renovatio client (mis.stoclinic.ru:3010)
POST /api/public/METHOD + api_key in form body.
"""
import httpx
from app.config import settings

MIS_BASE = "https://mis.stoclinic.ru:3010/api/public"

MIS_CLINIC_IDS = {1, 4, 26}


async def _post(method: str, **params) -> dict:
    data = {"api_key": settings.mis_api_key, **{k: v for k, v in params.items() if v is not None}}
    async with httpx.AsyncClient(verify=settings.mis_ssl_verify, timeout=30) as client:
        resp = await client.post(f"{MIS_BASE}/{method}", data=data)
        resp.raise_for_status()
        return resp.json()


async def get_services(clinic_id: int) -> list[dict]:
    result = await _post("getServices", clinic_id=clinic_id)
    if result.get("error") == 0:
        return result["data"] or []
    return []


async def find_patient_by_phone(phone: str) -> dict | None:
    from app.utils.phone import normalize_phone
    digits = normalize_phone(phone)
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
    result = await _post("getClinics", show_all=1)
    if result.get("error") == 0:
        return result["data"] or []
    return []


async def get_patient_visits(patient_id: int) -> list[dict]:
    """Get patient visit history from MIS by patient_id."""
    try:
        result = await _post("getPatientAppointments", patient_id=patient_id, limit=50)
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
                appts = await get_appointments(clinic_id, date_from, date_to)
                for a in appts:
                    if str(a.get("patient_id")) == str(patient_id):
                        all_appts.append({**a, "clinic_id": clinic_id})
            except Exception:
                continue
        return sorted(all_appts, key=lambda x: x.get("date", ""), reverse=True)[:30]
    except Exception:
        return []


async def get_patient_analyses(patient_id: int) -> list[dict]:
    """Get patient lab results from MIS by patient_id."""
    try:
        result = await _post("getPatientAnalyses", patient_id=patient_id, limit=50)
        if result.get("error") == 0:
            return result.get("data") or []
    except Exception:
        return []
    return []
