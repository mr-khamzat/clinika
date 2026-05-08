/**
 * AI-ассистент пациенту — админ-секция.
 *
 * Список диалогов пациентов с фильтром по статусу/телефону, в модалке —
 * полная история сообщений. Гейт по модулю ai_assistant выполняется на
 * бэкенде (require_module → 402, мы показываем заглушку).
 */
import { useEffect, useState } from 'react'
import axios from 'axios'
import { API_BASE } from '../config'
import { Card, Button, Chip, Modal, EmptyState } from '../design'

const API = API_BASE

const STATUSES = [
  { key: '',          label: 'Все' },
  { key: 'active',    label: 'Активные' },
  { key: 'escalated', label: 'Эскалированные' },
  { key: 'resolved',  label: 'Решённые' },
  { key: 'closed',    label: 'Закрытые' },
]

function StatusChip({ status }) {
  const map = {
    active:    { label: 'активный',     color: '#2563EB' },
    escalated: { label: 'эскалирован',  color: '#DC2626' },
    resolved:  { label: 'решён',        color: '#059669' },
    closed:    { label: 'закрыт',       color: '#6B7280' },
  }
  const x = map[status] || { label: status, color: '#6B7280' }
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold"
      style={{ background: x.color + '22', color: x.color }}
    >
      {x.label}
    </span>
  )
}

function formatDate(iso) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}

export default function AiAssistantSection({ token }) {
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [phone, setPhone] = useState('')
  const [activeConv, setActiveConv] = useState(null)
  const [activeMsgs, setActiveMsgs] = useState([])
  const [activeLoading, setActiveLoading] = useState(false)

  const auth = token ? { Authorization: `Bearer ${token}` } : {}

  async function load() {
    setLoading(true)
    setError('')
    try {
      const params = { days: 60 }
      if (statusFilter) params.status = statusFilter
      if (phone.trim()) params.phone = phone.trim()
      const r = await axios.get(`${API}/admin/ai/conversations`, {
        params, headers: auth,
      })
      setItems(Array.isArray(r.data?.items) ? r.data.items : [])
      setTotal(r.data?.total || 0)
    } catch (e) {
      if (e?.response?.status === 402) {
        setError('Модуль AI-ассистент не подключён. Подключите в каталоге модулей.')
      } else if (e?.response?.status === 403) {
        setError('Нет прав для просмотра.')
      } else {
        setError('Не удалось загрузить список диалогов.')
      }
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [statusFilter])

  async function openConv(c) {
    setActiveConv(c)
    setActiveMsgs([])
    setActiveLoading(true)
    try {
      const r = await axios.get(`${API}/admin/ai/conversations/${c.id}/messages`, { headers: auth })
      setActiveMsgs(Array.isArray(r.data?.messages) ? r.data.messages : [])
    } catch {
      setActiveMsgs([])
    } finally {
      setActiveLoading(false)
    }
  }

  async function takeConv(c) {
    try {
      await axios.post(`${API}/admin/ai/conversations/${c.id}/take`, {}, { headers: auth })
      load()
      setActiveConv(null)
    } catch (e) {
      alert('Не удалось взять в работу: ' + (e?.response?.data?.detail || e.message))
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Статус</label>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm bg-white"
            >
              {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-gray-500 mb-1">Телефон пациента</label>
            <input
              value={phone}
              onChange={e => setPhone(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') load() }}
              placeholder="+7..."
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm bg-white"
            />
          </div>
          <Button onClick={load}>Найти</Button>
        </div>
      </Card>

      {error && (
        <Card className="p-4 text-sm" style={{ background: '#FEF2F2', color: '#991B1B' }}>
          {error}
        </Card>
      )}

      <Card className="overflow-hidden">
        {loading ? (
          <div className="p-6 text-sm text-gray-500">Загрузка…</div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<span className="material-symbols-outlined text-3xl">smart_toy</span>}
            title="Пока нет диалогов"
            description="Здесь появятся беседы пациентов с AI-ассистентом."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Телефон</th>
                  <th className="text-left px-4 py-3 font-medium">Статус</th>
                  <th className="text-left px-4 py-3 font-medium">Создан</th>
                  <th className="text-left px-4 py-3 font-medium">Последнее сообщение</th>
                  <th className="text-right px-4 py-3 font-medium">Действия</th>
                </tr>
              </thead>
              <tbody>
                {items.map(c => (
                  <tr key={c.id} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono">{c.patient_phone}</td>
                    <td className="px-4 py-3"><StatusChip status={c.status} /></td>
                    <td className="px-4 py-3">{formatDate(c.created_at)}</td>
                    <td className="px-4 py-3">{formatDate(c.last_message_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <Button onClick={() => openConv(c)} variant="secondary">
                        Открыть
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > 0 && (
          <div className="px-4 py-2 text-xs text-gray-500 border-t">
            Всего: {total}
          </div>
        )}
      </Card>

      {activeConv && (
        <Modal open onClose={() => setActiveConv(null)}
               title={`Диалог · ${activeConv.patient_phone}`} size="lg">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <StatusChip status={activeConv.status} />
              {activeConv.status !== 'escalated' && (
                <Button onClick={() => takeConv(activeConv)} variant="secondary">
                  Взять в работу
                </Button>
              )}
            </div>
            <div
              className="rounded-lg border border-gray-100 bg-gray-50 p-3 max-h-[60vh] overflow-y-auto space-y-2"
            >
              {activeLoading ? (
                <div className="text-sm text-gray-500">Загрузка истории…</div>
              ) : activeMsgs.length === 0 ? (
                <div className="text-sm text-gray-500">Нет сообщений.</div>
              ) : activeMsgs.map(m => (
                <div key={m.id}
                  className={`p-2 rounded-lg text-sm ${
                    m.role === 'user' ? 'bg-white border' :
                    m.role === 'assistant' ? 'bg-blue-50' : 'bg-yellow-50'
                  }`}>
                  <div className="text-xs text-gray-500 mb-0.5">
                    {m.role === 'user' ? 'Пациент' :
                     m.role === 'assistant' ? `Ассистент${m.model ? ' · ' + m.model : ''}` :
                     'Система'} · {formatDate(m.created_at)}
                    {m.escalated && (
                      <span className="ml-2 inline-block px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-semibold">
                        ESCALATED
                      </span>
                    )}
                  </div>
                  <div className="whitespace-pre-wrap">{m.content}</div>
                </div>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
