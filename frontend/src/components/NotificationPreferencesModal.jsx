/**
 * ========================================
 * БЛОК: <NotificationPreferencesModal>
 * ========================================
 * Модалка с категориями уведомлений — пользователь отключает то, что не хочет видеть.
 * Открывается из NotificationsBell (иконка шестерёнки в шапке dropdown).
 *
 * Использует:
 *   GET  /notifications/preferences   — { categories: [...], disabled: [...] }
 *   PUT  /notifications/preferences   — { disabled: [...] }
 *
 * Props:
 *   onClose() — закрытие без сохранения
 *   onSaved() — успешное сохранение
 * ========================================
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import api from '../api'

export default function NotificationPreferencesModal({ onClose, onSaved }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [categories, setCategories] = useState([])
  const [disabled, setDisabled] = useState(new Set())
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await api.get('/notifications/preferences')
        if (!alive) return
        setCategories(r.data.categories || [])
        setDisabled(new Set(r.data.disabled || []))
      } catch (e) {
        if (!alive) return
        setError('Не удалось загрузить настройки')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  const toggle = (id) => {
    setDisabled(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      await api.put('/notifications/preferences', { disabled: Array.from(disabled) })
      onSaved?.()
    } catch {
      setError('Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  if (typeof document === 'undefined') return null

  return createPortal((
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.4)',
        zIndex: 9999,
        display: 'grid', placeItems: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 480, maxWidth: '100%', maxHeight: '85vh',
          background: 'var(--surface, #fff)',
          color: 'var(--fg, #191c1e)',
          borderRadius: 14,
          boxShadow: '0 30px 80px rgba(0,0,0,0.30)',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}
        role="dialog"
        aria-label="Настройки уведомлений"
      >
        <div style={{
          padding: '14px 18px',
          borderBottom: '1px solid var(--border, rgba(0,0,0,0.08))',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Настройки уведомлений</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            style={{
              width: 30, height: 30, borderRadius: 8,
              border: 0, background: 'transparent', cursor: 'pointer',
              display: 'grid', placeItems: 'center',
              color: 'var(--fg-3, #727783)',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>close</span>
          </button>
        </div>

        <div style={{ padding: '8px 18px 4px', fontSize: 12, color: 'var(--fg-3, #727783)' }}>
          Отметьте категории, которые хотите <b>отключить</b>. Они перестанут появляться в колокольчике.
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 6px 12px' }}>
          {loading && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-3, #727783)', fontSize: 13 }}>
              Загрузка…
            </div>
          )}
          {!loading && categories.map(cat => {
            const off = disabled.has(cat.id)
            return (
              <label
                key={cat.id}
                style={{
                  display: 'flex', gap: 12, alignItems: 'flex-start',
                  padding: '10px 14px', margin: '2px 6px',
                  borderRadius: 10, cursor: 'pointer',
                  background: off ? 'rgba(239,68,68,0.06)' : 'transparent',
                  border: '1px solid ' + (off ? 'rgba(239,68,68,0.25)' : 'transparent'),
                  transition: 'background 120ms, border-color 120ms',
                }}
                className={off ? '' : 'hover:bg-[var(--bg-1,#f7f9fb)]'}
              >
                <input
                  type="checkbox"
                  checked={off}
                  onChange={() => toggle(cat.id)}
                  style={{ marginTop: 3, width: 16, height: 16, accentColor: '#ef4444' }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                    {cat.title}
                    {off && (
                      <span style={{ marginLeft: 8, fontSize: 11, color: '#ef4444', fontWeight: 700 }}>
                        отключено
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--fg-3, #727783)', marginTop: 2 }}>
                    {cat.description}
                  </div>
                </div>
              </label>
            )
          })}
          {error && (
            <div style={{ padding: '8px 14px', color: '#ef4444', fontSize: 12 }}>{error}</div>
          )}
        </div>

        <div style={{
          padding: '12px 18px',
          borderTop: '1px solid var(--border, rgba(0,0,0,0.08))',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
        }}>
          <button
            type="button"
            onClick={() => setDisabled(new Set())}
            style={{
              fontSize: 12, padding: '6px 12px', borderRadius: 8,
              border: '1px solid var(--border, rgba(0,0,0,0.10))',
              background: 'transparent',
              color: 'var(--fg-2, #4a4f5a)', cursor: 'pointer',
            }}
            disabled={loading || saving || disabled.size === 0}
          >Включить всё</button>

          <div className="flex items-center" style={{ gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                fontSize: 13, padding: '8px 14px', borderRadius: 8,
                border: '1px solid var(--border, rgba(0,0,0,0.10))',
                background: 'transparent',
                color: 'var(--fg-2, #4a4f5a)', cursor: 'pointer',
              }}
            >Отмена</button>
            <button
              type="button"
              onClick={save}
              disabled={loading || saving}
              style={{
                fontSize: 13, padding: '8px 16px', borderRadius: 8,
                border: 0, background: '#0097A7', color: '#fff',
                fontWeight: 600, cursor: 'pointer',
                opacity: (loading || saving) ? 0.6 : 1,
              }}
            >{saving ? 'Сохранение…' : 'Сохранить'}</button>
          </div>
        </div>
      </div>
    </div>
  ), document.body)
}
