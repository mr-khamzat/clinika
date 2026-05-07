"""Конфигурация приложения через pydantic-settings.

Модуль предоставляет централизованное управление настройками приложения
через переменные окружения и .env файл.
"""
from typing import List
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Настройки приложения из переменных окружения.
    
    Attributes:
        database_url: PostgreSQL connection URL
        redis_url: Redis connection URL  
        secret_key: Secret key for JWT signing
        jwt_algorithm: Algorithm for JWT encoding (default: HS256)
        jwt_expire_hours: JWT token expiration time in hours
        qr_secret: Secret for QR code generation
        telegram_bot_token: Telegram bot token for notifications
        admin_bot_token: Telegram admin notification bot token
        gemini_api_key: Google Gemini AI API key
        mini_app_url: Frontend mini app URL
        backend_url: Backend API URL
        manager_telegram_ids: Comma-separated Telegram IDs for auto-manager role
        mis_api_key: MIS Renovatio API key
        mis_ssl_verify: SSL verification for MIS connections
        webhook_api_key: Webhook protection key
        allowed_origins: Comma-separated CORS origins
        onboarding_secret: Secret for /tenant/create endpoint protection
        superadmin_username: Superadmin username
        superadmin_password: Superadmin password
        superadmin_full_name: Superadmin full name
    """
    database_url: str
    redis_url: str
    secret_key: str
    jwt_algorithm: str = "HS256"
    jwt_expire_hours: int = 24
    qr_secret: str
    telegram_bot_token: str = ""
    admin_bot_token: str = ""  # Telegram admin notification bot (stclinik_addmin_bot)
    gemini_api_key: str = ""  # Google Gemini AI API key (GET /ai/insights)
    mini_app_url: str = "http://localhost:8901"
    backend_url: str = "http://localhost:8900"
    # Telegram IDs через запятую — эти пользователи автоматически получают роль manager
    manager_telegram_ids: str = ""

    # MIS Renovatio — вынесено из кода в конфиг
    mis_api_key: str = ""
    mis_ssl_verify: bool = True
    mis_ca_cert_path: str = ""  # Путь к CA-сертификату МИС (пустая строка = системные CA)   # False только если у МИС самоподписанный сертификат

    # Отдельный ключ для вебхука МИС (не JWT-секрет)
    webhook_api_key: str = ""

    # CORS — через запятую (продакшн: только ваш домен)
    allowed_origins: str = "http://localhost:5173,http://localhost:8901"

    # Ключ для защиты эндпоинта /tenant/create
    onboarding_secret: str = ""

    # ===== БЛОК: Учётные данные суперадмина (fail-fast — обязательны в .env) =====
    # Раньше здесь стоял хардкод "khamzat88712" в дефолте — убран ради безопасности.
    # Если SUPERADMIN_PASSWORD не задан в .env — сервис не стартует (pydantic ValueError).
    superadmin_username: str
    superadmin_password: str
    superadmin_full_name: str = "Системный администратор"

    # TURN/STUN для WebRTC (REST API time-limited credentials)
    turn_host: str = ""
    turn_port: int = 3478
    turn_secret: str = ""
    turn_ttl: int = 3600

    class Config:
        env_file = ".env"

    def get_manager_ids(self) -> List[str]:
        """Возвращает список Telegram ID менеджеров.
        
        Returns:
            List of Telegram user IDs as strings
        """
        return [x.strip() for x in self.manager_telegram_ids.split(",") if x.strip()]

    def get_allowed_origins(self) -> List[str]:
        """Возвращает список разрешённых origin для CORS.
        
        Returns:
            List of allowed CORS origins
        """
        return [x.strip() for x in self.allowed_origins.split(",") if x.strip()]


settings = Settings()
