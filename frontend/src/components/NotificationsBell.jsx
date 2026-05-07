/**
 * ========================================
 * БЛОК: <NotificationsBell> — иконка-колокольчик в шапках staff-кабинетов
 * ========================================
 * Подключается в Layout, _ManagerShell, AdminLayout, DoctorLayout.
 *
 * Использует:
 *   GET  /notifications/recent          — последние 10 уведомлений
 *   POST /notifications/{id}/read       — отметить прочитанным
 *
 * Закрывается при клике вне (useEffect + document mousedown).
 * Counter unread показывается badge'ом.
 *
 * Props:
 *   size      — диаметр кнопки (px), по умолчанию 36
 *   variant   — 'square' (border) | 'round' (rounded-full с hover-bg) — для разных Layout
 * ========================================
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import api from '../api'

// ===== БЛОК (W4): глобальные keyframes для dropdown slide+fade 200ms =====
const KS_DROPDOWN_STYLE_ID = 'ks-dropdown-anim'
function ensureDropdownAnim() {
  if (typeof document === 'undefined') return
  if (document.getElementById(KS_DROPDOWN_STYLE_ID)) return
  const css = `
    @keyframes ks-dd-in  { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes ks-dd-out { from { opacity: 1; transform: translateY(0); }    to { opacity: 0; transform: translateY(-6px); } }
    .ks-dd-enter { animation: ks-dd-in  200ms cubic-bezier(0.2, 0.8, 0.2, 1); }
    .ks-dd-leave { animation: ks-dd-out 200ms cubic-bezier(0.4, 0, 1, 1) forwards; }
  `
  const tag = document.createElement('style')
  tag.id = KS_DROPDOWN_STYLE_ID
  tag.textContent = css
  document.head.appendChild(tag)
}

// «5 мин назад» / «2 ч назад» / «3 дня назад»
function relTime(iso) {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  const now = Date.now()
  const sec = Math.max(1, Math.floor((now - t) / 1000))
  if (sec < 60)         return 'только что'
  const min = Math.floor(sec / 60)
  if (min < 60)         return `${min} мин назад`
  const hr = Math.floor(min / 60)
  if (hr < 24)          return `${hr} ч назад`
  const d = Math.floor(hr / 24)
  if (d < 30)           return `${d} ${d === 1 ? 'день' : d < 5 ? 'дня' : 'дней'} назад`
  return new Date(iso).toLocaleDateString('ru-RU')
}

// Иконка по типу уведомления
function iconFor(type) {
  switch (type) {
    case 'referral_created':  return 'qr_code_2'
    case 'bonus_credited':    return 'payments'
    case 'call_missed':       return 'phone_missed'
    case 'system_alert':      return 'priority_high'
    case 'appointment':       return 'event'
    default:                  return 'notifications'
  }
}

// Цвет иконки по типу
function colorFor(type) {
  switch (type) {
    case 'bonus_credited':    return '#10b981'  // зелёный
    case 'call_missed':       return '#ef4444'  // красный
    case 'system_alert':      return '#f59e0b'  // оранжевый
    default:                  return '#0097A7'  // teal accent
  }
}

export default function NotificationsBell({ size = 36, variant = 'square' }) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)   // exit-анимация dropdown'а
  const [closing, setClosing] = useState(false)
  const [items, setItems] = useState([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(false)
  const ref = useRef(null)

  // Гарантируем CSS-анимацию dropdown'а (200ms slide+fade)
  useEffect(() => { ensureDropdownAnim() }, [])

  // Mount/unmount sync с open для проигрывания exit-анимации
  useEffect(() => {
    if (open) { setMounted(true); setClosing(false); return }
    if (mounted) {
      setClosing(true)
      const t = setTimeout(() => { setMounted(false); setClosing(false) }, 200)
      return () => clearTimeout(t)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Загрузка уведомлений
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.get('/notifications/recent')
      setItems(r.data.items || [])
      setUnread(r.data.unread || 0)
    } catch {
      // Тихо — иконка остаётся, dropdown пустой
      setItems([])
      setUnread(0)
    } finally {
      setLoading(false)
    }
  }, [])

  // Полная загрузка при открытии и опрос каждые 60 сек для бейджа
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const t = setInterval(load, 60000)
    return () => clearInterval(t)
  }, [load])

  // Закрытие при клике вне dropdown
  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  // Отметить прочитанным
  const markRead = async (id) => {
    try {
      await api.post(`/notifications/${id}/read`)
      setItems(prev => prev.map(it => it.id === id ? { ...it, is_read: true } : it))
      setUnread(prev => Math.max(0, prev - 1))
    } catch {
      /* noop */
    }
  }

  const toggle = () => {
    setOpen(o => !o)
    // При открытии — обновим
    if (!open) load()
  }

  // Стилизация кнопки в зависимости от варианта
  const btnStyle = variant === 'round'
    ? {
        width: size, height: size,
        borderRadius: '50%',
        border: 0, background: 'transparent',
        cursor: 'pointer', position: 'relative',
        display: 'inline-grid', placeItems: 'center',
      }
    : {
        width: size, height: size,
        borderRadius: 10,
        background: 'var(--bg-1, #f7f9fb)',
        border: '1px solid var(--border, rgba(0,0,0,0.08))',
        color: 'var(--fg-2, #4a4f5a)',
        cursor: 'pointer', position: 'relative',
        display: 'inline-grid', placeItems: 'center',
      }

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={toggle}
        title={unread > 0 ? `Непрочитанных: ${unread}` : 'Уведомления'}
        aria-label="Уведомления"
        style={btnStyle}
        className={variant === 'round' ? 'hover:bg-[#eceef0] dark:hover:bg-gray-800' : ''}
      >
        <span className="material-symbols-outlined" style={{ fontSize: variant === 'round' ? 20 : 19 }}>
          notifications
        </span>
        {unread > 0 && (
          <span
            className="absolute font-bold grid place-items-center"
            style={{
              top: -3, right: -3,
              minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999,
              background: '#ef4444', color: '#fff',
              fontSize: 10,
              boxShadow: '0 0 0 2px var(--surface, #fff)',
            }}
          >{unread > 99 ? '99+' : unread}</span>
        )}
      </button>

      {mounted && (
        <div
          className={closing ? 'ks-dd-leave' : 'ks-dd-enter'}
          style={{
            position: 'absolute', top: 'calc(100% + 8px)', right: 0,
            width: 360, maxWidth: '92vw', zIndex: 100,
            background: 'var(--surface, #fff)',
            color: 'var(--fg, #191c1e)',
            border: '1px solid var(--border, rgba(0,0,0,0.08))',
            borderRadius: 12,
            boxShadow: '0 10px 40px rgba(0,0,0,0.15)',
            overflow: 'hidden',
            transformOrigin: 'top right',
          }}
          role="menu"
        >
          <div className="flex items-center justify-between" style={{
            padding: '10px 14px',
            borderBottom: '1px solid var(--border, rgba(0,0,0,0.08))',
          }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Уведомления</div>
            {unread > 0 && (
              <span style={{
                fontSize: 11, padding: '2px 7px', borderRadius: 999,
                background: '#ef4444', color: '#fff', fontWeight: 700,
              }}>{unread} новых</span>
            )}
          </div>

          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            {loading && (
              <div style={{ padding: 18, textAlign: 'center', fontSize: 13, color: 'var(--fg-3, #727783)' }}>
                Загрузка…
              </div>
            )}
            {!loading && items.length === 0 && (
              <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--fg-3, #727783)' }}>
                <div className="material-symbols-outlined" style={{ fontSize: 36, opacity: 0.4 }}>notifications_off</div>
                <div style={{ marginTop: 6 }}>Уведомлений пока нет</div>
              </div>
            )}
            {!loading && items.map(it => {
              const isUnread = !it.is_read
              return (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => isUnread && markRead(it.id)}
                  className="w-full flex items-start gap-3 text-left"
                  style={{
                    padding: '10px 14px',
                    background: isUnread ? 'var(--accent-soft, rgba(0,151,167,0.06))' : 'transparent',
                    border: 0, borderBottom: '1px solid var(--border, rgba(0,0,0,0.05))',
                    cursor: isUnread ? 'pointer' : 'default',
                  }}
                >
                  <span
                    className="material-symbols-outlined flex-shrink-0"
                    style={{ fontSize: 20, color: colorFor(it.type), marginTop: 1 }}
                  >{iconFor(it.type)}</span>
                  <span className="flex-1 min-w-0">
                    <div style={{ fontSize: 13, fontWeight: isUnread ? 600 : 500, lineHeight: 1.35 }}>
                      {it.text || it.title || 'Уведомление'}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--fg-3, #727783)', marginTop: 2 }}>
                      {relTime(it.created_at)}
                    </div>
                  </span>
                  {isUnread && (
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: '#0097A7', flexShrink: 0, marginTop: 6,
                    }} />
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
