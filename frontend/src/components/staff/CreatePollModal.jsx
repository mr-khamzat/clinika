// Модал создания опроса в StaffChat.
// Backend: POST /staff-chat/polls { room_id, question, options:[{label}], multi_select, closes_at }
import { useState } from 'react'
import api from '../../api'

export default function CreatePollModal({ open, roomId, onClose, onCreated }) {
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [multiSelect, setMultiSelect] = useState(false)
  const [closesAt, setClosesAt] = useState('') // datetime-local
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!open) return null

  const addOption = () => {
    if (options.length >= 10) return
    setOptions((arr) => [...arr, ''])
  }
  const removeOption = (idx) => {
    if (options.length <= 2) return
    setOptions((arr) => arr.filter((_, i) => i !== idx))
  }
  const updateOption = (idx, value) => {
    setOptions((arr) => arr.map((v, i) => (i === idx ? value : v)))
  }

  const canSubmit = () => {
    const q = question.trim()
    const cleaned = options.map((o) => o.trim()).filter(Boolean)
    return q.length >= 2 && cleaned.length >= 2 && !busy
  }

  const submit = async () => {
    setError('')
    const q = question.trim()
    const cleaned = options.map((o) => o.trim()).filter(Boolean)
    if (!q || cleaned.length < 2 || !roomId) {
      setError('Укажите вопрос и минимум 2 варианта')
      return
    }
    setBusy(true)
    try {
      const payload = {
        room_id: roomId,
        question: q,
        options: cleaned.map((label) => ({ label })),
        multi_select: !!multiSelect,
      }
      if (closesAt) {
        try {
          payload.closes_at = new Date(closesAt).toISOString()
        } catch {}
      }
      const r = await api.post('/staff-chat/polls', payload)
      onCreated?.(r.data)
      // Reset
      setQuestion('')
      setOptions(['', ''])
      setMultiSelect(false)
      setClosesAt('')
      onClose?.()
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || 'Ошибка создания опроса')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 130,
        background: 'rgba(15,23,42,.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 480,
          background: 'var(--bg, #fff)',
          border: '1px solid var(--border, rgba(0,0,0,.08))',
          borderRadius: 24,
          padding: 20,
          display: 'flex', flexDirection: 'column', gap: 12,
          maxHeight: '90vh', overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(15,23,42,.25)',
        }}
      >
        <div style={{ fontSize: 17, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>📊</span> Новый опрос
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--fg-2, #64748b)', fontWeight: 600 }}>Вопрос</span>
          <input
            autoFocus
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={200}
            placeholder="Например: Когда удобнее планёрка?"
            style={{
              padding: '10px 12px',
              borderRadius: 12,
              border: '1px solid var(--border, rgba(0,0,0,.08))',
              background: 'var(--bg-1, #f6f6f8)',
              color: 'var(--fg, #0F172A)',
              fontSize: 14, outline: 'none',
            }}
          />
        </label>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--fg-2, #64748b)', fontWeight: 600 }}>Варианты</span>
          {options.map((opt, idx) => (
            <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                value={opt}
                onChange={(e) => updateOption(idx, e.target.value)}
                maxLength={120}
                placeholder={`Вариант ${idx + 1}`}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 10,
                  border: '1px solid var(--border, rgba(0,0,0,.08))',
                  background: 'var(--bg-1, #f6f6f8)',
                  color: 'var(--fg, #0F172A)',
                  fontSize: 14, outline: 'none',
                }}
              />
              <button
                type="button"
                disabled={options.length <= 2}
                onClick={() => removeOption(idx)}
                title="Удалить вариант"
                style={{
                  width: 32, height: 32, borderRadius: 8,
                  border: '1px solid var(--border, rgba(0,0,0,.08))',
                  background: options.length <= 2 ? 'transparent' : 'var(--bg-1, #f6f6f8)',
                  color: 'var(--fg-3, #94a3b8)',
                  cursor: options.length <= 2 ? 'not-allowed' : 'pointer',
                  fontSize: 16,
                }}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addOption}
            disabled={options.length >= 10}
            style={{
              alignSelf: 'flex-start',
              padding: '6px 12px',
              borderRadius: 10,
              border: '1px dashed var(--border, rgba(0,0,0,.18))',
              background: 'transparent',
              color: 'var(--accent, #0097A7)',
              cursor: options.length >= 10 ? 'not-allowed' : 'pointer',
              fontSize: 13, fontWeight: 600,
            }}
          >
            + Добавить вариант
          </button>
        </div>

        <label style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px',
          borderRadius: 10,
          background: 'var(--bg-1, #f6f6f8)',
          cursor: 'pointer',
          fontSize: 13.5,
        }}>
          <input
            type="checkbox"
            checked={multiSelect}
            onChange={(e) => setMultiSelect(e.target.checked)}
          />
          <span>Разрешить выбор нескольких вариантов</span>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--fg-2, #64748b)', fontWeight: 600 }}>
            Закрыть опрос (необязательно)
          </span>
          <input
            type="datetime-local"
            value={closesAt}
            onChange={(e) => setClosesAt(e.target.value)}
            style={{
              padding: '8px 12px',
              borderRadius: 10,
              border: '1px solid var(--border, rgba(0,0,0,.08))',
              background: 'var(--bg-1, #f6f6f8)',
              color: 'var(--fg, #0F172A)',
              fontSize: 13.5, outline: 'none',
            }}
          />
        </label>

        {error && (
          <div style={{
            padding: '8px 12px', borderRadius: 10,
            background: 'rgba(220,38,38,.08)', color: '#b91c1c',
            fontSize: 13,
          }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              flex: 1, padding: '10px 0', borderRadius: 12,
              border: 0, background: 'var(--bg-1, #f6f6f8)',
              color: 'var(--fg, #0F172A)', cursor: 'pointer',
              fontSize: 14, fontWeight: 500,
            }}
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit()}
            style={{
              flex: 1, padding: '10px 0', borderRadius: 12,
              border: 0,
              background: canSubmit() ? 'linear-gradient(135deg, #0097A7, #0A2342)' : 'rgba(15,23,42,.2)',
              color: '#fff', cursor: canSubmit() ? 'pointer' : 'not-allowed',
              fontSize: 14, fontWeight: 600,
            }}
          >
            {busy ? 'Создаём…' : 'Создать опрос'}
          </button>
        </div>
      </div>
    </div>
  )
}
