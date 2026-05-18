"""
Accountant cabinet — кабинет бухгалтера клиники.

Scope: clinic_id текущего пользователя. Бухгалтер видит только свою клинику.
Менеджер/директор/super_admin тоже могут зайти (суперсет прав).

Структура:
  /accountant/cash/*       — кассовые смены, операции, Z-отчёт   (MVP)
  /accountant/acts         — реестр актов выполненных работ      (MVP)
  /accountant/summary      — сводка-дашборд                      (MVP)
  /accountant/payments     — реестр платежей пациентов            (Phase 2)
  /accountant/payroll/*    — зарплата сотрудников                 (Phase 2)
  /accountant/reports/*    — P&L, cash flow                       (Phase 2)
  /accountant/spending/*   — расходы по категориям                (Phase 3)
  /accountant/suppliers/*  — контрагенты                          (Phase 3)
  /accountant/tax/*        — налоговые отчёты                     (Phase 3)
"""
from fastapi import APIRouter

from app.routers.accountant.cash import router as cash_router
from app.routers.accountant.acts import router as acts_router
from app.routers.accountant.summary import router as summary_router
from app.routers.accountant.payments import router as payments_router
from app.routers.accountant.payroll import router as payroll_router
from app.routers.accountant.reports import router as reports_router
from app.routers.accountant.spending import router as spending_router

router = APIRouter(prefix="/accountant", tags=["accountant"])
router.include_router(cash_router)
router.include_router(acts_router)
router.include_router(summary_router)
router.include_router(payments_router)
router.include_router(payroll_router)
router.include_router(reports_router)
router.include_router(spending_router)
