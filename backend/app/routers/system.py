"""System info, version check, heartbeat to hub."""
import asyncio
import os
import socket
from pathlib import Path
from fastapi import APIRouter

router = APIRouter(prefix="/system", tags=["system"])

HUB_URL = os.getenv("HUB_URL", "")
LICENSE_KEY = os.getenv("LICENSE_KEY", "")


def get_current_version() -> str:
    for p in [Path("/app/VERSION"), Path(__file__).parent.parent.parent / "VERSION"]:
        try:
            return p.read_text().strip()
        except Exception:
            continue
    return "unknown"


@router.get("/version")
async def get_version():
    return {"version": get_current_version()}


async def send_heartbeat():
    if not HUB_URL or not LICENSE_KEY:
        return
    try:
        import httpx
        from app.database import AsyncSessionLocal
        from app.models.user import User
        from app.models.referral import Referral
        from app.models.clinic import Clinic
        from sqlalchemy import select, func

        async with AsyncSessionLocal() as db:
            users_count = (await db.execute(select(func.count(User.id)))).scalar() or 0
            clinics_count = (await db.execute(select(func.count(Clinic.id)))).scalar() or 0
            referrals_count = (await db.execute(select(func.count(Referral.id)))).scalar() or 0

        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(f"{HUB_URL}/hub/api/licenses/validate", json={
                "license_key": LICENSE_KEY,
                "hostname": socket.gethostname(),
                "version": get_current_version(),
                "stats": {
                    "users_count": users_count,
                    "clinics_count": clinics_count,
                    "referrals_count": referrals_count,
                },
            })
    except Exception:
        pass


async def heartbeat_loop():
    await asyncio.sleep(15)  # initial delay after startup
    while True:
        await send_heartbeat()
        await asyncio.sleep(3600)  # every hour
