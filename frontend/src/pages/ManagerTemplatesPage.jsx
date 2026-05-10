/**
 * ========================================
 * БЛОК: ManagerTemplatesPage — шаблоны направлений (Глава 4)
 * ========================================
 */
import { lazy, Suspense } from 'react'
import ManagerShell from './_ManagerShell'

const ManagerReferralTemplates = lazy(() => import('../sections/ManagerReferralTemplates'))

export default function ManagerTemplatesPage() {
  return (
    <ManagerShell
      active="templates"
      title="Шаблоны направлений"
      subtitle="Повторяющиеся комбинации для быстрого создания"
      icon="dynamic_form"
    >
      <Suspense fallback={<div style={{ textAlign: 'center', padding: 32, color: 'var(--fg-3)' }}>Загрузка…</div>}>
        <ManagerReferralTemplates />
      </Suspense>
    </ManagerShell>
  )
}
