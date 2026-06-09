"""
Глава 8 — Сервис семейного профиля пациента.

Бизнес-логика:
  - создание группы (один владелец);
  - добавление члена (по телефону: создать pending invite или связать сразу);
  - принятие приглашения по token;
  - изменение прав / удаление члена;
  - агрегированный кабинет (приёмы/направления члена с проверкой прав).
"""
import uuid
import secrets
from datetime import datetime, date
from typing import Optional

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.family import FamilyGroup, FamilyMember, FamilyInvite
from app.models.patient_account import PatientAccount
from app.utils.phone import normalize_phone, phone_variants


VALID_RELATIONS = {"self", "spouse", "child", "parent", "sibling", "other"}


async def get_or_create_account_by_phone(
    db: AsyncSession, phone: str, name: str | None = None,
    birth_date: date | None = None,
) -> tuple[PatientAccount, bool]:
    """Найти или создать PatientAccount по телефону. Возвращает (account, is_new)."""
    phone_n = normalize_phone(phone)
    # Ищем по всем вариантам формата (с +, без +, с 8) — в БД могут лежать смешанные.
    variants = phone_variants(phone)
    r = await db.execute(
        select(PatientAccount).where(PatientAccount.phone.in_(variants))
    )
    acc = r.scalar_one_or_none()
    if acc:
        return acc, False
    acc = PatientAccount(
        id=uuid.uuid4(),
        phone="+" + phone_n if not phone_n.startswith("+") else phone_n,
        name=name,
        birth_date=birth_date,
        is_active=True,
    )
    db.add(acc)
    await db.flush()
    return acc, True


async def get_account_by_phone(db: AsyncSession, phone: str) -> PatientAccount | None:
    variants = phone_variants(phone)
    r = await db.execute(
        select(PatientAccount).where(PatientAccount.phone.in_(variants))
    )
    return r.scalars().first()


async def get_or_create_group(
    db: AsyncSession, owner: PatientAccount,
    tenant_id: uuid.UUID | None, name: str | None = None,
) -> FamilyGroup:
    """Найти существующую или создать новую группу для владельца."""
    r = await db.execute(
        select(FamilyGroup).where(FamilyGroup.owner_patient_id == owner.id)
    )
    grp = r.scalar_one_or_none()
    if grp:
        if name and not grp.name:
            grp.name = name
            grp.updated_at = datetime.utcnow()
            await db.flush()
        return grp
    grp = FamilyGroup(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        owner_patient_id=owner.id,
        name=name,
    )
    db.add(grp)
    await db.flush()

    # Добавляем владельца как self
    self_member = FamilyMember(
        id=uuid.uuid4(),
        group_id=grp.id,
        patient_id=owner.id,
        relation="self",
        can_view_records=True,
        can_book_appointments=True,
        can_manage_payments=True,
    )
    db.add(self_member)
    await db.flush()
    return grp


async def list_members(db: AsyncSession, group_id: uuid.UUID) -> list[dict]:
    """Список членов группы с раскрытием PatientAccount."""
    r = await db.execute(
        select(FamilyMember, PatientAccount)
        .join(PatientAccount, FamilyMember.patient_id == PatientAccount.id)
        .where(FamilyMember.group_id == group_id)
        .order_by(FamilyMember.added_at.asc())
    )
    out = []
    for m, p in r.all():
        out.append({
            "id": str(m.id),
            "patient_id": str(p.id),
            "patient_phone": p.phone,
            "patient_name": p.name,
            "birth_date": p.birth_date.isoformat() if p.birth_date else None,
            "relation": m.relation,
            "can_view_records": m.can_view_records,
            "can_book_appointments": m.can_book_appointments,
            "can_manage_payments": m.can_manage_payments,
            "added_at": m.added_at.isoformat(),
        })
    return out


async def find_membership(
    db: AsyncSession, group_id: uuid.UUID, member_id: uuid.UUID,
) -> FamilyMember | None:
    r = await db.execute(
        select(FamilyMember).where(
            and_(FamilyMember.id == member_id, FamilyMember.group_id == group_id)
        )
    )
    return r.scalars().first()


async def is_member_of(
    db: AsyncSession, group_id: uuid.UUID, patient_id: uuid.UUID,
) -> FamilyMember | None:
    r = await db.execute(
        select(FamilyMember).where(
            and_(FamilyMember.group_id == group_id,
                 FamilyMember.patient_id == patient_id)
        )
    )
    return r.scalars().first()


async def create_invite(
    db: AsyncSession, group_id: uuid.UUID,
    inviter_id: uuid.UUID, invitee_phone: str,
    invitee_name: str | None, relation: str,
) -> FamilyInvite:
    token = secrets.token_urlsafe(32)
    inv = FamilyInvite(
        id=uuid.uuid4(),
        group_id=group_id,
        inviter_patient_id=inviter_id,
        invitee_phone=normalize_phone(invitee_phone),
        invitee_name=invitee_name,
        relation=relation if relation in VALID_RELATIONS else "other",
        token=token,
        status="pending",
    )
    db.add(inv)
    await db.flush()
    return inv


async def find_invite_by_token(db: AsyncSession, token: str) -> FamilyInvite | None:
    r = await db.execute(select(FamilyInvite).where(FamilyInvite.token == token))
    return r.scalars().first()


async def accept_invite(
    db: AsyncSession, invite: FamilyInvite, accepting_account: PatientAccount,
) -> FamilyMember:
    """Создать FamilyMember для accepting_account в группе invite."""
    if invite.status != "pending":
        raise ValueError("invite_not_pending")
    if invite.expires_at < datetime.utcnow():
        invite.status = "expired"
        await db.flush()
        raise ValueError("invite_expired")

    # Дозволено только тому, чей телефон совпадает с invitee_phone
    if normalize_phone(accepting_account.phone) != normalize_phone(invite.invitee_phone):
        raise ValueError("phone_mismatch")

    existing = await is_member_of(db, invite.group_id, accepting_account.id)
    if existing:
        invite.status = "accepted"
        invite.accepted_at = datetime.utcnow()
        await db.flush()
        return existing

    m = FamilyMember(
        id=uuid.uuid4(),
        group_id=invite.group_id,
        patient_id=accepting_account.id,
        relation=invite.relation if invite.relation in VALID_RELATIONS else "other",
        can_view_records=True,
        can_book_appointments=True,
        can_manage_payments=False,
    )
    db.add(m)
    invite.status = "accepted"
    invite.accepted_at = datetime.utcnow()
    await db.flush()
    return m
