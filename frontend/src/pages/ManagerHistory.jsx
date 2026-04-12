import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { getManagerReferrals } from '../api'
import StatusBadge from '../components/StatusBadge'

const STATUS_TABS = [
  { key: 'all',               label: 'Все' },
  { key: 'created',           label: 'Создано' },
  { key: 'confirmed',         label: 'Подтверждено' },
  { key: 'expired',           label: 'Истекло' },
  { key: 'cancel_requested',  label: 'На отмене' },
  { key: 'cancelled',         label: 'Удалено' },
]

function fmt(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function fmtFull(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function weekAgo() {
  const d = new Date()
  d.setDate(d.getDate() - 7)
  return d.toISOString().slice(0, 10)
}

function monthAgo() {
  const d = new Date()
  d.setDate(1)
  return d.toISOString().slice(0, 10)
}

export default function ManagerHistory() {
  const nav = useNavigate()
  const [referrals, setReferrals] = useState([])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('all')
  const [dateFrom, setDateFrom] = useState(monthAgo())
  const [dateTo, setDateTo] = useState(today())
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [expanded, setExpanded] = useState(null)
  const LIMIT = 50

  const load = useCallback(async (reset = true) => {
    setLoading(true)
    const p = reset ? 1 : page + 1
    try {
      const params = { page: p, limit: LIMIT }
      if (dateFrom) params.date_from = dateFrom
      if (dateTo) params.date_to = dateTo
      if (status !== 'all') params.status = status
      const res = await getManagerReferrals(params)
      const data = Array.isArray(res.data) ? res.data : []
      if (reset) {
        setReferrals(data)
        setPage(1)
      } else {
        setReferrals(prev => [...prev, ...data])
        setPage(p)
      }
      setHasMore(data.length === LIMIT)
    } catch {
      if (reset) setReferrals([])
    } finally {
      setLoading(false)
    }
  }, [status, dateFrom, dateTo, page])

  useEffect(() => { load(true) }, [status, dateFrom, dateTo])

  const setPreset = (preset) => {
    if (preset === 'today') { setDateFrom(today()); setDateTo(today()) }
    else if (preset === 'week') { setDateFrom(weekAgo()); setDateTo(today()) }
    else if (preset === 'month') { setDateFrom(monthAgo()); setDateTo(today()) }
    else { setDateFrom(''); setDateTo('') }
  }

  return (
    <div className="p-4 pb-24">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => nav('/manager')} className="text-gray-400 hover:text-gray-600">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <h1 className="text-xl font-bold text-gray-800">История направлений</h1>
      </div>

      {/* Quick presets */}
      <div className="flex gap-2 mb-3 flex-wrap">
        {[['today','Сегодня'],['week','7 дней'],['month','Месяц'],['all','Все время']].map(([p,l]) => (
          <button
            key={p}
            onClick={() => setPreset(p)}
            className="text-xs px-3 py-1.5 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 active:bg-gray-100"
          >{l}</button>
        ))}
      </div>

      {/* Date range */}
      <div className="flex gap-2 mb-4">
        <div className="flex-1">
          <label className="block text-xs text-gray-400 mb-1">С даты</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-primary" />
        </div>
        <div className="flex-1">
          <label className="block text-xs text-gray-400 mb-1">По дату</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-primary" />
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1 scrollbar-none">
        {STATUS_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setStatus(t.key)}
            className={`flex-shrink-0 text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
              status === t.key
                ? 'bg-primary text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >{t.label}</button>
        ))}
      </div>

      {/* Count */}
      {!loading && (
        <p className="text-xs text-gray-400 mb-3">
          {referrals.length === 0 ? 'Нет записей' : `Найдено: ${referrals.length}${hasMore ? '+' : ''}`}
        </p>
      )}

      {/* List */}
      {loading && referrals.length === 0 ? (
        <div className="text-center text-gray-400 text-sm py-12">Загрузка...</div>
      ) : referrals.length === 0 ? (
        <div className="text-center text-gray-400 text-sm py-12">Направлений не найдено</div>
      ) : (
        <div className="space-y-2">
          {referrals.map(r => {
            const isOpen = expanded === r.id
            const isCancelled = r.status === 'cancelled'
            const isCancelReq = r.status === 'cancel_requested'
            return (
              <div
                key={r.id}
                className={`bg-white rounded-2xl shadow-sm overflow-hidden border-l-4 ${
                  isCancelled ? 'border-red-300' :
                  isCancelReq ? 'border-orange-400' :
                  r.status === 'confirmed' ? 'border-green-400' :
                  r.status === 'expired' ? 'border-gray-300' :
                  'border-blue-300'
                }`}
              >
                {/* Card header — always visible */}
                <button
                  className="w-full text-left p-4"
                  onClick={() => setExpanded(isOpen ? null : r.id)}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-800 truncate">{r.service_name}</p>
                      <p className="text-sm text-gray-500 mt-0.5">📞 {r.patient_phone}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 ml-2 flex-shrink-0">
                      <StatusBadge status={r.status} />
                      <span className="text-xs text-gray-400">{fmt(r.created_at)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 mt-1">
                    <span className="text-xs text-gray-400">{r.from_clinic_name}</span>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="text-gray-300 flex-shrink-0">
                      <path d="M3 8h10M10 5l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <span className="text-xs text-gray-400 truncate">{r.to_clinic_name}</span>
                  </div>
                </button>

                {/* Expanded details */}
                {isOpen && (
                  <div className="px-4 pb-4 border-t border-gray-50 pt-3 space-y-2">
                    <Row label="Сотрудник" value={r.creator_name} />
                    <Row label="Создано" value={fmtFull(r.created_at)} />
                    {r.confirmed_at && <Row label="Подтверждено" value={fmtFull(r.confirmed_at)} />}
                    {r.expires_at && r.status === 'created' && <Row label="Истекает" value={fmtFull(r.expires_at)} />}
                    {r.bonus_amount != null && (
                      <Row
                        label="Бонус"
                        value={`${r.bonus_amount} Б (${r.bonus_status === 'PAID' ? 'выплачен' : 'в ожидании'})`}
                        color={r.bonus_status === 'PAID' ? 'text-green-600' : 'text-amber-600'}
                      />
                    )}
                    {(isCancelReq || isCancelled) && (
                      <>
                        {r.cancel_requested_at && <Row label="Запрос на удаление" value={fmtFull(r.cancel_requested_at)} />}
                        {r.cancel_reason && (
                          <div className="bg-orange-50 rounded-xl p-3">
                            <p className="text-xs font-medium text-orange-700 mb-1">Причина:</p>
                            <p className="text-sm text-orange-800">«{r.cancel_reason}»</p>
                          </div>
                        )}
                        {isCancelled && r.cancelled_at && (
                          <Row label="Удалено" value={`${fmtFull(r.cancelled_at)}${r.canceller_name ? ` (${r.canceller_name})` : ''}`} color="text-red-500" />
                        )}
                      </>
                    )}
                    {r.notes && <Row label="Примечание" value={r.notes} />}
                  </div>
                )}
              </div>
            )
          })}

          {hasMore && (
            <button
              onClick={() => load(false)}
              disabled={loading}
              className="w-full py-3 text-sm text-primary font-medium border border-primary/30 rounded-2xl hover:bg-primary/5 disabled:opacity-50"
            >
              {loading ? 'Загрузка...' : 'Загрузить ещё'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Row({ label, value, color }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-xs text-gray-400 flex-shrink-0">{label}</span>
      <span className={`text-xs font-medium text-right ${color || 'text-gray-700'}`}>{value || '—'}</span>
    </div>
  )
}
