from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.tenant import TenantBranding

DEFAULT_THEME = {
    "primary_color": "#0097A7",
    "secondary_color": "#E0F7FA",
    "sidebar_color": "#004D5F",
    "bg_color": "#F0F5F6",
    "font_family": "Inter",
    "brand_name": "КлиникСеть",
    "logo_url": None,
    "favicon_url": None,
    "og_image_url": None,
    "footer_text": None,
    "support_phone": None,
    "support_email": None,
    "meta_title": None,
    "meta_description": None,
    "custom_domain": None,
    "domain_verified": False,
    "hide_menu_items": [],
    "rename_menu_items": {},
}


class ThemeService:
    @staticmethod
    async def get_theme(db: AsyncSession, tenant_id: Optional[str] = None) -> dict:
        if not tenant_id:
            return DEFAULT_THEME.copy()
        result = await db.execute(
            select(TenantBranding).where(TenantBranding.tenant_id == tenant_id)
        )
        b = result.scalar_one_or_none()
        if not b:
            return DEFAULT_THEME.copy()
        return {
            "primary_color": b.primary_color or DEFAULT_THEME["primary_color"],
            "secondary_color": getattr(b, "secondary_color", None) or DEFAULT_THEME["secondary_color"],
            "sidebar_color": b.sidebar_color or DEFAULT_THEME["sidebar_color"],
            "bg_color": b.bg_color or DEFAULT_THEME["bg_color"],
            "font_family": b.font_family or DEFAULT_THEME["font_family"],
            "brand_name": b.brand_name or DEFAULT_THEME["brand_name"],
            "logo_url": b.logo_url,
            "favicon_url": getattr(b, "favicon_url", None),
            "og_image_url": getattr(b, "og_image_url", None),
            "footer_text": getattr(b, "footer_text", None),
            "support_phone": getattr(b, "support_phone", None),
            "support_email": getattr(b, "support_email", None),
            "meta_title": getattr(b, "meta_title", None),
            "meta_description": getattr(b, "meta_description", None),
            "custom_domain": getattr(b, "custom_domain", None),
            "domain_verified": getattr(b, "domain_verified", False) or False,
            "hide_menu_items": getattr(b, "hide_menu_items", []) or [],
            "rename_menu_items": getattr(b, "rename_menu_items", {}) or {},
        }

    @staticmethod
    def to_css_variables(theme: dict) -> str:
        return (
            f":root{{"
            f"--color-primary:{theme[primary_color]};"
            f"--color-secondary:{theme[secondary_color]};"
            f"--color-sidebar:{theme[sidebar_color]};"
            f"--color-bg:{theme[bg_color]};"
            f"--font-family:{theme[font_family]},sans-serif;"
            f"}}"
        )
