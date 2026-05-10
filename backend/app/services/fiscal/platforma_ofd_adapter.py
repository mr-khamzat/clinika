"""
Платформа ОФД — рабочий адаптер фискализации (54-ФЗ).

Документация: https://platformaofd.ru/api-info
Базовый URL: https://lkapi.platformaofd.ru

Авторизация: Bearer token, выдаваемый POST /api/v1/auth (login/password). Срок жизни
токена — несколько часов; при 401 — рефрешим. Кеш токена держится в памяти
адаптера + опционально в Redis (если settings.redis_url есть).

ВАЖНО: реальные пути API могут варьироваться между версиями v1/v2/v3 в зависимости
от подключённого тарифа Платформы ОФД. Базовые маршруты ниже — наиболее общие.
Если у пользователя другой контракт — поправить пути в _PATH_*. Принципиально
структура «auth → send/get/list» одинакова.

Конфиг через ENV:
  - PLATFORMA_OFD_LOGIN
  - PLATFORMA_OFD_PASSWORD
  - PLATFORMA_OFD_API_BASE   (default: https://lkapi.platformaofd.ru)
  - COMPANY_INN              (ИНН компании-отправителя чека)
  - COMPANY_TAX_SYSTEM       (general|usn_income|usn_income_outcome|envd|esn|patent)

Если креды не заданы — методы кидают RuntimeError → роутер вернёт 503.
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import httpx

from app.services.fiscal.base import BaseOfdProvider, FiscalReceiptData


log = logging.getLogger("platforma_ofd_adapter")

# ── Маршруты API (актуальные на момент написания, см. шапку файла) ─────────
_PATH_AUTH        = "/api/v1/auth"
_PATH_RECEIPTS    = "/lkapi/v3/receipts"      # POST для send / GET для list
_PATH_RECEIPT_ONE = "/lkapi/v3/receipts/{id}"

DEFAULT_BASE = "https://lkapi.platformaofd.ru"
HTTP_TIMEOUT = 25.0


class PlatformaOfdProvider(BaseOfdProvider):
    """Платформа ОФД (lkapi v3). Auth: Bearer token."""
    name = "platforma_ofd"

    # ── Хранилище токена (в инстансе + опц. Redis) ──────────────────────────
    _token: str | None = None
    _token_expires_at: float = 0.0  # unix seconds
    _token_lock: asyncio.Lock | None = None

    def __init__(self, config):  # noqa: ANN001
        super().__init__(config)
        # asyncio.Lock создаём лениво — цикл может ещё не существовать
        self._token_lock = None

    # ── Креды ────────────────────────────────────────────────────────────────

    def _credentials(self) -> tuple[str, str, str]:
        """Возвращает (login, password, api_base). RuntimeError если не задано."""
        # Сначала пробуем из БД-конфига (OFDConfig.api_key хранит "login:password" или JSON)
        login = ""
        password = ""
        api_base = DEFAULT_BASE

        cfg_extra = getattr(self.config, "config", None) or {}
        if isinstance(cfg_extra, dict):
            login = cfg_extra.get("login") or ""
            password = cfg_extra.get("password") or ""
            api_base = cfg_extra.get("api_base") or api_base

        # api_key в OFDConfig — для совместимости со старым контрактом
        api_key = getattr(self.config, "api_key", "") if self.config else ""
        if api_key and ":" in api_key and not (login and password):
            # формат "login:password"
            l, p = api_key.split(":", 1)
            login = login or l
            password = password or p

        # Fallback на ENV
        if not login:
            login = os.getenv("PLATFORMA_OFD_LOGIN", "")
        if not password:
            password = os.getenv("PLATFORMA_OFD_PASSWORD", "")
        api_base = os.getenv("PLATFORMA_OFD_API_BASE", api_base)

        if not login or not password:
            raise RuntimeError(
                "Платформа ОФД не настроена: задай PLATFORMA_OFD_LOGIN и "
                "PLATFORMA_OFD_PASSWORD в .env (или OFDConfig.api_key='login:password')."
            )
        return login, password, api_base.rstrip("/")

    def _company_inn(self) -> str:
        """ИНН компании-отправителя чека."""
        inn = getattr(self.config, "inn", "") if self.config else ""
        return inn or os.getenv("COMPANY_INN", "")

    def _tax_system(self) -> str:
        """Система налогообложения (для items.tax)."""
        cfg_extra = getattr(self.config, "config", None) or {}
        if isinstance(cfg_extra, dict) and cfg_extra.get("tax_system"):
            return cfg_extra["tax_system"]
        return os.getenv("COMPANY_TAX_SYSTEM", "general")

    # ── Auth + token caching ─────────────────────────────────────────────────

    async def _authenticate(self, force: bool = False) -> str:
        """Получает Bearer-токен. Кеширует его в self до истечения срока."""
        if self._token_lock is None:
            self._token_lock = asyncio.Lock()

        async with self._token_lock:
            now = datetime.now(tz=timezone.utc).timestamp()
            if not force and self._token and self._token_expires_at - 60 > now:
                return self._token

            login, password, api_base = self._credentials()

            async with httpx.AsyncClient(base_url=api_base, timeout=HTTP_TIMEOUT) as client:
                try:
                    resp = await client.post(
                        _PATH_AUTH,
                        json={"login": login, "password": password},
                    )
                except httpx.HTTPError as e:
                    raise RuntimeError(f"Платформа ОФД: ошибка соединения: {e}") from e

            if resp.status_code >= 400:
                raise RuntimeError(
                    f"Платформа ОФД auth {resp.status_code}: {resp.text[:300]}"
                )

            data = resp.json()
            token = (
                data.get("token")
                or data.get("access_token")
                or data.get("AuthToken")
            )
            if not token:
                raise RuntimeError(f"Платформа ОФД: в ответе auth нет токена: {data}")

            # Срок жизни токена. Если не отдают — даём 1 час.
            ttl = data.get("expires_in") or data.get("ttl") or 3600
            try:
                ttl = int(ttl)
            except (ValueError, TypeError):
                ttl = 3600

            self._token = str(token)
            self._token_expires_at = now + ttl
            return self._token

    async def _http(self) -> httpx.AsyncClient:
        """HTTP клиент с автоматически прикреплённым Bearer-токеном."""
        token = await self._authenticate()
        _, _, api_base = self._credentials()
        return httpx.AsyncClient(
            base_url=api_base,
            timeout=HTTP_TIMEOUT,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )

    async def _request(
        self,
        method: str,
        url: str,
        *,
        json: dict | None = None,
        params: dict | None = None,
    ) -> dict:
        """Запрос с автоматическим refresh-токена при 401."""
        for attempt in (1, 2):
            async with await self._http() as client:
                try:
                    resp = await client.request(method, url, json=json, params=params)
                except httpx.HTTPError as e:
                    raise RuntimeError(f"Платформа ОФД {method} {url}: {e}") from e

            if resp.status_code == 401 and attempt == 1:
                # Перезапросить токен и попробовать снова
                await self._authenticate(force=True)
                continue
            if resp.status_code >= 400:
                raise RuntimeError(
                    f"Платформа ОФД {method} {url} → {resp.status_code}: {resp.text[:500]}"
                )
            try:
                return resp.json()
            except ValueError:
                return {}

        raise RuntimeError("Платформа ОФД: 401 после refresh-токена")

    # ── 1) Отправка чека ─────────────────────────────────────────────────────

    async def send_receipt(
        self,
        order_id: str,
        items: list[dict],
        payment_method: str,
        total: Decimal,
        customer_email_or_phone: str,
    ) -> dict[str, Any]:
        """Отправить новый чек на фискализацию.

        items: [{"name": "Консультация", "price": 1500.0, "quantity": 1, "vat": 20}, ...]
        payment_method: "cash" | "electronic"
        customer_email_or_phone: '+7…' либо 'patient@example.com' (ст. 4.7 ФЗ-54).
        """
        # Проверка кредов первой — она даст человекочитаемое сообщение,
        # а уже потом проверяем INN (тоже обязателен для отправки).
        self._credentials()
        inn = self._company_inn()
        if not inn:
            raise RuntimeError(
                "Платформа ОФД не настроена: не задан COMPANY_INN в .env "
                "(или OFDConfig.inn для клиники)."
            )

        # Нормализация items под контракт Платформы ОФД
        norm_items = []
        for it in items:
            price = Decimal(str(it.get("price", 0)))
            qty = Decimal(str(it.get("quantity", 1)))
            vat = it.get("vat", 20)
            norm_items.append({
                "name": (it.get("name") or "Услуга")[:128],
                "price": float(price.quantize(Decimal("0.01"))),
                "quantity": float(qty),
                "sum": float((price * qty).quantize(Decimal("0.01"))),
                "vatRate": f"vat{vat}" if vat else "vatNo",
                "paymentSubject": it.get("payment_subject", "service"),
                "paymentMethod": it.get("payment_object", "fullPayment"),
            })

        is_email = "@" in (customer_email_or_phone or "")
        body = {
            "operation": "sale",
            "inn": inn,
            "taxSystem": self._tax_system(),
            "orderId": str(order_id),
            "client": {
                "email" if is_email else "phone": customer_email_or_phone or "",
            },
            "items": norm_items,
            "payments": [
                {
                    "type": "electronic" if payment_method == "electronic" else "cash",
                    "sum": float(Decimal(str(total)).quantize(Decimal("0.01"))),
                }
            ],
            "total": float(Decimal(str(total)).quantize(Decimal("0.01"))),
        }

        data = await self._request("POST", _PATH_RECEIPTS, json=body)
        return {
            "ofd_id": data.get("id") or data.get("uuid") or data.get("receiptId"),
            "fiscal_doc_number": data.get("fiscalDocumentNumber") or data.get("fd"),
            "fiscal_sign": data.get("fiscalSign") or data.get("fp"),
            "status": data.get("status", "pending"),
            "raw": data,
        }

    # ── 2) Статус чека ───────────────────────────────────────────────────────

    async def get_receipt_status(self, ofd_id: str) -> dict[str, Any]:
        """GET /lkapi/v3/receipts/{id} — текущий статус и фискальные реквизиты."""
        data = await self._request("GET", _PATH_RECEIPT_ONE.format(id=ofd_id))
        return {
            "ofd_id": data.get("id") or ofd_id,
            "status": data.get("status", "unknown"),
            "fiscal_doc_number": data.get("fiscalDocumentNumber") or data.get("fd"),
            "fiscal_storage_number": data.get("fiscalStorageNumber") or data.get("fn"),
            "fiscal_sign": data.get("fiscalSign") or data.get("fp"),
            "qr_code": data.get("qr") or data.get("qrCode"),
            "raw": data,
        }

    # ── 3) Pagination pull для синхронизации ────────────────────────────────

    async def pull_receipts_page(
        self,
        date_from: datetime,
        date_to: datetime,
        page: int = 1,
        page_size: int = 100,
    ) -> list[dict]:
        """Постранично подтягивает чеки за период."""
        params = {
            "dateFrom": date_from.strftime("%Y-%m-%dT%H:%M:%S"),
            "dateTo":   date_to.strftime("%Y-%m-%dT%H:%M:%S"),
            "page": page,
            "pageSize": page_size,
            "inn": self._company_inn(),
        }
        data = await self._request("GET", _PATH_RECEIPTS, params=params)
        # Платформа ОФД возвращает {"items": [...], "total": N} или сразу список
        if isinstance(data, list):
            return data
        return data.get("items") or data.get("receipts") or []

    # ── 4) Унифицированный метод BaseOfdProvider ────────────────────────────

    async def pull_receipts(self, since: datetime) -> list[FiscalReceiptData]:
        """Подтягивает все чеки начиная с since. Используется кроном."""
        date_to = datetime.utcnow()
        out: list[FiscalReceiptData] = []
        page = 1
        while True:
            chunk = await self.pull_receipts_page(since, date_to, page=page)
            if not chunk:
                break
            for r in chunk:
                out.append(self._row_to_receipt(r))
            if len(chunk) < 100:
                break
            page += 1
            if page > 100:
                # safety stop
                log.warning("Платформа ОФД: pull_receipts остановлен на 100 страницах")
                break
        return out

    def _row_to_receipt(self, row: dict) -> FiscalReceiptData:
        """Конвертирует raw-строку из ответа API в FiscalReceiptData."""
        receipt_at = None
        rec_dt = row.get("dateTime") or row.get("date") or row.get("receiptAt")
        if isinstance(rec_dt, str):
            try:
                receipt_at = datetime.fromisoformat(rec_dt.replace("Z", "+00:00"))
            except ValueError:
                receipt_at = None

        total = row.get("totalSum") or row.get("total") or 0
        try:
            total_dec = Decimal(str(total))
        except Exception:  # noqa: BLE001
            total_dec = Decimal("0")

        return FiscalReceiptData(
            inn=str(row.get("inn") or self._company_inn() or ""),
            operation_type=str(row.get("operation") or "sale"),
            total_sum=total_dec,
            qr_code=row.get("qr") or row.get("qrCode"),
            fiscal_doc_number=str(row.get("fiscalDocumentNumber") or row.get("fd") or "") or None,
            fiscal_storage_number=str(row.get("fiscalStorageNumber") or row.get("fn") or "") or None,
            fiscal_sign=str(row.get("fiscalSign") or row.get("fp") or "") or None,
            receipt_at=receipt_at,
            raw_payload=row,
        )

    # ── 5) verify_inn (валидация ИНН в ОФД) ─────────────────────────────────

    async def verify_inn(self, inn: str) -> bool:
        """Проверка ИНН — true если для него есть хотя бы один чек/договор."""
        # Платформа ОФД не имеет публичного «есть ли такой ИНН» — пробуем pull
        try:
            data = await self._request("GET", _PATH_RECEIPTS, params={"inn": inn, "pageSize": 1})
        except RuntimeError:
            return False
        if isinstance(data, list):
            return len(data) > 0
        return bool(data.get("items") or data.get("total"))
