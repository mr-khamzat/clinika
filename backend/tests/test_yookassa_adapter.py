"""
Unit-тесты ЮKassa адаптера эквайринга.

Используем pytest-monkeypatch + httpx.MockTransport — без сети, без БД.
Запуск: pytest tests/test_yookassa_adapter.py -v
"""
from __future__ import annotations

import json
from decimal import Decimal
from unittest.mock import MagicMock

import httpx
import pytest

pytestmark = pytest.mark.unit


# ─── Helpers ──────────────────────────────────────────────────────────────────


def _mk_config(shop_id: str = "test_shop", secret: str = "test_secret"):
    """Создаёт фейковый PaymentGatewayConfig (только нужные атрибуты)."""
    cfg = MagicMock()
    cfg.shop_id = shop_id
    cfg.secret_key = secret
    return cfg


def _mock_yk(monkeypatch, handler):
    """Подменяет httpx.AsyncClient внутри адаптера на MockTransport."""
    from app.services.acquiring import yookassa_adapter as ymod

    transport = httpx.MockTransport(handler)
    original_init = httpx.AsyncClient.__init__

    def _patched(self, *args, **kwargs):
        kwargs["transport"] = transport
        original_init(self, *args, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "__init__", _patched)
    return ymod


# ─── 1) init_payment success ──────────────────────────────────────────────────


async def test_init_payment_success(monkeypatch):
    """Успешный POST /payments возвращает confirmation_url + id."""
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["url"] = str(request.url)
        captured["headers"] = dict(request.headers)
        captured["body"] = json.loads(request.content.decode())
        return httpx.Response(
            200,
            json={
                "id": "yk_test_payment_001",
                "status": "pending",
                "confirmation": {
                    "type": "redirect",
                    "confirmation_url": "https://yoomoney.ru/checkout/payments/yk_test_payment_001",
                },
                "amount": {"value": "1500.00", "currency": "RUB"},
            },
        )

    ymod = _mock_yk(monkeypatch, handler)

    gw = ymod.YookassaGateway(_mk_config())
    res = await gw.init_payment(
        amount=Decimal("1500"),
        description="Консультация",
        return_url="https://klinik.ru/return",
        metadata={"appointment_id": "abc-123"},
        idempotency_key="idem-001",
    )

    assert res.payment_id == "yk_test_payment_001"
    assert "yoomoney.ru" in res.payment_url
    assert captured["body"]["amount"] == {"value": "1500.00", "currency": "RUB"}
    assert captured["body"]["capture"] is True
    assert captured["body"]["confirmation"]["return_url"] == "https://klinik.ru/return"
    assert captured["body"]["metadata"]["appointment_id"] == "abc-123"
    assert captured["headers"]["idempotence-key"] == "idem-001"
    # Basic auth
    assert "authorization" in captured["headers"]
    assert captured["headers"]["authorization"].startswith("Basic ")


# ─── 2) init_payment без credentials → RuntimeError ──────────────────────────


async def test_init_payment_no_credentials_raises(monkeypatch):
    """Без shop_id/secret_key и без env-переменных адаптер должен выбросить RuntimeError."""
    monkeypatch.delenv("YOOKASSA_SHOP_ID", raising=False)
    monkeypatch.delenv("YOOKASSA_SECRET_KEY", raising=False)

    from app.services.acquiring.yookassa_adapter import YookassaGateway

    gw = YookassaGateway(None)  # config=None — шлюз ещё не сконфигурирован
    with pytest.raises(RuntimeError, match="YOOKASSA не настроена"):
        await gw.init_payment(
            amount=Decimal("100"),
            description="test",
            return_url="https://x.test/return",
            metadata=None,
        )


# ─── 3) get_status (succeeded) ───────────────────────────────────────────────


async def test_get_status_succeeded(monkeypatch):
    def handler(request):
        assert request.method == "GET"
        assert "/v3/payments/yk_001" in str(request.url)
        return httpx.Response(
            200,
            json={
                "id": "yk_001",
                "status": "succeeded",
                "captured_at": "2026-05-10T12:34:56Z",
                "amount": {"value": "1500.00", "currency": "RUB"},
            },
        )

    ymod = _mock_yk(monkeypatch, handler)
    gw = ymod.YookassaGateway(_mk_config())
    res = await gw.get_status("yk_001")
    assert res.status == "succeeded"
    assert res.paid_at is not None
    assert res.paid_at.year == 2026


# ─── 4) refund ────────────────────────────────────────────────────────────────


async def test_refund(monkeypatch):
    captured = {}

    def handler(request):
        # 1-й вызов (если amount=None) — get_status, 2-й — refund.
        captured.setdefault("calls", []).append((request.method, str(request.url)))
        if request.method == "POST" and "/refunds" in str(request.url):
            body = json.loads(request.content.decode())
            captured["refund_body"] = body
            return httpx.Response(200, json={
                "id": "rfd_001",
                "status": "succeeded",
                "amount": body["amount"],
                "payment_id": body["payment_id"],
            })
        return httpx.Response(404)

    ymod = _mock_yk(monkeypatch, handler)
    gw = ymod.YookassaGateway(_mk_config())
    raw = await gw.refund("yk_001", amount=Decimal("500"), idempotency_key="rfd-idem")
    assert raw["id"] == "rfd_001"
    assert captured["refund_body"]["payment_id"] == "yk_001"
    assert captured["refund_body"]["amount"]["value"] == "500.00"


# ─── 5) verify_webhook IP-allowlist ──────────────────────────────────────────


async def test_webhook_signature_invalid_ip():
    """IP не из YooKassa allowlist → verify_webhook возвращает None."""
    from app.services.acquiring.yookassa_adapter import YookassaGateway

    gw = YookassaGateway(_mk_config())
    body = json.dumps({"event": "payment.succeeded", "object": {"id": "yk_001", "status": "succeeded"}}).encode()

    # Произвольный IP, не из YooKassa
    headers = {"x-real-ip": "8.8.8.8"}
    res = await gw.verify_webhook(headers, body)
    assert res is None


async def test_webhook_valid_ip_parses():
    """IP из YooKassa allowlist → webhook парсится в наш контракт."""
    from app.services.acquiring.yookassa_adapter import YookassaGateway

    gw = YookassaGateway(_mk_config())
    body = json.dumps({
        "event": "payment.succeeded",
        "object": {
            "id": "yk_001",
            "status": "succeeded",
            "captured_at": "2026-05-10T10:00:00Z",
            "metadata": {"invoice_id": "inv-123"},
        },
    }).encode()

    headers = {"x-real-ip": "185.71.76.1"}  # из 185.71.76.0/27
    res = await gw.verify_webhook(headers, body)
    assert res is not None
    assert res["payment_id"] == "yk_001"
    assert res["status"] == "succeeded"
    assert res["paid_at"] is not None


async def test_webhook_refund_event_mapped():
    """payment.refund.succeeded → status=refunded."""
    from app.services.acquiring.yookassa_adapter import YookassaGateway

    gw = YookassaGateway(_mk_config())
    body = json.dumps({
        "event": "refund.succeeded",
        "object": {"id": "rfd_001", "status": "succeeded"},
    }).encode()
    res = await gw.verify_webhook({"x-real-ip": "77.75.156.11"}, body)
    assert res is not None
    assert res["status"] == "refunded"
