/**
 * ========================================
 * БЛОК: <ImpersonationBanner> — глобальная плашка режима impersonation
 * ========================================
 * Показывается ТОЛЬКО если в текущем admin-JWT присутствует claim imp=true.
 * Сидит фиксированно сверху над всем приложением, толкая контент вниз.
 *
 * UX:
 *   • Анимация slide-down при появлении (transition 240ms cubic-bezier)
 *   • Импersonator/target ФИО + причина + обратный таймер до истечения JWT (30мин)
 *   • Кнопка «Выйти из режима» → POST /admin/impersonate/stop →
 *     • восстановить super_admin token из clinika_impersonation_origin
 *     • очистить localStorage.clinika_impersonation_origin
 *     • redirect → /admin
 *   • Z-index 9999 чтобы перекрывать любые dropdown / drawer
 *
 * Декодирование JWT: jose в проекте не подключён к фронту, поэтому делаем
 * простой base64-decode payload (без проверки подписи — она не нужна на клиенте).
 * ========================================
 */
import { useEffect, useMemo, useState } from 'react'
import { SLUG } from '../config'
import api from '../api'

// ─── Базовая декодировка JWT (только payload, без верификации) ────────────
function decodeJwt(token) {
  if (!token || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    return JSON.parse(atob(padded))
  } catch {
    return null
  }
}

// Стабильное чтение admin-токена для текущего тенант-слага
function readAdminToken() {
  try {
    return localStorage.getItem('clinika_admin_token_' + SLUG)
  } catch {
    return null
  }
}

// Форматирование оставшегося времени mm:ss
function fmtTimeLeft(seconds) {
  if (seconds == null || seconds < 0) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function ImpersonationBanner() {
  const [imp, setImp]   = useState(null)         // { actor_name, target_name, exp, reason }
  const [now, setNow]   = useState(Date.now())
  const [exiting, setExiting] = useState(false)
  const [show, setShow]       = useState(false)  // для анимации slide-down

  // Перечитываем токен при каждом маунте / при storage events
  useEffect(() => {
    function refresh() {
      const tok = readAdminToken()
      const p = decodeJwt(tok)
      if (p && p.imp === true) {
        setImp({
          target_id: p.sub,
          target_role: p.role,
          actor_id: p.act,
          actor_name: p.act_name || 'super_admin',
          target_name: null,  // подгрузим ниже через /admin/impersonate/active
          reason: p.imp_reason || '',
          exp: typeof p.exp === 'number' ? p.exp * 1000 : null,
        })
      } else {
        setImp(null)
      }
    }
    refresh()
    window.addEventListener('storage', refresh)
    return () => window.removeEventListener('storage', refresh)
  }, [])

  // Подгружаем имя target из бэкенда (заодно валидируем сессию)
  useEffect(() => {
    if (!imp) return
    let mounted = true
    api.get('/admin/impersonate/active').then(r => {
      if (!mounted) return
      const d = r.data
      if (!d?.active) {
        setImp(null)
        return
      }
      setImp(prev => prev && ({
        ...prev,
        target_name: d.target?.full_name || prev.target_name,
        actor_name: d.actor?.full_name || prev.actor_name,
        reason: d.reason ?? prev.reason,
      }))
    }).catch(() => { /* токен недействителен — банер останется по локальному payload */ })
    return () => { mounted = false }
  }, [imp?.target_id])

  // Slide-down анимация
  useEffect(() => {
    if (imp) {
      // RAF чтобы DOM успел вставить элемент перед applied transform
      requestAnimationFrame(() => setShow(true))
    } else {
      setShow(false)
    }
  }, [imp])

  // Таймер обратного отсчёта
  useEffect(() => {
    if (!imp?.exp) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [imp?.exp])

  const secondsLeft = useMemo(() => {
    if (!imp?.exp) return null
    return Math.max(0, Math.floor((imp.exp - now) / 1000))
  }, [imp?.exp, now])

  // Авто-выход при истечении токена
  useEffect(() => {
    if (secondsLeft === 0) {
      handleStop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft])

  // ── Выход из impersonation ────────────────────────────────────────────
  async function handleStop() {
    if (exiting) return
    setExiting(true)
    try {
      const r = await api.post('/admin/impersonate/stop')
      const restored = r?.data?.access_token
      if (restored) {
        // Восстанавливаем super_admin-токен. Origin-storage очищаем — режим завершён.
        // Слаг super_admin — пустой (платформа /admin).
        try {
          localStorage.setItem('clinika_admin_token_', restored)
          localStorage.removeItem('clinika_admin_token_' + SLUG)
          localStorage.removeItem('clinika_impersonation_origin')
        } catch (_) { /* noop */ }
      } else {
        // Fallback: ручной откат из origin-копии
        try {
          const origin = localStorage.getItem('clinika_impersonation_origin')
          if (origin) {
            localStorage.setItem('clinika_admin_token_', origin)
            localStorage.removeItem('clinika_impersonation_origin')
          }
          localStorage.removeItem('clinika_admin_token_' + SLUG)
        } catch (_) { /* noop */ }
      }
      // Принудительный full reload — гарантия что все React-стейты и api-перехватчики
      // подхватят новый токен.
      window.location.href = r?.data?.redirect_url || '/admin'
    } catch (e) {
      // Даже при ошибке — пытаемся восстановить из origin
      try {
        const origin = localStorage.getItem('clinika_impersonation_origin')
        if (origin) {
          localStorage.setItem('clinika_admin_token_', origin)
          localStorage.removeItem('clinika_impersonation_origin')
          localStorage.removeItem('clinika_admin_token_' + SLUG)
          window.location.href = '/admin'
          return
        }
      } catch (_) { /* noop */ }
      setExiting(false)
      alert('Не удалось выйти из режима impersonation: ' + (e?.response?.data?.detail || e?.message || 'ошибка'))
    }
  }

  if (!imp) return null

  // ── Премиум-стиль: красная полоса с пульсирующей иконкой ──────────────
  return (
    <>
      {/* Spacer чтобы основной контент не съезжал под фиксированной полосой */}
      <div style={{ height: show ? 48 : 0, transition: 'height 240ms cubic-bezier(0.4,0,0.2,1)' }} />
      <div
        role="alert"
        aria-live="assertive"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: 48,
          zIndex: 9999,
          background: 'linear-gradient(90deg, #dc2626 0%, #b91c1c 100%)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 16px',
          boxShadow: '0 4px 16px rgba(220, 38, 38, 0.35)',
          transform: show ? 'translateY(0)' : 'translateY(-100%)',
          transition: 'transform 240ms cubic-bezier(0.4, 0, 0.2, 1)',
          fontSize: 14,
          fontWeight: 500,
          letterSpacing: 0.1,
        }}
      >
        {/* Пульсирующая иконка глаз */}
        <span
          className="material-symbols-outlined"
          style={{
            fontSize: 22,
            marginRight: 10,
            animation: 'imp-pulse 1.6s ease-in-out infinite',
            filter: 'drop-shadow(0 0 6px rgba(255,255,255,0.5))',
          }}
        >
          visibility
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'center', flex: 1, minWidth: 0 }}>
          <span style={{ whiteSpace: 'nowrap' }}>
            <strong>Режим impersonation:</strong> вы видите систему как{' '}
            <strong>{imp.target_name || 'пользователь'}</strong>
            {imp.target_role && <span style={{ opacity: 0.85 }}> ({imp.target_role})</span>}
          </span>
          {imp.reason && (
            <span style={{ opacity: 0.92, fontStyle: 'italic', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              · «{imp.reason}»
            </span>
          )}
          <span style={{ opacity: 0.85, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
            · осталось {fmtTimeLeft(secondsLeft)}
          </span>
          <span style={{ opacity: 0.85 }}>· все действия логируются</span>
        </div>

        <button
          onClick={handleStop}
          disabled={exiting}
          style={{
            background: 'rgba(255, 255, 255, 0.18)',
            border: '1px solid rgba(255, 255, 255, 0.4)',
            color: '#fff',
            padding: '6px 14px',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            cursor: exiting ? 'wait' : 'pointer',
            transition: 'background 150ms',
            marginLeft: 12,
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.28)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.18)' }}
        >
          {exiting ? 'Выход…' : '↩ Выйти из режима'}
        </button>
      </div>

      {/* CSS keyframes — внутри компонента чтобы не плодить отдельный CSS */}
      <style>{`
        @keyframes imp-pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50%      { transform: scale(1.18); opacity: 0.78; }
        }
      `}</style>
    </>
  )
}
