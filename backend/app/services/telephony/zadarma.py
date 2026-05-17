"""Zadarma telephony provider — callback API (request/callback)."""
import base64
import hashlib
import hmac
import logging
import urllib.parse

import httpx

from .base import TelephonyProvider, CallInitiateResult, CallStatusResult

log = logging.getLogger(__name__)

API_BASE = "https://api.zadarma.com"
CALLBACK_PATH = "/v1/request/callback/"
RECORDING_PATH = "/v1/pbx/record/request/"


class ZadarmaProvider(TelephonyProvider):
    """Zadarma callback API: GET /v1/request/callback/?from=<ext>&to=<num>.

    Аутентификация: header Authorization: <user_key>:<signature>,
    где signature = base64(hmac_sha1(method_path + sorted_params + md5(body), secret)).
    Для GET body пустой → md5("") = d41d8cd98f00b204e9800998ecf8427e.
    """

    def __init__(self, user_key: str, secret: str):
        self.user_key = user_key
        self.secret = secret

    def _signature(self, method_path: str, params: dict, body: str = "") -> str:
        # Сортируем по ключам (alphabetical), urlencode значения
        sorted_q = urllib.parse.urlencode(sorted(params.items()))
        body_md5 = hashlib.md5(body.encode("utf-8")).hexdigest()
        raw = method_path + sorted_q + body_md5
        sig = hmac.new(self.secret.encode("utf-8"), raw.encode("utf-8"), hashlib.sha1).digest()
        return base64.b64encode(sig).decode("ascii")

    async def initiate_call(self, *, from_user_phone: str, to_number: str) -> CallInitiateResult:
        if not from_user_phone or not to_number:
            return CallInitiateResult(success=False, error="from/to обязательны")
        params = {"from": from_user_phone, "to": to_number}
        sig = self._signature(CALLBACK_PATH, params)
        headers = {"Authorization": f"{self.user_key}:{sig}"}
        url = f"{API_BASE}{CALLBACK_PATH}?" + urllib.parse.urlencode(sorted(params.items()))
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(url, headers=headers)
        except Exception as e:
            log.warning("Zadarma callback exception: %s", e)
            return CallInitiateResult(success=False, error=f"Zadarma недоступен: {e}")
        if r.status_code != 200:
            return CallInitiateResult(success=False, error=f"HTTP {r.status_code}: {(r.text or '')[:200]}")
        try:
            data = r.json()
        except Exception:
            return CallInitiateResult(success=False, error=f"Неверный JSON: {(r.text or '')[:200]}")
        if (data.get("status") or "").lower() != "success":
            msg = data.get("message") or data.get("error") or "unknown error"
            return CallInitiateResult(success=False, error=str(msg)[:200])
        req_id = data.get("request_id") or data.get("id") or ""
        return CallInitiateResult(success=True, provider_call_id=str(req_id))

    async def get_call_status(self, provider_call_id: str) -> CallStatusResult:
        # Статус приходит через webhook (NOTIFY_*) — не запрашиваем синхронно.
        return CallStatusResult(status="unknown")

    async def fetch_recording(self, provider_call_id: str) -> bytes | None:
        """Скачивает запись Zadarma в 2 шага.

        Шаг 1: GET /v1/pbx/record/request/?call_id=X — возвращает JSON
               {status: 'success', link: 'https://...'} с signed download URL.
        Шаг 2: GET link — отдаёт audio/mpeg (или audio/wav).

        На любой сбой/ошибочный статус возвращаем None и логируем.
        """
        if not provider_call_id:
            return None
        params = {"call_id": provider_call_id}
        sig = self._signature(RECORDING_PATH, params)
        headers = {"Authorization": f"{self.user_key}:{sig}"}
        url = f"{API_BASE}{RECORDING_PATH}?" + urllib.parse.urlencode(sorted(params.items()))
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await client.get(url, headers=headers)
                if r.status_code != 200:
                    log.warning("Zadarma record request HTTP %s: %s",
                                r.status_code, (r.text or "")[:200])
                    return None
                try:
                    data = r.json()
                except Exception:
                    log.warning("Zadarma record request invalid JSON: %s", (r.text or "")[:200])
                    return None
                if (data.get("status") or "").lower() != "success":
                    log.warning("Zadarma record request status != success: %s", data)
                    return None
                link = data.get("link") or data.get("links")
                if isinstance(link, list):
                    link = link[0] if link else None
                if not link:
                    log.warning("Zadarma record request: пустая ссылка: %s", data)
                    return None
                # Шаг 2 — скачиваем bytes по signed URL (без Authorization)
                r2 = await client.get(link)
        except Exception as e:
            log.warning("Zadarma fetch_recording exception: %s", e)
            return None
        if r2.status_code != 200:
            log.warning("Zadarma record download HTTP %s", r2.status_code)
            return None
        ctype = (r2.headers.get("content-type") or "").lower()
        if "audio" not in ctype and "octet-stream" not in ctype:
            log.warning("Zadarma record non-audio (%s)", ctype)
            return None
        return r2.content or None

    async def handle_incoming_webhook(self, payload: dict) -> dict:
        """Обработка Zadarma NOTIFY_* webhooks.

        События:
          - NOTIFY_START  — звонок начался
          - NOTIFY_ANSWER — ответ
          - NOTIFY_END    — завершение, поля: pbx_call_id, duration,
                            disposition: ANSWERED|NO ANSWER|BUSY|FAILED
          - NOTIFY_RECORD — запись (call_id, link)
        """
        event = (payload.get("event") or "").upper()
        call_id = (payload.get("pbx_call_id") or payload.get("call_id") or "").strip()
        disposition_raw = (payload.get("disposition") or "").upper().replace(" ", "_")
        status_map = {
            "ANSWERED": "answered",
            "NO_ANSWER": "missed",
            "BUSY": "rejected",
            "FAILED": "failed",
            "CANCEL": "failed",
        }
        status = status_map.get(disposition_raw)
        if status is None:
            # Для NOTIFY_START/ANSWER без disposition — отдаём промежуточный статус
            if event == "NOTIFY_START":
                status = "ringing"
            elif event == "NOTIFY_ANSWER":
                status = "answered"
            else:
                status = disposition_raw.lower() or "unknown"
        duration = payload.get("duration")
        try:
            duration_sec = int(duration) if duration not in (None, "") else None
        except (TypeError, ValueError):
            duration_sec = None
        recording_url = payload.get("link") or payload.get("recording_url") or None
        return {
            "ok": True,
            "provider_call_id": call_id,
            "event": event or None,
            "status": status,
            "duration_sec": duration_sec or None,
            "recording_url": recording_url,
        }
