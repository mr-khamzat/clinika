"""
SMS-плагин.
Текущая реализация — Telegram-уведомления как fallback (контакт-форма).
Для подключения реального SMS-провайдера — переопределить метод send().
Провайдер выбирается через SMS_PROVIDER в .env: "telegram" | "smsc" | "smsru" | "stub"
"""
import logging
from app.plugins.base import BasePlugin
from app.config import settings

logger = logging.getLogger("plugin.sms")


class SMSPlugin(BasePlugin):
    name = "sms"
    display_name = "SMS-уведомления"
    description = "Отправка SMS-уведомлений пациентам и сотрудникам"

    async def is_enabled(self) -> bool:
        provider = getattr(settings, "sms_provider", "stub")
        return provider != "stub"

    async def health_check(self) -> dict:
        provider = getattr(settings, "sms_provider", "stub")
        if provider == "stub":
            return {"ok": False, "detail": "SMS_PROVIDER не настроен (stub режим)"}
        return {"ok": True, "detail": f"Провайдер: {provider}"}

    async def send(self, phone: str, message: str) -> bool:
        """
        Отправить SMS.
        В stub-режиме только логирует. В smsc/smsru — вызывает API провайдера.
        Возвращает True если отправлено успешно.
        """
        provider = getattr(settings, "sms_provider", "stub")

        if provider == "stub":
            logger.info(f"[SMS STUB] → {phone}: {message}")
            return False

        if provider == "smsc":
            return await self._send_smsc(phone, message)

        if provider == "smsru":
            return await self._send_smsru(phone, message)

        logger.warning(f"[SMS] Неизвестный провайдер: {provider}")
        return False

    async def _send_smsc(self, phone: str, message: str) -> bool:
        """SMSC.ru — https://smsc.ru/api/"""
        import httpx
        login = getattr(settings, "smsc_login", "")
        password = getattr(settings, "smsc_password", "")
        if not login or not password:
            logger.error("[SMS] SMSC_LOGIN / SMSC_PASSWORD не настроены")
            return False
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    "https://smsc.ru/sys/send.php",
                    params={"login": login, "psw": password, "phones": phone,
                            "mes": message, "fmt": 3, "charset": "utf-8"},
                )
                data = resp.json()
                if data.get("error_code"):
                    logger.error(f"[SMS] SMSC ошибка: {data}")
                    return False
                logger.info(f"[SMS] SMSC отправлено → {phone}, id={data.get(id)}")
                return True
        except Exception as e:
            logger.error(f"[SMS] SMSC исключение: {e}")
            return False

    async def _send_smsru(self, phone: str, message: str) -> bool:
        """SMS.ru — https://sms.ru/api/"""
        import httpx
        api_id = getattr(settings, "smsru_api_id", "")
        if not api_id:
            logger.error("[SMS] SMSRU_API_ID не настроен")
            return False
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    "https://sms.ru/sms/send",
                    params={"api_id": api_id, "to": phone, "msg": message,
                            "json": 1, "charset": "utf-8"},
                )
                data = resp.json()
                status = data.get("status")
                if status != "OK":
                    logger.error(f"[SMS] SMSRU ошибка: {data}")
                    return False
                logger.info(f"[SMS] SMSRU отправлено → {phone}")
                return True
        except Exception as e:
            logger.error(f"[SMS] SMSRU исключение: {e}")
            return False
