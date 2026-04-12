"""
Определение типа устройства по User-Agent.
Без внешних зависимостей — простой string-matching.
"""
from enum import Enum


class DeviceType(str, Enum):
    MOBILE = "mobile"
    TABLET = "tablet"
    DESKTOP = "desktop"
    BOT = "bot"
    UNKNOWN = "unknown"


# Паттерны (нижний регистр)
_BOT_PATTERNS = ("googlebot", "bingbot", "yandexbot", "slurp", "duckduckbot",
                 "baiduspider", "facebookexternalhit", "twitterbot", "crawler",
                 "spider", "python-httpx", "python-requests", "curl/", "wget/")

_TABLET_PATTERNS = ("ipad", "tablet", "kindle", "silk", "playbook",
                    "nexus 7", "nexus 9", "nexus 10", "gt-p", "sm-t")

_MOBILE_PATTERNS = ("iphone", "ipod", "android", "mobile", "blackberry",
                    "windows phone", "opera mini", "opera mobi", "webos",
                    "symbian", "nokia", "samsung", "lg-", "htc")


def parse_user_agent(user_agent: str | None) -> DeviceType:
    """Определяет тип устройства по строке User-Agent."""
    if not user_agent:
        return DeviceType.UNKNOWN

    ua = user_agent.lower()

    if any(p in ua for p in _BOT_PATTERNS):
        return DeviceType.BOT

    if any(p in ua for p in _TABLET_PATTERNS):
        return DeviceType.TABLET

    if any(p in ua for p in _MOBILE_PATTERNS):
        return DeviceType.MOBILE

    return DeviceType.DESKTOP


def get_device_info(user_agent: str | None) -> dict:
    """Расширенная информация об устройстве."""
    device_type = parse_user_agent(user_agent)
    ua = (user_agent or "").lower()

    os_name = "Unknown"
    if "iphone" in ua or "ipad" in ua or "ipod" in ua:
        os_name = "iOS"
    elif "android" in ua:
        os_name = "Android"
    elif "windows" in ua:
        os_name = "Windows"
    elif "macintosh" in ua or "mac os" in ua:
        os_name = "macOS"
    elif "linux" in ua:
        os_name = "Linux"

    browser = "Unknown"
    if "telegram" in ua:
        browser = "Telegram"
    elif "firefox" in ua:
        browser = "Firefox"
    elif "chrome" in ua and "safari" in ua:
        browser = "Chrome"
    elif "safari" in ua:
        browser = "Safari"
    elif "edge" in ua:
        browser = "Edge"

    return {
        "device_type": device_type,
        "os": os_name,
        "browser": browser,
        "is_mobile": device_type in (DeviceType.MOBILE, DeviceType.TABLET),
        "is_bot": device_type == DeviceType.BOT,
    }
