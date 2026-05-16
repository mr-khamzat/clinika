// Модалка создания канала Slack-style (open/private)
// Backend endpoint: POST /staff-chat/channels { name, type, clinic_id, description }
import { useState } from 'react'
import api from '../../api'
import { useToast } from '../../design'

export default function CreateChannelModal({ open, onClose, onCreated, clinicId }) {
  const toastCtx = useToast()
  const toast = toastCtx?.toast
  const [name, setName] = useState('')
  const [type, setType] = useState('channel')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  if (!open) return null

  const submit = async () => {
    if (!name.trim()) { toast?.('Укажите название', 'error'); return }
    setBusy(true)
    try {
      const r = await api.post('/staff-chat/channels', {
        name: name.trim(),
        type,
        clinic_id: clinicId || null,
        description: description.trim() || null,
      })
      toast?.('Канал создан', 'success')
      onCreated?.(r.data)
      setName(''); setDescription(''); setType('channel')
      onClose?.()
    } catch (e) {
      toast?.(e?.response?.data?.detail || 'Ошибка создания канала', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,.55)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-3xl overflow-hidden p-5 space-y-3"
        style={{ background: 'var(--bg, #fff)', border: '1px solid var(--border, rgba(0,0,0,.08))' }}
      >
        <div style={{ fontSize: 16, fontWeight: 700 }}>Новый канал</div>
        <input
          autoFocus
          placeholder="Название (например: general)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2 rounded-xl outline-none"
          style={{
            background: 'var(--bg-1, #f6f6f8)',
            border: '1px solid var(--border, rgba(0,0,0,.08))',
            color: 'var(--fg, #0F172A)',
            fontSize: 14,
          }}
        />
        <textarea
          placeholder="Описание (необязательно)"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full px-3 py-2 rounded-xl outline-none resize-none"
          style={{
            background: 'var(--bg-1, #f6f6f8)',
            border: '1px solid var(--border, rgba(0,0,0,.08))',
            color: 'var(--fg, #0F172A)',
            fontSize: 14,
          }}
        />
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setType('channel')}
            className="py-2.5 rounded-xl"
            style={{
              background: type === 'channel' ? 'var(--accent-soft, rgba(0,151,167,.1))' : 'var(--bg-1, #f6f6f8)',
              border: `1px solid ${type === 'channel' ? 'var(--accent, #0097A7)' : 'var(--border, rgba(0,0,0,.08))'}`,
            }}
          >
            🌐 Открытый
          </button>
          <button
            onClick={() => setType('group')}
            className="py-2.5 rounded-xl"
            style={{
              background: type === 'group' ? 'var(--accent-soft, rgba(0,151,167,.1))' : 'var(--bg-1, #f6f6f8)',
              border: `1px solid ${type === 'group' ? 'var(--accent, #0097A7)' : 'var(--border, rgba(0,0,0,.08))'}`,
            }}
          >
            🔒 Закрытый
          </button>
        </div>
        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl"
            style={{ background: 'var(--bg-1, #f6f6f8)' }}
          >
            Отмена
          </button>
          <button
            onClick={submit}
            disabled={busy || !name.trim()}
            className="flex-1 py-2.5 rounded-xl text-white font-semibold disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #0097A7, #0A2342)' }}
          >
            {busy ? 'Создаём…' : 'Создать'}
          </button>
        </div>
      </div>
    </div>
  )
}
