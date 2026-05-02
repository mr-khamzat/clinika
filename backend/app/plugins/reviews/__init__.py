"""Reviews plugin — отзывы пациентов о врачах."""
from app.plugins.base import BasePlugin


class ReviewsPlugin(BasePlugin):
    name         = "reviews"
    display_name = "Отзывы пациентов"
    description  = "Сбор и модерация отзывов о врачах. Публичный рейтинг."

    async def is_enabled(self) -> bool:
        return True

    async def health_check(self) -> dict:
        try:
            from app.database import async_session
            from sqlalchemy import text
            async with async_session() as db:
                await db.execute(text("SELECT 1 FROM reviews LIMIT 1"))
            return {"ok": True, "detail": "OK"}
        except Exception as e:
            return {"ok": False, "detail": str(e)}
