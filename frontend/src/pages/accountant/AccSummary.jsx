/**
 * ========================================
 * БЛОК: AccSummary — дашборд бухгалтера
 * ========================================
 * GET /accountant/summary возвращает:
 *   { cash_on_hand: { shift_open, shift_id, cash_start, in_total, out_total, cash_on_hand },
 *     today:        { online_card, refunded, payments_count },
 *     acts:         { total, unpaid, unpaid_amount } }
 *
 * Карточки:
 *   1) Касса (текущая смена) — cash_on_hand + кнопка «Открыть смену» / «К смене»
 *   2) Сегодня — онлайн-оборот
 *   3) Акты этого месяца — total / unpaid
 * ========================================
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../api'
import { Card, Button } from '../../design'
import AccountantShell from '../_AccountantShell'

function fmtMoney(v) {
  if (v == null || v === '') return '0 ₽'
  const n = Number(v)
  if (Number.isNaN(n)) return String(v)
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽'
}

export default function AccSummary() {
  const nav = useNavigate()
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    api.get('/accountant/summary')
      .then(r => { if (alive) { setData(r.data); setError('') } })
      .catch(e => { if (alive) setError(e?.response?.data?.detail || e.message || 'Ошибка загрузки') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  const coh   = data?.cash_on_hand || {}
  const today = data?.today || {}
  const acts  = data?.acts || {}
  const shiftOpen = !!coh.shift_open

  return (
    <AccountantShell active="summary">
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--fg)', margin: 0 }}>
          Сводка
        </h1>
        <div style={{ fontSize: 13, color: 'var(--fg-3)', marginTop: 4 }}>
          Текущая смена, сегодняшний оборот и акты месяца
        </div>
      </div>

      {error && (
        <Card style={{ marginBottom: 16, borderColor: 'var(--bad)', background: 'var(--bad-soft)' }}>
          <div style={{ color: 'var(--bad)', fontSize: 13 }}>{error}</div>
        </Card>
      )}

      {loading ? (
        <Card>
          <div style={{ padding: 24, color: 'var(--fg-3)', textAlign: 'center' }}>Загрузка…</div>
        </Card>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 16,
          }}
        >
          {/* ── Касса ── */}
          <Card>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <span
                style={{
                  width: 40, height: 40, borderRadius: 10,
                  background: 'var(--accent-soft)', color: 'var(--accent)',
                  display: 'inline-grid', placeItems: 'center', flexShrink: 0,
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 22, fontVariationSettings: "'FILL' 1" }}>
                  point_of_sale
                </span>
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Касса
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--fg)', marginTop: 4, letterSpacing: '-0.01em' }}>
                  {fmtMoney(coh.cash_on_hand)}
                </div>
                <div style={{ fontSize: 12, color: shiftOpen ? 'var(--good)' : 'var(--warn)', marginTop: 4, fontWeight: 600 }}>
                  {shiftOpen ? '● Смена открыта' : '○ Смена не открыта'}
                </div>
                {shiftOpen && (
                  <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 6 }}>
                    Старт: {fmtMoney(coh.cash_start)} · Приход: {fmtMoney(coh.in_total)} · Расход: {fmtMoney(coh.out_total)}
                  </div>
                )}
                <div style={{ marginTop: 12 }}>
                  {shiftOpen ? (
                    <Button onClick={() => nav('/accountant/cash')}>К смене</Button>
                  ) : (
                    <Button onClick={() => nav('/accountant/cash')}>Открыть смену</Button>
                  )}
                </div>
              </div>
            </div>
          </Card>

          {/* ── Сегодня ── */}
          <Card>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <span
                style={{
                  width: 40, height: 40, borderRadius: 10,
                  background: 'var(--good-soft)', color: 'var(--good)',
                  display: 'inline-grid', placeItems: 'center', flexShrink: 0,
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 22, fontVariationSettings: "'FILL' 1" }}>
                  credit_card
                </span>
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Сегодня · Онлайн-оборот
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--fg)', marginTop: 4, letterSpacing: '-0.01em' }}>
                  {fmtMoney(today.online_card)}
                </div>
                <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 4 }}>
                  Платежей: <b style={{ color: 'var(--fg-2)' }}>{today.payments_count ?? 0}</b>
                  {today.refunded > 0 && (
                    <span style={{ marginLeft: 8 }}>· Возвраты: <b style={{ color: 'var(--bad)' }}>{fmtMoney(today.refunded)}</b></span>
                  )}
                </div>
              </div>
            </div>
          </Card>

          {/* ── Акты ── */}
          <Card>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <span
                style={{
                  width: 40, height: 40, borderRadius: 10,
                  background: 'var(--warn-soft)', color: 'var(--warn)',
                  display: 'inline-grid', placeItems: 'center', flexShrink: 0,
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 22, fontVariationSettings: "'FILL' 1" }}>
                  description
                </span>
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Акты этого месяца
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--fg)', marginTop: 4, letterSpacing: '-0.01em' }}>
                  {acts.total ?? 0} <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg-3)' }}>шт</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 4 }}>
                  Не оплачено: <b style={{ color: 'var(--bad)' }}>{acts.unpaid ?? 0}</b>
                  {acts.unpaid_amount > 0 && (
                    <span style={{ marginLeft: 6 }}>({fmtMoney(acts.unpaid_amount)})</span>
                  )}
                </div>
                <div style={{ marginTop: 12 }}>
                  <Button variant="secondary" onClick={() => nav('/accountant/acts')}>
                    Все акты
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}
    </AccountantShell>
  )
}
