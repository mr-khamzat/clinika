"""PII shadow columns: encrypted + hash для phone/email (двухколоночный подход)

Revision ID: piimed_03
Revises: piimed_02
Create Date: 2026-05-29
"""
from alembic import op
import sqlalchemy as sa


revision = 'piimed_03'
down_revision = 'piimed_02'
branch_labels = None
depends_on = None


# Список (таблица, исходная_колонка, encrypted_колонка, hash_колонка, тип_хэша)
# hash_type: 'phone' / 'email' / 'text'
TARGETS = [
    ('users', 'phone_number', 'phone_number_encrypted', 'phone_number_hash', 'phone'),
    ('users', 'email', 'email_encrypted', 'email_hash', 'email'),
    ('users', 'full_name', 'full_name_encrypted', 'full_name_hash', 'text'),
    ('patient_accounts', 'phone', 'phone_encrypted', 'phone_hash', 'phone'),
    ('patient_accounts', 'email', 'email_encrypted', 'email_hash', 'email'),
    ('patient_otps', 'phone', 'phone_encrypted', 'phone_hash', 'phone'),
    ('signup_requests', 'phone', 'phone_encrypted', 'phone_hash', 'phone'),
    ('signup_requests', 'email', 'email_encrypted', 'email_hash', 'email'),
    ('contact_requests', 'phone', 'phone_encrypted', 'phone_hash', 'phone'),
    ('contact_requests', 'email', 'email_encrypted', 'email_hash', 'email'),
    ('appointments', 'patient_phone', 'patient_phone_encrypted', 'patient_phone_hash', 'phone'),
    ('doctors', 'full_name', 'full_name_encrypted', 'full_name_hash', 'text'),
]


def upgrade() -> None:
    for tbl, src, enc, hashc, ht in TARGETS:
        op.add_column(tbl, sa.Column(enc, sa.Text(), nullable=True))
        op.add_column(tbl, sa.Column(hashc, sa.String(64), nullable=True))
        op.create_index(f'ix_{tbl}_{hashc}', tbl, [hashc])

    # Backfill: existing data → encrypt + hash через Python.
    # Используем connection из op для row-by-row update.
    conn = op.get_bind()
    from app.services.encryption_service import (
        encrypt, hash_phone, hash_email, hash_text
    )

    HASH_FN = {'phone': hash_phone, 'email': hash_email, 'text': hash_text}

    for tbl, src, enc, hashc, ht in TARGETS:
        rows = conn.execute(sa.text(f"SELECT id, {src} FROM {tbl} WHERE {src} IS NOT NULL AND {src} != ''")).fetchall()
        if not rows:
            continue
        fn = HASH_FN[ht]
        for row in rows:
            rid = row[0]
            val = row[1]
            e = encrypt(str(val))
            h = fn(str(val))
            conn.execute(
                sa.text(f"UPDATE {tbl} SET {enc} = :e, {hashc} = :h WHERE id = :id"),
                {'e': e, 'h': h, 'id': rid}
            )


def downgrade() -> None:
    for tbl, src, enc, hashc, ht in TARGETS:
        op.drop_index(f'ix_{tbl}_{hashc}', table_name=tbl)
        op.drop_column(tbl, hashc)
        op.drop_column(tbl, enc)
