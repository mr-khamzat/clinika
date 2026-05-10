"""
Request ContextVar — middleware кладёт текущий Request, любой код может его достать.
Используется audit_service когда вызывающий не передал request= явно.

current_impersonator — заполняется в get_current_user когда токен имеет imp=true.
Содержит UUID оригинального super_admin (act claim из RFC 8693 token exchange).
audit_service использует его чтобы записать actor_id = реальный impersonator,
а не target user — это критично для compliance / расследований.
"""
from contextvars import ContextVar
from fastapi import Request

current_request: ContextVar[Request | None] = ContextVar('current_request', default=None)

# Impersonation context — кладётся в get_current_user, читается в audit_service.
# Структура: {"actor_id": UUID, "actor_name": str, "target_id": UUID, "reason": str | None}
current_impersonator: ContextVar[dict | None] = ContextVar('current_impersonator', default=None)
