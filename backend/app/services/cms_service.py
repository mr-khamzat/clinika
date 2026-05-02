from typing import Optional, List
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from app.models.cms import TenantCmsPage
import uuid


class CmsService:
    @staticmethod
    async def list_pages(db: AsyncSession, tenant_id: str, published_only: bool = True) -> List[TenantCmsPage]:
        q = select(TenantCmsPage).where(TenantCmsPage.tenant_id == tenant_id)
        if published_only:
            q = q.where(TenantCmsPage.is_published == True)
        q = q.order_by(TenantCmsPage.sort_order, TenantCmsPage.created_at)
        result = await db.execute(q)
        return result.scalars().all()

    @staticmethod
    async def get_page(db: AsyncSession, tenant_id: str, slug: str) -> Optional[TenantCmsPage]:
        result = await db.execute(
            select(TenantCmsPage).where(
                and_(TenantCmsPage.tenant_id == tenant_id, TenantCmsPage.slug == slug)
            )
        )
        return result.scalar_one_or_none()

    @staticmethod
    async def create_page(db: AsyncSession, tenant_id: str, user_id: str, data: dict) -> TenantCmsPage:
        page = TenantCmsPage(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            created_by_id=user_id,
            **{k: v for k, v in data.items() if k in [
                "slug", "title", "content_md", "content_blocks", "is_published",
                "page_type", "show_in_menu", "menu_title", "sort_order",
                "seo_title", "seo_description"
            ]}
        )
        db.add(page)
        await db.commit()
        await db.refresh(page)
        return page

    @staticmethod
    async def update_page(db: AsyncSession, page: TenantCmsPage, data: dict) -> TenantCmsPage:
        allowed = ["title", "content_md", "content_blocks", "is_published",
                   "page_type", "show_in_menu", "menu_title", "sort_order",
                   "seo_title", "seo_description", "slug"]
        for k, v in data.items():
            if k in allowed and v is not None:
                setattr(page, k, v)
        page.updated_at = datetime.utcnow()
        await db.commit()
        await db.refresh(page)
        return page

    @staticmethod
    async def delete_page(db: AsyncSession, page: TenantCmsPage):
        await db.delete(page)
        await db.commit()

    @staticmethod
    async def get_menu(db: AsyncSession, tenant_id: str) -> List[dict]:
        result = await db.execute(
            select(TenantCmsPage).where(
                and_(
                    TenantCmsPage.tenant_id == tenant_id,
                    TenantCmsPage.show_in_menu == True,
                    TenantCmsPage.is_published == True
                )
            ).order_by(TenantCmsPage.sort_order)
        )
        pages = result.scalars().all()
        return [{"slug": p.slug, "title": p.menu_title or p.title, "page_type": p.page_type} for p in pages]
