import React from 'react'
import ReactDOM from 'react-dom/client'
import './_bootstrap_staff_chat'
import App from './App'
import './index.css'


// ─── Дизайн-токены КлиникСеть (design-preview-2) ───
// Загружаются глобально один раз; CSS-переменные используются в /src/design/ и tailwind.
import './design/tokens.css'

// ─── Sentry — полностью dynamic import (Optim 2026-05-11) ───
// Раньше: import * as Sentry грузился даже без DSN (~120KB в main).
// Теперь: загружаем Sentry chunk только если DSN задан, и асинхронно
// (не блокирует первый рендер). Локальный ErrorBoundary стартует мгновенно.
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN

// Локальный фолбэк ErrorBoundary — показывается всегда (мгновенно),
// если Sentry успеет загрузиться — он перехватит будущие ошибки сам.
class LocalErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }
  componentDidCatch(error, info) {
    this.setState({ error, info })
  }
  render() {
    if (this.state.error) {
      // idx 45: в проде не показываем пользователю сырой stack trace (PII/внутренности).
      // Дружелюбный экран + кнопка перезагрузки; технические детали — только в DEV.
      // Ошибка уже логируется в Sentry (см. инициализацию ниже), а не в DOM.
      if (!import.meta.env.DEV) {
        return (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg, #f8fafc)', fontFamily: 'system-ui, -apple-system, sans-serif', padding: '24px' }}>
            <div style={{ textAlign: 'center', maxWidth: '440px' }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
              <h2 style={{ color: '#1f2937', marginBottom: '8px', fontSize: '20px' }}>Что-то пошло не так</h2>
              <p style={{ color: '#6b7280', marginBottom: '20px', fontSize: '14px', lineHeight: 1.5 }}>
                Произошла непредвиденная ошибка. Мы уже получили уведомление.
                Попробуйте обновить страницу — если проблема повторится, напишите в поддержку.
              </p>
              <button
                onClick={() => window.location.reload()}
                style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 20px', fontSize: '14px', cursor: 'pointer' }}
              >
                Обновить страницу
              </button>
            </div>
          </div>
        )
      }
      return (
        <div style={{ padding: '24px', fontFamily: 'monospace', background: '#fff', minHeight: '100vh' }}>
          <h2 style={{ color: '#c00', marginBottom: '12px' }}>Ошибка приложения</h2>
          <pre style={{ background: '#fee', padding: '12px', borderRadius: '8px', overflowX: 'auto', color: '#900', fontSize: '13px' }}>
            {this.state.error.message}
          </pre>
          <pre style={{ background: '#f5f5f5', padding: '12px', borderRadius: '8px', overflowX: 'auto', fontSize: '11px', marginTop: '12px' }}>
            {this.state.error.stack}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <LocalErrorBoundary>
      <App />
    </LocalErrorBoundary>
  </React.StrictMode>
)

// ─── Sentry — отложенная инициализация после первого рендера ───
// requestIdleCallback (fallback setTimeout 2s) — гарантия что Sentry не блокирует TTI.
if (SENTRY_DSN) {
  const initSentry = () => {
    import('@sentry/react').then((Sentry) => {
      try {
        Sentry.init({
          dsn: SENTRY_DSN,
          environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
          tracesSampleRate: 0.1,
          // Session Replay — записываем только сессии с ошибками, чтобы экономить квоту.
          // maskAllText / blockAllMedia — PII-защита для медицинского ПО (152-ФЗ).
          replaysSessionSampleRate: 0.0,
          replaysOnErrorSampleRate: 0.1,
          integrations: [
            Sentry.browserTracingIntegration(),
            Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
          ],
        })
      } catch (e) {
        // Sentry не должен ломать приложение — глотаем ошибки инициализации.
        console.error('[Sentry init failed]', e)
      }
    }).catch(() => {})
  }
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(initSentry, { timeout: 3000 })
  } else {
    setTimeout(initSentry, 2000)
  }
}
