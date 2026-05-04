import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { getManagerSummary, getManagerAdmins, getManagerClinics, exportCSV, getCancelRequests, approveCancelRequest, rejectCancelRequest } from '../api'
import api from '../api'
import useAuthStore from '../store/auth'

function greeting() {
  const h = new Date().getHours()
  if (h < 6)  return 'Доброй ночи'
  if (h < 12) return 'Доброе утро'
  if (h < 18) return 'Добрый день'
  return 'Добрый вечер'
}
function todayRu() {
  return new Date().toLocaleDateString('ru-RU', { weekday:'long', day:'numeric', month:'long' })
}

const NAV_ITEMS = [
  { label:'Аналитика', path:'/manager/analytics', icon:'bar_chart',    bg:'linear-gradient(135deg,#0097A7,#006173)' },
  { label:'KPI',       path:'/manager/kpi',       icon:'emoji_events', bg:'linear-gradient(135deg,#1565c0,#1e6fe8)' },
  { label:'Журнал',    path:'/manager/activity',  icon:'article',      bg:'linear-gradient(135deg,#7c3aed,#6d28d9)' },
  { label:'Выплаты',   path:'/manager/bonuses',   icon:'payments',     bg:'linear-gradient(135deg,#d97706,#b45309)' },
  { label:'История',   path:'/manager/history',   icon:'history',      bg:'linear-gradient(135deg,#4f46e5,#4338ca)' },
  { label:'Настройки', path:'/manager/settings',  icon:'tune',         bg:'linear-gradient(135deg,#374151,#1f2937)' },
  { label:'Счета',     path:'/manager/invoices',  icon:'receipt_long', bg:'linear-gradient(135deg,#7c3aed,#5b21b6)' },
  { label:'Врачи',     path:'/manager/recruit-doctors', icon:'groups', bg:'linear-gradient(135deg,#0097A7,#004D5F)' },
]

function StatTile({ value, label, color, bg, icon, iconColor }) {
  return (
    <div className={`${bg} rounded-2xl p-4`} style={{ boxShadow:'0 4px 16px rgba(25,28,30,0.04)' }}>
      <div className="flex items-start justify-between mb-1">
        <p className={`text-2xl font-extrabold font-headline ${color}`}>{value ?? '—'}</p>
        <span className={`material-symbols-outlined text-xl ${iconColor}`} style={{ fontVariationSettings:"'FILL' 1" }}>{icon}</span>
      </div>
      <p className="text-xs text-[#727783] dark:text-gray-400 font-medium">{label}</p>
    </div>
  )
}

export default function ManagerDashboard() {
  const nav = useNavigate()
  const { user } = useAuthStore()
  const [summary, setSummary]               = useState(null)
  const [admins, setAdmins]                 = useState([])
  const [clinics, setClinics]               = useState([])
  const [dateFrom, setDateFrom]             = useState('')
  const [dateTo, setDateTo]                 = useState('')
  const [loadingSummary, setLoadingSummary] = useState(false)
  const [loadingAdmins, setLoadingAdmins]   = useState(false)
  const [loadingClinics, setLoadingClinics] = useState(false)
  const [exportLoading, setExportLoading]   = useState(false)
  const [cancelRequests, setCancelRequests] = useState([])
  const [loadingCancel, setLoadingCancel]   = useState(false)
  const [todayStats, setTodayStats]         = useState(null)
  const [error, setError]                   = useState('')

  const buildParams = useCallback(() => {
    const p = {}
    if (dateFrom) p.date_from = dateFrom
    if (dateTo)   p.date_to   = dateTo
    return p
  }, [dateFrom, dateTo])

  const fetchAll = useCallback(async () => {
    setError('')
    const params = buildParams()
    setLoadingSummary(true)
    getManagerSummary(params).then(r => setSummary(r.data)).catch(() => setSummary(null)).finally(() => setLoadingSummary(false))
    setLoadingAdmins(true)
    getManagerAdmins(params).then(r => setAdmins(Array.isArray(r.data) ? r.data : [])).catch(() => setAdmins([])).finally(() => setLoadingAdmins(false))
    setLoadingClinics(true)
    getManagerClinics().then(r => setClinics(Array.isArray(r.data) ? r.data : [])).catch(() => setClinics([])).finally(() => setLoadingClinics(false))
    setLoadingCancel(true)
    getCancelRequests().then(r => setCancelRequests(Array.isArray(r.data) ? r.data : [])).catch(() => setCancelRequests([])).finally(() => setLoadingCancel(false))
    api.get('/manager/reports/today').then(r => setTodayStats(r.data)).catch(() => {})
  }, [buildParams])

  useEffect(() => { fetchAll() }, [])

  const handleApplyFilter = (e) => { e.preventDefault(); fetchAll() }

  const handleExport = async () => {
    setExportLoading(true)
    try {
      const res = await exportCSV()
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a'); a.href = url; a.download = 'report.csv'
      document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url)
    } catch { setError('Ошибка экспорта CSV') } finally { setExportLoading(false) }
  }

  const name = user?.full_name?.split(' ')[0] || user?.username || 'Руководитель'

  return (
    <div className="bg-[#f7f9fb] dark:bg-gray-900 min-h-screen pb-24">

      {/* Hero */}
      <div className="relative overflow-hidden px-4 pt-5 pb-7 mb-4"
        style={{ background:'linear-gradient(135deg,#0097A7 0%,#006173 100%)' }}>
        <div className="absolute -top-8 -right-8 w-40 h-40 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute -bottom-10 -left-4 w-32 h-32 rounded-full bg-white/5 pointer-events-none" />
        <p className="text-white/70 text-xs font-medium capitalize mb-1">{todayRu()}</p>
        <h1 className="text-white text-2xl font-extrabold font-headline leading-tight mb-0.5">{greeting()}, {name}!</h1>
        <p className="text-white/60 text-xs">Ваш рабочий дашборд</p>
      </div>

      <div className="px-4">

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-3 mb-4">
            <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
          </div>
        )}

        {/* Сегодня */}
        {todayStats && (
          <div className="grid grid-cols-2 gap-3 mb-4">
            <StatTile value={todayStats.total_today}     label="Создано сегодня"    color="text-[#1565c0]" bg="bg-blue-50 dark:bg-blue-900/20"     icon="add_circle"   iconColor="text-blue-400" />
            <StatTile value={todayStats.confirmed_today} label="Подтверждено"       color="text-[#16A34A]" bg="bg-green-50 dark:bg-green-900/20"   icon="check_circle" iconColor="text-green-400" />
            {todayStats.pending_cancel > 0 && (
              <StatTile value={todayStats.pending_cancel}     label="Ожидают отмены"      color="text-orange-600" bg="bg-orange-50 dark:bg-orange-900/20" icon="pending"  iconColor="text-orange-400" />
            )}
            {todayStats.pending_bonuses > 0 && (
              <StatTile value={`${todayStats.pending_bonuses} Б`} label="Бонусов к выплате" color="text-amber-600" bg="bg-amber-50 dark:bg-amber-900/20" icon="payments" iconColor="text-amber-400" />
            )}
          </div>
        )}

        {/* Быстрые переходы */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          {NAV_ITEMS.map(({ label, path, icon, bg }) => (
            <button key={path} onClick={() => nav(path)}
              className="bg-white dark:bg-gray-800 rounded-2xl p-3 flex flex-col items-center gap-2 active:scale-95 transition-transform"
              style={{ boxShadow:'0 4px 16px rgba(25,28,30,0.05)' }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: bg }}>
                <span className="material-symbols-outlined text-white text-xl" style={{ fontVariationSettings:"'FILL' 1" }}>{icon}</span>
              </div>
              <span className="text-[11px] font-semibold text-[#727783] dark:text-gray-400 leading-tight text-center">{label}</span>
            </button>
          ))}
        </div>

        {/* Направления */}
        <button onClick={() => nav('/manager/history')} className="w-full text-left mb-3">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-4" style={{ boxShadow:'0 4px 16px rgba(25,28,30,0.05)' }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[#0097A7] text-xl" style={{ fontVariationSettings:"'FILL' 1" }}>trending_up</span>
                <p className="text-sm font-bold text-[#191c1e] dark:text-white">Направления</p>
              </div>
              <span className="text-xs text-[#0097A7] font-semibold">История →</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-[#f7f9fb] dark:bg-gray-700 rounded-xl py-2.5">
                <p className="text-xl font-extrabold text-[#191c1e] dark:text-white font-headline">{loadingSummary ? '…' : summary?.total_referrals ?? 0}</p>
                <p className="text-[10px] text-[#727783] mt-0.5 font-semibold uppercase tracking-wide">Всего</p>
              </div>
              <div className="bg-green-50 dark:bg-green-900/20 rounded-xl py-2.5">
                <p className="text-xl font-extrabold text-[#16A34A] font-headline">{loadingSummary ? '…' : summary?.confirmed_referrals ?? 0}</p>
                <p className="text-[10px] text-green-600 mt-0.5 font-semibold uppercase tracking-wide">Подтв.</p>
              </div>
              <div className="bg-[#f7f9fb] dark:bg-gray-700 rounded-xl py-2.5">
                <p className="text-xl font-extrabold text-gray-400 font-headline">{loadingSummary ? '…' : summary?.expired_referrals ?? 0}</p>
                <p className="text-[10px] text-[#727783] mt-0.5 font-semibold uppercase tracking-wide">Истекло</p>
              </div>
            </div>
          </div>
        </button>

        {/* Выплаты */}
        <button onClick={() => nav('/manager/bonuses')} className="w-full text-left mb-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-4" style={{ boxShadow:'0 4px 16px rgba(25,28,30,0.05)' }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] text-[#727783] font-bold uppercase tracking-wider mb-1">К выплате сотрудникам</p>
                <p className="text-3xl font-extrabold text-[#191c1e] dark:text-white font-headline">{loadingSummary ? '…' : `${summary?.pending_bonuses ?? 0} Б`}</p>
                {!loadingSummary && (summary?.paid_bonuses ?? 0) > 0 && (
                  <p className="text-xs text-green-600 mt-1">выплачено: {summary.paid_bonuses} Б</p>
                )}
              </div>
              <div className="flex flex-col items-end gap-2">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background:'linear-gradient(135deg,#d97706,#b45309)' }}>
                  <span className="material-symbols-outlined text-white text-xl" style={{ fontVariationSettings:"'FILL' 1" }}>payments</span>
                </div>
                <span className="text-xs text-amber-600 font-bold">Детали →</span>
              </div>
            </div>
          </div>
        </button>

        {/* Фильтр */}
        <form onSubmit={handleApplyFilter} className="bg-white dark:bg-gray-800 rounded-2xl p-4 mb-4" style={{ boxShadow:'0 4px 16px rgba(25,28,30,0.05)' }}>
          <p className="text-[10px] font-bold text-[#727783] uppercase tracking-wider mb-3">Фильтр по периоду</p>
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-[110px]">
              <label className="block text-xs text-[#727783] mb-1">С даты</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="w-full bg-[#f7f9fb] dark:bg-gray-700 rounded-xl px-3 py-2 text-[#191c1e] dark:text-white text-sm outline-none border-2 border-transparent focus:border-[#0097A7]/40 focus:bg-white dark:focus:bg-gray-600 transition-all" />
            </div>
            <div className="flex-1 min-w-[110px]">
              <label className="block text-xs text-[#727783] mb-1">По дату</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="w-full bg-[#f7f9fb] dark:bg-gray-700 rounded-xl px-3 py-2 text-[#191c1e] dark:text-white text-sm outline-none border-2 border-transparent focus:border-[#0097A7]/40 focus:bg-white dark:focus:bg-gray-600 transition-all" />
            </div>
            <button type="submit" className="text-white rounded-xl px-4 py-2 text-sm font-bold active:scale-95 transition-transform" style={{ background:'linear-gradient(135deg,#0097A7,#006173)' }}>Применить</button>
            <button type="button" onClick={handleExport} disabled={exportLoading}
              className="text-white rounded-xl px-4 py-2 text-sm font-bold disabled:opacity-50 active:scale-95 transition-transform" style={{ background:'linear-gradient(135deg,#16A34A,#15803d)' }}>
              {exportLoading ? '...' : 'CSV'}
            </button>
          </div>
        </form>

        {/* Запросы на отмену */}
        {cancelRequests.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="material-symbols-outlined text-orange-500 text-xl" style={{ fontVariationSettings:"'FILL' 1" }}>warning</span>
              <h2 className="text-sm font-bold text-[#191c1e] dark:text-white">Запросы на удаление</h2>
              <span className="bg-orange-500 text-white text-[10px] font-bold rounded-full px-2 py-0.5">{cancelRequests.length}</span>
            </div>
            <div className="space-y-3">
              {cancelRequests.map(req => (
                <div key={req.id} className="bg-white dark:bg-gray-800 rounded-2xl p-4 border-l-4 border-orange-400" style={{ boxShadow:'0 4px 16px rgba(25,28,30,0.05)' }}>
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="font-semibold text-[#191c1e] dark:text-white text-sm">{req.service_name}</p>
                      <p className="text-xs text-[#727783]">📞 {req.patient_phone}</p>
                      <p className="text-xs text-[#727783]">{req.from_clinic_name} → {req.to_clinic_name}</p>
                    </div>
                    <p className="text-xs text-[#727783]">{new Date(req.cancel_requested_at).toLocaleDateString('ru-RU')}</p>
                  </div>
                  <div className="bg-orange-50 dark:bg-orange-900/20 rounded-xl p-3 mb-3">
                    <p className="text-xs font-bold text-orange-700 dark:text-orange-400 mb-1">Причина:</p>
                    <p className="text-sm text-orange-800 dark:text-orange-300">«{req.cancel_reason}»</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={async () => { try { await approveCancelRequest(req.id); setCancelRequests(p => p.filter(r => r.id !== req.id)) } catch { setError('Ошибка') }}}
                      className="flex-1 bg-red-500 text-white rounded-xl py-2.5 text-sm font-bold hover:bg-red-600 transition-colors">Подтвердить удаление</button>
                    <button onClick={async () => { try { await rejectCancelRequest(req.id); setCancelRequests(p => p.filter(r => r.id !== req.id)) } catch { setError('Ошибка') }}}
                      className="flex-1 border-2 border-[#eceef0] dark:border-gray-600 text-[#727783] dark:text-gray-300 rounded-xl py-2.5 text-sm font-bold">Отклонить</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Сотрудники */}
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-[#0097A7] text-xl" style={{ fontVariationSettings:"'FILL' 1" }}>group</span>
            <h2 className="text-sm font-bold text-[#191c1e] dark:text-white">Сотрудники</h2>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-2xl overflow-hidden" style={{ boxShadow:'0 4px 16px rgba(25,28,30,0.05)' }}>
            {loadingAdmins ? (
              <div className="p-6 text-center text-[#727783] text-sm">Загрузка...</div>
            ) : admins.length === 0 ? (
              <div className="p-6 text-center text-[#727783] text-sm">Нет данных</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#eceef0] dark:border-gray-700">
                    <th className="text-left text-[10px] font-bold text-[#727783] uppercase tracking-wider px-4 py-3">Сотрудник</th>
                    <th className="text-left text-[10px] font-bold text-[#727783] uppercase tracking-wider px-4 py-3 hidden sm:table-cell">Клиника</th>
                    <th className="text-right text-[10px] font-bold text-[#727783] uppercase tracking-wider px-4 py-3">Напр.</th>
                    <th className="text-right text-[10px] font-bold text-[#727783] uppercase tracking-wider px-4 py-3">Подтв.</th>
                    <th className="text-right text-[10px] font-bold text-[#727783] uppercase tracking-wider px-4 py-3">Бонусы</th>
                  </tr>
                </thead>
                <tbody>
                  {admins.map((row, i) => (
                    <tr key={row.admin_id ?? i} className="border-b border-[#f7f9fb] dark:border-gray-700/50 last:border-0 hover:bg-[#f7f9fb] dark:hover:bg-gray-700/30 transition-colors">
                      <td className="px-4 py-3 font-semibold text-[#191c1e] dark:text-white text-xs">{row.full_name || row.admin_name || '—'}</td>
                      <td className="px-4 py-3 text-[#727783] text-xs hidden sm:table-cell">{row.clinic_name || row.clinic || '—'}</td>
                      <td className="px-4 py-3 text-right font-bold text-[#191c1e] dark:text-white">{row.referral_count ?? row.total_referrals ?? 0}</td>
                      <td className="px-4 py-3 text-right font-bold text-[#16A34A]">{row.confirmed_count ?? row.confirmed_referrals ?? 0}</td>
                      <td className="px-4 py-3 text-right font-bold text-[#1565c0]">{row.bonus_total != null ? `${row.bonus_total} Б` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Поток между клиниками */}
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-[#7c3aed] text-xl" style={{ fontVariationSettings:"'FILL' 1" }}>swap_horiz</span>
            <h2 className="text-sm font-bold text-[#191c1e] dark:text-white">Поток между клиниками</h2>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-2xl overflow-hidden" style={{ boxShadow:'0 4px 16px rgba(25,28,30,0.05)' }}>
            {loadingClinics ? (<div className="p-6 text-center text-[#727783] text-sm">Загрузка...</div>
            ) : clinics.length === 0 ? (<div className="p-6 text-center text-[#727783] text-sm">Нет данных</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#eceef0] dark:border-gray-700">
                    <th className="text-left text-[10px] font-bold text-[#727783] uppercase tracking-wider px-4 py-3">Откуда</th>
                    <th className="text-left text-[10px] font-bold text-[#727783] uppercase tracking-wider px-4 py-3">Куда</th>
                    <th className="text-right text-[10px] font-bold text-[#727783] uppercase tracking-wider px-4 py-3">Напр.</th>
                    <th className="text-right text-[10px] font-bold text-[#727783] uppercase tracking-wider px-4 py-3 hidden sm:table-cell">Подтв.</th>
                  </tr>
                </thead>
                <tbody>
                  {clinics.map((row, i) => (
                    <tr key={`${row.from_clinic_id}-${row.to_clinic_id}-${i}`} className="border-b border-[#f7f9fb] dark:border-gray-700/50 last:border-0 hover:bg-[#f7f9fb] dark:hover:bg-gray-700/30 transition-colors">
                      <td className="px-4 py-3 text-[#191c1e] dark:text-white text-xs">{row.from_clinic_name || row.from_clinic || '—'}</td>
                      <td className="px-4 py-3 text-[#191c1e] dark:text-white text-xs">{row.to_clinic_name || row.to_clinic || '—'}</td>
                      <td className="px-4 py-3 text-right font-bold text-[#191c1e] dark:text-white">{row.total ?? row.referral_count ?? 0}</td>
                      <td className="px-4 py-3 text-right font-semibold text-[#16A34A] hidden sm:table-cell">{row.confirmed ?? row.confirmed_count ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
