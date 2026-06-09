/**
 * CampaignsList.jsx — список push-кампаний с фильтром по статусу.
 * Карточка: title, сегмент, статус, дата, sent/delivered/click, A/B mini-chart.
 * Клик → CampaignDetailsModal.
 */
import { useEffect, useState, useCallback } from 'react'
import { API_BASE } from '../../config'

function apiFetch(token, path, opts = {}) {
  return fetch(API_BASE + path, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  })
}

const STATUS = {
  draft:     { label: 'Черновик',   color: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200', icon: 'edit_note' },
  scheduled: { label: 'Запланирована', color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300', icon: 'schedule' },
  sending:   { label: 'Отправляется', color: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300', icon: 'send' },
  sent:      { label: 'Отправлена', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300', icon: 'check_circle' },
  failed:    { label: 'Ошибка',     color: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300', icon: 'error' },
  cancelled: { label: 'Отменена',   color: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300', icon: 'cancel' },
}

function fmtDateTime(s) {
  if (!s) return '—'
  try { return new Date(s).toLocaleString('ru', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) }
  catch { return s }
}

export default function CampaignsList({ token, onCompose, onOpenDetails }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('all')

  const reload = useCallback(() => {
    setLoading(true)
    const q = status === 'all' ? '' : `?status=${status}`
    apiFetch(token, `/engagement/campaigns${q}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { setItems(d?.items || d || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [token, status])

  useEffect(() => { reload() }, [reload])

  async function cancelCampaign(c) {
    if (!confirm(`Отменить кампанию «${c.title}»?`)) return
    await apiFetch(token, `/engagement/campaigns/${c.id}/cancel`, { method: 'POST' })
    reload()
  }
  async function sendNow(c) {
    if (!confirm(`Отправить кампанию «${c.title}» прямо сейчас?`)) return
    await apiFetch(token, `/engagement/campaigns/${c.id}/send`, { method: 'POST' })
    reload()
  }
  async function removeCampaign(c) {
    if (!confirm(`Удалить кампанию «${c.title}»?`)) return
    await apiFetch(token, `/engagement/campaigns/${c.id}`, { method: 'DELETE' })
    reload()
  }

  return (
    <div className="space-y-3">
      <div className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-200 dark:border-gray-700 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-gray-600 dark:text-gray-300">Статус:</span>
        {['all', 'draft', 'scheduled', 'sending', 'sent', 'failed'].map(s => (
          <button key={s} onClick={() => setStatus(s)}
            className={`px-3 py-1 rounded-lg text-sm font-semibold ${
              status === s ? 'bg-cyan-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200'
            }`}>
            {s === 'all' ? 'Все' : STATUS[s]?.label || s}
          </button>
        ))}
        <button onClick={() => onCompose && onCompose({})}
          className="ml-auto px-3 py-1.5 rounded-lg bg-cyan-600 text-white text-sm font-semibold hover:bg-cyan-700 flex items-center gap-1">
          <span className="material-symbols-outlined text-base">add</span>Новая кампания
        </button>
      </div>

      {loading && <div className="text-center py-10 text-gray-400">Загрузка…</div>}

      {!loading && items.length === 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-10 border border-dashed border-gray-200 dark:border-gray-700 text-center">
          <span className="material-symbols-outlined text-5xl text-gray-300 dark:text-gray-600">campaign</span>
          <div className="mt-2 text-gray-500 dark:text-gray-400">Кампаний нет</div>
          <button onClick={() => onCompose && onCompose({})}
            className="mt-3 px-4 py-2 rounded-lg bg-cyan-600 text-white text-sm hover:bg-cyan-700">
            Создать первую
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {items.map(c => (
          <CampaignCard
            key={c.id}
            c={c}
            onOpen={() => onOpenDetails && onOpenDetails(c.id)}
            onCancel={() => cancelCampaign(c)}
            onSendNow={() => sendNow(c)}
            onDelete={() => removeCampaign(c)}
          />
        ))}
      </div>
    </div>
  )
}

function CampaignCard({ c, onOpen, onCancel, onSendNow, onDelete }) {
  const st = STATUS[c.status] || STATUS.draft
  const stats = c.stats || c
  const sent = stats.sent_count ?? stats.sent ?? 0
  const delivered = stats.delivered_count ?? stats.delivered ?? 0
  const clicks = stats.click_count ?? stats.clicks ?? 0
  const deliveryRate = sent ? Math.round((delivered / sent) * 100) : 0
  const ctr = sent ? Math.round((clicks / sent) * 1000) / 10 : 0

  const ab = c.ab_enabled || stats.ab_enabled
  const aCtr = stats.variant_a_ctr ?? null
  const bCtr = stats.variant_b_ctr ?? null

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm hover:shadow-md transition group">
      <div className="flex items-start justify-between gap-2 mb-2">
        <button onClick={onOpen} className="flex-1 text-left">
          <h4 className="font-bold text-gray-900 dark:text-white group-hover:text-cyan-600 transition">{c.title || 'Без названия'}</h4>
          <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1">{c.body_preview || c.body || ''}</p>
        </button>
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${st.color}`}>
          <span className="material-symbols-outlined text-sm">{st.icon}</span>{st.label}
        </span>
      </div>

      <div className="text-xs text-gray-500 dark:text-gray-400 flex flex-wrap gap-3 mb-2">
        {c.segment_name && (
          <span className="flex items-center gap-1">
            <span className="material-symbols-outlined text-sm">groups</span>{c.segment_name}
          </span>
        )}
        {c.scheduled_at && c.status === 'scheduled' && (
          <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <span className="material-symbols-outlined text-sm">schedule</span>{fmtDateTime(c.scheduled_at)}
          </span>
        )}
        {c.sent_at && (
          <span className="flex items-center gap-1">
            <span className="material-symbols-outlined text-sm">done_all</span>{fmtDateTime(c.sent_at)}
          </span>
        )}
      </div>

      {/* Stats row */}
      {(c.status === 'sent' || c.status === 'sending') && (
        <div className="grid grid-cols-3 gap-2 mb-3">
          <Metric icon="send" value={sent} label="Отправлено" color="text-cyan-600" />
          <Metric icon="check_circle" value={`${delivered} (${deliveryRate}%)`} label="Доставлено" color="text-emerald-600" />
          <Metric icon="touch_app" value={`${clicks} (${ctr}%)`} label="Клики" color="text-violet-600" />
        </div>
      )}

      {/* A/B mini-chart */}
      {ab && (aCtr != null || bCtr != null) && (
        <div className="bg-gray-50 dark:bg-gray-900/40 rounded-lg p-2 mb-2">
          <div className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 mb-1 uppercase">A/B-test · CTR</div>
          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold text-cyan-600">A</span>
            <div className="flex-1 h-3 rounded bg-gray-200 dark:bg-gray-700 relative overflow-hidden">
              <div className="absolute inset-y-0 left-0 bg-cyan-500" style={{ width: `${Math.min(100, (aCtr || 0) * 100)}%` }} />
            </div>
            <span className="w-10 text-right tabular-nums">{aCtr != null ? `${(aCtr * 100).toFixed(1)}%` : '—'}</span>
          </div>
          <div className="flex items-center gap-2 text-xs mt-1">
            <span className="font-semibold text-violet-600">B</span>
            <div className="flex-1 h-3 rounded bg-gray-200 dark:bg-gray-700 relative overflow-hidden">
              <div className="absolute inset-y-0 left-0 bg-violet-500" style={{ width: `${Math.min(100, (bCtr || 0) * 100)}%` }} />
            </div>
            <span className="w-10 text-right tabular-nums">{bCtr != null ? `${(bCtr * 100).toFixed(1)}%` : '—'}</span>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1 pt-2 border-t border-gray-100 dark:border-gray-700">
        <button onClick={onOpen} className="px-2 py-1 rounded-md text-xs text-cyan-700 dark:text-cyan-300 hover:bg-cyan-50 dark:hover:bg-cyan-900/40 flex items-center gap-1">
          <span className="material-symbols-outlined text-sm">visibility</span>Подробнее
        </button>
        {(c.status === 'draft' || c.status === 'scheduled') && (
          <button onClick={onSendNow} className="px-2 py-1 rounded-md text-xs text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/40 flex items-center gap-1">
            <span className="material-symbols-outlined text-sm">send</span>Отправить
          </button>
        )}
        {(c.status === 'scheduled' || c.status === 'sending') && (
          <button onClick={onCancel} className="px-2 py-1 rounded-md text-xs text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/40 flex items-center gap-1">
            <span className="material-symbols-outlined text-sm">cancel</span>Отменить
          </button>
        )}
        {(c.status === 'draft' || c.status === 'cancelled' || c.status === 'failed') && (
          <button onClick={onDelete} className="px-2 py-1 rounded-md text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-900/40 flex items-center gap-1 ml-auto">
            <span className="material-symbols-outlined text-sm">delete</span>Удалить
          </button>
        )}
      </div>
    </div>
  )
}

function Metric({ icon, value, label, color }) {
  return (
    <div className="bg-gray-50 dark:bg-gray-900/40 rounded-lg p-2 text-center">
      <span className={`material-symbols-outlined text-base ${color}`}>{icon}</span>
      <div className="text-sm font-bold text-gray-900 dark:text-white">{value}</div>
      <div className="text-[10px] text-gray-500 dark:text-gray-400 uppercase">{label}</div>
    </div>
  )
}

// ─── Модал детальной статистики кампании ──────────────────────────────────
export function CampaignDetailsModal({ token, campaignId, onClose }) {
  const [c, setC] = useState(null)
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!campaignId) return
    Promise.all([
      apiFetch(token, `/engagement/campaigns/${campaignId}`).then(r => r.ok ? r.json() : null),
      apiFetch(token, `/engagement/campaigns/${campaignId}/stats`).then(r => r.ok ? r.json() : null),
    ]).then(([cd, st]) => { setC(cd); setStats(st); setLoading(false) })
  }, [token, campaignId])

  if (!campaignId) return null

  return (
    <div className="fixed inset-0 bg-black/50 z-[1000] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-3xl max-h-[94vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-gray-900 dark:text-white text-lg">{c?.title || 'Кампания'}</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">{c?.body_preview || c?.body}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <div className="p-6 space-y-4">
          {loading && <div className="text-center py-10 text-gray-400">Загрузка…</div>}
          {!loading && stats && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <BigStat label="Отправлено"    value={stats.sent_count ?? 0}      color="text-cyan-600" icon="send" />
                <BigStat label="Доставлено"    value={stats.delivered_count ?? 0} color="text-emerald-600" icon="check_circle"
                  sub={stats.sent_count ? `${Math.round((stats.delivered_count / stats.sent_count) * 100)}%` : ''} />
                <BigStat label="Клики"         value={stats.click_count ?? 0}     color="text-violet-600" icon="touch_app"
                  sub={stats.sent_count ? `CTR ${((stats.click_count / stats.sent_count) * 100).toFixed(1)}%` : ''} />
                <BigStat label="Ошибки"        value={stats.failed_count ?? 0}    color="text-red-600" icon="error" />
              </div>

              {/* A vs B */}
              {(stats.variant_a_ctr != null || stats.variant_b_ctr != null) && (
                <div className="bg-gray-50 dark:bg-gray-900/40 rounded-xl p-4">
                  <h4 className="font-semibold text-gray-700 dark:text-gray-200 mb-3">A/B-тест</h4>
                  <div className="space-y-2">
                    <ABRow letter="A" ctr={stats.variant_a_ctr} sent={stats.variant_a_sent} body={c?.body_a || c?.body} />
                    <ABRow letter="B" ctr={stats.variant_b_ctr} sent={stats.variant_b_sent} body={c?.body_b} />
                  </div>
                  {stats.variant_a_ctr != null && stats.variant_b_ctr != null && (
                    <div className="mt-3 text-sm font-semibold text-cyan-700 dark:text-cyan-300">
                      Победитель: вариант {stats.variant_a_ctr >= stats.variant_b_ctr ? 'A' : 'B'}
                    </div>
                  )}
                </div>
              )}

              {c?.segment_name && (
                <div className="text-sm">
                  <span className="text-gray-500">Сегмент:</span> <b className="text-gray-900 dark:text-white">{c.segment_name}</b>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function BigStat({ label, value, sub, icon, color }) {
  return (
    <div className="bg-white dark:bg-gray-900/40 rounded-xl p-3 border border-gray-200 dark:border-gray-700">
      <span className={`material-symbols-outlined ${color}`} style={{ fontVariationSettings: "'FILL' 1" }}>{icon}</span>
      <div className="text-2xl font-bold text-gray-900 dark:text-white">{Number(value).toLocaleString('ru')}</div>
      <div className="text-xs text-gray-500 dark:text-gray-400 uppercase">{label}</div>
      {sub && <div className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">{sub}</div>}
    </div>
  )
}

function ABRow({ letter, ctr, sent, body }) {
  const color = letter === 'A' ? 'cyan' : 'violet'
  return (
    <div>
      <div className="flex items-center gap-2 text-xs">
        <span className={`w-6 text-center font-bold text-${color}-600`}>{letter}</span>
        <div className="flex-1 h-4 rounded bg-gray-200 dark:bg-gray-700 relative overflow-hidden">
          <div className={`absolute inset-y-0 left-0 bg-${color}-500`} style={{ width: `${Math.min(100, (ctr || 0) * 100)}%` }} />
        </div>
        <span className="w-16 text-right tabular-nums">CTR {ctr != null ? `${(ctr * 100).toFixed(1)}%` : '—'}</span>
        <span className="w-20 text-right text-gray-500 text-[11px]">{sent != null ? `${sent} отпр.` : ''}</span>
      </div>
      {body && <div className="text-xs text-gray-600 dark:text-gray-400 mt-1 ml-8 line-clamp-2">{body}</div>}
    </div>
  )
}
