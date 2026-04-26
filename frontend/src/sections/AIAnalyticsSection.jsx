import { useState, useEffect, useCallback } from 'react'

const ANALYSIS_TYPES = [
  { key: 'overview',      title: 'Общий обзор',              icon: '📊', desc: 'Ключевые метрики и инсайты за период' },
  { key: 'services',      title: 'Анализ услуг',             icon: '🏥', desc: 'Конверсия и эффективность по каждой услуге' },
  { key: 'staff',         title: 'Эффективность сотрудников',icon: '👥', desc: 'Производительность и нагрузка персонала' },
  { key: 'clinics',       title: 'Сравнение клиник',         icon: '🏢', desc: 'Бенчмарк между клиниками сети' },
  { key: 'bonuses',       title: 'Бонусная система',         icon: '💰', desc: 'Мотивация, выплаты и влияние на конверсию' },
  { key: 'forecast',      title: 'Прогноз и стратегия',      icon: '🔮', desc: 'Тренды и ТОП-3 действия на следующий период' },
  { key: 'anomaly',       title: 'Выявление аномалий',       icon: '⚠️', desc: 'Неожиданные паттерны и резкие изменения' },
  { key: 'load_forecast', title: 'Прогноз нагрузки',         icon: '📅', desc: 'Загрузка по дням недели и оптимизация staffing' },
  { key: 'schedule',      title: 'Оптимизация процессов',    icon: '⚡', desc: 'Операционные узкие места и quick wins' },
  { key: 'bonus_roi',     title: 'ROI бонусной системы',     icon: '📈', desc: 'Стоимость привлечения одного пациента' },
]

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function MarkdownResult({ text }) {
  if (!text) return null
  const lines = text.split('\n')
  return (
    <div style={{ lineHeight: 1.7, color: '#1a2332' }}>
      {lines.map((line, i) => {
        if (!line.trim()) return <div key={i} style={{ height: 8 }} />
        if (/^\d+\./.test(line.trim())) {
          return (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
              <span style={{ color: '#0097A7', fontWeight: 600, minWidth: 20 }}>{line.trim().match(/^\d+/)[0]}.</span>
              <span>{line.trim().replace(/^\d+\.\s*/, '')}</span>
            </div>
          )
        }
        if (line.trim().startsWith('- ') || line.trim().startsWith('• ')) {
          return (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 4, paddingLeft: 8 }}>
              <span style={{ color: '#0097A7', marginTop: 2 }}>•</span>
              <span>{line.trim().replace(/^[-•]\s*/, '')}</span>
            </div>
          )
        }
        if (line.trim().startsWith('#') || /^\*\*.*\*\*$/.test(line.trim())) {
          return <div key={i} style={{ fontWeight: 700, marginTop: 12, marginBottom: 4, color: '#004D5F' }}>{line.replace(/^#+\s*/, '').replace(/\*\*/g, '')}</div>
        }
        if (line.includes('**')) {
          const parts = line.split(/\*\*(.*?)\*\*/)
          return (
            <div key={i} style={{ marginBottom: 4 }}>
              {parts.map((p, j) => j % 2 === 1 ? <strong key={j}>{p}</strong> : p)}
            </div>
          )
        }
        return <div key={i} style={{ marginBottom: 4 }}>{line}</div>
      })}
    </div>
  )
}

function AnalysisCard({ typeInfo, days, token, cachedResult, onResult }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState(false)

  const result = cachedResult

  const run = async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch(`/clinika/api/ai/analyze?type=${typeInfo.key}&days=${days}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.detail?.message || data.detail || 'Ошибка AI')
      onResult(typeInfo.key, data)
      setExpanded(true)
    } catch (e) {
      setError(e.message || 'Ошибка запроса')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      background: '#fff',
      borderRadius: 12,
      border: '1px solid #e0eaec',
      overflow: 'hidden',
      transition: 'box-shadow 0.2s',
      boxShadow: result ? '0 2px 8px rgba(0,151,167,0.08)' : 'none',
    }}>
      {/* Заголовок карточки */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px',
        background: result ? 'linear-gradient(135deg,#f0f9fa,#e8f5f7)' : '#fafbfc',
        borderBottom: result && expanded ? '1px solid #e0eaec' : 'none',
        cursor: result ? 'pointer' : 'default',
      }} onClick={() => result && setExpanded(e => !e)}>
        <span style={{ fontSize: 22 }}>{typeInfo.icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: '#1a2332' }}>{typeInfo.title}</div>
          <div style={{ fontSize: 12, color: '#607d8b', marginTop: 2 }}>{typeInfo.desc}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {result && (
            <span style={{ fontSize: 11, color: '#90a4ae' }}>{formatDate(result.generated_at)}</span>
          )}
          {result && (
            <span style={{ fontSize: 14, color: '#90a4ae' }}>{expanded ? '▲' : '▼'}</span>
          )}
          <button
            onClick={e => { e.stopPropagation(); run() }}
            disabled={loading}
            style={{
              background: loading ? '#b2dfdb' : '#0097A7',
              color: '#fff', border: 'none', borderRadius: 8,
              padding: '6px 14px', fontSize: 12, fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {loading ? 'Анализ...' : result ? '↻ Обновить' : '▶ Запустить'}
          </button>
        </div>
      </div>

      {/* Результат */}
      {error && (
        <div style={{ padding: '12px 16px', background: '#fff3f3', color: '#c62828', fontSize: 13 }}>
          ⚠️ {error}
        </div>
      )}

      {loading && (
        <div style={{ padding: '20px 16px', textAlign: 'center', color: '#0097A7', fontSize: 13 }}>
          <div style={{ marginBottom: 8 }}>🤖 AI анализирует данные...</div>
          <div style={{
            height: 4, background: '#e0f7fa', borderRadius: 2, overflow: 'hidden',
          }}>
            <div style={{
              height: '100%', width: '40%', background: '#0097A7', borderRadius: 2,
              animation: 'progress-slide 1.2s ease-in-out infinite',
            }} />
          </div>
        </div>
      )}

      {result && expanded && !loading && (
        <div style={{ padding: '16px 20px' }}>
          <MarkdownResult text={result.result} />
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #f0f5f6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: '#b0bec5' }}>
              Модель: {result.model || '—'} · Период: {result.days || days} дней
            </span>
            <span style={{ fontSize: 11, color: '#b0bec5' }}>
              {formatDate(result.generated_at)}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

function AskTab({ token, days }) {
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [answer, setAnswer] = useState(null)
  const [error, setError] = useState(null)

  const ask = async () => {
    if (!question.trim() || question.trim().length < 5) return
    setLoading(true)
    setError(null)
    setAnswer(null)
    try {
      const r = await fetch('/clinika/api/ai/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ question: question.trim(), days }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.detail?.message || data.detail || 'Ошибка AI')
      setAnswer(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 16, color: '#607d8b', fontSize: 14 }}>
        Задайте любой вопрос — AI проанализирует данные вашей клиники за выбранный период и ответит.
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <textarea
          value={question}
          onChange={e => setQuestion(e.target.value)}
          placeholder="Например: Почему упала конверсия в понедельник? Какой сотрудник приносит больше всего подтверждённых направлений?"
          style={{
            flex: 1, border: '1px solid #cdd8da', borderRadius: 8, padding: '10px 14px',
            fontSize: 14, resize: 'vertical', minHeight: 80, fontFamily: 'inherit',
            outline: 'none',
          }}
          onKeyDown={e => e.key === 'Enter' && e.ctrlKey && ask()}
        />
        <button
          onClick={ask}
          disabled={loading || question.trim().length < 5}
          style={{
            background: loading || question.trim().length < 5 ? '#b2dfdb' : '#0097A7',
            color: '#fff', border: 'none', borderRadius: 8,
            padding: '0 20px', fontSize: 14, fontWeight: 600,
            cursor: loading || question.trim().length < 5 ? 'not-allowed' : 'pointer',
            alignSelf: 'flex-start', height: 40, marginTop: 0,
          }}
        >
          {loading ? '...' : 'Спросить'}
        </button>
      </div>
      <div style={{ fontSize: 11, color: '#b0bec5', marginTop: 6 }}>Ctrl+Enter для отправки</div>

      {error && (
        <div style={{ marginTop: 12, padding: '10px 14px', background: '#fff3f3', borderRadius: 8, color: '#c62828', fontSize: 13 }}>
          ⚠️ {error}
        </div>
      )}

      {loading && (
        <div style={{ marginTop: 20, textAlign: 'center', color: '#0097A7', fontSize: 14 }}>
          🤖 AI обрабатывает вопрос...
        </div>
      )}

      {answer && (
        <div style={{ marginTop: 16, background: '#f0f9fa', borderRadius: 10, padding: '16px 20px', border: '1px solid #b2dfdb' }}>
          <div style={{ fontWeight: 600, color: '#004D5F', marginBottom: 10, fontSize: 13 }}>
            💬 Вопрос: {answer.question}
          </div>
          <MarkdownResult text={answer.answer} />
          <div style={{ marginTop: 12, fontSize: 11, color: '#90a4ae' }}>
            Модель: {answer.model} · {formatDate(answer.generated_at)}
          </div>
        </div>
      )}
    </div>
  )
}

function HistoryTab({ token }) {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    fetch('/clinika/api/ai/history', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { setHistory(d.history || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [token])

  const typeMap = Object.fromEntries(ANALYSIS_TYPES.map(t => [t.key, t]))

  if (loading) return <div style={{ color: '#90a4ae', textAlign: 'center', padding: 20 }}>Загрузка...</div>
  if (!history.length) return <div style={{ color: '#90a4ae', textAlign: 'center', padding: 40 }}>История анализов пуста</div>

  return (
    <div style={{ display: 'flex', gap: 16 }}>
      {/* Список */}
      <div style={{ width: 280, flexShrink: 0 }}>
        {history.map((h, i) => {
          const t = typeMap[h.type] || { icon: '📄', title: h.type }
          return (
            <div
              key={i}
              onClick={() => setSelected(h)}
              style={{
                padding: '10px 12px', borderRadius: 8, marginBottom: 6, cursor: 'pointer',
                background: selected === h ? '#e0f7fa' : '#f8fbfc',
                border: `1px solid ${selected === h ? '#0097A7' : '#e0eaec'}`,
                display: 'flex', gap: 10, alignItems: 'center',
              }}
            >
              <span style={{ fontSize: 18 }}>{t.icon}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1a2332' }}>{t.title}</div>
                <div style={{ fontSize: 11, color: '#90a4ae' }}>{formatDate(h.generated_at)} · {h.days} дней</div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Результат */}
      <div style={{ flex: 1, background: '#f8fbfc', borderRadius: 10, padding: '16px 20px', border: '1px solid #e0eaec', minHeight: 200 }}>
        {selected ? (
          <>
            <div style={{ fontWeight: 700, color: '#004D5F', marginBottom: 12, fontSize: 15 }}>
              {(typeMap[selected.type] || {}).icon} {(typeMap[selected.type] || { title: selected.type }).title}
            </div>
            <MarkdownResult text={selected.result} />
            <div style={{ marginTop: 14, fontSize: 11, color: '#b0bec5', borderTop: '1px solid #e8eef0', paddingTop: 10 }}>
              Модель: {selected.model || '—'} · Период: {selected.days} дней · {formatDate(selected.generated_at)}
            </div>
          </>
        ) : (
          <div style={{ color: '#90a4ae', textAlign: 'center', paddingTop: 40 }}>Выберите запись из истории</div>
        )}
      </div>
    </div>
  )
}

export default function AIAnalyticsSection({ token }) {
  const [activeTab, setActiveTab] = useState('analyze')
  const [days, setDays] = useState(30)
  const [results, setResults] = useState({})

  const handleResult = useCallback((key, data) => {
    setResults(prev => ({ ...prev, [key]: data }))
  }, [])

  const tabs = [
    { key: 'analyze', label: '🤖 Анализ' },
    { key: 'ask',     label: '💬 Спросить AI' },
    { key: 'history', label: '📜 История' },
  ]

  const runAll = async () => {
    for (const t of ANALYSIS_TYPES) {
      try {
        const r = await fetch(`/clinika/api/ai/analyze?type=${t.key}&days=${days}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const data = await r.json()
        if (r.ok) handleResult(t.key, data)
        await new Promise(res => setTimeout(res, 500))
      } catch {}
    }
  }

  return (
    <div style={{ padding: '0 0 40px 0' }}>
      <style>{`
        @keyframes progress-slide {
          0% { transform: translateX(-100%) }
          100% { transform: translateX(350%) }
        }
      `}</style>

      {/* Шапка */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#004D5F' }}>
            🤖 AI-аналитика
          </h2>
          <div style={{ fontSize: 13, color: '#607d8b', marginTop: 4 }}>
            Интеллектуальный анализ направлений, услуг и сотрудников
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <select
            value={days}
            onChange={e => setDays(Number(e.target.value))}
            style={{
              border: '1px solid #cdd8da', borderRadius: 8, padding: '6px 10px',
              fontSize: 13, color: '#1a2332', background: '#fff', cursor: 'pointer',
            }}
          >
            <option value={7}>7 дней</option>
            <option value={14}>14 дней</option>
            <option value={30}>30 дней</option>
            <option value={60}>60 дней</option>
            <option value={90}>90 дней</option>
          </select>
        </div>
      </div>

      {/* Табы */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '2px solid #e0eaec' }}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              background: 'none', border: 'none', padding: '8px 16px', fontSize: 14,
              fontWeight: activeTab === t.key ? 700 : 400,
              color: activeTab === t.key ? '#0097A7' : '#607d8b',
              borderBottom: activeTab === t.key ? '2px solid #0097A7' : '2px solid transparent',
              marginBottom: -2, cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Вкладка: Анализ */}
      {activeTab === 'analyze' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(420px,1fr))', gap: 12 }}>
            {ANALYSIS_TYPES.map(t => (
              <AnalysisCard
                key={t.key}
                typeInfo={t}
                days={days}
                token={token}
                cachedResult={results[t.key]}
                onResult={handleResult}
              />
            ))}
          </div>
          <div style={{ marginTop: 20, textAlign: 'center' }}>
            <button
              onClick={runAll}
              style={{
                background: 'linear-gradient(135deg,#0097A7,#00838F)',
                color: '#fff', border: 'none', borderRadius: 10,
                padding: '10px 28px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
              }}
            >
              ▶▶ Запустить все анализы
            </button>
            <div style={{ fontSize: 12, color: '#90a4ae', marginTop: 6 }}>
              Последовательно запустит все 10 типов анализа
            </div>
          </div>
        </div>
      )}

      {/* Вкладка: Спросить AI */}
      {activeTab === 'ask' && (
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e0eaec', padding: '20px 24px' }}>
          <AskTab token={token} days={days} />
        </div>
      )}

      {/* Вкладка: История */}
      {activeTab === 'history' && (
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e0eaec', padding: '20px 24px' }}>
          <HistoryTab token={token} />
        </div>
      )}
    </div>
  )
}
