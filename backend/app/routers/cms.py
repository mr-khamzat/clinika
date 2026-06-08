from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from app.database import get_db
from app.core.tenant import get_current_tenant, require_module
from sqlalchemy import select
from app.models.tenant import Tenant
from app.services.cms_service import CmsService
from app.services.theme_service import ThemeService
from app.core.deps import get_current_user, get_tenant_db
from app.models.user import User

router = APIRouter(prefix="/cms", tags=["cms"])


class PageCreate(BaseModel):
    slug: str
    title: str
    content_md: Optional[str] = None
    content_blocks: Optional[list] = []
    is_published: bool = True
    page_type: str = "info"
    show_in_menu: bool = False
    menu_title: Optional[str] = None
    sort_order: int = 0
    seo_title: Optional[str] = None
    seo_description: Optional[str] = None


class PageUpdate(BaseModel):
    slug: Optional[str] = None
    title: Optional[str] = None
    content_md: Optional[str] = None
    content_blocks: Optional[list] = None
    is_published: Optional[bool] = None
    page_type: Optional[str] = None
    show_in_menu: Optional[bool] = None
    menu_title: Optional[str] = None
    sort_order: Optional[int] = None
    seo_title: Optional[str] = None
    seo_description: Optional[str] = None


async def _resolve_tenant_optional(slug: Optional[str], db: AsyncSession):
    """Public-эндпоинт: тенант берётся из ?slug=, иначе None (default)."""
    if not slug:
        return None
    r = await db.execute(select(Tenant).where(Tenant.slug == slug))
    return r.scalar_one_or_none()


@router.get("/theme")
async def get_theme(
    slug: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    tenant = await _resolve_tenant_optional(slug, db)
    return await ThemeService.get_theme(db, str(tenant.id) if tenant else None)


@router.get("/theme/css")
async def get_theme_css(
    slug: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    from fastapi.responses import Response
    tenant = await _resolve_tenant_optional(slug, db)
    theme = await ThemeService.get_theme(db, str(tenant.id) if tenant else None)
    css = ThemeService.to_css_variables(theme)
    return Response(content=css, media_type="text/css")


@router.get("/menu")
async def get_cms_menu(
    db: AsyncSession = Depends(get_tenant_db),
    tenant=Depends(get_current_tenant),
):
    if not tenant:
        return []
    return await CmsService.get_menu(db, str(tenant.id))


@router.get("/pages")
async def list_pages(
    all: bool = False,
    db: AsyncSession = Depends(get_tenant_db),
    tenant=Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
):
    if not tenant:
        return []
    published_only = not all or current_user.role not in ("reg", "super_admin", "manager")
    return await CmsService.list_pages(db, str(tenant.id), published_only=published_only)


@router.get("/pages/{slug}")
async def get_page(
    slug: str,
    db: AsyncSession = Depends(get_tenant_db),
    tenant=Depends(get_current_tenant),
):
    if not tenant:
        raise HTTPException(404)
    page = await CmsService.get_page(db, str(tenant.id), slug)
    if not page:
        raise HTTPException(404, "Page not found")
    return page


@router.post("/pages", dependencies=[Depends(require_module("white_label"))])
async def create_page(
    data: PageCreate,
    db: AsyncSession = Depends(get_tenant_db),
    tenant=Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
):
    if not tenant:
        raise HTTPException(403)
    if current_user.role not in ("reg", "super_admin", "manager"):
        raise HTTPException(403, "Insufficient role")
    return await CmsService.create_page(db, str(tenant.id), str(current_user.id), data.dict())


@router.put("/pages/{slug}", dependencies=[Depends(require_module("white_label"))])
async def update_page(
    slug: str,
    data: PageUpdate,
    db: AsyncSession = Depends(get_tenant_db),
    tenant=Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
):
    if not tenant:
        raise HTTPException(403)
    if current_user.role not in ("reg", "super_admin", "manager"):
        raise HTTPException(403, "Insufficient role")
    page = await CmsService.get_page(db, str(tenant.id), slug)
    if not page:
        raise HTTPException(404)
    return await CmsService.update_page(db, page, data.dict(exclude_unset=True))


@router.delete("/pages/{slug}", dependencies=[Depends(require_module("white_label"))])
async def delete_page(
    slug: str,
    db: AsyncSession = Depends(get_tenant_db),
    tenant=Depends(get_current_tenant),
    current_user: User = Depends(get_current_user),
):
    if not tenant:
        raise HTTPException(403)
    if current_user.role not in ("reg", "super_admin", "manager"):
        raise HTTPException(403, "Insufficient role")
    page = await CmsService.get_page(db, str(tenant.id), slug)
    if not page:
        raise HTTPException(404)
    await CmsService.delete_page(db, page)
    return {"ok": True}
