/**
 * Web Push helpers — регистрация Service Worker, подписка на push.
 *
 * Backend endpoints (см. backend/app/routers/push.py):
 *   GET    /push/vapid-public-key  — публичный VAPID-ключ (без auth)
 *   POST   /push/subscribe         — отдать endpoint + keys
 *   DELETE /push/unsubscribe       — снять подписку
 */
import api from '../api'

const SW_PATH = '/sw.js'

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

async function ensureRegistration() {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service Worker не поддерживается этим браузером')
  }
  let reg = await navigator.serviceWorker.getRegistration(SW_PATH)
  if (!reg) {
    reg = await navigator.serviceWorker.register(SW_PATH, { scope: '/' })
  }
  await navigator.serviceWorker.ready
  return reg
}

/**
 * Включает push-нотификации. Запрашивает разрешение, регистрирует SW,
 * получает VAPID, делает PushManager.subscribe, отправляет на бэк.
 * @returns {Promise<{ok: boolean, reason?: string, endpoint?: string}>}
 */
export async function enableWebPush() {
  try {
    if (!('Notification' in window) || !('PushManager' in window)) {
      return { ok: false, reason: 'Браузер не поддерживает push' }
    }
    const perm = await Notification.requestPermission()
    if (perm !== 'granted') return { ok: false, reason: 'Разрешение не получено' }

    const reg = await ensureRegistration()

    // Если уже подписаны — возвращаем существующую
    const existing = await reg.pushManager.getSubscription()
    if (existing) return { ok: true, endpoint: existing.endpoint, reused: true }

    const keyResp = await api.get('/push/vapid-public-key')
    const publicKey = keyResp.data?.public_key || keyResp.data?.key
    if (!publicKey) return { ok: false, reason: 'Backend не отдал VAPID-ключ' }

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    })
    const json = sub.toJSON()
    await api.post('/push/subscribe', {
      endpoint: json.endpoint,
      keys: json.keys,
      user_agent: navigator.userAgent,
    })
    return { ok: true, endpoint: json.endpoint, reused: false }
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) }
  }
}

/**
 * Отписывает текущего пользователя и говорит бэку забыть endpoint.
 */
export async function disableWebPush() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration(SW_PATH)
    const sub = await reg?.pushManager?.getSubscription()
    if (!sub) return { ok: true, already: true }
    await api.delete('/push/unsubscribe', { data: { endpoint: sub.endpoint } })
      .catch(() => { /* even if backend забыл — клиент всё равно отписывается */ })
    await sub.unsubscribe()
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) }
  }
}

/**
 * @returns {Promise<'granted'|'denied'|'default'|'unsupported'>}
 */
export async function getPushPermissionState() {
  if (!('Notification' in window)) return 'unsupported'
  return Notification.permission
}
