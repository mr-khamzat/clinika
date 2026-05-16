/**
 * ReassignModal — модал передачи треда другому сотруднику.
 *
 * Использование:
 *   <ReassignModal open={open} onClose={...} threadId={id} onDone={refetch}/>
 */
import { useEffect, useState } from 'react'
import api from '../../api'
import { useToast } from '../../design'

export default function ReassignModal({ open, onClose, threadId, clinicId, onDone }) {
  const { toast } = useToast() || {}
  const [users, setUsers] = useState([])
  const [picked, setPicked] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) { setUsers([]); setPicked(''); setNote(''); return }
    setLoading(true)
    // Используем тот же fallback что в AssignDoctorModal:
    const params = clinicId ? { clinic_id: clinicId } : {}
    api.get('/users/clinic-staff', { params })
      .then(r => setUsers(Array.isArray(r.data) ? r.data : (r.data?.items || [])))
      .catch(() => api.get('/doctors', { params })
        .then(r => setUsers(Array.isArray(r.data) ? r.data : (r.data?.items || [])))
        .catch(() => setUsers([])))
      .finally(() => setLoading(false))
  }, [open, clinicId])

  if (!open) return null

  const submit = async () => {
    if (!picked) return
    setBusy(true)
    try {
      await api.post(`/clinic/chat/threads/${threadId}/reassign`, {
        to_user_id: picked, note: note.trim() || undefined,
      })
      toast?.('Тред передан', 'success')
      onDone?.()
      onClose?.()
    } catch (e) {
      toast?.(e?.response?.data?.detail || 'Не удалось передать', 'error')
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center"
         style={{ background: 'rgba(15,23,42,.55)', backdropFilter: 'blur(4px)' }}
         onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
           className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl overflow-hidden"
           style={{ background: 'var(--bg, #fff)', boxShadow: '0 20px 60px rgba(0,0,0,.35)' }}>
        <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--border, #e2e8f0)' }}>
          <div className="font-bold" style={{ fontSize: 16 }}>Передать тред</div>
        </div>
        <div className="p-5 space-y-3">
          {loading ? (
            <div className="text-center py-4" style={{ color: 'var(--fg-3, #94a3b8)', fontSize: 13 }}>Загрузка…</div>
          ) : users.length === 0 ? (
            <div className="text-center py-4" style={{ color: 'var(--fg-3, #94a3b8)', fontSize: 13 }}>Нет доступных сотрудников</div>
          ) : (
            <select value={picked} onChange={e => setPicked(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl outline-none"
                    style={{ background: 'var(--bg-1, #f8fafc)', border: '1px solid var(--border, #e2e8f0)', fontSize: 14 }}>
              <option value="">— выберите сотрудника —</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>
                  {u.full_name || u.name || u.username || u.id}
                  {u.role ? ` · ${u.role}` : ''}
                </option>
              ))}
            </select>
          )}
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
                    placeholder="Заметка (необязательно)…"
                    className="w-full px-3 py-2 rounded-xl outline-none resize-none"
                    style={{ background: 'var(--bg-1, #f8fafc)', border: '1px solid var(--border, #e2e8f0)', fontSize: 14 }} />
          <div className="flex gap-2 pt-1">
            <button onClick={onClose}
                    className="flex-1 py-2.5 rounded-xl font-semibold"
                    style={{ background: 'var(--bg-1, #f1f5f9)', color: 'var(--fg-2, #475569)' }}>
              Отмена
            </button>
            <button onClick={submit} disabled={!picked || busy}
                    className="flex-1 py-2.5 rounded-xl font-semibold text-white disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg, #0097A7, #0A2342)' }}>
              {busy ? 'Передаём…' : 'Передать'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
