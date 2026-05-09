/**
 * ========================================
 * БЛОК: ManagerFinance — финансовый раздел кабинета менеджера (3 таба)
 * ========================================
 * - Платформе       — счета от платформы текущей клинике (FranchiseInvoice)
 * - Клиникам сети   — InterClinicInvoice (входящие/исходящие)
 * - Сотрудникам     — агрегация бонусов
 *
 * Бизнес-логика:
 *   GET /manager/finance/platform
 *   GET /manager/finance/cross-clinic
 *   GET /manager/finance/bonuses
 *   POST /manager/finance/invoices/{id}/mark-paid?invoice_kind=franchise|cross_clinic
 * ========================================
 */
import { useEffect, useState, useMemo } from 'react'
import api from '../api'
import { Card, Button, EmptyState, useToast } from '../design'
import ManagerShell from './_ManagerShell'

const TABS = [
  { key: 'platform',     label: 'Платформе',     icon: 'apartment' },
  { key: 'crossClinic',  label: 'Клиникам сети', icon: 'compare_arrows' },
  { key: 'bonuses',      label: 'Сотрудникам',   icon: 'group' },
]

const STATUS_BADGE = {
  pending:   { bg: 'oklch(0.95 0.05 80)',  fg: 'oklch(0.4 0.15 80)',  label: 'Ожидает' },
  draft:     { bg: 'oklch(0.95 0.02 280)', fg: 'oklch(0.4 0.05 280)', label: 'Черновик' },
  sent:      { bg: 'oklch(0.95 0.05 80)',  fg: 'oklch(0.4 0.15 80)',  label: 'Выставлен' },
  issued:    { bg: 'oklch(0.95 0.05 80)',  fg: 'oklch(0.4 0.15 80)',  label: 'Выставлен' },
  paid:      { bg: 'oklch(0.95 0.06 150)', fg: 'oklch(0.35 0.15 150)', label: 'Оплачен' },
  cancelled: { bg: 'oklch(0.95 0.02 0)',   fg: 'oklch(0.5 0.05 0)',   label: 'Отменён' },
  overdue:   { bg: 'oklch(0.95 0.06 25)',  fg: 'oklch(0.45 0.15 25)', label: 'Просрочен' },
}

function StatusBadge({ status, isOverdue }) {
  const key = isOverdue ? 'overdue' : (status || '').toLowerCase()
  const cfg = STATUS_BADGE[key] || { bg: 'var(--bg-1)', fg: 'var(--fg-muted)', label: status }
  return (
    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
      style={{ background: cfg.bg, color: cfg.fg }}>
      {cfg.label}
    </span>
  )
}

function formatRub(v) {
  return Number(v || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽'
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// ─── Таб 1: Платформе (FranchiseInvoice) ───────────────────────────────────
function PlatformTab({ onPaid }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const { toast } = useToast()
  const [working, setWorking] = useState(null) // id текущей оплаты

  const load = async () => {
    setLoading(true)
    try {
      const r = await api.get('/manager/finance/platform')
      setItems(Array.isArray(r.data) ? r.data : [])
    } catch (e) {
      toast(e?.response?.data?.detail || 'Ошибка загрузки счетов', 'error')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const handlePay = async (id) => {
    if (!confirm('Пометить счёт оплаченным?')) return
    setWorking(id)
    try {
      await api.post(`/manager/finance/invoices/${id}/mark-paid?invoice_kind=franchise`)
      toast('Счёт помечен оплаченным', 'success')
      onPaid?.()
      await load()
    } catch (e) {
      toast(e?.response?.data?.detail || 'Не удалось пометить счёт', 'error')
    } finally {
      setWorking(null)
    }
  }

  const totalPending = useMemo(
    () => items.filter(i => i.status === 'pending').reduce((s, i) => s + Number(i.total_amount || 0), 0),
    [items]
  )
  const totalOverdue = useMemo(
    () => items.filter(i => i.is_overdue).reduce((s, i) => s + Number(i.total_amount || 0), 0),
    [items]
  )

  if (loading) return <Card><div className="py-12 text-center" style={{ color: 'var(--fg-muted)' }}>Загрузка…</div></Card>
  if (!items.length) return <EmptyState icon={<span className="material-symbols-outlined" style={{ fontSize: 28 }}>receipt_long</span>} title="Счетов пока нет" message="От платформы ещё не пришло счетов." />

  return (
    <>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <Card>
          <Card.Subtitle>К оплате</Card.Subtitle>
          <p className="text-2xl font-bold mt-1" style={{ color: 'var(--fg)' }}>{formatRub(totalPending)}</p>
        </Card>
        <Card style={{ background: totalOverdue > 0 ? 'var(--bad-soft)' : undefined }}>
          <Card.Subtitle>Просрочено</Card.Subtitle>
          <p className="text-2xl font-bold mt-1" style={{ color: totalOverdue > 0 ? 'var(--bad)' : 'var(--fg)' }}>
            {formatRub(totalOverdue)}
          </p>
        </Card>
      </div>

      <Card padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead style={{ background: 'var(--bg-1)' }}>
              <tr style={{ color: 'var(--fg-muted)' }}>
                <th className="text-left p-3 font-semibold">Номер</th>
                <th className="text-left p-3 font-semibold">Период</th>
                <th className="text-right p-3 font-semibold">Бонусов</th>
                <th className="text-right p-3 font-semibold">Сумма</th>
                <th className="text-left p-3 font-semibold">Срок</th>
                <th className="text-left p-3 font-semibold">Статус</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {items.map(i => (
                <tr key={i.id} style={{ borderTop: '1px solid var(--line)' }}>
                  <td className="p-3 font-mono text-xs">{i.number || '—'}</td>
                  <td className="p-3 text-xs">{formatDate(i.period_start)} — {formatDate(i.period_end)}</td>
                  <td className="p-3 text-right">{i.bonuses_count}</td>
                  <td className="p-3 text-right font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatRub(i.total_amount)}
                  </td>
                  <td className="p-3 text-xs">{formatDate(i.due_date)}</td>
                  <td className="p-3"><StatusBadge status={i.status} isOverdue={i.is_overdue} /></td>
                  <td className="p-3 text-right">
                    {i.status === 'pending' && (
                      <Button size="sm" onClick={() => handlePay(i.id)} disabled={working === i.id}>
                        {working === i.id ? '…' : 'Оплатить'}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}

// ─── Таб 2: Клиникам сети (InterClinicInvoice) ─────────────────────────────
function CrossClinicTab() {
  const [data, setData] = useState({ items: [], summary: { incoming_total: 0, outgoing_total: 0, incoming_unpaid: 0, outgoing_unpaid: 0, net_balance: 0 } })
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all') // all | incoming | outgoing
  const { toast } = useToast()
  const [working, setWorking] = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const params = filter === 'all' ? {} : { direction: filter }
      const r = await api.get('/manager/finance/cross-clinic', { params })
      setData(r.data || { items: [], summary: {} })
    } catch (e) {
      toast(e?.response?.data?.detail || 'Ошибка загрузки', 'error')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [filter])

  const handlePay = async (id) => {
    if (!confirm('Пометить счёт оплаченным?')) return
    setWorking(id)
    try {
      await api.post(`/manager/finance/invoices/${id}/mark-paid?invoice_kind=cross_clinic`)
      toast('Счёт помечен оплаченным', 'success')
      await load()
    } catch (e) {
      toast(e?.response?.data?.detail || 'Не удалось пометить счёт', 'error')
    } finally {
      setWorking(null)
    }
  }

  const s = data.summary || {}

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Card>
          <Card.Subtitle>Получим</Card.Subtitle>
          <p className="text-xl font-bold mt-1" style={{ color: 'var(--good)' }}>{formatRub(s.outgoing_total)}</p>
          <p className="text-xs mt-1" style={{ color: 'var(--fg-muted)' }}>не оплачено: {formatRub(s.outgoing_unpaid)}</p>
        </Card>
        <Card>
          <Card.Subtitle>Должны</Card.Subtitle>
          <p className="text-xl font-bold mt-1" style={{ color: 'var(--bad)' }}>{formatRub(s.incoming_total)}</p>
          <p className="text-xs mt-1" style={{ color: 'var(--fg-muted)' }}>не оплачено: {formatRub(s.incoming_unpaid)}</p>
        </Card>
        <Card className="sm:col-span-2">
          <Card.Subtitle>Чистый баланс</Card.Subtitle>
          <p className="text-2xl font-bold mt-1" style={{ color: (s.net_balance || 0) >= 0 ? 'var(--good)' : 'var(--bad)' }}>
            {(s.net_balance || 0) >= 0 ? '+' : ''}{formatRub(s.net_balance)}
          </p>
        </Card>
      </div>

      <div className="flex gap-2 mb-3">
        {[
          { key: 'all', label: 'Все' },
          { key: 'incoming', label: 'Входящие (мы платим)' },
          { key: 'outgoing', label: 'Исходящие (нам платят)' },
        ].map(b => (
          <button key={b.key} type="button" onClick={() => setFilter(b.key)}
            className="text-xs font-semibold px-3 py-1.5 rounded-full transition"
            style={{
              background: filter === b.key ? 'var(--accent-soft)' : 'var(--bg-1)',
              color: filter === b.key ? 'var(--accent)' : 'var(--fg-muted)',
              border: '1px solid ' + (filter === b.key ? 'var(--accent)' : 'var(--border)'),
            }}>
            {b.label}
          </button>
        ))}
      </div>

      {loading ? <Card><div className="py-12 text-center" style={{ color: 'var(--fg-muted)' }}>Загрузка…</div></Card>
        : !data.items.length ? <EmptyState icon={<span className="material-symbols-outlined" style={{ fontSize: 28 }}>compare_arrows</span>} title="Счетов нет" message="Между клиниками сети пока нет финансовых документов." />
        : (
          <Card padded={false}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead style={{ background: 'var(--bg-1)' }}>
                  <tr style={{ color: 'var(--fg-muted)' }}>
                    <th className="text-left p-3 font-semibold">№</th>
                    <th className="text-left p-3 font-semibold">Направление</th>
                    <th className="text-left p-3 font-semibold">От → К</th>
                    <th className="text-right p-3 font-semibold">Сумма</th>
                    <th className="text-left p-3 font-semibold">Срок</th>
                    <th className="text-left p-3 font-semibold">Статус</th>
                    <th className="p-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map(i => (
                    <tr key={i.id} style={{ borderTop: '1px solid var(--line)' }}>
                      <td className="p-3 font-mono text-xs">{i.invoice_number}</td>
                      <td className="p-3">
                        <span className="text-xs px-2 py-0.5 rounded-full"
                          style={{ background: i.is_incoming ? 'var(--bad-soft)' : 'var(--good-soft)',
                                   color: i.is_incoming ? 'var(--bad)' : 'var(--good)' }}>
                          {i.is_incoming ? 'Платим' : 'Получаем'}
                        </span>
                      </td>
                      <td className="p-3 text-xs" style={{ color: 'var(--fg-muted)' }}>
                        {i.issuer_name || '—'} → {i.recipient_name || '—'}
                      </td>
                      <td className="p-3 text-right font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {formatRub(i.amount)}
                      </td>
                      <td className="p-3 text-xs">{formatDate(i.due_date)}</td>
                      <td className="p-3"><StatusBadge status={i.status} /></td>
                      <td className="p-3 text-right">
                        {i.is_incoming && i.status !== 'paid' && i.status !== 'cancelled' && (
                          <Button size="sm" onClick={() => handlePay(i.id)} disabled={working === i.id}>
                            {working === i.id ? '…' : 'Оплатить'}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
    </>
  )
}

// ─── Таб 3: Сотрудникам (Bonus aggregation) ────────────────────────────────
function BonusesTab() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const { toast } = useToast()

  const load = async () => {
    setLoading(true)
    try {
      const r = await api.get('/manager/finance/bonuses')
      setItems(Array.isArray(r.data) ? r.data : [])
    } catch (e) {
      toast(e?.response?.data?.detail || 'Ошибка загрузки', 'error')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const totalPending = useMemo(() => items.reduce((s, i) => s + Number(i.pending_amount || 0), 0), [items])
  const totalPaid = useMemo(() => items.reduce((s, i) => s + Number(i.paid_amount || 0), 0), [items])

  if (loading) return <Card><div className="py-12 text-center" style={{ color: 'var(--fg-muted)' }}>Загрузка…</div></Card>
  if (!items.length) return <EmptyState icon={<span className="material-symbols-outlined" style={{ fontSize: 28 }}>group</span>} title="Бонусов пока нет" />

  return (
    <>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <Card>
          <Card.Subtitle>К выплате</Card.Subtitle>
          <p className="text-2xl font-bold mt-1" style={{ color: 'var(--accent)' }}>{formatRub(totalPending)}</p>
        </Card>
        <Card>
          <Card.Subtitle>Выплачено</Card.Subtitle>
          <p className="text-2xl font-bold mt-1" style={{ color: 'var(--good)' }}>{formatRub(totalPaid)}</p>
        </Card>
      </div>

      <Card padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead style={{ background: 'var(--bg-1)' }}>
              <tr style={{ color: 'var(--fg-muted)' }}>
                <th className="text-left p-3 font-semibold">Сотрудник</th>
                <th className="text-left p-3 font-semibold">Роль</th>
                <th className="text-right p-3 font-semibold">Бонусов</th>
                <th className="text-right p-3 font-semibold">К выплате</th>
                <th className="text-right p-3 font-semibold">Выплачено</th>
                <th className="text-right p-3 font-semibold">Всего</th>
              </tr>
            </thead>
            <tbody>
              {items.map(r => (
                <tr key={r.user_id} style={{ borderTop: '1px solid var(--line)' }}>
                  <td className="p-3 font-medium">{r.full_name}</td>
                  <td className="p-3 text-xs" style={{ color: 'var(--fg-muted)' }}>{r.role}</td>
                  <td className="p-3 text-right">{r.bonus_count}</td>
                  <td className="p-3 text-right font-semibold" style={{ color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>
                    {formatRub(r.pending_amount)}
                  </td>
                  <td className="p-3 text-right" style={{ color: 'var(--good)', fontVariantNumeric: 'tabular-nums' }}>
                    {formatRub(r.paid_amount)}
                  </td>
                  <td className="p-3 text-right font-bold" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatRub(r.total_amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}

// ─── Главный компонент ────────────────────────────────────────────────────
export default function ManagerFinance() {
  const [tab, setTab] = useState('platform')

  return (
    <ManagerShell
      active="finance"
      title="Финансы"
      subtitle="Расчёты с платформой, сетью и сотрудниками"
      icon="account_balance"
    >
      <div className="flex gap-1 mb-4 overflow-x-auto" style={{ borderBottom: '1px solid var(--line)' }}>
        {TABS.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className="text-sm font-semibold px-4 py-2.5 transition flex items-center gap-2 whitespace-nowrap"
            style={{
              borderBottom: tab === t.key ? '2px solid var(--accent)' : '2px solid transparent',
              color: tab === t.key ? 'var(--accent)' : 'var(--fg-muted)',
              marginBottom: -1,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'platform'    && <PlatformTab />}
      {tab === 'crossClinic' && <CrossClinicTab />}
      {tab === 'bonuses'     && <BonusesTab />}
    </ManagerShell>
  )
}
