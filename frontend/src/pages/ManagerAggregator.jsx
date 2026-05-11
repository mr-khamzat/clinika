/**
 * ========================================
 * БЛОК: ManagerAggregator — страница «Заявки агрегаторов» (Глава 10)
 * ========================================
 * Оборачивает AdminAggregatorSection в общий ManagerShell.
 * Активный раздел в bottom-nav — 'aggregator' (см. _ManagerShell.jsx MGR_NAV).
 *
 * Lazy-load самой секции — чтобы не тащить её в initial bundle менеджера.
 * ========================================
 */
import { lazy, Suspense } from 'react'
import ManagerShell from './_ManagerShell'

const AdminAggregatorSection = lazy(() => import('../sections/AdminAggregatorSection'))

export default function ManagerAggregator() {
  return (
    <ManagerShell
      active="aggregator"
      title="Заявки агрегаторов"
      subtitle="Лиды от DocDoc / ПроДокторов / Яндекс.Здоровье и других партнёров"
      icon="campaign"
    >
      <Suspense fallback={
        <div className="space-y-2">
          <div className="rounded-2xl h-16 animate-pulse" style={{ background: '#e5e7eb' }} />
          <div className="rounded-2xl h-32 animate-pulse" style={{ background: '#e5e7eb' }} />
        </div>
      }>
        <AdminAggregatorSection />
      </Suspense>
    </ManagerShell>
  )
}
