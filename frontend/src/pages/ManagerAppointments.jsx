/**
 * ========================================
 * БЛОК: ManagerAppointments (premium редизайн)
 * ========================================
 * Записи к врачам — переключатель Календарь / Статистика поверх существующих
 * секций AppointmentsCalendarSection и AppointmentsStatsSection.
 * Бизнес-логика секций не изменена.
 * ========================================
 */
import { useState } from 'react'
import api from '../api'
import { SLUG } from '../config'
import AppointmentsCalendarSection from '../sections/AppointmentsCalendarSection'
import AppointmentsStatsSection from '../sections/AppointmentsStatsSection'
import { Tabs, Button } from '../design'
import ManagerShell from './_ManagerShell'
import AppointmentsReportModal from '../components/reports/AppointmentsReportModal'

export default function ManagerAppointments() {
  const [view, setView] = useState('calendar')
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
      subtitle="Календарь приёмов и статистика"
      icon="event"
      topbarRight={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Tabs
            items={[{ id: 'calendar', label: 'Календарь' }, { id: 'stats', label: 'Статистика' }]}
            value={view}
            onChange={setView}
          />
          <Button size="sm" variant="secondary" onClick={() => setReportOpen(true)}>
            Выгрузить отчёт
          </Button>
        </div>
      }
    >
      {/* ─── Mobile: переключатель + кнопка отчёта прямо в контенте ─── */}
      <div className="mb-4 sm:hidden" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Tabs
          items={[{ id: 'calendar', label: 'Календарь' }, { id: 'stats', label: 'Статистика' }]}
          value={view}
          onChange={setView}
        />
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
        {view === 'calendar' && <AppointmentsCalendarSection token={token} />}
        {view === 'stats' && <AppointmentsStatsSection token={token} />}
      </div>

      {/* ─── Модалка выгрузки отчёта по приёмам ─── */}
      <AppointmentsReportModal open={reportOpen} onClose={() => setReportOpen(false)} />
    </ManagerShell>
  )
}
