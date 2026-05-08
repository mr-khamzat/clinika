# ===== БЛОК: Region Lock — активная блокировка действий вне разрешённого региона =====
# Phase 2: если franchise.region_strict=True И geo_region не совпадает с allowed_region,
# критичные операции (POST/PATCH/DELETE) возвращают HTTP 403 с понятным сообщением.
#
# Используется как FastAPI Depends в чувствительных роутерах (clinics, referrals,
# bonuses, payments, manager/*) и в /auth/login.
#
# Граничные правила:
#   • super_admin — bypass всегда (надплатформенный, не должен self-lock'ить себя)
#   • geo_region == None (приватный IP / нет mmdb) — НЕ блокируем (graceful)
#   • franchise.allowed_region == None — НЕ блокируем (Phase 2 не активирован)
#   • franchise.region_strict == False — только мониторинг (Phase 1), не блок

import logging
from typing import Optional
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.database import get_db
from app.models.user import User, UserRole
from app.services import region_lock_service

log = logging.getLogger("region_lock_enforce")

# Префикс detail в 403 — фронт ловит его и показывает специальную модалку.
BLOCK_MESSAGE_PREFIX = "Доступ заблокирован: вы вне разрешённого региона франшизы"


def _client_ip(request: Request) -> Optional[str]:
    """Извлечь реальный IP клиента из заголовков proxy / fallback на client.host.
    Приоритет: X-Forwarded-For (первый IP — реальный клиент перед цепочкой прокси)
    → X-Real-IP → request.client.host. У нас nginx ставит X-Real-IP=$remote_addr
    (часто IP nginx внутри docker), а в XFF — публичный IP клиента.
    """
    if request is None:
        return None
    xff = request.headers.get("x-forwarded-for")
    if xff:
        first = xff.split(",")[0].strip()
        if first:
            return first
    real = request.headers.get("x-real-ip")
    if real:
        return real.strip()
    if request.client:
        return request.client.host
    return None


async def enforce_region_lock(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """FastAPI Depends — блокирует запрос если франшиза текущего юзера strict
    и geo_region не совпадает с franchise.allowed_region.

    Использование:
        @router.post("/", dependencies=[Depends(enforce_region_lock)])
        async def create_thing(...): ...
    """
    try:
        # ── 1. super_admin — bypass всегда ─────────────────────────────────────
        if current_user.role == UserRole.SUPER_ADMIN:
            return

        # ── 2. Юзер без тенанта — нечего проверять ─────────────────────────────
        if not current_user.tenant_id:
            return

        # ── 3. Загружаем франшизу. Если её нет / allowed_region не задан — bypass.
        franchise = await region_lock_service._load_franchise_for_tenant(
            db, current_user.tenant_id
        )
        if franchise is None or not franchise.allowed_region:
            return

        # ── 4. Если region_strict=False — только мониторинг (Phase 1) ─────────
        # Хук в audit_service / activity_service уже зафиксирует нарушение.
        if not franchise.region_strict:
            return

        # ── 5. Получаем geo_region текущего IP ─────────────────────────────────
        ip = _client_ip(request)
        if not ip:
            return  # graceful — без IP не блокируем
        geo: Optional[dict] = None
        try:
            from app.services import geoip_service
            geo = await geoip_service.lookup(ip)
        except Exception:
            geo = None

        if not geo:
            return  # graceful — без geo не блокируем (приватный IP / нет mmdb)

        geo_region = geo.get("region")
        # ── 6. Если geo_region не определился — graceful bypass ────────────────
        if not geo_region:
            return

        # ── 7. Сравнение через нормализатор из service ─────────────────────────
        if region_lock_service._matches(geo_region, franchise.allowed_region):
            return

        # ── 8. НАРУШЕНИЕ. Пишем мягкий аудит + Telegram через check_violation. ─
        # check_violation сам делает дедуп алертов и flush в БД.
        try:
            await region_lock_service.check_violation(
                db,
                tenant_id=current_user.tenant_id,
                geo_region=geo_region,
                geo_country_name=geo.get("country_name"),
                geo_city=geo.get("city"),
                ip_address=ip,
                original_action="region.block",
                actor_id=current_user.id,
                actor_name=current_user.full_name,
            )
            # Коммитим запись аудита — иначе при HTTPException транзакция откатится.
            await db.commit()
        except Exception as e:
            log.warning(f"region_lock enforce: audit write failed: {e}")

        # ── 9. Блокируем запрос ────────────────────────────────────────────────
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"{BLOCK_MESSAGE_PREFIX}. "
                f"Разрешён: {franchise.allowed_region}. Обнаружен: {geo_region}."
            ),
        )
    except HTTPException:
        raise
    except Exception as e:
        # Любая внутренняя ошибка — НЕ блокируем (graceful), просто логируем.
        log.warning(f"enforce_region_lock unexpected error: {e}")
        return


async def enforce_region_lock_login(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Вариант для /auth/login — без current_user (юзер ещё не залогинен).
    Берём username/tenant из тела запроса нельзя на этом уровне (Depends исполняется до
    парсинга body), поэтому здесь ТОЛЬКО IP→geo lookup. Используем как pre-flight для
    общей видимости. Реальная проверка по франшизе делается ВНУТРИ login-хендлера.
    """
    return  # placeholder — login-хендлер сам зовёт check_violation после auth
