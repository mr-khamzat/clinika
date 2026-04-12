"""
Контакт-форма с сайта.
Уведомление идёт через NotifyPlugin → Telegram.
"""
from fastapi import APIRouter
from pydantic import BaseModel
import logging

logger = logging.getLogger("contact")
router = APIRouter(prefix="/contact", tags=["contact"])


class ContactForm(BaseModel):
    phone: str
    email: str = ""
    message: str
    name: str = ""


@router.post("/")
async def send_contact(form: ContactForm):
    from app.plugins.registry import plugin_registry
    notify = plugin_registry.get("notify")
    logger.info(f"[CONTACT] phone={form.phone}")
    if notify:
        await notify.notify_contact_form(
            phone=form.phone,
            email=form.email,
            name=form.name,
            message=form.message,
        )
    return {"ok": True}
