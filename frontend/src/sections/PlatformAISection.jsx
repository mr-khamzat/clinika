/**
 * PlatformAISection — AI-аналитика всей платформы КлиникСеть.
 * Только для super_admin. Фиолетово-тёмная тема.
 */
import { useState, useEffect, useCallback } from 'react'
import DOMPurify from 'dompurify'
import { API_BASE } from '../config'

// ===== БЛОК: безопасный рендер markdown =====
// AI-провайдер возвращает произвольный текст. Раньше он шёл напрямую
// в dangerouslySetInnerHTML — это XSS, если ответ содержит <script>.
// Теперь: 1) экранируем источник, 2) парсим markdown,
// 3) прогоняем результат через DOMPurify с whitelist'ом тегов и стилей.
const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
   .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const SANITIZE_CONFIG = {
  ALLOWED_TAGS: ['h2', 'h3', 'b', 'br', 'p', 'em', 'i', 'strong', 'ul', 'li'],
  // Markdown от LLM не должен содержать style="..." — это вектор CSS injection.
  // Атрибуты не нужны: рендер сам подставляет style в renderMarkdown через белый
  // список тегов, а DOMPurify эти inline-style удалит.
  ALLOWED_ATTR: [],
  // Запрещаем javascript:/data: в любых url'ах.
  ALLOWED_URI_REGEXP: /^(?:https?|mailto):/,
}

// ── Утилиты ──────────────────────────────────────────────────────────────────

const apiFetch = (method, path, token, body) =>
  fetch(API_BASE + path, {
    method: method.toUpperCase(),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }).then(r => r.json())

/** Безопасный рендер markdown-подобного текста (с DOMPurify). */
function renderMarkdown(text) {
  if (!text) return ''
  const html = escapeHtml(text)
    .replace(/### (.+)/g, '<h3 style="font-size:1.05rem;font-weight:700;color:#c4b5fd;margin:12px 0 4px">$1</h3>')
    .replace(/## (.+)/g, '<h2 style="font-size:1.15rem;font-weight:700;color:#a78bfa;margin:14px 0 6px">$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<b style="color:#e2e8f0">$1</b>')
    .replace(/\n/g, '<br/>')
  return DOMPurify.sanitize(html, SANITIZE_CONFIG)
}

// ── Константы ─────────────────────────────────────────────────────────────────

const ANALYSIS_TYPES = [
  { key: 'overview', label: 'Обзор платформы', icon: '📊' },
  { key: 'growth',   label: 'Анализ роста',    icon: '📈' },
  { key: 'churn',    label: 'Риск оттока',     icon: '⚠️' },
  { key: 'modules',  label: 'Монетизация',     icon: '💰' },
  { key: 'leads',    label: 'Лиды',            icon: '📩' },
]

// ── Стили ─────────────────────────────────────────────────────────────────────

const S = {
  wrap: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #1e1b4b 100%)',
    padding: '24px',
    color: '#e2e8f0',
    fontFamily: 'Inter, sans-serif',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 28,
  },
  headerIcon: {
    fontSize: 32,
    background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  headerTitle: {
    fontSize: '1.6rem',
    fontWeight: 800,
    color: '#f1f5f9',
    margin: 0,
  },
  headerSub: {
    fontSize: '0.85rem',
    color: '#94a3b8',
    marginTop: 2,
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: 16,
    marginBottom: 28,
  },
  statCard: {
    background: 'rgba(139, 92, 246, 0.12)',
    border: '1px solid rgba(139, 92, 246, 0.25)',
    borderRadius: 14,
    padding: '18px 20px',
    backdropFilter: 'blur(8px)',
  },
  statLabel: {
    fontSize: '0.75rem',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: 6,
  },
  statValue: {
    fontSize: '2rem',
    fontWeight: 800,
    color: '#a78bfa',
    lineHeight: 1,
    marginBottom: 4,
  },
  statSub: {
    fontSize: '0.78rem',
    color: '#64748b',
  },
  section: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(139,92,246,0.2)',
    borderRadius: 16,
    padding: '22px 24px',
    marginBottom: 20,
    backdropFilter: 'blur(6px)',
  },
  sectionTitle: {
    fontSize: '0.9rem',
    fontWeight: 700,
    color: '#c4b5fd',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: 16,
  },
  typeGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
    gap: 12,
  },
  typeBtn: (active) => ({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    padding: '14px 10px',
    borderRadius: 12,
    border: active ? '2px solid #7c3aed' : '1px solid rgba(139,92,246,0.25)',
    background: active
      ? 'linear-gradient(135deg, rgba(124,58,237,0.35), rgba(168,85,247,0.25))'
      : 'rgba(139,92,246,0.08)',
    cursor: 'pointer',
    transition: 'all 0.18s',
    color: active ? '#e9d5ff' : '#94a3b8',
    fontSize: '0.82rem',
    fontWeight: active ? 700 : 500,
    letterSpacing: '0.01em',
  }),
  typeBtnIcon: {
    fontSize: '1.6rem',
  },
  analyzeBtn: (loading) => ({
    marginTop: 16,
    padding: '12px 28px',
    borderRadius: 10,
    border: 'none',
    background: loading
      ? 'rgba(124,58,237,0.4)'
      : 'linear-gradient(135deg, #7c3aed, #a855f7)',
    color: '#fff',
    fontWeight: 700,
    fontSize: '0.9rem',
    cursor: loading ? 'not-allowed' : 'pointer',
    letterSpacing: '0.02em',
    transition: 'all 0.18s',
    boxShadow: loading ? 'none' : '0 4px 15px rgba(124,58,237,0.35)',
  }),
  resultCard: {
    background: 'rgba(124,58,237,0.1)',
    border: '1px solid rgba(124,58,237,0.3)',
    borderRadius: 14,
    padding: '20px 22px',
    marginTop: 20,
  },
  resultTitle: {
    fontSize: '0.85rem',
    fontWeight: 700,
    color: '#c4b5fd',
    marginBottom: 12,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  resultText: {
    fontSize: '0.88rem',
    color: '#cbd5e1',
    lineHeight: 1.7,
  },
  chatInput: {
    width: '100%',
    padding: '12px 16px',
    borderRadius: 10,
    border: '1px solid rgba(139,92,246,0.35)',
    background: 'rgba(255,255,255,0.06)',
    color: '#e2e8f0',
    fontSize: '0.88rem',
    outline: 'none',
    boxSizing: 'border-box',
    fontFamily: 'Inter, sans-serif',
  },
  askBtn: (loading) => ({
    marginTop: 10,
    padding: '11px 24px',
    borderRadius: 10,
    border: 'none',
    background: loading ? 'rgba(124,58,237,0.4)' : 'linear-gradient(135deg, #6d28d9, #7c3aed)',
    color: '#fff',
    fontWeight: 700,
    fontSize: '0.88rem',
    cursor: loading ? 'not-allowed' : 'pointer',
    letterSpacing: '0.02em',
    transition: 'all 0.15s',
  }),
  chatAnswer: {
    background: 'rgba(99,102,241,0.1)',
    border: '1px solid rgba(99,102,241,0.25)',
    borderRadius: 12,
    padding: '14px 18px',
    marginTop: 12,
    fontSize: '0.87rem',
    color: '#cbd5e1',
    lineHeight: 1.7,
  },
  error: {
    background: 'rgba(239,68,68,0.12)',
    border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: 10,
    padding: '12px 16px',
    color: '#fca5a5',
    fontSize: '0.85rem',
    marginTop: 12,
  },
  tag: (color) => ({
    display: 'inline-block',
    padding: '2px 10px',
    borderRadius: 20,
    background: color + '22',
    color: color,
    fontSize: '0.72rem',
    fontWeight: 600,
    border: `1px solid ${color}44`,
    marginRight: 6,
    marginBottom: 4,
  }),
}

// ── Компонент статистической карточки ──────────────────────────────────────

function StatCard({ label, value, sub }) {
  return (
    <div style={S.statCard}>
      <div style={S.statLabel}>{label}</div>
      <div style={S.statValue}>{value ?? '—'}</div>
      {sub && <div style={S.statSub}>{sub}</div>}
    </div>
  )
}

// ── Основной компонент ──────────────────────────────────────────────────────

export default function PlatformAISection({ token }) {
  const [stats, setStats]           = useState(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [statsError, setStatsError] = useState(null)

  const [selectedType, setSelectedType] = useState('overview')
  const [analyzeLoading, setAnalyzeLoading] = useState(false)
  const [analyzeResult, setAnalyzeResult]   = useState(null)
  const [analyzeError, setAnalyzeError]     = useState(null)

  const [question, setQuestion]   = useState('')
  const [askLoading, setAskLoading] = useState(false)
  const [answers, setAnswers]     = useState([])
  const [askError, setAskError]   = useState(null)

  const days = 30

  // Загрузка статистики при монтировании
  useEffect(() => {
    setStatsLoading(true)
    setStatsError(null)
    apiFetch('GET', `/ai/platform/stats?days=${days}`, token)
      .then(data => {
        if (data.detail || data.error) {
          setStatsError(typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail))
        } else {
          setStats(data)
        }
      })
      .catch(e => setStatsError(e.message))
      .finally(() => setStatsLoading(false))
  }, [token])

  const handleAnalyze = useCallback(() => {
    setAnalyzeLoading(true)
    setAnalyzeError(null)
    setAnalyzeResult(null)
    apiFetch('GET', `/ai/platform/analyze?type=${selectedType}&days=${days}`, token)
      .then(data => {
        if (data.detail || data.error) {
          setAnalyzeError(typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail))
        } else {
          setAnalyzeResult(data)
        }
      })
      .catch(e => setAnalyzeError(e.message))
      .finally(() => setAnalyzeLoading(false))
  }, [selectedType, token])

  const handleAsk = useCallback(() => {
    if (!question.trim() || askLoading) return
    const q = question.trim()
    setAskLoading(true)
    setAskError(null)
    apiFetch('POST', '/ai/platform/ask', token, { question: q, days })
      .then(data => {
        if (data.detail || data.error) {
          setAskError(typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail))
        } else {
          setAnswers(prev => [{ question: q, answer: data.answer, model: data.model, at: data.generated_at }, ...prev])
          setQuestion('')
        }
      })
      .catch(e => setAskError(e.message))
      .finally(() => setAskLoading(false))
  }, [question, askLoading, token])

  return (
    <div style={S.wrap}>
      {/* Заголовок */}
      <div style={S.header}>
        <span style={S.headerIcon}>🧠</span>
        <div>
          <h1 style={S.headerTitle}>Platform AI Analytics</h1>
          <div style={S.headerSub}>Аналитика платформы КлиникСеть — только для super_admin</div>
        </div>
      </div>

      {/* Карточки статистики */}
      {statsLoading && (
        <div style={{ color: '#94a3b8', marginBottom: 20, fontSize: '0.9rem' }}>
          Загрузка данных платформы...
        </div>
      )}
      {statsError && (
        <div style={S.error}>Ошибка загрузки статистики: {statsError}</div>
      )}
      {stats && (
        <div style={S.statsGrid}>
          <StatCard
            label="Тенанты"
            value={stats.tenants?.total}
            sub={`Активных: ${stats.tenants?.active} • Новых в мес.: ${stats.tenants?.new_this_month}`}
          />
          <StatCard
            label="Пользователи"
            value={stats.users?.total}
            sub={`Активных: ${stats.users?.active}`}
          />
          <StatCard
            label="Направлений"
            value={stats.referrals?.total}
            sub={`За ${days} дн.: ${stats.referrals?.this_period} • avg/тенант: ${stats.referrals?.avg_per_tenant}`}
          />
          <StatCard
            label="Лиды"
            value={stats.leads?.total}
            sub={`Непрочитано: ${stats.leads?.unread} • За неделю: ${stats.leads?.this_week}`}
          />
          <StatCard
            label="Модули"
            value={stats.modules?.total_subscriptions}
            sub={stats.modules?.top_modules?.slice(0, 2).map(m => m.key).join(', ') || '—'}
          />
        </div>
      )}

      {/* Активность тенантов */}
      {stats && (
        <div style={S.section}>
          <div style={S.sectionTitle}>Активность тенантов (последние {days} дней)</div>
          <div style={{ marginBottom: 12 }}>
            <span style={{ fontSize: '0.8rem', color: '#94a3b8', marginRight: 8 }}>Активные:</span>
            {stats.activity?.tenants_active_30d?.length ? (
              stats.activity.tenants_active_30d.map(n => (
                <span key={n} style={S.tag('#4ade80')}>{n}</span>
              ))
            ) : (
              <span style={{ color: '#64748b', fontSize: '0.8rem' }}>нет</span>
            )}
          </div>
          <div>
            <span style={{ fontSize: '0.8rem', color: '#94a3b8', marginRight: 8 }}>Спящие:</span>
            {stats.activity?.tenants_dormant?.length ? (
              stats.activity.tenants_dormant.map(n => (
                <span key={n} style={S.tag('#f87171')}>{n}</span>
              ))
            ) : (
              <span style={{ color: '#64748b', fontSize: '0.8rem' }}>нет</span>
            )}
          </div>
        </div>
      )}

      {/* Блок AI анализа */}
      <div style={S.section}>
        <div style={S.sectionTitle}>AI Анализ платформы</div>
        <div style={S.typeGrid}>
          {ANALYSIS_TYPES.map(t => (
            <button
              key={t.key}
              style={S.typeBtn(selectedType === t.key)}
              onClick={() => setSelectedType(t.key)}
            >
              <span style={S.typeBtnIcon}>{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
        <button
          style={S.analyzeBtn(analyzeLoading)}
          onClick={handleAnalyze}
          disabled={analyzeLoading}
        >
          {analyzeLoading ? '⏳ Анализирую...' : '✨ Запустить анализ'}
        </button>

        {analyzeError && (
          <div style={S.error}>Ошибка анализа: {analyzeError}</div>
        )}

        {analyzeResult && (
          <div style={S.resultCard}>
            <div style={S.resultTitle}>
              <span>
                {ANALYSIS_TYPES.find(t => t.key === analyzeResult.type)?.icon}{' '}
                {analyzeResult.title}
              </span>
              <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
                {analyzeResult.model} · {new Date(analyzeResult.generated_at).toLocaleTimeString('ru')}
              </span>
            </div>
            <div
              style={S.resultText}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(analyzeResult.result) }}
            />
          </div>
        )}
      </div>

      {/* Свободный вопрос */}
      <div style={S.section}>
        <div style={S.sectionTitle}>Свободный вопрос о платформе</div>
        <input
          style={S.chatInput}
          type="text"
          placeholder="Например: Какой тенант наиболее активный?"
          value={question}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAsk()}
        />
        <button
          style={S.askBtn(askLoading)}
          onClick={handleAsk}
          disabled={askLoading || !question.trim()}
        >
          {askLoading ? '⏳ Думаю...' : '💬 Спросить'}
        </button>

        {askError && (
          <div style={S.error}>Ошибка: {askError}</div>
        )}

        {answers.map((a, i) => (
          <div key={i} style={{ marginTop: 16 }}>
            <div style={{ fontSize: '0.82rem', color: '#a78bfa', fontWeight: 700, marginBottom: 6 }}>
              ❓ {a.question}
            </div>
            <div style={S.chatAnswer}>
              <div
                dangerouslySetInnerHTML={{ __html: renderMarkdown(a.answer) }}
              />
              <div style={{ marginTop: 8, fontSize: '0.72rem', color: '#64748b' }}>
                {a.model} · {a.at ? new Date(a.at).toLocaleTimeString('ru') : ''}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
