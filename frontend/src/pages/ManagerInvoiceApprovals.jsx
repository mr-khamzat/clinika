/**
 * ManagerInvoiceApprovals — страница согласования межклиничных счетов.
 *
 * Сюда падают счета, которые другие клиники выставили нашей клинике
 * за бонусы/услуги (status='pending_approval'). Руководитель проверяет
 * и нажимает Согласовать → счёт переходит в кабинет бухгалтера со
 * snapshot'ом ФИО руководителя для подписи. Или Отклонить → с причиной.
 */
import { useEffect, useMemo, useState } from 'react'
import ManagerShell from './_ManagerShell'
import { Card, Button, Chip, EmptyState } from '../design'
import api from '../api'

const STATUS_META = {
  pending_approval: { label: 'На согласование', color: '#b45309', bg: 'rgba(217, 119, 6, 0.10)' },
  sent:             { label: 'Отправлен (legacy)', color: '#b45309', bg: 'rgba(217, 119, 6, 0.10)' },
  approved:         { label: 'Согласован',       color: '#047857', bg: 'rgba(5, 150, 105, 0.10)' },
  rejected:         { label: 'Отклонён',          color: '#b91c1c', bg: 'rgba(220, 38, 38, 0.10)' },
  paid:             { label: 'Оплачен',           color: '#1d4ed8', bg: 'rgba(37, 99, 235, 0.10)' },
  cancelled:        { label: 'Отменён',           color: '#475569', bg: 'rgba(71, 85, 105, 0.10)' },
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

export default function ManagerInvoiceApprovals() {
  const [tab, setTab] = useState('pending')  // pending | approved | rejected | all
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [acting, setActing] = useState(null)  // invoice id во время approve/reject
  const [rejectModal, setRejectModal] = useState(null)  // invoice object
  const [rejectReason, setRejectReason] = useState('')

  const load = async () => {
    setLoading(true); setError('')
    try {
      const statusQ = tab === 'pending' ? 'pending_approval'
                    : tab === 'approved' ? 'approved'
                    : tab === 'rejected' ? 'rejected'
                    : ''
      const url = '/clinic-invoices/incoming' + (statusQ ? `?status=${statusQ}` : '')
      const r = await api.get(url)
      setItems(Array.isArray(r.data) ? r.data : [])
    } catch (e) {
      setError(e?.response?.data?.detail || 'Не удалось загрузить счета')
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [tab])

  const approve = async (inv) => {
    if (!window.confirm(`Согласовать счёт ${inv.invoice_number} на ${fmtMoney(inv.amount)}?\n\nВаше ФИО будет указано в качестве подписи.`)) return
    setActing(inv.id)
    try {
      await api.patch(`/clinic-invoices/${inv.id}/approve`)
      await load()
    } catch (e) {
      window.alert(e?.response?.data?.detail || 'Не удалось согласовать')
    } finally { setActing(null) }
  }

  const openReject = (inv) => {
    setRejectModal(inv)
    setRejectReason('')
  }
  const confirmReject = async () => {
    if (!rejectModal) return
    setActing(rejectModal.id)
    try {
      await api.patch(`/clinic-invoices/${rejectModal.id}/reject`, { reason: rejectReason.trim() || null })
      setRejectModal(null); setRejectReason('')
      await load()
    } catch (e) {
      window.alert(e?.response?.data?.detail || 'Не удалось отклонить')
    } finally { setActing(null) }
  }

  const stats = useMemo(() => {
    const pendingSum = items
      .filter(i => i.status === 'pending_approval' || i.status === 'sent')
      .reduce((s, i) => s + Number(i.amount || 0), 0)
    return { count: items.length, pendingSum }
  }, [items])

  return (
    <ManagerShell active="invoice-approvals">
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--fg)', marginBottom: 4 }}>
            Счета на согласование
          </h2>
          <p style={{ fontSize: 13, color: 'var(--fg-3)' }}>
            Межклиничные счета от других клиник вашей сети. Согласованные счета попадают в кабинет бухгалтера для оплаты.
          </p>
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex', gap: 4, marginBottom: 16,
          padding: 3, background: 'var(--bg-1)', borderRadius: 10,
          border: '1px solid var(--border)',
          flexWrap: 'wrap',
        }}>
          {[
            { k: 'pending',  label: 'Ждут согласования' },
            { k: 'approved', label: 'Согласованные' },
            { k: 'rejected', label: 'Отклонённые' },
            { k: 'all',      label: 'Все' },
          ].map(t => (
            <button
              key={t.k}
              onClick={() => setTab(t.k)}
              style={{
                flex: '1 1 auto', minWidth: 130, padding: '8px 14px',
                borderRadius: 8, border: 0, cursor: 'pointer',
                background: tab === t.k ? 'var(--surface)' : 'transparent',
                color: tab === t.k ? 'var(--fg)' : 'var(--fg-3)',
                fontSize: 13, fontWeight: 600,
                boxShadow: tab === t.k ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
              }}
            >
              {t.label}
            </button>
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
              text="В этой вкладке пока пусто."
            />
          </Card>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {items.map(inv => {
              const meta = STATUS_META[inv.status] || { label: inv.status, color: '#475569', bg: 'rgba(71,85,105,0.10)' }
              const isPending = inv.status === 'pending_approval' || inv.status === 'sent'
              return (
                <Card key={inv.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 0, flex: '1 1 300px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg)' }}>
                          № {inv.invoice_number}
                        </span>
                        <span style={{
                          fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
                          background: meta.bg, color: meta.color, textTransform: 'uppercase', letterSpacing: '0.04em',
                        }}>
                          {meta.label}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                          {inv.invoice_type === 'referral_bonus' ? 'Бонус по направлению' :
                           inv.invoice_type === 'royalty' ? 'Роялти' :
                           inv.invoice_type === 'correction' ? 'Корректировка' : 'Ручной счёт'}
                        </span>
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--fg-2)', marginBottom: 4 }}>
                        {inv.description || '—'}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--fg-3)', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                        <span>Создан: {fmtDate(inv.created_at)}</span>
                        {inv.due_date && <span>До: {inv.due_date}</span>}
                        {inv.issuer_name && <span>От: {inv.issuer_name}</span>}
                      </div>

                      {/* Подпись согласовавшего */}
                      {inv.approved_at && (
                        <div style={{
                          marginTop: 8, padding: '8px 10px',
                          background: 'var(--good-soft, rgba(5,150,105,0.08))',
                          border: '1px solid rgba(5,150,105,0.18)',
                          borderRadius: 8, fontSize: 12, color: 'var(--good, #047857)',
                        }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 14, verticalAlign: 'middle', marginRight: 4 }}>verified</span>
                          Согласовано: <b>{inv.approved_by_name || '—'}</b>
                          {' · '}<span style={{ opacity: 0.75 }}>{fmtDate(inv.approved_at)}</span>
                        </div>
                      )}
                      {inv.rejected_at && (
                        <div style={{
                          marginTop: 8, padding: '8px 10px',
                          background: 'var(--bad-soft)', border: '1px solid var(--bad-soft)',
                          borderRadius: 8, fontSize: 12, color: 'var(--bad)',
                        }}>
                          Отклонено {fmtDate(inv.rejected_at)}{inv.rejection_reason ? ' · ' + inv.rejection_reason : ''}
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
                      <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--fg)' }}>
                        {fmtMoney(inv.amount)}
                      </div>
                      {isPending && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <Button
                            variant="danger" size="sm"
                            onClick={() => openReject(inv)}
                            disabled={acting === inv.id}
                          >
                            Отклонить
                          </Button>
                          <Button
                            variant="primary" size="sm"
                            onClick={() => approve(inv)}
                            disabled={acting === inv.id}
                          >
                            {acting === inv.id ? '…' : 'Согласовать'}
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        )}

        {/* Footer-stats для вкладки pending */}
        {tab === 'pending' && items.length > 0 && (
          <div style={{
            marginTop: 14, padding: '10px 14px',
            background: 'var(--bg-1)', borderRadius: 10, border: '1px solid var(--border)',
            fontSize: 13, color: 'var(--fg-2)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
          }}>
            <span>Ждут согласования: <b>{stats.count}</b></span>
            <span>Общая сумма: <b>{fmtMoney(stats.pendingSum)}</b></span>
          </div>
        )}
      </div>

      {/* ─── Reject modal ─── */}
      {rejectModal && (
        <div
          onMouseDown={e => { if (e.target === e.currentTarget) setRejectModal(null) }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)',
            display: 'grid', placeItems: 'center', zIndex: 100, padding: 16,
          }}
        >
          <div style={{
            background: 'var(--surface)', borderRadius: 14, maxWidth: 440, width: '100%',
            padding: 20, border: '1px solid var(--border)',
          }}>
            <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 10, color: 'var(--fg)' }}>
              Отклонить счёт?
            </h3>
            <p style={{ fontSize: 13, color: 'var(--fg-3)', marginBottom: 12 }}>
              № {rejectModal.invoice_number} · {fmtMoney(rejectModal.amount)}
            </p>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 6 }}>
              Причина (опционально)
            </label>
            <textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              rows={3}
              placeholder="Например: бонус начислен ошибочно"
              style={{
                width: '100%', padding: '8px 10px', borderRadius: 8,
                border: '1px solid var(--border)', background: 'var(--bg-1)',
                color: 'var(--fg)', fontSize: 13, fontFamily: 'inherit',
                resize: 'vertical',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <Button variant="secondary" size="md" onClick={() => setRejectModal(null)} disabled={acting}>
                Отмена
              </Button>
              <Button variant="danger" size="md" onClick={confirmReject} disabled={acting}>
                {acting ? '…' : 'Отклонить'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </ManagerShell>
  )
}
