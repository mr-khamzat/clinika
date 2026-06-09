"""Encrypt medical PII columns (notes/conclusion/recommendations/body/description)

Revision ID: piimed_01
Revises: refrot_01
Create Date: 2026-05-29
"""
from alembic import op
import sqlalchemy as sa


revision = 'piimed_01'
down_revision = 'refrot_01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # appointment_outcomes
    op.alter_column('appointment_outcomes', 'conclusion',
                    new_column_name='conclusion_encrypted')
    op.alter_column('appointment_outcomes', 'recommendations',
                    new_column_name='recommendations_encrypted')
    # referrals — расширяем тип (Fernet token >500 байт) + rename
    op.alter_column('referrals', 'notes',
                    new_column_name='notes_encrypted', type_=sa.Text())
    # referral_comments
    op.alter_column('referral_comments', 'text',
                    new_column_name='text_encrypted')
    # lab_orders
    op.alter_column('lab_orders', 'notes',
                    new_column_name='notes_encrypted')
    # telemedicine_sessions
    op.alter_column('telemedicine_sessions', 'notes',
                    new_column_name='notes_encrypted')
    # telemedicine_prescriptions
    op.alter_column('telemedicine_prescriptions', 'body',
                    new_column_name='body_encrypted')
    # patient_documents
    op.alter_column('patient_documents', 'description',
                    new_column_name='description_encrypted')

    # Backfill: префикс 'plain:' к существующим строкам, чтобы decrypt() их
    # корректно вернул как plaintext. Не помечаем NULL.
    for tbl, col in [
        ('appointment_outcomes', 'conclusion_encrypted'),
        ('appointment_outcomes', 'recommendations_encrypted'),
        ('referrals', 'notes_encrypted'),
        ('referral_comments', 'text_encrypted'),
        ('lab_orders', 'notes_encrypted'),
        ('telemedicine_sessions', 'notes_encrypted'),
        ('telemedicine_prescriptions', 'body_encrypted'),
        ('patient_documents', 'description_encrypted'),
    ]:
        op.execute(
            f"UPDATE {tbl} SET {col} = 'plain:' || {col} "
            f"WHERE {col} IS NOT NULL AND {col} != '' "
            f"AND {col} NOT LIKE 'enc:%' AND {col} NOT LIKE 'plain:%'"
        )


def downgrade() -> None:
    # Снимаем префикс 'plain:' (необходим для downgrade restore)
    for tbl, col in [
        ('appointment_outcomes', 'conclusion_encrypted'),
        ('appointment_outcomes', 'recommendations_encrypted'),
        ('referrals', 'notes_encrypted'),
        ('referral_comments', 'text_encrypted'),
        ('lab_orders', 'notes_encrypted'),
        ('telemedicine_sessions', 'notes_encrypted'),
        ('telemedicine_prescriptions', 'body_encrypted'),
        ('patient_documents', 'description_encrypted'),
    ]:
        op.execute(
            f"UPDATE {tbl} SET {col} = SUBSTRING({col} FROM 7) "
            f"WHERE {col} LIKE 'plain:%'"
        )

    op.alter_column('patient_documents', 'description_encrypted', new_column_name='description')
    op.alter_column('telemedicine_prescriptions', 'body_encrypted', new_column_name='body')
    op.alter_column('telemedicine_sessions', 'notes_encrypted', new_column_name='notes')
    op.alter_column('lab_orders', 'notes_encrypted', new_column_name='notes')
    op.alter_column('referral_comments', 'text_encrypted', new_column_name='text')
    op.alter_column('referrals', 'notes_encrypted', new_column_name='notes', type_=sa.String(500))
    op.alter_column('appointment_outcomes', 'recommendations_encrypted', new_column_name='recommendations')
    op.alter_column('appointment_outcomes', 'conclusion_encrypted', new_column_name='conclusion')
