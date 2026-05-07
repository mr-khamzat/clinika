"""
Request ContextVar — middleware кладёт текущий Request, любой код может его достать.
Используется audit_service когда вызывающий не передал request= явно.
"""
from contextvars import ContextVar
from fastapi import Request

current_request: ContextVar[Request | None] = ContextVar('current_request', default=None)
