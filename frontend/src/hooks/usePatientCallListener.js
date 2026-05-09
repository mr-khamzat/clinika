/**
 * ========================================
 * БЛОК: usePatientCallListener — realtime входящие звонки в ЛК
 * ========================================
 * Открывает WS /patient/notifications/ws/{phone}?token={...} и слушает
 * incoming_call / call_cancelled. Возвращает {incomingCall, dismissCall}.
 *
 * Auto-reconnect с exponential backoff: 1s → 2s → 5s → 10s, потом 10s.
 * Heartbeat — backend сам шлёт ping каждые 30с, мы отвечаем pong.
 *
 * Использование (в PatientCabinet.jsx):
 *   const { incomingCall, dismissCall } = usePatientCallListener({ phone, token })
 *   <IncomingCallModal call={incomingCall} onDismiss={dismissCall} />
 *
 * Параметры:
 *   phone — нормализованный телефон (E.164 без +) или с + — backend нормализует.
 *   token — patient_session_token (предпочтительно) или patient_token.
 *   apiBase — base URL backend (для построения wss).
 * ========================================
 */
import { useEffect, useRef, useState, useCallback } from 'react'

const RECONNECT_DELAYS = [1000, 2000, 5000, 10000] // потом всегда 10s

export default function usePatientCallListener({ phone, token, apiBase }) {
  const [incomingCall, setIncomingCall] = useState(null)
  const wsRef = useRef(null)
  const attemptRef = useRef(0)
  const reconnectTimerRef = useRef(null)
  const closedByUserRef = useRef(false)

  const dismissCall = useCallback(() => {
    setIncomingCall(null)
  }, [])

  useEffect(() => {
    if (!phone || !token || !apiBase) return undefined
    closedByUserRef.current = false

    // Строим wss/ws URL из apiBase (http→ws, https→wss).
    const wsBase = apiBase.replace(/^http/, 'ws')
    const url = `${wsBase}/patient/notifications/ws/${encodeURIComponent(phone)}?token=${encodeURIComponent(token)}`

    function connect() {
      if (closedByUserRef.current) return
      let ws
      try {
        ws = new WebSocket(url)
      } catch (e) {
        // На случай если URL невалидный — пробуем через delay.
        scheduleReconnect()
        return
      }
      wsRef.current = ws

      ws.onopen = () => {
        attemptRef.current = 0 // успешно — сбрасываем backoff
      }

      ws.onmessage = (ev) => {
        let msg
        try { msg = JSON.parse(ev.data) } catch { return }
        if (!msg || typeof msg !== 'object') return

        switch (msg.type) {
          case 'connected':
          case 'pong':
            break
          case 'ping':
            // Отвечаем pong, чтобы backend знал что клиент жив.
            try { ws.send(JSON.stringify({ type: 'pong' })) } catch {}
            break
          case 'incoming_call':
            setIncomingCall({
              session_id: msg.session_id,
              join_url: msg.join_url,
              doctor_name: msg.doctor_name || 'Врач',
              expires_at: msg.expires_at,
            })
            break
          case 'call_cancelled':
            // Закрываем модалку только если это та же сессия (на случай гонки).
            setIncomingCall((cur) =>
              cur && cur.session_id === msg.session_id ? null : cur
            )
            break
          default:
            // unknown — игнорируем.
        }
      }

      ws.onclose = () => {
        wsRef.current = null
        if (!closedByUserRef.current) scheduleReconnect()
      }

      ws.onerror = () => {
        // close() сработает следом — там и будет reconnect.
      }
    }

    function scheduleReconnect() {
      const idx = Math.min(attemptRef.current, RECONNECT_DELAYS.length - 1)
      const delay = RECONNECT_DELAYS[idx]
      attemptRef.current += 1
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = setTimeout(connect, delay)
    }

    connect()

    return () => {
      closedByUserRef.current = true
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      const ws = wsRef.current
      wsRef.current = null
      if (ws) {
        try { ws.close() } catch {}
      }
    }
  }, [phone, token, apiBase])

  return { incomingCall, dismissCall }
}
