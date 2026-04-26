"""Wiki system: pages + images tables

Revision ID: q8r9s0t1u2v3
Revises: p7q8r9s0t1u2
"""
from alembic import op
import sqlalchemy as sa

revision = 'q8r9s0t1u2v3'
down_revision = 'p7q8r9s0t1u2'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'wiki_pages',
        sa.Column('id', sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text('gen_random_uuid()')),
        sa.Column('slug', sa.String(200), nullable=False, unique=True, index=True),
        sa.Column('title', sa.String(500), nullable=False),
        sa.Column('content_md', sa.Text, nullable=False, server_default=''),
        sa.Column('icon', sa.String(60), nullable=False, server_default='article'),
        sa.Column('parent_id', sa.dialects.postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('wiki_pages.id', ondelete='SET NULL'), nullable=True),
        sa.Column('sort_order', sa.Integer, nullable=False, server_default='0'),
        sa.Column('is_published', sa.Boolean, nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('now()')),
        sa.Column('created_by_id', sa.dialects.postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
    )

    op.create_table(
        'wiki_images',
        sa.Column('id', sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text('gen_random_uuid()')),
        sa.Column('page_id', sa.dialects.postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('wiki_pages.id', ondelete='SET NULL'), nullable=True),
        sa.Column('filename', sa.String(200), nullable=False),
        sa.Column('mime_type', sa.String(60), nullable=False, server_default='image/png'),
        sa.Column('data_b64', sa.Text, nullable=False),
        sa.Column('size_bytes', sa.Integer, nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text('now()')),
    )


def downgrade():
    op.drop_table('wiki_images')
    op.drop_table('wiki_pages')
