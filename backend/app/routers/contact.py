"""
Контакт-форма с сайта.
Обращения сохраняются в БД и доступны в /admin.
"""
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
import logging
from app.utils.phone import mask_phone

from app.database import get_db
from app.models.contact_request import ContactRequest
from app.core.deps import require_super_admin
from app.utils.rate_limit import rate_limit_dep, check_honeypot

logger = logging.getLogger('contact')
router = APIRouter(prefix='/contact', tags=['contact'])

# Rate-limit для публичной контакт-формы: 5 запросов / 10 минут / IP
_contact_rl = rate_limit_dep(
    'contact', limit=5, window=600,
    error_message='Слишком много обращений. Попробуйте через 10 минут.',
)


class ContactForm(BaseModel):
    phone: str
    email: str = ''
    message: str
    name: str = ''
    # ── Honeypot: скрытое поле, видят только боты. Если заполнено → 403.
    # TODO: после получения ключей hCaptcha/Turnstile — заменить на полноценную капчу.
    website_url: str = ''


@router.post('/', dependencies=[Depends(_contact_rl)])
async def send_contact(form: ContactForm, db: AsyncSession = Depends(get_db)):
    # Honeypot — наивных ботов сразу отбрасываем
    check_honeypot(form.website_url)
    req = ContactRequest(
        name=form.name or None,
        phone=form.phone,
        email=form.email or None,
        message=form.message,
    )
    db.add(req)
    await db.commit()
    logger.info(f"[CONTACT] saved phone={mask_phone(form.phone)}")
    return {'ok': True}


@router.get('/admin/list', dependencies=[Depends(require_super_admin)])
async def list_contacts(
    unread_only: bool = Query(False),
    limit: int = Query(50, le=200),
    offset: int = Query(0),
    db: AsyncSession = Depends(get_db),
):
    filters = []
    if unread_only:
        filters.append(ContactRequest.is_read == False)
    total = (await db.execute(select(func.count(ContactRequest.id)).where(*filters))).scalar() or 0
    rows = (await db.execute(
        select(ContactRequest).where(*filters)
        .order_by(ContactRequest.created_at.desc())
        .limit(limit).offset(offset)
    )).scalars().all()
    return {
        'total': total,
        'items': [
            {
                'id': str(r.id),
                'name': r.name,
                'phone': r.phone,
                'email': r.email,
                'message': r.message,
                'is_read': r.is_read,
                'created_at': r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
    }


@router.get('/admin/unread-count', dependencies=[Depends(require_super_admin)])
async def unread_count(db: AsyncSession = Depends(get_db)):
    count = (await db.execute(
        select(func.count(ContactRequest.id)).where(ContactRequest.is_read == False)
    )).scalar() or 0
    return {'count': count}


@router.patch('/admin/{contact_id}/read', dependencies=[Depends(require_super_admin)])
async def mark_read(contact_id: str, db: AsyncSession = Depends(get_db)):
    import uuid as _uuid
    r = await db.get(ContactRequest, _uuid.UUID(contact_id))
    if r:
        r.is_read = True
        await db.commit()
    return {'ok': True}


@router.delete('/admin/{contact_id}', dependencies=[Depends(require_super_admin)])
async def delete_contact(contact_id: str, db: AsyncSession = Depends(get_db)):
    import uuid as _uuid
    r = await db.get(ContactRequest, _uuid.UUID(contact_id))
    if r:
        await db.delete(r)
        await db.commit()
    return {'ok': True}
