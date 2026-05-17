"""
CNAME Domain Router Middleware.
Если Host заголовок не совпадает с основным доменом платформы,
ищет тенант по custom_domain и подставляет tenant_slug в путь,
чтобы SPA мог работать на кастомном домене прозрачно.

Также предоставляет эндпоинт верификации /.well-known/clinika-domain/{token}.
"""
import re
from typing import Optional
from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

# Основные домены платформы (не требуют lookup)
_PLATFORM_HOSTS = {
    "xn--e1afagcdp8ak4h.xn--p1ai",
    "клиниксеть.рф",
    "localhost",
    "127.0.0.1",
    "212.57.118.126",
}

router = APIRouter(tags=["domain"])


# ── Verification endpoint ─────────────────────────────────────────────────────

@router.get("/.well-known/clinika-domain/{tenant_id}")
async def domain_challenge(tenant_id: str):
    """
    Верификация владения доменом.
    Возвращает challenge-токен тенанта если домен ему принадлежит.
    """
    import uuid
    from app.database import AsyncSessionLocal
    from app.models.tenant import TenantBranding
    from sqlalchemy import select
    try:
        tid = uuid.UUID(tenant_id)
    except ValueError:
        raise HTTPException(404, "Not found")
    async with AsyncSessionLocal() as db:
        b = (await db.execute(
            select(TenantBranding).where(TenantBranding.tenant_id == tid)
        )).scalar_one_or_none()
    if not b or not b.custom_domain:
        raise HTTPException(404, "No custom domain configured")
    token = f"clinika-domain-{tenant_id}"
    return PlainTextResponse(token)


# ── Mark domain as verified ───────────────────────────────────────────────────

@router.post("/.well-known/clinika-domain/{tenant_id}/verify")
async def verify_domain(tenant_id: str):
    """
    Проверяет что challenge-токен доступен по custom_domain тенанта.
    Если OK — выставляет domain_verified=True.
    """
    import uuid, httpx
    from app.database import AsyncSessionLocal
    from app.models.tenant import TenantBranding
    from sqlalchemy import select
    try:
        tid = uuid.UUID(tenant_id)
    except ValueError:
        raise HTTPException(404, "Not found")
    async with AsyncSessionLocal() as db:
        b = (await db.execute(
            select(TenantBranding).where(TenantBranding.tenant_id == tid)
        )).scalar_one_or_none()
        if not b or not b.custom_domain:
            raise HTTPException(400, "custom_domain не задан")
        expected = f"clinika-domain-{tenant_id}"
        url = f"http://{b.custom_domain}/.well-known/clinika-domain/{tenant_id}"
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(url)
            if r.status_code == 200 and r.text.strip() == expected:
                b.domain_verified = True
                await db.commit()
                return {"verified": True, "domain": b.custom_domain}
            else:
                return {"verified": False, "error": f"Ожидали '{expected}', получили '{r.text[:100]}'"}
        except Exception as e:
            return {"verified": False, "error": str(e)}


# ── Middleware ────────────────────────────────────────────────────────────────

class DomainRouterMiddleware(BaseHTTPMiddleware):
    """
    Резолвит тенант по Host заголовку для кастомных CNAME доменов.
    Сохраняет найденный tenant_slug в request.state.custom_domain_slug.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        host = request.headers.get("host", "").split(":")[0].lower()

        # Пропускаем платформенные домены
        if host in _PLATFORM_HOSTS or not host:
            return await call_next(request)

        # Пропускаем well-known — пусть обрабатывается роутером
        if request.url.path.startswith("/.well-known/clinika-domain"):
            return await call_next(request)

        # Ищем тенант по custom_domain
        try:
            from app.database import AsyncSessionLocal
            from app.models.tenant import Tenant, TenantBranding
            from sqlalchemy import select
            async with AsyncSessionLocal() as db:
                b = (await db.execute(
                    select(TenantBranding).where(
                        TenantBranding.custom_domain == host,
                        TenantBranding.domain_verified == True,
                    )
                )).scalar_one_or_none()
                if b:
                    tenant = await db.get(Tenant, b.tenant_id)
                    if tenant and tenant.slug:
                        request.state.custom_domain_slug = tenant.slug
        except Exception:
            pass

        return await call_next(request)
