"""
MIS Renovatio client (mis.stoclinica.ru:3010)
POST /api/public/METHOD + api_key in form body.
"""
import logging
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from app.config import settings

log = logging.getLogger("mis_client")
_SSL_WARN_LOGGED = False  # один warning за процесс, чтобы не спамить логи

DEFAULT_MIS_BASE = "https://mis.stoclinic.ru:3010/api/public"
# ===== Per-tenant МИС =====
# Список clinic_id хранится в Tenant.mis_clinic_ids (JSONB). Глобальной константы
# больше нет — она была cross-tenant утечкой (опросом чужих клиник без проверки tenant).


def _ssl_context(ssl_verify: bool):
    """
    Возвращает параметр verify для httpx.
    Если mis_ca_cert_path задан в настройках — используем его.
    Если ssl_verify=False — логируем предупреждение (MITM-риск).
    """
    ca_cert = getattr(settings, 'mis_ca_cert_path', '').strip()
    if ca_cert:
        return ca_cert  # httpx принимает путь к CA-файлу
    if not ssl_verify and not _SSL_WARN_LOGGED:
        log.warning(
            "MIS SSL verification DISABLED (MIS_SSL_VERIFY=false). "
            "Установите MIS_CA_CERT_PATH=/path/to/mis_ca.pem для безопасного подключения."
        )
        globals()["_SSL_WARN_LOGGED"] = True
    return ssl_verify


def _get_base(api_url: str = "") -> str:
    if api_url and api_url.strip():
        url = api_url.strip().rstrip("/")
        if url.startswith("http://"):
            url = "https://" + url[7:]
        if not url.endswith("/api/public"):
            url = url + "/api/public"
        return url
    return DEFAULT_MIS_BASE


@retry(
    retry=retry_if_exception_type((httpx.ConnectError, httpx.TimeoutException, httpx.NetworkError)),
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=10),
    reraise=True,
)
async def _post_with_retry(client: httpx.AsyncClient, url: str, data: dict) -> httpx.Response:
    """Выполнить POST-запрос с автоматическим retry при сетевых ошибках."""
    resp = await client.post(url, data=data)
    resp.raise_for_status()
    return resp


async def _post(method: str, api_url: str = "", api_key: str = "", ssl_verify: bool | None = None, **params) -> dict:
    key = api_key.strip() if api_key else settings.mis_api_key
    base = _get_base(api_url)
    data = {"api_key": key, **{k: v for k, v in params.items() if v is not None}}
    if ssl_verify is None:
        ssl_verify = settings.mis_ssl_verify
    ssl = _ssl_context(ssl_verify)
    async with httpx.AsyncClient(verify=ssl, timeout=30, follow_redirects=True) as client:
        resp = await _post_with_retry(client, f"{base}/{method}", data)
        return resp.json()


def _is_no_access(result: dict) -> bool:
    """403 «No access to method» — ключ существует, но прав нет."""
    if not isinstance(result, dict):
        return False
    if result.get("error") != 1:
        return False
    data = result.get("data") or {}
    code = str(data.get("code") or "")
    return code == "403"


async def test_connection(api_url: str = "", api_key: str = "") -> dict:
    """Проверить соединение с МИС."""
    try:
        result = await _post("getClinics", api_url=api_url, api_key=api_key,
                             ssl_verify=settings.mis_ssl_verify, show_all=1)
        if result.get("error") == 0:
            clinics = result.get("data") or []
            return {"status": "ok", "message": f"Подключено, клиник в МИС: {len(clinics)}", "count": len(clinics)}
        return {"status": "error", "message": f"МИС вернула ошибку: {result.get('error')}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


async def get_services(clinic_id: int, api_url: str = "", api_key: str = "") -> list[dict]:
    result = await _post("getServices", api_url=api_url, api_key=api_key,
                         ssl_verify=settings.mis_ssl_verify, clinic_id=clinic_id)
    if result.get("error") == 0:
        return result["data"] or []
    return []


async def find_patient_by_phone(phone: str, api_url: str = "", api_key: str = "") -> dict | None:
    from app.utils.phone import normalize_phone
    digits = normalize_phone(phone)
    for fmt in [digits, "+" + digits]:
        try:
            result = await _post("getPatient", api_url=api_url, api_key=api_key,
                                 ssl_verify=settings.mis_ssl_verify, mobile=fmt)
            if result.get("error") == 0 and result.get("data"):
                data = result["data"]
                patients = data if isinstance(data, list) else [data]
                if patients:
                    return patients[0]
        except Exception:
            continue
    return None


async def add_patient(
    phone: str,
    full_name: str = "",
    api_url: str = "",
    api_key: str = "",
    clinic_id: int | None = None,
) -> dict | None:
    """Создать пациента в МИС Renovatio. Возвращает dict с patient_id или None.

    full_name парсится: первое слово -> last_name, второе -> first_name, третье -> third_name.
    Если данные неполные, передаём только то что есть. mobile обязателен.

    clinic_id (опционально) — Renovatio может привязать создаваемого пациента к
    конкретной клинике франшизы. Если параметр не передан — пациент создаётся
    глобально (как сейчас). Renovatio игнорирует неизвестные параметры, поэтому
    передавать безопасно даже если их версия не поддерживает.
    """
    from app.utils.phone import normalize_phone
    digits = normalize_phone(phone)
    if not digits:
        return None
    parts = (full_name or "").strip().split()
    last_name  = parts[0] if len(parts) >= 1 else ""
    first_name = parts[1] if len(parts) >= 2 else ""
    third_name = parts[2] if len(parts) >= 3 else ""
    payload: dict = {"mobile": "+" + digits}
    if last_name:  payload["last_name"]  = last_name
    if first_name: payload["first_name"] = first_name
    if third_name: payload["third_name"] = third_name
    if clinic_id is not None:
        payload["clinic_id"] = int(clinic_id)
    try:
        result = await _post("addPatient", api_url=api_url, api_key=api_key,
                             ssl_verify=settings.mis_ssl_verify, **payload)
    except Exception:
        log.exception("addPatient failed for phone=%s", phone)
        return None
    if result.get("error") == 0 and result.get("data"):
        data = result["data"]
        # Renovatio может вернуть patient_id как число или dict
        if isinstance(data, dict):
            return data
        if isinstance(data, (int, str)):
            return {"patient_id": int(data)}
    log.warning("addPatient: МИС вернула ошибку: %s", result)
    return None


async def get_appointments(clinic_id: int, date_from: str, date_to: str, api_url: str = "", api_key: str = "") -> list[dict]:
    result = await _post(
        "getAppointments", api_url=api_url, api_key=api_key,
        ssl_verify=settings.mis_ssl_verify,
        clinic_id=clinic_id, date_updated_from=date_from, date_updated_to=date_to,
    )
    if result.get("error") == 0:
        return result.get("data") or []
    return []


async def get_clinics(api_url: str = "", api_key: str = "") -> list[dict]:
    result = await _post("getClinics", api_url=api_url, api_key=api_key,
                         ssl_verify=settings.mis_ssl_verify, show_all=1)
    if result.get("error") == 0:
        return result["data"] or []
    return []


# ───────────────────────────────────────────────────────────────────────────
# Renovatio: расширенные методы для NetLTV-аналитики (модуль ltv_pro).
#
# На момент написания (2026-05-07) все 5 методов ниже возвращают
#   {"error":1,"data":{"code":403,"desc":"No access to method"}}
# для api_key тенанта Клиники. Иван (Renovatio) обещал открыть доступ —
# до этого момента обёртки возвращают пустой список и логируют warning,
# чтобы LTV-сервис деградировал в Gross-only режим без падений.
# ───────────────────────────────────────────────────────────────────────────


async def get_payments(
    clinic_id: int,
    date_from: str,
    date_to: str,
    api_url: str = "",
    api_key: str = "",
) -> list[dict]:
    """Фактические оплаты пациентов за период.

    Renovatio: POST /api/public/getPayments
    Параметры: clinic_id, date_from, date_to (формат dd.mm.yyyy).
    Возвращает list[dict] — структура определится после открытия доступа
    (ожидаемо: payment_id, patient_id, amount, method, created_at, invoice_id).
    """
    try:
        result = await _post(
            "getPayments", api_url=api_url, api_key=api_key,
            ssl_verify=settings.mis_ssl_verify,
            clinic_id=clinic_id, date_from=date_from, date_to=date_to,
        )
    except Exception as e:
        log.warning("getPayments: ошибка запроса: %s", e)
        return []
    if _is_no_access(result):
        log.info("getPayments: 403 No access to method — Renovatio ещё не открыл доступ")
        return []
    if result.get("error") == 0:
        return result.get("data") or []
    log.warning("getPayments: МИС вернула ошибку: %s", result)
    return []


async def get_invoices(
    clinic_id: int,
    date_from: str,
    date_to: str,
    api_url: str = "",
    api_key: str = "",
) -> list[dict]:
    """Счета (invoice) — позиции по услугам со скидками.

    Renovatio: POST /api/public/getInvoices
    Параметры: clinic_id, date_from, date_to (формат dd.mm.yyyy).
    """
    try:
        result = await _post(
            "getInvoices", api_url=api_url, api_key=api_key,
            ssl_verify=settings.mis_ssl_verify,
            clinic_id=clinic_id, date_from=date_from, date_to=date_to,
        )
    except Exception as e:
        log.warning("getInvoices: ошибка запроса: %s", e)
        return []
    if _is_no_access(result):
        log.info("getInvoices: 403 No access to method — Renovatio ещё не открыл доступ")
        return []
    if result.get("error") == 0:
        return result.get("data") or []
    log.warning("getInvoices: МИС вернула ошибку: %s", result)
    return []


async def get_programs(
    clinic_id: int,
    api_url: str = "",
    api_key: str = "",
) -> list[dict]:
    """Каталог абонементов / пакетных программ клиники.

    Renovatio: POST /api/public/getPrograms
    Параметры: clinic_id.
    """
    try:
        result = await _post(
            "getPrograms", api_url=api_url, api_key=api_key,
            ssl_verify=settings.mis_ssl_verify,
            clinic_id=clinic_id,
        )
    except Exception as e:
        log.warning("getPrograms: ошибка запроса: %s", e)
        return []
    if _is_no_access(result):
        log.info("getPrograms: 403 No access to method — Renovatio ещё не открыл доступ")
        return []
    if result.get("error") == 0:
        return result.get("data") or []
    log.warning("getPrograms: МИС вернула ошибку: %s", result)
    return []


async def get_patient_programs(
    clinic_id: int,
    api_url: str = "",
    api_key: str = "",
) -> list[dict]:
    """Купленные пациентами абонементы (срок, остаток сеансов и т.д.).

    Renovatio: POST /api/public/getPatientPrograms
    Параметры: clinic_id.
    """
    try:
        result = await _post(
            "getPatientPrograms", api_url=api_url, api_key=api_key,
            ssl_verify=settings.mis_ssl_verify,
            clinic_id=clinic_id,
        )
    except Exception as e:
        log.warning("getPatientPrograms: ошибка запроса: %s", e)
        return []
    if _is_no_access(result):
        log.info("getPatientPrograms: 403 No access to method — Renovatio ещё не открыл доступ")
        return []
    if result.get("error") == 0:
        return result.get("data") or []
    log.warning("getPatientPrograms: МИС вернула ошибку: %s", result)
    return []


async def get_calls(
    clinic_id: int,
    date_from: str,
    date_to: str,
    api_url: str = "",
    api_key: str = "",
) -> list[dict]:
    """Журнал звонков (CRM-аналитика, маркетинговая атрибуция).

    Renovatio: POST /api/public/getCalls
    Параметры: clinic_id, date_from, date_to (формат dd.mm.yyyy).
    """
    try:
        result = await _post(
            "getCalls", api_url=api_url, api_key=api_key,
            ssl_verify=settings.mis_ssl_verify,
            clinic_id=clinic_id, date_from=date_from, date_to=date_to,
        )
    except Exception as e:
        log.warning("getCalls: ошибка запроса: %s", e)
        return []
    if _is_no_access(result):
        log.info("getCalls: 403 No access to method — Renovatio ещё не открыл доступ")
        return []
    if result.get("error") == 0:
        return result.get("data") or []
    log.warning("getCalls: МИС вернула ошибку: %s", result)
    return []


# Удалены неиспользуемые get_patient_visits / get_patient_analyses —
# у обеих был cross-tenant fallback по глобальному MIS_CLINIC_IDS.
# Если когда-то понадобится — реализовать per-tenant: принимать clinic_ids: list[int]
# из Tenant.mis_clinic_ids на стороне вызова (как в auto_confirm.py).
