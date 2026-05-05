/**
 * ManagerAppointments — страница «Записи к врачам» в кабинете управляющего.
 * Переключалка Календарь / Статистика — обёртка над AppointmentsCalendarSection
 * и AppointmentsStatsSection.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../api'
import AppointmentsCalendarSection from '../sections/AppointmentsCalendarSection'
import AppointmentsStatsSection from '../sections/AppointmentsStatsSection'

export default function ManagerAppointments() {
  const [view, setView] = useState('calendar')
  const token = api.defaults?.headers?.common?.Authorization?.replace(/^Bearer\s+/, '') || localStorage.getItem('clinika_token_arc') || localStorage.getItem('clinika_token')

  return (
    <div className="min-h-screen bg-[#f7f9fb] pb-24" style={{ fontFamily: "'Inter',sans-serif" }}>
      {/* Header */}
      <div className="px-4 pt-12 pb-4 flex items-center gap-3">
        <Link to="/manager" className="w-10 h-10 rounded-xl flex items-center justify-center bg-white border border-gray-200">
          <span className="material-symbols-outlined">arrow_back</span>
        </Link>
        <div className="flex-1">
          <div className="text-xs text-gray-500 font-semibold">Управляющий</div>
          <div className="text-xl font-black">Записи к врачам</div>
        </div>
        <div className="flex bg-white rounded-xl p-1 border border-gray-200">
          <button onClick={() => setView('calendar')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold ${view === 'calendar' ? 'bg-violet-600 text-white' : 'text-gray-500'}`}>
            Календарь
          </button>
          <button onClick={() => setView('stats')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold ${view === 'stats' ? 'bg-violet-600 text-white' : 'text-gray-500'}`}>
            Статистика
          </button>
        </div>
      </div>

      {view === 'calendar' && <AppointmentsCalendarSection token={token} />}
      {view === 'stats' && <AppointmentsStatsSection token={token} />}
    </div>
  )
}
