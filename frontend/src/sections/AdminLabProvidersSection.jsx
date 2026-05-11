/**
 * ========================================
 * БЛОК: AdminLabProvidersSection — CRUD провайдеров лабораторий (Глава 10)
 * ========================================
 * Используется в _ManagerShell → ManagerLab page (manager).
 *
 * API (apiClient: токен берётся из admin-стораджа автоматически):
 *   GET    /admin/lab/providers
 *   POST   /admin/lab/providers
 *   PATCH  /admin/lab/providers/{id}
 *   DELETE /admin/lab/providers/{id}
 *   POST   /admin/lab/providers/{id}/test-connection → { ok, latency_ms, message }
 *
 * Поля провайдера:
 *   - name (str), provider_type (Invitro/KDL/Hemotest/Helix/...), api_url,
 *   - api_key (write-only, маскируется при чтении),
 *   - default_clinic_id, active, last_sync_at
 * ========================================
 */
import { useEffect, useState, useCallback } from 'react'
import api from '../api'
import { useToast, Modal, Button } from '../design'

const PROVIDER_TYPES = [
  'Invitro', 'KDL', 'Hemotest', 'Helix', 'Gemotest', 'CMD', 'Lab4U', 'Other',
]

function fmtDate(iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString('ru-RU', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) }
  catch { return iso }
}

function moduleOffBlock() {
  return (
    <div className="rounded-2xl p-6 text-center" style={{ background: '#fef3c7', border: '1px solid #fde68a' }}>
      <span className="material-symbols-outlined text-3xl mb-2 block" style={{ color: '#92400e' }}>lock</span>
      <p className="text-sm font-semibold" style={{ color: '#92400e' }}>Модуль лабораторных интеграций не подключён.</p>
      <p className="text-xs mt-1" style={{ color: '#92400e' }}>Подключите модуль <code>lab_integration</code> в «Маркетплейс модулей».</p>
    </div>
  )
}

function EmptyProviderForm() {
  return {
    name: '',
    provider_type: 'Invitro',
    api_url: '',
    api_key: '',
    default_clinic_id: '',
    active: true,
  }
}

function ProviderModal({ open, initial, onClose, onSave, clinics }) {
  const isEdit = !!initial
  const [form, setForm] = useState(() => initial ? { ...EmptyProviderForm(), ...initial, api_key: '' } : EmptyProviderForm())
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    setForm(initial ? { ...EmptyProviderForm(), ...initial, api_key: '' } : EmptyProviderForm())
  }, [initial, open])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async () => {
    if (!form.name?.trim() || !form.provider_type || !form.api_url?.trim()) {
      toast({ kind: 'error', text: 'Заполните обязательные поля' })
      return
    }
    setBusy(true)
    try {
      const payload = {
        name: form.name.trim(),
        provider_type: form.provider_type,
        api_url: form.api_url.trim(),
        default_clinic_id: form.default_clinic_id || null,
        active: !!form.active,
      }
      // api_key передаём только если введён (иначе не перезаписываем)
      if (form.api_key) payload.api_key = form.api_key
      if (isEdit) {
        await api.patch(`/admin/lab/providers/${initial.id}`, payload)
        toast({ kind: 'success', text: 'Провайдер обновлён' })
      } else {
        if (!form.api_key) { toast({ kind: 'error', text: 'API-ключ обязателен при создании' }); setBusy(false); return }
        await api.post('/admin/lab/providers', payload)
        toast({ kind: 'success', text: 'Провайдер создан' })
      }
      onSave && onSave()
      onClose && onClose()
    } catch (e) {
      toast({ kind: 'error', text: e?.response?.data?.detail || 'Не удалось сохранить' })
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null
  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Редактирование провайдера' : 'Новый провайдер'} size="lg">
      <div className="flex flex-col gap-3" style={{ minWidth: 320 }}>
        <Field label="Название*">
          <input
            value={form.name}
            onChange={e => set('name', e.target.value)}
            placeholder="Invitro · Грозный"
            className="w-full rounded-xl"
            style={{ padding: '9px 12px', border: '1px solid #e2e8f0', fontSize: 13, outline: 'none' }}
          />
        </Field>

        <Field label="Тип лаборатории*">
          <select
            value={form.provider_type}
            onChange={e => set('provider_type', e.target.value)}
            className="w-full rounded-xl"
            style={{ padding: '9px 12px', border: '1px solid #e2e8f0', fontSize: 13, background: '#fff', outline: 'none' }}
          >
            {PROVIDER_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>

        <Field label="API URL*">
          <input
            value={form.api_url}
            onChange={e => set('api_url', e.target.value)}
            placeholder="https://api.lab.ru/v1"
            className="w-full rounded-xl"
            style={{ padding: '9px 12px', border: '1px solid #e2e8f0', fontSize: 13, outline: 'none' }}
          />
        </Field>

        <Field label={isEdit ? 'API-ключ (оставьте пустым, чтобы не менять)' : 'API-ключ*'}>
          <input
            value={form.api_key}
            onChange={e => set('api_key', e.target.value)}
            type="password"
            placeholder={isEdit ? '••• сохранён, замените при необходимости' : 'Введите ключ от лаборатории'}
            className="w-full rounded-xl"
            style={{ padding: '9px 12px', border: '1px solid #e2e8f0', fontSize: 13, outline: 'none', fontFamily: 'monospace' }}
          />
        </Field>

        <Field label="Клиника по умолчанию">
          <select
            value={form.default_clinic_id || ''}
            onChange={e => set('default_clinic_id', e.target.value || null)}
            className="w-full rounded-xl"
            style={{ padding: '9px 12px', border: '1px solid #e2e8f0', fontSize: 13, background: '#fff', outline: 'none' }}
          >
            <option value="">— не назначена —</option>
            {(clinics || []).map(c => (
              <option key={c.id} value={c.id}>{c.name || c.title}</option>
            ))}
          </select>
        </Field>

        <label className="flex items-center gap-2 cursor-pointer mt-1">
          <input type="checkbox" checked={!!form.active} onChange={e => set('active', e.target.checked)} />
          <span style={{ fontSize: 13, color: '#475569', fontWeight: 600 }}>Провайдер активен</span>
        </label>

        <div className="flex items-center justify-end gap-2 pt-3" style={{ borderTop: '1px solid #f1f5f9' }}>
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button onClick={submit} disabled={busy}>{busy ? 'Сохраняем…' : (isEdit ? 'Сохранить' : 'Создать')}</Button>
        </div>
      </div>
    </Modal>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block mb-1" style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </label>
      {children}
    </div>
  )
}

export default function AdminLabProvidersSection() {
  const { toast } = useToast()
  const [items, setItems]   = useState([])
  const [clinics, setClinics] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)
  const [editing, setEditing] = useState(null)
  const [creating, setCreating] = useState(false)
  const [testingId, setTestingId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await api.get('/admin/lab/providers')
      setItems(Array.isArray(r.data) ? r.data : (r.data?.providers || []))
    } catch (e) {
      if (e?.response?.status === 402) setError('module_off')
      else setError('load')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadClinics = useCallback(async () => {
    try {
      const r = await api.get('/manager/clinics-accessible')
      setClinics(Array.isArray(r.data) ? r.data : [])
    } catch { setClinics([]) }
  }, [])

  useEffect(() => { load(); loadClinics() }, [load, loadClinics])

  const removeProvider = async (id) => {
    if (!confirm('Удалить провайдера? Связанные заявки сохранятся.')) return
    try {
      await api.delete(`/admin/lab/providers/${id}`)
      toast({ kind: 'success', text: 'Провайдер удалён' })
      load()
    } catch (e) {
      toast({ kind: 'error', text: e?.response?.data?.detail || 'Не удалось удалить' })
    }
  }

  const testConnection = async (id) => {
    setTestingId(id)
    try {
      const r = await api.post(`/admin/lab/providers/${id}/test-connection`)
      const d = r.data || {}
      if (d.ok === false) {
        toast({ kind: 'error', text: d.message || 'Соединение неуспешно' })
      } else {
        toast({ kind: 'success', text: d.message || `OK · ${d.latency_ms ?? ''} ms` })
      }
    } catch (e) {
      toast({ kind: 'error', text: e?.response?.data?.detail || 'Не удалось подключиться' })
    } finally {
      setTestingId(null)
    }
  }

  if (error === 'module_off') return moduleOffBlock()

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">Всего провайдеров: {items.length}</p>
        <button
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold text-white transition-all active:scale-95"
          style={{ background: '#0097A7' }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
          Новый провайдер
        </button>
      </div>

      {loading && (
        <div className="space-y-2">{[0,1,2].map(i => <div key={i} className="h-16 rounded-xl animate-pulse" style={{ background: '#e5e7eb' }} />)}</div>
      )}

      {!loading && items.length === 0 && (
        <div className="rounded-2xl p-8 text-center" style={{ background: '#f9fafb', border: '1px dashed #e5e7eb' }}>
          <span className="material-symbols-outlined text-4xl mb-2 block" style={{ color: '#9ca3af' }}>biotech</span>
          <p className="text-sm font-semibold text-gray-700">Провайдеров пока нет</p>
          <p className="text-xs text-gray-500 mt-1">Добавьте первую лабораторию — кнопка справа сверху</p>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="overflow-x-auto rounded-2xl" style={{ border: '1px solid #e5e7eb', background: '#fff' }}>
          <table className="w-full text-sm">
            <thead style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2 font-semibold">Название</th>
                <th className="px-3 py-2 font-semibold">Тип</th>
                <th className="px-3 py-2 font-semibold">URL</th>
                <th className="px-3 py-2 font-semibold">Last sync</th>
                <th className="px-3 py-2 font-semibold">Статус</th>
                <th className="px-3 py-2 font-semibold text-right">Действия</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p, i) => (
                <tr key={p.id} style={{ borderTop: i === 0 ? 'none' : '1px solid #f1f5f9' }}>
                  <td className="px-3 py-3 font-semibold" style={{ color: '#0f172a' }}>{p.name}</td>
                  <td className="px-3 py-3" style={{ color: '#475569' }}>{p.provider_type}</td>
                  <td className="px-3 py-3" style={{ color: '#64748b', fontSize: 12, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.api_url}
                  </td>
                  <td className="px-3 py-3" style={{ color: '#64748b', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtDate(p.last_sync_at)}
                  </td>
                  <td className="px-3 py-3">
                    {p.active ? (
                      <span style={{ padding: '3px 8px', borderRadius: 999, background: '#dcfce7', color: '#166534', fontSize: 11, fontWeight: 700 }}>
                        Активен
                      </span>
                    ) : (
                      <span style={{ padding: '3px 8px', borderRadius: 999, background: '#f1f5f9', color: '#64748b', fontSize: 11, fontWeight: 700 }}>
                        Отключён
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    <button
                      onClick={() => testConnection(p.id)}
                      disabled={testingId === p.id}
                      className="text-xs font-semibold mr-1 transition-colors"
                      style={{ color: '#0369a1', padding: '4px 8px', borderRadius: 8, background: '#eff6ff' }}
                    >
                      {testingId === p.id ? 'Тест…' : 'Test'}
                    </button>
                    <button
                      onClick={() => setEditing(p)}
                      className="text-xs font-semibold mr-1 transition-colors"
                      style={{ color: '#475569', padding: '4px 8px', borderRadius: 8, background: '#f1f5f9' }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => removeProvider(p.id)}
                      className="text-xs font-semibold transition-colors"
                      style={{ color: '#b91c1c', padding: '4px 8px', borderRadius: 8, background: '#fef2f2' }}
                    >
                      Del
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ProviderModal
        open={creating || !!editing}
        initial={editing}
        clinics={clinics}
        onClose={() => { setCreating(false); setEditing(null) }}
        onSave={load}
      />
    </div>
  )
}
