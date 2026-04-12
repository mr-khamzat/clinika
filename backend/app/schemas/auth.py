from pydantic import BaseModel

class TelegramAuthData(BaseModel):
    id: str
    first_name: str
    last_name: str | None = None
    username: str | None = None
    phone_number: str | None = None
    # Сырая строка initData от Telegram WebApp — используется для верификации подписи
    init_data: str | None = None

class PasswordLoginData(BaseModel):
    username: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    role: str
    clinic_id: str | None = None
    full_name: str
