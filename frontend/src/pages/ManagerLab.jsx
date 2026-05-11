/**
 * ========================================
 * БЛОК: ManagerLab — страница «Лаборатории» в кабинете управляющего (Глава 10)
 * ========================================
 * Оборачивает AdminLabProvidersSection в общий ManagerShell.
 * Активный раздел в bottom-nav — 'lab' (см. _ManagerShell.jsx MGR_NAV).
 *
 * Lazy-load самой секции — чтобы не тащить её в initial bundle менеджера.
 * ========================================
 */
import { lazy, Suspense } from 'react'
import ManagerShell from './_ManagerShell'

const AdminLabProvidersSection = lazy(() => import('../sections/AdminLabProvidersSection'))

export default function ManagerLab() {
  return (
    <ManagerShell
      active="lab"
      title="Лаборатории"
      subtitle="Подключённые провайдеры анализов и приёмные URLs"
      icon="science"
    >
      <Suspense fallback={
        <div className="space-y-2">
          <div className="rounded-2xl h-16 animate-pulse" style={{ background: '#e5e7eb' }} />
          <div className="rounded-2xl h-32 animate-pulse" style={{ background: '#e5e7eb' }} />
        </div>
      }>
        <AdminLabProvidersSection />
      </Suspense>
    </ManagerShell>
  )
}
