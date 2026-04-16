from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    database_url: str
    redis_url: str
    secret_key: str
    jwt_algorithm: str = "HS256"
    jwt_expire_hours: int = 24
    qr_secret: str
    telegram_bot_token: str = ""
    admin_bot_token: str = ""  # Telegram admin notification bot (stclinik_addmin_bot)
    mini_app_url: str = "http://localhost:8901"
    backend_url: str = "http://localhost:8900"
    # Telegram IDs через запятую — эти пользователи автоматически получают роль manager
    manager_telegram_ids: str = ""

    # MIS Renovatio — вынесено из кода в конфиг
    mis_api_key: str = ""
    mis_ssl_verify: bool = True   # False только если у МИС самоподписанный сертификат

    # Отдельный ключ для вебхука МИС (не JWT-секрет)
    webhook_api_key: str = ""

    # CORS — через запятую (продакшн: только ваш домен)
    allowed_origins: str = "http://localhost:5173,http://localhost:8901"

    # Ключ для защиты эндпоинта /tenant/create
    onboarding_secret: str = ""

    # Учётные данные суперадмина (создаются при первом запуске)
    superadmin_username: str = "khamzat"
    superadmin_password: str = "khamzat88712"
    superadmin_full_name: str = "Системный администратор"

    class Config:
        env_file = ".env"

    def get_manager_ids(self) -> list[str]:
        return [x.strip() for x in self.manager_telegram_ids.split(",") if x.strip()]

    def get_allowed_origins(self) -> list[str]:
        return [x.strip() for x in self.allowed_origins.split(",") if x.strip()]

settings = Settings()
