/**
 * ========================================
 * БЛОК: PlatformAnnouncements — рассылка объявлений всем сотрудникам платформы
 * ========================================
 * Только super_admin. Создание/просмотр/отзыв объявлений.
 * Объявление автоматически попадает в колокольчик уведомлений всех активных
 * сотрудников всех тенантов (категория «announcements» в /notifications/recent).
 * ========================================
 */
import { useEffect, useState } from 'react'
import api from '../api'

const SEVERITY_META = {
  info:     { label: 'Инфо',     icon: '📢', color: '#0ea5e9', bg: 'rgba(14, 165, 233, 0.10)' },
  warning:  { label: 'Внимание', icon: '⚠️', color: '#d97706', bg: 'rgba(217, 119, 6, 0.10)' },
  critical: { label: 'Критично', icon: '⛔', color: '#dc2626', bg: 'rgba(220, 38, 38, 0.10)' },
}

export default function PlatformAnnouncements() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ message: '', severity: 'info', expires_at: '' })
  const [sending, setSending] = useState(false)
  const [showRevoked, setShowRevoked] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const r = await api.get('/admin/announcements', { params: { include_revoked: showRevoked } })
      setItems(r.data || [])
    } catch (e) {
      setError(e?.response?.data?.detail || 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [showRevoked])  // eslint-disable-line

  const send = async () => {
    if (!form.message.trim()) { setError('Введите текст'); return }
    setSending(true); setError('')
    try {
      const payload = {
        message: form.message.trim(),
        severity: form.severity,
        expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
      }
      await api.post('/admin/announcements', payload)
      setForm({ message: '', severity: 'info', expires_at: '' })
      await load()
    } catch (e) {
      setError(e?.response?.data?.detail || 'Не удалось отправить')
    } finally {
      setSending(false)
    }
  }

  const revoke = async (id) => {
    if (!window.confirm('Отозвать объявление? Оно перестанет показываться в колокольчике.')) return
    try {
      await api.delete(`/admin/announcements/${id}`)
      await load()
    } catch (e) {
      alert(e?.response?.data?.detail || 'Не удалось отозвать')
    }
  }

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: '24px 16px' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Объявления платформы</h1>
        <div style={{ fontSize: 13, color: 'var(--fg-3, #6b7280)' }}>
          Рассылка попадает в колокольчик уведомлений всех активных сотрудников всех тенантов.
        </div>
      </div>

      {/* Форма создания */}
      <div style={{
        background: 'var(--surface, #fff)',
        border: '1px solid var(--border, rgba(0,0,0,0.08))',
        borderRadius: 12, padding: 18, marginBottom: 24,
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Новое объявление</div>

        <textarea
          value={form.message}
          onChange={(e) => setForm(p => ({ ...p, message: e.target.value }))}
          placeholder="Например: Завтра в 02:00 МСК — техническое обслуживание, возможны кратковременные перебои."
          rows={4}
          style={{
            width: '100%', resize: 'vertical',
            background: 'var(--bg-1, #f7f9fb)',
            border: '1px solid var(--border, rgba(0,0,0,0.08))',
            borderRadius: 10, padding: '10px 12px', marginBottom: 12,
            fontSize: 14, color: 'var(--fg, #111827)', outline: 'none',
            fontFamily: 'inherit',
          }}
        />

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
              Важность
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {Object.entries(SEVERITY_META).map(([k, m]) => {
                const on = form.severity === k
                return (
                  <button
                    key={k} type="button"
                    onClick={() => setForm(p => ({ ...p, severity: k }))}
                    style={{
                      padding: '7px 14px', borderRadius: 999,
                      border: `1px solid ${on ? m.color : 'var(--border, rgba(0,0,0,0.10))'}`,
                      background: on ? m.bg : 'transparent',
                      color: on ? m.color : 'var(--fg-2, #4b5563)',
                      cursor: 'pointer', fontSize: 13, fontWeight: 600,
                    }}
                  >{m.icon} {m.label}</button>
                )
              })}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
              Скрыть после (опц.)
            </div>
            <input
              type="datetime-local"
              value={form.expires_at}
              onChange={(e) => setForm(p => ({ ...p, expires_at: e.target.value }))}
              style={{
                background: 'var(--bg-1, #f7f9fb)',
                border: '1px solid var(--border, rgba(0,0,0,0.10))',
                borderRadius: 9, padding: '8px 10px', fontSize: 13,
                color: 'var(--fg, #111827)', outline: 'none',
              }}
            />
          </div>

          <button
            type="button"
            onClick={send}
            disabled={sending || !form.message.trim()}
            style={{
              marginLeft: 'auto',
              padding: '10px 20px', borderRadius: 10, border: 0,
              background: '#0097A7', color: '#fff',
              fontWeight: 600, fontSize: 14,
              cursor: sending ? 'wait' : 'pointer',
              opacity: (!form.message.trim() || sending) ? 0.5 : 1,
            }}
          >{sending ? 'Отправка…' : 'Отправить всем'}</button>
        </div>

        {error && (
          <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(239, 68, 68, 0.10)', color: '#dc2626', borderRadius: 8, fontSize: 13 }}>
            {error}
          </div>
        )}
      </div>

      {/* Список */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>История</div>
        <label style={{ fontSize: 13, color: 'var(--fg-3)', display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={showRevoked} onChange={(e) => setShowRevoked(e.target.checked)} />
          Показать отозванные
        </label>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--fg-3)' }}>Загрузка…</div>
      ) : items.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--fg-3)', fontSize: 13 }}>
          Объявлений пока нет
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {items.map(it => {
            const m = SEVERITY_META[it.severity] || SEVERITY_META.info
            const expired = it.expires_at && new Date(it.expires_at).getTime() < Date.now()
            return (
              <div
                key={it.id}
                style={{
                  background: 'var(--surface, #fff)',
                  border: '1px solid var(--border, rgba(0,0,0,0.08))',
                  borderLeft: `3px solid ${m.color}`,
                  borderRadius: 12, padding: '12px 14px',
                  opacity: (it.revoked || expired) ? 0.55 : 1,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                    background: m.bg, color: m.color,
                  }}>{m.icon} {m.label}</span>
                  <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>
                    {new Date(it.created_at).toLocaleString('ru-RU')}
                  </span>
                  {it.expires_at && (
                    <span style={{ fontSize: 12, color: expired ? '#dc2626' : 'var(--fg-3)' }}>
                      · до {new Date(it.expires_at).toLocaleString('ru-RU')}
                    </span>
                  )}
                  {it.revoked && (
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: 'rgba(220, 38, 38, 0.10)', color: '#dc2626', fontWeight: 700 }}>
                      ОТОЗВАНО
                    </span>
                  )}
                  {!it.revoked && (
                    <button
                      onClick={() => revoke(it.id)}
                      style={{
                        marginLeft: 'auto', padding: '4px 10px', borderRadius: 7,
                        border: '1px solid rgba(220, 38, 38, 0.30)', background: 'transparent',
                        color: '#dc2626', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      }}
                    >Отозвать</button>
                  )}
                </div>
                <div style={{ fontSize: 14, lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>
                  {it.message}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
