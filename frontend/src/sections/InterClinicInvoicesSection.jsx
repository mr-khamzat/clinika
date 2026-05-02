import { useEffect, useState } from 'react'
import api from '../api'

const STATUS_LABEL = {
  draft:     { text: 'Черновик',    color: '#6b7280' },
  sent:      { text: 'Выставлен',   color: '#2563eb' },
  paid:      { text: 'Оплачен',     color: '#16a34a' },
  cancelled: { text: 'Отменён',     color: '#dc2626' },
}

const TYPE_LABEL = {
  referral_bonus: 'Реферальный бонус',
  manual:         'Ручной счёт',
  royalty:        'Роялти',
  correction:     'Корректировка',
}

function Badge({ status }) {
  const s = STATUS_LABEL[status] || { text: status, color: '#6b7280' }
  return (
    <span style={{ background: s.color + '22', color: s.color, borderRadius: 6, padding: '2px 8px', fontSize: 12, fontWeight: 600 }}>
      {s.text}
    </span>
  )
}

function InvoiceTable({ invoices, onAction, isSupervisor }) {
  if (!Array.isArray(invoices) || !invoices.length) return <p style={{ color: '#9ca3af', fontSize: 14, textAlign: 'center', padding: '24px 0' }}>Счетов нет</p>
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #e5e7eb', color: '#6b7280' }}>
            <th style={{ textAlign: 'left', padding: '8px 6px', fontWeight: 600 }}>№</th>
            <th style={{ textAlign: 'left', padding: '8px 6px', fontWeight: 600 }}>От кого</th>
            <th style={{ textAlign: 'left', padding: '8px 6px', fontWeight: 600 }}>Кому</th>
            <th style={{ textAlign: 'left', padding: '8px 6px', fontWeight: 600 }}>Тип</th>
            <th style={{ textAlign: 'right', padding: '8px 6px', fontWeight: 600 }}>Сумма</th>
            <th style={{ textAlign: 'left', padding: '8px 6px', fontWeight: 600 }}>Статус</th>
            <th style={{ textAlign: 'left', padding: '8px 6px', fontWeight: 600 }}>Срок</th>
            <th style={{ padding: '8px 6px' }}></th>
          </tr>
        </thead>
        <tbody>
          {invoices.map(inv => (
            <tr key={inv.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={{ padding: '8px 6px', fontFamily: 'monospace', color: '#374151' }}>{inv.invoice_number}</td>
              <td style={{ padding: '8px 6px' }}>{inv.issuer_name || '—'}</td>
              <td style={{ padding: '8px 6px' }}>{inv.recipient_name || '—'}</td>
              <td style={{ padding: '8px 6px', color: '#6b7280' }}>{TYPE_LABEL[inv.invoice_type] || inv.invoice_type}</td>
              <td style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 700, color: '#111827' }}>
                {inv.amount.toLocaleString('ru-RU', { style: 'currency', currency: 'RUB' })}
              </td>
              <td style={{ padding: '8px 6px' }}><Badge status={inv.status} /></td>
              <td style={{ padding: '8px 6px', color: '#6b7280' }}>{inv.due_date || '—'}</td>
              <td style={{ padding: '8px 6px' }}>
                <div style={{ display: 'flex', gap: 4 }}>
                  {inv.status === 'sent' && onAction && (
                    <button onClick={() => onAction('pay', inv.id)}
                      style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6, padding: '3px 10px', fontSize: 12, cursor: 'pointer' }}>
                      Оплачен
                    </button>
                  )}
                  {inv.status !== 'paid' && inv.status !== 'cancelled' && onAction && (
                    <button onClick={() => onAction('cancel', inv.id)}
                      style={{ background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 6, padding: '3px 8px', fontSize: 12, cursor: 'pointer' }}>
                      ✕
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function InterClinicInvoicesSection({ isSupervisor = false }) {
  const [tab, setTab] = useState(isSupervisor ? 'all' : 'incoming')
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [clinics, setClinics] = useState([])
  const [form, setForm] = useState({ recipient_clinic_id: '', amount: '', description: '', due_date: '' })

  const load = async (t) => {
    setLoading(true)
    try {
      const endpoint = t === 'all' ? '/clinic-invoices/all' : `/clinic-invoices/${t}`
      const { data } = await api.get(endpoint)
      setInvoices(Array.isArray(data) ? data : [])
    } catch { setInvoices([]) }
    setLoading(false)
  }

  useEffect(() => { load(tab) }, [tab])

  useEffect(() => {
    api.get('/clinics/').then(r => setClinics(Array.isArray(r.data) ? r.data : [])).catch(() => {})
  }, [])

  const handleAction = async (action, id) => {
    try {
      await api.patch(`/clinic-invoices/${id}/${action}`)
      load(tab)
    } catch (e) {
      alert(e.response?.data?.detail || 'Ошибка')
    }
  }

  const handleCreate = async () => {
    if (!form.recipient_clinic_id || !form.amount) return alert('Заполните получателя и сумму')
    try {
      await api.post('/clinic-invoices', {
        recipient_clinic_id: form.recipient_clinic_id,
        amount: parseFloat(form.amount),
        description: form.description || null,
        due_date: form.due_date || null,
      })
      setShowCreate(false)
      setForm({ recipient_clinic_id: '', amount: '', description: '', due_date: '' })
      load(tab)
    } catch (e) {
      alert(e.response?.data?.detail || 'Ошибка создания')
    }
  }

  const TABS = isSupervisor
    ? [{ key: 'all', label: 'Все счета' }, { key: 'incoming', label: 'Входящие' }, { key: 'outgoing', label: 'Исходящие' }]
    : [{ key: 'incoming', label: 'Входящие' }, { key: 'outgoing', label: 'Исходящие' }]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: 0 }}>Межклиничные счета</h2>
        <button onClick={() => setShowCreate(v => !v)}
          style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontWeight: 600, cursor: 'pointer' }}>
          + Выставить счёт
        </button>
      </div>

      {showCreate && (
        <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 12, padding: 20, marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700 }}>Новый счёт</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>Клиника-получатель *</label>
              <select value={form.recipient_clinic_id} onChange={e => setForm(f => ({ ...f, recipient_clinic_id: e.target.value }))}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14, marginTop: 4 }}>
                <option value="">Выберите клинику</option>
                {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>Сумма (₽) *</label>
              <input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                placeholder="0.00"
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14, marginTop: 4 }} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>Описание</label>
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Назначение платежа..."
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14, marginTop: 4 }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>Срок оплаты</label>
              <input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14, marginTop: 4 }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button onClick={handleCreate}
              style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 24px', fontWeight: 700, cursor: 'pointer' }}>
              Выставить
            </button>
            <button onClick={() => setShowCreate(false)}
              style={{ background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: 8, padding: '9px 20px', cursor: 'pointer' }}>
              Отмена
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              padding: '7px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13,
              background: tab === t.key ? '#2563eb' : '#f3f4f6',
              color: tab === t.key ? '#fff' : '#374151',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {loading
        ? <p style={{ color: '#9ca3af', fontSize: 14, textAlign: 'center', padding: 24 }}>Загрузка...</p>
        : <InvoiceTable invoices={invoices} onAction={handleAction} isSupervisor={isSupervisor} />
      }
    </div>
  )
}
