"""
Точечные unit-тесты для пакета находок аудита «routers» (medium/low/info).

Покрываются нетривиальные кодовые правки:

  • idx 28 (commercial.py): SSRF-guard `_validate_integration_url` — только https
    и публичные адреса; loopback/private/link-local/metadata отклоняются. Плюс
    проверяем, что TLS-проверка в `_do_test` больше НЕ отключена (нет verify=False).

  • idx 33 (support.py): набор ролей операторов поддержки, которым разрешено
    скачивать любые support-файлы, не пуст и содержит только admin-роли
    (остальные пользователи проходят через IDOR-проверку владельца).

  • idx 41 (auth.py): расход инвайта выполнен атомарным UPDATE ... WHERE
    uses_count < max_uses (а не in-memory check-then-increment) — проверяем по
    исходнику, что гонка закрыта на уровне БД.

Тесты не требуют Postgres/Docker: SSRF-функция чистая (резолв DNS мокаем),
остальное — инспекция исходников/констант.

Запуск: pytest backend/tests/test_ml_routers.py -v
"""
from __future__ import annotations

import inspect
import socket

import pytest

pytestmark = pytest.mark.unit


# ─────────────────────────────────────────────────────────────────────────────
# idx 28 — SSRF-guard в commercial._validate_integration_url
# ─────────────────────────────────────────────────────────────────────────────

def _make_addrinfo(ip: str):
    """Минимальный getaddrinfo-результат для одного IPv4-адреса."""
    return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (ip, 443))]


@pytest.mark.parametrize("bad_url", [
    "http://example.com",                  # не https
    "ftp://example.com",                   # не https
    "https://",                            # нет хоста
    "",                                    # пусто
])
def test_validate_integration_url_rejects_non_https(bad_url):
    from app.routers.commercial import _validate_integration_url
    with pytest.raises(ValueError):
        _validate_integration_url(bad_url)


@pytest.mark.parametrize("ip", [
    "127.0.0.1",        # loopback
    "10.0.0.5",         # private A
    "192.168.1.10",     # private C
    "172.16.0.1",       # private B
    "169.254.169.254",  # link-local (cloud metadata)
    "0.0.0.0",          # unspecified
])
def test_validate_integration_url_blocks_internal_targets(ip, monkeypatch):
    from app.routers import commercial
    monkeypatch.setattr(commercial.socket, "getaddrinfo",
                        lambda *a, **k: _make_addrinfo(ip))
    with pytest.raises(ValueError):
        commercial._validate_integration_url("https://attacker.example/cb")


def test_validate_integration_url_allows_public_https(monkeypatch):
    from app.routers import commercial
    monkeypatch.setattr(commercial.socket, "getaddrinfo",
                        lambda *a, **k: _make_addrinfo("93.184.216.34"))  # example.com
    out = commercial._validate_integration_url("https://example.com/api")
    assert out == "https://example.com/api"


def test_validate_integration_url_handles_dns_failure(monkeypatch):
    from app.routers import commercial

    def _boom(*a, **k):
        raise socket.gaierror("no such host")

    monkeypatch.setattr(commercial.socket, "getaddrinfo", _boom)
    with pytest.raises(ValueError):
        commercial._validate_integration_url("https://nonexistent.invalid/x")


def test_do_test_does_not_disable_tls_verification():
    """verify=False удалён: API-ключ не должен уходить по непроверенному TLS."""
    from app.routers import commercial
    src = inspect.getsource(commercial._do_test)
    assert "verify=False" not in src
    # И сам guard вызывается перед запросом.
    assert "_validate_integration_url" in src


# ─────────────────────────────────────────────────────────────────────────────
# idx 33 — операторы поддержки в support.serve_file
# ─────────────────────────────────────────────────────────────────────────────

def test_support_operator_roles_are_admin_only():
    from app.routers.support import _SUPPORT_OPERATOR_ROLES
    from app.models.user import UserRole
    roles = set(_SUPPORT_OPERATOR_ROLES)
    assert UserRole.MANAGER in roles
    assert UserRole.SUPER_ADMIN in roles
    assert UserRole.FRANCHISE_OWNER in roles
    # Обычные пользователи (регистратор, врач-партнёр, пациент) НЕ операторы —
    # они должны проходить проверку владельца файла.
    assert UserRole.REG not in roles


def test_serve_file_enforces_ownership_or_operator():
    """В serve_file есть ветка IDOR-проверки по владельцу SupportMessage."""
    from app.routers import support
    src = inspect.getsource(support.serve_file)
    assert "_SUPPORT_OPERATOR_ROLES" in src
    assert "SupportMessage.user_id == current_user.id" in src


# ─────────────────────────────────────────────────────────────────────────────
# idx 41 — атомарный расход инвайта в auth.register_by_invite
# ─────────────────────────────────────────────────────────────────────────────

def test_register_invite_uses_atomic_conditional_update():
    """Гонка check-then-increment закрыта атомарным UPDATE с условием по лимиту."""
    from app.routers import auth
    src = inspect.getsource(auth.register_by_invite)
    # Должен быть условный апдейт по uses_count < max_uses и проверка rowcount,
    # а НЕ голый in-memory инкремент invite.uses_count += 1 как единственный путь.
    assert "Invitation.uses_count < Invitation.max_uses" in src
    assert "rowcount" in src
