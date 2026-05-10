/**
 * ========================================
 * БЛОК: <SecuritySection> — Журнал безопасности (super_admin)
 * ========================================
 *
 * Единый dashboard алертов и атак для владельца платформы.
 *
 * Эндпоинты:
 *   GET  /admin/security/summary      — карточки + top-5 IP + impersonations
 *   GET  /admin/security/audit        — paginated лента с фильтрами
 *   GET  /admin/security/heatmap      — activity grid 7×24
 *   GET  /admin/security/blocked-ips  — список ручных блокировок
 *   POST /admin/security/block-ip     — заблокировать IP
 *   POST /admin/security/unblock-ip   — снять блокировку
 *
 * Доступ — только super_admin (защита на бэке).
 *
 * Лэйаут:
 *   1) Summary cards (failed logins / brute force / permission denied / blocked IPs)
 *   2) Heatmap activity 7×24
 *   3) Top-5 атак (IP) с кнопкой «Заблокировать»
 *   4) Top-5 атакованных пользователей
 *   5) Активные impersonation-сессии
 *   6) Модули с ошибками (error_rate > 5%)
 *   7) Таблица последних событий с фильтрами и поиском
 *   8) Модалка детали события
 *
 * Realtime — polling каждые 30 секунд (без WebSocket для устойчивости).
 * Dark-mode совместимо: использует токены дизайн-системы.
 * ========================================
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import api from '../api'
import { Card, Chip, Button, EmptyState, Tabs, Modal, useToast } from '../design'


// ── Утилиты ────────────────────────────────────────────────────────────────

function flagFromCountry(code) {
  if (!code || code.length !== 2) return ''
  const A = 0x1F1E6
  return String.fromCodePoint(...code.toUpperCase().split('').map(c => A + c.charCodeAt(0) - 65))
}

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'))
  return d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'medium' })
}

function fmtRelative(iso) {
  if (!iso) return ''
  const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'))
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return `${Math.floor(diff)} с назад`
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`
  return `${Math.floor(diff / 86400)} дн назад`
}

const ACTION_META = {
  'auth.login_failed':              { ru: 'Неверный пароль',       tone: 'warning', icon: 'lock' },
  'auth.brute_force_detected':      { ru: 'Brute-force атака',     tone: 'danger',  icon: 'gpp_bad' },
  'auth.login':                     { ru: 'Вход в систему',        tone: 'neutral', icon: 'login' },
  'auth.logout':                    { ru: 'Выход',                 tone: 'neutral', icon: 'logout' },
  'password.reset.requested':       { ru: 'Запрос на сброс',       tone: 'info',    icon: 'lock_reset' },
  'password.reset.success':         { ru: 'Сброс пароля',          tone: 'warning', icon: 'lock_reset' },
  'short_code.failed':              { ru: 'Неверный код',          tone: 'warning', icon: 'pin' },
  'short_code.brute_force_detected':{ ru: 'Brute-force кода',      tone: 'danger',  icon: 'gpp_bad' },
  'impersonation.started':          { ru: 'Начат impersonation',   tone: 'warning', icon: 'switch_account' },
  'impersonation.stopped':          { ru: 'Завершён impersonation',tone: 'neutral', icon: 'logout' },
  'permission.denied':              { ru: 'Отказ в доступе',       tone: 'danger',  icon: 'block' },
  'webhook.signature_invalid':      { ru: 'Неверная подпись webhook', tone: 'danger', icon: 'webhook' },
  'secrets.rotated':                { ru: 'Ротация секретов',      tone: 'info',    icon: 'key' },
  'ip.blocked':                     { ru: 'IP заблокирован',       tone: 'danger',  icon: 'block' },
  'ip.unblocked':                   { ru: 'IP разблокирован',      tone: 'success', icon: 'check_circle' },
  'region.violation':               { ru: 'Регион-нарушение',      tone: 'warning', icon: 'travel_explore' },
}

function getActionMeta(action) {
  return ACTION_META[action] || { ru: action || 'Событие', tone: 'neutral', icon: 'shield' }
}

function toneClass(tone) {
  switch (tone) {
    case 'danger':  return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
    case 'warning': return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
    case 'success': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
    case 'info':    return 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300'
    default:        return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
  }
}


// ── KPI-карточка для summary ───────────────────────────────────────────────

function SummaryCard({ icon, title, value, tone = 'neutral', subtitle, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left transition-shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 rounded-2xl p-4 ${
        onClick ? 'cursor-pointer' : 'cursor-default'
      } bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800`}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className={`inline-flex items-center justify-center w-9 h-9 rounded-full ${toneClass(tone)}`}>
          <span className="material-symbols-outlined text-[20px]">{icon}</span>
        </div>
        {subtitle && (
          <span className="text-xs text-gray-500 dark:text-gray-400">{subtitle}</span>
        )}
      </div>
      <div className="text-3xl font-semibold tabular-nums text-gray-900 dark:text-white">{value}</div>
      <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">{title}</div>
    </button>
  )
}


// ── Heatmap 7×24 ────────────────────────────────────────────────────────────

function ActivityHeatmap({ data }) {
  // data: { grid: number[7][24], labels_days: string[7] }
  if (!data || !data.grid) return null
  // Максимум для нормализации шкалы.
  const max = Math.max(1, ...data.grid.flat())
  const days = data.labels_days || ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
  const hours = Array.from({ length: 24 }, (_, i) => i)

  function cellColor(v) {
    if (v === 0) return 'bg-gray-100 dark:bg-gray-800'
    const ratio = v / max
    if (ratio > 0.8) return 'bg-red-600 dark:bg-red-500'
    if (ratio > 0.6) return 'bg-red-500 dark:bg-red-400'
    if (ratio > 0.4) return 'bg-orange-400 dark:bg-orange-400'
    if (ratio > 0.2) return 'bg-amber-300 dark:bg-amber-300'
    return 'bg-amber-200 dark:bg-amber-200/80'
  }

  return (
    <div className="overflow-x-auto">
      <div className="inline-block min-w-full">
        {/* Заголовки часов */}
        <div className="grid gap-[3px]" style={{ gridTemplateColumns: 'auto repeat(24, minmax(14px, 1fr))' }}>
          <div />
          {hours.map(h => (
            <div key={h} className="text-[10px] text-gray-400 dark:text-gray-500 text-center">
              {h % 3 === 0 ? h : ''}
            </div>
          ))}
        </div>
        {/* Сетка */}
        {days.map((label, di) => (
          <div
            key={label}
            className="grid gap-[3px] mt-[3px]"
            style={{ gridTemplateColumns: 'auto repeat(24, minmax(14px, 1fr))' }}
          >
            <div className="text-[11px] pr-2 text-gray-500 dark:text-gray-400 leading-[18px]">{label}</div>
            {hours.map(h => {
              const v = data.grid[di][h]
              return (
                <div
                  key={h}
                  className={`h-[18px] rounded ${cellColor(v)} relative group`}
                  title={`${label} ${String(h).padStart(2, '0')}:00 — ${v}`}
                />
              )
            })}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-3 text-xs text-gray-500 dark:text-gray-400">
        <span>меньше</span>
        <span className="inline-block w-3 h-3 rounded bg-gray-100 dark:bg-gray-800" />
        <span className="inline-block w-3 h-3 rounded bg-amber-200" />
        <span className="inline-block w-3 h-3 rounded bg-amber-300" />
        <span className="inline-block w-3 h-3 rounded bg-orange-400" />
        <span className="inline-block w-3 h-3 rounded bg-red-500" />
        <span className="inline-block w-3 h-3 rounded bg-red-600" />
        <span>больше</span>
        <span className="ml-3">max = {max}</span>
      </div>
    </div>
  )
}


// ── Модалка для блокировки IP ──────────────────────────────────────────────

function BlockIpModal({ open, defaultIp = '', onClose, onSubmit }) {
  const [ip, setIp] = useState(defaultIp)
  const [reason, setReason] = useState('')
  const [ttlHours, setTtlHours] = useState(24)
  const [busy, setBusy] = useState(false)

  useEffect(() => { setIp(defaultIp) }, [defaultIp, open])

  if (!open) return null

  const handle = async () => {
    if (!ip.trim()) return
    setBusy(true)
    try {
      await onSubmit({ ip: ip.trim(), reason: reason.trim(), ttl_hours: Number(ttlHours) || 0 })
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Заблокировать IP">
      <div className="space-y-3 p-4 min-w-[360px]">
        <div>
          <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">IP-адрес</label>
          <input
            type="text"
            value={ip}
            onChange={e => setIp(e.target.value)}
            placeholder="1.2.3.4"
            className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">Причина</label>
          <input
            type="text"
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="например: brute-force на /auth/login"
            className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">TTL, часов (0 — бессрочно)</label>
          <input
            type="number"
            min={0}
            max={8760}
            value={ttlHours}
            onChange={e => setTtlHours(e.target.value)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex gap-2 justify-end pt-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Отмена</Button>
          <Button variant="danger" onClick={handle} disabled={busy || !ip.trim()}>
            {busy ? 'Блокировка...' : 'Заблокировать'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}


// ── Модалка детали события ─────────────────────────────────────────────────

function EventDetailsModal({ event, onClose, onBlockIp }) {
  if (!event) return null
  const meta = getActionMeta(event.action)
  const geo = [event.geo_city, event.geo_country_name || event.geo_country].filter(Boolean).join(', ')
  return (
    <Modal open={!!event} onClose={onClose} title="Детали события">
      <div className="space-y-3 p-4 min-w-[460px] max-w-[640px] text-sm">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs ${toneClass(meta.tone)}`}>
            <span className="material-symbols-outlined text-[14px]">{meta.icon}</span>
            {meta.ru}
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400">{event.action}</span>
        </div>
        <Row k="Время" v={fmtDate(event.created_at)} />
        <Row k="Актор" v={event.actor_name || (event.actor_id || '—')} />
        {event.actor_role && <Row k="Роль" v={event.actor_role} />}
        {event.tenant_slug && <Row k="Тенант" v={event.tenant_slug} />}
        {event.entity_type && (
          <Row k="Сущность" v={`${event.entity_type}${event.entity_id ? ' / ' + event.entity_id : ''}`} />
        )}
        {event.ip_address && (
          <Row
            k="IP"
            v={
              <span className="inline-flex items-center gap-2">
                <code className="font-mono">{event.ip_address}</code>
                <button
                  onClick={() => onBlockIp(event.ip_address)}
                  className="text-xs text-red-600 dark:text-red-400 hover:underline"
                  type="button"
                >
                  заблокировать
                </button>
              </span>
            }
          />
        )}
        {geo && <Row k="Геолокация" v={`${flagFromCountry(event.geo_country)} ${geo}`} />}
        {event.user_agent && <Row k="User-Agent" v={<code className="text-xs break-all">{event.user_agent}</code>} />}
        {event.comment && <Row k="Комментарий" v={event.comment} />}
        {event.before && (
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">До:</div>
            <pre className="text-xs bg-gray-100 dark:bg-gray-800 rounded p-2 max-h-40 overflow-auto">
              {JSON.stringify(event.before, null, 2)}
            </pre>
          </div>
        )}
        {event.after && (
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">После:</div>
            <pre className="text-xs bg-gray-100 dark:bg-gray-800 rounded p-2 max-h-40 overflow-auto">
              {JSON.stringify(event.after, null, 2)}
            </pre>
          </div>
        )}
        {(event.geo_lat && event.geo_lon) && (
          <div>
            <a
              href={`https://www.openstreetmap.org/?mlat=${event.geo_lat}&mlon=${event.geo_lon}#map=10/${event.geo_lat}/${event.geo_lon}`}
              target="_blank"
              rel="noreferrer noopener"
              className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline"
            >
              Открыть на карте OSM
            </a>
          </div>
        )}
      </div>
    </Modal>
  )
}

function Row({ k, v }) {
  return (
    <div className="flex gap-2">
      <div className="w-28 text-xs text-gray-500 dark:text-gray-400 shrink-0 pt-[2px]">{k}</div>
      <div className="flex-1 text-sm text-gray-900 dark:text-gray-100 break-all">{v}</div>
    </div>
  )
}


// ── Главный компонент ─────────────────────────────────────────────────────

export default function SecuritySection({ token }) {
  const { toast } = useToast()
  const [summary, setSummary] = useState(null)
  const [heatmap, setHeatmap] = useState(null)
  const [blocked, setBlocked] = useState([])
  const [audit, setAudit] = useState({ total: 0, items: [] })
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({
    action: '',         // фильтр по конкретному action (selectbox)
    search: '',
    page: 1,
    page_size: 50,
  })
  const [activeEvent, setActiveEvent] = useState(null)
  const [blockTarget, setBlockTarget] = useState(null)  // ip для предзаполнения модалки
  const pollRef = useRef(null)

  // ── Загрузка данных ──
  const fetchAll = useCallback(async () => {
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {}
      const [sumR, hmR, blR] = await Promise.all([
        api.get('/admin/security/summary', { headers }),
        api.get('/admin/security/heatmap', { headers }),
        api.get('/admin/security/blocked-ips', { headers }),
      ])
      setSummary(sumR.data)
      setHeatmap(hmR.data)
      setBlocked(blR.data?.items || [])
    } catch (e) {
      // Не показываем toast при поллинге — только в консоль
      console.warn('security fetch error', e?.response?.status, e?.message)
    }
  }, [token])

  const fetchAudit = useCallback(async () => {
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {}
      const params = { page: filters.page, page_size: filters.page_size }
      if (filters.action) params.action = filters.action
      if (filters.search) params.search = filters.search
      const r = await api.get('/admin/security/audit', { headers, params })
      setAudit(r.data)
    } catch (e) {
      console.warn('audit fetch error', e?.response?.status, e?.message)
    }
  }, [token, filters])

  useEffect(() => {
    (async () => {
      setLoading(true)
      await Promise.all([fetchAll(), fetchAudit()])
      setLoading(false)
    })()
  }, [fetchAll, fetchAudit])

  // ── Realtime polling каждые 30 сек ──
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(() => {
      fetchAll()
      fetchAudit()
    }, 30000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [fetchAll, fetchAudit])

  // ── Действия ──
  const handleBlockIp = useCallback(async ({ ip, reason, ttl_hours }) => {
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {}
      await api.post('/admin/security/block-ip', { ip, reason, ttl_hours }, { headers })
      toast({ kind: 'success', text: `IP ${ip} заблокирован` })
      await fetchAll()
    } catch (e) {
      toast({ kind: 'error', text: `Ошибка: ${e?.response?.data?.detail || e.message}` })
    }
  }, [token, fetchAll, toast])

  const handleUnblockIp = useCallback(async (ip) => {
    if (!confirm(`Снять блокировку с ${ip}?`)) return
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {}
      await api.post('/admin/security/unblock-ip', { ip }, { headers })
      toast({ kind: 'success', text: `IP ${ip} разблокирован` })
      await fetchAll()
    } catch (e) {
      toast({ kind: 'error', text: `Ошибка: ${e?.response?.data?.detail || e.message}` })
    }
  }, [token, fetchAll, toast])

  // ── Производные значения для summary cards ──
  const cards = useMemo(() => {
    const c = summary?.counts_24h || {}
    return [
      {
        title: 'Неудачных логинов / 24ч',
        value: c['auth.login_failed'] || 0,
        icon: 'lock',
        tone: (c['auth.login_failed'] || 0) > 10 ? 'warning' : 'neutral',
      },
      {
        title: 'Brute-force атак / 24ч',
        value: c['auth.brute_force_detected'] || 0,
        icon: 'gpp_bad',
        tone: (c['auth.brute_force_detected'] || 0) > 0 ? 'danger' : 'success',
      },
      {
        title: 'Отказов в доступе / 24ч',
        value: c['permission.denied'] || 0,
        icon: 'block',
        tone: (c['permission.denied'] || 0) > 5 ? 'warning' : 'neutral',
      },
      {
        title: 'Активных блокировок IP',
        value: summary?.blocked_ips_count || 0,
        icon: 'shield',
        tone: 'info',
      },
      {
        title: 'Webhook-нарушений / 24ч',
        value: c['webhook.signature_invalid'] || 0,
        icon: 'webhook',
        tone: (c['webhook.signature_invalid'] || 0) > 0 ? 'warning' : 'neutral',
      },
      {
        title: 'Регион-нарушений / 24ч',
        value: c['region.violation'] || 0,
        icon: 'travel_explore',
        tone: (c['region.violation'] || 0) > 0 ? 'warning' : 'neutral',
      },
    ]
  }, [summary])

  const actionOptions = useMemo(() => Object.entries(ACTION_META).map(([k, v]) => ({
    value: k, label: v.ru,
  })), [])

  return (
    <div className="space-y-5">
      {/* ── Summary cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {cards.map(c => (
          <SummaryCard key={c.title} {...c} />
        ))}
      </div>

      {/* ── Heatmap ── */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-semibold text-gray-900 dark:text-white">
              Активность по времени
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Security-события за {heatmap?.days || 7} дней (час × день недели)
            </div>
          </div>
          <span className="material-symbols-outlined text-gray-400 dark:text-gray-600">grid_on</span>
        </div>
        {heatmap ? <ActivityHeatmap data={heatmap} /> : <div className="text-sm text-gray-500">Загрузка…</div>}
      </Card>

      {/* ── Two-column: top threats + impersonations ── */}
      <div className="grid lg:grid-cols-2 gap-5">
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold text-gray-900 dark:text-white">
              Топ-5 атакующих IP / 24ч
            </div>
            <span className="material-symbols-outlined text-gray-400 dark:text-gray-600">cyclone</span>
          </div>
          {(summary?.top_attacking_ips?.length || 0) === 0 ? (
            <EmptyState icon="shield" title="Нет атак" subtitle="Подозрительной активности не обнаружено." />
          ) : (
            <div className="space-y-2">
              {summary.top_attacking_ips.map(item => {
                const isBlocked = blocked.some(b => b.ip === item.ip && b.is_active)
                return (
                  <div
                    key={item.ip}
                    className="flex items-center justify-between gap-2 p-2 rounded-lg bg-gray-50 dark:bg-gray-800/50"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="text-base font-mono text-gray-900 dark:text-white shrink-0">{item.ip}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                        {flagFromCountry(item.country)} {item.city || item.country_name || '—'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
                        {item.events} событий
                      </span>
                      {isBlocked ? (
                        <Button size="sm" variant="ghost" onClick={() => handleUnblockIp(item.ip)}>
                          Разблокировать
                        </Button>
                      ) : (
                        <Button size="sm" variant="danger" onClick={() => setBlockTarget(item.ip)}>
                          Заблокировать
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold text-gray-900 dark:text-white">
              Активные impersonation-сессии
            </div>
            <span className="material-symbols-outlined text-gray-400 dark:text-gray-600">switch_account</span>
          </div>
          {(summary?.active_impersonations?.length || 0) === 0 ? (
            <EmptyState icon="check_circle" title="Нет активных" subtitle="Все сессии impersonation завершены." />
          ) : (
            <div className="space-y-2">
              {summary.active_impersonations.map(s => (
                <div key={s.id} className="p-2 rounded-lg bg-gray-50 dark:bg-gray-800/50">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium text-gray-900 dark:text-white">{s.actor_name || '—'}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">{fmtRelative(s.started_at)}</div>
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    как user_id: <code className="font-mono">{s.target_user_id}</code>
                  </div>
                  {s.ip_address && (
                    <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                      <span className="font-mono">{s.ip_address}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ── Top атакованных + плохие модули ── */}
      <div className="grid lg:grid-cols-2 gap-5">
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold text-gray-900 dark:text-white">
              Топ-5 атакованных пользователей / 24ч
            </div>
            <span className="material-symbols-outlined text-gray-400 dark:text-gray-600">person_search</span>
          </div>
          {(summary?.top_attacked_users?.length || 0) === 0 ? (
            <EmptyState icon="verified_user" title="Нет данных" subtitle="Никого не атаковали." />
          ) : (
            <div className="space-y-2">
              {summary.top_attacked_users.map(u => (
                <div
                  key={u.username}
                  className="flex items-center justify-between p-2 rounded-lg bg-gray-50 dark:bg-gray-800/50"
                >
                  <div className="text-sm text-gray-900 dark:text-white font-mono">{u.username}</div>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">
                    {u.failed_logins} попыток
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold text-gray-900 dark:text-white">
              Модули с проблемами
            </div>
            <span className="material-symbols-outlined text-gray-400 dark:text-gray-600">apps</span>
          </div>
          {(summary?.bad_modules?.length || 0) === 0 ? (
            <EmptyState icon="task_alt" title="Все модули OK" subtitle="Нет модулей с ошибками или degraded." />
          ) : (
            <div className="space-y-2 max-h-72 overflow-auto">
              {summary.bad_modules.map((m, i) => (
                <div key={i} className="p-2 rounded-lg bg-gray-50 dark:bg-gray-800/50">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium text-gray-900 dark:text-white">{m.module_key}</div>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${
                      m.status === 'error' ? toneClass('danger') : toneClass('warning')
                    }`}>
                      {m.status}
                    </span>
                  </div>
                  {m.last_error_message && (
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{m.last_error_message}</div>
                  )}
                  <div className="text-xs text-gray-400 mt-1">{m.error_count_24h} ошибок / 24ч</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ── Заблокированные IP ── */}
      {blocked.length > 0 && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold text-gray-900 dark:text-white">
              Заблокированные IP
            </div>
            <Button size="sm" variant="primary" onClick={() => setBlockTarget('')}>
              <span className="material-symbols-outlined text-[16px] mr-1">add</span>
              Заблокировать
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500 dark:text-gray-400">
                <tr className="border-b border-gray-200 dark:border-gray-800">
                  <th className="text-left py-2 px-2">IP</th>
                  <th className="text-left py-2 px-2">Причина</th>
                  <th className="text-left py-2 px-2">Кем</th>
                  <th className="text-left py-2 px-2">Когда</th>
                  <th className="text-left py-2 px-2">До</th>
                  <th className="text-right py-2 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {blocked.map(b => (
                  <tr key={b.id} className="border-b border-gray-100 dark:border-gray-800/40">
                    <td className="py-2 px-2 font-mono">{b.ip}</td>
                    <td className="py-2 px-2 text-gray-600 dark:text-gray-300">{b.reason || '—'}</td>
                    <td className="py-2 px-2 text-gray-500 dark:text-gray-400">{b.blocked_by_name || '—'}</td>
                    <td className="py-2 px-2 text-xs text-gray-500 dark:text-gray-400">{fmtRelative(b.blocked_at)}</td>
                    <td className="py-2 px-2 text-xs text-gray-500 dark:text-gray-400">
                      {b.blocked_until ? fmtDate(b.blocked_until) : 'бессрочно'}
                    </td>
                    <td className="py-2 px-2 text-right">
                      <button
                        type="button"
                        onClick={() => handleUnblockIp(b.ip)}
                        className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline"
                      >
                        Разблокировать
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── Лента событий с фильтрами ── */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <div className="text-sm font-semibold text-gray-900 dark:text-white">Последние события</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Всего за период: {audit.total}. Кликните по строке для деталей.
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={filters.action}
              onChange={e => setFilters(f => ({ ...f, action: e.target.value, page: 1 }))}
              className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm"
            >
              <option value="">Все типы</option>
              {actionOptions.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <input
              type="text"
              value={filters.search}
              placeholder="Поиск по IP / имени / комментарию"
              onChange={e => setFilters(f => ({ ...f, search: e.target.value, page: 1 }))}
              className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm w-64"
            />
            <Button size="sm" variant="ghost" onClick={() => { fetchAudit(); fetchAll() }}>
              <span className="material-symbols-outlined text-[16px]">refresh</span>
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 dark:text-gray-400 sticky top-0 bg-white dark:bg-gray-900">
              <tr className="border-b border-gray-200 dark:border-gray-800">
                <th className="text-left py-2 px-2 w-40">Время</th>
                <th className="text-left py-2 px-2 w-44">Тип</th>
                <th className="text-left py-2 px-2">Актор</th>
                <th className="text-left py-2 px-2 w-40">IP</th>
                <th className="text-left py-2 px-2 w-36">Гео</th>
                <th className="text-left py-2 px-2">Комментарий</th>
              </tr>
            </thead>
            <tbody>
              {audit.items.length === 0 && (
                <tr><td colSpan={6} className="py-8">
                  <EmptyState icon="search_off" title="Нет событий" subtitle="По текущим фильтрам ничего не найдено." />
                </td></tr>
              )}
              {audit.items.map(e => {
                const meta = getActionMeta(e.action)
                return (
                  <tr
                    key={e.id}
                    onClick={() => setActiveEvent(e)}
                    className="border-b border-gray-100 dark:border-gray-800/40 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/40"
                  >
                    <td className="py-2 px-2 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap" title={fmtDate(e.created_at)}>
                      {fmtRelative(e.created_at)}
                    </td>
                    <td className="py-2 px-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${toneClass(meta.tone)}`}>
                        <span className="material-symbols-outlined text-[14px]">{meta.icon}</span>
                        {meta.ru}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-gray-900 dark:text-white">
                      {e.actor_name || <span className="text-gray-400 italic">—</span>}
                      {e.tenant_slug && (
                        <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                          ({e.tenant_slug})
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-2 font-mono text-xs text-gray-700 dark:text-gray-300">
                      {e.ip_address || '—'}
                    </td>
                    <td className="py-2 px-2 text-xs text-gray-500 dark:text-gray-400">
                      {e.geo_country ? (
                        <>
                          {flagFromCountry(e.geo_country)} {e.geo_city || e.geo_country_name || e.geo_country}
                        </>
                      ) : '—'}
                    </td>
                    <td className="py-2 px-2 text-xs text-gray-600 dark:text-gray-300 truncate max-w-[300px]">
                      {e.comment || ''}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Пагинация */}
        <div className="flex items-center justify-between mt-3 text-sm">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Страница {filters.page} из {Math.max(1, Math.ceil(audit.total / filters.page_size))}
          </div>
          <div className="flex gap-2">
            <Button
              size="sm" variant="ghost"
              disabled={filters.page <= 1}
              onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))}
            >
              <span className="material-symbols-outlined text-[16px]">chevron_left</span>
            </Button>
            <Button
              size="sm" variant="ghost"
              disabled={filters.page * filters.page_size >= audit.total}
              onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))}
            >
              <span className="material-symbols-outlined text-[16px]">chevron_right</span>
            </Button>
          </div>
        </div>
      </Card>

      {/* ── Модалки ── */}
      <BlockIpModal
        open={blockTarget !== null}
        defaultIp={blockTarget || ''}
        onClose={() => setBlockTarget(null)}
        onSubmit={handleBlockIp}
      />
      <EventDetailsModal
        event={activeEvent}
        onClose={() => setActiveEvent(null)}
        onBlockIp={(ip) => { setActiveEvent(null); setBlockTarget(ip) }}
      />
    </div>
  )
}
