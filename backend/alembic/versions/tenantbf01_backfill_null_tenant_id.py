"""tenantbf01 — backfill NULL tenant_id в тенантных таблицах (находка #7)

Revision ID: tenantbf01
Revises: invrev01
Create Date: 2026-06-08

Контекст (Волна 0, security-remediation-wave0):
Находка #7 — системный fail-open bypass tenant-изоляции при NULL tenant_id.
`User.tenant_id`, `Clinic.tenant_id`, `PatientChat.tenant_id`,
`PatientSession.tenant_id`, medcard/документы/виталки объявлены nullable+SET NULL,
а demo/seed-данные и осиротевшие при удалении тенанта строки рождаются с NULL.
Эта миграция — ФУНДАМЕНТ оси ПДн/изоляции: без полного backfill нельзя
выкатывать строгий RLS (#1), NOT NULL на appointments (#2), шифрование (#17),
M2M tenant↔patient (#18) — иначе строгая политика спрячет NULL-строки.

ВАЖНО: миграция выполняет ТОЛЬКО backfill по достоверным связям + точечный,
заведомо безопасный SET NOT NULL. Она ИДЕМПОТЕНТНА (каждый UPDATE имеет
WHERE tenant_id IS NULL — повторный прогон ничего не меняет). КОНСЕРВАТИВНА:
SET NOT NULL ставится лишь там, где backfill заведомо покрывает все строки
и сущность всегда тенантная. Спорные таблицы (phone-keyed, clinics, users)
остаются nullable — см. residualRisk.

────────────────────────────────────────────────────────────────────────────
ЦЕПОЧКИ BACKFILL (точные имена таблиц/колонок/FK взяты из моделей):

A. appointments.tenant_id  ←  clinics.tenant_id
     appointments.clinic_id  → clinics.id   (clinic_id NOT NULL на appointments)
   Самая надёжная связь: у каждой записи есть клиника, и tenant клиники = tenant
   приёма. NOT NULL на appointments здесь НЕ ставим — это собственность находки
   #2 (она же пересоздаёт FK с ondelete RESTRICT). Только backfill.

B. patient_chats.tenant_id           ←  appointments (по patient_phone, single-tenant)
   patient_diagnoses.tenant_id        ←  appointments (по patient_phone, single-tenant)
   patient_allergies.tenant_id        ←  appointments (по patient_phone, single-tenant)
   patient_vaccinations.tenant_id     ←  appointments (по patient_phone, single-tenant)
   patient_documents.tenant_id        ←  appointments (по patient_phone, single-tenant)
   patient_prescription_cache.tenant_id ← appointments (по patient_phone, single-tenant)
   patient_vitals.tenant_id           ←  appointments (по patient_phone, single-tenant)
   Эти таблицы НЕ имеют clinic_id — единственная достоверная связь к тенанту это
   patient_phone. Backfill КОНСЕРВАТИВНЫЙ: проставляем tenant_id ТОЛЬКО когда ВСЕ
   непустые tenant_id в appointments по этому телефону указывают на ОДИН тенант
   (нет межтенантной неоднозначности). Если телефон лечился в нескольких тенантах
   или приёмов нет — строка остаётся NULL (её закроет #18 через TenantPatient).

C. users.tenant_id  ←  clinics.tenant_id
     users.clinic_id → clinics.id   (clinic_id nullable)
   Только для пользователей с непустым clinic_id и клиникой, у которой есть tenant.
   NOT NULL НЕ ставим: super_admin/director без клиники и сами клиники с NULL
   tenant остаются — это легитимный кейс (см. находку #7: super_admin.tenant_id
   обычно NULL).

D. clinics.tenant_id — НЕ backfill'им автоматически. Достоверной связи
   clinic→tenant в схеме нет (FK идёт от users/appointments К клинике, не наоборот).
   Demo/seed-клиники без тенанта (main.py:_seed_default_tenant) — операционный
   фикс: либо привязать вручную к default-тенанту, либо удалить как сид. Делать
   это data-скриптом в maintenance-окне с проверкой каждой строки, не вслепую.

────────────────────────────────────────────────────────────────────────────
SET NOT NULL: НЕ ставится ни на одной таблице в этой миграции.
  • appointments — собственность #2 (+ пересоздание FK ondelete RESTRICT).
  • phone-keyed таблицы — backfill не гарантирует 0 NULL (телефоны без приёмов /
    межтенантные телефоны остаются NULL).
  • users / clinics — легитимно содержат NULL (super_admin, demo-клиники).
Финальный SET NOT NULL по этим сущностям — после полной зачистки в #2/#18 и
проверки `COUNT(*) WHERE tenant_id IS NULL = 0` на проде.

downgrade():
  Сам backfill данных НЕ откатываем (проставленный по достоверной связи tenant_id
  корректен и его откат вернул бы дыру изоляции). SET NOT NULL в upgrade не
  ставился — откатывать нечего. downgrade — осознанный no-op.
"""
from alembic import op
import sqlalchemy as sa

revision = "tenantbf01"
down_revision = "invrev01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── A. appointments ← clinics (по clinic_id) ────────────────────────────
    # Идемпотентно: только строки с NULL tenant_id. Берём tenant_id клиники
    # приёма; если у клиники tenant NULL — corr. подзапрос вернёт NULL и строка
    # останется NULL (повторно подхватится после фикса clinics).
    op.execute(
        sa.text(
            """
            UPDATE appointments AS a
               SET tenant_id = c.tenant_id
              FROM clinics AS c
             WHERE a.tenant_id IS NULL
               AND a.clinic_id = c.id
               AND c.tenant_id IS NOT NULL
            """
        )
    )

    # ── B. phone-keyed таблицы ← appointments (single-tenant по телефону) ────
    # Проставляем tenant_id ТОЛЬКО если по этому patient_phone ВСЕ непустые
    # tenant_id в appointments указывают на ровно один тенант
    # (COUNT(DISTINCT tenant_id) = 1). Иначе — неоднозначно, оставляем NULL.
    phone_tables = [
        "patient_chats",
        "patient_diagnoses",
        "patient_allergies",
        "patient_vaccinations",
        "patient_documents",
        "patient_prescription_cache",
        "patient_vitals",
    ]
    for tbl in phone_tables:
        op.execute(
            sa.text(
                f"""
                UPDATE {tbl} AS t
                   SET tenant_id = sub.tenant_id
                  FROM (
                        SELECT a.patient_phone AS patient_phone,
                               -- COUNT(DISTINCT)=1 ниже гарантирует ровно один тенант;
                               -- MIN(uuid) в PostgreSQL не существует → берём через ::text-каст.
                               MIN(a.tenant_id::text)::uuid AS tenant_id
                          FROM appointments AS a
                         WHERE a.tenant_id IS NOT NULL
                         GROUP BY a.patient_phone
                        HAVING COUNT(DISTINCT a.tenant_id) = 1
                       ) AS sub
                 WHERE t.tenant_id IS NULL
                   AND t.patient_phone = sub.patient_phone
                """
            )
        )

    # ── C. users ← clinics (по clinic_id) ───────────────────────────────────
    # Только пользователи с непустым clinic_id и клиникой, у которой есть tenant.
    # super_admin/director без клиники и клиники с NULL tenant остаются NULL.
    op.execute(
        sa.text(
            """
            UPDATE users AS u
               SET tenant_id = c.tenant_id
              FROM clinics AS c
             WHERE u.tenant_id IS NULL
               AND u.clinic_id IS NOT NULL
               AND u.clinic_id = c.id
               AND c.tenant_id IS NOT NULL
            """
        )
    )

    # ── D. clinics.tenant_id — НАМЕРЕННО НЕ трогаем (см. докстринг). ─────────
    # ── SET NOT NULL — НАМЕРЕННО НИ НА ОДНОЙ таблице (см. докстринг). ────────


def downgrade() -> None:
    # No-op: backfill данных не откатываем (откат вернул бы дыру изоляции),
    # SET NOT NULL в upgrade не ставился — откатывать нечего.
    pass
