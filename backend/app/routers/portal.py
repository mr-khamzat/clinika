"""
Patient Portal — теперь только PWA-манифест для /{slug}/p.
SMS/OTP/универсальный вход и парольная логика убраны: вход в кабинет идёт по короткому коду
направления на `/patient/by-code` + long-lived session-token (см. routers/patient.py).
"""
from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db


router = APIRouter(prefix="/portal", tags=["patient-portal"])


@router.get("/manifest.json", include_in_schema=False)
async def portal_manifest(
    slug: str = Query(""),
    s: str = Query("", description="session_token to embed into start_url"),
    db: AsyncSession = Depends(get_db),
):
    name = "Личный кабинет"
    theme_color = "#0097A7"
    if slug:
        try:
            from sqlalchemy import text as _text
            row = (await db.execute(
                _text("SELECT t.name, b.brand_name, b.primary_color FROM tenants t "
                      "LEFT JOIN tenant_branding b ON b.tenant_id = t.id "
                      "WHERE t.slug = :slug AND t.is_active = true LIMIT 1"),
                {"slug": slug}
            )).fetchone()
            if row:
                name = row.brand_name or row.name or name
                theme_color = row.primary_color or theme_color
        except Exception:
            pass
    short_name = name[:12] if len(name) > 12 else name
    if slug:
        start_url = f"/{slug}/p?s={s}" if s else f"/{slug}/p"
    else:
        start_url = "/"
    manifest = {
        "name": name,
        "short_name": short_name,
        "description": "Личный кабинет пациента",
        "start_url": start_url,
        "scope": f"/{slug}/" if slug else "/",
        "display": "standalone",
        "background_color": "#F0F4F8",
        "theme_color": theme_color,
        "orientation": "portrait-primary",
    }
    return JSONResponse(content=manifest, headers={
        "Content-Type": "application/manifest+json",
        "Cache-Control": "no-cache",
    })
