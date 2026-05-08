/**
 * SmsHistorySection — глобальная история отправок SMS по всем кампаниям.
 *
 * API:
 *   GET /sms/campaigns
 *   GET /sms/campaigns/{id}/messages?status=
 *
 * Так как backend не предоставляет /sms/messages?phone=&status= напрямую,
 * мы агрегируем messages всех кампаний на клиенте. Для большой базы это
 * можно заменить на единый эндпоинт позже.
 *
 * Фильтры: campaign / status / date / phone search.
 * CSV-экспорт текущей выборки.
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import api from '../../api'
import { useToast } from '../../design'

const apiFetch = (m, url, _t, d) => api({ method: m, url, data: d })

const STATUS_LABEL = {
  queued:    'В очереди',
  sent:      'Отправлено',
  delivered: 'Доставлено',
  failed:    'Ошибка',
  cancelled: 'Отменено',
}
const STATUS_COLOR = {
  queued:    'bg-gray-100 text-gray-600',
  sent:      'bg-blue-100 text-blue-700',
  delivered: 'bg-emerald-100 text-emerald-700',
  failed:    'bg-red-100 text-red-600',
  cancelled: 'bg-gray-100 text-gray-500',
}

function fmt(s) {
  if (!s) return ''
  try { return new Date(s).toLocaleString('ru', { dateStyle: 'short', timeStyle: 'short' }) }
  catch { return s }
}

function toCsv(rows) {
  const head = ['Телефон', 'Текст', 'Статус', 'Провайдер', 'Отправлено', 'Доставлено', 'Ошибка', 'Кампания']
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = [head.map(esc).join(',')]
  for (const r of rows) {
    lines.push([
      r.phone,
      r.body || r.text || '',
      STATUS_LABEL[r.status] || r.status || '',
      r.provider || '',
      r.sent_at ? new Date(r.sent_at).toISOString() : '',
      r.delivered_at ? new Date(r.delivered_at).toISOString() : '',
      r.error || '',
      r._campaign_name || '',
    ].map(esc).join(','))
  }
  return lines.join('\n')
}

export default function SmsHistorySection({ token }) {
  const [campaigns, setCampaigns] = useState([])
  const [messages, setMessages]   = useState(null)
  const [campaignId, setCampaignId] = useState('')
  const [status, setStatus]   = useState('')
  const [phone, setPhone]     = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo]     = useState('')
  const [needPay, setNeedPay] = useState(false)
  const [err, setErr] = useState('')
  const { toast } = useToast()

  const loadCampaigns = useCallback(async () => {
    try {
      const r = await apiFetch('get', '/sms/campaigns', token)
      setCampaigns(Array.isArray(r.data) ? r.data : [])
    } catch (e) {
      const code = e?.response?.status
      if (code === 402) setNeedPay(true)
      else setErr(e?.response?.data?.detail || 'Ошибка загрузки кампаний')
    }
  }, [token])

  const loadMessages = useCallback(async () => {
    setErr('')
    try {
      const params = new URLSearchParams()
      if (status) params.set('status', status)

      let all = []
      if (campaignId) {
        const r = await apiFetch('get', `/sms/campaigns/${campaignId}/messages?${params.toString()}`, token)
        const cName = campaigns.find(c => String(c.id) === String(campaignId))?.name || ''
        all = (r.data || []).map(m => ({ ...m, _campaign_id: campaignId, _campaign_name: cName }))
      } else {
        // Агрегируем по всем кампаниям; ограничим до 30 последних, чтобы не перегружать.
        const list = (campaigns || []).slice(0, 30)
        const settled = await Promise.allSettled(
          list.map(c => apiFetch('get', `/sms/campaigns/${c.id}/messages?${params.toString()}`, token).then(r => ({ c, data: r.data })))
        )
        for (const s of settled) {
          if (s.status === 'fulfilled' && Array.isArray(s.value.data)) {
            const cName = s.value.c.name
            const cid = s.value.c.id
            all = all.concat(s.value.data.map(m => ({ ...m, _campaign_id: cid, _campaign_name: cName })))
          }
        }
        all.sort((a, b) => {
          const ta = a.sent_at ? new Date(a.sent_at).getTime() : 0
          const tb = b.sent_at ? new Date(b.sent_at).getTime() : 0
          return tb - ta
        })
      }
      setMessages(all)
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Ошибка загрузки истории')
      setMessages([])
    }
  }, [token, campaignId, status, campaigns])

  useEffect(() => { loadCampaigns() }, [loadCampaigns])
  useEffect(() => { if (!needPay) loadMessages() }, [loadMessages, needPay])

  // Локальная фильтрация по phone и dateFrom/To.
  const filtered = useMemo(() => {
    if (!messages) return null
    const ph = phone.trim()
    const dF = dateFrom ? new Date(dateFrom).getTime() : 0
    const dT = dateTo ? new Date(dateTo).getTime() + 86400000 : 0
    return messages.filter(m => {
      if (ph && !(m.phone || '').includes(ph)) return false
      if (dF || dT) {
        const t = m.sent_at ? new Date(m.sent_at).getTime() : 0
        if (dF && t < dF) return false
        if (dT && t > dT) return false
      }
      return true
    })
  }, [messages, phone, dateFrom, dateTo])

  const totals = useMemo(() => {
    if (!filtered) return null
    let sent = 0, delivered = 0, failed = 0
    for (const m of filtered) {
      if (m.status === 'sent' || m.status === 'delivered') sent += 1
      if (m.status === 'delivered') delivered += 1
      if (m.status === 'failed') failed += 1
    }
    return {
      total: filtered.length,
      sent,
      delivered,
      failed,
      deliveryPct: sent ? Math.round(delivered / sent * 100) : 0,
    }
  }, [filtered])

  const exportCsv = () => {
    if (!filtered?.length) { toast({ kind: 'error', text: 'Нет данных для экспорта' }); return }
    const blob = new Blob(['﻿' + toCsv(filtered)], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `sms_history_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (needPay) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
        Подключите модуль <code>sms_marketing</code> в каталоге.
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCell label="Всего записей" value={totals?.total ?? '—'} />
        <KpiCell label="Отправлено"   value={totals?.sent ?? '—'} />
        <KpiCell label="Доставлено"   value={totals?.delivered ?? '—'} />
        <KpiCell label="% доставки"   value={totals ? `${totals.deliveryPct}%` : '—'} />
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 grid grid-cols-1 md:grid-cols-5 gap-3">
        <select
          value={campaignId}
          onChange={e => setCampaignId(e.target.value)}
          className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 dark:text-white text-sm"
        >
          <option value="">Все кампании</option>
          {campaigns.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select
          value={status}
          onChange={e => setStatus(e.target.value)}
          className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 dark:text-white text-sm"
        >
          <option value="">Все статусы</option>
          <option value="queued">В очереди</option>
          <option value="sent">Отправлено</option>
          <option value="delivered">Доставлено</option>
          <option value="failed">Ошибка</option>
        </select>
        <input
          placeholder="Телефон"
          value={phone}
          onChange={e => setPhone(e.target.value)}
          className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 dark:text-white text-sm"
        />
        <input
          type="date"
          value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
          className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 dark:text-white text-sm"
        />
        <input
          type="date"
          value={dateTo}
          onChange={e => setDateTo(e.target.value)}
          className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 dark:text-white text-sm"
        />
      </div>

      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-500">
          {filtered === null ? 'Загрузка…' : `Найдено: ${filtered.length}`}
        </div>
        <button
          onClick={exportCsv}
          className="bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100 px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5"
        >
          <span className="material-symbols-outlined text-[16px]">download</span>
          Экспорт CSV
        </button>
      </div>

      {err && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-600 text-sm">{err}</div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden border border-gray-100 dark:border-gray-700">
        {filtered === null ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-4 border-[#0097A7] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-gray-500 text-sm">Сообщений по фильтрам не найдено</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900/40 text-left">
                <tr>
                  <th className="px-3 py-2 font-semibold text-gray-600 dark:text-gray-300">Телефон</th>
                  <th className="px-3 py-2 font-semibold text-gray-600 dark:text-gray-300">Текст</th>
                  <th className="px-3 py-2 font-semibold text-gray-600 dark:text-gray-300">Кампания</th>
                  <th className="px-3 py-2 font-semibold text-gray-600 dark:text-gray-300">Статус</th>
                  <th className="px-3 py-2 font-semibold text-gray-600 dark:text-gray-300">Провайдер</th>
                  <th className="px-3 py-2 font-semibold text-gray-600 dark:text-gray-300">Отправлено</th>
                  <th className="px-3 py-2 font-semibold text-gray-600 dark:text-gray-300">Доставлено</th>
                  <th className="px-3 py-2 font-semibold text-gray-600 dark:text-gray-300">Ошибка</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 500).map(m => (
                  <tr key={`${m._campaign_id}_${m.id}`} className="border-t border-gray-100 dark:border-gray-700">
                    <td className="px-3 py-2 font-mono text-xs">{m.phone}</td>
                    <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-300 max-w-xs truncate" title={m.body || m.text}>
                      {m.body || m.text || '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">{m._campaign_name}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLOR[m.status] || 'bg-gray-100 text-gray-500'}`}>
                        {STATUS_LABEL[m.status] || m.status || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">{m.provider || '—'}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{fmt(m.sent_at)}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{fmt(m.delivered_at)}</td>
                    <td className="px-3 py-2 text-xs text-red-500">{m.error || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length > 500 && (
              <div className="text-xs text-gray-400 py-2 text-center">Показано первые 500 из {filtered.length}</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function KpiCell({ label, value }) {
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl p-4">
      <div className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-extrabold text-gray-900 dark:text-white mt-1">{value}</div>
    </div>
  )
}
