"""
Patient Portal — PWA-манифест для /{slug}/p.

Manifest принимает session_token (?s=) или patient_token (?t=). Если передан t=,
бекенд автоматически создаёт long-lived session и встраивает её в start_url.
Это критично для iOS Safari, который читает manifest **при первой загрузке** и
кеширует его — поэтому к моменту "Add to Home Screen" start_url должен уже
содержать сессионный токен.
"""
import uuid
from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.referral import Referral
from app.core.security import decode_patient_token, verify_patient_token
from app.services.patient_session_service import create_session as _create_session


router = APIRouter(prefix="/portal", tags=["patient-portal"])


async def _session_from_patient_token(db: AsyncSession, patient_token: str, ua: str | None) -> str | None:
    """Безопасно создать session из валидного patient_token. None если токен невалиден."""
    try:
        payload = decode_patient_token(patient_token)
    except ValueError:
        return None
    phone = payload.get("sub")
    ref_id = payload.get("ref") or payload.get("apt")
    ttype = payload.get("type")
    if not phone or not ref_id:
        return None
    tenant_id = None
    if ttype == "patient":
        try:
            ref = await db.get(Referral, uuid.UUID(ref_id))
            if not ref or not verify_patient_token(str(ref.id), ref.patient_phone, patient_token):
                return None
            tenant_id = ref.tenant_id
        except (ValueError, TypeError):
            return None
    elif ttype == "appointment":
        from app.models.doctor import Appointment as Apt
        from app.core.security import verify_appointment_token
        try:
            apt = await db.get(Apt, uuid.UUID(ref_id))
            if not apt or not verify_appointment_token(str(apt.id), apt.patient_phone, patient_token):
                return None
            tenant_id = getattr(apt, "tenant_id", None)
        except (ValueError, TypeError):
            return None
    else:
        return None
    _, session_token = await _create_session(db, phone, tenant_id, device_info=ua)
    await db.commit()
    return session_token


@router.get("/manifest.json", include_in_schema=False)
async def portal_manifest(
    request: Request,
    slug: str = Query(""),
    s: str = Query("", description="session_token to embed into start_url"),
    t: str = Query("", description="patient_token from QR — auto-creates session"),
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

    # Если есть patient_token и нет session — создаём её на лету.
    if not s and t and slug:
        ua = request.headers.get("user-agent", "")[:500] if request else None
        s = (await _session_from_patient_token(db, t, ua)) or ""

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
