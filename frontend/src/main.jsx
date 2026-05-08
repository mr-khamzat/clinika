import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
// ─── Дизайн-токены КлиникСеть (design-preview-2) ───
// Загружаются глобально один раз; CSS-переменные используются в /src/design/ и tailwind.
import './design/tokens.css'

// ─── Инициализация Sentry — отключена если DSN не задан ───
// VITE_SENTRY_DSN читается из .env во время сборки Vite (build-time ARG).
// Без DSN — Sentry полностью отключён, ErrorBoundary продолжает работать локально.
import * as Sentry from '@sentry/react'
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN
if (SENTRY_DSN) {
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
}

// Локальный фолбэк ErrorBoundary — показывается, если Sentry не настроен
// (Sentry.ErrorBoundary без DSN тоже работает, но без отправки наверх).
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

// Если DSN задан — используем Sentry.ErrorBoundary (отправка ошибок наверх + UI).
// Без DSN — обычный локальный ErrorBoundary без сети.
const SentryFallback = ({ error, resetError }) => (
  <div style={{ padding: '24px', fontFamily: 'monospace', background: '#fff', minHeight: '100vh' }}>
    <h2 style={{ color: '#c00', marginBottom: '12px' }}>Ошибка приложения</h2>
    <pre style={{ background: '#fee', padding: '12px', borderRadius: '8px', overflowX: 'auto', color: '#900', fontSize: '13px' }}>
      {error?.message || String(error)}
    </pre>
    <button
      onClick={resetError}
      style={{ marginTop: '12px', padding: '8px 16px', background: '#0066cc', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
    >
      Попробовать снова
    </button>
  </div>
)

const Boundary = SENTRY_DSN
  ? ({ children }) => (
      <Sentry.ErrorBoundary fallback={SentryFallback} showDialog={false}>
        {children}
      </Sentry.ErrorBoundary>
    )
  : LocalErrorBoundary

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Boundary>
      <App />
    </Boundary>
  </React.StrictMode>
)
