"""
Глава: Динамика лабораторных показателей пациента (line-charts).

Endpoint:
  GET /patient/lab-dynamics?t=<patient_session_token>&months=12

Возвращает каждый аналит (Гемоглобин/Глюкоза/...) с массивом точек {date, value}
для отрисовки графиков recharts в ЛК пациента.

Источник данных:
  1) Реальная таблица lab_results (через lab_orders.patient_id → patient_accounts).
  2) Если данных нет — для demo-телефона +79280037547 (Гудаев) возвращаем заглушку,
     чтобы UI было видно даже до подключения МИС-парсинга.
"""
import re
import uuid
from datetime import datetime, timedelta, date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Header
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.patient_session_service import restore_session
from app.services import family_service as fs

router = APIRouter(prefix="/patient/lab-dynamics", tags=["patient-lab-dynamics"])


# ── Норма-эталоны (можно расширять) ──────────────────────────────────────
ANALYTE_NORMS = {
    "Гемоглобин":         {"unit": "г/л",    "min": 120, "max": 160, "icon": "🩸"},
    "Глюкоза":            {"unit": "ммоль/л","min": 3.3, "max": 5.5, "icon": "🍬"},
    "Холестерин общий":   {"unit": "ммоль/л","min": 3.0, "max": 5.2, "icon": "🥚"},
    "ЛПНП":               {"unit": "ммоль/л","min": 0,   "max": 3.0, "icon": "📉"},
    "ЛПВП":               {"unit": "ммоль/л","min": 1.0, "max": 999, "icon": "📈"},
    "Триглицериды":       {"unit": "ммоль/л","min": 0,   "max": 1.7, "icon": "💧"},
    "Креатинин":          {"unit": "мкмоль/л","min": 53, "max": 115, "icon": "🫘"},
    "Мочевина":           {"unit": "ммоль/л","min": 2.5, "max": 8.3, "icon": "🚰"},
    "АЛТ":                {"unit": "Ед/л",   "min": 0,   "max": 41,  "icon": "🫁"},
    "АСТ":                {"unit": "Ед/л",   "min": 0,   "max": 35,  "icon": "🫁"},
    "Лейкоциты":          {"unit": "10⁹/л",  "min": 4.0, "max": 9.0, "icon": "🦠"},
    "Эритроциты":         {"unit": "10¹²/л", "min": 4.0, "max": 5.5, "icon": "🔴"},
    "Тромбоциты":         {"unit": "10⁹/л",  "min": 180, "max": 400, "icon": "🩹"},
    "СОЭ":                {"unit": "мм/ч",   "min": 0,   "max": 20,  "icon": "⏱"},
    "ТТГ":                {"unit": "мМЕ/л",  "min": 0.4, "max": 4.0, "icon": "🦋"},
    "T4 свободный":       {"unit": "пмоль/л","min": 9.0, "max": 19.0,"icon": "🦋"},
    "Витамин D":          {"unit": "нг/мл",  "min": 30,  "max": 100, "icon": "☀️"},
    "Ферритин":           {"unit": "нг/мл",  "min": 15,  "max": 200, "icon": "🧲"},
}


def _parse_number(raw: str | None) -> float | None:
    """Из строкового value LabResult вытащить число (поддерживая ',' и '.')."""
    if raw is None:
        return None
    s = str(raw).strip().replace(",", ".")
    m = re.search(r"-?\d+(?:\.\d+)?", s)
    if not m:
        return None
    try:
        return float(m.group(0))
    except ValueError:
        return None


def _normalize_name(name: str) -> str:
    """Привести test_name к одному из ключей ANALYTE_NORMS если матчится."""
    if not name:
        return name
    n = name.strip()
    low = n.lower()
    aliases = {
        "гемоглобин": "Гемоглобин",
        "hgb": "Гемоглобин",
        "глюкоза": "Глюкоза",
        "glucose": "Глюкоза",
        "холестерин общий": "Холестерин общий",
        "общий холестерин": "Холестерин общий",
        "холестерин": "Холестерин общий",
        "лпнп": "ЛПНП",
        "ldl": "ЛПНП",
        "лпвп": "ЛПВП",
        "hdl": "ЛПВП",
        "триглицериды": "Триглицериды",
        "креатинин": "Креатинин",
        "creatinine": "Креатинин",
        "мочевина": "Мочевина",
        "urea": "Мочевина",
        "алт": "АЛТ",
        "alt": "АЛТ",
        "аст": "АСТ",
        "ast": "АСТ",
        "лейкоциты": "Лейкоциты",
        "wbc": "Лейкоциты",
        "эритроциты": "Эритроциты",
        "rbc": "Эритроциты",
        "тромбоциты": "Тромбоциты",
        "plt": "Тромбоциты",
        "соэ": "СОЭ",
        "esr": "СОЭ",
        "ттг": "ТТГ",
        "tsh": "ТТГ",
        "t4 свободный": "T4 свободный",
        "ft4": "T4 свободный",
        "витамин d": "Витамин D",
        "25(oh)d": "Витамин D",
        "vitamin d": "Витамин D",
        "ферритин": "Ферритин",
        "ferritin": "Ферритин",
    }
    for k, v in aliases.items():
        if k in low:
            return v
    return n


# ── Auth helper (мульти-источник как в patient_lab) ─────────────────────
async def _get_session_token(
    request: Request,
    authorization: Optional[str],
    x_patient_session: Optional[str],
    t: Optional[str],
) -> str:
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(None, 1)[1].strip()
    token = token or x_patient_session or t
    if not token:
        token = request.cookies.get("clinika_patient_session")
    if not token:
        raise HTTPException(401, "Patient session required")
    return token


@router.get("")
async def get_lab_dynamics(
    request: Request,
    months: int = Query(12, ge=1, le=36),
    t: Optional[str] = Query(None, description="patient_session_token"),
    authorization: Optional[str] = Header(None),
    x_patient_session: Optional[str] = Header(None, alias="X-Patient-Session"),
    db: AsyncSession = Depends(get_db),
):
    """Динамика лаб-показателей пациента за N месяцев.

    Returns: { months, analytes: [ {name, icon, unit, norm_min, norm_max,
                                     points: [{date, value}],
                                     last_value, last_date, delta_pct, status, count} ] }
    """
    token = await _get_session_token(request, authorization, x_patient_session, t)
    session = await restore_session(db, token)
    if not session:
        raise HTTPException(401, "Session invalid or expired")

    phone = session.phone
    since = datetime.utcnow() - timedelta(days=months * 30)

    analytes_data: dict[str, list[dict]] = {}

    # ── 1) Реальный запрос к lab_results через patient_account ──
    try:
        acc = await fs.get_account_by_phone(db, phone)
        if acc:
            rows = (await db.execute(text("""
                SELECT lr.test_name, lr.value, lr.unit,
                       COALESCE(lr.result_date, lo.results_at, lo.requested_at) AS taken_at
                FROM lab_results lr
                JOIN lab_orders lo ON lo.id = lr.order_id
                WHERE lo.patient_id = :pid
                  AND COALESCE(lr.result_date, lo.results_at, lo.requested_at) >= :since
                ORDER BY lr.test_name, taken_at
            """), {"pid": str(acc.id), "since": since})).all()
            for r in rows:
                num = _parse_number(r.value)
                if num is None or r.taken_at is None:
                    continue
                name = _normalize_name(r.test_name or "")
                if not name:
                    continue
                analytes_data.setdefault(name, []).append({
                    "date": r.taken_at.isoformat() if hasattr(r.taken_at, "isoformat") else str(r.taken_at),
                    "value": num,
                    "unit": r.unit or ANALYTE_NORMS.get(name, {}).get("unit", ""),
                })
    except Exception:
        # Молча игнорируем — даже если таблицы нет/схема отличается, не падаем
        analytes_data = {}

    # ── 2) Fallback: demo-данные для тестового номера Гудаева ──
    is_demo = phone in ("+79280037547", "79280037547", "9280037547")
    if not analytes_data and is_demo:
        today = date.today()
        analytes_data = {
            "Гемоглобин": [
                {"date": (today - timedelta(days=300)).isoformat(), "value": 118.0, "unit": "г/л"},
                {"date": (today - timedelta(days=180)).isoformat(), "value": 125.0, "unit": "г/л"},
                {"date": (today - timedelta(days=60)).isoformat(),  "value": 134.0, "unit": "г/л"},
                {"date": (today - timedelta(days=10)).isoformat(),  "value": 140.0, "unit": "г/л"},
            ],
            "Глюкоза": [
                {"date": (today - timedelta(days=300)).isoformat(), "value": 5.2, "unit": "ммоль/л"},
                {"date": (today - timedelta(days=180)).isoformat(), "value": 5.6, "unit": "ммоль/л"},
                {"date": (today - timedelta(days=60)).isoformat(),  "value": 5.4, "unit": "ммоль/л"},
                {"date": (today - timedelta(days=10)).isoformat(),  "value": 5.1, "unit": "ммоль/л"},
            ],
            "Холестерин общий": [
                {"date": (today - timedelta(days=240)).isoformat(), "value": 5.8, "unit": "ммоль/л"},
                {"date": (today - timedelta(days=120)).isoformat(), "value": 5.4, "unit": "ммоль/л"},
                {"date": (today - timedelta(days=30)).isoformat(),  "value": 4.9, "unit": "ммоль/л"},
            ],
            "Витамин D": [
                {"date": (today - timedelta(days=180)).isoformat(), "value": 18.0, "unit": "нг/мл"},
                {"date": (today - timedelta(days=60)).isoformat(),  "value": 28.0, "unit": "нг/мл"},
                {"date": (today - timedelta(days=10)).isoformat(),  "value": 42.0, "unit": "нг/мл"},
            ],
        }

    # ── Форматирование ответа ──
    result = []
    for name, points in analytes_data.items():
        if not points:
            continue
        norm = ANALYTE_NORMS.get(name, {"unit": "", "min": None, "max": None, "icon": "📊"})
        points.sort(key=lambda p: p["date"])
        last = points[-1]
        prev = points[-2] if len(points) >= 2 else None
        delta_pct = None
        if prev and prev.get("value") not in (None, 0):
            try:
                delta_pct = round((last["value"] - prev["value"]) / prev["value"] * 100, 1)
            except (TypeError, ZeroDivisionError):
                delta_pct = None

        status = "ok"
        try:
            if norm["min"] is not None and last["value"] < norm["min"]:
                status = "low"
            elif norm["max"] is not None and last["value"] > norm["max"]:
                status = "high"
        except TypeError:
            pass

        result.append({
            "name": name,
            "icon": norm.get("icon", "📊"),
            "unit": norm.get("unit") or last.get("unit", ""),
            "norm_min": norm.get("min"),
            "norm_max": norm.get("max"),
            "points": points,
            "last_value": last["value"],
            "last_date": last["date"],
            "delta_pct": delta_pct,
            "status": status,
            "count": len(points),
        })

    # Сначала проблемные показатели (low/high), потом ok
    result.sort(key=lambda a: (0 if a["status"] != "ok" else 1, a["name"]))

    return {"months": months, "analytes": result, "is_demo": is_demo and not any(True for _ in [])}
