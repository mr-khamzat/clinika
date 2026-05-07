"""
Фасад над ОФД-провайдерами.

Сервисный слой:
  - pull_clinic_receipts      — pull чеков для одной клиники
  - cron_pull_all_receipts    — крон-задача: для всех активных конфигов
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.payments_clinic import FiscalReceipt, OFDConfig
from app.services.fiscal import get_provider


log = logging.getLogger("fiscal_service")


# ── Pull чеков для одной клиники ─────────────────────────────────────────────

async def pull_clinic_receipts(
    db: AsyncSession,
    *,
    clinic_id: uuid.UUID,
    since: datetime | None = None,
) -> dict[str, Any]:
    """
    Подтянуть чеки из ОФД для одной клиники.

    Возвращает: {ofd, fetched, saved, skipped}.
    Бросает NotImplementedError если адаптер пока заглушка (ловится в роутере → 501).
    """
    cfg = (await db.execute(
        select(OFDConfig).where(
            OFDConfig.clinic_id == clinic_id,
            OFDConfig.is_active == True,  # noqa: E712
        )
    )).scalar_one_or_none()

    if cfg is None:
        raise LookupError("ОФД не настроен для клиники")

    if since is None:
        since = cfg.last_pulled_at or (datetime.utcnow() - timedelta(days=7))

    provider = get_provider(cfg.provider, cfg)
    receipts = await provider.pull_receipts(since)

    saved = 0
    skipped = 0
    for r in receipts:
        # Идемпотентность по (клиника, ФД, ФН)
        if r.fiscal_doc_number and r.fiscal_storage_number:
            existing = (await db.execute(
                select(FiscalReceipt).where(
                    FiscalReceipt.clinic_id == clinic_id,
                    FiscalReceipt.fiscal_doc_number == r.fiscal_doc_number,
                    FiscalReceipt.fiscal_storage_number == r.fiscal_storage_number,
                )
            )).scalar_one_or_none()
            if existing:
                skipped += 1
                continue

        db.add(FiscalReceipt(
            tenant_id=cfg.tenant_id,
            clinic_id=clinic_id,
            inn=r.inn,
            operation_type=r.operation_type,
            total_sum=r.total_sum,
            qr_code=r.qr_code,
            fiscal_doc_number=r.fiscal_doc_number,
            fiscal_storage_number=r.fiscal_storage_number,
            fiscal_sign=r.fiscal_sign,
            receipt_at=r.receipt_at,
            raw_payload=r.raw_payload,
            ofd_provider=cfg.provider,
        ))
        saved += 1

    cfg.last_pulled_at = datetime.utcnow()
    await db.commit()

    return {"ofd": cfg.provider, "fetched": len(receipts), "saved": saved, "skipped": skipped}


# ── Крон: pull для всех активных клиник ──────────────────────────────────────

async def cron_pull_all_receipts(db: AsyncSession) -> dict[str, Any]:
    """Перебрать все активные конфиги и вызвать pull для каждого."""
    cfgs = (await db.execute(
        select(OFDConfig).where(OFDConfig.is_active == True)  # noqa: E712
    )).scalars().all()

    total_saved = 0
    errors: list[str] = []
    for cfg in cfgs:
        try:
            res = await pull_clinic_receipts(db, clinic_id=cfg.clinic_id)
            total_saved += res.get("saved", 0)
        except NotImplementedError as e:
            log.info("ОФД %s — адаптер ещё не реализован: %s", cfg.provider, e)
        except Exception as e:  # noqa: BLE001
            errors.append(f"{cfg.clinic_id}: {e}")
            log.warning("pull для clinic=%s упал: %s", cfg.clinic_id, e)

    return {"clinics_processed": len(cfgs), "total_saved": total_saved, "errors": errors}
