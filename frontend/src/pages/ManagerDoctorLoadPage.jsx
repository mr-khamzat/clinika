/**
 * ========================================
 * БЛОК: ManagerDoctorLoadPage (Глава 4)
 * ========================================
 * Heatmap-аналитика загрузки врачей.
 * ========================================
 */
import { lazy, Suspense } from 'react'
import ManagerShell from './_ManagerShell'

const ManagerDoctorLoad = lazy(() => import('../sections/ManagerDoctorLoad'))

export default function ManagerDoctorLoadPage() {
  return (
    <ManagerShell
      active="doctor-load"
      title="Загрузка врачей"
      subtitle="Heatmap занятости по дням и часам"
      icon="timeline"
    >
      <Suspense fallback={<div style={{ textAlign: 'center', padding: 32, color: 'var(--fg-3)' }}>Загрузка…</div>}>
        <ManagerDoctorLoad />
      </Suspense>
    </ManagerShell>
  )
}
