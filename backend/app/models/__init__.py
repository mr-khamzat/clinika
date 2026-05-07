from app.models.user import User, UserRole
from app.models.clinic import Clinic
from app.models.clinic_schedule import ClinicSchedule
from app.models.service import Service
from app.models.referral import Referral, ReferralStatus
from app.models.referral_comment import ReferralComment
from app.models.bonus import Bonus, BonusStatus, BonusType
from app.models.settings import SystemSettings
from app.models.kpi_target import KpiTarget
from app.models.activity_log import ActivityLog
from app.models.invitation import Invitation
from app.models.discount import Discount, DiscountType
from app.models.support import SupportMessage
from app.models.tenant import Tenant, TenantLicense, TenantBranding, TenantModule, TenantPlugin
from app.models.franchise import Franchise
from app.models.franchise_invoice import FranchiseInvoice, InvoiceStatus
from app.models.call_rule import CallRule, CallScope
from app.models.city import City
from app.models.doctor import Doctor, DoctorSchedule, Appointment, AppointmentStatus
from app.models.ledger import LedgerEntry
from app.models.audit import AuditEntry
from app.models.billing import Subscription, Invoice, Payment
from app.models.refresh_token import RefreshToken
from app.models.consent import ConsentRecord
from app.models.plugin import PluginCatalog, PluginFeature, TenantPluginFeature, BillingEvent, ClinicVisibility
from app.models.presence import UserPresence, CallPermission, NotificationSetting, CallLog, PresenceStatus

__all__ = [
    "User", "UserRole", "Clinic", "ClinicSchedule", "Service",
    "City",
    "Doctor", "DoctorSchedule", "Appointment", "AppointmentStatus",
    "Referral", "ReferralStatus", "ReferralComment",
    "Bonus", "BonusStatus", "BonusType", "SystemSettings",
    "KpiTarget", "ActivityLog", "Invitation", "Discount", "DiscountType",
    "SupportMessage", "Tenant", "TenantLicense", "TenantBranding", "TenantModule", "TenantPlugin",
    "Franchise",
    "LedgerEntry", "AuditEntry", "Subscription", "Invoice", "Payment",
    "RefreshToken", "ConsentRecord",
    "PluginCatalog", "PluginFeature", "TenantPluginFeature", "BillingEvent", "ClinicVisibility",
    "UserPresence", "CallPermission", "NotificationSetting", "CallLog", "PresenceStatus",
]

from app.models.push_subscription import PushSubscription

from app.models.webhook import WebhookEndpoint, WebhookDelivery

# Биллинговая система v2
from app.models.billing_plan import TenantPlan, TenantPricingRules
from app.models.billing_ledger import BillingLedger
from app.models.advertising import Ad, AdEvent
from app.models.billing import TenantPluginSubscription, PluginSubStatus

# Рекрутерская система
from app.models.doctor_clinic_access import DoctorClinicAccess
from app.models.recruiter_bonus import RecruiterBonus, RecruiterBonusStatus
from app.models.ai_history import AIAnalysisHistory

# База знаний AI (FAQ — снижает расход токенов LLM)
from app.models.ai_knowledge import AIKnowledgeEntry

from app.models.commercial import CommercialModule, TenantModuleSubscription, TenantIntegration

# Система внешних и приглашённых врачей
from app.models.external_doctor import DoctorRequest, VisitingDoctorSettings

from app.models.wiki import WikiPage, WikiImage

# CMS страницы тенантов (Phase 1 SaaS)
from app.models.cms import TenantCmsPage

from app.models.review import Review
from app.models.inter_clinic_invoice import InterClinicInvoice
from app.models.contact_request import ContactRequest

# Семейный аккаунт пациента
from app.models.patient_family import PatientFamilyMember

# Чат пациента (вариант D — AI + регистратура)
from app.models.patient_chat import (
    PatientChat,
    PatientChatMessage,
    PatientChatMode,
    PatientChatSender,
)

# Программа лояльности (Этап 11 ROADMAP)
from app.models.loyalty import LoyaltyAccount, LoyaltyTransaction, LoyaltyTier, PatientAIConversation
