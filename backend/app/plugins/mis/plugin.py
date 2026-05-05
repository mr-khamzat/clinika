"""
MIS-плагин: обёртка над mis_client.py для МИС Renovatio.
Даёт доступ к МИС через plugin_registry.get("mis").
Существующий код (routers) продолжает импортировать mis_client напрямую — без изменений.
"""
from app.plugins.base import BasePlugin
from app.config import settings


class MISPlugin(BasePlugin):
    name = "mis"
    display_name = "МИС Renovatio"
    description = "Интеграция с медицинской информационной системой Renovatio"

    async def is_enabled(self) -> bool:
        return bool(settings.mis_api_key)

    async def health_check(self) -> dict:
        if not await self.is_enabled():
            return {"ok": False, "detail": "MIS_API_KEY не настроен"}
        try:
            from app.services.mis_client import get_clinics
            clinics = await get_clinics()
            return {
                "ok": True,
                "detail": f"Доступно {len(clinics)} клиник",
                "clinics_count": len(clinics),
            }
        except Exception as e:
            return {"ok": False, "detail": str(e)}

    # ── Прокси-методы mis_client ────────────────────────────────────────────

    async def get_services(self, clinic_id: int) -> list[dict]:
        from app.services.mis_client import get_services
        return await get_services(clinic_id)

    async def find_patient(self, phone: str) -> dict | None:
        from app.services.mis_client import find_patient_by_phone
        return await find_patient_by_phone(phone)

    async def get_appointments(self, clinic_id: int, date_from: str, date_to: str) -> list[dict]:
        from app.services.mis_client import get_appointments
        return await get_appointments(clinic_id, date_from, date_to)

    async def get_clinics(self) -> list[dict]:
        from app.services.mis_client import get_clinics
        return await get_clinics()

    async def get_patient_prescriptions(self, phone: str) -> list[dict]:
        """
        Назначения пациента (лекарства).
        МИС Renovatio публичного метода getPatientPrescriptions сейчас не предоставляет —
        это мягкая заглушка: пытаемся дёрнуть метод, при отсутствии возвращаем [].
        Когда метод появится — здесь будет реальный вызов через mis_client._post.
        """
        if not await self.is_enabled():
            return []
        try:
            from app.services.mis_client import _post, find_patient_by_phone
            patient = await find_patient_by_phone(phone)
            if not patient:
                return []
            patient_id = patient.get("patient_id") or patient.get("id")
            if not patient_id:
                return []
            # Пробуем гипотетический эндпоинт; если 404 — вернётся пустой список
            try:
                result = await _post("getPatientPrescriptions", patient_id=patient_id)
                if isinstance(result, dict) and result.get("error") == 0:
                    data = result.get("data") or []
                    return data if isinstance(data, list) else []
            except Exception:
                return []
            return []
        except Exception:
            return []
