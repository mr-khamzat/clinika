# ===== БЛОК: Region Lock — активная блокировка действий =====
# Два независимых режима, каждый можно включать/выключать флагом:
#
# (A) Manual block — `franchise.is_blocked=True` ИЛИ `blocked_until > NOW()`.
#     Ставится вручную из UI «Нарушения регионов» / форма редактирования франшизы.
#     Никакой автоматики. Bypass: запись в IP allowlist с `bypass_block=True`.
#
# (B) Auto-block по региону — `franchise.region_strict=True` (per-franchise тоггл).
#     Когда geo_region не совпадает с allowed_region — 403. Bypass: IP в allowlist.
#     По умолчанию ВЫКЛЮЧЕН (region_strict=False) — только алерт через
#     audit_service / activity_service hook (Phase 1).
#
# Используется как FastAPI Depends в чувствительных роутерах (clinics, referrals,
# bonuses, payments, manager/*) и в /auth/login.
#
# Общие граничные правила:
#   • super_admin — bypass всегда (надплатформенный)
#   • Юзер без tenant_id — нечего проверять
#   • IP в franchise_ip_allowlist — bypass auto-block (и manual block если bypass_block=True)
#   • Любая внутренняя ошибка — graceful (не блокируем)

import logging
from datetime import datetime
from typing import Optional
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import text as sa_text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.database import get_db
from app.models.user import User, UserRole
from app.services import region_lock_service

log = logging.getLogger("region_lock_enforce")

# Префиксы detail в 403 — фронт ловит их и показывает специальную модалку.
BLOCK_MESSAGE_PREFIX = "Доступ заблокирован: вы вне разрешённого региона франшизы"
MANUAL_BLOCK_PREFIX = "Доступ заблокирован администратором платформы"


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

        # ── 3. Загружаем франшизу ─────────────────────────────────────────────
        franchise = await region_lock_service._load_franchise_for_tenant(
            db, current_user.tenant_id
        )
        if franchise is None:
            return

        ip = _client_ip(request)

        # ── 4. Manual block (приоритет над auto-region) ───────────────────────
        # Активен если is_blocked=True или blocked_until > NOW(). Bypass только
        # для записей allowlist с bypass_block=True.
        if franchise.is_blocked or (
            franchise.blocked_until and franchise.blocked_until > datetime.utcnow()
        ):
            bypass_row = None
            if ip:
                try:
                    bypass_row = (await db.execute(
                        sa_text(
                            "SELECT 1 FROM franchise_ip_allowlist "
                            "WHERE franchise_id = :fid AND bypass_block = TRUE "
                            "AND CAST(:ip AS inet) <<= ip_cidr LIMIT 1"
                        ),
                        {"fid": str(franchise.id), "ip": ip},
                    )).first()
                except Exception as e:
                    log.warning(f"manual block bypass check failed: {e}")
                    bypass_row = None
            if bypass_row is None:
                detail = MANUAL_BLOCK_PREFIX
                if franchise.block_reason:
                    detail = f"{detail}. Причина: {franchise.block_reason}"
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)

        # ── 5. Auto-region block — только если allowed_region задан и strict=True ─
        if not franchise.allowed_region:
            return  # Phase 2 не активирован
        if not franchise.region_strict:
            return  # только Phase 1 — мониторинг через audit_service hook

        # ── 6. IP в allowlist? — bypass auto-region (без bypass_block требования)
        if ip and await region_lock_service.is_ip_allowlisted(db, franchise.id, ip):
            return

        # ── 7. Получаем geo_region текущего IP ─────────────────────────────────
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
        if not geo_region:
            return

        # ── 8. Сравнение через нормализатор из service ─────────────────────────
        if region_lock_service._matches(geo_region, franchise.allowed_region):
            return

        # ── 9. НАРУШЕНИЕ. Пишем мягкий аудит + Telegram через check_violation. ─
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

        # ── 10. Блокируем запрос ───────────────────────────────────────────────
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
