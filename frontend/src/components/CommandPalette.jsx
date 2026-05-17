/**
 * ========================================
 * БЛОК: <CommandPalette> — глобальный поиск Cmd+K (Ctrl+K)
 * ========================================
 * Подключается на верхнем уровне (Layout, AdminLayout, _ManagerShell, DoctorLayout).
 * Слушает Cmd+K / Ctrl+K глобально (если фокус не в input/textarea/contentEditable).
 *
 * Поиск:
 *   GET /search?q=...  — manager+ (если ответ пустой/ошибка — деградирует)
 *   Возвращает { patients, doctors, referrals, services } — каждый ≤ 5 элементов
 *
 * При клике на результат — навигация на правильный URL.
 * Esc — закрывает, ↑↓ — навигация по результатам, Enter — открыть выделенный.
 * ========================================
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate, useInRouterContext } from 'react-router-dom'
import api from '../api'
import { BASE_PATH, SLUG } from '../config'

// ────────────────────────────────────────────────────────────────────────
// CommandPalette подключается на верхнем уровне всех staff-кабинетов.
// В Layout/Manager/Doctor — он внутри <BrowserRouter>, и useNavigate работает.
// В AdminLayout (/admin платформы super_admin) — он ВНЕ <BrowserRouter>
// (см. App.jsx:529: AdminRoot возвращается до <BrowserRouter>).
// useNavigate() в этой ветке кидает «may be used only in the context of
// a <Router> component» и валит весь /admin (белый экран).
//
// Решение: проверяем useInRouterContext() и рендерим один из двух inner-
// компонентов. Каждый из них имеет СВОЮ стабильную последовательность
// хуков (Rules of Hooks выполняются), потому что выбор делается на уровне
// родителя при mount и не меняется в течение жизни компонента (Layout
// либо всегда внутри Router'а, либо всегда снаружи).
// ────────────────────────────────────────────────────────────────────────

/* eslint-disable react-hooks/exhaustive-deps */

// Иконка по типу результата
function iconFor(type) {
  switch (type) {
    case 'patient':  return 'person'
    case 'doctor':   return 'medical_services'
    case 'referral': return 'qr_code_2'
    case 'service':  return 'health_and_safety'
    default:         return 'search'
  }
}

function labelFor(type) {
  switch (type) {
    case 'patient':  return 'Пациент'
    case 'doctor':   return 'Врач'
    case 'referral': return 'Направление'
    case 'service':  return 'Услуга'
    default:         return ''
  }
}

// Универсальный URL для результата (учитывает префикс slug)
function urlFor(item) {
  const p = BASE_PATH || ''
  switch (item._type) {
    case 'patient':
      // Manager → история по телефону
      return `${p}/manager/history?phone=${encodeURIComponent(item.phone || '')}`
    case 'doctor':
      return `${p}/manager/recruit-doctors?doctor=${item.id}`
    case 'referral':
      return `${p}/manager/history?ref=${encodeURIComponent(item.short_code || item.id)}`
    case 'service':
      return `${p}/admin?tab=services&service=${item.id}`
    default:
      return p || '/'
  }
}

// Внешний компонент — выбирает inner с/без useNavigate
export default function CommandPalette() {
  const inRouter = useInRouterContext()
  return inRouter ? <CommandPaletteWithRouter /> : <CommandPaletteNoRouter />
}

// Версия для AdminLayout — навигация через window.location.assign (полный reload,
// допустимо т.к. в /admin SLUG='' и переходов из палитры между секциями мало).
function CommandPaletteNoRouter() {
  const navigate = useCallback((to) => {
    try {
      const url = (typeof to === 'string' && to.startsWith('/')) ? to : `/${to || ''}`
      window.location.assign(url)
    } catch {}
  }, [])
  return <CommandPaletteImpl navigate={navigate} />
}

// Версия для Layout/Manager/Doctor — внутри BrowserRouter, доступен useNavigate.
function CommandPaletteWithRouter() {
  const navigate = useNavigate()
  return <CommandPaletteImpl navigate={navigate} />
}

// Тело палитры — принимает navigate(to) как prop
function CommandPaletteImpl({ navigate }) {
  // Стабильная пустая ссылка — иначе каждый рендер создаёт новый объект и эффекты, зависящие от data, бесконечно ре-рендерятся
  const EMPTY = useMemo(() => ({ patients: [], doctors: [], referrals: [], services: [] }), [])
  const enabled = !!SLUG
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [data, setData] = useState(EMPTY)
  const [loading, setLoading] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef(null)
  const debounceRef = useRef(null)

  // Глобальный hotkey: Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e) => {
      // Игнорируем если фокус в input/textarea/contentEditable — там Cmd+K не должен срабатывать
      const t = e.target
      const tag = (t?.tagName || '').toLowerCase()
      const inEditable = tag === 'input' || tag === 'textarea' || t?.isContentEditable
      const isHotkey = (e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')
      if (isHotkey && !inEditable) {
        e.preventDefault()
        setOpen(o => !o)
        return
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])

  // При открытии — фокус на input
  useEffect(() => {
    if (!open) return
    setActiveIdx(0)
    const t = setTimeout(() => inputRef.current?.focus(), 30)
    return () => clearTimeout(t)
  }, [open])
  // При закрытии — сбрасываем запрос (отдельный эффект, чтобы не ловить EMPTY в зависимостях фокуса)
  useEffect(() => {
    if (open) return
    setQ('')
    setData(EMPTY)
  }, [open, EMPTY])

  // Debounced поиск через /search
  useEffect(() => {
    if (!open) return
    if (!enabled || !q || q.trim().length < 2) {
      setData(EMPTY)
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const r = await api.get('/search', { params: { q: q.trim() } })
        setData({
          patients:  r.data.patients  || [],
          doctors:   r.data.doctors   || [],
          referrals: r.data.referrals || [],
          services:  r.data.services  || [],
        })
        setActiveIdx(0)
      } catch (e) {
        // Деградация — показываем пусто
        setData(EMPTY)
      } finally {
        setLoading(false)
      }
    }, 250)
    return () => debounceRef.current && clearTimeout(debounceRef.current)
  }, [q, open, enabled, EMPTY])

  // Плоский список всех результатов (для навигации стрелками)
  const flat = useMemo(() => {
    const out = []
    ;(data.patients  || []).forEach(p => out.push({ ...p, _type: 'patient' }))
    ;(data.doctors   || []).forEach(d => out.push({ ...d, _type: 'doctor' }))
    ;(data.referrals || []).forEach(r => out.push({ ...r, _type: 'referral' }))
    ;(data.services  || []).forEach(s => out.push({ ...s, _type: 'service' }))
    return out
  }, [data])

  // Стрелки и Enter
  const onKey = useCallback((e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      return
    }
    if (!flat.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => Math.min(flat.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const it = flat[activeIdx]
      if (it) {
        const url = urlFor(it)
        setOpen(false)
        // External path с slug — через window.location, чтобы Router подхватил BASE_PATH
        navigate(url.replace(BASE_PATH, '') || '/')
      }
    }
  }, [flat, activeIdx, navigate])

  if (!open) return null

  // Подсчёт «глобального» индекса для подсветки
  let globalIdx = -1
  const renderGroup = (title, type, items) => {
    if (!items || !items.length) return null
    return (
      <div className="ks-cp-group" style={{ padding: '8px 0' }}>
        <div className="ks-cp-group-title" style={{
          padding: '4px 16px', fontSize: 11, fontWeight: 700,
          color: 'var(--fg-4, #888)', textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>{title}</div>
        {items.map(it => {
          globalIdx += 1
          const isActive = globalIdx === activeIdx
          const subtitle = type === 'patient'  ? (it.phone || '')
                         : type === 'doctor'   ? (it.specialty || '')
                         : type === 'referral' ? `#${it.short_code || ''} · ${it.service_name || ''}`
                         : type === 'service'  ? (it.code || '')
                         : ''
          const title2 = it.name || it.full_name || it.title || it.patient_name || it.short_code || '—'
          return (
            <button
              key={`${type}-${it.id}`}
              type="button"
              onMouseEnter={() => setActiveIdx(globalIdx)}
              onClick={() => {
                const url = urlFor({ ...it, _type: type })
                setOpen(false)
                navigate(url.replace(BASE_PATH, '') || '/')
              }}
              className="w-full flex items-center gap-3 text-left"
              style={{
                padding: '10px 16px',
                background: isActive ? 'var(--accent-soft, rgba(0,151,167,0.08))' : 'transparent',
                color: 'var(--fg, #191c1e)',
                cursor: 'pointer',
                border: 0, outline: 0,
              }}
            >
              <span
                className="material-symbols-outlined flex-shrink-0"
                style={{
                  fontSize: 20, color: isActive ? 'var(--accent, #0097A7)' : 'var(--fg-3, #727783)',
                }}
              >{iconFor(type)}</span>
              <span className="flex-1 min-w-0">
                <div className="truncate" style={{ fontSize: 14, fontWeight: 600 }}>{title2}</div>
                {subtitle && (
                  <div className="truncate" style={{ fontSize: 12, color: 'var(--fg-3, #727783)' }}>{subtitle}</div>
                )}
              </span>
              <span style={{
                fontSize: 10, color: 'var(--fg-4, #aab)',
                textTransform: 'uppercase', letterSpacing: '0.06em',
              }}>{labelFor(type)}</span>
            </button>
          )
        })}
      </div>
    )
  }

  const totalResults = (data.patients?.length || 0) + (data.doctors?.length || 0)
                     + (data.referrals?.length || 0) + (data.services?.length || 0)

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-start justify-center"
      onClick={() => setOpen(false)}
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
      role="dialog"
      aria-label="Глобальный поиск"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          marginTop: '12vh',
          width: 'min(640px, 92vw)',
          background: 'var(--surface, #fff)',
          color: 'var(--fg, #191c1e)',
          borderRadius: 14,
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          overflow: 'hidden',
          border: '1px solid var(--border, rgba(0,0,0,0.08))',
        }}
      >
        {/* Поисковая строка */}
        <div className="flex items-center gap-3" style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--border, rgba(0,0,0,0.08))',
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 22, color: 'var(--fg-3, #727783)' }}>search</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Поиск пациентов, врачей, направлений, услуг…"
            className="flex-1 bg-transparent border-0 outline-none"
            style={{ fontSize: 16, color: 'var(--fg, #191c1e)' }}
            autoFocus
          />
          <kbd style={{
            fontSize: 11, padding: '2px 6px', borderRadius: 4,
            background: 'var(--bg-2, #f1f3f5)', color: 'var(--fg-3, #727783)',
            border: '1px solid var(--border, rgba(0,0,0,0.08))',
          }}>Esc</kbd>
        </div>

        {/* Тело */}
        <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {loading && (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--fg-3, #727783)', fontSize: 13 }}>
              Ищу…
            </div>
          )}
          {!loading && q.trim().length < 2 && (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--fg-3, #727783)', fontSize: 13 }}>
              Введите минимум 2 символа — имя пациента, телефон, код направления, название услуги
            </div>
          )}
          {!loading && q.trim().length >= 2 && totalResults === 0 && (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--fg-3, #727783)', fontSize: 13 }}>
              Ничего не найдено
            </div>
          )}
          {!loading && (
            <>
              {renderGroup('Пациенты',     'patient',  data.patients)}
              {renderGroup('Врачи',        'doctor',   data.doctors)}
              {renderGroup('Направления',  'referral', data.referrals)}
              {renderGroup('Услуги',       'service',  data.services)}
            </>
          )}
        </div>

        {/* Футер с подсказками */}
        <div className="flex items-center gap-3" style={{
          padding: '8px 12px',
          borderTop: '1px solid var(--border, rgba(0,0,0,0.08))',
          fontSize: 11, color: 'var(--fg-4, #888)',
          background: 'var(--bg-1, #fafbfc)',
        }}>
          <span><kbd style={{ padding: '1px 4px', background: 'var(--bg-2)', borderRadius: 3 }}>↑↓</kbd> — навигация</span>
          <span><kbd style={{ padding: '1px 4px', background: 'var(--bg-2)', borderRadius: 3 }}>Enter</kbd> — открыть</span>
          <span style={{ marginLeft: 'auto' }}><kbd style={{ padding: '1px 4px', background: 'var(--bg-2)', borderRadius: 3 }}>⌘K</kbd> / <kbd style={{ padding: '1px 4px', background: 'var(--bg-2)', borderRadius: 3 }}>Ctrl+K</kbd></span>
        </div>
      </div>
    </div>
  )
}
