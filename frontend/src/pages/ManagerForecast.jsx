/**
 * ========================================
 * БЛОК: ManagerForecast — прогноз расходов (Глава 4)
 * ========================================
 */
import { lazy, Suspense } from 'react'
import ManagerShell from './_ManagerShell'

const ManagerCostForecast = lazy(() => import('../sections/ManagerCostForecast'))

export default function ManagerForecast() {
  return (
    <ManagerShell
      active="forecast"
      title="Прогноз расходов"
      subtitle="Анализ истории и предсказание на 3 месяца"
      icon="trending_up"
    >
      <Suspense fallback={<div style={{ textAlign: 'center', padding: 32, color: 'var(--fg-3)' }}>Загрузка…</div>}>
        <ManagerCostForecast />
      </Suspense>
    </ManagerShell>
  )
}
