/**
 * AISection v2 — AI-аналитика клиники. Красивый UI, баланс, 6 аналитических сценариев.
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import { API_BASE } from '../config'

const API = API_BASE

function apiFetch(token, path, opts = {}) {
  return fetch(API + path, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  })
}

// ── Утилиты ───────────────────────────────────────────────────────────────────

function fmt(n, dec = 2) {
  if (n == null) return '—'
  return Number(n).toFixed(dec)
}

function fmtNum(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('ru-RU')
}

// ── Компоненты ────────────────────────────────────────────────────────────────

function Spinner({ size = 36, text = 'AI анализирует...' }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '48px 0' }}>
      <div style={{
        width: size, height: size,
        border: '3px solid #ede9fe',
        borderTop: '3px solid #7c3aed',
        borderRadius: '50%',
        animation: 'aiSpin 0.7s linear infinite',
      }} />
      <span style={{ color: '#94a3b8', fontSize: 13 }}>{text}</span>
      <style>{`@keyframes aiSpin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

function ErrBanner({ msg, onClose }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 16px',
      background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: 10,
      color: '#be123c', fontSize: 13,
    }}>
      <span className="material-icons" style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>error_outline</span>
      <span style={{ flex: 1 }}>{msg}</span>
      {onClose && <span className="material-icons" style={{ fontSize: 16, cursor: 'pointer', opacity: 0.6 }} onClick={onClose}>close</span>}
    </div>
  )
}

function PeriodPill({ value, onChange }) {
  return (
    <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: 20, padding: 3, gap: 2 }}>
      {[7, 14, 30, 90].map(d => (
        <button key={d} onClick={() => onChange(d)} style={{
          padding: '4px 14px', borderRadius: 16, fontSize: 12, fontWeight: 600, border: 'none',
          background: value === d ? '#fff' : 'transparent',
          color: value === d ? '#7c3aed' : '#64748b',
          cursor: 'pointer',
          boxShadow: value === d ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
          transition: 'all 0.15s',
        }}>{d}д</button>
      ))}
    </div>
  )
}

function StatBadge({ icon, label, value, color = '#7c3aed', sub }) {
  return (
    <div style={{
      background: '#fff', borderRadius: 12, padding: '14px 18px',
      border: '1px solid #f1f5f9',
      boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: 10,
        background: color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <span className="material-icons" style={{ color, fontSize: 22 }}>{icon}</span>
      </div>
      <div>
        <div style={{ fontWeight: 800, fontSize: 22, color: '#0f172a', lineHeight: 1.1 }}>{value}</div>
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: color, fontWeight: 600 }}>{sub}</div>}
      </div>
    </div>
  )
}

// Рендер markdown-подобного текста (жирный, списки)
function AIText({ text }) {
  if (!text) return null
  const lines = text.split('\n')
  return (
    <div style={{ fontSize: 14, color: '#1e293b', lineHeight: 1.8 }}>
      {lines.map((line, i) => {
        if (!line.trim()) return <div key={i} style={{ height: 8 }} />
        // Заголовки
        if (line.startsWith('### ')) return <div key={i} style={{ fontWeight: 700, fontSize: 15, color: '#4c1d95', marginTop: 16, marginBottom: 4 }}>{line.slice(4)}</div>
        if (line.startsWith('## ')) return <div key={i} style={{ fontWeight: 700, fontSize: 16, color: '#312e81', marginTop: 20, marginBottom: 6 }}>{line.slice(3)}</div>
        if (line.startsWith('# ')) return <div key={i} style={{ fontWeight: 800, fontSize: 18, color: '#1e1b4b', marginTop: 24, marginBottom: 8 }}>{line.slice(2)}</div>
        // Нумерованные пункты
        const numMatch = line.match(/^(\d+)\.\s+\*\*(.+?)\*\*(.*)/)
        if (numMatch) return (
          <div key={i} style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <div style={{ width: 24, height: 24, background: '#7c3aed', color: '#fff', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>{numMatch[1]}</div>
            <div><strong style={{ color: '#312e81' }}>{numMatch[2]}</strong>{renderInline(numMatch[3])}</div>
          </div>
        )
        // Ненумерованные пункты
        if (line.startsWith('- ') || line.startsWith('• ')) {
          const content = line.slice(2)
          return (
            <div key={i} style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <div style={{ width: 6, height: 6, background: '#7c3aed', borderRadius: '50%', marginTop: 8, flexShrink: 0 }} />
              <div>{renderInline(content)}</div>
            </div>
          )
        }
        return <div key={i}>{renderInline(line)}</div>
      })}
    </div>
  )
}

function renderInline(text) {
  // **bold** → <strong>
  const parts = text.split(/(\*\*.*?\*\*)/)
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) {
      return <strong key={i} style={{ color: '#312e81' }}>{p.slice(2, -2)}</strong>
    }
    return p
  })
}

// ── Баланс-виджет ─────────────────────────────────────────────────────────────

function BalanceBar({ token, modelInfo }) {
  const [balance, setBalance] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch(token, '/ai/balance')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setBalance(d) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [token])

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 16px', background: '#faf5ff',
      border: '1px solid #e9d5ff', borderRadius: 12, flexWrap: 'wrap',
    }}>
      {/* Провайдер + модель */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="material-icons" style={{ color: '#7c3aed', fontSize: 18 }}>smart_toy</span>
        <span style={{ fontWeight: 700, fontSize: 13, color: '#4c1d95' }}>
          {modelInfo?.provider?.toUpperCase() || 'AI'}
        </span>
        {modelInfo?.selected && (
          <span style={{ background: '#7c3aed', color: '#fff', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 8 }}>
            {modelInfo.models?.find(m => m.id === modelInfo.selected)?.name || modelInfo.selected}
          </span>
        )}
      </div>

      <div style={{ width: 1, height: 20, background: '#e9d5ff' }} />

      {/* Баланс */}
      {loading ? (
        <span style={{ fontSize: 12, color: '#94a3b8' }}>загрузка баланса...</span>
      ) : balance?.available ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span className="material-icons" style={{ fontSize: 16, color: balance.balance > 5 ? '#16a34a' : '#dc2626' }}>account_balance_wallet</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: balance.balance > 5 ? '#166534' : '#dc2626' }}>
              ${fmt(balance.balance)} {balance.unit}
            </span>
            <span style={{ fontSize: 11, color: '#64748b' }}>баланс</span>
          </div>
          {balance.today?.requests > 0 && (
            <>
              <div style={{ width: 1, height: 16, background: '#e9d5ff' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#64748b' }}>
                <span className="material-icons" style={{ fontSize: 14 }}>today</span>
                сегодня: <strong style={{ color: '#374151' }}>{balance.today.requests} зап.</strong>
                · <strong style={{ color: '#374151' }}>${fmt(balance.today.actual_cost)}</strong>
                · <strong style={{ color: '#374151' }}>{fmtNum(balance.today.total_tokens)} tok</strong>
              </div>
            </>
          )}
          {balance.tpm != null && (
            <>
              <div style={{ width: 1, height: 16, background: '#e9d5ff' }} />
              <span style={{ fontSize: 12, color: '#64748b' }}>
                <strong style={{ color: '#374151' }}>{balance.tpm}</strong> tok/мин
              </span>
            </>
          )}
        </>
      ) : (
        <span style={{ fontSize: 12, color: '#94a3b8' }}>баланс недоступен</span>
      )}
    </div>
  )
}

// ── Аналитические карточки ────────────────────────────────────────────────────

const ANALYSIS_TYPES = [
  { type: 'overview',  icon: 'dashboard',    label: 'Общий обзор',           color: '#7c3aed', desc: 'Инсайты по всей клинике' },
  { type: 'services',  icon: 'medical_services', label: 'Услуги',            color: '#0891b2', desc: 'Эффективность по услугам' },
  { type: 'staff',     icon: 'people',        label: 'Сотрудники',           color: '#059669', desc: 'Производительность команды' },
  { type: 'clinics',   icon: 'local_hospital', label: 'Клиники',             color: '#d97706', desc: 'Сравнение филиалов' },
  { type: 'bonuses',   icon: 'payments',      label: 'Бонусы',               color: '#dc2626', desc: 'Мотивационная система' },
  { type: 'forecast',  icon: 'trending_up',   label: 'Прогноз',              color: '#7c3aed', desc: 'Стратегия на следующий период' },
]

function AnalysisCard({ item, active, onClick, loading }) {
  const isLoading = loading === item.type
  return (
    <button
      onClick={() => onClick(item.type)}
      disabled={isLoading}
      style={{
        background: active === item.type ? item.color : '#fff',
        border: `2px solid ${active === item.type ? item.color : '#f1f5f9'}`,
        borderRadius: 14, padding: '16px 14px', cursor: 'pointer',
        textAlign: 'left', transition: 'all 0.15s',
        boxShadow: active === item.type ? `0 4px 14px ${item.color}30` : '0 1px 3px rgba(0,0,0,0.05)',
        opacity: isLoading ? 0.7 : 1,
        display: 'flex', flexDirection: 'column', gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {isLoading
          ? <div style={{ width: 20, height: 20, border: '2px solid #fff', borderTop: '2px solid transparent', borderRadius: '50%', animation: 'aiSpin 0.7s linear infinite' }} />
          : <span className="material-icons" style={{ fontSize: 22, color: active === item.type ? '#fff' : item.color }}>{item.icon}</span>
        }
        <span style={{ fontWeight: 700, fontSize: 13, color: active === item.type ? '#fff' : '#1e293b' }}>
          {item.label}
        </span>
      </div>
      <span style={{ fontSize: 11, color: active === item.type ? 'rgba(255,255,255,0.8)' : '#94a3b8', lineHeight: 1.4 }}>
        {item.desc}
      </span>
    </button>
  )
}

// ── Вкладка: Аналитика ────────────────────────────────────────────────────────

function AnalyticsTab({ token, onGoToSettings, isSuperAdmin }) {
  const [days, setDays] = useState(30)
  const [active, setActive] = useState(null)
  const [loading, setLoading] = useState(null)
  const [results, setResults] = useState({}) // type → data
  const [err, setErr] = useState('')
  const [notCfg, setNotCfg] = useState(false)
  const resultRef = useRef(null)

  const run = useCallback(async (type) => {
    setErr(''); setNotCfg(false); setActive(type); setLoading(type)
    try {
      const r = await apiFetch(token, `/ai/analyze?type=${type}&days=${days}`)
      if (r.status === 501) { setNotCfg(true); setLoading(null); return }
      if (!r.ok) {
        const d = await r.json()
        setErr(d.detail?.message || d.detail || 'Ошибка запроса')
        setLoading(null); return
      }
      const data = await r.json()
      setResults(prev => ({ ...prev, [type]: data }))
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
    } catch { setErr('Сетевая ошибка') }
    setLoading(null)
  }, [token, days])

  const current = active ? results[active] : null

  return (
    <div>
      {/* Настройки периода */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: '#64748b', fontWeight: 500 }}>Выберите сценарий анализа:</div>
        <PeriodPill value={days} onChange={(d) => { setDays(d); setResults({}) }} />
      </div>

      {/* Сетка карточек */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 24 }}>
        {ANALYSIS_TYPES.map(item => (
          <AnalysisCard key={item.type} item={item} active={active} onClick={run} loading={loading} />
        ))}
      </div>

      {/* Ошибки */}
      {notCfg && (
        <div style={{ background: '#faf5ff', border: '1px dashed #c4b5fd', borderRadius: 12, padding: 28, textAlign: 'center' }}>
          <span className="material-icons" style={{ fontSize: 40, color: '#7c3aed', display: 'block', marginBottom: 8 }}>auto_awesome</span>
          <div style={{ fontWeight: 700, color: '#4c1d95', marginBottom: 6 }}>AI не настроен</div>
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>Добавьте конфиг провайдера в разделе «Настройки»</div>
          {isSuperAdmin && (
            <button onClick={onGoToSettings} style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
              Настроить AI
            </button>
          )}
        </div>
      )}
      {err && <ErrBanner msg={err} onClose={() => setErr('')} />}

      {/* Спиннер */}
      {loading && <Spinner text={`Анализирую: ${ANALYSIS_TYPES.find(t => t.type === loading)?.label}...`} />}

      {/* Результат */}
      {current && !loading && (
        <div ref={resultRef} style={{
          background: '#fff', border: '1px solid #f1f5f9', borderRadius: 16,
          boxShadow: '0 4px 20px rgba(0,0,0,0.06)', overflow: 'hidden',
        }}>
          {/* Шапка результата */}
          <div style={{
            padding: '16px 20px', borderBottom: '1px solid #f8fafc',
            background: 'linear-gradient(135deg, #faf5ff, #f3e8ff)',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span className="material-icons" style={{ color: ANALYSIS_TYPES.find(t => t.type === active)?.color, fontSize: 22 }}>
              {ANALYSIS_TYPES.find(t => t.type === active)?.icon}
            </span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: '#1e293b' }}>{current.title}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>
                за {days} дней · {current.model} · {new Date(current.generated_at).toLocaleString('ru-RU')}
              </div>
            </div>
            {/* Мини-статы */}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 16, fontSize: 12, color: '#64748b' }}>
              <span><strong style={{ color: '#0f172a' }}>{current.stats.referrals_total}</strong> направлений</span>
              <span><strong style={{ color: '#16a34a' }}>{current.stats.conversion_rate_pct}%</strong> конверсия</span>
            </div>
          </div>
          {/* Текст */}
          <div style={{ padding: '20px 24px' }}>
            <AIText text={current.result} />
          </div>
          {/* Кнопки */}
          <div style={{ padding: '12px 24px 16px', borderTop: '1px solid #f8fafc', display: 'flex', gap: 8 }}>
            <button
              onClick={() => run(active)}
              style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, color: '#374151' }}
            >
              <span className="material-icons" style={{ fontSize: 14 }}>refresh</span>
              Перезапустить
            </button>
            <button
              onClick={() => {
                const el = document.createElement('a')
                el.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(current.result)
                el.download = `ai_${active}_${new Date().toISOString().slice(0,10)}.txt`
                el.click()
              }}
              style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, color: '#374151' }}
            >
              <span className="material-icons" style={{ fontSize: 14 }}>download</span>
              Скачать
            </button>
          </div>
        </div>
      )}

      {!active && !notCfg && !err && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#cbd5e1' }}>
          <span className="material-icons" style={{ fontSize: 56, display: 'block', marginBottom: 12 }}>auto_awesome</span>
          <div style={{ fontSize: 14 }}>Выберите сценарий выше для запуска AI-анализа</div>
        </div>
      )}
    </div>
  )
}

// ── Вкладка: Q&A чат ──────────────────────────────────────────────────────────

const QUICK_QUESTIONS = [
  'Почему так много направлений истекает без подтверждения?',
  'Какие услуги приносят больше всего подтверждённых пациентов?',
  'Как повысить конверсию направлений до 50%?',
  'Какой сотрудник наиболее эффективен и почему?',
  'В чём причина высокого процента отмен?',
  'Как сравнить эффективность клиник между собой?',
  'Какую стратегию мотивации персонала вы рекомендуете?',
]

function QATab({ token, onGoToSettings, isSuperAdmin }) {
  const [question, setQuestion] = useState('')
  const [days, setDays] = useState(30)
  const [messages, setMessages] = useState([])  // {role, text, model, ts}
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [notCfg, setNotCfg] = useState(false)
  const bottomRef = useRef(null)

  const ask = useCallback(async (q = question) => {
    const txt = (q || question).trim()
    if (!txt) return
    setQuestion(''); setErr(''); setNotCfg(false)
    setMessages(prev => [...prev, { role: 'user', text: txt, ts: new Date().toISOString() }])
    setLoading(true)
    try {
      const r = await apiFetch(token, '/ai/ask', { method: 'POST', body: JSON.stringify({ question: txt, days }) })
      if (r.status === 501) { setNotCfg(true); setLoading(false); return }
      if (!r.ok) { const d = await r.json(); setErr(d.detail?.message || d.detail || 'Ошибка'); setLoading(false); return }
      const data = await r.json()
      setMessages(prev => [...prev, { role: 'assistant', text: data.answer, model: data.model, ts: data.generated_at }])
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
    } catch { setErr('Сетевая ошибка') }
    setLoading(false)
  }, [token, question, days])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Быстрые вопросы */}
      {messages.length === 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Популярные вопросы</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {QUICK_QUESTIONS.map(q => (
              <button key={q} onClick={() => ask(q)} style={{
                padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 500,
                border: '1px solid #e2e8f0', background: '#fafbfc', color: '#374151', cursor: 'pointer',
                transition: 'all 0.1s',
              }}>
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Чат */}
      {messages.length > 0 && (
        <div style={{
          background: '#fafbfc', borderRadius: 14, border: '1px solid #f1f5f9',
          padding: 16, display: 'flex', flexDirection: 'column', gap: 12,
          maxHeight: 420, overflowY: 'auto',
        }}>
          {messages.map((m, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, flexDirection: m.role === 'user' ? 'row-reverse' : 'row' }}>
              {/* Аватар */}
              <div style={{
                width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                background: m.role === 'user' ? '#e2e8f0' : '#7c3aed',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span className="material-icons" style={{ fontSize: 16, color: m.role === 'user' ? '#64748b' : '#fff' }}>
                  {m.role === 'user' ? 'person' : 'smart_toy'}
                </span>
              </div>
              {/* Сообщение */}
              <div style={{ maxWidth: '80%' }}>
                <div style={{
                  padding: '10px 14px', borderRadius: m.role === 'user' ? '14px 4px 14px 14px' : '4px 14px 14px 14px',
                  background: m.role === 'user' ? '#7c3aed' : '#fff',
                  border: m.role === 'user' ? 'none' : '1px solid #f1f5f9',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                }}>
                  {m.role === 'user'
                    ? <div style={{ fontSize: 14, color: '#fff' }}>{m.text}</div>
                    : <AIText text={m.text} />
                  }
                </div>
                <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 3, textAlign: m.role === 'user' ? 'right' : 'left' }}>
                  {new Date(m.ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                  {m.model && ` · ${m.model}`}
                </div>
              </div>
            </div>
          ))}
          {loading && (
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#7c3aed', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <span className="material-icons" style={{ fontSize: 16, color: '#fff' }}>smart_toy</span>
              </div>
              <div style={{ padding: '12px 16px', background: '#fff', borderRadius: '4px 14px 14px 14px', border: '1px solid #f1f5f9' }}>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  {[0, 1, 2].map(j => (
                    <div key={j} style={{
                      width: 6, height: 6, background: '#c4b5fd', borderRadius: '50%',
                      animation: `dotBounce 1.2s ${j * 0.2}s ease-in-out infinite`,
                    }} />
                  ))}
                </div>
                <style>{`@keyframes dotBounce { 0%,80%,100%{opacity:0.3;transform:scale(0.8)} 40%{opacity:1;transform:scale(1)} }`}</style>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Кнопка очистки */}
      {messages.length > 0 && (
        <button onClick={() => setMessages([])} style={{
          alignSelf: 'flex-start', background: 'none', border: 'none',
          color: '#94a3b8', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <span className="material-icons" style={{ fontSize: 14 }}>delete_outline</span>
          Очистить чат
        </button>
      )}

      {notCfg && (
        <div style={{ background: '#faf5ff', border: '1px dashed #c4b5fd', borderRadius: 12, padding: 20, textAlign: 'center' }}>
          <div style={{ fontWeight: 700, color: '#4c1d95', marginBottom: 6 }}>AI не настроен</div>
          {isSuperAdmin && (
            <button onClick={onGoToSettings} style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 18px', cursor: 'pointer', fontSize: 13 }}>
              Настроить
            </button>
          )}
        </div>
      )}
      {err && <ErrBanner msg={err} onClose={() => setErr('')} />}

      {/* Ввод */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
        <textarea
          value={question}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask() } }}
          placeholder="Задайте вопрос... (Enter — отправить, Shift+Enter — новая строка)"
          rows={2}
          style={{
            flex: 1, padding: '10px 14px', border: '1px solid #e2e8f0', borderRadius: 12,
            fontSize: 14, resize: 'none', fontFamily: 'inherit', outline: 'none',
            transition: 'border-color 0.15s',
          }}
          onFocus={e => e.target.style.borderColor = '#7c3aed'}
          onBlur={e => e.target.style.borderColor = '#e2e8f0'}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <PeriodPill value={days} onChange={setDays} />
          <button
            onClick={() => ask()}
            disabled={loading || !question.trim()}
            style={{
              background: loading || !question.trim() ? '#e2e8f0' : '#7c3aed',
              color: loading || !question.trim() ? '#94a3b8' : '#fff',
              border: 'none', borderRadius: 10, padding: '10px 20px',
              cursor: loading || !question.trim() ? 'default' : 'pointer',
              fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6,
              transition: 'all 0.15s',
            }}
          >
            <span className="material-icons" style={{ fontSize: 18 }}>send</span>
            {loading ? '...' : 'Спросить'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Вкладка: Настройки ────────────────────────────────────────────────────────

function SettingsTab({ token }) {
  const [rawJson, setRawJson] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
  const [models, setModels] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [jsonErr, setJsonErr] = useState('')

  useEffect(() => {
    let mounted = true
    Promise.all([
      apiFetch(token, '/ai/config').then(r => r.ok ? r.json() : null),
      apiFetch(token, '/ai/models').then(r => r.ok ? r.json() : null),
    ]).then(([cfg, mods]) => {
      if (!mounted) return
      if (cfg?.config && Object.keys(cfg.config).length > 0) {
        const d = { ...cfg.config }; delete d._meta
        setRawJson(JSON.stringify(d, null, 2))
      }
      if (mods) {
        setModels(mods.models || [])
        if (mods.selected) setSelectedModel(mods.selected)
      }
    }).catch(() => {}).finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [token])

  const handleJson = val => {
    setRawJson(val); setJsonErr('')
    if (val.trim()) { try { JSON.parse(val) } catch (e) { setJsonErr(e.message) } }
  }

  const save = async () => {
    setJsonErr(''); setMsg(null)
    let parsed
    try { parsed = JSON.parse(rawJson) } catch (e) { setJsonErr(e.message); return }
    setSaving(true)
    try {
      const r = await apiFetch(token, '/ai/config', {
        method: 'POST',
        body: JSON.stringify({ config: parsed, selected_model: selectedModel || null }),
      })
      if (r.ok) {
        setMsg({ ok: true, text: 'Конфиг сохранён.' })
        const mr = await apiFetch(token, '/ai/models')
        if (mr.ok) { const md = await mr.json(); setModels(md.models || []); if (md.selected) setSelectedModel(md.selected) }
      } else {
        const d = await r.json(); setMsg({ ok: false, text: d.detail || 'Ошибка' })
      }
    } catch { setMsg({ ok: false, text: 'Сетевая ошибка' }) }
    setSaving(false)
  }

  if (loading) return <Spinner text="Загрузка конфига..." />

  return (
    <div style={{ maxWidth: 820, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 12, padding: '14px 18px', fontSize: 13, color: '#0369a1' }}>
        <strong>Формат конфига</strong> совместим с <code style={{ background: '#e0f2fe', padding: '1px 5px', borderRadius: 4 }}>opencode.ai</code>.
        Поле <code style={{ background: '#e0f2fe', padding: '1px 5px', borderRadius: 4 }}>provider.openai.options</code> должно содержать <code>baseURL</code> и <code>apiKey</code>.
        Конфиг хранится на сервере в volumes — переживает перезапуски контейнера.
      </div>

      <div>
        <label style={{ display: 'block', fontWeight: 700, fontSize: 13, color: '#374151', marginBottom: 8 }}>
          JSON-конфиг провайдера
        </label>
        <textarea
          value={rawJson}
          onChange={e => handleJson(e.target.value)}
          placeholder={'{\n  "provider": {\n    "openai": {\n      "options": { "baseURL": "https://...", "apiKey": "sk-..." },\n      "models": { "model-id": { "name": "Model Name", "limit": { "context": 128000, "output": 32000 } } }\n    }\n  }\n}'}
          rows={18}
          style={{
            width: '100%', padding: '12px 14px',
            border: `1.5px solid ${jsonErr ? '#ef4444' : '#e2e8f0'}`,
            borderRadius: 10, fontSize: 12, fontFamily: 'monospace', resize: 'vertical',
            background: '#fafafa', lineHeight: 1.65, boxSizing: 'border-box', outline: 'none',
          }}
          onFocus={e => !jsonErr && (e.target.style.borderColor = '#7c3aed')}
          onBlur={e => !jsonErr && (e.target.style.borderColor = '#e2e8f0')}
        />
        {jsonErr && <div style={{ color: '#dc2626', fontSize: 12, marginTop: 5, display: 'flex', gap: 4, alignItems: 'center' }}>
          <span className="material-icons" style={{ fontSize: 14 }}>error</span>
          JSON: {jsonErr}
        </div>}
      </div>

      {models.length > 0 && (
        <div>
          <label style={{ display: 'block', fontWeight: 700, fontSize: 13, color: '#374151', marginBottom: 8 }}>
            Активная модель
          </label>
          <select
            value={selectedModel}
            onChange={e => setSelectedModel(e.target.value)}
            style={{ padding: '10px 14px', border: '1.5px solid #e2e8f0', borderRadius: 10, fontSize: 14, background: '#fff', cursor: 'pointer', minWidth: 360, outline: 'none' }}
          >
            {models.map(m => (
              <option key={m.id} value={m.id}>
                {m.name} · {m.id}{m.context ? ` · ctx ${(m.context/1000).toFixed(0)}k` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button
          onClick={save}
          disabled={saving || !!jsonErr || !rawJson.trim()}
          style={{
            background: saving || !!jsonErr || !rawJson.trim() ? '#e2e8f0' : '#7c3aed',
            color: saving || !!jsonErr || !rawJson.trim() ? '#94a3b8' : '#fff',
            border: 'none', borderRadius: 10, padding: '10px 28px',
            cursor: saving || !!jsonErr || !rawJson.trim() ? 'default' : 'pointer',
            fontWeight: 700, fontSize: 14, transition: 'all 0.15s',
          }}
        >
          {saving ? 'Сохраняю...' : 'Сохранить конфиг'}
        </button>
        <button
          onClick={() => { setRawJson(''); setJsonErr(''); setModels([]); setSelectedModel(''); setMsg(null) }}
          style={{ background: '#fff', border: '1.5px solid #fecdd3', borderRadius: 10, padding: '10px 20px', cursor: 'pointer', color: '#dc2626', fontWeight: 600, fontSize: 13 }}
        >
          Очистить
        </button>
      </div>

      {msg && (
        <div style={{
          padding: '12px 16px', borderRadius: 10,
          background: msg.ok ? '#f0fdf4' : '#fff1f2',
          border: `1px solid ${msg.ok ? '#bbf7d0' : '#fecdd3'}`,
          color: msg.ok ? '#166534' : '#be123c',
          fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span className="material-icons" style={{ fontSize: 18 }}>{msg.ok ? 'check_circle' : 'error'}</span>
          {msg.text}
        </div>
      )}

      {models.length > 0 && (
        <div style={{ background: '#fafbfc', borderRadius: 12, border: '1px solid #f1f5f9', padding: '16px 20px' }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#374151', marginBottom: 12 }}>Доступные модели</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {models.map(m => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: m.id === selectedModel ? '#faf5ff' : 'transparent', border: `1px solid ${m.id === selectedModel ? '#e9d5ff' : 'transparent'}` }}>
                <span className="material-icons" style={{ fontSize: 16, color: m.id === selectedModel ? '#7c3aed' : '#cbd5e1' }}>
                  {m.id === selectedModel ? 'radio_button_checked' : 'radio_button_unchecked'}
                </span>
                <span style={{ fontWeight: m.id === selectedModel ? 700 : 500, color: m.id === selectedModel ? '#4c1d95' : '#374151', fontSize: 13 }}>
                  {m.name}
                </span>
                <span style={{ color: '#94a3b8', fontSize: 11 }}>{m.id}</span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  {m.context && <span style={{ fontSize: 11, color: '#64748b', background: '#f1f5f9', padding: '2px 8px', borderRadius: 8 }}>ctx {(m.context/1000).toFixed(0)}k</span>}
                  {m.output && <span style={{ fontSize: 11, color: '#64748b', background: '#f1f5f9', padding: '2px 8px', borderRadius: 8 }}>out {(m.output/1000).toFixed(0)}k</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Главный компонент ─────────────────────────────────────────────────────────

const TABS = [
  { key: 'analytics', label: 'Аналитика',   icon: 'auto_awesome' },
  { key: 'qa',        label: 'Q&A',          icon: 'chat_bubble_outline' },
  { key: 'settings',  label: 'Настройки',    icon: 'settings', superOnly: true },
]

export default function AISection({ token, isSuperAdmin }) {
  const [tab, setTab] = useState('analytics')
  const [modelInfo, setModelInfo] = useState(null)

  useEffect(() => {
    apiFetch(token, '/ai/models')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setModelInfo(d) })
      .catch(() => {})
  }, [token])

  const goToSettings = () => setTab('settings')
  const visibleTabs = TABS.filter(t => !t.superOnly || isSuperAdmin)

  return (
    <div style={{ padding: '24px 28px', maxWidth: 980, margin: '0 auto' }}>
      {/* Заголовок */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span className="material-icons" style={{ color: '#7c3aed', fontSize: 30 }}>auto_awesome</span>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: '#0f172a' }}>AI-аналитика</h2>
        </div>
        <BalanceBar token={token} modelInfo={modelInfo} />
      </div>

      {/* Табы */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 24, borderBottom: '2px solid #f1f5f9' }}>
        {visibleTabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '10px 22px', border: 'none', background: 'none', cursor: 'pointer',
              borderBottom: `2px solid ${tab === t.key ? '#7c3aed' : 'transparent'}`,
              color: tab === t.key ? '#7c3aed' : '#64748b',
              fontWeight: tab === t.key ? 700 : 500, fontSize: 14, marginBottom: -2,
              display: 'flex', alignItems: 'center', gap: 6, transition: 'color 0.15s',
            }}
          >
            <span className="material-icons" style={{ fontSize: 17 }}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* Контент */}
      {tab === 'analytics' && <AnalyticsTab token={token} onGoToSettings={goToSettings} isSuperAdmin={isSuperAdmin} />}
      {tab === 'qa'        && <QATab        token={token} onGoToSettings={goToSettings} isSuperAdmin={isSuperAdmin} />}
      {tab === 'settings'  && isSuperAdmin  && <SettingsTab token={token} />}
    </div>
  )
}
