import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { getManagerSummary, getManagerAdmins, getManagerClinics, exportCSV, getCancelRequests, approveCancelRequest, rejectCancelRequest } from '../api'
import api from '../api'
import AdminSupportPanel from '../components/AdminSupportPanel'

function StatCard({ label, value, color, onClick, hint }) {
  return (
    <div
      onClick={onClick}
      className={'bg-white rounded-2xl p-4 text-center ' + (onClick ? 'cursor-pointer active:bg-[#f2f4f6]' : '')}
      style={{boxShadow:'0 4px 16px rgba(25,28,30,0.05)'}}
    >
      <p className={`text-2xl font-bold ${color || 'text-gray-800 dark:text-white'}`}>{value ?? '—'}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{label}</p>
      {hint && <p className="text-xs text-gray-300 dark:text-gray-600 mt-0.5">{hint}</p>}
    </div>
  )
}

export default function ManagerDashboard() {
  const nav = useNavigate()
  const [summary, setSummary] = useState(null)
  const [admins, setAdmins] = useState([])
  const [clinics, setClinics] = useState([])
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [loadingSummary, setLoadingSummary] = useState(false)
  const [loadingAdmins, setLoadingAdmins] = useState(false)
  const [loadingClinics, setLoadingClinics] = useState(false)
  const [exportLoading, setExportLoading] = useState(false)
  const [cancelRequests, setCancelRequests] = useState([])
  const [loadingCancel, setLoadingCancel] = useState(false)
  const [todayStats, setTodayStats] = useState(null)
  const [error, setError] = useState('')

  const buildParams = useCallback(() => {
    const p = {}
    if (dateFrom) p.date_from = dateFrom
    if (dateTo) p.date_to = dateTo
    return p
  }, [dateFrom, dateTo])

  const fetchAll = useCallback(async () => {
    setError('')
    const params = buildParams()

    setLoadingSummary(true)
    getManagerSummary(params)
      .then(r => setSummary(r.data))
      .catch(() => setSummary(null))
      .finally(() => setLoadingSummary(false))

    setLoadingAdmins(true)
    getManagerAdmins(params)
      .then(r => setAdmins(Array.isArray(r.data) ? r.data : []))
      .catch(() => setAdmins([]))
      .finally(() => setLoadingAdmins(false))

    setLoadingClinics(true)
    getManagerClinics()
      .then(r => setClinics(Array.isArray(r.data) ? r.data : []))
      .catch(() => setClinics([]))
      .finally(() => setLoadingClinics(false))

    setLoadingCancel(true)
    getCancelRequests()
      .then(r => setCancelRequests(Array.isArray(r.data) ? r.data : []))
      .catch(() => setCancelRequests([]))
      .finally(() => setLoadingCancel(false))

    api.get('/manager/reports/today')
      .then(r => setTodayStats(r.data))
      .catch(() => {})
  }, [buildParams])

  useEffect(() => {
    fetchAll()
  }, [])

  const handleApplyFilter = (e) => {
    e.preventDefault()
    fetchAll()
  }

  const handleExport = async () => {
    setExportLoading(true)
    try {
      const res = await exportCSV()
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = 'report.csv'
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    } catch {
      setError('Ошибка экспорта CSV')
    } finally {
      setExportLoading(false)
    }
  }

  return (
    <div className="bg-[#f7f9fb] min-h-screen p-4 pb-24">
      <h1 className="text-2xl font-extrabold text-[#191c1e] font-headline mb-4">Панель менеджера</h1>

      {/* Виджет: сегодня */}
      {todayStats && (
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="bg-white rounded-2xl p-4" style={{boxShadow:'0 4px 16px rgba(25,28,30,0.05)'}}>
            <p className="text-2xl font-bold text-[#1565c0] font-headline">{todayStats.total_today}</p>
            <p className="text-xs text-[#727783] mt-1">Создано сегодня</p>
          </div>
          <div className="bg-white rounded-2xl p-4" style={{boxShadow:'0 4px 16px rgba(25,28,30,0.05)'}}>
            <p className="text-2xl font-bold text-[#166534] font-headline">{todayStats.confirmed_today}</p>
            <p className="text-xs text-[#727783] mt-1">Подтверждено сегодня</p>
          </div>
          {todayStats.pending_cancel > 0 && (
            <div className="bg-white rounded-2xl p-4" style={{boxShadow:'0 4px 16px rgba(25,28,30,0.05)'}}>
              <p className="text-2xl font-bold text-orange-500 font-headline">{todayStats.pending_cancel}</p>
              <p className="text-xs text-orange-500 dark:text-orange-400 mt-1">Ожидают отмены</p>
            </div>
          )}
          {todayStats.pending_bonuses > 0 && (
            <div className="bg-amber-50 dark:bg-amber-900/20 rounded-2xl p-4 shadow-sm">
              <p className="text-2xl font-bold text-amber-600">{todayStats.pending_bonuses} Б</p>
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Бонусов к выплате</p>
            </div>
          )}
        </div>
      )}

      {/* Navigation row */}
      <div className="grid grid-cols-4 gap-2 mb-5">
        {[
          { label: 'Аналитика', path: '/manager/analytics', icon: (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          )},
          { label: 'KPI', path: '/manager/kpi', icon: (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          )},
          { label: 'Журнал', path: '/manager/activity', icon: (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
          )},
          { label: 'Настройки', path: '/manager/settings', icon: (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>
          )},
        ].map(({ label, path, icon }) => (
          <button
            key={path}
            onClick={() => nav(path)}
            className="bg-white rounded-2xl p-3 flex flex-col items-center gap-1.5 active:bg-[#f2f4f6] text-[#727783] hover:text-[#1565c0] transition-colors" style={{boxShadow:'0 4px 16px rgba(25,28,30,0.05)'}}
          >
            {icon}
            <span className="text-xs font-medium">{label}</span>
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl p-3 mb-4">
          <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Widget: Заявки */}
      <div
        onClick={() => nav('/manager/history')}
        className="bg-white rounded-2xl p-4 mb-3 cursor-pointer active:bg-[#f2f4f6] transition-colors" style={{boxShadow:'0 4px 16px rgba(25,28,30,0.05)'}}
      >
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-gray-600 dark:text-gray-300">Направления</p>
          <span className="text-xs text-primary font-medium">Открыть историю →</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="text-center">
            <p className="text-xl font-bold text-gray-800 dark:text-white">{loadingSummary ? '…' : summary?.total_referrals ?? 0}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Всего</p>
          </div>
          <div className="text-center border-x border-gray-100 dark:border-gray-700">
            <p className="text-xl font-bold text-[#16A34A]">{loadingSummary ? '…' : summary?.confirmed_referrals ?? 0}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Подтв.</p>
          </div>
          <div className="text-center">
            <p className="text-xl font-bold text-gray-500 dark:text-gray-400">{loadingSummary ? '…' : summary?.expired_referrals ?? 0}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Истекло</p>
          </div>
        </div>
      </div>

      {/* Widget: Выплаты */}
      <div
        onClick={() => nav('/manager/bonuses')}
        className="bg-white rounded-2xl p-4 mb-5 cursor-pointer active:bg-[#f2f4f6] transition-colors" style={{boxShadow:'0 4px 16px rgba(25,28,30,0.05)'}}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-[#727783] font-semibold uppercase tracking-wide mb-1">К выплате сотрудникам</p>
            <p className="text-2xl font-bold text-[#191c1e] font-headline">
              {loadingSummary ? '…' : `${summary?.pending_bonuses ?? 0} Б`}
            </p>
            {!loadingSummary && (summary?.paid_bonuses ?? 0) > 0 && (
              <p className="text-xs text-green-600 mt-1">выплачено: {summary.paid_bonuses} Б</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="bg-amber-200 rounded-full p-2.5">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#92400e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-4 0v2M12 12v4M10 14h4"/>
              </svg>
            </div>
            <span className="text-xs text-amber-600 font-medium">Детали →</span>
          </div>
        </div>
      </div>

      {/* Date Filter + Export */}
      <form
        onSubmit={handleApplyFilter}
        className="bg-white rounded-2xl p-4 mb-6 flex flex-wrap gap-3 items-end" style={{boxShadow:'0 4px 16px rgba(25,28,30,0.05)'}}
      >
        <div className="flex-1 min-w-[130px]">
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">С даты</label>
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="w-full bg-[#f2f4f6] rounded-xl p-2.5 text-[#191c1e] text-sm outline-none border-2 border-transparent focus:border-[#1565c0]/30 focus:bg-white transition-all"
          />
        </div>
        <div className="flex-1 min-w-[130px]">
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">По дату</label>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="w-full bg-[#f2f4f6] rounded-xl p-2.5 text-[#191c1e] text-sm outline-none border-2 border-transparent focus:border-[#1565c0]/30 focus:bg-white transition-all"
          />
        </div>
        <button
          type="submit"
          className="text-white rounded-xl px-4 py-2.5 text-sm font-bold transition-colors active:scale-95" style={{background:'#1565c0'}}
        >
          Применить
        </button>
        <button
          type="button"
          onClick={handleExport}
          disabled={exportLoading}
          className="text-white rounded-xl px-4 py-2.5 text-sm font-bold disabled:opacity-50 active:scale-95 transition-colors" style={{background:'#166534'}}
        >
          {exportLoading ? 'Экспорт...' : 'Экспорт CSV'}
        </button>
      </form>

      {/* Admins Performance Table */}
      <div className="mb-6">
        <h2 className="text-base font-bold text-[#191c1e] font-headline mb-3">Сотрудники</h2>
        <div className="bg-white rounded-2xl overflow-x-auto" style={{boxShadow:'0 4px 16px rgba(25,28,30,0.05)'}}>
          {loadingAdmins ? (
            <div className="p-6 text-center text-gray-400 dark:text-gray-500 text-sm">Загрузка...</div>
          ) : admins.length === 0 ? (
            <div className="p-6 text-center text-gray-400 dark:text-gray-500 text-sm">Нет данных</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#eceef0]">
                  <th className="text-left text-[11px] font-semibold text-[#727783] uppercase tracking-wider px-4 py-3">Сотрудник</th>
                  <th className="text-left text-[11px] font-semibold text-[#727783] uppercase tracking-wider px-4 py-3 hidden sm:table-cell">Клиника</th>
                  <th className="text-right text-[11px] font-semibold text-[#727783] uppercase tracking-wider px-4 py-3">Направл.</th>
                  <th className="text-right text-[11px] font-semibold text-[#727783] uppercase tracking-wider px-4 py-3">Подтв.</th>
                  <th className="text-right text-[11px] font-semibold text-[#727783] uppercase tracking-wider px-4 py-3">Бонусы</th>
                </tr>
              </thead>
              <tbody>
                {admins.map((row, i) => (
                  <tr
                    key={row.admin_id ?? i}
                    className={i % 2 === 0 ? 'bg-white' : 'bg-[#f7f9fb]'}
                  >
                    <td className="px-4 py-3 text-[#191c1e] font-medium">
                      {row.full_name || row.admin_name || '—'}
                    </td>
                    <td className="px-4 py-3 text-[#727783] hidden sm:table-cell">
                      {row.clinic_name || row.clinic || '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-[#191c1e] font-semibold">
                      {row.referral_count ?? row.total_referrals ?? 0}
                    </td>
                    <td className="px-4 py-3 text-right text-[#166534] font-bold">
                      {row.confirmed_count ?? row.confirmed_referrals ?? 0}
                    </td>
                    <td className="px-4 py-3 text-right text-[#1565c0] font-bold">
                      {row.bonus_total != null ? `${row.bonus_total} Б` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Cancel Requests */}
      {(cancelRequests.length > 0 || loadingCancel) && (
        <div className="mb-6">
          <h2 className="text-base font-bold text-[#191c1e] font-headline mb-3 flex items-center gap-2">
            Запросы на удаление
            {cancelRequests.length > 0 && (
              <span className="bg-red-500 text-white text-xs rounded-full px-2 py-0.5">{cancelRequests.length}</span>
            )}
          </h2>
          <div className="space-y-3">
            {loadingCancel ? (
              <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 text-center text-gray-400 dark:text-gray-500 text-sm">Загрузка...</div>
            ) : cancelRequests.map(req => (
              <div key={req.id} className="bg-white rounded-2xl p-4 border-l-4 border-orange-400" style={{boxShadow:'0 4px 16px rgba(25,28,30,0.05)'}}>
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="font-semibold text-gray-800 dark:text-white">{req.service_name}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">📞 {req.patient_phone}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">{req.from_clinic_name} → {req.to_clinic_name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Сотрудник: {req.created_by_name}</p>
                  </div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 text-right">
                    {new Date(req.cancel_requested_at).toLocaleDateString('ru-RU')}
                  </p>
                </div>
                <div className="bg-orange-50 dark:bg-orange-900/30 rounded-xl p-3 mb-3">
                  <p className="text-xs font-medium text-orange-700 dark:text-orange-400 mb-1">Причина:</p>
                  <p className="text-sm text-orange-800 dark:text-orange-300">«{req.cancel_reason}»</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      try {
                        await approveCancelRequest(req.id)
                        setCancelRequests(prev => prev.filter(r => r.id !== req.id))
                      } catch { setError('Ошибка подтверждения') }
                    }}
                    className="flex-1 bg-red-500 text-white rounded-xl py-2 text-sm font-medium"
                  >
                    Подтвердить удаление
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        await rejectCancelRequest(req.id)
                        setCancelRequests(prev => prev.filter(r => r.id !== req.id))
                      } catch { setError('Ошибка отклонения') }
                    }}
                    className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-xl py-2 text-sm font-medium"
                  >
                    Отклонить
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}


      {/* Поддержка */}
      <div className="mb-6">
        <h2 className="text-base font-bold text-[#191c1e] font-headline mb-3 flex items-center gap-2">
          <span className="material-symbols-outlined text-xl" style={{fontVariationSettings:"FILL 1"}}>support_agent</span>
          Поддержка
        </h2>
        <div className="bg-white rounded-2xl overflow-hidden" style={{boxShadow:'0 4px 16px rgba(25,28,30,0.05)'}}>
          <AdminSupportPanel />
        </div>
      </div>
      {/* Clinic-to-Clinic Flow Table */}
      <div>
        <h2 className="text-base font-bold text-[#191c1e] font-headline mb-3">Поток между клиниками</h2>
        <div className="bg-white rounded-2xl overflow-x-auto" style={{boxShadow:'0 4px 16px rgba(25,28,30,0.05)'}}>
          {loadingClinics ? (
            <div className="p-6 text-center text-gray-400 dark:text-gray-500 text-sm">Загрузка...</div>
          ) : clinics.length === 0 ? (
            <div className="p-6 text-center text-gray-400 dark:text-gray-500 text-sm">Нет данных</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#eceef0]">
                  <th className="text-left text-[11px] font-semibold text-[#727783] uppercase tracking-wider px-4 py-3">Откуда</th>
                  <th className="text-left text-[11px] font-semibold text-[#727783] uppercase tracking-wider px-4 py-3">Куда</th>
                  <th className="text-right text-[11px] font-semibold text-[#727783] uppercase tracking-wider px-4 py-3">Направлений</th>
                  <th className="text-right text-[11px] font-semibold text-[#727783] uppercase tracking-wider px-4 py-3 hidden sm:table-cell">Подтверждено</th>
                </tr>
              </thead>
              <tbody>
                {clinics.map((row, i) => (
                  <tr
                    key={`${row.from_clinic_id}-${row.to_clinic_id}-${i}`}
                    className={i % 2 === 0 ? 'bg-white' : 'bg-[#f7f9fb]'}
                  >
                    <td className="px-4 py-3 text-[#191c1e]">
                      {row.from_clinic_name || row.from_clinic || '—'}
                    </td>
                    <td className="px-4 py-3 text-[#191c1e]">
                      {row.to_clinic_name || row.to_clinic || '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-[#191c1e] font-semibold">
                      {row.total ?? row.referral_count ?? 0}
                    </td>
                    <td className="px-4 py-3 text-right text-[#16A34A] font-medium hidden sm:table-cell">
                      {row.confirmed ?? row.confirmed_count ?? 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
