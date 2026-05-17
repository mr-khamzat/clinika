# ===== БЛОК: Роутер менеджера (агрегатор) =====
# Собирает все sub-роутеры в один /manager/* маршрутизатор.
# Для добавления нового модуля: создать файл и добавить include_router ниже.

from fastapi import APIRouter

from .reports import router as reports_router
from .staff import router as staff_router
from .bonuses_mgmt import router as bonuses_mgmt_router
from .clinics_mgmt import router as clinics_mgmt_router
from .services_mgmt import router as services_mgmt_router
from .settings_mgmt import router as settings_mgmt_router
from .kpi import router as kpi_router
from .activity import router as activity_router
from .partners import router as partners_router
from .discounts import router as discounts_router
from .recruiter_doctors import router as recruiter_doctors_router
# External doctors MVP (external01)
from .external_doctors import router as external_doctors_router
from .clinics_access import router as clinics_access_router
# Финансовая модель платформы (svcfin01): счета платформе / сети / агрегация бонусов.
from .finance import router as finance_router

# Глава 4 — Manager productivity
from .kanban import router as kanban_router
from .doctor_load import router as doctor_load_router
from .referral_templates import router as referral_templates_router
from .multi_clinic import router as multi_clinic_router
from .cost_forecast import router as cost_forecast_router

router = APIRouter(prefix="/manager", tags=["manager"])

router.include_router(reports_router)
router.include_router(staff_router)
router.include_router(bonuses_mgmt_router)
router.include_router(clinics_mgmt_router)
router.include_router(services_mgmt_router)
router.include_router(settings_mgmt_router)
router.include_router(kpi_router)
router.include_router(activity_router)
router.include_router(partners_router)
router.include_router(discounts_router)
router.include_router(recruiter_doctors_router)
router.include_router(external_doctors_router)
router.include_router(clinics_access_router)
router.include_router(finance_router)

# Глава 4 — Manager productivity
router.include_router(kanban_router)
router.include_router(doctor_load_router)
router.include_router(referral_templates_router)
router.include_router(multi_clinic_router)
router.include_router(cost_forecast_router)
