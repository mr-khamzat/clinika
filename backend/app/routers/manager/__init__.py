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
