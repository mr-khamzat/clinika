"""
Зависимости для accountant-роутеров.

require_accountant — пускает: accountant, manager, franchise_owner,
director, deputy_director, super_admin.

В каждом эндпоинте, использующем эту dependency, дополнительно фильтруем
по clinic_id (бухгалтер привязан к одной клинике; manager/director могут
видеть несколько — в Phase 2/3 добавим клиника-селектор в UI).
"""
from fastapi import Depends, HTTPException, status

from app.models.user import User, UserRole
from app.core.deps import get_current_user


_ACCOUNTANT_ALLOWED = {
    UserRole.ACCOUNTANT,
    UserRole.MANAGER,
    UserRole.FRANCHISE_OWNER,
    UserRole.DIRECTOR,
    UserRole.DEPUTY_DIRECTOR,
    UserRole.SUPER_ADMIN,
}


async def require_accountant(user: User = Depends(get_current_user)) -> User:
    if user.role not in _ACCOUNTANT_ALLOWED:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Доступ только для бухгалтера/руководителя/директора",
        )
    return user


def scope_clinic_ids(user: User) -> list:
    """
    Список clinic_id, которые видит пользователь.

    Бухгалтер — только своя клиника. Менеджер с привязкой к клинике — своя
    клиника + filial-ы (для MVP — только своя). Директор/owner/super_admin —
    все клиники tenant'а (None означает «без фильтра по clinic_id»).
    """
    if user.role == UserRole.SUPER_ADMIN:
        return []  # пустой список = без ограничений (вызывающий код знает)
    if user.role in (UserRole.ACCOUNTANT, UserRole.MANAGER):
        return [user.clinic_id] if user.clinic_id else []
    # director / deputy_director / franchise_owner — tenant-wide
    return []
