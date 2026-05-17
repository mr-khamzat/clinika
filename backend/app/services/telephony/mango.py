"""Mango Office VPBX provider — callback API (call to 2 numbers, connect)."""
import hashlib
import json
import uuid
import logging
import httpx

from .base import TelephonyProvider, CallInitiateResult, CallStatusResult

log = logging.getLogger(__name__)

CALLBACK_URL = "https://app.mango-office.ru/vpbx/commands/callback"
RECORDING_URL = "https://app.mango-office.ru/vpbx/queries/recording/post"


class MangoProvider(TelephonyProvider):
    """Mango VPBX callback: API сам инициирует звонок на 2 номера.

    Аутентификация:
      - X-MPBX-API-Key:   <api_key>
      - X-MPBX-Signature: sha256(api_key + json_body + api_salt)
    """

    def __init__(self, api_key: str, api_salt: str):
        self.api_key = api_key
        self.api_salt = api_salt

    def _signature(self, json_body: str) -> str:
        """sha256(api_key + json_body + api_salt) — порядок строго по доке Mango."""
        raw = f"{self.api_key}{json_body}{self.api_salt}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    async def initiate_call(self, *, from_user_phone: str, to_number: str) -> CallInitiateResult:
        if not from_user_phone or not to_number:
            return CallInitiateResult(success=False, error="from/to обязательны")
        command_id = uuid.uuid4().hex
        body = {
            "command_id": command_id,
            "from": {"number": from_user_phone},
            "to_number": to_number,
            "line_number": None,
        }
        json_body = json.dumps(body, separators=(",", ":"), ensure_ascii=False)
        sig = self._signature(json_body)
        headers = {
            "X-MPBX-API-Key": self.api_key,
            "X-MPBX-Signature": sig,
            "Content-Type": "application/json",
        }
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.post(CALLBACK_URL, content=json_body, headers=headers)
        except Exception as e:
            log.warning("Mango callback exception: %s", e)
            return CallInitiateResult(
                success=False, provider_call_id=command_id,
                error=f"Mango недоступен: {e}",
            )
        if r.status_code != 200:
            text = (r.text or "").strip()
            return CallInitiateResult(
                success=False, provider_call_id=command_id,
                error=f"HTTP {r.status_code}: {text[:200]}",
            )
        # Mango на успех отдаёт 200 без тела (или с обычным OK)
        return CallInitiateResult(success=True, provider_call_id=command_id)

    async def get_call_status(self, provider_call_id: str) -> CallStatusResult:
        # Mango шлёт статусы через webhook (call_state_change) — снимок недоступен.
        return CallStatusResult(status="unknown")

    async def fetch_recording(self, provider_call_id: str) -> bytes | None:
        """Скачивает запись звонка через Mango VPBX API.

        POST /vpbx/queries/recording/post — JSON {action: 'play', recording_id, call_id}.
        Headers: X-MPBX-API-Key + X-MPBX-Signature (sha256(api_key + body + salt)).
        Возвращает audio/mpeg на успех.
        """
        if not provider_call_id:
            return None
        body = {
            "action": "play",
            "recording_id": provider_call_id,
            "call_id": provider_call_id,
        }
        json_body = json.dumps(body, separators=(",", ":"), ensure_ascii=False)
        sig = self._signature(json_body)
        headers = {
            "X-MPBX-API-Key": self.api_key,
            "X-MPBX-Signature": sig,
            "Content-Type": "application/json",
        }
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await client.post(RECORDING_URL, content=json_body, headers=headers)
        except Exception as e:
            log.warning("Mango fetch_recording exception: %s", e)
            return None
        if r.status_code != 200:
            log.warning("Mango fetch_recording HTTP %s: %s", r.status_code, (r.text or "")[:200])
            return None
        ctype = (r.headers.get("content-type") or "").lower()
        if "audio" not in ctype:
            log.warning("Mango fetch_recording non-audio (%s): %s", ctype, (r.text or "")[:200])
            return None
        return r.content or None

    async def handle_incoming_webhook(self, payload: dict) -> dict:
        """Обработка call_state_change от Mango.

        Поля Mango:
          - command_id / entry_id — идентификаторы звонка
          - state: Appeared | Connected | Disappeared | NoAnswer | Busy | Failed
          - duration (секунды, при завершении)
          - recording / record_url (если запись включена)
        """
        # provider_call_id: предпочитаем command_id (мы его генерим в initiate),
        # fallback на entry_id (Mango может прислать только его).
        call_id = (payload.get("command_id") or payload.get("entry_id") or "").strip()
        state_raw = (payload.get("state") or "").strip()
        # Маппинг состояний Mango → наш единый статус
        state_map = {
            "Appeared": "ringing",
            "Connected": "answered",
            "Disappeared": "completed",
            "NoAnswer": "missed",
            "Busy": "rejected",
            "Failed": "failed",
        }
        status = state_map.get(state_raw, state_raw.lower() or "unknown")
        duration = payload.get("duration")
        try:
            duration_sec = int(duration) if duration is not None else None
        except (TypeError, ValueError):
            duration_sec = None
        return {
            "ok": True,
            "provider_call_id": call_id,
            "status": status,
            "duration_sec": duration_sec or None,
            "recording_url": payload.get("recording") or payload.get("record_url") or None,
        }
