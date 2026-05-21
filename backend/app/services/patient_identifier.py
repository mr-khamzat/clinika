"""
chatslot01: автоматическая идентификация пациента в МИС при первом сообщении в thread.

Вызывается hook'ом в send_message (см. patient_chat_threads router).
Если patient_account.mis_patient_id ещё пуст:
  1. find_patient_by_phone → если найден, связываем (state='linked')
  2. иначе add_patient → связываем (state='created')
  3. при сетевой ошибке / 5xx — запись в mis_outbox для retry (state='error')
  4. при 4xx — mis_sync_state='manual_required' (регистратор дозаполнит)

Особенности интеграции с mis_client (см. /opt/clinika/backend/app/services/mis_client.py):
  - mis_client — не singleton, а модуль с module-level async функциями.
  - find_patient_by_phone(phone, api_url, api_key) -> dict | None (None если не найден или ошибка).
  - add_patient(phone, full_name, api_url, api_key, clinic_id) -> dict | None
    (None при любой ошибке — внутри обёрнуто try/except).
  - Сигнатуры функций не отдают HTTP-статус наружу: 4xx/5xx неразличимы из этого слоя,
    поэтому при None-ответе от add_patient мы консервативно идём в outbox-retry
    (state='error'), а 'manual_required' оставляем для будущей версии mis_client,
    когда она начнёт пробрасывать httpx.HTTPStatusError. Если из mis_client всё-таки
    выскочит исключение со status_code 4xx — мы это поймаем (см. except ниже).

Все терминальные state'ы:
  pending (исходный из БД)
  → linked        — найден в МИС, привязан
  → created       — не найден, создан в МИС, привязан
  → no_phone      — у аккаунта нет phone
  → ambiguous     — несколько patient_accounts с одним phone, нужно ручное разрешение
  → manual_required — 4xx от МИС (валидация), регистратор дозаполнит
  → error         — 5xx / сетевая ошибка, событие в outbox для retry
"""
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.patient_account import PatientAccount
from app.models.mis_outbox import MisOutbox
from app.services import mis_client as mis  # module-level async functions


async def identify_patient(
    session: AsyncSession,
    *,
    patient_account_id: UUID,
) -> str:
    """
    Идентифицирует пациента в МИС.

    Возвращает финальный mis_sync_state (см. docstring модуля).
    Не бросает исключения — все ошибки маппятся в mis_sync_state.
    """
    acc = (
        await session.execute(
            select(PatientAccount).where(PatientAccount.id == patient_account_id)
        )
    ).scalar_one_or_none()
    if acc is None:
        return "error"

    # Идемпотентность: если уже привязан — выходим
    if acc.mis_patient_id is not None:
        return acc.mis_sync_state

    if not acc.phone:
        acc.mis_sync_state = "no_phone"
        await session.flush()
        return "no_phone"

    # ─── 1. Проверяем дубликаты телефона ───
    # Если несколько аккаунтов с одним phone — автоматика небезопасна,
    # регистратор должен разрулить вручную (mis_sync_state='ambiguous').
    dupes = (
        (
            await session.execute(
                select(PatientAccount).where(
                    PatientAccount.phone == acc.phone,
                    PatientAccount.id != acc.id,
                )
            )
        )
        .scalars()
        .all()
    )
    if len(dupes) > 0:
        acc.mis_sync_state = "ambiguous"
        await session.flush()
        return "ambiguous"

    # ─── 2. Поиск в МИС по телефону ───
    try:
        found = await mis.find_patient_by_phone(acc.phone)
    except httpx.HTTPStatusError as e:
        status_code = e.response.status_code if e.response is not None else 0
        if 400 <= status_code < 500:
            acc.mis_sync_state = "manual_required"
            await session.flush()
            return "manual_required"
        await _enqueue_outbox(
            session,
            event_type="patient.find",
            payload={"patient_account_id": str(acc.id), "phone": acc.phone},
            error=f"HTTP {status_code}: {str(e)[:900]}",
        )
        acc.mis_sync_state = "error"
        await session.flush()
        return "error"
    except Exception as e:  # noqa: BLE001 — сетевые/неожиданные ошибки → outbox
        await _enqueue_outbox(
            session,
            event_type="patient.find",
            payload={"patient_account_id": str(acc.id), "phone": acc.phone},
            error=str(e)[:1000],
        )
        acc.mis_sync_state = "error"
        await session.flush()
        return "error"

    if found:
        # mis_client возвращает dict пациента — patient_id под одним из ключей.
        # У Renovatio это 'patient_id'; страхуемся на 'id'.
        mis_id_raw = found.get("patient_id") or found.get("id")
        if mis_id_raw is not None:
            try:
                acc.mis_patient_id = int(mis_id_raw)
            except (TypeError, ValueError):
                # Странный формат — отправляем на ручное разрешение
                acc.mis_sync_state = "manual_required"
                await session.flush()
                return "manual_required"
            acc.mis_synced_at = datetime.utcnow()
            acc.mis_sync_state = "linked"
            await session.flush()
            return "linked"
        # Найден, но без id — manual
        acc.mis_sync_state = "manual_required"
        await session.flush()
        return "manual_required"

    # ─── 3. Не найден — создаём в МИС ───
    try:
        created = await mis.add_patient(
            phone=acc.phone,
            full_name=acc.name or "",
        )
    except httpx.HTTPStatusError as e:
        status_code = e.response.status_code if e.response is not None else 0
        if 400 <= status_code < 500:
            # 4xx — валидационная ошибка, ручная корректировка
            acc.mis_sync_state = "manual_required"
            await session.flush()
            return "manual_required"
        # 5xx — в outbox
        await _enqueue_outbox(
            session,
            event_type="patient.create",
            payload={
                "patient_account_id": str(acc.id),
                "full_name": acc.name or "",
                "phone": acc.phone,
            },
            error=f"HTTP {status_code}: {str(e)[:900]}",
        )
        acc.mis_sync_state = "error"
        await session.flush()
        return "error"
    except Exception as e:  # noqa: BLE001
        await _enqueue_outbox(
            session,
            event_type="patient.create",
            payload={
                "patient_account_id": str(acc.id),
                "full_name": acc.name or "",
                "phone": acc.phone,
            },
            error=str(e)[:1000],
        )
        acc.mis_sync_state = "error"
        await session.flush()
        return "error"

    # mis_client.add_patient внутри сам ловит исключения и возвращает None при любой ошибке
    # (см. /opt/clinika/backend/app/services/mis_client.py:120). HTTP-статус из этого слоя
    # неразличим, поэтому None → консервативно ставим 'error' + outbox для retry.
    if not created:
        await _enqueue_outbox(
            session,
            event_type="patient.create",
            payload={
                "patient_account_id": str(acc.id),
                "full_name": acc.name or "",
                "phone": acc.phone,
            },
            error="add_patient returned None (МИС недоступен или вернул ошибку)",
        )
        acc.mis_sync_state = "error"
        await session.flush()
        return "error"

    mis_id_raw = created.get("patient_id") or created.get("id")
    if mis_id_raw is None:
        acc.mis_sync_state = "manual_required"
        await session.flush()
        return "manual_required"
    try:
        acc.mis_patient_id = int(mis_id_raw)
    except (TypeError, ValueError):
        acc.mis_sync_state = "manual_required"
        await session.flush()
        return "manual_required"
    acc.mis_synced_at = datetime.utcnow()
    acc.mis_sync_state = "created"
    await session.flush()
    return "created"


async def _enqueue_outbox(
    session: AsyncSession,
    *,
    event_type: str,
    payload: dict[str, Any],
    error: str,
) -> None:
    """Кладём событие в mis_outbox для retry.
    next_retry_at = now + 1 минута (далее worker применяет exp.backoff)."""
    outbox = MisOutbox(
        event_type=event_type,
        payload=payload,
        status="pending",
        attempt_count=0,
        next_retry_at=datetime.utcnow() + timedelta(minutes=1),
        last_error=error,
    )
    session.add(outbox)
    await session.flush()
