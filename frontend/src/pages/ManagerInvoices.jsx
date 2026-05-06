/**
 * ========================================
 * БЛОК: ManagerInvoices (premium редизайн)
 * ========================================
 * Межклиничные счета — оборачивает существующий InterClinicInvoicesSection
 * в premium-shell менеджера. Бизнес-логика секции не изменена.
 * ========================================
 */
import InterClinicInvoicesSection from '../sections/InterClinicInvoicesSection'
import ManagerShell from './_ManagerShell'

export default function ManagerInvoices() {
  return (
    <ManagerShell
      active="invoices"
      title="Межклиничные счета"
      subtitle="Расчёты между клиниками сети"
      icon="receipt_long"
    >
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: 16,
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <InterClinicInvoicesSection isSupervisor={false} />
      </div>
    </ManagerShell>
  )
}
