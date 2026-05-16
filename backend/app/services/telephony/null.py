"""NullProvider — заглушка когда провайдер не настроен."""
from .base import TelephonyProvider, CallInitiateResult, CallStatusResult


class NullProvider(TelephonyProvider):
    async def initiate_call(self, *, from_user_phone: str, to_number: str) -> CallInitiateResult:
        return CallInitiateResult(success=False, error="Провайдер телефонии не настроен")

    async def get_call_status(self, provider_call_id: str) -> CallStatusResult:
        return CallStatusResult(status="unknown")

    async def fetch_recording(self, provider_call_id: str) -> bytes | None:
        return None

    async def handle_incoming_webhook(self, payload: dict) -> dict:
        return {"ok": False, "reason": "no_provider"}
