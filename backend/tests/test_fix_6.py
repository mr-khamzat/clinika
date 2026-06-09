"""Fix #6 — /tenant/create fail-closed при пустом onboarding_secret.

Находка: эндпоинт POST /tenant/create был подключён без аутентификации, а
единственная защита `if expected and data.secret_key != expected` целиком
пропускалась при пустом (falsy по умолчанию) `onboarding_secret` → любой
аноним создавал tenant + admin (fail-open).

Фикс: добавлена зависимость `Depends(require_super_admin)` в сигнатуру
`create_tenant` (fail-closed). Секрет остаётся опциональным доп.фактором
(если задан — обязан совпадать), но больше не является единственной защитой.

Все тесты — unit (mock_db), без реального PostgreSQL.
"""
from __future__ import annotations

import inspect
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

pytestmark = pytest.mark.asyncio


_PAYLOAD = {
    "name": "Новая клиника",
    "slug": "new-clinic",
    "plan": "basic",
    "admin_name": "Админ",
    "admin_username": "admin@new.com",
    "admin_password": "Secret#123",
}


# ── 1. Аноним (без токена) больше не может создать тенанта ─────────────────
async def test_create_tenant_without_auth_is_rejected(client, mock_db):
    """POST /tenant/create без Authorization → 401/403 (раньше 201, fail-open).

    Ключевой кейс находки: пустой onboarding_secret НЕ должен открывать
    эндпоинт. Дополнительно проверяем, что онбординг-сервис не вызывался,
    т.е. тенант не создан.
    """
    with patch(
        "app.services.tenant_onboarding_service.onboard_tenant",
        new=AsyncMock(),
    ) as onboard:
        resp = await client.post("/tenant/create", json=_PAYLOAD)
    assert resp.status_code in (401, 403), resp.text
    onboard.assert_not_called()


# ── 2. Менеджер (не super_admin) получает 403 ─────────────────────────────
async def test_create_tenant_as_manager_forbidden(client, mock_db):
    """Manager-токен → 403: онбординг тенантов — операция владельца платформы."""
    from app.core.security import create_access_token
    from app.models.user import User, UserRole

    uid = uuid.uuid4()
    token = create_access_token(
        {"sub": str(uid), "role": "manager", "tid": str(uuid.uuid4())}
    )
    fake_user = MagicMock(spec=User)
    fake_user.id = uid
    fake_user.is_active = True
    fake_user.role = UserRole.MANAGER
    fake_user.username = "manager@test.com"

    user_result = MagicMock()
    user_result.scalar_one_or_none.return_value = fake_user
    mock_db.execute = AsyncMock(return_value=user_result)

    with patch(
        "app.services.tenant_onboarding_service.onboard_tenant",
        new=AsyncMock(),
    ) as onboard:
        resp = await client.post(
            "/tenant/create",
            json=_PAYLOAD,
            headers={"Authorization": f"Bearer {token}"},
        )
    assert resp.status_code == 403, resp.text
    onboard.assert_not_called()


# ── 3. super_admin успешно создаёт тенанта (позитив) ──────────────────────
async def test_create_tenant_as_super_admin_succeeds(client, mock_db):
    """super_admin-токен → 201, онбординг вызван."""
    from app.core.security import create_access_token
    from app.models.user import User, UserRole

    uid = uuid.uuid4()
    token = create_access_token(
        {"sub": str(uid), "role": "super_admin", "tid": None}
    )
    fake_user = MagicMock(spec=User)
    fake_user.id = uid
    fake_user.is_active = True
    fake_user.role = UserRole.SUPER_ADMIN
    fake_user.username = "root@platform"

    user_result = MagicMock()
    user_result.scalar_one_or_none.return_value = fake_user
    mock_db.execute = AsyncMock(return_value=user_result)

    onboard_return = {
        "tenant_id": str(uuid.uuid4()),
        "slug": "new-clinic",
        "admin_username": "admin@new.com",
        "admin_password": "Secret#123",
        "url": "https://new-clinic.example",
    }
    with patch(
        "app.services.tenant_onboarding_service.onboard_tenant",
        new=AsyncMock(return_value=onboard_return),
    ) as onboard:
        resp = await client.post(
            "/tenant/create",
            json=_PAYLOAD,
            headers={"Authorization": f"Bearer {token}"},
        )
    assert resp.status_code == 201, resp.text
    onboard.assert_awaited_once()


# ── 4. Статический инвариант: эндпоинт защищён require_super_admin ─────────
async def test_create_tenant_depends_on_require_super_admin():
    """Сигнатура create_tenant обязана содержать Depends(require_super_admin).

    Защита от случайного отката фикса: исходник эндпоинта должен ссылаться на
    require_super_admin, а не оставаться только с Depends(get_db).
    """
    from app.routers.tenant import create_tenant

    src = inspect.getsource(create_tenant)
    assert "require_super_admin" in src, (
        "/tenant/create обязан требовать аутентификацию super_admin (fail-closed)"
    )
