"""
МИС Renovatio — сервис синхронизации.
Импортирует клиники, врачей, услуги из МИС в нашу БД.
"""
import asyncio
from datetime import datetime, timedelta
from typing import Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from app.services.mis_client import _post
from app.models.clinic import Clinic
from app.models.doctor import Doctor
from app.models.service import Service
from app.core.tenant import get_current_tenant
import uuid


# ── Клиники ──────────────────────────────────────────────────────────────────

async def get_mis_clinics(api_url: str = "", api_key: str = "") -> list[dict]:
    """Все клиники из МИС."""
    result = await _post("getClinics", api_url=api_url, api_key=api_key, show_all=1)
    if result.get("error") == 0:
        return result.get("data") or []
    return []


async def sync_clinic(db: AsyncSession, mis_clinic: dict, tenant_id: uuid.UUID | None) -> dict:
    """
    Импортировать/обновить одну клинику из МИС.
    Возвращает {action: created|updated, clinic_id}.
    """
    mis_id = mis_clinic["id"]
    existing = (await db.execute(
        select(Clinic).where(Clinic.mis_id == mis_id)
    )).scalar_one_or_none()

    if existing:
        existing.name = mis_clinic.get("title", existing.name)
        existing.address = mis_clinic.get("address", existing.address)
        existing.phone = mis_clinic.get("phone", existing.phone) or mis_clinic.get("mobile")
        existing.city = mis_clinic.get("city", existing.city)
        await db.flush()
        return {"action": "updated", "clinic_id": str(existing.id), "name": existing.name}
    else:
        clinic = Clinic(
            tenant_id=tenant_id,
            name=mis_clinic.get("title", f"Клиника МИС #{mis_id}"),
            address=mis_clinic.get("address"),
            phone=mis_clinic.get("phone") or mis_clinic.get("mobile"),
            city=mis_clinic.get("city"),
            mis_id=mis_id,
            is_active=True,
        )
        db.add(clinic)
        await db.flush()
        return {"action": "created", "clinic_id": str(clinic.id), "name": clinic.name}


async def sync_clinics_bulk(
    db: AsyncSession,
    mis_ids: list[int],
    tenant_id: uuid.UUID | None,
    api_url: str = "",
    api_key: str = "",
) -> list[dict]:
    """Синхронизировать выбранные клиники по mis_id."""
    all_mis = await get_mis_clinics(api_url=api_url, api_key=api_key)
    selected = [c for c in all_mis if c["id"] in mis_ids]
    results = []
    for mc in selected:
        r = await sync_clinic(db, mc, tenant_id)
        results.append(r)
    await db.commit()
    return results


# ── Врачи ────────────────────────────────────────────────────────────────────

async def get_mis_users(api_url: str = "", api_key: str = "") -> list[dict]:
    """Все пользователи МИС."""
    result = await _post("getUsers", api_url=api_url, api_key=api_key)
    if result.get("error") == 0:
        return result.get("data") or []
    return []


async def sync_doctors_bulk(
    db: AsyncSession,
    mis_user_ids: list[int] | None,  # None = все врачи
    tenant_id: uuid.UUID | None,
    api_url: str = "",
    api_key: str = "",
) -> list[dict]:
    """Синхронизировать врачей из МИС."""
    users = await get_mis_users(api_url=api_url, api_key=api_key)
    doctors = [u for u in users if "doctor" in (u.get("role_names") or []) and not u.get("is_deleted")]

    if mis_user_ids is not None:
        doctors = [d for d in doctors if d["id"] in mis_user_ids]

    results = []
    for mu in doctors:
        mis_id = mu["id"]
        # Найти клинику по mis_id
        default_clinic_mis = mu.get("default_clinic")
        clinic = None
        if default_clinic_mis:
            clinic = (await db.execute(
                select(Clinic).where(Clinic.mis_id == default_clinic_mis)
            )).scalar_one_or_none()

        if not clinic:
            results.append({"action": "skipped_no_clinic", "mis_id": mis_id, "name": mu.get("name")})
            continue

        specialty = mu.get("all_profession_titles") or mu.get("profession_titles")

        # Ищем существующего врача
        existing = (await db.execute(
            select(Doctor).where(Doctor.mis_id == mis_id)
        )).scalar_one_or_none()

        if existing:
            existing.full_name = mu.get("name", existing.full_name)
            existing.specialty = specialty
            existing.clinic_id = clinic.id
            await db.flush()
            results.append({"action": "updated", "doctor_id": str(existing.id), "name": existing.full_name})
        else:
            doc = Doctor(
                tenant_id=tenant_id,
                clinic_id=clinic.id,
                full_name=mu.get("name", f"Врач МИС #{mis_id}"),
                specialty=specialty,
                mis_id=mis_id,
                slot_duration=30,
                is_active=True,
            )
            db.add(doc)
            await db.flush()
            results.append({"action": "created", "doctor_id": str(doc.id), "name": doc.full_name})

    await db.commit()
    return results


# ── Услуги ───────────────────────────────────────────────────────────────────

async def get_mis_services(clinic_id: int, api_url: str = "", api_key: str = "") -> list[dict]:
    result = await _post("getServices", api_url=api_url, api_key=api_key, clinic_id=clinic_id)
    if result.get("error") == 0:
        return result.get("data") or []
    return []


async def sync_services_bulk(
    db: AsyncSession,
    source_clinic_mis_id: int,
    target_clinic_ids: list[str],       # UUID наших клиник
    category_filter: list[str] | None,  # None = все категории
    service_mis_ids: list[int] | None,  # None = все услуги
    tenant_id: uuid.UUID | None,
    api_url: str = ,
    api_key: str = ,
) -> dict:
    """
    Импортировать услуги из МИС в указанные клиники.
    Если услуга уже есть (по mis_id + clinic_id) — обновляем цену.
    """
    mis_services = await get_mis_services(source_clinic_mis_id, api_url=api_url, api_key=api_key)

    if category_filter:
        mis_services = [s for s in mis_services if s.get("category_title") in category_filter]

    if service_mis_ids is not None:
        mis_services = [s for s in mis_services if s.get("service_id") in service_mis_ids]

    created = 0
    updated = 0

    for clinic_id_str in target_clinic_ids:
        try:
            clinic_uuid = uuid.UUID(clinic_id_str)
        except ValueError:
            continue

        for ms in mis_services:
            mis_service_id = ms.get("service_id")
            existing = (await db.execute(
                select(Service).where(
                    Service.mis_id == mis_service_id,
                    Service.clinic_id == clinic_uuid,
                )
            )).scalar_one_or_none()

            price = float(ms.get("original_price") or ms.get("price") or 0)

            if existing:
                existing.name = ms.get("title", existing.name)
                existing.original_price = price
                existing.category = ms.get("category_title")
                existing.code = ms.get("code")
                existing.description = ms.get("short_desc") or ms.get("full_desc")
                existing.preparation = ms.get("preparation")
                existing.lab = ms.get("lab")
                await db.flush()
                updated += 1
            else:
                svc = Service(
                    tenant_id=tenant_id,
                    clinic_id=clinic_uuid,
                    name=ms.get("title", f"Услуга МИС #{mis_service_id}"),
                    code=ms.get("code"),
                    mis_id=mis_service_id,
                    original_price=price,
                    category=ms.get("category_title"),
                    description=ms.get("short_desc") or ms.get("full_desc"),
                    preparation=ms.get("preparation"),
                    lab=ms.get("lab"),
                    bonus_amount=0,
                    is_active=True,
                )
                db.add(svc)
                await db.flush()
                created += 1

    await db.commit()
    return {
        "created": created,
        "updated": updated,
        "total_source": len(mis_services),
        "target_clinics": len(target_clinic_ids),
    }


# ── Приёмы пациента ───────────────────────────────────────────────────────────

async def get_patient_from_mis(phone: str, api_url: str = "", api_key: str = "") -> dict | None:
    """Получить данные пациента из МИС по телефону."""
    from app.utils.phone import normalize_phone
    digits = normalize_phone(phone)
    for fmt in [digits, "+" + digits]:
        try:
            result = await _post("getPatient", api_url=api_url, api_key=api_key, mobile=fmt)
            if result.get("error") == 0 and result.get("data"):
                return result["data"]
        except Exception:
            continue
    return None


async def get_patient_appointments_from_mis(phone: str, months_back: int = 12, api_url: str = "", api_key: str = "") -> list[dict]:
    """История визитов пациента из МИС (по телефону → patient_id → appointments)."""
    patient = await get_patient_from_mis(phone, api_url=api_url, api_key=api_key)
    if not patient:
        return []
    patient_id = patient.get("patient_id")
    if not patient_id:
        return []

    date_from = (datetime.today() - timedelta(days=months_back * 30)).strftime("%d.%m.%Y")
    date_to = (datetime.today() + timedelta(days=90)).strftime("%d.%m.%Y")  # +будущие

    result = await _post("getAppointments", api_url=api_url, api_key=api_key, patient_id=patient_id,
                         date_updated_from=date_from, date_updated_to=date_to)
    if result.get("error") == 0:
        appts = result.get("data") or []
        # Сортируем по дате (новые первые)
        appts.sort(key=lambda a: a.get("time_start", ""), reverse=True)
        return appts
    return []


# ── Polling для авто-подтверждения направлений ─────────────────────────────

async def poll_and_confirm_referrals(db: AsyncSession) -> dict:
    """
    Polling МИС: приёмы со статусом completed за последние 2 часа.
    Ищем соответствующее направление по phone → авто-подтверждаем.
    Возвращает статистику.
    """
    from datetime import datetime, timedelta
    from app.models.referral import Referral, ReferralStatus
    from sqlalchemy import and_
    import re

    now = datetime.utcnow()
    date_from = (now - timedelta(hours=2)).strftime("%d.%m.%Y")
    date_to = now.strftime("%d.%m.%Y")

    confirmed = 0
    errors = 0

    for clinic_mis_id in [1, 4, 26, 3, 24]:
        try:
            result = await _post(
                "getAppointments",
                clinic_id=clinic_mis_id,
                date_updated_from=date_from,
                date_updated_to=date_to,
            )
            appts = result.get("data") or []

            for appt in appts:
                if appt.get("status") != "completed":
                    continue

                raw_phone = appt.get("patient_phone", "")
                if not raw_phone:
                    continue

                digits = re.sub(r"\D", "", raw_phone)
                if digits.startswith("8"):
                    digits = "7" + digits[1:]

                # Ищем активное направление
                from app.utils.phone import phone_variants
                for variant in phone_variants(raw_phone):
                    ref_result = await db.execute(
                        select(Referral).where(
                            and_(
                                Referral.status == ReferralStatus.CREATED,
                                Referral.patient_phone == variant,
                            )
                        ).order_by(Referral.created_at.desc()).limit(1)
                    )
                    ref = ref_result.scalar_one_or_none()
                    if ref:
                        ref.status = ReferralStatus.CONFIRMED
                        ref.confirmed_at = datetime.utcnow()
                        await db.flush()
                        confirmed += 1
                        break
        except Exception:
            errors += 1

    await db.commit()
    return {"confirmed": confirmed, "errors": errors, "polled_at": now.isoformat()}
