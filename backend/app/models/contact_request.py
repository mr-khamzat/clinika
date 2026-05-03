import uuid
from datetime import datetime
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base

class ContactRequest(Base):
    __tablename__ = 'contact_requests'
    id:         Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name:       Mapped[str | None]
    phone:      Mapped[str]
    email:      Mapped[str | None]
    message:    Mapped[str]
    is_read:    Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
