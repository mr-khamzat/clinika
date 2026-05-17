/**
 * ========================================
 * БЛОК: ManagerMisWebhooks — интеграции с внешним МИС (события подписки)
 * ========================================
 * Управляющий настраивает endpoints МИС (renovatio / stoclinic / custom),
 * куда платформа отправляет события:
 *   • subscription.activated  — при наличной/онлайн активации;
 *   • subscription.cancelled  — при отмене подписки;
 *   • subscription.renewed    — при автопродлении.
 *
 * Best-effort: ошибки доставки не ломают основной flow,
 * последняя ошибка хранится в last_error для диагностики.
 *
 * API (миграция miswebhook01):
 *   GET    /manager/mis-webhooks
 *   POST   /manager/mis-webhooks
 *   PATCH  /manager/mis-webhooks/{id}
 *   DELETE /manager/mis-webhooks/{id}
 *   POST   /manager/mis-webhooks/{id}/test
 * ========================================
 */
import { useEffect, useState } from 'react'
import apiClient from '../api'
import ManagerShell from './_ManagerShell'

const EVENTS = [
  { key: 'subscription.activated', label: 'Активация подписки' },
  { key: 'subscription.cancelled', label: 'Отмена подписки' },
  { key: 'subscription.renewed',   label: 'Автопродление' },
]

export default function ManagerMisWebhooks() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true); setError('')
    try {
      const r = await apiClient.get('/manager/mis-webhooks')
      setItems(r.data?.items || [])
    } catch (e) {
      setError(e?.response?.data?.detail || e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const onDelete = async (id) => {
    if (!confirm('Удалить вебхук?')) return
    try {
      await apiClient.delete(`/manager/mis-webhooks/${id}`)
      await load()
    } catch (e) {
      alert(e?.response?.data?.detail || e.message)
    }
  }

  const onToggle = async (h) => {
    try {
      await apiClient.patch(`/manager/mis-webhooks/${h.id}`, {
        is_active: !h.is_active,
      })
      await load()
    } catch (e) {
      alert(e?.response?.data?.detail || e.message)
    }
  }

  const onTest = async (id) => {
    try {
      const r = await apiClient.post(`/manager/mis-webhooks/${id}/test`)
      const ok = r.data?.success
      alert(`${ok ? 'OK ' : 'ОШИБКА '}${r.data?.info || ''}`)
      await load()
    } catch (e) {
      alert(e?.response?.data?.detail || e.message)
    }
  }

  return (
    <ManagerShell
      active="mis_webhooks"
      title="Интеграции с МИС"
      subtitle="Webhook-уведомления внешнего МИС о событиях подписки «Здоровье+»"
      icon="webhook"
    >
      <div className="space-y-4">
        <div className="flex justify-end">
          <button
            onClick={() => setShowAdd(true)}
            className="px-4 py-2 rounded-xl text-sm font-medium"
            style={{ background: '#047857', color: '#fff' }}
          >
            + Добавить интеграцию
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-xl text-sm" style={{ background: '#fee2e2', color: '#b91c1c' }}>
            {error}
          </div>
        )}

        <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid #e5e7eb', background: '#fff' }}>
          <table className="w-full text-sm">
            <thead style={{ background: '#f9fafb' }}>
              <tr>
                <th className="text-left p-3">МИС</th>
                <th className="text-left p-3">URL</th>
                <th className="text-left p-3">События</th>
                <th className="text-center p-3">Статус</th>
                <th className="text-left p-3">Последняя ошибка</th>
                <th className="text-center p-3" />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} className="p-4 text-center text-gray-500">Загрузка…</td></tr>
              )}
              {!loading && items.length === 0 && (
                <tr><td colSpan={6} className="p-4 text-center text-gray-500">
                  Интеграций нет. Добавьте URL внешнего МИС, чтобы получать события подписки.
                </td></tr>
              )}
              {!loading && items.map(h => (
                <tr key={h.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                  <td className="p-3 font-medium">{h.mis_type}</td>
                  <td className="p-3 text-xs break-all max-w-xs">{h.webhook_url}</td>
                  <td className="p-3 text-xs">
                    {(h.events || []).map(e => (
                      <div key={e}>{e}</div>
                    ))}
                  </td>
                  <td className="p-3 text-center">
                    <button
                      onClick={() => onToggle(h)}
                      className="px-2 py-1 rounded text-xs"
                      style={{
                        background: h.is_active ? '#dcfce7' : '#fee2e2',
                        color:      h.is_active ? '#166534' : '#b91c1c',
                      }}
                    >
                      {h.is_active ? 'Активна' : 'Отключена'}
                    </button>
                    {h.last_success_at && (
                      <div className="text-[10px] text-gray-500 mt-1">
                        OK {new Date(h.last_success_at).toLocaleString('ru-RU')}
                      </div>
                    )}
                  </td>
                  <td className="p-3 text-xs text-red-700 max-w-xs">
                    {h.last_error ? (
                      <>
                        <div className="break-all">{h.last_error.slice(0, 120)}</div>
                        {h.last_error_at && (
                          <div className="text-[10px] text-gray-500">
                            {new Date(h.last_error_at).toLocaleString('ru-RU')}
                          </div>
                        )}
                      </>
                    ) : '—'}
                  </td>
                  <td className="p-3 text-center">
                    <div className="flex gap-1 justify-center">
                      <button
                        onClick={() => onTest(h.id)}
                        className="px-2 py-1 rounded text-xs"
                        style={{ background: '#dbeafe', color: '#1e3a8a' }}
                      >
                        Тест
                      </button>
                      <button
                        onClick={() => onDelete(h.id)}
                        className="px-2 py-1 rounded text-xs"
                        style={{ background: '#fee2e2', color: '#b91c1c' }}
                      >
                        Удалить
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {showAdd && (
          <AddWebhookModal
            onClose={() => setShowAdd(false)}
            onCreated={async () => { setShowAdd(false); await load() }}
          />
        )}
      </div>
    </ManagerShell>
  )
}


function AddWebhookModal({ onClose, onCreated }) {
  const [misType, setMisType] = useState('custom')
  const [webhookUrl, setWebhookUrl] = useState('')
  const [authHeader, setAuthHeader] = useState('')
  const [events, setEvents] = useState([
    'subscription.activated', 'subscription.cancelled',
  ])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const toggleEvent = (key) => {
    setEvents(prev =>
      prev.includes(key) ? prev.filter(e => e !== key) : [...prev, key]
    )
  }

  const submit = async () => {
    setBusy(true); setErr('')
    try {
      await apiClient.post('/manager/mis-webhooks', {
        mis_type: misType,
        webhook_url: webhookUrl,
        auth_header: authHeader || null,
        events,
        is_active: true,
      })
      await onCreated()
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl bg-white p-6 max-w-lg w-full"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold mb-4">Новая интеграция МИС</h3>

        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-700 mb-1">Тип МИС</label>
            <select
              value={misType}
              onChange={e => setMisType(e.target.value)}
              className="w-full border rounded-xl px-3 py-2"
            >
              <option value="renovatio">renovatio</option>
              <option value="stoclinic">stoclinic</option>
              <option value="custom">custom</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-gray-700 mb-1">Webhook URL</label>
            <input
              value={webhookUrl}
              onChange={e => setWebhookUrl(e.target.value)}
              placeholder="https://mis.example.com/hooks/subscription"
              className="w-full border rounded-xl px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-700 mb-1">
              Auth header (опционально) — например, "Bearer xxx" или "ApiKey yyy"
            </label>
            <input
              value={authHeader}
              onChange={e => setAuthHeader(e.target.value)}
              className="w-full border rounded-xl px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-700 mb-1">События</label>
            <div className="space-y-1">
              {EVENTS.map(e => (
                <label key={e.key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={events.includes(e.key)}
                    onChange={() => toggleEvent(e.key)}
                  />
                  <span>{e.label}</span>
                  <span className="text-xs text-gray-500">({e.key})</span>
                </label>
              ))}
            </div>
          </div>

          {err && (
            <div className="p-2 rounded text-xs" style={{ background: '#fee2e2', color: '#b91c1c' }}>
              {err}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm"
            style={{ background: '#f3f4f6' }}
          >
            Отмена
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="px-4 py-2 rounded-xl text-sm font-medium"
            style={{ background: '#047857', color: '#fff', opacity: busy ? 0.7 : 1 }}
          >
            {busy ? 'Сохранение…' : 'Создать'}
          </button>
        </div>
      </div>
    </div>
  )
}
