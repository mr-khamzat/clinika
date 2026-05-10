/**
 * ========================================
 * БЛОК: ManagerMultiClinic — обзор всех клиник (Глава 4)
 * ========================================
 */
import { lazy, Suspense } from 'react'
import ManagerShell from './_ManagerShell'

const ManagerMultiClinicView = lazy(() => import('../sections/ManagerMultiClinicView'))

export default function ManagerMultiClinic() {
  return (
    <ManagerShell
      active="multi-clinic"
      title="Все клиники"
      subtitle="Панорамный обзор сети"
      icon="domain"
    >
      <Suspense fallback={<div style={{ textAlign: 'center', padding: 32, color: 'var(--fg-3)' }}>Загрузка…</div>}>
        <ManagerMultiClinicView />
      </Suspense>
    </ManagerShell>
  )
}
