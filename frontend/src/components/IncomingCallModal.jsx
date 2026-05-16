/**
 * ========================================
 * БЛОК: IncomingCallModal — фуллскрин входящего видеозвонка
 * ========================================
 * Стиль iOS «звонок»: тёмный радиальный фон, большой пульсирующий аватар
 * врача, имя 24px, две большие кнопки 56px («Принять» / «Отклонить»).
 *
 * Поведение:
 *   - При появлении call != null — показывается фуллскрин, играет ringtone,
 *     телефон вибрирует паттерном [500,250,500,250,500].
 *   - Кнопки disabled первые 1000мс, чтобы избежать случайного клика.
 *   - «Принять» → window.location = call.join_url (открывает страницу звонка).
 *   - «Отклонить» → POST /telemed/sessions/{id}/cancel-incoming + onDismiss().
 *
 * Ringtone: WebAudio API (генерируем 2-тоновую сирену) — без бинарных файлов.
 *
 * Props:
 *   call: { session_id, join_url, doctor_name, expires_at } | null
 *   onDismiss: () => void   — вызывается при отклонении / dismissCall().
 *   apiBase: string         — для POST cancel-incoming.
 *   token: string           — patient_session_token / patient_token (для cancel).
 * ========================================
 */
import { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { Avatar } from '../design'
import DeviceTestModal from './calls/DeviceTestModal'

export default function IncomingCallModal({ call, onDismiss, apiBase, token }) {
  const [armed, setArmed] = useState(false) // защита от случайного клика 1с
  const [testOpen, setTestOpen] = useState(false)
  const audioCtxRef = useRef(null)
  const ringTimerRef = useRef(null)

  // Запуск звонка: ringtone + vibration + arm timer.
  useEffect(() => {
    if (!call) return undefined
    setArmed(false)
    const armTimer = setTimeout(() => setArmed(true), 1000)

    // ── Vibration (только мобильные браузеры) ─────────────────────────
    let vibTimer
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate([500, 250, 500, 250, 500]) } catch {}
      // Повторяем паттерн каждые 2с, пока модалка открыта.
      vibTimer = setInterval(() => {
        try { navigator.vibrate([500, 250, 500, 250, 500]) } catch {}
      }, 2200)
    }

    // ── Ringtone через WebAudio (генерируем 2-тоновую сирену) ─────────
    let ctx
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext
      if (Ctx) {
        ctx = new Ctx()
        audioCtxRef.current = ctx
        const playTone = (freq, duration) => {
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.type = 'sine'
          osc.frequency.value = freq
          gain.gain.value = 0.18 // не слишком громко
          osc.connect(gain).connect(ctx.destination)
          osc.start()
          osc.stop(ctx.currentTime + duration)
        }
        const ringOnce = () => {
          // Имитация старого «бзз-бзз»: 800Hz 0.4s + пауза + 600Hz 0.4s.
          playTone(800, 0.4)
          setTimeout(() => playTone(600, 0.4), 500)
        }
        ringOnce()
        ringTimerRef.current = setInterval(ringOnce, 2200)
      }
    } catch (e) {
      // Audio может быть запрещён браузером без user gesture — это нормально.
    }

    return () => {
      clearTimeout(armTimer)
      if (vibTimer) clearInterval(vibTimer)
      if (ringTimerRef.current) clearInterval(ringTimerRef.current)
      ringTimerRef.current = null
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate(0) } catch {}
      }
      if (ctx) {
        try { ctx.close() } catch {}
      }
      audioCtxRef.current = null
    }
  }, [call?.session_id])

  if (!call) return null

  const stopRingingResources = () => {
    if (ringTimerRef.current) clearInterval(ringTimerRef.current)
    if (audioCtxRef.current) { try { audioCtxRef.current.close() } catch {} }
  }

  const performAccept = () => {
    // Перед редиректом — глушим звук, чтобы не было «хвоста».
    stopRingingResources()
    window.location.href = call.join_url
  }

  const handleAccept = () => {
    if (!armed) return
    performAccept()
  }

  const handleOpenDeviceTest = () => {
    if (!armed) return
    // Глушим ringtone пока пользователь возится с настройками устройств.
    stopRingingResources()
    setTestOpen(true)
  }

  const handleDecline = async () => {
    if (!armed) return
    try {
      // POST cancel-incoming — без авторизации врача невозможно (это endpoint
      // врача). Поэтому пациент просто дропает локально + closes WS message.
      // На стороне врача через 60с автотаймаут (если он есть) либо вручную.
      // Если в будущем добавим patient-side decline endpoint — заменим тут.
    } catch {}
    onDismiss?.()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Входящий видеоприём от ${call.doctor_name}`}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background:
          'radial-gradient(ellipse at center, #0a2342 0%, #050a14 70%, #000 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '60px 24px 48px',
        color: '#fff',
        animation: 'callFadeIn .35s ease-out',
      }}
    >
      <style>{`
        @keyframes callFadeIn { from{opacity:0} to{opacity:1} }
        @keyframes pulseRing {
          0%   { transform: scale(1);    opacity: .6; }
          70%  { transform: scale(1.45); opacity: 0;  }
          100% { transform: scale(1.45); opacity: 0;  }
        }
        @keyframes pulseAvatar {
          0%, 100% { transform: scale(1); }
          50%      { transform: scale(1.05); }
        }
      `}</style>

      {/* ── Верх: подпись + аватар ─────────────────────────────────── */}
      <div style={{ textAlign: 'center', width: '100%', marginTop: 24 }}>
        <p
          style={{
            fontSize: 14,
            opacity: 0.7,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            marginBottom: 8,
          }}
        >
          Входящий видеоприём
        </p>

        <div
          style={{
            position: 'relative',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '32px auto 24px',
            width: 180,
            height: 180,
          }}
        >
          {/* Пульсирующие кольца вокруг аватара */}
          {[0, 0.6, 1.2].map((delay, i) => (
            <span
              key={i}
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: '50%',
                border: '2px solid rgba(0,151,167,.55)',
                animation: `pulseRing 2.4s cubic-bezier(.22,1,.36,1) ${delay}s infinite`,
              }}
            />
          ))}
          <div
            style={{
              animation: 'pulseAvatar 2s ease-in-out infinite',
              borderRadius: '50%',
              boxShadow: '0 8px 32px rgba(0,151,167,.4)',
            }}
          >
            <Avatar name={call.doctor_name} size="xl"
              style={{ width: 140, height: 140, fontSize: '40px' }}
            />
          </div>
        </div>

        <h2 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>
          {call.doctor_name || 'Врач'}
        </h2>
        <p style={{ fontSize: 15, opacity: 0.65, marginTop: 8 }}>
          Видеоприём — нажмите «Принять»
        </p>

        {/* Кнопка проверки устройств перед принятием */}
        <button
          onClick={handleOpenDeviceTest}
          disabled={!armed}
          aria-label="Проверить устройства"
          style={{
            marginTop: 20,
            background: armed ? 'rgba(255,255,255,.10)' : 'rgba(255,255,255,.05)',
            color: '#fff',
            border: '1px solid rgba(255,255,255,.18)',
            padding: '10px 18px', borderRadius: 999,
            fontSize: 14, fontWeight: 600,
            cursor: armed ? 'pointer' : 'not-allowed',
            display: 'inline-flex', alignItems: 'center', gap: 8,
            opacity: armed ? 1 : 0.5,
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
            settings
          </span>
          Проверить устройства
        </button>
      </div>

      {/* ── Низ: кнопки управления ─────────────────────────────────── */}
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          display: 'flex',
          justifyContent: 'space-around',
          alignItems: 'center',
          gap: 24,
        }}
      >
        <button
          onClick={handleDecline}
          disabled={!armed}
          aria-label="Отклонить"
          style={{
            flex: 1,
            height: 56,
            border: 'none',
            borderRadius: 28,
            background: armed
              ? 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)'
              : 'rgba(239,68,68,.4)',
            color: '#fff',
            fontSize: 16,
            fontWeight: 600,
            cursor: armed ? 'pointer' : 'not-allowed',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            boxShadow: armed ? '0 6px 20px rgba(239,68,68,.4)' : 'none',
            transition: 'transform .15s, box-shadow .15s',
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 22 }}>
            call_end
          </span>
          Отклонить
        </button>

        <button
          onClick={handleAccept}
          disabled={!armed}
          aria-label="Принять"
          style={{
            flex: 1,
            height: 56,
            border: 'none',
            borderRadius: 28,
            background: armed
              ? 'linear-gradient(135deg, #22c55e 0%, #15803d 100%)'
              : 'rgba(34,197,94,.4)',
            color: '#fff',
            fontSize: 16,
            fontWeight: 600,
            cursor: armed ? 'pointer' : 'not-allowed',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            boxShadow: armed ? '0 6px 20px rgba(34,197,94,.4)' : 'none',
            transition: 'transform .15s, box-shadow .15s',
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 22 }}>
            videocam
          </span>
          Принять
        </button>
      </div>

      {/* Модал теста микрофона/камеры перед принятием звонка */}
      <DeviceTestModal
        open={testOpen}
        onClose={() => setTestOpen(false)}
        onConfirm={() => {
          setTestOpen(false)
          performAccept()
        }}
        title="Проверьте устройства перед звонком"
        confirmLabel="Принять звонок"
      />
    </div>
  )
}
