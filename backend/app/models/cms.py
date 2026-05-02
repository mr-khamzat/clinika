import uuid
from datetime import datetime
from sqlalchemy import Column, String, Text, Boolean, Integer, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from app.database import Base


class TenantCmsPage(Base):
    __tablename__ = "tenant_cms_pages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    slug = Column(String(200), nullable=False)
    title = Column(String(500), nullable=False)
    content_md = Column(Text, nullable=True)
    content_blocks = Column(JSONB, nullable=True, default=list)
    is_published = Column(Boolean, nullable=False, default=True)
    page_type = Column(String(50), nullable=False, default="info")
    show_in_menu = Column(Boolean, nullable=False, default=False)
    menu_title = Column(String(200), nullable=True)
    sort_order = Column(Integer, nullable=False, default=0)
    seo_title = Column(String(200), nullable=True)
    seo_description = Column(String(500), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
