/**
 * ========================================
 * БЛОК: ManagerAppointments (premium редизайн)
 * ========================================
 * Записи к врачам — переключатель Слоты / Календарь / Статистика поверх
 * существующих секций SlotBoardSection / AppointmentsCalendarSection /
 * AppointmentsStatsSection.
 *
 * Бизнес-логика секций не изменена. SlotBoardSection — новый вид (дизайн v3
 * «слоты-карточки»), AppointmentsCalendarSection оставлен как fallback.
 * ========================================
 */
import { useState, Suspense, lazy } from 'react'
import api from '../api'
import { SLUG } from '../config'
import AppointmentsCalendarSection from '../sections/AppointmentsCalendarSection'
import AppointmentsStatsSection from '../sections/AppointmentsStatsSection'
import { Tabs, Button } from '../design'
import ManagerShell from './_ManagerShell'
import AppointmentsReportModal from '../components/reports/AppointmentsReportModal'

// SlotBoardSection — новый вид «слоты-карточки» (дизайн v3). Lazy, чтобы не
// тянуть свои стили/верстку в bundle, если менеджер переключился на Статистику.
const SlotBoardSection = lazy(() => import('../sections/scheduling/SlotBoardSection'))

const TABS = [
  { id: 'slots',    label: 'Слоты' },
  { id: 'calendar', label: 'Календарь' },
  { id: 'stats',    label: 'Статистика' },
]

export default function ManagerAppointments() {
  const [view, setView] = useState('slots')
  const [reportOpen, setReportOpen] = useState(false)
  // Получаем токен динамически по slug текущего тенанта (а не хардкод 'arc'),
  // чтобы запись работала для любого тенанта (#23).
  const token =
    api.defaults?.headers?.common?.Authorization?.replace(/^Bearer\s+/, '') ||
    localStorage.getItem('clinika_token_' + SLUG) ||
    localStorage.getItem('clinika_token_arc') ||
    localStorage.getItem('clinika_token')

  return (
    <ManagerShell
      active="appointments"
      title="Записи к врачам"
      subtitle="Расписание приёмов и статистика"
      icon="event"
      topbarRight={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Tabs items={TABS} value={view} onChange={setView} />
          <Button size="sm" variant="secondary" onClick={() => setReportOpen(true)}>
            Выгрузить отчёт
          </Button>
        </div>
      }
    >
      {/* ─── Mobile: переключатель + кнопка отчёта прямо в контенте ─── */}
      <div className="mb-4 sm:hidden" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Tabs items={TABS} value={view} onChange={setView} />
        <Button size="sm" variant="secondary" onClick={() => setReportOpen(true)}>
          Выгрузить отчёт
        </Button>
      </div>

      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: 0,
          overflow: 'hidden',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        {view === 'slots' && (
          <Suspense
            fallback={
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--fg-3)' }}>
                Загрузка расписания…
              </div>
            }
          >
            <SlotBoardSection token={token} />
          </Suspense>
        )}
        {view === 'calendar' && <AppointmentsCalendarSection token={token} />}
        {view === 'stats' && <AppointmentsStatsSection token={token} />}
      </div>

      {/* ─── Модалка выгрузки отчёта по приёмам ─── */}
      <AppointmentsReportModal open={reportOpen} onClose={() => setReportOpen(false)} />
    </ManagerShell>
  )
}
