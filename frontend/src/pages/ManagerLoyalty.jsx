/**
 * ========================================
 * БЛОК: ManagerLoyalty — страница «Лояльность» в кабинете управляющего (Глава 8)
 * ========================================
 * Оборачивает AdminLoyaltySection в общий ManagerShell (sticky topbar + bottom nav).
 * Активный раздел в bottom-nav — 'loyalty' (см. _ManagerShell.jsx MGR_NAV).
 *
 * Lazy-load самой секции — чтобы не тащить её в initial bundle менеджера.
 * ========================================
 */
import { lazy, Suspense } from 'react'
import ManagerShell from './_ManagerShell'

const AdminLoyaltySection = lazy(() => import('../sections/AdminLoyaltySection'))

export default function ManagerLoyalty() {
  return (
    <ManagerShell
      active="loyalty"
      title="Лояльность"
      subtitle="Награды, лидерборд, запросы пациентов и корректировка баллов"
      icon="workspace_premium"
    >
      <Suspense fallback={
        <div className="space-y-2">
          <div className="rounded-2xl h-16 animate-pulse" style={{ background: '#e5e7eb' }} />
          <div className="rounded-2xl h-32 animate-pulse" style={{ background: '#e5e7eb' }} />
        </div>
      }>
        <AdminLoyaltySection />
      </Suspense>
    </ManagerShell>
  )
}
