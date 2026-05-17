/**
 * ========================================
 * КОМПОНЕНТ: PatientSearchPicker — поиск пациента с автокомплитом
 * ========================================
 * Используется в ManagerSubscriptionCashSection (Step 1 wizard'а активации
 * подписки за наличные).
 *
 * Поведение:
 *   • Input с debounce 300ms
 *   • Запрос GET /manager/subscription-cash/search-patients?q=&limit=8
 *     (ищет в PatientAccount + МИС)
 *   • Dropdown со списком пациентов: пометка «МИС, нет ЛК» если from_mis=true
 *   • При выборе пациента из МИС — POST /manager/subscription-cash/ensure-patient,
 *     результат превращается в PatientAccount и идёт в onSelect
 *   • Кнопка «+ Создать нового пациента» — onCreateNew()
 * ========================================
 */
import { useEffect, useRef, useState } from 'react'
import apiClient from '../../api'

// Цвет аватара-инициалов по hash имени (стабильный)
const AVATAR_COLORS = [
  ['#F59E0B', '#7C3AED'],
  ['#0EA5E9', '#6366F1'],
  ['#10B981', '#0EA5E9'],
  ['#EF4444', '#F59E0B'],
  ['#8B5CF6', '#EC4899'],
  ['#06B6D4', '#3B82F6'],
]
function colorFor(s) {
  let h = 0
  for (let i = 0; i < (s || '').length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}
function initials(name) {
  if (!name) return '?'
  const parts = String(name).trim().split(/\s+/)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?'
}

export default function PatientSearchPicker({ onSelect, onCreateNew }) {
  const [q, setQ] = useState('')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const tmRef = useRef(null)
  const wrapRef = useRef(null)

  // ─── Debounced search ───
  useEffect(() => {
    if (tmRef.current) clearTimeout(tmRef.current)
    if (!q || q.trim().length < 2) {
      setItems([])
      setLoading(false)
      return
    }
    setLoading(true)
    tmRef.current = setTimeout(async () => {
      try {
        const res = await apiClient.get('/manager/subscription-cash/search-patients', {
          params: { q: q.trim(), limit: 8 },
        })
        const data = Array.isArray(res.data?.patients) ? res.data.patients : []
        setItems(data)
        setActiveIdx(data.length ? 0 : -1)
      } catch {
        setItems([])
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => { if (tmRef.current) clearTimeout(tmRef.current) }
  }, [q])

  // ─── Click outside → close ───
  useEffect(() => {
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const pick = async (p) => {
    // Пациент из МИС (без ЛК) — сначала создаём PatientAccount.
    if (p?.from_mis) {
      setLoading(true)
      try {
        const r = await apiClient.post('/manager/subscription-cash/ensure-patient', {
          phone: p.phone,
          full_name: p.full_name || '',
          mis_patient_id: p.mis_patient_id || null,
        })
        const created = r.data || {}
        const merged = {
          ...p,
          id: created.id,
          full_name: created.full_name || p.full_name,
          phone: created.phone || p.phone,
          from_mis: false,
        }
        setOpen(false); setQ(''); setItems([])
        onSelect?.(merged)
      } catch {
        // ошибку просто проглатываем — пользователь увидит «крутилку» снова
      } finally {
        setLoading(false)
      }
      return
    }
    setOpen(false)
    setQ('')
    setItems([])
    onSelect?.(p)
  }

  const onKey = (e) => {
    if (!open) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => Math.min(i + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && activeIdx >= 0 && items[activeIdx]) {
      e.preventDefault()
      pick(items[activeIdx])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={wrapRef} className="relative w-full">
      {/* ─── Input ─── */}
      <div
        className="flex items-center gap-3 transition-all"
        style={{
          background: 'var(--surface)',
          border: '1.5px solid var(--border)',
          borderRadius: 14,
          padding: '0 16px',
          height: 56,
          boxShadow: open ? '0 0 0 4px rgba(245,158,11,.12)' : 'var(--shadow-sm)',
          borderColor: open ? '#F59E0B' : 'var(--border)',
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 22, color: 'var(--fg-3)' }}>
          search
        </span>
        <input
          type="text"
          autoFocus
          placeholder="Поиск пациента: имя или телефон…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            fontSize: 17,
            color: 'var(--fg)',
            fontWeight: 500,
          }}
        />
        {loading && (
          <span
            className="inline-block"
            style={{
              width: 18, height: 18, borderRadius: '50%',
              border: '2px solid #F59E0B', borderTopColor: 'transparent',
              animation: 'spin 0.7s linear infinite',
            }}
          />
        )}
        {q && !loading && (
          <button
            onClick={() => { setQ(''); setItems([]) }}
            style={{ background: 'transparent', border: 'none', color: 'var(--fg-3)', cursor: 'pointer' }}
            aria-label="Очистить"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>close</span>
          </button>
        )}
      </div>

      {/* ─── Dropdown ─── */}
      {open && (q.trim().length >= 2 || items.length > 0) && (
        <div
          className="absolute left-0 right-0 mt-2 z-30 overflow-hidden"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 14,
            boxShadow: '0 12px 40px rgba(0,0,0,.12)',
            maxHeight: 360,
            overflowY: 'auto',
          }}
        >
          {items.length === 0 && !loading && (
            <div
              className="px-4 py-4 text-center"
              style={{ color: 'var(--fg-3)', fontSize: 14 }}
            >
              Никого не нашли по запросу «{q}»
            </div>
          )}
          {items.map((p, i) => {
            const [c1, c2] = colorFor(p.full_name || p.phone || p.id)
            const active = activeIdx === i
            return (
              <button
                key={p.id || `mis-${p.mis_patient_id}` || `idx-${i}`}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => pick(p)}
                className="w-full flex items-center gap-3 px-4 py-3 transition-colors text-left"
                style={{
                  background: active ? 'var(--bg-1)' : 'transparent',
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                }}
              >
                <div
                  className="flex-shrink-0 inline-grid place-items-center"
                  style={{
                    width: 40, height: 40, borderRadius: 12,
                    background: `linear-gradient(135deg, ${c1}, ${c2})`,
                    color: '#fff', fontWeight: 700, fontSize: 14, letterSpacing: 0.3,
                  }}
                >
                  {initials(p.full_name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate" style={{ color: 'var(--fg)', fontSize: 15 }}>
                    {p.full_name || 'Без имени'}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span style={{ color: 'var(--fg-3)', fontSize: 12.5 }}>{p.phone || '—'}</span>
                    {p.from_mis && (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full"
                        style={{
                          fontSize: 10.5, fontWeight: 700, letterSpacing: 0.2,
                          background: 'rgba(14,165,233,.14)',
                          color: '#0369a1',
                        }}
                        title="Пациент найден в МИС, но у него ещё нет личного кабинета — будет создан автоматически."
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 12, fontVariationSettings: "'FILL' 1" }}>
                          medical_information
                        </span>
                        МИС · нет ЛК
                      </span>
                    )}
                    {p.subscription_plan_key && (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full"
                        style={{
                          fontSize: 10.5, fontWeight: 700, letterSpacing: 0.2,
                          background: 'linear-gradient(135deg, rgba(245,158,11,.18), rgba(124,58,237,.18))',
                          color: '#7C3AED',
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 12, fontVariationSettings: "'FILL' 1" }}>
                          workspace_premium
                        </span>
                        {p.subscription_plan_title || p.subscription_plan_key}
                      </span>
                    )}
                  </div>
                </div>
                <span className="material-symbols-outlined" style={{ fontSize: 18, color: 'var(--fg-3)' }}>
                  chevron_right
                </span>
              </button>
            )
          })}

          {/* ─── Footer: создать нового ─── */}
          {onCreateNew && (
            <button
              onClick={() => { setOpen(false); onCreateNew() }}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 transition-colors"
              style={{
                background: 'linear-gradient(135deg, rgba(245,158,11,.06), rgba(124,58,237,.06))',
                color: '#7C3AED',
                fontWeight: 700,
                fontSize: 14,
                cursor: 'pointer',
                borderTop: '1px solid var(--border)',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>person_add</span>
              Создать нового пациента
            </button>
          )}
        </div>
      )}

      <style>{`
        @keyframes spin { from {transform: rotate(0)} to {transform: rotate(360deg)} }
      `}</style>
    </div>
  )
}
