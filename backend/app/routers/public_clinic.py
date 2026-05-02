"""
Публичная страница клиники — аналог prodoctorov.ru.
GET /public/{slug}/clinic — полные данные: брендинг, врачи с рейтингами, последние отзывы.
GET /public/{slug}/doctors/{id}/profile — детальная карточка врача с отзывами.
"""
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.tenant import Tenant, TenantBranding
from app.models.clinic import Clinic
from app.models.doctor import Doctor, DoctorSchedule
from app.models.review import Review, ReviewStatus

# Монтируем на тот же prefix /public, уже объявленный в public_booking
router = APIRouter(tags=["public-clinic"])


async def _tenant_or_404(slug: str, db: AsyncSession) -> Tenant:
    t = (await db.execute(select(Tenant).where(Tenant.slug == slug, Tenant.is_active == True))).scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Клиника не найдена")
    return t


@router.get("/public/{slug}/clinic")
async def public_clinic_page(slug: str, db: AsyncSession = Depends(get_db)):
    """Полные данные для публичной страницы клиники."""
    tenant = await _tenant_or_404(slug, db)

    # Брендинг
    branding = (await db.execute(
        select(TenantBranding).where(TenantBranding.tenant_id == tenant.id)
    )).scalar_one_or_none()

    # Клиники тенанта (адреса, телефоны)
    clinics_res = await db.execute(
        select(Clinic).where(Clinic.tenant_id == tenant.id, Clinic.is_active == True).order_by(Clinic.name)
    )
    clinics = clinics_res.scalars().all()

    # Все активные врачи тенанта
    docs_res = await db.execute(
        select(Doctor, Clinic)
        .join(Clinic, Doctor.clinic_id == Clinic.id)
        .where(Doctor.is_active == True, Clinic.tenant_id == tenant.id, Clinic.is_active == True)
        .order_by(Doctor.full_name)
    )
    all_doctors = docs_res.all()
    doctor_ids = [r.Doctor.id for r in all_doctors]

    # Есть ли расписание у врача
    has_schedule = set()
    if doctor_ids:
        sch_res = await db.execute(
            select(DoctorSchedule.doctor_id).where(
                DoctorSchedule.doctor_id.in_(doctor_ids),
                DoctorSchedule.is_active == True,
            ).distinct()
        )
        has_schedule = set(sch_res.scalars().all())

    # Рейтинги врачей одним запросом
    ratings_res = await db.execute(
        select(
            Review.doctor_id,
            func.avg(Review.rating).label("avg"),
            func.count(Review.id).label("cnt"),
        ).where(
            Review.doctor_id.in_(doctor_ids),
            Review.status == ReviewStatus.APPROVED,
        ).group_by(Review.doctor_id)
    )
    ratings = {str(r.doctor_id): {"avg": round(float(r.avg), 1), "cnt": r.cnt} for r in ratings_res.all()}

    # Общий рейтинг тенанта
    total_res = await db.execute(
        select(
            func.avg(Review.rating).label("avg"),
            func.count(Review.id).label("cnt"),
        ).where(
            Review.tenant_id == tenant.id,
            Review.status == ReviewStatus.APPROVED,
        )
    )
    total_row = total_res.one()
    tenant_avg = round(float(total_row.avg), 1) if total_row.avg else None
    tenant_cnt = total_row.cnt or 0

    # Разбивка рейтинга по звёздам
    breakdown_res = await db.execute(
        select(Review.rating, func.count(Review.id).label("cnt"))
        .where(Review.tenant_id == tenant.id, Review.status == ReviewStatus.APPROVED)
        .group_by(Review.rating)
    )
    breakdown = {str(r.rating): r.cnt for r in breakdown_res.all()}

    # Последние 20 одобренных отзывов
    recent_res = await db.execute(
        select(Review, Doctor)
        .outerjoin(Doctor, Review.doctor_id == Doctor.id)
        .where(Review.tenant_id == tenant.id, Review.status == ReviewStatus.APPROVED)
        .order_by(Review.created_at.desc())
        .limit(20)
    )
    recent_reviews = []
    for rev, doc in recent_res.all():
        recent_reviews.append({
            "id": str(rev.id),
            "doctor_id": str(rev.doctor_id) if rev.doctor_id else None,
            "doctor_name": doc.full_name if doc else None,
            "patient_name": None if rev.is_anonymous else rev.patient_name,
            "rating": rev.rating,
            "comment": rev.comment,
            "is_anonymous": rev.is_anonymous,
            "created_at": rev.created_at.isoformat(),
        })

    # Список специальностей (для фильтра)
    specialties = sorted(set(r.Doctor.specialty for r in all_doctors if r.Doctor.specialty))

    # Врачи с рейтингами
    doctors_out = []
    for row in all_doctors:
        doc, clinic = row.Doctor, row.Clinic
        dr = ratings.get(str(doc.id), {"avg": None, "cnt": 0})
        doctors_out.append({
            "id": str(doc.id),
            "full_name": doc.full_name,
            "specialty": doc.specialty,
            "photo_url": doc.photo_url,
            "bio": doc.bio,
            "experience_years": doc.experience_years,
            "education": doc.education,
            "slot_duration": doc.slot_duration,
            "clinic_id": str(clinic.id),
            "clinic_name": clinic.name,
            "clinic_address": clinic.address,
            "avg_rating": dr["avg"],
            "review_count": dr["cnt"],
            "has_schedule": doc.id in has_schedule,
        })

    return {
        "tenant": {
            "id": str(tenant.id),
            "name": tenant.name,
            "slug": tenant.slug,
            "avg_rating": tenant_avg,
            "total_reviews": tenant_cnt,
            "rating_breakdown": breakdown,
        },
        "branding": {
            "brand_name": branding.brand_name if branding else None,
            "logo_url": branding.logo_url if branding else None,
            "primary_color": branding.primary_color if branding else "#0097A7",
            "secondary_color": branding.secondary_color if branding else "#E0F7FA",
            "footer_text": branding.footer_text if branding else None,
            "meta_title": branding.meta_title if branding else None,
        },
        "clinics": [
            {"id": str(c.id), "name": c.name, "address": c.address, "phone": c.phone, "city": c.city}
            for c in clinics
        ],
        "specialties": specialties,
        "doctors": doctors_out,
        "recent_reviews": recent_reviews,
    }


@router.get("/public/{slug}/doctors/{doctor_id}/profile")
async def public_doctor_profile(
    slug: str,
    doctor_id: str,
    limit: int = Query(10, le=50),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    """Детальная карточка врача: профиль + все отзывы (пагинация)."""
    tenant = await _tenant_or_404(slug, db)

    try:
        did = uuid.UUID(doctor_id)
    except ValueError:
        raise HTTPException(400, "Неверный ID врача")

    row = (await db.execute(
        select(Doctor, Clinic)
        .join(Clinic, Doctor.clinic_id == Clinic.id)
        .where(Doctor.id == did, Doctor.is_active == True, Clinic.tenant_id == tenant.id)
    )).first()
    if not row:
        raise HTTPException(404, "Врач не найден")

    doc, clinic = row.Doctor, row.Clinic

    # Рейтинг + разбивка
    rating_res = await db.execute(
        select(func.avg(Review.rating).label("avg"), func.count(Review.id).label("cnt"))
        .where(Review.doctor_id == did, Review.status == ReviewStatus.APPROVED)
    )
    rr = rating_res.one()
    avg_rating = round(float(rr.avg), 1) if rr.avg else None
    total = rr.cnt or 0

    breakdown_res = await db.execute(
        select(Review.rating, func.count(Review.id).label("cnt"))
        .where(Review.doctor_id == did, Review.status == ReviewStatus.APPROVED)
        .group_by(Review.rating)
    )
    breakdown = {str(r.rating): r.cnt for r in breakdown_res.all()}

    # Отзывы с пагинацией
    reviews_res = await db.execute(
        select(Review)
        .where(Review.doctor_id == did, Review.status == ReviewStatus.APPROVED)
        .order_by(Review.created_at.desc())
        .limit(limit).offset(offset)
    )
    reviews = [{
        "id": str(r.id),
        "patient_name": None if r.is_anonymous else r.patient_name,
        "rating": r.rating,
        "comment": r.comment,
        "is_anonymous": r.is_anonymous,
        "created_at": r.created_at.isoformat(),
    } for r in reviews_res.scalars().all()]

    has_schedule = bool((await db.execute(
        select(DoctorSchedule.id).where(DoctorSchedule.doctor_id == did, DoctorSchedule.is_active == True).limit(1)
    )).scalar_one_or_none())

    return {
        "doctor": {
            "id": str(doc.id),
            "full_name": doc.full_name,
            "specialty": doc.specialty,
            "photo_url": doc.photo_url,
            "bio": doc.bio,
            "experience_years": doc.experience_years,
            "education": doc.education,
            "slot_duration": doc.slot_duration,
            "clinic_name": clinic.name,
            "clinic_address": clinic.address,
            "has_schedule": has_schedule,
        },
        "avg_rating": avg_rating,
        "total_reviews": total,
        "rating_breakdown": breakdown,
        "reviews": reviews,
    }
