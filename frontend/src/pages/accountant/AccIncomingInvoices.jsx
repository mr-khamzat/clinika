/**
 * AccIncomingInvoices — входящие межклиничные счета в кабинете бухгалтера.
 *
 * Показывает только счета, согласованные руководителем (status='approved' или 'paid').
 * Бухгалтер видит подпись согласовавшего (ФИО, дата) и оплачивает кнопкой.
 *
 * Не показывает pending_approval — пока руководитель не согласовал, бухгалтер
 * не видит счёт.
 */
import { useEffect, useMemo, useState } from 'react'
import AccountantShell from '../_AccountantShell'
import { Card, Button, EmptyState } from '../../design'
import api from '../../api'

const STATUS_META = {
  approved: { label: 'К оплате',   color: '#047857', bg: 'rgba(5, 150, 105, 0.10)' },
  paid:     { label: 'Оплачен',    color: '#1d4ed8', bg: 'rgba(37, 99, 235, 0.10)' },
}

function fmtMoney(v) {
  if (v == null) return '—'
  return Number(v).toLocaleString('ru-RU') + ' ₽'
}
function fmtDate(s) {
  if (!s) return '—'
  try { return new Date(s).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) }
  catch { return s }
}

export default function AccIncomingInvoices() {
  const [tab, setTab] = useState('approved')  // approved | paid | all
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [paying, setPaying] = useState(null)

  const load = async () => {
    setLoading(true); setError('')
    try {
      const statusQ = tab === 'approved' ? 'approved' : tab === 'paid' ? 'paid' : ''
      const url = '/clinic-invoices/incoming' + (statusQ ? `?status=${statusQ}` : '')
      const r = await api.get(url)
      // Для tab=all отфильтруем legacy/pending — бухгалтер видит только approved+paid
      const data = Array.isArray(r.data) ? r.data : []
      const filtered = tab === 'all'
        ? data.filter(i => ['approved', 'paid'].includes(i.status))
        : data
      setItems(filtered)
    } catch (e) {
      setError(e?.response?.data?.detail || 'Не удалось загрузить счета')
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [tab])

  const pay = async (inv) => {
    if (!window.confirm(`Отметить счёт ${inv.invoice_number} на ${fmtMoney(inv.amount)} как оплаченный?`)) return
    setPaying(inv.id)
    try {
      await api.patch(`/clinic-invoices/${inv.id}/pay`)
      await load()
    } catch (e) {
      window.alert(e?.response?.data?.detail || 'Не удалось отметить оплату')
    } finally { setPaying(null) }
  }

  const stats = useMemo(() => {
    const approvedSum = items
      .filter(i => i.status === 'approved')
      .reduce((s, i) => s + Number(i.amount || 0), 0)
    return { count: items.length, approvedSum }
  }, [items])

  return (
    <AccountantShell active="incoming">
      <div>
        <div style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--fg)', marginBottom: 4 }}>
            Счета от клиник сети
          </h2>
          <p style={{ fontSize: 13, color: 'var(--fg-3)' }}>
            Согласованные руководителем счета за бонусы/услуги от других клиник.
            До согласования счета видны только в кабинете руководителя.
          </p>
        </div>

        <div style={{
          display: 'flex', gap: 4, marginBottom: 16,
          padding: 3, background: 'var(--bg-1)', borderRadius: 10,
          border: '1px solid var(--border)', flexWrap: 'wrap',
        }}>
          {[
            { k: 'approved', label: 'К оплате' },
            { k: 'paid',     label: 'Оплачены' },
            { k: 'all',      label: 'Все' },
          ].map(t => (
            <button key={t.k} onClick={() => setTab(t.k)} style={{
              flex: '1 1 auto', minWidth: 110, padding: '8px 14px',
              borderRadius: 8, border: 0, cursor: 'pointer',
              background: tab === t.k ? 'var(--surface)' : 'transparent',
              color: tab === t.k ? 'var(--fg)' : 'var(--fg-3)',
              fontSize: 13, fontWeight: 600,
              boxShadow: tab === t.k ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
            }}>{t.label}</button>
          ))}
        </div>

        {error && (
          <div style={{
            background: 'var(--bad-soft)', border: '1px solid var(--bad-soft)',
            color: 'var(--bad)', padding: 12, borderRadius: 10, marginBottom: 12, fontSize: 13,
          }}>{error}</div>
        )}

        {loading ? (
          <Card><div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-3)' }}>Загрузка…</div></Card>
        ) : items.length === 0 ? (
          <Card>
            <EmptyState
              icon="inbox"
              title="Нет счетов"
              text={tab === 'approved' ? 'Все согласованные счета уже оплачены.' : 'В этой вкладке пока пусто.'}
            />
          </Card>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {items.map(inv => {
              const meta = STATUS_META[inv.status] || { label: inv.status, color: '#475569', bg: 'rgba(71,85,105,0.10)' }
              const canPay = inv.status === 'approved'
              return (
                <Card key={inv.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 0, flex: '1 1 320px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg)' }}>
                          № {inv.invoice_number}
                        </span>
                        <span style={{
                          fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
                          background: meta.bg, color: meta.color, textTransform: 'uppercase', letterSpacing: '0.04em',
                        }}>{meta.label}</span>
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--fg-2)', marginBottom: 4 }}>
                        {inv.description || '—'}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--fg-3)', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                        <span>Создан: {fmtDate(inv.created_at)}</span>
                        {inv.due_date && <span>До: {inv.due_date}</span>}
                        {inv.paid_at && <span>Оплачен: {fmtDate(inv.paid_at)}</span>}
                      </div>

                      {/* Подпись согласовавшего — всегда видна, это "договорной артефакт" */}
                      {inv.approved_at && (
                        <div style={{
                          marginTop: 8, padding: '8px 10px',
                          background: 'var(--good-soft, rgba(5,150,105,0.08))',
                          border: '1px solid rgba(5,150,105,0.18)',
                          borderRadius: 8, fontSize: 12, color: 'var(--good, #047857)',
                        }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 14, verticalAlign: 'middle', marginRight: 4 }}>verified</span>
                          Согласовано: <b>{inv.approved_by_name || '—'}</b>
                          {inv.approved_by_role && <span style={{ opacity: 0.7 }}> · {inv.approved_by_role}</span>}
                          {' · '}<span style={{ opacity: 0.75 }}>{fmtDate(inv.approved_at)}</span>
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
                      <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--fg)' }}>
                        {fmtMoney(inv.amount)}
                      </div>
                      {canPay && (
                        <Button
                          variant="primary" size="sm"
                          onClick={() => pay(inv)}
                          disabled={paying === inv.id}
                        >
                          {paying === inv.id ? '…' : 'Отметить оплаченным'}
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        )}

        {tab === 'approved' && items.length > 0 && (
          <div style={{
            marginTop: 14, padding: '10px 14px',
            background: 'var(--bg-1)', borderRadius: 10, border: '1px solid var(--border)',
            fontSize: 13, color: 'var(--fg-2)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
          }}>
            <span>К оплате: <b>{stats.count}</b> счетов</span>
            <span>Общая сумма: <b>{fmtMoney(stats.approvedSum)}</b></span>
          </div>
        )}
      </div>
    </AccountantShell>
  )
}
