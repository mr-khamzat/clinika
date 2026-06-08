"""
Push-напоминания о записи к врачу.
Запускается APScheduler'ом каждые 30 минут (см. main.py).
Окна: за 24h +/-15min и за 2h +/-15min до начала приёма.
Помечается в Appointment.reminders_sent={"24h": True, "2h": True}.
"""
import logging
from datetime import datetime, timedelta, timezone
from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

logger = logging.getLogger("appointment_reminders")

# Слоты приёма (appointment_date + start_time) хранятся как настенное МСК-время
# (то, что пациент видит в расписании), а не UTC. Поэтому «сейчас» для сравнения
# с окнами тоже берём в МСК, иначе получается сдвиг на 3 часа (см. daily_digest_job).
MSK = timezone(timedelta(hours=3))


def _fmt_when(apt) -> str:
    """Человекочитаемая дата+время записи."""
    months = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек']
    try:
        d = apt.appointment_date
        t = apt.start_time
        hhmm = t.strftime("%H:%M") if hasattr(t, "strftime") else str(t)[:5]
        return f"{d.day} {months[d.month-1]} в {hhmm}"
    except Exception:
        return ""


async def _send_reminder(db, apt, key: str, hours: int) -> None:
    """Отправить пуш и пометить в reminders_sent[key] = True."""
    try:
        from app.services.push_service import send_push_to_phone
    except Exception as e:
        logger.warning(f"push_service unavailable: {e}")
        return

    title = "Напоминание о записи"
    when = _fmt_when(apt)
    if hours >= 24:
        body = f"Завтра у вас приём — {when}. Не забудьте взять документы."
    else:
        body = f"Через 2 часа у вас приём — {when}."

    data = {
        "type": "appointment_reminder",
        "appointment_id": str(apt.id),
        "url": f"/p?apt={apt.id}",
        "hours": hours,
    }
    try:
        sent = await send_push_to_phone(apt.patient_phone, title, body, data, db)
    except Exception as e:
        logger.warning(f"send_push failed apt={apt.id}: {e}")
        sent = 0

    # Помечаем — даже если sent=0 (нет подписок), чтобы не долбить заново
    rs = dict(apt.reminders_sent or {})
    rs[key] = True
    apt.reminders_sent = rs
    flag_modified(apt, "reminders_sent")
    logger.info(f"reminder {key} apt={apt.id} sent={sent}")


async def run_appointment_reminders() -> int:
    """
    Главный entry-point джоба. Возвращает кол-во отправленных напоминаний.
    """
    from app.database import AsyncSessionLocal
    from app.models.doctor import Appointment, AppointmentStatus

    sent_total = 0
    try:
        async with AsyncSessionLocal() as db:
            # МСК naive «сейчас» — в одной TZ со слотами приёма (apt_dt).
            now = datetime.now(MSK).replace(tzinfo=None)
            t24_lo = now + timedelta(hours=23, minutes=45)
            t24_hi = now + timedelta(hours=24, minutes=15)
            t2_lo = now + timedelta(hours=1, minutes=45)
            t2_hi = now + timedelta(hours=2, minutes=15)

            d_from = now.date()
            d_to = (now + timedelta(hours=25)).date()

            q = select(Appointment).where(
                Appointment.status.in_([AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED]),
                Appointment.appointment_date >= d_from,
                Appointment.appointment_date <= d_to,
            )
            rows = (await db.execute(q)).scalars().all()

            for apt in rows:
                try:
                    apt_dt = datetime.combine(apt.appointment_date, apt.start_time)
                except Exception:
                    continue

                rs = apt.reminders_sent or {}

                if not rs.get("24h") and t24_lo <= apt_dt <= t24_hi:
                    await _send_reminder(db, apt, "24h", 24)
                    sent_total += 1
                elif not rs.get("2h") and t2_lo <= apt_dt <= t2_hi:
                    await _send_reminder(db, apt, "2h", 2)
                    sent_total += 1

            await db.commit()
    except Exception as e:
        logger.error(f"appointment_reminders job error: {e}")
    return sent_total
