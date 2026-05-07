import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
// ─── Дизайн-токены КлиникСеть (design-preview-2) ───
// Загружаются глобально один раз; CSS-переменные используются в /src/design/ и tailwind.
import './design/tokens.css'

// ─── Инициализация Sentry — отключена если DSN не задан ───
// VITE_SENTRY_DSN читается из .env во время сборки Vite.
import * as Sentry from '@sentry/react'
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 0.1,
    environment: import.meta.env.MODE,
  })
}

class ErrorBoundary extends React.Component {
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

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
