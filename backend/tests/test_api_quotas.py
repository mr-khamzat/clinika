"""Тесты роутера /admin/quotas и middleware RateLimitMiddleware.

Все тесты — unit-уровня:
  - ``client`` + ``mock_db`` для эндпоинтов;
  - ``app.dependency_overrides[require_super_admin]`` чтобы обойти JWT/HTTPBearer;
  - ``patch`` quota_service / БД-моки для бизнес-логики.

Тесты:
  test_set_quota_super_admin       — PUT под super_admin → 200, поля обновлены
  test_non_admin_cannot_modify     — PUT под обычным юзером → 403
  test_get_usage_empty             — GET /{id} когда нет usage → нули
  test_alerts_threshold            — usage 85% от лимита → tenant в /alerts
  test_reset_usage                 — POST /reset вызывает quota_service.reset_usage
  test_rate_lim                    — middleware возвращает 429 при превышении RPM
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

pytestmark = pytest.mark.asyncio


# ── Хелперы ──────────────────────────────────────────────────────────────────


def _fake_super_admin():
    from app.models.user import User, UserRole
    u = MagicMock(spec=User)
    u.id = uuid.uuid4()
    u.role = UserRole.SUPER_ADMIN
    u.username = "supertest"
    u.tenant_id = uuid.uuid4()
    u.is_active = True
    return u


def _fake_regular_user():
    from app.models.user import User, UserRole
    u = MagicMock(spec=User)
    u.id = uuid.uuid4()
    u.role = UserRole.MANAGER
    u.username = "manager1"
    u.tenant_id = uuid.uuid4()
    u.is_active = True
    return u


def _make_quota(tenant_id):
    from app.models.api_quota import TenantQuota
    q = MagicMock(spec=TenantQuota)
    q.id = uuid.uuid4()
    q.tenant_id = tenant_id
    q.requests_per_minute = 6000
    q.requests_per_day = 100_000
    q.storage_mb_limit = 5000
    q.users_limit = 50
    q.calls_minutes_per_month = 1000
    q.plan_default = True
    q.created_at = datetime.utcnow()
    q.updated_at = datetime.utcnow()
    return q


def _make_tenant(tenant_id, name="Test Clinic"):
    from app.models.tenant import Tenant
    t = MagicMock(spec=Tenant)
    t.id = tenant_id
    t.name = name
    return t


def _make_usage(tenant_id, period=None, requests_count=0, storage_mb_used=0, calls_minutes_used=0):
    from app.models.api_quota import QuotaUsage
    u = MagicMock(spec=QuotaUsage)
    u.id = uuid.uuid4()
    u.tenant_id = tenant_id
    u.period = period or date.today()
    u.requests_count = requests_count
    u.storage_mb_used = storage_mb_used
    u.calls_minutes_used = calls_minutes_used
    u.last_updated = datetime.utcnow()
    return u


# ── 1. PUT /admin/quotas/{id} под super_admin → 200 ──────────────────────────


async def test_set_quota_super_admin(client, mock_db):
    """super_admin может изменять квоты конкретного tenant."""
    from app.main import app
    from app.core.deps import require_super_admin
    from app.routers import admin_api_quotas as mod
    from app.services import quota_service as qs

    tid = uuid.uuid4()

    app.dependency_overrides[require_super_admin] = lambda: _fake_super_admin()

    # Tenant.exists check + get_quota → mock-quota.
    tenant = _make_tenant(tid)
    quota = _make_quota(tid)

    # Первый execute (проверка tenant) → tenant, дальше get_quota делает свой select.
    tenant_res = MagicMock()
    tenant_res.scalar_one_or_none.return_value = tenant
    mock_db.execute = AsyncMock(return_value=tenant_res)

    async def fake_get_quota(db, t_id):
        return quota

    with patch.object(qs, "get_quota", new=fake_get_quota):
        try:
            r = await client.put(
                f"/admin/quotas/{tid}",
                json={
                    "requests_per_minute": 12000,
                    "users_limit": 100,
                },
            )
        finally:
            app.dependency_overrides.pop(require_super_admin, None)

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["requests_per_minute"] == 12000
    assert body["users_limit"] == 100
    # Любая правка автоматически сбрасывает plan_default=False (если не передан).
    assert body["plan_default"] is False
    # Поля действительно записаны на mock-объект.
    assert quota.requests_per_minute == 12000
    assert quota.users_limit == 100
    mock_db.commit.assert_awaited()


# ── 2. PUT под не-super_admin → 403 ──────────────────────────────────────────


async def test_non_admin_cannot_modify(client, mock_db):
    """Менеджер не может править квоты — require_super_admin отвечает 403.

    Подменяем get_current_user (require_super_admin вызовет его внутри).
    """
    from app.main import app
    from app.core.deps import get_current_user

    app.dependency_overrides[get_current_user] = lambda: _fake_regular_user()
    try:
        r = await client.put(
            f"/admin/quotas/{uuid.uuid4()}",
            json={"requests_per_minute": 1},
        )
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    assert r.status_code == 403, r.text


# ── 3. GET /{id} когда usage пустой → нули ───────────────────────────────────


async def test_get_usage_empty(client, mock_db):
    """Детали квоты для tenant без usage → today_usage и history пустые."""
    from app.main import app
    from app.core.deps import require_super_admin
    from app.services import quota_service as qs

    tid = uuid.uuid4()
    app.dependency_overrides[require_super_admin] = lambda: _fake_super_admin()

    tenant = _make_tenant(tid)
    quota = _make_quota(tid)
    today_usage = _make_usage(tid, requests_count=0, storage_mb_used=0, calls_minutes_used=0)

    tenant_res = MagicMock()
    tenant_res.scalar_one_or_none.return_value = tenant
    mock_db.execute = AsyncMock(return_value=tenant_res)

    async def fake_get_quota(db, t_id):
        return quota

    async def fake_get_usage(db, t_id, period=None):
        return today_usage

    async def fake_list_history(db, t_id, days=30):
        return []

    with patch.object(qs, "get_quota", new=fake_get_quota), \
         patch.object(qs, "get_usage", new=fake_get_usage), \
         patch.object(qs, "list_history", new=fake_list_history):
        try:
            r = await client.get(f"/admin/quotas/{tid}")
        finally:
            app.dependency_overrides.pop(require_super_admin, None)

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["quota"]["requests_per_minute"] == 6000
    assert body["today_usage"]["requests_count"] == 0
    assert body["today_usage"]["storage_mb_used"] == 0
    assert body["today_usage"]["calls_minutes_used"] == 0
    assert body["history"] == []


# ── 4. /alerts: tenant с usage 85% от лимита попадает в выдачу ──────────────


async def test_alerts_threshold(client, mock_db):
    """85% от requests_per_day → tenant виден в /admin/quotas/alerts."""
    from app.main import app
    from app.core.deps import require_super_admin

    tid = uuid.uuid4()
    tenant = _make_tenant(tid, name="Hot Clinic")
    quota = _make_quota(tid)
    quota.requests_per_day = 1000  # сделаем низкий лимит для теста
    # 850 / 1000 = 85% — выше 80%-порога
    usage = _make_usage(tid, requests_count=850)

    # Эмулируем 4 .execute() вызова в list_alerts:
    #   (1) select Tenant      → [tenant]
    #   (2) select TenantQuota → [quota]
    #   (3) select QuotaUsage сегодняшний → [usage]
    #   (4) sum(calls) за месяц → []
    tenants_res = MagicMock()
    tenants_res.scalars.return_value.all.return_value = [tenant]

    quotas_res = MagicMock()
    quotas_res.scalars.return_value.all.return_value = [quota]

    usage_res = MagicMock()
    usage_res.scalars.return_value.all.return_value = [usage]

    calls_res = MagicMock()
    calls_res.all.return_value = []

    mock_db.execute = AsyncMock(side_effect=[tenants_res, quotas_res, usage_res, calls_res])

    app.dependency_overrides[require_super_admin] = lambda: _fake_super_admin()
    try:
        r = await client.get("/admin/quotas/alerts")
    finally:
        app.dependency_overrides.pop(require_super_admin, None)

    assert r.status_code == 200, r.text
    rows = r.json()
    # Должна быть хотя бы одна строка про requests_per_day с >=80%.
    matched = [row for row in rows if row["metric"] == "requests_per_day" and row["tenant_id"] == str(tid)]
    assert matched, f"Ожидали алерт по requests_per_day, получили {rows}"
    assert matched[0]["percent"] >= 80
    assert matched[0]["usage"] == 850
    assert matched[0]["limit"] == 1000


# ── 5. POST /reset — вызывает quota_service.reset_usage и возвращает 200 ────


async def test_reset_usage(client, mock_db):
    """POST /admin/quotas/{id}/reset вызывает quota_service.reset_usage."""
    from app.main import app
    from app.core.deps import require_super_admin
    from app.routers import admin_api_quotas as mod
    from app.services import quota_service as qs

    tid = uuid.uuid4()
    tenant = _make_tenant(tid)

    tenant_res = MagicMock()
    tenant_res.scalar_one_or_none.return_value = tenant
    mock_db.execute = AsyncMock(return_value=tenant_res)

    called = {"count": 0}

    async def fake_reset(db, redis, t_id):
        called["count"] += 1
        assert t_id == tid

    # Чтобы не пытаться реально подключиться к Redis, мокаем from_url.
    fake_redis = AsyncMock()
    fake_redis.close = AsyncMock()

    app.dependency_overrides[require_super_admin] = lambda: _fake_super_admin()
    with patch.object(qs, "reset_usage", new=fake_reset), \
         patch("app.routers.admin_api_quotas.aioredis") as mod_redis:
        mod_redis.from_url.return_value = fake_redis
        try:
            r = await client.post(f"/admin/quotas/{tid}/reset")
        finally:
            app.dependency_overrides.pop(require_super_admin, None)

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["tenant_id"] == str(tid)
    assert called["count"] == 1


# ── 6. RateLimitMiddleware: 429 при превышении RPM ──────────────────────────


async def test_rate_lim():
    """Прямой unit-тест middleware: имитируем превышение лимита и ждём 429."""
    from app.core import rate_limit_middleware as rlm
    from app.services import quota_service as qs

    tid = uuid.uuid4()

    # Чтобы middleware определил tenant_id, патчим _resolve_tenant_id.
    async def fake_resolve(request, redis):
        return tid

    # Подменяем check_rpm → возвращаем (False, current, retry_after).
    async def fake_check_rpm(redis, t_id, limit):
        assert t_id == tid
        return (False, limit + 1, 42)

    # Не ходим в БД за лимитом — кешируем заранее.
    rlm.invalidate_quota_cache()
    rlm._QUOTA_CACHE[str(tid)] = (10, 10**12)  # huge TTL

    # Фейковый Redis — должен возвращаться from _get_redis.
    fake_redis = AsyncMock()

    mw = rlm.RateLimitMiddleware(app=None, enabled=True)
    mw._redis = fake_redis  # минуя _get_redis

    # Имитируем Starlette Request.
    from starlette.requests import Request as StarRequest
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/api/some-endpoint",
        "raw_path": b"/api/some-endpoint",
        "headers": [(b"authorization", b"Bearer fake.jwt.token")],
        "query_string": b"",
        "scheme": "http",
        "server": ("test", 80),
        "client": ("1.2.3.4", 1234),
    }
    request = StarRequest(scope)

    async def call_next(req):  # не должен быть вызван
        raise AssertionError("call_next должен НЕ вызываться при 429")

    with patch.object(rlm, "_resolve_tenant_id", new=fake_resolve), \
         patch.object(qs, "check_rpm", new=fake_check_rpm):
        resp = await mw.dispatch(request, call_next)

    assert resp.status_code == 429
    assert resp.headers.get("Retry-After") == "42"
    body = resp.body.decode()
    assert "Превышен лимит" in body
    assert "\"retry_after\":42" in body or "retry_after" in body

    rlm.invalidate_quota_cache()
