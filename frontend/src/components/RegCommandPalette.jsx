/**
 * ========================================
 * КОМПОНЕНТ: RegCommandPalette — командная палитра регистратора (Ctrl+K, Глава 5)
 * ========================================
 * Модал поверх кабинета. Поиск по командам + поиск пациентов.
 *
 * Команды (всегда видны при пустом запросе):
 *   • Новый пациент           (Alt+N)
 *   • Запись на приём         (Alt+R)
 *   • Поиск                   (Alt+S)
 *   • Печать последнего       (Alt+P)
 *   • Направления / ожидание  (Alt+W)
 *   • Бонусы
 *
 * Поиск пациентов: GET /referrals/patients/search?q=<query>
 *   • debounce 220ms
 *   • при выборе — диспатчит onSelectPatient
 *
 * Управление:
 *   Esc      — закрыть
 *   ↑/↓      — навигация
 *   Enter    — выполнить
 *   тычок    — выбрать
 * ========================================
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import apiClient from '../api'

function Icon({ name, size = 18 }) {
  return (
    <span
      className="material-symbols-outlined"
      style={{ fontSize: size, fontVariationSettings: `'FILL' 1`, lineHeight: 1 }}
    >{name}</span>
  )
}

const STATIC_COMMANDS = [
  { id: 'new',      title: 'Новый пациент',         hint: 'Alt+N',  icon: 'person_add',     keywords: 'новый пациент создать new patient add' },
  { id: 'book',     title: 'Запись на приём',       hint: 'Alt+R',  icon: 'event_available', keywords: 'запись приём book reg appointment' },
  { id: 'search',   title: 'Поиск пациента',        hint: 'Alt+S',  icon: 'search',          keywords: 'поиск пациент search' },
  { id: 'print',    title: 'Печать последнего',     hint: 'Alt+P',  icon: 'print',           keywords: 'печать направление print последнее' },
  { id: 'waitlist', title: 'Направления / ожидание', hint: 'Alt+W', icon: 'list_alt',        keywords: 'направления ожидание waitlist список' },
  { id: 'bonuses',  title: 'Бонусы',                hint: '',       icon: 'payments',        keywords: 'бонусы баланс' },
]

export default function RegCommandPalette({
  open,
  onClose,
  onCommand,         // (cmdId) => void
  onSelectPatient,   // (patient) => void
}) {
  const [query, setQuery] = useState('')
  const [patients, setPatients] = useState([])
  const [loading, setLoading] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef(null)
  const debounceRef = useRef(null)
  const listRef = useRef(null)

  // Сброс при открытии
  useEffect(() => {
    if (open) {
      setQuery('')
      setPatients([])
      setActiveIdx(0)
      // фокус через rAF — после mount
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // Поиск пациентов с дебаунсом
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = query.trim()
    if (q.length < 2) {
      setPatients([])
      return
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await apiClient.get('/referrals/patients/search', { params: { q, limit: 8 } })
        setPatients(Array.isArray(res.data?.patients) ? res.data.patients : [])
      } catch {
        setPatients([])
      }
      setLoading(false)
    }, 220)
    return () => debounceRef.current && clearTimeout(debounceRef.current)
  }, [query])

  // Фильтрация статичных команд по тексту запроса
  const matchedCommands = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return STATIC_COMMANDS
    return STATIC_COMMANDS.filter(c =>
      c.title.toLowerCase().includes(q) || (c.keywords || '').toLowerCase().includes(q)
    )
  }, [query])

  // Общий плоский список для управления стрелками
  const items = useMemo(() => {
    const arr = []
    matchedCommands.forEach(c => arr.push({ type: 'cmd', data: c }))
    patients.forEach(p => arr.push({ type: 'patient', data: p }))
    return arr
  }, [matchedCommands, patients])

  useEffect(() => { setActiveIdx(0) }, [items.length])

  // Управление клавиатурой
  const handleKey = (e) => {
    if (!open) return
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose?.()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => Math.min(items.length - 1, i + 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.max(0, i - 1))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const it = items[activeIdx]
      if (!it) return
      if (it.type === 'cmd') {
        onCommand?.(it.data.id)
      } else {
        onSelectPatient?.(it.data)
      }
      onClose?.()
    }
  }

  useEffect(() => {
    if (!open) return
    const h = handleKey
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, items, activeIdx])

  // Прокрутка к активному
  useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.querySelector(`[data-idx="${activeIdx}"]`)
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-label="Командная палитра"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'oklch(0 0 0 / 0.45)',
        backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '10vh', padding: '10vh 16px 16px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 540,
          background: 'var(--surface, #fff)',
          borderRadius: 18,
          boxShadow: '0 24px 60px oklch(0 0 0 / 0.30)',
          border: '1px solid var(--border, #e5e7eb)',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          maxHeight: '70vh',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--border, #eee)' }}>
          <Icon name="bolt" size={20} />
          <input
            ref={inputRef}
            type="text"
            placeholder="Команда или ФИО / телефон…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              flex: 1, border: 0, outline: 'none', background: 'transparent',
              fontSize: 16, color: 'var(--fg, #111)',
            }}
          />
          <kbd style={{
            fontFamily: 'inherit', fontSize: 11, padding: '2px 6px', borderRadius: 6,
            background: 'var(--bg-2, #f3f4f6)', color: 'var(--fg-3, #555)',
            border: '1px solid var(--border, #e5e7eb)',
          }}>Esc</kbd>
        </div>

        <div ref={listRef} style={{ overflowY: 'auto', flex: 1, padding: 6 }}>
          {matchedCommands.length > 0 && (
            <>
              <div style={{ padding: '6px 10px', fontSize: 10.5, fontWeight: 700, color: 'var(--fg-3, #555)', textTransform: 'uppercase', letterSpacing: 0.06 }}>
                Команды
              </div>
              {matchedCommands.map((c, i) => {
                const idx = i
                const active = activeIdx === idx
                return (
                  <button
                    key={c.id}
                    data-idx={idx}
                    type="button"
                    onClick={() => { onCommand?.(c.id); onClose?.() }}
                    onMouseEnter={() => setActiveIdx(idx)}
                    style={{
                      width: '100%', textAlign: 'left',
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 12px', borderRadius: 10,
                      background: active ? 'var(--accent-soft, oklch(0.62 0.12 195 / 0.12))' : 'transparent',
                      border: 0, cursor: 'pointer', color: 'var(--fg, #111)',
                    }}
                  >
                    <span style={{
                      width: 32, height: 32, display: 'grid', placeItems: 'center',
                      borderRadius: 9,
                      background: 'var(--bg-2, #f3f4f6)', color: 'var(--accent, #0a6e85)',
                    }}>
                      <Icon name={c.icon} size={18} />
                    </span>
                    <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>{c.title}</span>
                    {c.hint && (
                      <kbd style={{
                        fontFamily: 'inherit', fontSize: 10.5, padding: '2px 6px', borderRadius: 5,
                        background: 'var(--bg-2, #f3f4f6)', color: 'var(--fg-3, #555)',
                        border: '1px solid var(--border, #e5e7eb)',
                      }}>{c.hint}</kbd>
                    )}
                  </button>
                )
              })}
            </>
          )}

          {patients.length > 0 && (
            <>
              <div style={{ padding: '6px 10px', marginTop: 6, fontSize: 10.5, fontWeight: 700, color: 'var(--fg-3, #555)', textTransform: 'uppercase', letterSpacing: 0.06 }}>
                Пациенты
              </div>
              {patients.map((p, i) => {
                const idx = matchedCommands.length + i
                const active = activeIdx === idx
                return (
                  <button
                    key={p.last_referral_id || (p.patient_phone + i)}
                    data-idx={idx}
                    type="button"
                    onClick={() => { onSelectPatient?.(p); onClose?.() }}
                    onMouseEnter={() => setActiveIdx(idx)}
                    style={{
                      width: '100%', textAlign: 'left',
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 12px', borderRadius: 10,
                      background: active ? 'var(--accent-soft, oklch(0.62 0.12 195 / 0.12))' : 'transparent',
                      border: 0, cursor: 'pointer', color: 'var(--fg, #111)',
                    }}
                  >
                    <span style={{
                      width: 32, height: 32, display: 'grid', placeItems: 'center',
                      borderRadius: 9, background: 'var(--bg-2, #f3f4f6)', color: '#6b7280',
                    }}>
                      <Icon name="person" size={18} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.patient_name || p.patient_phone}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--fg-3, #555)' }}>
                        {p.patient_phone} {p.last_short_code ? ` · код ${p.last_short_code}` : ''}
                      </div>
                    </span>
                    <Icon name="chevron_right" size={18} />
                  </button>
                )
              })}
            </>
          )}

          {!matchedCommands.length && !patients.length && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-3, #555)', fontSize: 13 }}>
              {loading ? 'Ищем…' : (query.trim().length < 2 ? 'Начните вводить…' : 'Ничего не найдено')}
            </div>
          )}
        </div>

        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '8px 14px', borderTop: '1px solid var(--border, #eee)',
          fontSize: 11, color: 'var(--fg-3, #555)',
        }}>
          <span><kbd style={{ padding: '1px 5px', borderRadius: 4, background: 'var(--bg-2, #f3f4f6)' }}>↑↓</kbd> навигация</span>
          <span><kbd style={{ padding: '1px 5px', borderRadius: 4, background: 'var(--bg-2, #f3f4f6)' }}>Enter</kbd> выбрать</span>
          <span><kbd style={{ padding: '1px 5px', borderRadius: 4, background: 'var(--bg-2, #f3f4f6)' }}>Esc</kbd> закрыть</span>
        </div>
      </div>
    </div>
  )
}
