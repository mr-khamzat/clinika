import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getBonusSummary, getIncomingReferrals } from '../api'
import api from '../api'
import useAuthStore from '../store/auth'

const STATUS_LABELS = {
  created:          'Создано',
  confirmed:        'Подтверждено',
  expired:          'Истекло',
  cancel_requested: 'На отмене',
  cancelled:        'Отменено',
}

const STATUS_STYLE = {
  created:          'bg-[#dae5ff] text-[#1565c0]',
  confirmed:        'bg-[#dcfce7] text-[#166534]',
  expired:          'bg-[#eceef0] text-[#727783]',
  cancel_requested: 'bg-orange-100 text-orange-700',
  cancelled:        'bg-red-100 text-red-700',
}

function getTodayLabel() {
  return new Date().toLocaleDateString('ru-RU', {
    weekday: 'long', day: 'numeric', month: 'long'
  })
}

export default function Dashboard() {
  const { user } = useAuthStore()
  const [summary, setSummary] = useState(null)
  const [stats, setStats] = useState(null)
  const [kpi, setKpi] = useState(null)
  const [recentReferrals, setRecentReferrals] = useState([])
  const [incomingCount, setIncomingCount] = useState(0)
  const nav = useNavigate()

  useEffect(() => {
    getBonusSummary().then(r => setSummary(r.data)).catch(() => {})
    api.get('/admins/me/stats').then(r => setStats(r.data)).catch(() => {})
    api.get('/admins/me/kpi').then(r => setKpi(r.data)).catch(() => {})
    getIncomingReferrals().then(r => {
      setIncomingCount((r.data || []).filter(x => x.status === 'created').length)
    }).catch(() => {})
    api.get('/referrals?limit=5').then(r => {
      const data = r.data
      setRecentReferrals(Array.isArray(data) ? data.slice(0, 5) : [])
    }).catch(() => {})
  }, [])

  const thisMonth = stats?.this_month
  const lastMonth = stats?.last_month
  const allTime = stats?.all_time
  const bestMonth = stats?.best_month_confirmed ?? 0
  const confirmedDiff = thisMonth && lastMonth ? thisMonth.confirmed - lastMonth.confirmed : null
  const todayEarned = thisMonth?.pending_bonus ?? 0
  const todayReferrals = stats?.today?.total ?? 0
  const isPartner = user?.role === 'partner_doctor'

  return (
    <div className="p-4 pb-28 space-y-4 bg-[#f7f9fb] min-h-screen">

      {/* Greeting */}
      <div className="pt-2">
        <p className="text-[#727783] text-sm capitalize">{getTodayLabel()}</p>
        <h1 className="text-2xl font-extrabold text-[#191c1e] font-headline mt-0.5">
          Добрый день, {user?.full_name?.split(' ')[0] || 'Сотрудник'}!
        </h1>
      </div>

      {/* Balance Card */}
      <div
        className="rounded-3xl p-6 text-white"
        style={{ background: 'linear-gradient(135deg, #1565c0 0%, #1e6fe8 100%)', boxShadow: '0 12px 32px rgba(21,101,192,0.25)' }}
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-blue-200 text-sm mb-1">Баланс бонусов</p>
            <p className="text-4xl font-extrabold leading-none font-headline">
              {summary ? `${summary.total_pending ?? 0} Б` : '—'}
            </p>
            <p className="text-blue-200/80 text-xs mt-2">
              Ожидает выплаты: {summary?.total_pending ?? 0} Б
            </p>
          </div>
          <div className="bg-white/15 rounded-2xl p-3">
            <span
              className="material-symbols-outlined text-white"
              style={{ fontSize: 32, fontVariationSettings: "'FILL' 1" }}
            >account_balance_wallet</span>
          </div>
        </div>
      </div>

      {/* Mini stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-3xl p-4" style={{ boxShadow: '0 4px 16px rgba(25,28,30,0.05)' }}>
          <div className="w-8 h-8 bg-[#006e2f]/10 text-[#006e2f] rounded-full flex items-center justify-center mb-3">
            <span className="material-symbols-outlined text-lg">trending_up</span>
          </div>
          <p className="text-xl font-bold text-[#191c1e] font-headline">{todayEarned} Б</p>
          <p className="text-[10px] text-[#727783] font-semibold uppercase tracking-wider mt-0.5">Сегодня заработано</p>
        </div>
        <div className="bg-white rounded-3xl p-4" style={{ boxShadow: '0 4px 16px rgba(25,28,30,0.05)' }}>
          <div className="w-8 h-8 bg-[#1565c0]/10 text-[#1565c0] rounded-full flex items-center justify-center mb-3">
            <span className="material-symbols-outlined text-lg">send</span>
          </div>
          <p className="text-xl font-bold text-[#191c1e] font-headline">{todayReferrals}</p>
          <p className="text-[10px] text-[#727783] font-semibold uppercase tracking-wider mt-0.5">Направлений сегодня</p>
        </div>
      </div>

      {/* Quick actions grid */}
      <div className="grid grid-cols-2 gap-3">
        {isPartner ? (
          <>
            <button
              onClick={() => nav('/partner/create')}
              className="group flex flex-col gap-3 p-5 rounded-[1.75rem] bg-white active:scale-95 transition-all"
              style={{ boxShadow: '0 4px 16px rgba(25,28,30,0.05)' }}
            >
              <div className="w-12 h-12 bg-[#dae5ff] rounded-2xl flex items-center justify-center text-[#1565c0]">
                <span className="material-symbols-outlined text-2xl">add_circle</span>
              </div>
              <span className="font-bold text-sm text-[#191c1e]">Записать</span>
            </button>
            <button
              onClick={() => nav('/history')}
              className="group flex flex-col gap-3 p-5 rounded-[1.75rem] bg-white active:scale-95 transition-all relative"
              style={{ boxShadow: '0 4px 16px rgba(25,28,30,0.05)' }}
            >
              {incomingCount > 0 && (
                <span className="absolute top-3 right-3 min-w-[18px] h-[18px] bg-amber-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 shadow">
                  {incomingCount}
                </span>
              )}
              <div className="w-12 h-12 bg-orange-50 rounded-2xl flex items-center justify-center text-orange-600">
                <span className="material-symbols-outlined text-2xl">list_alt</span>
              </div>
              <span className="font-bold text-sm text-[#191c1e]">История</span>
            </button>
            <button
              onClick={() => nav('/bonuses')}
              className="group flex flex-col gap-3 p-5 rounded-[1.75rem] bg-white active:scale-95 transition-all"
              style={{ boxShadow: '0 4px 16px rgba(25,28,30,0.05)' }}
            >
              <div className="w-12 h-12 bg-[#dcfce7] rounded-2xl flex items-center justify-center text-[#166534]">
                <span className="material-symbols-outlined text-2xl">payments</span>
              </div>
              <span className="font-bold text-sm text-[#191c1e]">Бонусы</span>
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => nav('/create')}
              className="group flex flex-col gap-3 p-5 rounded-[1.75rem] bg-white active:scale-95 transition-all"
              style={{ boxShadow: '0 4px 16px rgba(25,28,30,0.05)' }}
            >
              <div className="w-12 h-12 bg-[#dae5ff] rounded-2xl flex items-center justify-center text-[#1565c0]">
                <span className="material-symbols-outlined text-2xl">add_circle</span>
              </div>
              <span className="font-bold text-sm text-[#191c1e]">Направление</span>
            </button>
            <button
              onClick={() => nav('/scan')}
              className="group flex flex-col gap-3 p-5 rounded-[1.75rem] bg-white active:scale-95 transition-all"
              style={{ boxShadow: '0 4px 16px rgba(25,28,30,0.05)' }}
            >
              <div className="w-12 h-12 bg-purple-50 rounded-2xl flex items-center justify-center text-purple-600">
                <span className="material-symbols-outlined text-2xl">qr_code_scanner</span>
              </div>
              <span className="font-bold text-sm text-[#191c1e]">Сканер</span>
            </button>
            <button
              onClick={() => nav('/history')}
              className="group flex flex-col gap-3 p-5 rounded-[1.75rem] bg-white active:scale-95 transition-all relative"
              style={{ boxShadow: '0 4px 16px rgba(25,28,30,0.05)' }}
            >
              {incomingCount > 0 && (
                <span className="absolute top-3 right-3 min-w-[18px] h-[18px] bg-amber-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 shadow">
                  {incomingCount}
                </span>
              )}
              <div className="w-12 h-12 bg-orange-50 rounded-2xl flex items-center justify-center text-orange-600">
                <span className="material-symbols-outlined text-2xl">list_alt</span>
              </div>
              <span className="font-bold text-sm text-[#191c1e]">История</span>
            </button>
            <button
              onClick={() => nav('/bonuses')}
              className="group flex flex-col gap-3 p-5 rounded-[1.75rem] bg-white active:scale-95 transition-all"
              style={{ boxShadow: '0 4px 16px rgba(25,28,30,0.05)' }}
            >
              <div className="w-12 h-12 bg-[#dcfce7] rounded-2xl flex items-center justify-center text-[#166534]">
                <span className="material-symbols-outlined text-2xl">payments</span>
              </div>
              <span className="font-bold text-sm text-[#191c1e]">Бонусы</span>
            </button>
          </>
        )}
      </div>

      {/* KPI progress */}
      {kpi?.has_target && (
        <div className="bg-white rounded-2xl p-4" style={{ boxShadow: '0 4px 16px rgba(25,28,30,0.05)' }}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-[#191c1e]">KPI этого месяца</p>
            <span className="text-xs text-[#727783]">цель</span>
          </div>
          <div className="mb-3">
            <div className="flex justify-between text-xs text-[#727783] mb-1">
              <span>Направлений</span>
              <span>{kpi.current_referrals} / {kpi.target_referrals}</span>
            </div>
            <div className="bg-[#f2f4f6] rounded-full h-2">
              <div
                className="h-2 rounded-full transition-all"
                style={{ width: `${Math.min(100, kpi.target_referrals > 0 ? (kpi.current_referrals / kpi.target_referrals) * 100 : 0)}%`, background: '#1565c0' }}
              />
            </div>
          </div>
          {kpi.target_confirmed > 0 && (
            <div>
              <div className="flex justify-between text-xs text-[#727783] mb-1">
                <span>Подтверждено</span>
                <span>{kpi.current_confirmed} / {kpi.target_confirmed}</span>
              </div>
              <div className="bg-[#f2f4f6] rounded-full h-2">
                <div
                  className="h-2 rounded-full transition-all"
                  style={{ width: `${Math.min(100, kpi.target_confirmed > 0 ? (kpi.current_confirmed / kpi.target_confirmed) * 100 : 0)}%`, background: '#006e2f' }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Monthly stats */}
      {stats && (
        <div className="bg-white rounded-2xl p-4" style={{ boxShadow: '0 4px 16px rgba(25,28,30,0.05)' }}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-[#191c1e]">Этот месяц</p>
            {bestMonth > 0 && (
              <span className="text-xs text-amber-500 font-medium">Рекорд: {bestMonth}</span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center">
              <p className="text-xl font-bold text-[#191c1e] font-headline">{thisMonth?.total ?? 0}</p>
              <p className="text-[10px] text-[#727783] mt-0.5">Направлений</p>
            </div>
            <div className="text-center border-x border-[#eceef0]">
              <div className="flex items-center justify-center gap-1">
                <p className="text-xl font-bold text-[#166534] font-headline">{thisMonth?.confirmed ?? 0}</p>
                {confirmedDiff !== null && confirmedDiff !== 0 && (
                  <span className={`text-xs font-medium ${confirmedDiff > 0 ? 'text-[#006e2f]' : 'text-red-500'}`}>
                    {confirmedDiff > 0 ? `+${confirmedDiff}` : confirmedDiff}
                  </span>
                )}
              </div>
              <p className="text-[10px] text-[#727783] mt-0.5">Подтв.</p>
            </div>
            <div className="text-center">
              <p className="text-xl font-bold text-amber-600 font-headline">
                {thisMonth?.pending_bonus ?? 0} Б
              </p>
              <p className="text-[10px] text-[#727783] mt-0.5">Начислено</p>
            </div>
          </div>
          {allTime && (
            <div className="border-t border-[#f2f4f6] pt-3 mt-3">
              <p className="text-xs text-[#727783]">
                За всё время: {allTime.total ?? 0} направл. · {allTime.confirmed ?? 0} подтв.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Recent referrals */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-[#191c1e] font-headline">Последние направления</h2>
          <button onClick={() => nav('/history')} className="text-xs text-[#1565c0] font-semibold uppercase tracking-widest">
            Все
          </button>
        </div>

        {recentReferrals.length === 0 ? (
          <div className="bg-white rounded-2xl p-8 text-center" style={{ boxShadow: '0 4px 16px rgba(25,28,30,0.05)' }}>
            <span className="material-symbols-outlined text-[#c2c6d4]" style={{ fontSize: 40 }}>description</span>
            <p className="text-sm text-[#727783] mt-2">Направлений пока нет</p>
          </div>
        ) : (
          <div className="space-y-2">
            {recentReferrals.map(r => (
              <div
                key={r.id}
                onClick={() => nav(`/qr/${r.id}`)}
                className="bg-white rounded-2xl p-4 flex items-center gap-3 cursor-pointer active:opacity-80 transition-opacity"
                style={{ boxShadow: '0 4px 16px rgba(25,28,30,0.05)' }}
              >
                <div className="w-10 h-10 bg-[#dae5ff] rounded-2xl flex items-center justify-center flex-shrink-0">
                  <span className="material-symbols-outlined text-[#1565c0]" style={{ fontSize: 20 }}>description</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[#191c1e] text-sm truncate">
                    {r.patient_phone || r.service_name || 'Направление'}
                  </p>
                  <p className="text-xs text-[#727783] truncate mt-0.5">
                    {r.to_clinic_name || 'Клиника'}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-bold uppercase tracking-tight ${STATUS_STYLE[r.status] || 'bg-[#eceef0] text-[#727783]'}`}>
                    {STATUS_LABELS[r.status] || r.status}
                  </span>
                  {r.bonus_amount > 0 && (
                    <span className="text-xs text-[#166534] font-bold">+{r.bonus_amount} Б</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
