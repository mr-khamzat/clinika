"""
Гео-утилиты: извлечение IP клиента из заголовков.
Определение города — через поле city_id / city на модели Clinic.
Без внешних GeoIP зависимостей (добавить geoip2 при необходимости).
"""
from fastapi import Request


def get_client_ip(request: Request) -> str | None:
    """
    Извлекает реальный IP клиента.
    Порядок: X-Real-IP → X-Forwarded-For → request.client.host
    """
    # X-Real-IP (nginx proxy_protocol / real_ip_header)
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()

    # X-Forwarded-For: может быть список через запятую
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()

    # Fallback: прямое соединение
    if request.client:
        return request.client.host

    return None


def is_internal_ip(ip: str | None) -> bool:
    """Проверяет, является ли IP внутренним/локальным."""
    if not ip:
        return True
    prefixes = ("127.", "10.", "192.168.", "172.16.", "172.17.",
                "172.18.", "172.19.", "172.20.", "172.21.", "172.22.",
                "172.23.", "172.24.", "172.25.", "172.26.", "172.27.",
                "172.28.", "172.29.", "172.30.", "172.31.", "::1", "localhost")
    return any(ip.startswith(p) for p in prefixes)
