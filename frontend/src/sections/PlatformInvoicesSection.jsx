/**
 * PlatformInvoicesSection — счета от платформы для владельца франшизы.
 * Показывает:
 *  - Тарифную политику (fee/бонус, минимум бонуса, период) — read-only
 *  - Сводку текущего периода (накоплено fee, кол-во бонусов, до выставления)
 *  - Список выставленных счетов (pending/paid)
 */
import { useEffect, useState } from 'react'
import api from '../api'

const STATUS_LABEL = {
  pending: { text: 'К оплате', cls: 'bg-amber-100 text-amber-700' },
  paid:    { text: 'Оплачен',  cls: 'bg-emerald-100 text-emerald-700' },
  cancelled:{ text: 'Отменён', cls: 'bg-gray-100 text-gray-500' },
}

function fmt(n) {
  return Number(n || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })
}
function fmtDate(s) {
  return s ? new Date(s).toLocaleDateString('ru-RU') : '—'
}

export default function PlatformInvoicesSection({ adminToken }) {
  const [summary, setSummary]   = useState(null)
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      api.get('/franchise-owner/billing/summary')
        .then(r => r.data).catch(() => { setError('Доступ только владельцу франшизы'); return null }),
      api.get('/franchise-owner/billing/invoices')
        .then(r => r.data || []).catch(() => []),
    ]).then(([s, inv]) => {
      setSummary(s)
      setInvoices(inv)
    }).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="p-6 text-center text-gray-500">Загрузка…</div>
  if (error) return <div className="p-6 text-center text-rose-600 text-sm">{error}</div>
  if (!summary) return null

  const fr = summary.franchise || {}
  const next_invoice_in = (() => {
    if (!summary.period_start) return null
    const start = new Date(summary.period_start).getTime()
    const days = (fr.billing_period_days || 30)
    const end = start + days * 86400000
    const remaining = Math.max(0, Math.ceil((end - Date.now()) / 86400000))
    return remaining
  })()

  return (
    <div className="px-4 pb-24 max-w-4xl mx-auto">
      <h2 className="text-2xl font-black mb-1">Счета от платформы</h2>
      <p className="text-sm text-gray-500 mb-5">
        Платформа берёт фиксированную плату с каждого выплаченного бонуса по всем тенантам вашей франшизы.
      </p>

      {/* Тарифная политика */}
      <div className="bg-white rounded-2xl p-5 border border-gray-100 mb-4">
        <div className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Тариф</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Metric label="С каждого бонуса" value={`${fmt(fr.platform_fee_per_bonus)} ₽`} />
          <Metric label="Мин. бонус" value={`${fmt(fr.min_bonus_amount)} ₽`} />
          <Metric label="Период" value={`${fr.billing_period_days || 30} дн`} />
          <Metric label="Возврат при отмене" value={fr.refund_fee_on_cancel ? 'Да' : 'Нет'} />
        </div>
        <div className="mt-3 text-xs text-gray-400">
          Изменить тариф может только администратор платформы.
        </div>
      </div>

      {/* Текущий период */}
      <div className="rounded-2xl p-5 mb-4"
        style={{ background:'linear-gradient(135deg,#7c3aed 0%,#1a1a2e 100%)', color:'white' }}>
        <div className="text-xs font-bold uppercase tracking-wider opacity-70 mb-2">Текущий период</div>
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-4xl font-black">{fmt(summary.current_period_amount)}</span>
          <span className="text-lg opacity-80">₽</span>
        </div>
        <div className="text-sm opacity-80 mb-3">
          {summary.current_period_count} бонусов · с {fmtDate(summary.period_start)}
        </div>
        {next_invoice_in !== null && (
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/15 text-xs font-semibold">
            <span className="material-symbols-outlined" style={{ fontSize:'16px' }}>schedule</span>
            До выставления счёта: {next_invoice_in} дн.
          </div>
        )}
      </div>

      {/* Pending */}
      {summary.pending_invoices_total > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-4 flex items-center gap-3">
          <span className="material-symbols-outlined text-amber-600">pending_actions</span>
          <div>
            <div className="font-bold text-amber-900">К оплате: {fmt(summary.pending_invoices_total)} ₽</div>
            <div className="text-xs text-amber-800">Сумма по неоплаченным счетам</div>
          </div>
        </div>
      )}

      {/* Список счетов */}
      <div className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2 mt-6">Счета</div>
      {invoices.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">Счетов пока нет</div>
      ) : (
        <div className="space-y-2">
          {invoices.map(inv => {
            const st = STATUS_LABEL[inv.status] || STATUS_LABEL.pending
            return (
              <div key={inv.id} className="bg-white rounded-2xl p-4 border border-gray-100">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-mono text-xs text-gray-500">{inv.number || inv.id.slice(0, 8)}</div>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${st.cls}`}>{st.text}</span>
                </div>
                <div className="flex items-baseline gap-1 mb-2">
                  <span className="text-2xl font-black">{fmt(inv.total_amount)}</span>
                  <span className="text-sm text-gray-500">₽</span>
                  <span className="text-xs text-gray-400 ml-2">· {inv.bonuses_count} бонусов</span>
                </div>
                <div className="text-xs text-gray-500">
                  {fmtDate(inv.period_start)} — {fmtDate(inv.period_end)}
                  {inv.due_date && <span className="ml-2">· до {fmtDate(inv.due_date)}</span>}
                  {inv.paid_at && <span className="ml-2 text-emerald-600">· оплачен {fmtDate(inv.paid_at)}</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Metric({ label, value }) {
  return (
    <div>
      <div className="text-xs text-gray-500 mb-0.5">{label}</div>
      <div className="text-base font-bold text-gray-900">{value}</div>
    </div>
  )
}
