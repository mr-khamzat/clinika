/**
 * ========================================
 * БЛОК: <QuickActions> — высокоуровневая обёртка для карточек (W4)
 * ========================================
 * Унифицированный набор из 5 быстрых действий для карточек пациентов и врачей:
 *   1. Позвонить       (call / clinikset://call?phone=...)
 *   2. WhatsApp        (https://wa.me/{phone})
 *   3. Перенести запись (event_repeat) — onReschedule
 *   4. Отменить запись  (cancel)       — onCancel
 *   5. Печать визита    (print)        — onPrint или auto (printVisit)
 *
 * Внутри использует базовый компонент дизайн-системы
 * @/design QuickActions для рендеринга и стилей.
 *
 * Props:
 *   context     'patient' | 'doctor' | 'appointment'   (по умолчанию 'patient')
 *   patient     { phone, name, ... }                   данные пациента
 *   doctor      { phone_number, full_name, ... }       данные врача
 *   appointment { id, patient_phone, patient_name, qr_code, doctor_name, ... }
 *   onCall, onWhatsApp, onReschedule, onCancel, onPrint   override-обработчики
 *   size        'sm' | 'md'   compact = (size === 'sm')
 *   variant     'row' | 'menu'   row — все 5 в линию, menu — кнопка more_vert + dropdown
 *   className   override-класс корня
 *
 * Если phone не задан — call/whatsapp кнопки скрываются.
 * Если onReschedule/onCancel не передан — соответствующая кнопка скрывается.
 * Печать всегда доступна (fallback на printVisit), кроме явного hidePrint.
 * ========================================
 */
import { useState, useRef, useEffect } from 'react'
import BaseQuickActions, { buildPatientCardActions } from '../design/components/QuickActions'
import { callPhone, whatsappPhone, printVisit } from '../lib/phoneActions'

/** Извлечь телефон из пропсов в зависимости от контекста */
function pickPhone({ context, patient, doctor, appointment }) {
  if (context === 'doctor') return doctor?.phone_number || doctor?.phone || ''
  if (context === 'appointment') return appointment?.patient_phone || patient?.phone || ''
  return patient?.phone || patient?.phone_number || appointment?.patient_phone || ''
}

/** Извлечь имя для печати */
function pickName({ context, patient, doctor, appointment }) {
  if (context === 'doctor') return doctor?.full_name || ''
  return appointment?.patient_name || patient?.full_name || patient?.name || ''
}

export default function QuickActions({
  context = 'patient',
  patient,
  doctor,
  appointment,
  onCall,
  onWhatsApp,
  onReschedule,
  onCancel,
  onPrint,
  hidePrint = false,
  hideReschedule = false,
  hideCancel = false,
  size = 'md',
  variant = 'row',
  className = '',
}) {
  const phone = pickPhone({ context, patient, doctor, appointment })
  const name = pickName({ context, patient, doctor, appointment })
  const compact = size === 'sm'

  const handleCall = () => (onCall ? onCall(phone) : callPhone(phone))
  const handleWhatsApp = () => (onWhatsApp ? onWhatsApp(phone) : whatsappPhone(phone))
  const handlePrint = () => {
    if (onPrint) return onPrint()
    printVisit({
      patient_name: name,
      patient_phone: phone,
      qr_code: appointment?.qr_code,
      doctor_name: appointment?.doctor_name || doctor?.full_name,
      date: appointment?.appointment_date || appointment?.date,
      time: appointment?.start_time || appointment?.time,
      clinic_name: appointment?.clinic_name,
    })
  }

  // Печать недоступна, если контекст doctor (нечего печатать) — кроме явного onPrint
  const canPrint = !hidePrint && (onPrint || appointment || context === 'patient' || context === 'appointment')

  /** Сборка списка экшенов в едином формате (для row и menu) */
  const items = [
    {
      key: 'call',
      icon: 'call',
      title: 'Позвонить',
      onClick: handleCall,
      hidden: !phone,
    },
    {
      key: 'whatsapp',
      icon: 'chat',           // Material symbol для WhatsApp ("chat" заполненный)
      title: 'WhatsApp',
      onClick: handleWhatsApp,
      hidden: !phone,
    },
    {
      key: 'reschedule',
      icon: 'event_repeat',
      title: 'Перенести запись',
      onClick: onReschedule,
      hidden: hideReschedule || !onReschedule,
    },
    {
      key: 'cancel',
      icon: 'cancel',
      title: 'Отменить запись',
      onClick: onCancel,
      danger: true,
      hidden: hideCancel || !onCancel,
    },
    {
      key: 'print',
      icon: 'print',
      title: 'Печать визита',
      onClick: handlePrint,
      hidden: !canPrint,
    },
  ]

  const visible = items.filter(a => !a.hidden)
  if (visible.length === 0) return null

  if (variant === 'menu') {
    return (
      <MenuVariant items={visible} compact={compact} className={className} />
    )
  }

  // row variant — используем готовый базовый компонент
  return (
    <BaseQuickActions
      actions={visible}
      compact={compact}
      className={className}
    />
  )
}

// ─── Re-export фабрики для совместимости со старыми вызовами ────────────────
export { buildPatientCardActions }

// ─── Menu variant: кнопка more_vert + выпадающий список ──────────────────────
function MenuVariant({ items, compact, className }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('touchstart', handler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('touchstart', handler)
    }
  }, [open])

  const btnSize = compact ? 32 : 44

  return (
    <div ref={wrapRef} className={`ks-qa-menu-wrap ${className}`} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
        title="Действия"
        aria-label="Действия"
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          width: btnSize, height: btnSize,
          minWidth: btnSize,
          display: 'inline-grid', placeItems: 'center',
          borderRadius: 10,
          background: 'var(--bg-1, #f7f9fb)',
          color: 'var(--fg-2, #4a4f5a)',
          border: '1px solid var(--border, rgba(0,0,0,0.08))',
          cursor: 'pointer',
          transition: 'background 160ms ease, transform 120ms ease',
        }}
        onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.96)' }}
        onMouseUp={(e) => { e.currentTarget.style.transform = '' }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = '' }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 20 }}>more_vert</span>
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', right: 0, top: btnSize + 4,
            minWidth: 200, padding: 4,
            background: 'var(--surface, #ffffff)',
            border: '1px solid var(--border, rgba(0,0,0,0.08))',
            borderRadius: 12,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            zIndex: 60,
          }}
        >
          {items.map(it => (
            <button
              key={it.key}
              role="menuitem"
              type="button"
              disabled={it.disabled}
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
                it.onClick && it.onClick(e)
              }}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px',
                minHeight: 44,
                background: 'transparent',
                color: it.danger ? 'var(--bad, #dc2626)' : 'var(--fg, #191c1e)',
                border: 'none', borderRadius: 8,
                cursor: it.disabled ? 'not-allowed' : 'pointer',
                opacity: it.disabled ? 0.45 : 1,
                fontSize: 14,
                textAlign: 'left',
                transition: 'background 120ms ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-2, #eef0f4)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}>
                {it.icon}
              </span>
              <span>{it.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
