import { useState } from 'react'
import api from '../../api'

export default function PromoCodeButton({ threadId, onIssued }) {
  const [open, setOpen] = useState(false)
  const [pct, setPct] = useState(10)
  const [days, setDays] = useState(7)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const issue = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await api.post('/clinic/chat/threads/' + threadId + '/promo-code', {
        discount_type: 'percent', discount_value: pct, valid_days: days, max_uses: 1,
      })
      onIssued?.(r.data.code)
      setOpen(false)
    } catch (e) { setErr(e.response?.data?.detail || 'Ошибка') } finally { setBusy(false) }
  }

  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(v => !v)} style={{
        width: 36, height: 36, borderRadius: 10,
        background: 'var(--bg-1, #f1f5f9)', color: '#f59e0b', display: 'grid', placeItems: 'center'
      }} title="Промокод">
        <span style={{ fontSize: 18 }}>🎁</span>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 42, right: 0, zIndex: 100, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 14, boxShadow: '0 8px 24px -8px rgba(0,0,0,.2)', width: 260, color: '#0f172a' }}>
          <div style={{ fontWeight: 700, marginBottom: 10, color: '#0f172a' }}>🎁 Выпустить промокод</div>
          <label style={{ fontSize: 12, color: '#475569', display: 'block', marginBottom: 4 }}>Скидка, %</label>
          <input type="number" min="1" max="100" value={pct} onChange={e => setPct(+e.target.value)} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #cbd5e1', marginBottom: 10, color: '#0f172a', background: '#fff' }} />
          <label style={{ fontSize: 12, color: '#475569', display: 'block', marginBottom: 4 }}>Срок действия, дней</label>
          <input type="number" min="1" max="365" value={days} onChange={e => setDays(+e.target.value)} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #cbd5e1', marginBottom: 10, color: '#0f172a', background: '#fff' }} />
          {err && <div style={{ color: '#dc2626', fontSize: 12, marginBottom: 8 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setOpen(false)} style={{ flex: 1, padding: 8, borderRadius: 8, background: '#f1f5f9', color: '#475569', fontWeight: 600 }}>Отмена</button>
            <button onClick={issue} disabled={busy} style={{ flex: 1, padding: 8, borderRadius: 8, background: '#0097A7', color: '#fff', fontWeight: 600 }}>{busy ? '...' : 'Выпустить'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
