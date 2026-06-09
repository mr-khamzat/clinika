import logging
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.bonus import Bonus, BonusStatus
from datetime import datetime
import uuid

logger = logging.getLogger(__name__)


async def mark_bonus_paid(db: AsyncSession, bonus_id: uuid.UUID) -> Bonus | None:
    result = await db.execute(select(Bonus).where(Bonus.id == bonus_id))
    bonus = result.scalar_one_or_none()
    if bonus and bonus.status == BonusStatus.PENDING:
        bonus.status = BonusStatus.PAID
        bonus.paid_at = datetime.utcnow()
        # Запись в финансовый реестр: выплата (отрицательная сумма = списание с pending)
        try:
            from app.services.ledger_service import add_entry, OpType
            await add_entry(
                db=db,
                user_id=bonus.admin_id,
                amount=-float(bonus.amount),
                operation_type=OpType.BONUS_PAID,
                reference_id=bonus.id,
                reference_type="bonus",
                description=f"Выплата бонуса #{str(bonus.id)[:8]}",
                tenant_id=bonus.tenant_id if hasattr(bonus, 'tenant_id') else None,
            )
        except Exception:
            logger.exception("Не удалось записать ledger BONUS_PAID для bonus_id=%s", bonus.id)
        # Биллинг платформы — fee с франшизы за выплаченный бонус
        try:
            from app.services.franchise_billing_service import record_platform_fee_for_bonus
            await record_platform_fee_for_bonus(db, bonus, direction="charge")
        except Exception:
            logger.exception("Не удалось списать platform fee (charge) для bonus_id=%s", bonus.id)
        # Вебхук bonus_paid
        try:
            from app.services.webhook_service import send_event
            if hasattr(bonus, 'tenant_id') and bonus.tenant_id:
                await send_event(db, bonus.tenant_id, 'bonus_paid',
                    {'bonus_id': str(bonus.id), 'amount': float(bonus.amount),
                     'admin_id': str(bonus.admin_id) if bonus.admin_id else None})
        except Exception:
            logger.exception("Не удалось отправить webhook bonus_paid для bonus_id=%s tenant_id=%s", bonus.id, getattr(bonus, 'tenant_id', None))

        # ─── Push-уведомление сотруднику (Этап 10 ROADMAP) ──────────────────
        # Отправляем после фиксации статуса PAID. Без VAPID — тихо False.
        try:
            from app.services.push_service import send_push_to_user
            if bonus.admin_id:
                await send_push_to_user(
                    str(bonus.admin_id),
                    title="Бонус выплачен",
                    body=f"Вам начислено {float(bonus.amount):.2f} ₽",
                    data={"url": "/cabinet", "kind": "bonus_paid", "bonus_id": str(bonus.id)},
                    db=db,
                )
        except Exception:
            logger.exception("Не удалось отправить push bonus_paid для bonus_id=%s", bonus.id)

        # ─── Email-уведомление сотруднику (если задан email) ────────────────
        try:
            from app.services.email_service import schedule_email
            if bonus.admin_id:
                from app.models.user import User
                u = (await db.execute(select(User).where(User.id == bonus.admin_id))).scalar_one_or_none()
                if u and u.email:
                    schedule_email(
                        u.email,
                        "КлиникСеть — бонус выплачен",
                        body_html=(
                            f"<p>Здравствуйте, {u.full_name or u.username}!</p>"
                            f"<p>Вам выплачен бонус: <b>{float(bonus.amount):.2f} ₽</b>.</p>"
                            f"<p>Подробности доступны в личном кабинете.</p>"
                        ),
                    )
        except Exception:
            logger.exception("Не удалось отправить email bonus_paid для bonus_id=%s", bonus.id)

        await db.commit()
        await db.refresh(bonus)
    return bonus


async def mark_bonus_cancelled(db: AsyncSession, bonus_id: uuid.UUID) -> Bonus | None:
    result = await db.execute(select(Bonus).where(Bonus.id == bonus_id))
    bonus = result.scalar_one_or_none()
    if bonus and bonus.status == BonusStatus.PENDING:
        bonus.status = BonusStatus.CANCELLED
        # Запись в финансовый реестр: отмена
        try:
            from app.services.ledger_service import add_entry, OpType
            await add_entry(
                db=db,
                user_id=bonus.admin_id,
                amount=-float(bonus.amount),
                operation_type=OpType.BONUS_CANCELLED,
                reference_id=bonus.id,
                reference_type="bonus",
                description=f"Отмена бонуса #{str(bonus.id)[:8]}",
                tenant_id=bonus.tenant_id if hasattr(bonus, 'tenant_id') else None,
            )
        except Exception:
            logger.exception("Не удалось записать ledger BONUS_CANCELLED для bonus_id=%s", bonus.id)
        # Биллинг платформы — refund fee франшизе если так настроено
        try:
            from app.services.franchise_billing_service import record_platform_fee_for_bonus
            await record_platform_fee_for_bonus(db, bonus, direction="refund")
        except Exception:
            logger.exception("Не удалось вернуть platform fee (refund) для bonus_id=%s", bonus.id)
        await db.commit()
        await db.refresh(bonus)
    return bonus
