"""
Глава: Электронная медкарта пациента — агрегатор данных.

Endpoint:
  GET /patient/medical-record?t=<patient_session_token>

Возвращает единый снимок здоровья пациента: профиль, антропометрия,
аллергии, активные диагнозы, текущие назначения, история визитов
(наши + МИС), последние анализы, документы, направления, прививки.

Не отдельная сущность — unified view над:
  - patient_accounts
  - appointments (наша БД)
  - МИС Renovatio (get_patient_from_mis / get_patient_appointments_from_mis)
  - lab_results / patient_lab_dynamics
  - patient_documents, patient_prescription_cache
  - referrals
"""
from datetime import datetime, date, timedelta
from typing import Optional
import io

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Header
from fastapi.responses import StreamingResponse
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.patient_session_service import restore_session
from app.services.mis_sync_service import (
    get_patient_from_mis,
    get_patient_appointments_from_mis,
)
from app.services.settings_service import get_setting
from app.services import family_service as fs
from app.models.patient_account import PatientAccount
from app.routers.patient_lab_dynamics import get_lab_dynamics


router = APIRouter(prefix="/patient/medical-record", tags=["patient-emr"])


def _safe_iso(d) -> Optional[str]:
    if d is None:
        return None
    try:
        return d.isoformat()
    except Exception:
        return str(d)


def _phone_variants(phone: str) -> list[str]:
    """Возвращает варианты телефона для матчинга в БД (с/без '+')."""
    if not phone:
        return []
    p = phone.strip()
    out = {p}
    if p.startswith("+"):
        out.add(p[1:])
    else:
        out.add("+" + p)
    # Россия: 8XXXXXXXXXX → +7XXXXXXXXXX
    digits = "".join(ch for ch in p if ch.isdigit())
    if len(digits) == 11 and digits.startswith("8"):
        out.add("+7" + digits[1:])
        out.add("7" + digits[1:])
    return list(out)


@router.get("")
async def medical_record(
    request: Request,
    t: Optional[str] = Query(None, description="patient_session_token"),
    authorization: Optional[str] = Header(None),
    x_patient_session: Optional[str] = Header(None, alias="X-Patient-Session"),
    db: AsyncSession = Depends(get_db),
):
    """Электронная медкарта — агрегатор всех источников данных пациента."""
    # ── 1. Авторизация ────────────────────────────────────────────────
    token = t
    if not token and authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(None, 1)[1].strip()
    if not token:
        token = x_patient_session
    if not token:
        token = request.cookies.get("clinika_patient_session")
    if not token:
        raise HTTPException(401, "Patient session required")

    session = await restore_session(db, token)
    if not session:
        raise HTTPException(401, "Session invalid or expired")

    phone = session.phone
    tenant_id = session.tenant_id
    phones = _phone_variants(phone)

    # ── 2. Profile из patient_accounts ────────────────────────────────
    pa = (await db.execute(
        select(PatientAccount).where(PatientAccount.phone.in_(phones))
    )).scalars().first()
    if not pa:
        # Тихо — даём минимальный профиль на основе сессии (на случай отсутствия аккаунта)
        profile = {
            "patient_id": None,
            "phone": phone,
            "name": None,
            "email": None,
            "birth_date": None,
            "sex": None,
            "address": None,
            "mis_patient_id": None,
        }
    else:
        profile = {
            "patient_id": str(pa.id),
            "phone": pa.phone,
            "name": pa.name,
            "email": pa.email,
            "birth_date": _safe_iso(pa.birth_date),
            "sex": None,
            "address": None,
            "mis_patient_id": None,
        }

    # ── 3. МИС-данные (для enrichment и для visits) ───────────────────
    mis_data = None
    mis_appts: list[dict] = []
    api_url = api_key = ""
    if tenant_id:
        try:
            api_url = await get_setting(db, "mis_api_url", "", tenant_id=tenant_id)
            api_key = await get_setting(db, "mis_api_key", "", tenant_id=tenant_id)
        except Exception:
            api_url = api_key = ""

    if api_url and api_key:
        try:
            mis_data = await get_patient_from_mis(phone, api_url=api_url, api_key=api_key)
        except Exception:
            mis_data = None
        try:
            mis_appts = await get_patient_appointments_from_mis(
                phone, months_back=24, api_url=api_url, api_key=api_key
            ) or []
        except Exception:
            mis_appts = []

    if mis_data and isinstance(mis_data, dict):
        if not profile.get("sex"):
            profile["sex"] = mis_data.get("sex") or mis_data.get("gender")
        if not profile.get("address"):
            addr = mis_data.get("address")
            if isinstance(addr, dict):
                # МИС может вернуть address как объект {city, street, house, ...}
                full = addr.get("fullAddress") or ", ".join(
                    str(v) for k, v in [
                        ("city", addr.get("city")),
                        ("district", addr.get("district")),
                        ("street", addr.get("street")),
                        ("house", addr.get("house")),
                        ("building", addr.get("building")),
                        ("flat", addr.get("flat")),
                    ] if v
                )
                profile["address"] = full or None
            elif isinstance(addr, str):
                profile["address"] = addr
        if not profile.get("mis_patient_id"):
            profile["mis_patient_id"] = (
                mis_data.get("patient_id") or mis_data.get("id") or mis_data.get("client_id")
            )
        if not profile.get("birth_date") and mis_data.get("birthdate"):
            for fmt in ("%d.%m.%Y", "%Y-%m-%d"):
                try:
                    profile["birth_date"] = datetime.strptime(
                        mis_data["birthdate"], fmt
                    ).date().isoformat()
                    break
                except Exception:
                    continue
        if not profile.get("email") and mis_data.get("email"):
            profile["email"] = mis_data["email"]
        if not profile.get("name"):
            fn = (mis_data.get("firstname") or mis_data.get("name") or "").strip()
            ln = (mis_data.get("lastname") or mis_data.get("surname") or "").strip()
            mn = (mis_data.get("middlename") or mis_data.get("patronymic") or "").strip()
            full = " ".join(x for x in (ln, fn, mn) if x).strip()
            profile["name"] = full or None

    # ── 4. Антропометрия — из МИС ─────────────────────────────────────
    anthropometry = None
    if mis_data and isinstance(mis_data, dict):
        h = mis_data.get("height")
        w = mis_data.get("weight")
        bt = mis_data.get("blood_type") or mis_data.get("bloodgroup") or mis_data.get("blood_group")
        if h or w or bt:
            bmi = None
            try:
                if h and w:
                    bmi = round(float(w) / ((float(h) / 100) ** 2), 1)
            except Exception:
                bmi = None
            anthropometry = {"height": h, "weight": w, "bmi": bmi, "blood_type": bt}

    # ── 5. Visits — наши appointments ─────────────────────────────────
    visits: list[dict] = []
    try:
        appts_rows = (await db.execute(text("""
            SELECT a.id,
                   a.appointment_date,
                   a.start_time,
                   a.status,
                   a.notes,
                   d.full_name      AS doctor_name,
                   d.specialty      AS doctor_specialty,
                   s.name           AS service_name,
                   c.name           AS clinic_name
            FROM appointments a
            LEFT JOIN doctors  d ON d.id = a.doctor_id
            LEFT JOIN clinics  c ON c.id = a.clinic_id
            LEFT JOIN referrals r ON r.id = a.referral_id
            LEFT JOIN services s ON s.id = r.service_id
            WHERE a.patient_phone = ANY(:phones)
            ORDER BY a.appointment_date DESC, a.start_time DESC
            LIMIT 50
        """), {"phones": phones})).all()
        for r in appts_rows:
            visits.append({
                "date": _safe_iso(r.appointment_date),
                "time": str(r.start_time)[:5] if r.start_time else None,
                "doctor": r.doctor_name,
                "service": r.service_name or r.doctor_specialty or "Приём",
                "clinic": r.clinic_name,
                "status": str(r.status) if r.status is not None else None,
                "notes": r.notes,
                "source": "local",
            })
    except Exception:
        pass

    # ── 6. Visits — МИС ───────────────────────────────────────────────
    for a in (mis_appts or [])[:50]:
        try:
            ts = a.get("time_start") or a.get("start_time") or a.get("date") or ""
            ts = str(ts) if ts else ""
            day = ts[:10] if len(ts) >= 10 else None
            tm = ts[11:16] if len(ts) >= 16 else None
            visits.append({
                "date": day,
                "time": tm,
                "doctor": a.get("doctor_fullname") or a.get("doctor") or a.get("doctor_name"),
                "service": a.get("service_name") or a.get("service") or a.get("title"),
                "clinic": a.get("clinic_name") or a.get("clinic"),
                "status": a.get("status"),
                "notes": a.get("comment") or a.get("conclusion") or a.get("notes"),
                "source": "mis",
            })
        except Exception:
            continue

    # Dedup + sort
    seen = set()
    visits_unique: list[dict] = []
    for v in sorted(visits, key=lambda x: (x.get("date") or "", x.get("time") or ""), reverse=True):
        key = (v.get("date"), v.get("time"), v.get("doctor"), v.get("service"))
        if key in seen:
            continue
        seen.add(key)
        visits_unique.append(v)
    visits = visits_unique[:30]

    # ── 7. Lab-результаты (последние 5) ───────────────────────────────
    recent_labs: list[dict] = []
    try:
        dyn = await get_lab_dynamics(
            request=request,
            months=12,
            t=token,
            authorization=authorization,
            x_patient_session=x_patient_session,
            db=db,
        )
        for an in (dyn.get("analytes") or [])[:5]:
            recent_labs.append({
                "name": an.get("name"),
                "value": an.get("last_value"),
                "unit": an.get("unit"),
                "date": an.get("last_date"),
                "status": an.get("status"),
                "icon": an.get("icon"),
            })
    except Exception:
        recent_labs = []

    # ── 8. Документы пациента ─────────────────────────────────────────
    documents: list[dict] = []
    try:
        docs_rows = (await db.execute(text("""
            SELECT id, doc_type, category, title, filename,
                   description, issued_at, created_at
            FROM patient_documents
            WHERE patient_phone = ANY(:phones)
              AND deleted_at IS NULL
            ORDER BY COALESCE(issued_at, created_at) DESC
            LIMIT 20
        """), {"phones": phones})).all()
        for d in docs_rows:
            documents.append({
                "id": str(d.id),
                "type": d.category or d.doc_type or "other",
                "title": d.title or d.filename or "Документ",
                "doctor": None,
                "date": _safe_iso(d.issued_at or d.created_at),
                "url": f"/patient/documents/{d.id}/download?t={token}",
            })
    except Exception:
        pass

    # ── 9. Направления ────────────────────────────────────────────────
    referrals_list: list[dict] = []
    try:
        ref_rows = (await db.execute(text("""
            SELECT r.short_code,
                   r.status,
                   r.created_at,
                   s.name AS service_name,
                   c.name AS target_clinic
            FROM referrals r
            LEFT JOIN services s ON s.id = r.service_id
            LEFT JOIN clinics  c ON c.id = r.to_clinic_id
            WHERE r.patient_phone = ANY(:phones)
              AND r.short_code IS NOT NULL
            ORDER BY r.created_at DESC
            LIMIT 20
        """), {"phones": phones})).all()
        for r in ref_rows:
            referrals_list.append({
                "short_code": r.short_code,
                "status": str(r.status) if r.status is not None else None,
                "created_at": _safe_iso(r.created_at),
                "service": r.service_name,
                "target_clinic": r.target_clinic,
            })
    except Exception:
        pass

    # ── 10. Назначения из patient_prescription_cache (МИС-кэш) ────────
    prescriptions_active: list[dict] = []
    try:
        presc_rows = (await db.execute(text("""
            SELECT drug_name, dosage, frequency, duration,
                   prescribed_at, doctor_name
            FROM patient_prescription_cache
            WHERE patient_phone = ANY(:phones)
            ORDER BY COALESCE(prescribed_at, cached_at) DESC
            LIMIT 20
        """), {"phones": phones})).all()
        for p in presc_rows:
            schedule_parts = [x for x in (p.frequency, p.duration) if x]
            prescriptions_active.append({
                "drug": p.drug_name,
                "dose": p.dosage,
                "schedule": " · ".join(schedule_parts) if schedule_parts else None,
                "prescribed_at": _safe_iso(p.prescribed_at),
                "doctor": p.doctor_name,
            })
    except Exception:
        pass

    # ── 11. Аллергии / диагнозы / прививки из МИС, либо demo ──────────
    allergies: list[dict] = []
    diagnoses_active: list[dict] = []
    vaccinations: list[dict] = []

    if mis_data and isinstance(mis_data, dict):
        a_raw = mis_data.get("allergies") or mis_data.get("allergy")
        if isinstance(a_raw, str) and a_raw.strip():
            for item in a_raw.split(","):
                name = item.strip()
                if name:
                    allergies.append({"name": name, "severity": "—"})
        elif isinstance(a_raw, list):
            for item in a_raw:
                if isinstance(item, dict):
                    allergies.append({
                        "name": item.get("name") or item.get("title") or str(item),
                        "severity": item.get("severity") or "—",
                    })
                else:
                    allergies.append({"name": str(item), "severity": "—"})

        d_raw = mis_data.get("diagnoses") or mis_data.get("diagnosis")
        if isinstance(d_raw, list):
            for item in d_raw:
                if isinstance(item, dict):
                    diagnoses_active.append({
                        "code": item.get("code") or item.get("mkb"),
                        "name": item.get("name") or item.get("title") or "",
                        "since": item.get("since") or item.get("date"),
                        "doctor": item.get("doctor") or item.get("doctor_name"),
                    })

        v_raw = mis_data.get("vaccinations") or mis_data.get("vaccines")
        if isinstance(v_raw, list):
            for item in v_raw:
                if isinstance(item, dict):
                    vaccinations.append({
                        "name": item.get("name") or item.get("title") or "",
                        "date": item.get("date") or item.get("at"),
                        "lot": item.get("lot") or item.get("series"),
                    })

    # Demo для тест-пациента (Гудаев)
    is_demo = phone in ("+79280037547", "79280037547", "9280037547")
    if is_demo:
        if not allergies:
            allergies = [
                {"name": "Пыльца берёзы", "severity": "лёгкая"},
                {"name": "Пенициллин",    "severity": "тяжёлая"},
            ]
        if not diagnoses_active:
            diagnoses_active = [
                {
                    "code": "K29",
                    "name": "Хронический гастрит",
                    "since": "2024-03-15",
                    "doctor": "Гастроэнтеролог",
                },
            ]
        if not prescriptions_active:
            prescriptions_active = [
                {
                    "drug": "Омепразол 20 мг",
                    "dose": "1 капсула утром",
                    "schedule": "до завтрака · 30 дней",
                    "prescribed_at": "2026-04-10",
                    "doctor": "Гастроэнтеролог",
                },
            ]
        if not vaccinations:
            vaccinations = [
                {"name": "COVID-19 (Спутник V)", "date": "2024-09-12", "lot": "M-3942"},
                {"name": "Грипп сезонный",       "date": "2025-10-05", "lot": "GR-2025-A"},
            ]

    return {
        "profile": profile,
        "anthropometry": anthropometry,
        "visits": visits,
        "diagnoses_active": diagnoses_active,
        "diagnoses_history": [],
        "prescriptions_active": prescriptions_active,
        "allergies": allergies,
        "recent_labs": recent_labs,
        "documents": documents,
        "referrals": referrals_list,
        "vaccinations": vaccinations,
        "generated_at": datetime.utcnow().isoformat(),
    }


# ─────────────────────────────────────────────────────────────────────
# PDF EXPORT
# ─────────────────────────────────────────────────────────────────────

def _render_emr_html(data: dict) -> str:
    """Собирает HTML медкарты для WeasyPrint."""
    p = data["profile"]
    age_str = ""
    if p.get("birth_date"):
        try:
            bd = date.fromisoformat(p["birth_date"])
            today = date.today()
            age = today.year - bd.year - ((today.month, today.day) < (bd.month, bd.day))
            age_str = f" · {age} лет"
        except Exception:
            pass

    def section(title, content):
        if not content or not content.strip():
            return ""
        return f'<div class="section"><h2>{title}</h2>{content}</div>'

    # Аллергии
    allergies_html = ""
    if data.get("allergies"):
        items = "".join(
            f'<span class="allergy-chip">{a["name"]}{" · " + a["severity"] if a.get("severity") and a["severity"] != "—" else ""}</span>'
            for a in data["allergies"]
        )
        allergies_html = f'<div class="allergies-block"><strong>🚨 Аллергии:</strong> {items}</div>'

    # Диагнозы
    diag_html = ""
    if data.get("diagnoses_active"):
        rows = "".join(
            f'<tr><td class="code">{d.get("code","") or "—"}</td><td><strong>{d["name"]}</strong></td><td class="muted">{d.get("doctor","") or ""}</td><td class="muted">{d.get("since","") or ""}</td></tr>'
            for d in data["diagnoses_active"]
        )
        diag_html = f'<table><thead><tr><th>МКБ</th><th>Диагноз</th><th>Врач</th><th>С даты</th></tr></thead><tbody>{rows}</tbody></table>'

    # Назначения
    presc_html = ""
    if data.get("prescriptions_active"):
        rows = "".join(
            f'<tr><td><strong>{pr["drug"]}</strong></td><td>{pr.get("dose","") or ""}</td><td>{pr.get("schedule","") or ""}</td><td class="muted">{pr.get("doctor","") or ""}</td><td class="muted">{pr.get("prescribed_at","") or ""}</td></tr>'
            for pr in data["prescriptions_active"]
        )
        presc_html = f'<table><thead><tr><th>Препарат</th><th>Доза</th><th>Схема</th><th>Назначил</th><th>Дата</th></tr></thead><tbody>{rows}</tbody></table>'

    # Визиты
    visits_html = ""
    if data.get("visits"):
        rows = "".join(
            f'<tr><td>{v.get("date","") or ""}{(" " + v["time"]) if v.get("time") else ""}</td><td><strong>{v.get("service","Приём") or "Приём"}</strong></td><td>{v.get("doctor","") or "—"}</td><td class="muted">{v.get("clinic","") or "—"}</td><td class="muted">{v.get("status","") or ""}</td></tr>'
            for v in data["visits"][:20]
        )
        visits_html = f'<table><thead><tr><th>Дата</th><th>Услуга</th><th>Врач</th><th>Клиника</th><th>Статус</th></tr></thead><tbody>{rows}</tbody></table>'

    # Анализы
    labs_html = ""
    if data.get("recent_labs"):
        status_map = {"ok": "в норме", "high": "повышен", "low": "понижен"}
        rows = "".join(
            f'<tr><td>{l.get("icon","") or ""} <strong>{l["name"]}</strong></td><td class="num">{l.get("value","") or ""} {l.get("unit","") or ""}</td><td class="muted">{l.get("date","") or ""}</td><td><span class="status-{l.get("status","ok") or "ok"}">{status_map.get(l.get("status"), "")}</span></td></tr>'
            for l in data["recent_labs"]
        )
        labs_html = f'<table><thead><tr><th>Показатель</th><th>Значение</th><th>Дата</th><th>Статус</th></tr></thead><tbody>{rows}</tbody></table>'

    # Прививки
    vacc_html = ""
    if data.get("vaccinations"):
        rows = "".join(
            f'<tr><td><strong>{v["name"]}</strong></td><td>{v.get("date","") or ""}</td><td class="muted">{v.get("lot","") or ""}</td></tr>'
            for v in data["vaccinations"]
        )
        vacc_html = f'<table><thead><tr><th>Прививка</th><th>Дата</th><th>Партия</th></tr></thead><tbody>{rows}</tbody></table>'

    address_html = ""
    if p.get("address"):
        addr = p["address"]
        if isinstance(addr, dict):
            addr = addr.get("fullAddress") or ", ".join(str(v) for v in [addr.get("city"), addr.get("street"), addr.get("house")] if v)
        if addr:
            address_html = f'<div class="muted">📍 {addr}</div>'

    sex_html = ""
    if p.get("sex") in ("m", "f"):
        sex_html = " · " + ("М" if p.get("sex") == "m" else "Ж")

    email_html = (' · ✉ ' + p['email']) if p.get('email') else ''
    mis_html = ('<br/>МИС ID: ' + str(p['mis_patient_id'])) if p.get('mis_patient_id') else ''
    avatar_letter = (p.get('name') or '?').split(' ')[0][0:1].upper() if (p.get('name') or '?') else '?'
    generated = (data.get('generated_at', '') or '')[:19].replace('T', ' ')

    return f"""
    <!doctype html>
    <html lang="ru">
    <head>
      <meta charset="utf-8"/>
      <title>Медкарта — {p.get('name', '') or ''}</title>
      <style>
        @page {{ size: A4; margin: 18mm 14mm; @bottom-right {{ content: "Стр. " counter(page) " / " counter(pages); font-size: 9pt; color: #94a3b8; }} }}
        * {{ box-sizing: border-box; }}
        body {{ font-family: -apple-system, "Inter", "Segoe UI", "Roboto", sans-serif; color: #0f172a; font-size: 11pt; line-height: 1.5; }}
        h1 {{ font-size: 22pt; margin: 0 0 4pt; }}
        h2 {{ font-size: 13pt; margin: 18pt 0 8pt; padding-bottom: 4pt; border-bottom: 2px solid #0097A7; color: #0A2342; }}
        .header {{ background: linear-gradient(135deg, #0A2342, #0097A7); color: #fff; padding: 14pt 16pt; border-radius: 14pt; margin-bottom: 16pt; display: flex; align-items: center; gap: 14pt; }}
        .header .avatar {{ width: 54pt; height: 54pt; border-radius: 12pt; background: rgba(255,255,255,.18); display: flex; align-items: center; justify-content: center; font-size: 22pt; font-weight: 800; }}
        .header .name {{ font-size: 16pt; font-weight: 700; }}
        .header .meta {{ font-size: 10pt; opacity: 0.92; margin-top: 4pt; }}
        .section {{ margin-bottom: 12pt; }}
        table {{ width: 100%; border-collapse: collapse; font-size: 9.5pt; }}
        th {{ background: #ECFEFF; color: #0A2342; text-align: left; padding: 6pt 8pt; border-bottom: 1px solid #06B6D4; font-weight: 600; }}
        td {{ padding: 6pt 8pt; border-bottom: 1px solid #e2e8f0; }}
        td.muted {{ color: #64748b; font-size: 9pt; }}
        td.code {{ font-family: monospace; background: #fef3c7; font-size: 9pt; }}
        td.num {{ font-weight: 700; font-size: 11pt; }}
        .status-ok {{ color: #16a34a; font-weight: 600; }}
        .status-high {{ color: #dc2626; font-weight: 600; }}
        .status-low {{ color: #f59e0b; font-weight: 600; }}
        .allergies-block {{ background: #fee2e2; border-left: 4px solid #dc2626; padding: 10pt 12pt; border-radius: 8pt; margin-bottom: 14pt; font-size: 10pt; }}
        .allergy-chip {{ display: inline-block; background: #fecaca; color: #991b1b; border-radius: 14pt; padding: 3pt 10pt; font-size: 9pt; font-weight: 600; margin: 2pt 4pt 2pt 0; }}
        .footer {{ margin-top: 24pt; font-size: 8.5pt; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 10pt; }}
        .muted {{ color: #64748b; }}
      </style>
    </head>
    <body>
      <div class="header">
        <div class="avatar">{avatar_letter}</div>
        <div>
          <div class="name">{p.get('name', '—') or '—'}</div>
          <div class="meta">
            {p.get('birth_date','') or ''}{age_str}{sex_html}
            <br/>📞 {p.get('phone','') or ''}{email_html}
            {mis_html}
          </div>
        </div>
      </div>
      {address_html}
      {allergies_html}
      {section('🩺 Активные диагнозы', diag_html)}
      {section('💊 Текущие назначения', presc_html)}
      {section('🧪 Последние анализы', labs_html)}
      {section('📅 История визитов (последние 20)', visits_html)}
      {section('💉 Прививки', vacc_html)}
      <div class="footer">
        КлиникСеть — единая электронная медкарта<br/>
        Сформировано: {generated}
      </div>
    </body>
    </html>
    """


@router.get("/pdf")
async def medical_record_pdf(
    request: Request,
    t: Optional[str] = Query(None, description="patient_session_token"),
    authorization: Optional[str] = Header(None),
    x_patient_session: Optional[str] = Header(None, alias="X-Patient-Session"),
    db: AsyncSession = Depends(get_db),
):
    """Скачать медкарту как PDF."""
    # Переиспользуем агрегатор
    data = await medical_record(
        request=request,
        t=t,
        authorization=authorization,
        x_patient_session=x_patient_session,
        db=db,
    )

    # Если data это Response (FastAPI уже сериализовал) — распакуем
    if hasattr(data, 'body'):
        import json
        data = json.loads(data.body)

    html = _render_emr_html(data)

    try:
        from weasyprint import HTML
        pdf_bytes = HTML(string=html).write_pdf()
    except Exception as e:
        import logging
        logging.exception("PDF generation failed")
        raise HTTPException(500, f"Не удалось сгенерировать PDF: {str(e)[:100]}")

    phone_clean = (data.get("profile", {}).get("phone", "patient") or "patient").lstrip("+") or "patient"
    fname = f"medcard_{phone_clean}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )
