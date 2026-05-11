// ============================================================================
// SwitchContextBanner — баннер активного контекста семьи
// ============================================================================
//
// Когда пользователь переключил кабинет на родственника (через FamilyMemberCard
// → onSwitch), в sessionStorage['family_active_patient'] лежит контекст
// { patient_id, full_name, is_self:false, ... }. Этот баннер появляется
// сверху страниц кабинета и позволяет вернуться к self.
//
// Сам контекст слушает событие 'patient:context-changed' — диспатчится из
// PatientFamilySection при каждом переключении. Так баннер реактивен без
// центрального стора.
// ============================================================================

import { useEffect, useState } from 'react'

const ACTIVE_KEY = 'family_active_patient' // sessionStorage

function readCtx() {
  try {
    const raw = sessionStorage.getItem(ACTIVE_KEY)
    if (!raw) return null
    const obj = JSON.parse(raw)
    if (!obj || obj.is_self) return null
    return obj
  } catch { return null }
}

export default function SwitchContextBanner() {
  const [ctx, setCtx] = useState(() => (typeof window !== 'undefined' ? readCtx() : null))
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const handler = (ev) => {
      const detail = ev?.detail
      if (detail && !detail.is_self) {
        setCtx(detail)
        setVisible(true)
      } else {
        setCtx(null)
        setVisible(false)
      }
    }
    window.addEventListener('patient:context-changed', handler)
    // При первом mount — если уже есть контекст — показать с fade-in
    if (ctx) {
      // Двойной requestAnimationFrame чтобы CSS-transition реально сработал
      requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)))
    }
    return () => window.removeEventListener('patient:context-changed', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const back = () => {
    try { sessionStorage.removeItem(ACTIVE_KEY) } catch {}
    try { window.dispatchEvent(new CustomEvent('patient:context-changed', { detail: { is_self: true } })) } catch {}
    setVisible(false)
    setTimeout(() => setCtx(null), 250)
  }

  if (!ctx || ctx.is_self) return null

  return (
    <div
      className="sticky top-0 z-30 px-3 py-2"
      style={{
        background: 'linear-gradient(135deg, #FCE7F3, #FEF3C7)',
        borderBottom: '1px solid rgba(0,0,0,.05)',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(-8px)',
        transition: 'opacity .25s ease, transform .25s ease',
      }}
    >
      <div className="max-w-2xl mx-auto flex items-center gap-2">
        <span className="material-symbols-outlined text-base flex-shrink-0" style={{ color: '#9D174D' }}>
          swap_horiz
        </span>
        <p className="text-[12px] font-semibold flex-1 min-w-0 truncate" style={{ color: '#0A2342' }}>
          Сейчас вы смотрите кабинет: <span className="font-bold">{ctx.full_name || 'родственника'}</span>
        </p>
        <button
          onClick={back}
          className="text-[11px] font-bold px-2.5 py-1 rounded-lg transition-all active:scale-95 flex-shrink-0"
          style={{ background: '#0A2342', color: '#fff' }}>
          К себе
        </button>
      </div>
    </div>
  )
}
