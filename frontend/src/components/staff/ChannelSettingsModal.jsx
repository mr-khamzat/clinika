/**
 * ChannelSettingsModal — переименовать / описание / удалить канал.
 *
 * Использование (в StaffChat.jsx):
 *   <ChannelSettingsModal
 *     open={settingsOpen}
 *     room={activeRoom}
 *     canEdit={iAmAdmin || isManagerPlus}
 *     onClose={...}
 *     onUpdated={(room) => {...}}
 *     onDeleted={() => {...}}
 *   />
 */
import { useEffect, useState } from 'react'
import api from '../../api'
import { useToast } from '../../design'

export default function ChannelSettingsModal({
  open, room, canEdit, onClose, onUpdated, onDeleted,
}) {
  const { toast } = useToast() || {}
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (open && room) {
      setName(room.name || '')
      setDescription(room.description || '')
      setConfirmDelete(false)
    }
  }, [open, room])

  if (!open || !room) return null

  const save = async () => {
    if (!name.trim()) { toast?.('Название не может быть пустым', 'error'); return }
    setBusy(true)
    try {
      const r = await api.patch(`/staff-chat/channels/${room.id}`, {
        name: name.trim(),
        description: description.trim() || null,
      })
      toast?.('Сохранено', 'success')
      onUpdated?.(r.data)
      onClose?.()
    } catch (e) {
      toast?.(e?.response?.data?.detail || 'Ошибка', 'error')
    } finally { setBusy(false) }
  }

  const remove = async () => {
    setBusy(true)
    try {
      await api.delete(`/staff-chat/channels/${room.id}`)
      toast?.('Канал удалён', 'success')
      onDeleted?.(room.id)
      onClose?.()
    } catch (e) {
      toast?.(e?.response?.data?.detail || 'Не удалось удалить', 'error')
    } finally { setBusy(false) }
  }

  const inputStyle = {
    background: 'var(--bg-1, #f6f6f8)',
    border: '1px solid var(--border, rgba(0,0,0,.08))',
    color: 'var(--fg, #0F172A)',
    fontSize: 14,
  }

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,.55)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-3xl overflow-hidden p-5 space-y-3"
        style={{
          background: 'var(--bg, #fff)',
          border: '1px solid var(--border, rgba(0,0,0,.08))',
          boxShadow: '0 20px 60px rgba(0,0,0,.35)',
        }}
      >
        <div className="flex items-center justify-between">
          <div style={{ fontSize: 16, fontWeight: 700 }}>Настройки канала</div>
          <span
            style={{
              fontSize: 11, padding: '2px 8px', borderRadius: 999,
              background: 'var(--bg-1, #f1f5f9)', color: 'var(--fg-3, #94a3b8)',
            }}
          >
            {room.type === 'channel' ? '🌐 открытый' : room.type === 'group' ? '🔒 закрытый' : room.type}
          </span>
        </div>

        {!canEdit ? (
          <div
            className="rounded-xl p-3 text-center"
            style={{ background: 'var(--bg-1, #f1f5f9)', color: 'var(--fg-3, #94a3b8)', fontSize: 13 }}
          >
            Только администратор канала или менеджер может изменять настройки
          </div>
        ) : (
          <>
            <label>
              <div style={{ fontSize: 12, color: 'var(--fg-2, #475569)', marginBottom: 4 }}>
                Название
              </div>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 rounded-xl outline-none"
                style={inputStyle}
              />
            </label>
            <label>
              <div style={{ fontSize: 12, color: 'var(--fg-2, #475569)', marginBottom: 4 }}>
                Описание
              </div>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3 py-2 rounded-xl outline-none resize-none"
                style={inputStyle}
              />
            </label>

            <div className="flex gap-2 pt-1">
              <button
                onClick={onClose}
                className="flex-1 py-2.5 rounded-xl font-semibold"
                style={{ background: 'var(--bg-1, #f1f5f9)', color: 'var(--fg-2, #475569)' }}
              >
                Отмена
              </button>
              <button
                onClick={save}
                disabled={busy || !name.trim()}
                className="flex-1 py-2.5 rounded-xl font-semibold text-white disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #0097A7, #0A2342)' }}
              >
                {busy ? 'Сохраняем…' : 'Сохранить'}
              </button>
            </div>

            <div style={{ borderTop: '1px solid var(--border, #e2e8f0)', paddingTop: 12, marginTop: 8 }}>
              {!confirmDelete ? (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="w-full py-2 rounded-xl font-semibold"
                  style={{
                    background: 'transparent',
                    color: '#dc2626',
                    border: '1px solid rgba(220,38,38,.3)',
                    fontSize: 13,
                  }}
                >
                  🗑 Удалить канал
                </button>
              ) : (
                <div className="space-y-2">
                  <div style={{ fontSize: 12, color: '#991b1b', textAlign: 'center' }}>
                    Удалить канал «{room.name}» со всеми сообщениями? Это действие нельзя отменить.
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="flex-1 py-2 rounded-xl"
                      style={{ background: 'var(--bg-1, #f1f5f9)', fontSize: 13 }}
                    >
                      Отмена
                    </button>
                    <button
                      onClick={remove}
                      disabled={busy}
                      className="flex-1 py-2 rounded-xl font-semibold text-white disabled:opacity-50"
                      style={{ background: '#dc2626', fontSize: 13 }}
                    >
                      {busy ? 'Удаляем…' : 'Да, удалить'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
