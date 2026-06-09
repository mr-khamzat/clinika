import uuid
from datetime import datetime
from sqlalchemy import Text, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base

class ReferralComment(Base):
    __tablename__ = "referral_comments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    referral_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("referrals.id"), nullable=False)
    author_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    text_encrypted: Mapped[str] = mapped_column("text_encrypted", Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    author: Mapped["User"] = relationship("User", foreign_keys=[author_id])

    def __init__(self, **kwargs):
        # Прозрачное шифрование PII-полей на __init__
        from app.services.encryption_service import encrypt as _enc
        for plain, enc_col in [('text', 'text_encrypted')]:
            if plain in kwargs:
                val = kwargs.pop(plain)
                kwargs[enc_col] = _enc(val) if val is not None else None
        super().__init__(**kwargs)

    @property
    def text(self):
        from app.services.encryption_service import decrypt
        return decrypt(self.text_encrypted)

    @text.setter
    def text(self, value):
        from app.services.encryption_service import encrypt
        self.text_encrypted = encrypt(value) if value is not None else None
