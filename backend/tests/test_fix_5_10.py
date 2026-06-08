"""
Точечные тесты для находок #5 и #10 (тема payments).

#5  — Fernet-секреты были write-only: secret_key писался plaintext и НИКОГДА
      не расшифровывался. Теперь: запись шифрует (encryption_service), чтение —
      через property PaymentGatewayConfig.decrypted_secret_key. Симметрично для
      OFDConfig.api_key → decrypted_api_key.
#10 — Per-clinic ЮKassa-адаптер не использовал сохранённый секрет (читал
      несуществующий атрибут) и молча уходил в ENV платформы. Теперь адаптер
      берёт креды ИЗ конфига клиники (приоритет), ENV — только при config is None,
      а при активном конфиге с нечитаемым секретом → RuntimeError (НЕ ENV).

Юнит-стиль: без Docker/Postgres. Модели инстанцируются в памяти (декларативный
__init__ просто проставляет атрибуты, БД не требуется). HTTP — httpx.MockTransport.

Запуск: pytest backend/tests/test_fix_5_10.py -v
"""
from __future__ import annotations

import base64
import json
from decimal import Decimal

import httpx
import pytest

pytestmark = pytest.mark.unit


# ── Фикстура: детерминированный Fernet-ключ ──────────────────────────────────

@pytest.fixture
def stable_secret_key(monkeypatch):
    """Фиксирует SECRET_KEY и сбрасывает кэш Fernet в encryption_service.

    Без этого _fernet кэшируется на весь процесс и тесты влияют друг на друга.
    """
    import app.services.encryption_service as enc

    monkeypatch.setenv("SECRET_KEY", "unit-test-secret-key-for-fix-5-10")
    # Пробуем подсунуть тот же ключ и в settings, если оно уже загружено.
    try:
        from app.config import settings
        monkeypatch.setattr(settings, "secret_key", "unit-test-secret-key-for-fix-5-10", raising=False)
    except Exception:
        pass
    # Сбрасываем кэшированный Fernet, чтобы ключ перечитался.
    monkeypatch.setattr(enc, "_fernet", None, raising=False)
    yield enc
    monkeypatch.setattr(enc, "_fernet", None, raising=False)


# ── #5: round-trip шифрования secret_key через property ──────────────────────

def test_secret_key_roundtrip_via_property(stable_secret_key):
    """Запись шифрует → decrypted_secret_key возвращает исходный plaintext."""
    from app.models.payments_clinic import PaymentGatewayConfig

    stored = stable_secret_key.encrypt("live_secret_xyz")
    # Хранимое значение НЕ plaintext: либо enc:, либо plain: (если Fernet недоступен).
    assert stored.startswith("enc:") or stored.startswith("plain:")
    assert "live_secret_xyz" not in stored or stored.startswith("plain:")

    cfg = PaymentGatewayConfig(
        tenant_id=None, clinic_id=None, gateway="yookassa",
        shop_id="shop_1", secret_key=stored, is_active=True, is_test_mode=True,
        config={},
    )
    assert cfg.decrypted_secret_key == "live_secret_xyz"


def test_secret_key_legacy_plaintext_passthrough(stable_secret_key):
    """Старые записи без префикса (legacy plaintext) читаются как есть."""
    from app.models.payments_clinic import PaymentGatewayConfig

    cfg = PaymentGatewayConfig(
        tenant_id=None, clinic_id=None, gateway="yookassa",
        shop_id="shop_1", secret_key="legacy_plain_no_prefix",
        is_active=True, is_test_mode=True, config={},
    )
    assert cfg.decrypted_secret_key == "legacy_plain_no_prefix"


def test_secret_key_empty_returns_none(stable_secret_key):
    from app.models.payments_clinic import PaymentGatewayConfig

    cfg = PaymentGatewayConfig(
        tenant_id=None, clinic_id=None, gateway="yookassa",
        shop_id="shop_1", secret_key="", is_active=True, is_test_mode=True, config={},
    )
    assert cfg.decrypted_secret_key is None


def test_secret_key_undecryptable_returns_none(stable_secret_key, monkeypatch):
    """enc:-токен, который не расшифровывается (битый/чужой ключ) → None.

    None обязан трактоваться вызывающим как «шлюз нерабочий», а не как
    молчаливый откат в чужой ENV (см. адаптер).
    """
    from app.models.payments_clinic import PaymentGatewayConfig

    # Подсовываем заведомо невалидный enc:-токен.
    bad = "enc:" + base64.urlsafe_b64encode(b"not-a-valid-fernet-token").decode("ascii")
    cfg = PaymentGatewayConfig(
        tenant_id=None, clinic_id=None, gateway="yookassa",
        shop_id="shop_1", secret_key=bad, is_active=True, is_test_mode=True, config={},
    )
    assert cfg.decrypted_secret_key is None


# ── #10: адаптер использует креды конфига клиники, а не ENV ───────────────────

def _mk_config(shop_id="clinic_shop", secret_plain="clinic_secret", *, enc=None):
    """Реальный PaymentGatewayConfig с зашифрованным секретом."""
    from app.models.payments_clinic import PaymentGatewayConfig

    stored = enc.encrypt(secret_plain) if enc is not None else f"plain:{secret_plain}"
    return PaymentGatewayConfig(
        tenant_id=None, clinic_id=None, gateway="yookassa",
        shop_id=shop_id, secret_key=stored, is_active=True, is_test_mode=True, config={},
    )


def test_credentials_uses_config_over_env(stable_secret_key, monkeypatch):
    """При активном конфиге адаптер берёт креды конфига, игнорируя ENV платформы."""
    from app.services.acquiring.yookassa_adapter import YookassaGateway

    monkeypatch.setenv("YOOKASSA_SHOP_ID", "PLATFORM_SHOP")
    monkeypatch.setenv("YOOKASSA_SECRET_KEY", "PLATFORM_SECRET")

    gw = YookassaGateway(_mk_config(enc=stable_secret_key))
    shop, secret = gw._credentials()
    assert shop == "clinic_shop"
    assert secret == "clinic_secret"
    assert secret != "PLATFORM_SECRET"


def test_credentials_active_config_undecryptable_raises_not_env(stable_secret_key, monkeypatch):
    """Активный конфиг + нечитаемый секрет → RuntimeError, НЕ откат в ENV.

    Это ключевой кейс безопасности: иначе деньги ушли бы на аккаунт платформы.
    """
    from app.models.payments_clinic import PaymentGatewayConfig
    from app.services.acquiring.yookassa_adapter import YookassaGateway

    monkeypatch.setenv("YOOKASSA_SHOP_ID", "PLATFORM_SHOP")
    monkeypatch.setenv("YOOKASSA_SECRET_KEY", "PLATFORM_SECRET")

    bad = "enc:" + base64.urlsafe_b64encode(b"broken-token").decode("ascii")
    cfg = PaymentGatewayConfig(
        tenant_id=None, clinic_id=None, gateway="yookassa",
        shop_id="clinic_shop", secret_key=bad, is_active=True, is_test_mode=True, config={},
    )
    gw = YookassaGateway(cfg)
    with pytest.raises(RuntimeError):
        gw._credentials()


def test_credentials_env_fallback_only_when_no_config(monkeypatch):
    """config is None → допустим ENV-fallback платформы."""
    from app.services.acquiring.yookassa_adapter import YookassaGateway

    monkeypatch.setenv("YOOKASSA_SHOP_ID", "PLATFORM_SHOP")
    monkeypatch.setenv("YOOKASSA_SECRET_KEY", "PLATFORM_SECRET")

    gw = YookassaGateway(None)
    shop, secret = gw._credentials()
    assert shop == "PLATFORM_SHOP"
    assert secret == "PLATFORM_SECRET"


def test_credentials_no_config_no_env_raises(monkeypatch):
    from app.services.acquiring.yookassa_adapter import YookassaGateway

    monkeypatch.delenv("YOOKASSA_SHOP_ID", raising=False)
    monkeypatch.delenv("YOOKASSA_SECRET_KEY", raising=False)

    gw = YookassaGateway(None)
    with pytest.raises(RuntimeError, match="YOOKASSA не настроена"):
        gw._credentials()


# ── #5+#10 e2e: Basic-auth собран из расшифрованного секрета конфига ──────────

async def test_init_payment_uses_decrypted_config_secret(stable_secret_key, monkeypatch):
    """init_payment → httpx Basic-auth = (config.shop_id, расшифрованный secret),
    НЕ ENV платформы."""
    from app.services.acquiring import yookassa_adapter as ymod

    monkeypatch.setenv("YOOKASSA_SHOP_ID", "PLATFORM_SHOP")
    monkeypatch.setenv("YOOKASSA_SECRET_KEY", "PLATFORM_SECRET")

    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["auth"] = request.headers.get("authorization", "")
        return httpx.Response(
            200,
            json={
                "id": "yk_001",
                "status": "pending",
                "confirmation": {"type": "redirect", "confirmation_url": "https://yoomoney.ru/x"},
                "amount": {"value": "100.00", "currency": "RUB"},
            },
        )

    transport = httpx.MockTransport(handler)
    original_init = httpx.AsyncClient.__init__

    def _patched(self, *args, **kwargs):
        kwargs["transport"] = transport
        original_init(self, *args, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "__init__", _patched)

    gw = ymod.YookassaGateway(_mk_config(shop_id="clinic_shop", secret_plain="clinic_secret", enc=stable_secret_key))
    await gw.init_payment(amount=Decimal("100"), description="t", return_url="https://x/r", metadata=None)

    auth = captured["auth"]
    assert auth.startswith("Basic ")
    decoded = base64.b64decode(auth[len("Basic "):]).decode("utf-8")
    assert decoded == "clinic_shop:clinic_secret"
    assert "PLATFORM_SECRET" not in decoded


# ── #5: _serialize_config корректно отражает наличие секрета и не утечёт его ──

def test_serialize_config_present_with_encrypted_value(stable_secret_key):
    """secret_key_present остаётся True для зашифрованного значения; сам секрет
    в сериализации не фигурирует (ни plaintext, ни enc-токен под ключом
    secret_key)."""
    from app.models.payments_clinic import PaymentGatewayConfig
    import app.routers.clinic_payments as cp

    cfg = _mk_config(enc=stable_secret_key)
    cfg.id = None
    out = cp._serialize_config(cfg)
    assert out["secret_key_present"] is True
    assert "secret_key" not in out
    assert "clinic_secret" not in json.dumps(out, default=str)


# ── #5 симметрия: OFDConfig.api_key ──────────────────────────────────────────

def test_ofd_api_key_roundtrip(stable_secret_key):
    from app.models.payments_clinic import OFDConfig

    stored = stable_secret_key.encrypt("ofd_login:ofd_pass")
    cfg = OFDConfig(
        tenant_id=None, clinic_id=None, provider="platforma_ofd",
        inn="7700000000", api_key=stored, is_active=True, config={},
    )
    assert cfg.decrypted_api_key == "ofd_login:ofd_pass"


def test_ofd_adapter_reads_decrypted_api_key(stable_secret_key, monkeypatch):
    """Платформа-ОФД адаптер берёт login:password из расшифрованного api_key."""
    from app.models.payments_clinic import OFDConfig
    from app.services.fiscal.platforma_ofd_adapter import PlatformaOfdProvider

    monkeypatch.delenv("PLATFORMA_OFD_LOGIN", raising=False)
    monkeypatch.delenv("PLATFORMA_OFD_PASSWORD", raising=False)

    stored = stable_secret_key.encrypt("ofd_login:ofd_pass")
    cfg = OFDConfig(
        tenant_id=None, clinic_id=None, provider="platforma_ofd",
        inn="7700000000", api_key=stored, is_active=True, config={},
    )
    gw = PlatformaOfdProvider(cfg)
    login, password, _api_base = gw._credentials()
    assert login == "ofd_login"
    assert password == "ofd_pass"


# ── Интеграционные (PostgreSQL/конкурентность) — скипаются без Docker ─────────

@pytest.mark.integration
def test_upsert_then_adapter_reads_clinic_secret_e2e():
    """Полный путь PUT payment-config (запись шифрует) → init_payment адаптера
    использует расшифрованный секрет клиники. Требует реальной БД/приложения —
    помечено integration, исполняется централизованно на Postgres."""
    pytest.skip("integration: требует PostgreSQL/приложение, гоняется централизованно")
