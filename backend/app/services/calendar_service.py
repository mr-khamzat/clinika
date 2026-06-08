"""
Глава 9 — Генерация iCal-feed для пациента.

VEVENT для каждого upcoming appointment (до 4 недель).
Подписка добавляется в Google/Apple Calendar по URL с токеном.
"""
import secrets
import uuid
from datetime import datetime, date, time, timedelta, timezone
from typing import Iterable, Optional

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.calendar import PatientCalendarToken
from app.models.doctor import Appointment, AppointmentStatus, Doctor
from app.models.clinic import Clinic
from app.models.patient_account import PatientAccount
from app.utils.phone import normalize_phone


def _utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


async def issue_token(db: AsyncSession, patient_id: uuid.UUID) -> PatientCalendarToken:
    """Создать новый iCal-токен (старые не отзываем — пациент может иметь несколько)."""
    tok = PatientCalendarToken(
        id=uuid.uuid4(),
        patient_id=patient_id,
        token=secrets.token_urlsafe(32),
    )
    db.add(tok)
    await db.flush()
    return tok


async def revoke_token(db: AsyncSession, tok: PatientCalendarToken) -> None:
    tok.revoked_at = datetime.utcnow()


async def get_token_record(
    db: AsyncSession, token: str
) -> Optional[PatientCalendarToken]:
    r = await db.execute(
        select(PatientCalendarToken).where(
            PatientCalendarToken.token == token,
            PatientCalendarToken.revoked_at.is_(None),
        )
    )
    return r.scalar_one_or_none()


async def upcoming_appointments(
    db: AsyncSession, patient_phone: str, weeks_ahead: int = 4,
) -> list[tuple[Appointment, Doctor | None, Clinic | None]]:
    phone_n = normalize_phone(patient_phone)
    today = date.today()
    horizon = today + timedelta(weeks=weeks_ahead)
    # TODO(#2 PHI): после миграции shadow-колонок заменить exact-match
    # `Appointment.patient_phone == phone_n` на
    # `Appointment.patient_phone_hash == hash_phone(patient_phone)`
    # (from app.models.doctor import hash_phone). hash_phone уже нормализует номер,
    # поэтому отдельный normalize_phone для сравнения станет не нужен.
    r = await db.execute(
        select(Appointment, Doctor, Clinic)
        .join(Doctor, Doctor.id == Appointment.doctor_id, isouter=True)
        .join(Clinic, Clinic.id == Appointment.clinic_id, isouter=True)
        .where(
            Appointment.patient_phone == phone_n,
            Appointment.appointment_date >= today,
            Appointment.appointment_date <= horizon,
            Appointment.status.in_([
                AppointmentStatus.PENDING,
                AppointmentStatus.CONFIRMED,
            ])
        )
        .order_by(Appointment.appointment_date.asc(),
                  Appointment.start_time.asc())
    )
    return [(a, d, c) for (a, d, c) in r.all()]


def _ics_escape(value: str | None) -> str:
    if value is None:
        return ""
    return (
        value.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\n", "\\n")
    )


def _dt_combine(d: date, t: time) -> datetime:
    return datetime.combine(d, t).replace(tzinfo=timezone.utc)


def build_ics(
    appointments: list[tuple[Appointment, Doctor | None, Clinic | None]],
    cal_name: str = "КлиникСеть — мои приёмы",
) -> bytes:
    """Собрать VCALENDAR (RFC 5545) с VEVENT для каждого appointment."""
    # Пытаемся использовать пакет icalendar, иначе — fallback на ручную сборку.
    try:
        from icalendar import Calendar, Event  # type: ignore
        cal = Calendar()
        cal.add("prodid", "-//Clinikaset//Patient Calendar//RU")
        cal.add("version", "2.0")
        cal.add("calscale", "GREGORIAN")
        cal.add("x-wr-calname", cal_name)
        cal.add("x-wr-timezone", "UTC")
        for appt, doc, clinic in appointments:
            ev = Event()
            ev.add("uid", f"appt-{appt.id}@clinikaset")
            start_dt = _dt_combine(appt.appointment_date, appt.start_time)
            end_dt = _dt_combine(appt.appointment_date, appt.end_time)
            ev.add("dtstart", start_dt)
            ev.add("dtend", end_dt)
            dtstamp = appt.updated_at or appt.created_at or datetime.utcnow()
            ev.add("dtstamp", _utc(dtstamp))
            doctor_name = (doc.full_name if doc and getattr(doc, "full_name", None)
                           else "врач")
            summary = f"Приём: {doctor_name}"
            if clinic and getattr(clinic, "name", None):
                summary += f" — {clinic.name}"
            ev.add("summary", summary)
            descr_parts = []
            if clinic and getattr(clinic, "name", None):
                descr_parts.append(f"Клиника: {clinic.name}")
            if appt.notes:
                descr_parts.append(f"Заметка: {appt.notes}")
            descr_parts.append(f"Статус: {appt.status.value if hasattr(appt.status, 'value') else appt.status}")
            ev.add("description", "\n".join(descr_parts))
            location = (clinic.address if clinic and getattr(clinic, "address", None)
                        else (clinic.name if clinic and getattr(clinic, "name", None) else ""))
            if location:
                ev.add("location", location)
            cal.add_component(ev)
        return cal.to_ical()
    except Exception:
        # Fallback — собираем вручную (если icalendar не установлен).
        lines = [
            "BEGIN:VCALENDAR",
            "PRODID:-//Clinikaset//Patient Calendar//RU",
            "VERSION:2.0",
            "CALSCALE:GREGORIAN",
            f"X-WR-CALNAME:{_ics_escape(cal_name)}",
            "X-WR-TIMEZONE:UTC",
        ]
        for appt, doc, clinic in appointments:
            start_dt = _dt_combine(appt.appointment_date, appt.start_time)
            end_dt = _dt_combine(appt.appointment_date, appt.end_time)
            dtstamp = _utc(appt.updated_at or appt.created_at or datetime.utcnow())
            doctor_name = (doc.full_name if doc and getattr(doc, "full_name", None)
                           else "врач")
            clinic_name = clinic.name if clinic and getattr(clinic, "name", None) else ""
            summary = f"Приём: {doctor_name}"
            if clinic_name:
                summary += f" — {clinic_name}"
            descr_parts = []
            if clinic_name:
                descr_parts.append(f"Клиника: {clinic_name}")
            if appt.notes:
                descr_parts.append(f"Заметка: {appt.notes}")
            descr_parts.append(f"Статус: {appt.status.value if hasattr(appt.status, 'value') else appt.status}")
            description = "\n".join(descr_parts)
            location = (clinic.address if clinic and getattr(clinic, "address", None)
                        else clinic_name)
            lines.extend([
                "BEGIN:VEVENT",
                f"UID:appt-{appt.id}@clinikaset",
                f"DTSTAMP:{dtstamp.strftime('%Y%m%dT%H%M%SZ')}",
                f"DTSTART:{start_dt.strftime('%Y%m%dT%H%M%SZ')}",
                f"DTEND:{end_dt.strftime('%Y%m%dT%H%M%SZ')}",
                f"SUMMARY:{_ics_escape(summary)}",
                f"DESCRIPTION:{_ics_escape(description)}",
                f"LOCATION:{_ics_escape(location)}",
                "END:VEVENT",
            ])
        lines.append("END:VCALENDAR")
        return ("\r\n".join(lines) + "\r\n").encode("utf-8")


def serialize_upcoming(
    rows: list[tuple[Appointment, Doctor | None, Clinic | None]]
) -> list[dict]:
    out = []
    for appt, doc, clinic in rows:
        out.append({
            "id": str(appt.id),
            "appointment_date": appt.appointment_date.isoformat(),
            "start_time": appt.start_time.isoformat(timespec="minutes"),
            "end_time": appt.end_time.isoformat(timespec="minutes"),
            "status": appt.status.value if hasattr(appt.status, "value") else appt.status,
            "doctor_id": str(appt.doctor_id) if appt.doctor_id else None,
            "doctor_name": getattr(doc, "full_name", None) if doc else None,
            "clinic_id": str(appt.clinic_id) if appt.clinic_id else None,
            "clinic_name": getattr(clinic, "name", None) if clinic else None,
            "clinic_address": getattr(clinic, "address", None) if clinic else None,
            "notes": appt.notes,
        })
    return out
