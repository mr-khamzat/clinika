/**
 * useChatSoundNotification — короткий звуковой сигнал на новое сообщение.
 *
 * Реализован через Web Audio API (без mp3-файла, чтобы не возить ассет).
 * Двухнотный «ping»: ~880 Hz → ~660 Hz, ~120 мс. Без громких эффектов.
 *
 * Использование:
 *   const playSound = useChatSoundNotification({ enabled: settings.sound })
 *   // ... в onMessageArrived: playSound()
 */
import { useCallback, useRef } from 'react'

export default function useChatSoundNotification({ enabled = true, volume = 0.18 } = {}) {
  const ctxRef = useRef(null)

  return useCallback(() => {
    if (!enabled) return
    if (typeof window === 'undefined') return
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext
      if (!AudioCtx) return
      if (!ctxRef.current) ctxRef.current = new AudioCtx()
      const ctx = ctxRef.current
      if (ctx.state === 'suspended') ctx.resume()

      const now = ctx.currentTime
      // Узел громкости с быстрым fade in/out (избегаем щелчков).
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0, now)
      gain.gain.linearRampToValueAtTime(volume, now + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18)
      gain.connect(ctx.destination)

      // Первая нота: A5 (880 Hz)
      const o1 = ctx.createOscillator()
      o1.type = 'sine'
      o1.frequency.setValueAtTime(880, now)
      o1.frequency.exponentialRampToValueAtTime(660, now + 0.09)
      o1.connect(gain)
      o1.start(now)
      o1.stop(now + 0.2)
    } catch {
      // Тишина лучше ошибки — пользователь просто не услышит.
    }
  }, [enabled, volume])
}
