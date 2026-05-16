# Sipuni Provider — Spec + Plan

**Зависимости:** PSTN Infrastructure готова (commit 061f340). `TelephonyProvider` ABC + `NullProvider` + `get_provider` factory уже работают.

## Goal
Первая реальная реализация `TelephonyProvider` через Sipuni callback API. Звонок инициируется через REST, Sipuni физически соединяет 2 номера, голос идёт через мобильный оператора (Вариант C — без браузерной трубки).

## Sipuni callback API

**Endpoint:** `POST https://sipuni.com/api/callback/call_number` (form-urlencoded)

**Параметры:**
- `user` — sipuni_id (account ID, из настроек кабинета Sipuni)
- `from` — внутренний SIP-номер оператора или мобильный с префиксом
- `to` — номер клиента (`+7XXXXXXXXXX`)
- `time` — Unix timestamp
- `signature` — `md5(from + user + time + to + secret_key)`

Возвращает: текстовый ответ `"OK"` или `"Error: ..."`.

**Webhook (Sipuni → нас):** `POST /telephony/webhook/sipuni` со статусами:
- `CONNECTED` — звонок соединён
- `NOANSWER` — нет ответа
- `BUSY` / `FAILED` / `COMPLETED`

## File Structure

| Файл | Ответственность |
|------|----------------|
| `backend/app/services/telephony/sipuni.py` (новый) | SipuniProvider — все 4 метода ABC |
| `backend/app/services/telephony/factory.py` (modify) | +ветка `sipuni` → загрузка credentials, расшифровка, инстанс SipuniProvider |
| `backend/app/routers/tenant_telephony.py` (modify) | +endpoint `POST /telephony/webhook/sipuni` (без auth) |
| `backend/tests/test_sipuni.py` (новый) | 5 тестов (signature, OK, error, factory, webhook) |

## Tasks

### Task 1: SipuniProvider + тесты

**Файл `backend/app/services/telephony/sipuni.py`:**

```python
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
```

**Тесты в `backend/tests/test_sipuni.py`:**

```python
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.mark.asyncio
async def test_sipuni_signature_md5_correct_order():
    from app.services.telephony.sipuni import SipuniProvider
    p = SipuniProvider(sipuni_id="123", secret_key="SECRET")
    sig = p._signature(from_num="100", to_num="+79001234567", ts=1000)
    # Ожидаем md5("100" + "123" + "1000" + "+79001234567" + "SECRET")
    import hashlib
    expected = hashlib.md5(b"1001231000+79001234567SECRET").hexdigest()
    assert sig == expected


@pytest.mark.asyncio
async def test_sipuni_initiate_ok_returns_success():
    from app.services.telephony.sipuni import SipuniProvider
    p = SipuniProvider(sipuni_id="x", secret_key="y")
    fake_resp = MagicMock(status_code=200, text="callId-12345\n")
    with patch("httpx.AsyncClient") as Client:
        client_inst = AsyncMock()
        client_inst.post = AsyncMock(return_value=fake_resp)
        Client.return_value.__aenter__.return_value = client_inst
        r = await p.initiate_call(from_user_phone="100", to_number="+79001234567")
    assert r.success is True
    assert r.provider_call_id == "callId-12345"


@pytest.mark.asyncio
async def test_sipuni_initiate_error_response():
    from app.services.telephony.sipuni import SipuniProvider
    p = SipuniProvider(sipuni_id="x", secret_key="y")
    fake_resp = MagicMock(status_code=200, text="Error: incorrect signature")
    with patch("httpx.AsyncClient") as Client:
        client_inst = AsyncMock()
        client_inst.post = AsyncMock(return_value=fake_resp)
        Client.return_value.__aenter__.return_value = client_inst
        r = await p.initiate_call(from_user_phone="100", to_number="+79001234567")
    assert r.success is False
    assert "Error" in (r.error or "")


@pytest.mark.asyncio
async def test_sipuni_initiate_network_exception():
    from app.services.telephony.sipuni import SipuniProvider
    p = SipuniProvider(sipuni_id="x", secret_key="y")
    with patch("httpx.AsyncClient") as Client:
        client_inst = AsyncMock()
        client_inst.post = AsyncMock(side_effect=Exception("connection refused"))
        Client.return_value.__aenter__.return_value = client_inst
        r = await p.initiate_call(from_user_phone="100", to_number="+79001234567")
    assert r.success is False
    assert "недоступен" in (r.error or "")


@pytest.mark.asyncio
async def test_webhook_maps_status():
    from app.services.telephony.sipuni import SipuniProvider
    p = SipuniProvider(sipuni_id="x", secret_key="y")
    out = await p.handle_incoming_webhook({
        "call_id": "abc123", "status": "CONNECTED", "duration": "42",
        "record_url": "https://sipuni.com/rec/abc.mp3",
    })
    assert out["status"] == "answered"
    assert out["duration_sec"] == 42
    assert out["recording_url"].endswith(".mp3")
    out2 = await p.handle_incoming_webhook({"call_id": "x", "status": "NOANSWER"})
    assert out2["status"] == "missed"
```

### Task 2: Factory расширение

В `backend/app/services/telephony/factory.py` — заменить `# TODO: реальные провайдеры` блоком:

```python
from app.services import encryption_service as enc
from .sipuni import SipuniProvider


async def get_provider(db: AsyncSession, tenant_id: uuid.UUID) -> TelephonyProvider:
    if not tenant_id:
        return NullProvider()
    cfg = (await db.execute(
        select(TelephonyConfig).where(TelephonyConfig.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not cfg or not cfg.is_active or cfg.provider in ("null", ""):
        return NullProvider()
    if cfg.provider == "sipuni":
        sipuni_id = enc.decrypt(cfg.api_key_encrypted) if cfg.api_key_encrypted else ""
        secret = enc.decrypt(cfg.api_secret_encrypted) if cfg.api_secret_encrypted else ""
        if not sipuni_id or not secret:
            return NullProvider()
        return SipuniProvider(sipuni_id, secret)
    # Другие провайдеры (mango/zadarma/...) — отдельной сессией
    return NullProvider()
```

### Task 3: Webhook endpoint

В `backend/app/routers/tenant_telephony.py` добавить:

```python
@router.post("/telephony/webhook/sipuni")
async def sipuni_webhook(
    payload: dict,
    db: AsyncSession = Depends(get_db),
):
    """Принимает уведомления от Sipuni о статусах звонков.

    Sipuni не подписывает webhook'и — публичный endpoint. Логика:
    1. Найти PhoneCall по provider_call_id
    2. Обновить status, duration, ended_at, recording_url
    """
    from app.services.telephony.sipuni import SipuniProvider
    # Используем парсер из SipuniProvider (без credentials — public-static logic)
    parsed = await SipuniProvider("", "").handle_incoming_webhook(payload)
    if not parsed.get("ok") or not parsed.get("provider_call_id"):
        return {"ok": False}
    call = (await db.execute(
        select(PhoneCall).where(PhoneCall.provider_call_id == parsed["provider_call_id"])
    )).scalar_one_or_none()
    if not call:
        return {"ok": False, "reason": "call_not_found"}
    call.status = parsed["status"]
    if parsed.get("duration_sec"):
        call.duration_sec = parsed["duration_sec"]
        call.ended_at = datetime.utcnow()
    if parsed.get("recording_url"):
        call.recording_url = parsed["recording_url"]
    await db.commit()
    return {"ok": True}
```

### Task 4: Smoke

```bash
docker compose build clinika-backend && up -d
sleep 8
docker compose exec -T clinika-backend pytest tests/test_sipuni.py -v
curl -s -o /dev/null -w "webhook HTTP %{http_code}\n" -X POST -H "Content-Type: application/json" \
  -d '{}' http://127.0.0.1:8900/telephony/webhook/sipuni
```
Expected: 5 tests passed, webhook 200 (или 400 на пустой payload — зависит от валидации).

### Task 5: Commit

```bash
git add backend/app/services/telephony/sipuni.py backend/app/services/telephony/factory.py backend/app/routers/tenant_telephony.py backend/tests/test_sipuni.py
git -c commit.gpgsign=false commit -m "feat(telephony): SipuniProvider + webhook + 5 тестов"
```

## Self-Review

- ✅ `_signature(from, to, ts)` — md5(from + sipuni_id + time + to + secret), порядок зафиксирован в тесте 1
- ✅ Network exception → success=False (тест 4)
- ✅ Error response → success=False (тест 3)
- ✅ Status mapping CONNECTED→answered и т.п. (тест 5)
- ✅ Factory расшифровывает api_key как sipuni_id, api_secret как secret_key — соответствует UI который пишет туда credentials
- ✅ Webhook без auth — Sipuni не подписывает; ищем PhoneCall по provider_call_id и обновляем статус
