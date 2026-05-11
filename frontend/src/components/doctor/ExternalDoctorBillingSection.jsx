/**
 * ========================================
 * Direct Billing Section (Глава 6, фича 3)
 * ========================================
 * Прямые счета visiting_doctor / partner_doctor:
 *   - Форма «Выставить счёт» (услуги, цены, скидка, метод оплаты)
 *   - Live-расчёт total
 *   - Список своих счетов с фильтрами (статус, период)
 *   - PDF-печать счёта (WeasyPrint)
 *
 * API:
 *   POST  /external-doctor/direct-bill
 *   GET   /external-doctor/direct-bills?status=&period_from=&period_to=
 *   PATCH /external-doctor/direct-bills/{id}/status
 *   GET   /external-doctor/direct-bills/{id}/print
 *
 * Подключается в:
 *   VisitingDoctorCabinet.jsx
 *   PartnerDoctorCabinet.jsx
 * ========================================
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import api from '../../api'
import { Card, KpiCard, KpiRow, Chip, Button, EmptyState } from '../../design'

const STATUS_LABEL = {
  draft:     { l: 'Черновик',  v: 'default' },
  sent:      { l: 'Отправлен', v: 'accent'  },
  paid:      { l: 'Оплачен',   v: 'good'    },
  cancelled: { l: 'Отменён',   v: 'bad'     },
}

const PAY_METHOD_LABEL = {
  cash:     'Наличные',
  card:     'Карта',
  transfer: 'Перевод',
}

function fmtRub(n) {
  try {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n || 0) + ' ₽'
  } catch {
    return `${n} ₽`
  }
}

function fmtDate(d) {
  if (!d) return ''
  try {
    return new Date(d).toLocaleDateString('ru-RU')
  } catch {
    return d.slice(0, 10)
  }
}

// ─────────────────────────────────────────────────────────────────────
// Форма «Выставить счёт»
// ─────────────────────────────────────────────────────────────────────
function CreateBillForm({ onCreated, onCancel, appointmentId = null, patientName = '', patientPhone = '' }) {
  const [services, setServices]   = useState([{ name: '', price: '', qty: 1 }])
  const [discount, setDiscount]   = useState(0)
  const [method, setMethod]       = useState('cash')
  const [notes, setNotes]         = useState('')
  const [pName, setPName]         = useState(patientName)
  const [pPhone, setPPhone]       = useState(patientPhone)
  const [busy, setBusy]           = useState(false)
  const [error, setError]         = useState(null)

  const subtotal = useMemo(
    () =>
      services.reduce((s, x) => {
        const p = parseFloat(x.price) || 0
        const q = parseInt(x.qty) || 0
        return s + p * q
      }, 0),
    [services],
  )
  const discountAmount = (subtotal * (parseFloat(discount) || 0)) / 100
  const total = Math.max(0, subtotal - discountAmount)

  const updateService = (i, key, val) => {
    const next = [...services]
    next[i] = { ...next[i], [key]: val }
    setServices(next)
  }
  const addService = () => setServices([...services, { name: '', price: '', qty: 1 }])
  const removeService = (i) => setServices(services.filter((_, idx) => idx !== i))

  const submit = useCallback(async () => {
    setError(null)
    const cleaned = services
      .map((s) => ({
        name: (s.name || '').trim(),
        price: parseFloat(s.price) || 0,
        qty: parseInt(s.qty) || 1,
      }))
      .filter((s) => s.name && s.price > 0)
    if (cleaned.length === 0) {
      setError('Нужна хотя бы одна услуга с ценой')
      return
    }
    setBusy(true)
    try {
      const r = await api.post('/external-doctor/direct-bill', {
        services: cleaned,
        discount_pct: parseFloat(discount) || 0,
        payment_method: method,
        notes: notes || null,
        appointment_id: appointmentId,
        patient_name: pName || null,
        patient_phone: pPhone || null,
      })
      if (onCreated) onCreated(r.data)
    } catch (e) {
      setError(e?.response?.data?.detail || 'Не удалось создать счёт')
    } finally {
      setBusy(false)
    }
  }, [services, discount, method, notes, appointmentId, pName, pPhone, onCreated])

  const inp = {
    padding: '7px 10px',
    border: '1px solid var(--line)',
    borderRadius: 6,
    fontSize: 13,
    background: 'var(--bg)',
    color: 'var(--fg)',
    width: '100%',
  }

  return (
    <Card>
      <Card.Header>
        <Card.Title>Новый счёт</Card.Title>
        <Card.Subtitle>Услуги, цены, скидка — итог рассчитывается автоматически</Card.Subtitle>
      </Card.Header>

      {/* Пациент */}
      <div className="grid sm:grid-cols-2 gap-2 mb-3">
        <div>
          <div style={{ fontSize: 11, color: 'var(--fg-3)', marginBottom: 3 }}>Пациент</div>
          <input
            value={pName}
            onChange={(e) => setPName(e.target.value)}
            placeholder="ФИО пациента"
            style={inp}
          />
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--fg-3)', marginBottom: 3 }}>Телефон</div>
          <input
            value={pPhone}
            onChange={(e) => setPPhone(e.target.value)}
            placeholder="+7…"
            style={inp}
          />
        </div>
      </div>

      {/* Услуги */}
      <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 6 }}>Услуги</div>
      <div className="flex flex-col gap-2">
        {services.map((s, i) => (
          <div
            key={i}
            className="grid gap-2 items-center"
            style={{ gridTemplateColumns: '2fr 1fr 80px 24px' }}
          >
            <input
              value={s.name}
              onChange={(e) => updateService(i, 'name', e.target.value)}
              placeholder="Название услуги"
              style={inp}
            />
            <input
              type="number"
              step="1"
              value={s.price}
              onChange={(e) => updateService(i, 'price', e.target.value)}
              placeholder="Цена ₽"
              style={inp}
            />
            <input
              type="number"
              step="1"
              min="1"
              value={s.qty}
              onChange={(e) => updateService(i, 'qty', e.target.value)}
              style={inp}
            />
            <button
              type="button"
              onClick={() => removeService(i)}
              style={{
                background: 'transparent',
                border: 0,
                color: 'var(--danger, #b00020)',
                cursor: 'pointer',
                fontSize: 16,
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <Button variant="ghost" size="sm" onClick={addService} style={{ marginTop: 6 }}>
        + добавить услугу
      </Button>

      {/* Скидка + метод */}
      <div className="grid sm:grid-cols-2 gap-2 mt-3">
        <div>
          <div style={{ fontSize: 11, color: 'var(--fg-3)', marginBottom: 3 }}>Скидка, %</div>
          <input
            type="number"
            min="0"
            max="100"
            step="0.1"
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
            style={inp}
          />
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--fg-3)', marginBottom: 3 }}>Метод оплаты</div>
          <div className="flex gap-2">
            {['cash', 'card', 'transfer'].map((m) => (
              <Chip
                key={m}
                variant={method === m ? 'accent' : 'default'}
                onClick={() => setMethod(m)}
                style={{ cursor: 'pointer' }}
              >
                {PAY_METHOD_LABEL[m]}
              </Chip>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3">
        <div style={{ fontSize: 11, color: 'var(--fg-3)', marginBottom: 3 }}>Примечание</div>
        <textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          style={{ ...inp, resize: 'vertical' }}
        />
      </div>

      {/* Total */}
      <div
        className="flex flex-col gap-1 mt-3"
        style={{
          padding: 12,
          background: 'var(--bg-2)',
          borderRadius: 8,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <div className="flex justify-between" style={{ fontSize: 13, color: 'var(--fg-2)' }}>
          <span>Подытог</span>
          <span>{fmtRub(subtotal)}</span>
        </div>
        <div className="flex justify-between" style={{ fontSize: 13, color: 'var(--fg-2)' }}>
          <span>Скидка</span>
          <span>−{fmtRub(discountAmount)}</span>
        </div>
        <div
          className="flex justify-between"
          style={{ fontSize: 16, color: 'var(--fg)', fontWeight: 700, marginTop: 4 }}
        >
          <span>Итого</span>
          <span>{fmtRub(total)}</span>
        </div>
      </div>

      {error && (
        <div style={{ color: 'var(--danger, #b00020)', fontSize: 12, marginTop: 8 }}>{error}</div>
      )}

      <div className="flex gap-2 justify-end mt-3">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Отмена
          </Button>
        )}
        <Button onClick={submit} disabled={busy}>
          {busy ? 'Создаю…' : 'Создать счёт'}
        </Button>
      </div>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Список счетов
// ─────────────────────────────────────────────────────────────────────
function BillsList({ bills, onAction }) {
  if (!bills || bills.length === 0) {
    return (
      <EmptyState
        title="Счетов пока нет"
        message="Выставите первый счёт через кнопку «Новый счёт»."
      />
    )
  }
  return (
    <div className="flex flex-col gap-2">
      {bills.map((b) => {
        const st = STATUS_LABEL[b.status] || { l: b.status, v: 'default' }
        return (
          <Card key={b.id} padded={false}>
            <div className="flex items-center gap-3" style={{ padding: '12px 14px' }}>
              <div className="flex-1 min-w-0">
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>
                  {b.bill_number} · {b.patient_name || '—'}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 2 }}>
                  {fmtDate(b.created_at)}
                  {b.payment_method ? ` · ${PAY_METHOD_LABEL[b.payment_method] || b.payment_method}` : ''}
                  {b.discount_pct ? ` · скидка ${b.discount_pct}%` : ''}
                </div>
              </div>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: 'var(--fg)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {fmtRub(b.total)}
              </div>
              <Chip variant={st.v}>{st.l}</Chip>
              <div className="flex gap-1">
                {b.status === 'draft' && (
                  <Button size="sm" variant="ghost" onClick={() => onAction(b, 'sent')}>
                    Отправить
                  </Button>
                )}
                {b.status !== 'paid' && b.status !== 'cancelled' && (
                  <Button size="sm" onClick={() => onAction(b, 'paid')}>
                    Оплачен
                  </Button>
                )}
                {b.status !== 'cancelled' && b.status !== 'paid' && (
                  <Button size="sm" variant="ghost" onClick={() => onAction(b, 'cancelled')}>
                    Отмена
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => onAction(b, 'print')}>
                  PDF
                </Button>
              </div>
            </div>
          </Card>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Главный компонент секции
// ─────────────────────────────────────────────────────────────────────
export default function ExternalDoctorBillingSection({ embedded = false }) {
  const [bills, setBills]         = useState([])
  const [stats, setStats]         = useState(null)
  const [loading, setLoading]     = useState(true)
  const [showForm, setShowForm]   = useState(false)
  const [filter, setFilter]       = useState('all')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [r1, r2] = await Promise.all([
        api.get('/external-doctor/direct-bills?limit=100'),
        api.get('/external-doctor/my-stats'),
      ])
      setBills(Array.isArray(r1.data) ? r1.data : [])
      setStats(r2.data || null)
    } catch {
      setBills([])
      setStats(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleAction = async (bill, action) => {
    if (action === 'print') {
      window.open(`${api.defaults.baseURL}/external-doctor/direct-bills/${bill.id}/print`, '_blank')
      return
    }
    try {
      await api.patch(`/external-doctor/direct-bills/${bill.id}/status`, { status: action })
      await load()
    } catch (e) {
      alert(e?.response?.data?.detail || 'Ошибка смены статуса')
    }
  }

  const filtered = useMemo(() => {
    if (filter === 'all') return bills
    return bills.filter((b) => b.status === filter)
  }, [bills, filter])

  return (
    <div className="flex flex-col gap-4">
      {/* Stats */}
      {stats && (
        <KpiRow cols={4}>
          <KpiCard label="Заработок (30 дней)" value={fmtRub(stats.earnings)} delta="оплачено" trend="flat" />
          <KpiCard label="Оплачено счетов" value={stats.paid_count} delta={`из ${stats.bills_total}`} trend="flat" />
          <KpiCard label="Средний чек" value={fmtRub(stats.average_check)} delta="" trend="flat" />
          <KpiCard label="Приёмов" value={stats.appointments_count} delta="за период" trend="flat" />
        </KpiRow>
      )}

      {/* Top clinics */}
      {stats && stats.top_clinics && stats.top_clinics.length > 0 && (
        <Card>
          <Card.Header>
            <Card.Title>Топ клиник по сотрудничеству</Card.Title>
          </Card.Header>
          <div className="flex flex-col gap-2">
            {stats.top_clinics.map((c, i) => (
              <div
                key={i}
                className="flex items-center justify-between"
                style={{ padding: '6px 0', borderTop: i > 0 ? '1px solid var(--line)' : 'none' }}
              >
                <div style={{ fontSize: 13, color: 'var(--fg)' }}>{c.clinic_name}</div>
                <div className="flex gap-3" style={{ fontSize: 12, color: 'var(--fg-3)' }}>
                  <span>{c.count} оплат.</span>
                  <span style={{ color: 'var(--fg)', fontWeight: 600 }}>{fmtRub(c.sum)}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Header + filter */}
      <div className="flex items-center gap-2 flex-wrap">
        {['all', 'draft', 'sent', 'paid', 'cancelled'].map((f) => (
          <Chip
            key={f}
            variant={filter === f ? 'accent' : 'default'}
            onClick={() => setFilter(f)}
            style={{ cursor: 'pointer' }}
          >
            {f === 'all' ? 'Все' : STATUS_LABEL[f]?.l || f}
          </Chip>
        ))}
        <div style={{ flex: 1 }} />
        <Button onClick={() => setShowForm(true)}>+ Новый счёт</Button>
      </div>

      {/* Form modal — inline для простоты */}
      {showForm && (
        <CreateBillForm
          onCreated={() => {
            setShowForm(false)
            load()
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* List */}
      {loading ? (
        <Card>
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--fg-3)' }}>Загрузка…</div>
        </Card>
      ) : (
        <BillsList bills={filtered} onAction={handleAction} />
      )}
    </div>
  )
}
