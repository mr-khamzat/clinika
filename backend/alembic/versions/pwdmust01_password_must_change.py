"""pwdmust01 — users.password_must_change для принудительной смены пароля.

Сотрудник, которому администратор задал временный пароль, при первом входе
должен сменить его. Флаг users.password_must_change=TRUE выставляется во всех
admin-side endpoint-ах создания/сброса пароля (manager/staff, clinics_mgmt,
external_doctors, partners, recruiter_doctors, recruiter, franchise_owner_clinics,
mis_sync, admin, onboarding). Сбрасывается в FALSE только когда пользователь
сам сменил пароль через /profile/me или /password_reset.

UI: <ForcePasswordChangeModal> блокирует кабинет, пока флаг TRUE.

Revision ID: pwdmust01_password_must_change
Revises: avatar01_user_avatar_url
Create Date: 2026-05-20
"""
from alembic import op
import sqlalchemy as sa


revision = "pwdmust01_password_must_change"
down_revision = "avatar01_user_avatar_url"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "password_must_change",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "password_must_change")
