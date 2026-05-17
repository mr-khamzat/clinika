/**
 * ========================================
 * БЛОК: ManagerSubscriptionPending — очередь подписок на одобрение
 * ========================================
 * Менеджерский кабинет: список заявок пациентов на подписку «Здоровье+»,
 * которые ждут ручного одобрения. 3 таба (pending/approved/rejected) +
 * модалки одобрения (с amount/months) и отклонения (с причиной).
 *
 * API-контракт (subscription_pending router):
 *   GET  /manager/subscription/pending?status=pending|approved|rejected
 *   POST /manager/subscription/pending/{id}/approve
 *   POST /manager/subscription/pending/{id}/reject
 *
 * Сценарий использования:
 *   1. Пациент через мобильное приложение нажимает «Хочу тариф X» →
 *      POST /patient/subscription/request → запись в pending.
 *   2. Менеджер получает TG-уведомление и заходит сюда.
 *   3. Одобряет (создаётся подписка) либо отклоняет с причиной.
 *
 * Используется в App.jsx (lazy) на маршруте /manager/subscription-pending.
 * ========================================
 */
import { useEffect, useState, useCallback } from 'react'
import apiClient from '../api'
import ManagerShell from './_ManagerShell'

// ─── Локальные хелперы форматирования ───
function fmtDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
    })
  } catch { return iso }
}
function fmtMoney(v) {
  return Number(v || 0).toLocaleString('ru-RU') + ' ₽'
}

const PLAN_TITLES = {
  health_plus: 'Здоровье+',
  family_plus: 'Семья+',
  pro:         'Pro',
}

const PAYMENT_LABELS = {
  cash:    'Наличные',
  online:  'Онлайн',
  unknown: 'Не указан',
}

const STATUS_TABS = [
  { id: 'pending',  label: 'На одобрении', color: '#d97706' },
  { id: 'approved', label: 'Одобренные',   color: '#047857' },
  { id: 'rejected', label: 'Отклонённые',  color: '#b91c1c' },
]

// ═══════════════════════════════════════════════════════════════════════════
// Корневой компонент страницы
// ═══════════════════════════════════════════════════════════════════════════
export default function ManagerSubscriptionPending() {
  const [tab, setTab] = useState('pending')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [modal, setModal] = useState(null) // { type:'approve'|'reject', item }

  const reload = useCallback(async (statusFilter) => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiClient.get('/manager/subscription/pending', {
        params: { status: statusFilter },
      })
      setItems(res.data?.items || [])
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || 'Ошибка загрузки')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  // Бейдж в навигации — отдельный запрос на pending
  const reloadCount = useCallback(async () => {
    try {
      const res = await apiClient.get('/manager/subscription/pending', {
        params: { status: 'pending' },
      })
      setPendingCount((res.data?.items || []).length)
    } catch {
      /* badge не критичен */
    }
  }, [])

  useEffect(() => { reload(tab) }, [tab, reload])
  useEffect(() => { reloadCount() }, [reloadCount])

  const handleApprove = useCallback(async (item, payload) => {
    try {
      await apiClient.post(
        `/manager/subscription/pending/${item.id}/approve`,
        payload,
      )
      setModal(null)
      await reload(tab)
      await reloadCount()
    } catch (e) {
      alert(e?.response?.data?.detail || e?.message || 'Не удалось одобрить')
    }
  }, [tab, reload, reloadCount])

  const handleReject = useCallback(async (item, reason) => {
    try {
      await apiClient.post(
        `/manager/subscription/pending/${item.id}/reject`,
        { reason },
      )
      setModal(null)
      await reload(tab)
      await reloadCount()
    } catch (e) {
      alert(e?.response?.data?.detail || e?.message || 'Не удалось отклонить')
    }
  }, [tab, reload, reloadCount])

  return (
    <ManagerShell
      active="subscription_pending"
      title="Заявки на тариф"
      subtitle="Подписки «Здоровье+» от пациентов, ожидающие одобрения менеджера"
      icon="pending_actions"
    >
      {/* ─── Tab-переключатель ─── */}
      <div style={{
        display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap',
      }}>
        {STATUS_TABS.map(t => {
          const active = tab === t.id
          const badge = t.id === 'pending' && pendingCount > 0
            ? ` (${pendingCount})` : ''
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: '10px 16px',
                border: `1px solid ${active ? t.color : '#e5e7eb'}`,
                background: active ? t.color : '#fff',
                color: active ? '#fff' : '#111',
                borderRadius: 8,
                fontWeight: active ? 600 : 500,
                cursor: 'pointer',
              }}
            >
              {t.label}{badge}
            </button>
          )
        })}
      </div>

      {/* ─── Контент таба ─── */}
      {loading && (
        <div style={{padding:24, color:'#666'}}>Загрузка…</div>
      )}
      {error && (
        <div style={{
          padding: 12, background: '#fef2f2', color: '#991b1b',
          borderRadius: 8, marginBottom: 12,
        }}>
          {error}
        </div>
      )}
      {!loading && !error && items.length === 0 && (
        <div style={{
          padding: 24, background: '#f9fafb', borderRadius: 8,
          textAlign: 'center', color: '#666',
        }}>
          Нет заявок в этой категории
        </div>
      )}
      {!loading && !error && items.length > 0 && (
        <RequestsTable
          items={items}
          tab={tab}
          onApprove={(it) => setModal({ type: 'approve', item: it })}
          onReject={(it) => setModal({ type: 'reject', item: it })}
        />
      )}

      {/* ─── Модалки ─── */}
      {modal?.type === 'approve' && (
        <ApproveModal
          item={modal.item}
          onClose={() => setModal(null)}
          onSubmit={(payload) => handleApprove(modal.item, payload)}
        />
      )}
      {modal?.type === 'reject' && (
        <RejectModal
          item={modal.item}
          onClose={() => setModal(null)}
          onSubmit={(reason) => handleReject(modal.item, reason)}
        />
      )}
    </ManagerShell>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Таблица заявок
// ═══════════════════════════════════════════════════════════════════════════
function RequestsTable({ items, tab, onApprove, onReject }) {
  return (
    <div style={{overflowX:'auto'}}>
      <table style={{
        width: '100%', borderCollapse: 'collapse',
        background: '#fff', borderRadius: 8, overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      }}>
        <thead style={{background:'#f9fafb'}}>
          <tr>
            <Th>Пациент</Th>
            <Th>Тариф</Th>
            <Th>Период</Th>
            <Th>Оплата</Th>
            <Th>Дата запроса</Th>
            {tab === 'pending' && <Th>Действия</Th>}
            {tab === 'approved' && <Th>Подписка</Th>}
            {tab === 'rejected' && <Th>Причина</Th>}
          </tr>
        </thead>
        <tbody>
          {items.map(r => (
            <tr key={r.id} style={{borderTop:'1px solid #e5e7eb'}}>
              <Td>
                <div style={{fontWeight:500}}>{r.patient_name || '—'}</div>
                <div style={{fontSize:12, color:'#666'}}>{r.patient_phone || ''}</div>
              </Td>
              <Td>{PLAN_TITLES[r.plan_key] || r.plan_key}</Td>
              <Td>{r.months} мес.</Td>
              <Td>{PAYMENT_LABELS[r.payment_method] || r.payment_method || '—'}</Td>
              <Td>{fmtDate(r.created_at)}</Td>
              {tab === 'pending' && (
                <Td>
                  <button
                    onClick={() => onApprove(r)}
                    style={btnPrimary}
                  >
                    ✅ Одобрить
                  </button>
                  <button
                    onClick={() => onReject(r)}
                    style={btnDanger}
                  >
                    ❌ Отклонить
                  </button>
                </Td>
              )}
              {tab === 'approved' && (
                <Td>
                  <div style={{fontSize:12, color:'#666'}}>
                    {r.resulting_subscription_id
                      ? `ID: ${r.resulting_subscription_id.slice(0,8)}…`
                      : '—'}
                  </div>
                  <div style={{fontSize:11, color:'#999'}}>
                    {fmtDate(r.reviewed_at)}
                  </div>
                </Td>
              )}
              {tab === 'rejected' && (
                <Td>
                  <div style={{fontSize:13, maxWidth:300}}>
                    {r.reject_reason || '—'}
                  </div>
                  <div style={{fontSize:11, color:'#999'}}>
                    {fmtDate(r.reviewed_at)}
                  </div>
                </Td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Th({children}) {
  return (
    <th style={{
      textAlign: 'left', padding: '12px 16px',
      fontSize: 12, fontWeight: 600, color: '#374151',
      textTransform: 'uppercase', letterSpacing: 0.5,
    }}>{children}</th>
  )
}
function Td({children}) {
  return (
    <td style={{padding: '12px 16px', verticalAlign: 'top'}}>{children}</td>
  )
}

const btnPrimary = {
  padding: '6px 12px', marginRight: 6,
  background: '#047857', color: '#fff',
  border: 'none', borderRadius: 6, cursor: 'pointer',
  fontSize: 13, fontWeight: 500,
}
const btnDanger = {
  padding: '6px 12px',
  background: '#fff', color: '#b91c1c',
  border: '1px solid #b91c1c', borderRadius: 6, cursor: 'pointer',
  fontSize: 13, fontWeight: 500,
}
const btnSecondary = {
  padding: '8px 16px',
  background: '#fff', color: '#111',
  border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer',
  fontSize: 14,
}

// ═══════════════════════════════════════════════════════════════════════════
// Модалка одобрения
// ═══════════════════════════════════════════════════════════════════════════
function ApproveModal({ item, onClose, onSubmit }) {
  const isCash = item.payment_method === 'cash'
  const [amount, setAmount] = useState('')
  const [monthsOverride, setMonthsOverride] = useState(item.months)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handle = async () => {
    if (isCash && (!amount || Number(amount) <= 0)) {
      alert('Для наличной оплаты укажите сумму')
      return
    }
    setSubmitting(true)
    try {
      const payload = {
        months_override: Number(monthsOverride) || item.months,
        note: note || null,
      }
      if (isCash) payload.amount_received = Number(amount)
      await onSubmit(payload)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ModalShell title="Одобрить заявку" onClose={onClose}>
      <Field label="Пациент">
        {item.patient_name || '—'} · {item.patient_phone || ''}
      </Field>
      <Field label="Тариф">
        {PLAN_TITLES[item.plan_key] || item.plan_key}
      </Field>
      <Field label="Способ оплаты">
        {PAYMENT_LABELS[item.payment_method] || item.payment_method}
      </Field>
      <Field label="Период (мес.)">
        <input
          type="number" min="1" max="24"
          value={monthsOverride}
          onChange={e => setMonthsOverride(e.target.value)}
          style={inputStyle}
        />
      </Field>
      {isCash && (
        <Field label="Получено наличными, ₽">
          <input
            type="number" min="0" step="0.01"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="Например: 870"
            style={inputStyle}
            autoFocus
          />
        </Field>
      )}
      <Field label="Заметка (необязательно)">
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          rows={2}
          style={{...inputStyle, resize:'vertical'}}
        />
      </Field>
      <div style={{display:'flex', gap:8, justifyContent:'flex-end', marginTop:16}}>
        <button onClick={onClose} disabled={submitting} style={btnSecondary}>
          Отмена
        </button>
        <button onClick={handle} disabled={submitting}
          style={{...btnPrimary, padding:'8px 16px'}}>
          {submitting ? 'Обработка…' : 'Одобрить'}
        </button>
      </div>
    </ModalShell>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Модалка отклонения
// ═══════════════════════════════════════════════════════════════════════════
function RejectModal({ item, onClose, onSubmit }) {
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handle = async () => {
    if (!reason.trim() || reason.trim().length < 2) {
      alert('Укажите причину отклонения')
      return
    }
    setSubmitting(true)
    try {
      await onSubmit(reason.trim())
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ModalShell title="Отклонить заявку" onClose={onClose}>
      <Field label="Пациент">
        {item.patient_name || '—'} · {item.patient_phone || ''}
      </Field>
      <Field label="Тариф">
        {PLAN_TITLES[item.plan_key] || item.plan_key}
      </Field>
      <Field label="Причина отклонения">
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          rows={4}
          placeholder="Например: пациент уже имеет активную подписку"
          style={{...inputStyle, resize:'vertical'}}
          autoFocus
        />
      </Field>
      <div style={{display:'flex', gap:8, justifyContent:'flex-end', marginTop:16}}>
        <button onClick={onClose} disabled={submitting} style={btnSecondary}>
          Отмена
        </button>
        <button onClick={handle} disabled={submitting}
          style={{...btnDanger, padding:'8px 16px'}}>
          {submitting ? 'Обработка…' : 'Отклонить'}
        </button>
      </div>
    </ModalShell>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Универсальная модалка-оболочка
// ═══════════════════════════════════════════════════════════════════════════
function ModalShell({ title, children, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 12, padding: 24,
          width: 'min(500px, 92vw)', maxHeight: '90vh', overflowY: 'auto',
        }}
      >
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: 16,
        }}>
          <h3 style={{margin:0, fontSize:18, fontWeight:600}}>{title}</h3>
          <button
            onClick={onClose}
            style={{
              background:'none', border:'none', fontSize:24, cursor:'pointer',
              color: '#666', padding: 0, lineHeight: 1,
            }}
          >×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div style={{marginBottom:12}}>
      <div style={{fontSize:12, color:'#666', marginBottom:4}}>{label}</div>
      <div>{children}</div>
    </div>
  )
}

const inputStyle = {
  width: '100%',
  padding: '8px 12px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: 14,
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}
