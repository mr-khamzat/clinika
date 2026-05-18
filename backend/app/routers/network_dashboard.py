"""Сводная панель сети клиник — обзор и PDF-экспорт.

Доступно: director / deputy_director / franchise_owner / super_admin.
Скоуп:
- Если у пользователя есть `tenant.franchise_id` → агрегируем все клиники этой франшизы.
- Иначе → одна клиника (его tenant_id).
"""
import io
import uuid
from datetime import datetime, timedelta, date
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import require_director_or_owner
from app.models.user import User
from app.models.tenant import Tenant
from app.models.engagement import NpsResponse

router = APIRouter(prefix="/network", tags=["network-dashboard"])


# ============================================================
# Helpers
# ============================================================

async def _scope_tenants(db: AsyncSession, user: User) -> list[Tenant]:
    """Возвращает список клиник в скоупе пользователя.

    franchise_owner: все тенанты его франшизы.
    director / deputy_director: тенанты той же франшизы (если есть), иначе — только свой tenant.
    super_admin: только свой tenant_id (если не задан — нечего показать).
    """
    if not user.tenant_id:
        return []
    me = (await db.execute(select(Tenant).where(Tenant.id == user.tenant_id))).scalar_one_or_none()
    if not me:
        return []
    if me.franchise_id:
        rows = (await db.execute(
            select(Tenant).where(Tenant.franchise_id == me.franchise_id).order_by(Tenant.created_at.asc())
        )).scalars().all()
        return list(rows)
    return [me]


async def _clinic_metrics(db: AsyncSession, tenant_id: uuid.UUID, days: int = 30) -> dict:
    """Метрики одной клиники за период."""
    since = datetime.utcnow() - timedelta(days=days)

    # Revenue + visits — из appointments
    rev_row = (await db.execute(text("""
        SELECT
            COALESCE(SUM(price), 0)::float AS revenue,
            COUNT(*)::int                  AS visits
        FROM appointments
        WHERE tenant_id = :tid AND created_at >= :since
    """), {"tid": str(tenant_id), "since": since})).one()

    # Новые ЛК-пациенты — patient_accounts создавшиеся за период (по факту регистрации)
    new_lk_row = (await db.execute(text("""
        SELECT COUNT(*)::int AS c FROM patient_accounts
        WHERE created_at >= :since
          AND EXISTS (SELECT 1 FROM appointments a WHERE a.tenant_id = :tid AND a.patient_phone = patient_accounts.phone)
    """), {"tid": str(tenant_id), "since": since})).one()

    # Активные в ЛК за период (last_seen в окне)
    active_lk_row = (await db.execute(text("""
        SELECT COUNT(*)::int AS c FROM patient_accounts
        WHERE last_seen_at >= :since
          AND EXISTS (SELECT 1 FROM appointments a WHERE a.tenant_id = :tid AND a.patient_phone = patient_accounts.phone)
    """), {"tid": str(tenant_id), "since": since})).one()

    # NPS (среднее за 90 дней)
    nps_since = datetime.utcnow() - timedelta(days=90)
    nps_row = (await db.execute(
        select(func.coalesce(func.avg(NpsResponse.score), 0.0), func.count(NpsResponse.id))
        .where(NpsResponse.tenant_id == tenant_id, NpsResponse.created_at >= nps_since)
    )).one()
    avg_nps = float(nps_row[0] or 0)
    nps_count = int(nps_row[1] or 0)

    # Динамика выручки по дням
    daily_rev = (await db.execute(text("""
        SELECT DATE_TRUNC('day', created_at)::date AS d,
               COALESCE(SUM(price), 0)::float AS rev
        FROM appointments
        WHERE tenant_id = :tid AND created_at >= :since
        GROUP BY d ORDER BY d ASC
    """), {"tid": str(tenant_id), "since": since})).all()

    return {
        "revenue":      float(rev_row.revenue or 0),
        "visits":       int(rev_row.visits or 0),
        "new_lk":       int(new_lk_row.c or 0),
        "active_lk":    int(active_lk_row.c or 0),
        "avg_nps":      round(avg_nps, 2),
        "nps_count":    nps_count,
        "daily_revenue": [{"date": str(r.d), "value": float(r.rev)} for r in daily_rev],
    }


async def _build_overview(db: AsyncSession, user: User, days: int = 30) -> dict:
    """Собирает данные для дашборда: per-clinic + totals."""
    tenants = await _scope_tenants(db, user)
    if not tenants:
        return {"clinics": [], "totals": {}, "scope": "empty", "days": days, "generated_at": datetime.utcnow().isoformat()}

    clinics_out: list[dict] = []
    total_revenue = 0.0
    total_visits = 0
    total_new_lk = 0
    total_active_lk = 0
    nps_sum_weighted = 0.0
    nps_total_count = 0

    # Сводный daily revenue по сети
    network_daily: dict[str, float] = {}

    for t in tenants:
        m = await _clinic_metrics(db, t.id, days)
        clinics_out.append({
            "tenant_id":  str(t.id),
            "slug":       getattr(t, "slug", None),
            "name":       getattr(t, "name", None),
            **m,
        })
        total_revenue   += m["revenue"]
        total_visits    += m["visits"]
        total_new_lk    += m["new_lk"]
        total_active_lk += m["active_lk"]
        nps_sum_weighted += m["avg_nps"] * m["nps_count"]
        nps_total_count  += m["nps_count"]
        for d in m["daily_revenue"]:
            network_daily[d["date"]] = network_daily.get(d["date"], 0.0) + d["value"]

    network_daily_arr = sorted(
        [{"date": k, "value": v} for k, v in network_daily.items()],
        key=lambda x: x["date"],
    )

    avg_nps_network = (nps_sum_weighted / nps_total_count) if nps_total_count else 0.0

    # Топ-клиника по выручке
    top_revenue = max(clinics_out, key=lambda c: c["revenue"]) if clinics_out else None

    return {
        "scope": "franchise" if len(tenants) > 1 else "single",
        "days": days,
        "totals": {
            "clinics":     len(clinics_out),
            "revenue":     round(total_revenue, 2),
            "visits":      total_visits,
            "new_lk":      total_new_lk,
            "active_lk":   total_active_lk,
            "avg_nps":     round(avg_nps_network, 2),
            "nps_count":   nps_total_count,
            "top_clinic":  {"name": top_revenue["name"], "revenue": top_revenue["revenue"]} if top_revenue else None,
        },
        "clinics": clinics_out,
        "network_daily_revenue": network_daily_arr,
        "generated_at": datetime.utcnow().isoformat(),
    }


# ============================================================
# Endpoints
# ============================================================

@router.get("/overview")
async def network_overview(
    days: int = Query(30, ge=1, le=365),
    user: User = Depends(require_director_or_owner),
    db: AsyncSession = Depends(get_db),
):
    """Сводная панель сети клиник: KPI + per-clinic метрики + динамика выручки."""
    return await _build_overview(db, user, days)


@router.get("/overview/export-pdf")
async def export_overview_pdf(
    days: int = Query(30, ge=1, le=365),
    user: User = Depends(require_director_or_owner),
    db: AsyncSession = Depends(get_db),
):
    """Генерирует PDF-отчёт «Сводная панель сети клиник» через WeasyPrint."""
    data = await _build_overview(db, user, days)
    html = _render_html(data)
    try:
        from weasyprint import HTML
    except ImportError:
        raise HTTPException(500, "WeasyPrint не установлен на бекенде")
    pdf_bytes = HTML(string=html).write_pdf()
    fname = f"network-dashboard-{date.today().isoformat()}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# ============================================================
# HTML template
# ============================================================

def _fmt_money(v: float) -> str:
    return f"{int(v):,}".replace(",", " ") + " ₽"


def _bar(value: float, max_value: float, color: str = "#0891b2") -> str:
    pct = (value / max_value * 100) if max_value > 0 else 0
    return f'<div style="background:#e5e7eb;border-radius:4px;height:10px;width:120px;overflow:hidden;"><div style="background:{color};width:{pct:.1f}%;height:10px;"></div></div>'


def _render_html(data: dict) -> str:
    """HTML для WeasyPrint."""
    totals = data.get("totals", {})
    clinics = data.get("clinics", [])
    daily = data.get("network_daily_revenue", [])
    days = data.get("days", 30)

    # SVG: dynamic revenue line chart
    chart_svg = ""
    if daily:
        max_v = max((d["value"] for d in daily), default=0) or 1
        width, height = 520, 120
        pad_l, pad_r, pad_t, pad_b = 40, 10, 12, 24
        plot_w = width - pad_l - pad_r
        plot_h = height - pad_t - pad_b
        n = len(daily)
        if n > 1:
            points = []
            for i, d in enumerate(daily):
                x = pad_l + (i / (n - 1)) * plot_w
                y = pad_t + plot_h - (d["value"] / max_v) * plot_h
                points.append(f"{x:.1f},{y:.1f}")
            poly = " ".join(points)
            # area fill
            area = f"M {pad_l} {pad_t + plot_h} L " + " L ".join(points) + f" L {pad_l + plot_w} {pad_t + plot_h} Z"
            chart_svg = f'''
<svg width="100%" height="{height}" viewBox="0 0 {width} {height}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="{width}" height="{height}" fill="#fff"/>
  <text x="{width/2}" y="10" font-size="9" fill="#374151" text-anchor="middle" font-weight="bold">Выручка сети по дням</text>
  <line x1="{pad_l}" y1="{pad_t + plot_h}" x2="{pad_l + plot_w}" y2="{pad_t + plot_h}" stroke="#94a3b8" stroke-width="0.5"/>
  <line x1="{pad_l}" y1="{pad_t}" x2="{pad_l}" y2="{pad_t + plot_h}" stroke="#94a3b8" stroke-width="0.5"/>
  <text x="{pad_l - 4}" y="{pad_t + 4}" font-size="7" fill="#64748b" text-anchor="end">{_fmt_money(max_v)}</text>
  <text x="{pad_l - 4}" y="{pad_t + plot_h}" font-size="7" fill="#64748b" text-anchor="end">0</text>
  <path d="{area}" fill="#bae6fd" opacity="0.5"/>
  <polyline points="{poly}" fill="none" stroke="#0891b2" stroke-width="1.5"/>
  <text x="{pad_l}" y="{height - 6}" font-size="7" fill="#64748b">{daily[0]['date']}</text>
  <text x="{pad_l + plot_w}" y="{height - 6}" font-size="7" fill="#64748b" text-anchor="end">{daily[-1]['date']}</text>
</svg>'''

    # Bar chart: revenue by clinic
    bar_svg = ""
    if clinics:
        max_rev = max((c["revenue"] for c in clinics), default=0) or 1
        bar_h = 24
        height = max(80, len(clinics) * (bar_h + 6) + 30)
        width = 540
        bar_x = 180
        bar_max_w = 280
        items = []
        for i, c in enumerate(clinics):
            y = 30 + i * (bar_h + 6)
            w = (c["revenue"] / max_rev) * bar_max_w
            name = (c["name"] or "—")[:24]
            items.append(f'''<text x="10" y="{y + bar_h*0.6 + 2}" font-size="9" fill="#374151">{name}</text>
<rect x="{bar_x}" y="{y}" width="{w:.1f}" height="{bar_h}" fill="#0891b2" rx="3"/>
<text x="{bar_x + w + 6}" y="{y + bar_h*0.6 + 2}" font-size="9" fill="#0c4a6e" font-weight="bold">{_fmt_money(c["revenue"])}</text>''')
        bars_html = "\n".join(items)
        bar_svg = f'''
<svg width="100%" height="{height}" viewBox="0 0 {width} {height}" xmlns="http://www.w3.org/2000/svg">
  <text x="{width/2}" y="14" font-size="10" fill="#1f2937" text-anchor="middle" font-weight="bold">Сравнение клиник по выручке</text>
  {bars_html}
</svg>'''

    # Table per clinic
    rows = ""
    if clinics:
        max_rev = max((c["revenue"] for c in clinics), default=0) or 1
        for c in clinics:
            rows += f"""<tr>
  <td>{(c['name'] or '—')}</td>
  <td class="right">{_fmt_money(c['revenue'])}</td>
  <td class="right">{c['visits']:,}</td>
  <td class="right">{c['active_lk']:,}</td>
  <td class="right">{c['new_lk']:,}</td>
  <td class="right">{c['avg_nps']:.1f} ({c['nps_count']})</td>
</tr>""".replace(",", " ")

    top = totals.get("top_clinic") or {}
    return f"""<!DOCTYPE html>
<html lang="ru"><head><meta charset="UTF-8"><style>
@page {{ size: A4; margin: 1.5cm; @bottom-right {{ content: counter(page) "/" counter(pages); font-size: 8pt; color: #999; }} }}
body {{ font-family: 'DejaVu Sans', sans-serif; color: #1f2937; font-size: 10pt; }}
h1 {{ font-size: 20pt; color: #0891b2; margin: 0 0 4pt 0; }}
h2 {{ font-size: 13pt; color: #0e7490; margin: 16pt 0 6pt 0; border-bottom: 2px solid #06b6d4; padding-bottom: 2pt; }}
.meta {{ color: #6b7280; font-size: 9pt; margin-bottom: 12pt; }}
.grid {{ display: flex; flex-wrap: wrap; gap: 8pt; margin: 8pt 0; }}
.kpi {{ flex: 1; min-width: 100pt; background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6pt; padding: 8pt; text-align: center; }}
.kpi .v {{ font-size: 18pt; font-weight: 800; color: #0c4a6e; }}
.kpi .l {{ font-size: 8.5pt; color: #475569; margin-top: 2pt; }}
table {{ width: 100%; border-collapse: collapse; margin: 6pt 0; font-size: 9.5pt; }}
th, td {{ padding: 4pt 6pt; text-align: left; border-bottom: 1px solid #e5e7eb; }}
th {{ background: #f1f5f9; color: #334155; font-weight: 700; }}
td.right, th.right {{ text-align: right; }}
.top-clinic {{ background: #fef3c7; padding: 6pt 10pt; border-radius: 6pt; font-size: 10pt; }}
</style></head><body>

<h1>Сводная панель сети клиник</h1>
<div class="meta">Период: последние {days} дней · сгенерировано {data.get('generated_at','')[:19]}</div>

<h2>Ключевые показатели сети</h2>
<div class="grid">
  <div class="kpi"><div class="v">{totals.get('clinics', 0)}</div><div class="l">Клиник в сети</div></div>
  <div class="kpi"><div class="v">{_fmt_money(totals.get('revenue', 0))}</div><div class="l">Выручка за {days} дн</div></div>
  <div class="kpi"><div class="v">{totals.get('visits', 0):,}</div><div class="l">Визитов</div></div>
  <div class="kpi"><div class="v">{totals.get('active_lk', 0):,}</div><div class="l">Активных в ЛК</div></div>
  <div class="kpi"><div class="v">{totals.get('new_lk', 0):,}</div><div class="l">Новых пациентов</div></div>
  <div class="kpi"><div class="v">{totals.get('avg_nps', 0):.1f}</div><div class="l">Средний NPS ({totals.get('nps_count', 0)} оценок)</div></div>
</div>

{f'<div class="top-clinic">🏆 <b>Лидер по выручке:</b> {top.get("name","—")} — {_fmt_money(top.get("revenue", 0))}</div>' if top.get("name") else ""}

{chart_svg}

<h2>Сравнение клиник по выручке</h2>
{bar_svg}

<h2>Детализация по клиникам</h2>
<table>
  <tr>
    <th>Клиника</th>
    <th class="right">Выручка</th>
    <th class="right">Визиты</th>
    <th class="right">Актив. в ЛК</th>
    <th class="right">Новых</th>
    <th class="right">NPS</th>
  </tr>
  {rows}
</table>

<p style="margin-top:24pt;color:#9ca3af;font-size:8pt;text-align:center;">
  Сгенерировано через WeasyPrint · клиниксеть.рф
</p>

</body></html>""".replace(",", " ")
