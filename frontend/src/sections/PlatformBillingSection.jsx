/**
 * PlatformBillingSection — Биллинг ПЛАТФОРМЫ (для super_admin без SLUG).
 * Показывает агрегированные данные по ВСЕМ тенантам:
 *   • MRR / ARR / Active subscriptions / Overdue invoices
 *   • Tabs: Подписки / Счета / Платежи
 *
 * Адаптив: на mobile — карточки, на desktop — таблицы.
 * Стиль совместим с AdminLayout (BillingSection / BillingLedgerSection).
 */
import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import { API_BASE } from '../config'

// ── Утилиты ──────────────────────────────────────────────────────────────────

const authHeaders = (token) => ({ Authorization: `Bearer ${token}` })
const apiFetch = (method, url, token, data) =>
  axios({ method, url: `${API_BASE}${url}`, headers: authHeaders(token), data })

const fmtRub = (v) => {
  const n = Number(v || 0)
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(n)
}

const fmtDate = (v) => {
  if (!v) return '—'
  try {
    return new Date(v).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch { return v }
}

// ── Стили чипов статусов ────────────────────────────────────────────────────

const SUB_STATUS_COLORS = {
  trial:     { bg: '#fef3c7', fg: '#92400e', label: 'Trial' },
  active:    { bg: '#d1fae5', fg: '#065f46', label: 'Активна' },
  past_due:  { bg: '#fee2e2', fg: '#991b1b', label: 'Просрочена' },
  paused:    { bg: '#dbeafe', fg: '#1e40af', label: 'Пауза' },
  cancelled: { bg: '#f3f4f6', fg: '#6b7280', label: 'Отменена' },
}

const INV_STATUS_COLORS = {
  draft:   { bg: '#f3f4f6', fg: '#6b7280', label: 'Черновик' },
  sent:    { bg: '#dbeafe', fg: '#1e40af', label: 'Выставлен' },
  paid:    { bg: '#d1fae5', fg: '#065f46', label: 'Оплачен' },
  overdue: { bg: '#fee2e2', fg: '#991b1b', label: 'Просрочен' },
  void:    { bg: '#f3f4f6', fg: '#9ca3af', label: 'Аннулирован' },
}

const PAY_STATUS_COLORS = {
  pending:   { bg: '#fef3c7', fg: '#92400e', label: 'Ожидает' },
  completed: { bg: '#d1fae5', fg: '#065f46', label: 'Успешно' },
  failed:    { bg: '#fee2e2', fg: '#991b1b', label: 'Ошибка' },
  refunded:  { bg: '#e0e7ff', fg: '#3730a3', label: 'Возврат' },
}

const PLAN_LABELS = { basic: 'Базовый', professional: 'Профессиональный', enterprise: 'Корпоративный' }
const GATEWAY_LABELS = { stripe: 'Stripe', yookassa: 'ЮKassa', manual: 'Вручную' }

// ── KPI карточка ─────────────────────────────────────────────────────────────

function Kpi({ label, value, sub, color = 'teal' }) {
  const palette = {
    teal:    { bg: 'linear-gradient(135deg,rgba(20,184,166,0.12),rgba(20,184,166,0.04))', fg: '#0f766e', border: 'rgba(20,184,166,0.25)' },
    violet:  { bg: 'linear-gradient(135deg,rgba(139,92,246,0.12),rgba(139,92,246,0.04))', fg: '#6d28d9', border: 'rgba(139,92,246,0.25)' },
    emerald: { bg: 'linear-gradient(135deg,rgba(16,185,129,0.12),rgba(16,185,129,0.04))', fg: '#047857', border: 'rgba(16,185,129,0.25)' },
    amber:   { bg: 'linear-gradient(135deg,rgba(245,158,11,0.12),rgba(245,158,11,0.04))', fg: '#b45309', border: 'rgba(245,158,11,0.25)' },
  }[color]

  return (
    <div
      className="rounded-2xl p-4 md:p-5 border"
      style={{ background: palette.bg, borderColor: palette.border }}
    >
      <div className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400 font-semibold">
        {label}
      </div>
      <div className="text-2xl md:text-3xl font-extrabold mt-1.5" style={{ color: palette.fg }}>
        {value}
      </div>
      {sub && (
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{sub}</div>
      )}
    </div>
  )
}

// ── Статус-чип ──────────────────────────────────────────────────────────────

function Chip({ status, palette }) {
  const cfg = palette[status] || { bg: '#f3f4f6', fg: '#6b7280', label: status || '—' }
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold"
      style={{ background: cfg.bg, color: cfg.fg }}
    >
      {cfg.label}
    </span>
  )
}

// ── Подписки ────────────────────────────────────────────────────────────────

function SubscriptionsTab({ token, onAction }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = statusFilter ? `?status=${statusFilter}` : ''
      const r = await apiFetch('get', '/admin/billing/subscriptions' + params, token)
      setItems(r.data?.items || [])
    } catch (e) { setErr(e?.response?.data?.detail || 'Ошибка загрузки') }
    finally { setLoading(false) }
  }, [token, statusFilter])

  useEffect(() => { load() }, [load])

  const cancel = async (id) => {
    if (!confirm('Отменить подписку?')) return
    try {
      await apiFetch('post', `/admin/subscriptions/${id}/cancel`, token)
      load()
    } catch (e) { setErr(e?.response?.data?.detail || 'Ошибка') }
  }

  if (loading) {
    return <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-[#0097A7] border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4">
        {['', 'active', 'trial', 'past_due', 'cancelled'].map(s => (
          <button
            key={s || 'all'}
            onClick={() => setStatusFilter(s)}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold transition"
            style={{
              background: statusFilter === s ? '#0097A7' : '#f3f4f6',
              color: statusFilter === s ? '#fff' : '#374151',
            }}
          >
            {s ? (SUB_STATUS_COLORS[s]?.label || s) : 'Все'}
          </button>
        ))}
      </div>

      {err && <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 text-red-600 text-sm">{err}</div>}

      {items.length === 0 ? (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500">Нет подписок</div>
      ) : (
        <>
          {/* Mobile: cards */}
          <div className="md:hidden space-y-2">
            {items.map(s => (
              <div key={s.id} className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-100 dark:border-gray-700">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="font-semibold text-sm text-gray-900 dark:text-white truncate">{s.tenant_name}</div>
                  <Chip status={s.status} palette={SUB_STATUS_COLORS} />
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-gray-500 dark:text-gray-400">
                  <div><span className="text-gray-400">План:</span> {PLAN_LABELS[s.plan] || s.plan}</div>
                  <div><span className="text-gray-400">Цикл:</span> {s.billing_cycle === 'annual' ? 'Год' : 'Месяц'}</div>
                  <div><span className="text-gray-400">Сумма:</span> {fmtRub(s.amount_per_period)}</div>
                  <div><span className="text-gray-400">До:</span> {fmtDate(s.current_period_end)}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden md:block overflow-x-auto bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900/50">
                <tr>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Тенант</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">План</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Статус</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Сумма ₽/период</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Действует с</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {items.map(s => (
                  <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-gray-900/30">
                    <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-white">{s.tenant_name}</td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">{PLAN_LABELS[s.plan] || s.plan}</td>
                    <td className="px-4 py-2.5"><Chip status={s.status} palette={SUB_STATUS_COLORS} /></td>
                    <td className="px-4 py-2.5 text-right font-semibold text-gray-900 dark:text-white">{fmtRub(s.amount_per_period)}</td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">{fmtDate(s.current_period_start)}</td>
                    <td className="px-4 py-2.5">
                      {s.status !== 'cancelled' && (
                        <button onClick={() => cancel(s.id)} className="text-xs text-red-600 hover:underline">Отменить</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// ── Счета ────────────────────────────────────────────────────────────────────

function InvoicesTab({ token }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = statusFilter ? `?status=${statusFilter}` : ''
      const r = await apiFetch('get', '/admin/billing/invoices' + params, token)
      setItems(r.data?.items || [])
    } catch (e) { setErr(e?.response?.data?.detail || 'Ошибка загрузки') }
    finally { setLoading(false) }
  }, [token, statusFilter])

  useEffect(() => { load() }, [load])

  const sendLink = async (inv) => {
    try {
      const url = window.location.origin + `/${inv.tenant_slug}/admin?invoice=${inv.id}`
      await navigator.clipboard?.writeText(url)
      alert('Ссылка на оплату скопирована:\n' + url)
    } catch { alert('Не удалось скопировать ссылку') }
  }

  if (loading) {
    return <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-[#0097A7] border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4">
        {['', 'sent', 'paid', 'overdue', 'draft'].map(s => (
          <button
            key={s || 'all'}
            onClick={() => setStatusFilter(s)}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold transition"
            style={{
              background: statusFilter === s ? '#0097A7' : '#f3f4f6',
              color: statusFilter === s ? '#fff' : '#374151',
            }}
          >
            {s ? (INV_STATUS_COLORS[s]?.label || s) : 'Все'}
          </button>
        ))}
      </div>

      {err && <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 text-red-600 text-sm">{err}</div>}

      {items.length === 0 ? (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500">Нет счетов</div>
      ) : (
        <>
          {/* Mobile: cards */}
          <div className="md:hidden space-y-2">
            {items.map(inv => (
              <div key={inv.id} className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-100 dark:border-gray-700">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">№ {inv.invoice_number}</div>
                    <div className="font-semibold text-sm text-gray-900 dark:text-white">{inv.tenant_name}</div>
                  </div>
                  <Chip status={inv.status} palette={INV_STATUS_COLORS} />
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-gray-500 dark:text-gray-400">
                  <div><span className="text-gray-400">План:</span> {PLAN_LABELS[inv.plan] || inv.plan || '—'}</div>
                  <div><span className="text-gray-400">Сумма:</span> <b>{fmtRub(inv.amount)}</b></div>
                  <div><span className="text-gray-400">Создан:</span> {fmtDate(inv.created_at)}</div>
                  <div><span className="text-gray-400">Срок:</span> {fmtDate(inv.due_date)}</div>
                </div>
                {inv.status !== 'paid' && (
                  <button onClick={() => sendLink(inv)} className="mt-3 w-full text-xs px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 font-semibold">
                    Скопировать ссылку на оплату
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden md:block overflow-x-auto bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900/50">
                <tr>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">№</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Тенант</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">План</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase">Сумма</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Статус</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Создан</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Срок</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {items.map(inv => (
                  <tr key={inv.id} className="hover:bg-gray-50 dark:hover:bg-gray-900/30">
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{inv.invoice_number}</td>
                    <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-white">{inv.tenant_name}</td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">{PLAN_LABELS[inv.plan] || inv.plan || '—'}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-gray-900 dark:text-white">{fmtRub(inv.amount)}</td>
                    <td className="px-4 py-2.5"><Chip status={inv.status} palette={INV_STATUS_COLORS} /></td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">{fmtDate(inv.created_at)}</td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">{fmtDate(inv.due_date)}</td>
                    <td className="px-4 py-2.5">
                      {inv.status !== 'paid' && (
                        <button onClick={() => sendLink(inv)} className="text-xs text-blue-600 hover:underline">
                          Ссылка на оплату
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// ── Платежи ──────────────────────────────────────────────────────────────────

function PaymentsTab({ token }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  useEffect(() => {
    (async () => {
      setLoading(true)
      try {
        const r = await apiFetch('get', '/admin/billing/payments', token)
        setItems(r.data?.items || [])
      } catch (e) { setErr(e?.response?.data?.detail || 'Ошибка загрузки') }
      finally { setLoading(false) }
    })()
  }, [token])

  if (loading) {
    return <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-[#0097A7] border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div>
      {err && <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 text-red-600 text-sm">{err}</div>}

      {items.length === 0 ? (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500">Нет платежей</div>
      ) : (
        <>
          {/* Mobile: cards */}
          <div className="md:hidden space-y-2">
            {items.map(p => (
              <div key={p.id} className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-100 dark:border-gray-700">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">{fmtDate(p.created_at)}</div>
                    <div className="font-semibold text-sm text-gray-900 dark:text-white">{p.tenant_name}</div>
                  </div>
                  <Chip status={p.status} palette={PAY_STATUS_COLORS} />
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-gray-500 dark:text-gray-400">
                  <div><span className="text-gray-400">Сумма:</span> <b>{fmtRub(p.amount)}</b></div>
                  <div><span className="text-gray-400">Шлюз:</span> {GATEWAY_LABELS[p.gateway] || p.gateway || '—'}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden md:block overflow-x-auto bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900/50">
                <tr>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Дата</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Тенант</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase">Сумма</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Способ</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Статус</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {items.map(p => (
                  <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-900/30">
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">{fmtDate(p.created_at)}</td>
                    <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-white">{p.tenant_name}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-gray-900 dark:text-white">{fmtRub(p.amount)}</td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">{GATEWAY_LABELS[p.gateway] || p.gateway || '—'}</td>
                    <td className="px-4 py-2.5"><Chip status={p.status} palette={PAY_STATUS_COLORS} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// ── Главный компонент ────────────────────────────────────────────────────────

export default function PlatformBillingSection({ token }) {
  const [overview, setOverview] = useState(null)
  const [tab, setTab] = useState('subscriptions')
  const [err, setErr] = useState('')

  useEffect(() => {
    (async () => {
      try {
        const r = await apiFetch('get', '/admin/billing/overview', token)
        setOverview(r.data)
      } catch (e) { setErr(e?.response?.data?.detail || 'Ошибка загрузки сводки') }
    })()
  }, [token])

  const TABS = [
    { key: 'subscriptions', label: 'Подписки', icon: 'card_membership' },
    { key: 'invoices',      label: 'Счета',    icon: 'receipt_long' },
    { key: 'payments',      label: 'Платежи',  icon: 'payments' },
  ]

  return (
    <div className="space-y-6">
      {/* Заголовок */}
      <div>
        <h2 className="text-2xl font-extrabold font-headline text-gray-900 dark:text-white">Биллинг платформы</h2>
        <p className="text-sm text-gray-500 mt-0.5">Сводка по всем тенантам — MRR, ARR, подписки, счета, платежи</p>
      </div>

      {err && <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-600 text-sm">{err}</div>}

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi
          label="MRR"
          value={overview ? fmtRub(overview.mrr) : '…'}
          sub={overview ? `ARPU ${fmtRub(overview.arpu)}` : ''}
          color="teal"
        />
        <Kpi
          label="ARR"
          value={overview ? fmtRub(overview.arr) : '…'}
          sub={overview ? `Churn ${overview.churn_rate}%` : ''}
          color="violet"
        />
        <Kpi
          label="Активных подписок"
          value={overview?.active_subscriptions ?? '…'}
          sub={overview ? `Оплачено счетов: ${overview.paid_invoices}/${overview.total_invoices}` : ''}
          color="emerald"
        />
        <Kpi
          label="Просрочены"
          value={overview?.overdue_invoices ?? '…'}
          sub={overview ? `Отмен за 30д: ${overview.cancelled_30d}` : ''}
          color="amber"
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition whitespace-nowrap"
            style={{
              background: tab === t.key ? '#fff' : 'transparent',
              color: tab === t.key ? '#0097A7' : '#6b7280',
              boxShadow: tab === t.key ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
            }}
          >
            <span className="material-symbols-outlined text-[18px]">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* Контент */}
      <div>
        {tab === 'subscriptions' && <SubscriptionsTab token={token} />}
        {tab === 'invoices' && <InvoicesTab token={token} />}
        {tab === 'payments' && <PaymentsTab token={token} />}
      </div>
    </div>
  )
}
