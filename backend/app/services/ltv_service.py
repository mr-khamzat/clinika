"""
LTV-сервис: пуллит визиты пациентов из МИС, агрегирует и считает метрики.

Используется:
  - cron-задачей run_ltv_job (ежедневно 04:00 UTC)
  - endpoint'ом POST /analytics/ltv/recompute (ручной триггер)

Архитектура:
  MISAdapter         — базовый протокол (fetch_patient_visits → list[VisitRecord])
  RenovatioAdapter   — обёртка над mis_client.get_appointments / get_payments
  ManualAdapter      — заглушка для клиник без МИС (пустой список)

Ключевые правила:
  - агрегация по нормализованному телефону (utils.phone.normalize_phone)
  - clinic_id в snapshot — наша внутренняя UUID; маппинг МИС→наш через Clinic.mis_id
  - GrossLTV горизонт = 3 года: ltv = avg_check × visits_per_year × 3 (по sum_value визитов)
  - NetLTV  горизонт = 3 года: net_ltv = avg_paid × visits_per_year × 3 (по фактическим оплатам)
    Если getPayments недоступен (Иван не открыл права в Renovatio) → net_ltv = 0.
  - churn_risk: low (≤90 дней), medium (91..180), high (>180)
  - upsert по уникальному ключу (tenant_id, clinic_id, patient_phone)
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Iterable, Protocol

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.clinic import Clinic
from app.models.commercial import ModuleStatus, TenantModuleSubscription
from app.models.ltv import PatientLtvSnapshot
from app.models.tenant import Tenant
from app.services.mis_client import get_appointments, get_payments
from app.services.settings_service import get_setting
from app.utils.phone import normalize_phone

log = logging.getLogger("ltv_service")

# Горизонт прогноза LTV (лет)
LTV_HORIZON_YEARS = Decimal("3")

# Порог дней для churn-risk
CHURN_LOW_MAX = 90
CHURN_MEDIUM_MAX = 180


# ───────────────────────────────────────────────────────────────────────────
# Адаптеры МИС
# ───────────────────────────────────────────────────────────────────────────


@dataclass
class VisitRecord:
    """Один приёмо-визит пациента (нормализованная форма)."""

    phone: str                       # нормализованный телефон
    name: str | None
    sum: Decimal                     # выручка визита (sum_value − discount, либо чистый sum_value)
    services: list[str] = field(default_factory=list)
    date: datetime | None = None
    is_first: bool = False
    mis_clinic_id: int | None = None # id клиники в МИС (для маппинга)
    # Фактическая оплата визита из getPayments (если данные доступны).
    # При отсутствии данных или 403 — равен 0; на этапе агрегации NetLTV
    # будет рассчитан только для пациентов, у которых есть хоть одна оплата.
    total_paid: Decimal = Decimal("0")


class MISAdapter(Protocol):
    """Базовый интерфейс адаптера МИС."""

    async def fetch_patient_visits(
        self,
        db: AsyncSession,
        tenant: Tenant,
        clinic_id_internal,  # uuid.UUID нашей клиники, либо None для всех
        days: int = 730,
    ) -> list[VisitRecord]:
        ...


class ManualAdapter:
    """Заглушка для клиник без МИС — возвращает пустой список."""

    async def fetch_patient_visits(
        self,
        db: AsyncSession,
        tenant: Tenant,
        clinic_id_internal,
        days: int = 730,
    ) -> list[VisitRecord]:
        return []


class RenovatioAdapter:
    """Обёртка над mis_client.get_appointments + get_payments.

    Группирует визиты по телефону, обогащает фактическими оплатами для NetLTV.
    """

    @staticmethod
    def _parse_mis_dt(s: str | None) -> datetime | None:
        """Renovatio выдаёт даты в формате 'dd.mm.YYYY HH:MM'."""
        if not s:
            return None
        try:
            return datetime.strptime(s.strip(), "%d.%m.%Y %H:%M")
        except Exception:
            try:
                return datetime.strptime(s.strip()[:10], "%d.%m.%Y")
            except Exception:
                return None

    @staticmethod
    def _calc_visit_sum(appt: dict) -> Decimal:
        """Сумма визита: sum_value (если есть), иначе сумма value по services."""
        sv = appt.get("sum_value")
        if sv is not None:
            try:
                return Decimal(str(sv))
            except Exception:
                pass
        total = Decimal("0")
        for s in (appt.get("services") or []):
            try:
                total += Decimal(str(s.get("value") or s.get("price") or 0))
            except Exception:
                continue
        return total

    @staticmethod
    def _payment_amount(p: dict) -> Decimal:
        """Достаём сумму оплаты — поле точно неизвестно до открытия доступа,
        поэтому пробуем самые вероятные варианты."""
        for key in ("amount", "sum", "value", "sum_value", "total"):
            v = p.get(key)
            if v is None:
                continue
            try:
                return Decimal(str(v))
            except Exception:
                continue
        return Decimal("0")

    @staticmethod
    def _payment_phone_or_pid(p: dict) -> tuple[str, int | None]:
        """Достаём телефон и/или patient_id из платежа.

        Поскольку структура ответа getPayments на 2026-05-07 неизвестна
        (метод 403), пробуем самые вероятные ключи. После открытия доступа —
        проверим curl-ом и при необходимости заактуализируем поля.
        """
        phone_raw = (
            p.get("patient_phone") or p.get("phone") or p.get("mobile") or ""
        )
        phone = normalize_phone(phone_raw) if phone_raw else ""
        pid_raw = p.get("patient_id") or p.get("client_id")
        try:
            pid = int(pid_raw) if pid_raw is not None else None
        except Exception:
            pid = None
        return phone, pid

    @staticmethod
    def _appt_phone(appt: dict) -> str:
        phone_raw = appt.get("patient_phone") or appt.get("mobile") or ""
        return normalize_phone(phone_raw) if phone_raw else ""

    async def _fetch_payments_index(
        self,
        target_mis_ids: list[int],
        date_from: str,
        date_to: str,
        api_url: str,
        api_key: str,
    ) -> tuple[dict[str, Decimal], dict[int, Decimal]]:
        """Параллельно получает оплаты по всем mis_clinic_id и индексирует
        их по двум ключам (телефон и patient_id) — на этапе обогащения визита
        выберем тот, что нашёлся.

        Возвращает (by_phone, by_patient_id).
        """
        # Параллельный fetch — экономим на сетевых задержках
        tasks = [
            get_payments(int(mis_clinic_id), date_from, date_to,
                         api_url=api_url, api_key=api_key)
            for mis_clinic_id in target_mis_ids
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        by_phone: dict[str, Decimal] = {}
        by_pid: dict[int, Decimal] = {}
        total_payments = 0
        for res in results:
            if isinstance(res, Exception):
                log.warning("ltv: fetch payments — exception: %s", res)
                continue
            for p in res or []:
                amount = self._payment_amount(p)
                if amount <= 0:
                    continue
                phone, pid = self._payment_phone_or_pid(p)
                if phone:
                    by_phone[phone] = by_phone.get(phone, Decimal("0")) + amount
                if pid is not None:
                    by_pid[pid] = by_pid.get(pid, Decimal("0")) + amount
                total_payments += 1
        if total_payments:
            log.info(
                "ltv: getPayments → %d записей (уникальных phone=%d, pid=%d)",
                total_payments, len(by_phone), len(by_pid),
            )
        return by_phone, by_pid

    async def fetch_patient_visits(
        self,
        db: AsyncSession,
        tenant: Tenant,
        clinic_id_internal,
        days: int = 730,
    ) -> list[VisitRecord]:
        # 1. Разбираемся, какие mis-clinic-id опрашивать
        tenant_mis_ids: list[int] = list(tenant.mis_clinic_ids or [])
        if not tenant_mis_ids:
            log.info("ltv: tenant=%s МИС не настроен (mis_clinic_ids пуст)", tenant.slug)
            return []

        # Если задана конкретная наша клиника — ограничиваем её mis_id-ом
        target_mis_ids: list[int] = tenant_mis_ids
        if clinic_id_internal is not None:
            r = await db.execute(
                select(Clinic).where(
                    Clinic.id == clinic_id_internal,
                    Clinic.tenant_id == tenant.id,
                )
            )
            clinic = r.scalar_one_or_none()
            if clinic and clinic.mis_id:
                target_mis_ids = [int(clinic.mis_id)]
            else:
                # У клиники нет mis_id → визитов из МИС нет
                return []

        # 2. Берём API-ключ/URL тенанта
        try:
            api_url = await get_setting(db, "mis_api_url", "", tenant_id=tenant.id)
            api_key = await get_setting(db, "mis_api_key", "", tenant_id=tenant.id)
        except Exception as e:
            log.warning("ltv: tenant=%s не удалось получить MIS-настройки: %s", tenant.slug, e)
            api_url, api_key = "", ""

        # 3. Опрашиваем за период [now - days, now]
        now = datetime.utcnow()
        date_from = (now - timedelta(days=days)).strftime("%d.%m.%Y")
        date_to = now.strftime("%d.%m.%Y")

        # 4. Параллельно получаем appointments и payments
        appt_tasks = [
            get_appointments(int(mc), date_from, date_to,
                             api_url=api_url, api_key=api_key)
            for mc in target_mis_ids
        ]
        payments_task = self._fetch_payments_index(
            target_mis_ids, date_from, date_to, api_url, api_key
        )

        appt_results, (paid_by_phone, paid_by_pid) = await asyncio.gather(
            asyncio.gather(*appt_tasks, return_exceptions=True),
            payments_task,
        )

        all_appts: list[dict] = []
        for mis_clinic_id, items in zip(target_mis_ids, appt_results):
            if isinstance(items, Exception):
                log.warning("ltv: tenant=%s mis_clinic=%s ошибка: %s",
                            tenant.slug, mis_clinic_id, items)
                continue
            for it in items or []:
                it["_mis_clinic_id"] = int(mis_clinic_id)
            all_appts.extend(items or [])

        # 5. Преобразуем в VisitRecord (только «состоявшиеся»: completed/выполнено/status_id=4)
        # Считаем сколько визитов у каждого пациента — чтобы равномерно распределить
        # суммарную оплату пациента (paid_by_phone) на каждый визит.
        # Это нужно потому что getPayments возвращает агрегат по пациенту,
        # а getAppointments — отдельные визиты. Точная привязка возможна
        # только после знакомства с реальной структурой ответа getPayments.
        completed_visits_per_patient: dict[str, int] = {}
        completed_appts: list[dict] = []
        for appt in all_appts:
            status_id = str(appt.get("status_id") or "")
            status_str = str(appt.get("status") or "").lower()
            if status_id != "4" and status_str not in ("completed", "выполнено", "завершено"):
                continue
            phone = self._appt_phone(appt)
            if not phone:
                continue
            completed_visits_per_patient[phone] = completed_visits_per_patient.get(phone, 0) + 1
            completed_appts.append(appt)

        visits: list[VisitRecord] = []
        for appt in completed_appts:
            phone = self._appt_phone(appt)

            full_name = appt.get("patient_name")
            if not full_name:
                ln = appt.get("last_name") or ""
                fn = appt.get("first_name") or ""
                full_name = f"{ln} {fn}".strip() or None

            # Распределяем суммарную оплату пациента равномерно по его визитам
            visits_n = completed_visits_per_patient.get(phone) or 1
            patient_total_paid = paid_by_phone.get(phone, Decimal("0"))
            if patient_total_paid == 0:
                # Пробуем найти по patient_id, если он пришёл в appointments
                pid_raw = appt.get("patient_id")
                try:
                    pid = int(pid_raw) if pid_raw is not None else None
                except Exception:
                    pid = None
                if pid is not None:
                    patient_total_paid = paid_by_pid.get(pid, Decimal("0"))
            visit_paid = (patient_total_paid / Decimal(visits_n)).quantize(Decimal("0.01")) if visits_n else Decimal("0")

            visits.append(VisitRecord(
                phone=phone,
                name=full_name,
                sum=self._calc_visit_sum(appt),
                services=[(s.get("title") or "") for s in (appt.get("services") or [])],
                date=self._parse_mis_dt(appt.get("time_start")) or self._parse_mis_dt(appt.get("date_created")),
                is_first=bool(appt.get("is_first")),
                mis_clinic_id=appt.get("_mis_clinic_id"),
                total_paid=visit_paid,
            ))

        return visits


# ───────────────────────────────────────────────────────────────────────────
# Хелперы агрегации
# ───────────────────────────────────────────────────────────────────────────


def _quarter_label(dt: datetime) -> str:
    """'2026-Q1' и т.д."""
    q = (dt.month - 1) // 3 + 1
    return f"{dt.year}-Q{q}"


def _churn_risk_for(last_visit: datetime | None, now: datetime | None = None) -> str:
    """Риск оттока по дням с последнего визита."""
    if not last_visit:
        return "high"
    now = now or datetime.utcnow()
    days = (now - last_visit).days
    if days <= CHURN_LOW_MAX:
        return "low"
    if days <= CHURN_MEDIUM_MAX:
        return "medium"
    return "high"


@dataclass
class _Aggregated:
    phone: str
    name: str | None
    visits: int = 0
    total: Decimal = Decimal("0")
    total_paid: Decimal = Decimal("0")  # фактически оплачено (для NetLTV)
    first_visit: datetime | None = None
    last_visit: datetime | None = None


def _aggregate_visits(visits: Iterable[VisitRecord]) -> dict[str, _Aggregated]:
    """Группировка визитов по нормализованному телефону."""
    by_phone: dict[str, _Aggregated] = {}
    for v in visits:
        agg = by_phone.get(v.phone)
        if not agg:
            agg = _Aggregated(phone=v.phone, name=v.name)
            by_phone[v.phone] = agg
        agg.visits += 1
        agg.total += v.sum or Decimal("0")
        agg.total_paid += v.total_paid or Decimal("0")
        if v.name and not agg.name:
            agg.name = v.name
        if v.date:
            if not agg.first_visit or v.date < agg.first_visit:
                agg.first_visit = v.date
            if not agg.last_visit or v.date > agg.last_visit:
                agg.last_visit = v.date
    return by_phone


# ───────────────────────────────────────────────────────────────────────────
# Основные функции
# ───────────────────────────────────────────────────────────────────────────


def _pick_adapter(tenant: Tenant) -> MISAdapter:
    """Выбираем адаптер: если у тенанта есть mis_clinic_ids — Renovatio, иначе ManualAdapter."""
    if tenant.mis_clinic_ids:
        return RenovatioAdapter()
    return ManualAdapter()


async def compute_ltv_for_clinic(
    db: AsyncSession,
    tenant: Tenant,
    clinic_id,  # uuid.UUID | None
    days: int = 730,
) -> dict:
    """
    Пересчитать LTV-snapshots для пациентов одной клиники тенанта.
    Если clinic_id=None — обработать все клиники тенанта (визиты будут привязаны
    к нашему clinic_id через Clinic.mis_id).

    Возвращает {"updated": N, "patients": M}.
    """
    adapter = _pick_adapter(tenant)
    visits = await adapter.fetch_patient_visits(db, tenant, clinic_id, days=days)
    if not visits:
        return {"updated": 0, "patients": 0}

    # Маппинг mis_clinic_id → наш UUID clinic_id
    clinic_map: dict[int, object] = {}
    if clinic_id is None:
        clinics_q = await db.execute(
            select(Clinic).where(Clinic.tenant_id == tenant.id, Clinic.mis_id.isnot(None))
        )
        for c in clinics_q.scalars().all():
            try:
                clinic_map[int(c.mis_id)] = c.id
            except Exception:
                continue

    # Агрегируем визиты по (наш_clinic_id, phone). Внутри каждой клиники — отдельный snapshot.
    grouped: dict[tuple[object, str], list[VisitRecord]] = {}
    for v in visits:
        # Определяем целевой наш clinic_id для визита
        if clinic_id is not None:
            target_cid = clinic_id
        else:
            target_cid = clinic_map.get(v.mis_clinic_id)
        # Если для МИС-клиники нет нашей записи — складываем без clinic_id (NULL)
        key = (target_cid, v.phone)
        grouped.setdefault(key, []).append(v)

    now = datetime.utcnow()
    updated = 0

    for (target_cid, phone), bucket in grouped.items():
        agg_map = _aggregate_visits(bucket)
        agg = agg_map.get(phone)
        if not agg or agg.visits == 0:
            continue

        avg_check = (agg.total / Decimal(agg.visits)).quantize(Decimal("0.01"))
        # visits_per_year — нормализуем к году по реальному окну между first и last
        if agg.first_visit and agg.last_visit and agg.last_visit > agg.first_visit:
            span_days = max((agg.last_visit - agg.first_visit).days, 1)
            visits_per_year = (Decimal(agg.visits) * Decimal("365") / Decimal(span_days)).quantize(Decimal("0.01"))
        else:
            # один визит или совпадающие даты — экстраполируем по периоду опроса
            visits_per_year = (Decimal(agg.visits) * Decimal("365") / Decimal(days)).quantize(Decimal("0.01"))

        ltv_estimate = (avg_check * visits_per_year * LTV_HORIZON_YEARS).quantize(Decimal("0.01"))

        # NetLTV — по фактическим оплатам. Если getPayments недоступен
        # (Иван не открыл права) total_paid = 0 → net_ltv = 0 (UI покажет «—»).
        if agg.total_paid > 0:
            avg_paid = (agg.total_paid / Decimal(agg.visits)).quantize(Decimal("0.01"))
            net_ltv = (avg_paid * visits_per_year * LTV_HORIZON_YEARS).quantize(Decimal("0.01"))
        else:
            net_ltv = Decimal("0")

        cohort = _quarter_label(agg.first_visit) if agg.first_visit else None
        churn = _churn_risk_for(agg.last_visit, now)

        # Upsert (tenant_id, clinic_id, patient_phone) — но Postgres ON CONFLICT
        # с NULL в clinic_id работает только при partial unique index, а у нас
        # обычный constraint. Делаем по-старому: SELECT → UPDATE/INSERT.
        existing_q = await db.execute(
            select(PatientLtvSnapshot).where(
                PatientLtvSnapshot.tenant_id == tenant.id,
                PatientLtvSnapshot.clinic_id == target_cid,
                PatientLtvSnapshot.patient_phone == phone,
            )
        )
        existing = existing_q.scalar_one_or_none()
        if existing:
            existing.patient_name = agg.name or existing.patient_name
            existing.visits_count = agg.visits
            existing.total_spent = agg.total
            existing.avg_check = avg_check
            existing.first_visit_at = agg.first_visit
            existing.last_visit_at = agg.last_visit
            existing.visits_per_year = visits_per_year
            existing.ltv_estimate = ltv_estimate
            existing.net_ltv = net_ltv
            existing.cohort_quarter = cohort
            existing.churn_risk = churn
            existing.computed_at = now
        else:
            db.add(PatientLtvSnapshot(
                tenant_id=tenant.id,
                clinic_id=target_cid,
                patient_phone=phone,
                patient_name=agg.name,
                visits_count=agg.visits,
                total_spent=agg.total,
                avg_check=avg_check,
                first_visit_at=agg.first_visit,
                last_visit_at=agg.last_visit,
                visits_per_year=visits_per_year,
                ltv_estimate=ltv_estimate,
                net_ltv=net_ltv,
                cohort_quarter=cohort,
                churn_risk=churn,
                computed_at=now,
            ))
        updated += 1

    await db.commit()
    return {"updated": updated, "patients": updated}


async def compute_cohorts(
    db: AsyncSession,
    tenant_id,
    period: str = "quarter",
) -> list[dict]:
    """
    Агрегирует snapshot'ы в когорты (по умолчанию — квартал первого визита).
    Возвращает [{cohort, patients, total_spent, avg_ltv, avg_net_ltv}].
    """
    from sqlalchemy import func

    rows = (await db.execute(
        select(
            PatientLtvSnapshot.cohort_quarter.label("cohort"),
            func.count(PatientLtvSnapshot.id).label("patients"),
            func.coalesce(func.sum(PatientLtvSnapshot.total_spent), 0).label("total_spent"),
            func.coalesce(func.avg(PatientLtvSnapshot.ltv_estimate), 0).label("avg_ltv"),
            func.coalesce(func.avg(PatientLtvSnapshot.net_ltv), 0).label("avg_net_ltv"),
        )
        .where(PatientLtvSnapshot.tenant_id == tenant_id)
        .where(PatientLtvSnapshot.cohort_quarter.isnot(None))
        .group_by(PatientLtvSnapshot.cohort_quarter)
        .order_by(PatientLtvSnapshot.cohort_quarter.desc())
    )).all()

    return [
        {
            "cohort": r.cohort,
            "patients": int(r.patients or 0),
            "total_spent": float(r.total_spent or 0),
            "avg_ltv": float(r.avg_ltv or 0),
            "avg_net_ltv": float(r.avg_net_ltv or 0),
        }
        for r in rows
    ]
