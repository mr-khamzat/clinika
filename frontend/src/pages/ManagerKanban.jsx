/**
 * ========================================
 * БЛОК: ManagerKanban — страница Kanban-расписания (Глава 4)
 * ========================================
 * Обёртка вокруг ManagerKanbanSchedule с навигацией к другим режимам
 * (Календарь / Неделя через /manager/appointments).
 * ========================================
 */
import { useNavigate } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import ManagerShell from './_ManagerShell'

const ManagerKanbanSchedule = lazy(() => import('../sections/ManagerKanbanSchedule'))

export default function ManagerKanban() {
  const nav = useNavigate()
  const switchView = (v) => {
    if (v === 'kanban') return
    if (v === 'calendar') nav('/manager/appointments')
    if (v === 'week') nav('/manager/schedules')
  }
  return (
    <ManagerShell
      active="kanban"
      title="Kanban-расписание"
      subtitle="Перетаскивайте записи между колонками для смены статуса"
      icon="view_kanban"
    >
      <Suspense fallback={<div style={{ textAlign: 'center', padding: 32, color: 'var(--fg-3)' }}>Загрузка…</div>}>
        <ManagerKanbanSchedule onSwitchView={switchView} />
      </Suspense>
    </ManagerShell>
  )
}
