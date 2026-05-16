"""Sipuni telephony provider — callback API (Вариант C)."""
import hashlib
import time
import logging
import httpx

from .base import TelephonyProvider, CallInitiateResult, CallStatusResult

log = logging.getLogger(__name__)

API_BASE = "https://sipuni.com"
CALLBACK_URL = f"{API_BASE}/api/callback/call_number"


class SipuniProvider(TelephonyProvider):
    """Callback-based: Sipuni сам звонит на 2 номера и соединяет.

    В Calls приложении голос НЕ передаётся — это значит, что у оператора
    должен быть рабочий мобильный или IP-телефон, на который Sipuni звонит
    в первую очередь.
    """

    def __init__(self, sipuni_id: str, secret_key: str):
        self.sipuni_id = sipuni_id
        self.secret_key = secret_key

    def _signature(self, from_num: str, to_num: str, ts: int) -> str:
        """md5(from + user + time + to + secret) — порядок строго по доке Sipuni."""
        raw = f"{from_num}{self.sipuni_id}{ts}{to_num}{self.secret_key}"
        return hashlib.md5(raw.encode("utf-8")).hexdigest()

    async def initiate_call(self, *, from_user_phone: str, to_number: str) -> CallInitiateResult:
        if not from_user_phone or not to_number:
            return CallInitiateResult(success=False, error="from/to обязательны")
        ts = int(time.time())
        sig = self._signature(from_user_phone, to_number, ts)
        payload = {
            "user": self.sipuni_id,
            "from": from_user_phone,
            "to": to_number,
            "time": str(ts),
            "signature": sig,
        }
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.post(CALLBACK_URL, data=payload)
        except Exception as e:
            log.warning("Sipuni callback exception: %s", e)
            return CallInitiateResult(success=False, error=f"Sipuni недоступен: {e}")
        text = (r.text or "").strip()
        if r.status_code != 200:
            return CallInitiateResult(success=False, error=f"HTTP {r.status_code}: {text[:200]}")
        if text.lower().startswith("error") or text.lower().startswith("incorrect"):
            return CallInitiateResult(success=False, error=text[:200])
        # Sipuni возвращает ID звонка как plain text — используем как provider_call_id
        return CallInitiateResult(success=True, provider_call_id=text[:100])

    async def get_call_status(self, provider_call_id: str) -> CallStatusResult:
        # У Sipuni callback API нет «get status by id» — статус приходит через webhook.
        # Возвращаем unknown — реальный статус обновится из webhook handler'а.
        return CallStatusResult(status="unknown")

    async def fetch_recording(self, provider_call_id: str) -> bytes | None:
        # Запись доступна через отдельный endpoint Sipuni — отложим для отдельной задачи.
        return None

    async def handle_incoming_webhook(self, payload: dict) -> dict:
        """Обработка статус-уведомлений Sipuni.

        Sipuni шлёт:
          - call_id, status (CONNECTED|NOANSWER|BUSY|FAILED|COMPLETED|...)
          - duration, started, answered, ended (timestamps)
          - record_url (если запись включена)
        """
        call_id = (payload.get("call_id") or "").strip()
        status_raw = (payload.get("status") or "").upper()
        status_map = {
            "CONNECTED": "answered",
            "NOANSWER": "missed",
            "BUSY": "rejected",
            "FAILED": "failed",
            "COMPLETED": "completed",
        }
        return {
            "ok": True,
            "provider_call_id": call_id,
            "status": status_map.get(status_raw, status_raw.lower() or "unknown"),
            "duration_sec": int(payload.get("duration") or 0) or None,
            "recording_url": payload.get("record_url") or None,
        }
