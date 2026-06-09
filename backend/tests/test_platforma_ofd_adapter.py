"""
Unit-тесты адаптера Платформы ОФД.

Запуск: pytest tests/test_platforma_ofd_adapter.py -v
"""
from __future__ import annotations

import json
from decimal import Decimal
from unittest.mock import MagicMock

import httpx
import pytest

pytestmark = pytest.mark.unit


def _mk_config(login: str = "test_login", password: str = "test_pass", inn: str = "0606123456"):
    cfg = MagicMock()
    cfg.api_key = f"{login}:{password}"
    # Адаптер после фикса #5/#10 читает дешифрованную property decrypted_api_key
    # (а не сырой api_key) — на MagicMock её надо задать явно, иначе fail-closed RuntimeError.
    cfg.decrypted_api_key = f"{login}:{password}"
    cfg.inn = inn
    cfg.config = {"tax_system": "general", "api_base": "https://lkapi.platformaofd.ru"}
    return cfg


def _mock_pofd(monkeypatch, handler):
    transport = httpx.MockTransport(handler)
    original_init = httpx.AsyncClient.__init__

    def _patched(self, *args, **kwargs):
        kwargs["transport"] = transport
        original_init(self, *args, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "__init__", _patched)


# ─── 1) send_receipt — happy path ────────────────────────────────────────────


async def test_send_receipt_success(monkeypatch):
    captured = {"calls": []}

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        captured["calls"].append((request.method, url))

        if url.endswith("/api/v1/auth"):
            return httpx.Response(200, json={"token": "TKN-123", "expires_in": 3600})

        if "/lkapi/v3/receipts" in url and request.method == "POST":
            body = json.loads(request.content.decode())
            captured["receipt_body"] = body
            return httpx.Response(200, json={
                "id": "ofd_001",
                "fiscalDocumentNumber": "12345",
                "fiscalSign": "9999999999",
                "status": "pending",
            })
        return httpx.Response(404)

    _mock_pofd(monkeypatch, handler)
    from app.services.fiscal.platforma_ofd_adapter import PlatformaOfdProvider

    p = PlatformaOfdProvider(_mk_config())
    res = await p.send_receipt(
        order_id="ord-001",
        items=[{"name": "Консультация", "price": 1500, "quantity": 1, "vat": 20}],
        payment_method="electronic",
        total=Decimal("1500"),
        customer_email_or_phone="patient@example.com",
    )

    assert res["ofd_id"] == "ofd_001"
    assert res["fiscal_doc_number"] == "12345"
    assert res["status"] == "pending"
    body = captured["receipt_body"]
    assert body["inn"] == "0606123456"
    assert body["taxSystem"] == "general"
    assert body["client"]["email"] == "patient@example.com"
    assert body["items"][0]["vatRate"] == "vat20"
    assert body["payments"][0]["type"] == "electronic"
    # Должны были авторизоваться + отправить чек
    methods = [m for m, _ in captured["calls"]]
    assert methods.count("POST") >= 2


# ─── 2) Без credentials → RuntimeError ───────────────────────────────────────


async def test_send_receipt_no_credentials_raises(monkeypatch):
    monkeypatch.delenv("PLATFORMA_OFD_LOGIN", raising=False)
    monkeypatch.delenv("PLATFORMA_OFD_PASSWORD", raising=False)

    from app.services.fiscal.platforma_ofd_adapter import PlatformaOfdProvider

    cfg = MagicMock()
    cfg.api_key = ""
    cfg.inn = "0606123456"
    cfg.config = {}

    p = PlatformaOfdProvider(cfg)
    with pytest.raises(RuntimeError, match="Платформа ОФД не настроена"):
        await p.send_receipt(
            order_id="ord-002",
            items=[{"name": "X", "price": 100, "quantity": 1, "vat": 20}],
            payment_method="cash",
            total=Decimal("100"),
            customer_email_or_phone="+79991234567",
        )


# ─── 3) get_receipt_status ───────────────────────────────────────────────────


async def test_get_receipt_status(monkeypatch):
    def handler(request):
        url = str(request.url)
        if url.endswith("/api/v1/auth"):
            return httpx.Response(200, json={"token": "TKN", "expires_in": 3600})
        if "/lkapi/v3/receipts/ofd_xyz" in url:
            return httpx.Response(200, json={
                "id": "ofd_xyz",
                "status": "registered",
                "fiscalDocumentNumber": "55555",
                "fiscalStorageNumber": "9999990000000001",
                "fiscalSign": "1234567890",
                "qr": "t=20260510T0000&s=1500.00&fn=999&i=55555&fp=12345&n=1",
            })
        return httpx.Response(404)

    _mock_pofd(monkeypatch, handler)
    from app.services.fiscal.platforma_ofd_adapter import PlatformaOfdProvider

    p = PlatformaOfdProvider(_mk_config())
    res = await p.get_receipt_status("ofd_xyz")
    assert res["status"] == "registered"
    assert res["fiscal_doc_number"] == "55555"
    assert res["qr_code"].startswith("t=")


# ─── 4) pull_receipts (pagination) ───────────────────────────────────────────


async def test_pull_receipts_paginated(monkeypatch):
    from datetime import datetime

    pages_served = {"n": 0}

    def handler(request):
        url = str(request.url)
        if url.endswith("/api/v1/auth"):
            return httpx.Response(200, json={"token": "TKN", "expires_in": 3600})

        if "/lkapi/v3/receipts" in url and request.method == "GET":
            pages_served["n"] += 1
            # Первая страница — 100 элементов, вторая — 5 и стоп
            if pages_served["n"] == 1:
                return httpx.Response(200, json={
                    "items": [{
                        "id": f"r{i}",
                        "totalSum": "100.00",
                        "operation": "sale",
                        "fiscalDocumentNumber": str(i),
                        "fiscalStorageNumber": "FN1",
                        "dateTime": "2026-05-10T10:00:00Z",
                    } for i in range(100)],
                    "total": 105,
                })
            return httpx.Response(200, json={
                "items": [{
                    "id": f"r{100+i}",
                    "totalSum": "100.00",
                    "operation": "sale",
                    "fiscalDocumentNumber": str(100+i),
                    "fiscalStorageNumber": "FN1",
                    "dateTime": "2026-05-10T10:00:00Z",
                } for i in range(5)],
                "total": 105,
            })

        return httpx.Response(404)

    _mock_pofd(monkeypatch, handler)
    from app.services.fiscal.platforma_ofd_adapter import PlatformaOfdProvider

    p = PlatformaOfdProvider(_mk_config())
    receipts = await p.pull_receipts(datetime(2026, 5, 1))
    assert len(receipts) == 105
    assert receipts[0].operation_type == "sale"
    assert receipts[0].total_sum == Decimal("100.00")


# ─── 5) Token refresh при 401 ────────────────────────────────────────────────


async def test_token_refresh_on_401(monkeypatch):
    state = {"calls": [], "token_returned": 0}

    def handler(request):
        url = str(request.url)
        state["calls"].append((request.method, url))

        if url.endswith("/api/v1/auth"):
            state["token_returned"] += 1
            return httpx.Response(200, json={"token": f"TKN-{state['token_returned']}", "expires_in": 3600})

        if "/lkapi/v3/receipts/abc" in url:
            # Первый раз 401, второй — ок (после refresh)
            attempts = sum(1 for m, u in state["calls"] if "/lkapi/v3/receipts/abc" in u)
            if attempts == 1:
                return httpx.Response(401, json={"error": "token expired"})
            return httpx.Response(200, json={"id": "abc", "status": "registered"})

        return httpx.Response(404)

    _mock_pofd(monkeypatch, handler)
    from app.services.fiscal.platforma_ofd_adapter import PlatformaOfdProvider

    p = PlatformaOfdProvider(_mk_config())
    res = await p.get_receipt_status("abc")
    assert res["status"] == "registered"
    # Должно быть ≥2 auth-вызова (изначальный + refresh)
    auth_calls = [c for c in state["calls"] if c[1].endswith("/api/v1/auth")]
    assert len(auth_calls) >= 2
