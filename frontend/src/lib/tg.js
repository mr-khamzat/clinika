/**
 * ========================================
 * БЛОК: Telegram Web App SDK — безопасная обёртка
 * ========================================
 * Приложение работает в двух режимах:
 *   Режим 1: Standalone Web App — Telegram недоступен, обычный веб-вход
 *   Режим 2: Telegram Mini App  — SDK загружен, работаем внутри Telegram
 *
 * Принцип: Telegram SDK НИКОГДА не блокирует запуск приложения.
 * Если SDK не загрузился за SDK_WAIT_MS мс — работаем как веб-апп.
 * ========================================
 */

/** Максимальное время ожидания SDK (мс). После — режим веб-апп. */
const SDK_WAIT_MS = 2000
/** URL Telegram Web App SDK */
const SDK_URL = 'https://telegram.org/js/telegram-web-app.js'

/**
 * Динамически подключает Telegram Web App SDK к странице.
 * Безопасно вызывать многократно: повторные вызовы возвращают первый Promise.
 * Если сеть недоступна или Telegram заблокирован — Promise резолвится как false
 * (приложение продолжит работать как обычный веб-апп).
 *
 * Используется только в PatientCabinet (/p/) и при детекте Telegram MiniApp в App.jsx.
 * Из глобального index.html SDK НЕ грузится — он не нужен лендингу/admin/manager.
 */
let _sdkPromise = null
export const loadTelegramSDK = () => {
  if (typeof document === 'undefined') return Promise.resolve(false)
  if (window.Telegram?.WebApp) return Promise.resolve(true)
  if (_sdkPromise) return _sdkPromise
  _sdkPromise = new Promise(resolve => {
    // Скрипт мог быть уже добавлен другим вызовом — не дублируем
    const existing = document.querySelector(`script[src="${SDK_URL}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve(true), { once: true })
      existing.addEventListener('error', () => resolve(false), { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = SDK_URL
    script.async = true
    script.onload = () => resolve(true)
    script.onerror = () => {
      console.info('[TG] SDK недоступен — работаем как веб-приложение')
      resolve(false)
    }
    document.head.appendChild(script)
  })
  return _sdkPromise
}

/**
 * Ждёт загрузки Telegram SDK с таймаутом.
 * Возвращает объект WebApp если внутри Telegram, или null для веб-браузера.
 *
 * Логика:
 * - Если URL не содержит tgWebApp в hash — не в Telegram, resolve(null) немедленно
 * - Если содержит — динамически подгружаем SDK и ждём до SDK_WAIT_MS мс
 */
export const waitForTelegramSDK = (timeout = SDK_WAIT_MS) =>
  new Promise(resolve => {
    // SDK уже загружен и есть пользователь — точно в Telegram
    if (window.Telegram?.WebApp?.initDataUnsafe?.user) {
      resolve(window.Telegram.WebApp)
      return
    }

    // Telegram Mini App добавляет tgWebApp* параметры в hash при открытии
    const isLikelyTelegram = (window.location.hash || '').includes('tgWebApp')
    if (!isLikelyTelegram) {
      // Обычный браузер — не ждём SDK вообще
      resolve(null)
      return
    }

    // Похоже на Telegram Mini App — догружаем SDK динамически и ждём
    loadTelegramSDK()

    const timer = setTimeout(() => {
      clearInterval(interval)
      console.info('[TG] SDK timeout — работаем как веб-приложение')
      resolve(null)
    }, timeout)

    const interval = setInterval(() => {
      if (window.Telegram?.WebApp?.initDataUnsafe?.user) {
        clearTimeout(timer)
        clearInterval(interval)
        resolve(window.Telegram.WebApp)
      }
    }, 50)
  })

/** Инициализирует Telegram WebApp (ready + expand). Безопасно — ничего не делает если tg === null. */
export const initTgApp = (tg) => {
  try {
    if (tg) { tg.ready(); tg.expand() }
  } catch (e) {
    console.warn('[TG] init error:', e)
  }
}

/** Проверка: сейчас внутри Telegram Mini App? */
export const isTelegramWebApp = () =>
  !!(window.Telegram?.WebApp?.initDataUnsafe?.user)

/** Получить пользователя из Telegram SDK (или null) */
export const getTgUser = () =>
  window.Telegram?.WebApp?.initDataUnsafe?.user || null

/** Получить initData для верификации на бэкенде */
export const getTgInitData = () =>
  window.Telegram?.WebApp?.initData || ''
