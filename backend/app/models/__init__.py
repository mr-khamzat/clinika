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
from app.models.franchise_ip_allowlist import FranchiseIpAllowlist
from app.models.franchise_invoice import FranchiseInvoice, InvoiceStatus
from app.models.call_rule import CallRule, CallScope
from app.models.city import City
from app.models.doctor import Doctor, DoctorSchedule, Appointment, AppointmentStatus
# Итоги приёма: заключение врача, файлы, внутриклинические направления
from app.models.appointment_outcome import (
    AppointmentOutcome,
    AppointmentAttachment,
    InternalReferral,
)
from app.models.ledger import LedgerEntry
from app.models.audit import AuditEntry
from app.models.billing import Subscription, Invoice, Payment
from app.models.refresh_token import RefreshToken
from app.models.password_reset import PasswordResetToken
from app.models.consent import ConsentRecord
# Старая plugin_*-система удалена (заменена commercial_modules) — см. миграцию delete_legacy_plugins
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
from app.models.loyalty import LoyaltyAccount, LoyaltyTransaction, LoyaltyTier, PatientAIConversation, LoyaltyRule, LoyaltyReward

# AI-ассистент (W6) — Gemini-чат для пациентов
from app.models.ai_assistant import AiConversation, AiMessage

# RBAC как данные (Этап 8 ROADMAP) — overrides матрицы прав на уровне тенанта
from app.models.permission_override import TenantPermissionOverride

# LTV-аналитика (модуль ltv_pro) — снапшоты пациентов
from app.models.ltv import PatientLtvSnapshot

# Платёжный каркас клиники (online_payments_pro + fiscal_54fz_pro)
# Оплаты пациентов клинике + фискальные чеки 54-ФЗ из ОФД
from app.models.payments_clinic import (
    ClinicPayment,
    PaymentGatewayConfig,
    FiscalReceipt,
    OFDConfig,
    PaymentGateway,
    OFDProvider,
    ClinicPaymentStatus,
    FiscalOperationType,
)

# Notifications center — отметка прочитанности уведомлений (audit/activity/contact)
from app.models.notification_read import NotificationRead

# Telemedicine модуль (4990₽/мес) — видеоприём врач↔пациент через WebRTC
from app.models.telemedicine import (
    TelemedicineSession,
    TelemedicineChatMessage,
    TelemedicinePrescription,
    TelemedicineSessionStatus,
    TelemedicineChatRole,
)

# SMS-маркетинг модуль (1990₽/мес) — рассылки спящим пациентам, акции, реактивация
from app.models.sms_marketing import (
    SmsTemplate,
    SmsCampaign,
    SmsMessageLog,
    SmsCampaignStatus,
    SmsAudienceType,
    SmsMessageStatus,
    SmsProvider,
)

# Запись звонков + Whisper транскрипция (3990₽/мес) — модуль call_recording (W5)
from app.models.call_recording import (
    CallRecording,
    CallTranscript,
    CallSessionType,
    CallRecordingStatus,
)

# Inventory модуль (1990₽/мес) — учёт расходных материалов и оборудования (W7)
from app.models.inventory import (
    InventoryItem,
    InventoryStock,
    InventoryMovement,
    InventoryCategory,
    InventoryMovementType,
)

# Module Monitoring System — health-state каждого платного модуля per-tenant
from app.models.module_health import ModuleHealthCheck, ModuleHealthStatus

# API-ключи тенанта для внешних интеграций (CRM/BI)
from app.models.tenant_api_key import TenantApiKey

# Self-service onboarding (Глава 2)
from app.models.signup_request import SignupRequest

# Глава 4 — Manager productivity (Kanban / templates / multi-clinic)
from app.models.referral_template import ReferralTemplate
from app.models.manager_clinic_access import ManagerClinicAccess
from app.models.doctor_ai import TreatmentPlan, AIDoctorLog, DirectBill
