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
import { Tabs } from '../design'
import ManagerShell from './_ManagerShell'

export default function ManagerAppointments() {
  const [view, setView] = useState('calendar')
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
        <Tabs
          items={[{ id: 'calendar', label: 'Календарь' }, { id: 'stats', label: 'Статистика' }]}
          value={view}
          onChange={setView}
        />
      }
    >
      {/* ─── Mobile: переключатель прямо в контенте ─── */}
      <div className="mb-4 sm:hidden">
        <Tabs
          items={[{ id: 'calendar', label: 'Календарь' }, { id: 'stats', label: 'Статистика' }]}
          value={view}
          onChange={setView}
        />
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
    </ManagerShell>
  )
}
