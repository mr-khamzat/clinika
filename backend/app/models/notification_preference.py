"""
Per-user настройки уведомлений в центре уведомлений (NotificationsBell).
Хранит список «отключённых» категорий — какие группы action-кодов
пользователь не хочет видеть в bell-дропдауне.

Отдельная таблица (а не колонка на User) — чтобы не плодить альтеры
огромной модели User и легко расширять позже (per-category settings,
per-channel: bell/email/telegram, тихие часы и т.п.).
"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import String

from app.database import Base


class NotificationPreference(Base):
    __tablename__ = "notification_preferences"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    # Список выключенных категорий: security/region/patient_data/staff/
    # referrals/bonuses/settings/discounts/contacts/system/finance
    disabled_categories: Mapped[list[str]] = mapped_column(
        ARRAY(String(40)),
        nullable=False,
        default=list,
        server_default="{}",
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )
