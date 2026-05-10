/**
 * ModuleMonitoringSection — Module Monitoring System (frontend, ЛК франшизы).
 *
 * Показывает сетку карточек по платным модулям тенанта с индикатором
 * health-статуса (✅ ok / ⚠️ degraded / ❌ error / 💤 idle / ❔ unknown).
 *
 * - Auto-refresh каждые 60 сек.
 * - Кнопка «Проверить сейчас» — POST /admin/modules/health/check-now.
 * - Tooltip с last_error_message и метриками (delivery rate, count и т.д.).
 *
 * Бэкенд: app/routers/module_monitoring.py
 *         app/services/module_health_service.py
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import api from '../api'

// ── Метаданные модулей: иконка + ярлык + порядок ─────────────────────────────
const MODULE_META = {
  telemedicine:        { label: 'Телемедицина',        icon: 'video_call' },
  ads_basic:           { label: 'Реклама (базовая)',   icon: 'campaign' },
  ads_agency:          { label: 'Реклама (агентская)', icon: 'campaign' },
  inventory:           { label: 'Учёт инвентаря',      icon: 'inventory_2' },
  loyalty_pro:         { label: 'Лояльность Pro',      icon: 'loyalty' },
  mis_sync:            { label: 'МИС-синхронизация',   icon: 'sync_alt' },
  sms_marketing:       { label: 'SMS-маркетинг',       icon: 'sms' },
  cross_clinic_audio:  { label: 'Аудио между клиник.', icon: 'phone_in_talk' },
  telephony_basic:     { label: 'Телефония',           icon: 'call' },
  video_calls:         { label: 'Видеозвонки 1:1',     icon: 'video_chat' },
  video_conference:    { label: 'Видеоконференции',    icon: 'meeting_room' },
  call_recording:      { label: 'Запись звонков',      icon: 'mic' },
  ai_analytics_basic:  { label: 'AI-аналитика (basic)', icon: 'auto_awesome' },
  ai_analytics_pro:    { label: 'AI-аналитика (pro)',  icon: 'auto_awesome' },
  ai_assistant:        { label: 'AI-ассистент',        icon: 'smart_toy' },
  fiscal_54fz_pro:     { label: 'Чеки 54-ФЗ',          icon: 'receipt_long' },
  online_payments_pro: { label: 'Онлайн-оплата',       icon: 'credit_card' },
  white_label:         { label: 'White-Label',         icon: 'palette' },
  webhooks:            { label: 'Webhooks',            icon: 'webhook' },
  ltv_pro:             { label: 'LTV-аналитика',       icon: 'insights' },
}

const STATUS_META = {
  ok:       { emoji: '✅', label: 'OK',       color: '#16a34a',
              bg: 'bg-green-50',  ring: 'ring-green-200',
              dark: 'dark:bg-green-900/20  dark:ring-green-800' },
  degraded: { emoji: '⚠️', label: 'Degraded', color: '#ca8a04',
              bg: 'bg-amber-50',  ring: 'ring-amber-200',
              dark: 'dark:bg-amber-900/20  dark:ring-amber-800' },
  error:    { emoji: '❌', label: 'Error',    color: '#dc2626',
              bg: 'bg-red-50',    ring: 'ring-red-200',
              dark: 'dark:bg-red-900/20    dark:ring-red-800' },
  idle:     { emoji: '💤', label: 'Idle',     color: '#64748b',
              bg: 'bg-slate-50',  ring: 'ring-slate-200',
              dark: 'dark:bg-slate-900/30  dark:ring-slate-700' },
  unknown:  { emoji: '❔', label: 'Unknown',  color: '#9ca3af',
              bg: 'bg-gray-50',   ring: 'ring-gray-200',
              dark: 'dark:bg-gray-900/30   dark:ring-gray-700' },
}

function fmtTime(iso) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit',
      day: '2-digit', month: '2-digit' })
  } catch { return '—' }
}

function ModuleCard({ row }) {
  const { module_key, health = {}, subscription_status } = row
  const meta = MODULE_META[module_key] || { label: module_key, icon: 'extension' }
  const st = STATUS_META[health.status] || STATUS_META.unknown
  const metrics = health.metrics || {}

  return (
    <div className={`rounded-xl ring-1 ${st.bg} ${st.ring} ${st.dark}
                     p-4 transition hover:shadow-md`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="material-symbols-outlined text-[#0097A7] text-2xl"
                style={{ fontVariationSettings: "'FILL' 1" }}>
            {meta.icon}
          </span>
          <div className="min-w-0">
            <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">
              {meta.label}
            </div>
            <div className="text-[11px] font-mono text-gray-500 truncate">
              {module_key}
            </div>
          </div>
        </div>
        <span className="text-xl shrink-0" title={st.label}>{st.emoji}</span>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <span className="text-xs px-2 py-0.5 rounded-full font-semibold uppercase
                         tracking-wider"
              style={{ background: st.color + '22', color: st.color }}>
          {st.label}
        </span>
        {subscription_status && (
          <span className="text-[10px] uppercase tracking-wider text-gray-500">
            sub: {subscription_status}
          </span>
        )}
      </div>

      <div className="mt-3 text-xs text-gray-600 dark:text-gray-400 space-y-1">
        <div>Проверено: <b>{fmtTime(health.last_check_at)}</b></div>
        {health.last_used_at && (
          <div>Активность: <b>{fmtTime(health.last_used_at)}</b></div>
        )}
        <div>Ошибок за 24ч: <b>{health.error_count_24h ?? 0}</b></div>
      </div>

      {Object.keys(metrics).length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-[#0097A7] font-medium">
            Метрики
          </summary>
          <pre className="mt-1 p-2 rounded-lg bg-white/50 dark:bg-black/20
                          text-[11px] overflow-x-auto">
{JSON.stringify(metrics, null, 2)}
          </pre>
        </details>
      )}

      {health.last_error_message && (
        <div className="mt-2 text-xs text-red-700 dark:text-red-300
                        bg-red-100/70 dark:bg-red-950/40 rounded-lg p-2">
          <b>Ошибка:</b>{' '}
          <span title={health.last_error_message}>
            {health.last_error_message.slice(0, 160)}
            {health.last_error_message.length > 160 ? '…' : ''}
          </span>
        </div>
      )}
    </div>
  )
}

export default function ModuleMonitoringSection({ token } = {}) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)
  const timerRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api({ method: 'GET', url: '/admin/modules/health' })
      setRows(res.data?.modules || [])
      setUpdatedAt(new Date())
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || 'Ошибка')
    } finally {
      setLoading(false)
    }
  }, [])

  const checkNow = useCallback(async () => {
    setRunning(true)
    setError(null)
    try {
      await api({ method: 'POST', url: '/admin/modules/health/check-now' })
      await load()
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || 'Ошибка')
    } finally {
      setRunning(false)
    }
  }, [load])

  useEffect(() => {
    load()
    timerRef.current = setInterval(load, 60_000)
    return () => clearInterval(timerRef.current)
  }, [load])

  const counts = useMemo(() => {
    const out = { ok: 0, degraded: 0, error: 0, idle: 0, unknown: 0 }
    for (const r of rows) {
      const s = (r.health?.status || 'unknown')
      out[s] = (out[s] || 0) + 1
    }
    return out
  }, [rows])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {Object.entries(STATUS_META).map(([k, m]) => (
            <span key={k}
                  className="text-xs px-2.5 py-1 rounded-full font-semibold
                             bg-white dark:bg-gray-800 ring-1 ring-gray-200
                             dark:ring-gray-700">
              {m.emoji} {m.label}: <b>{counts[k] || 0}</b>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {updatedAt && (
            <span className="text-xs text-gray-500">
              Обновлено: {updatedAt.toLocaleTimeString('ru-RU')}
            </span>
          )}
          <button
            onClick={checkNow}
            disabled={running}
            className="px-3 py-1.5 rounded-lg text-sm font-semibold
                       bg-[#0097A7] text-white hover:bg-[#00838f]
                       disabled:opacity-50 transition">
            {running ? 'Проверяем…' : 'Проверить сейчас'}
          </button>
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-700 dark:text-red-300 bg-red-50
                        dark:bg-red-950/40 rounded-lg p-3 ring-1 ring-red-200
                        dark:ring-red-800">
          {error}
        </div>
      )}

      {loading && rows.length === 0 ? (
        <div className="text-gray-400 text-sm">Загрузка…</div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-gray-500 bg-white dark:bg-gray-800
                        rounded-xl p-6 ring-1 ring-gray-200 dark:ring-gray-700">
          Нет подключённых платных модулей или ещё не было проверок.
          Нажмите «Проверить сейчас».
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {rows.map(r => <ModuleCard key={r.module_key} row={r} />)}
        </div>
      )}
    </div>
  )
}
