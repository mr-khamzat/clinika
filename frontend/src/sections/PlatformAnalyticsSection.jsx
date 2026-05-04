/**
 * PlatformAnalyticsSection — Аналитика всей платформы для super_admin.
 * Фиолетово-чёрный градиент (стиль PlatformAISection).
 *
 * Содержит:
 *   • Фильтр периода 7д / 14д / 30д / 90д
 *   • 6 KPI: Тенантов, Новых, Активных, Отток, Avg клиник/тенант, Avg направлений/клинику
 *   • Гео-распределение (топ городов из аудита) или заглушка
 *   • Top тенанты по выручке
 *   • Динамика подписок (SVG sparkline)
 */
import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import { API_BASE } from '../config'

// ── Утилиты ──────────────────────────────────────────────────────────────────

const authHeaders = (token) => ({ Authorization: `Bearer ${token}` })
const apiFetch = (method, url, token, data) =>
  axios({ method, url: `${API_BASE}${url}`, headers: authHeaders(token), data })

const fmtRub = (v) => {
  const n = Number(v || 0)
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(n)
}

// ── Стили ─────────────────────────────────────────────────────────────────────

const S = {
  wrap: {
    minHeight: '100%',
    background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #1e1b4b 100%)',
    padding: '24px',
    color: '#e2e8f0',
    fontFamily: 'Inter, sans-serif',
    borderRadius: 16,
  },
  header: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' },
  headerIcon: {
    fontSize: 32,
    background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  headerTitle: { fontSize: '1.6rem', fontWeight: 800, color: '#f1f5f9', margin: 0 },
  headerSub: { fontSize: '0.85rem', color: '#94a3b8', marginTop: 2 },
  filterRow: {
    display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap',
  },
  filterBtn: (active) => ({
    padding: '8px 16px',
    borderRadius: 10,
    border: 'none',
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: 600,
    background: active ? 'linear-gradient(135deg,#7c3aed,#a855f7)' : 'rgba(139,92,246,0.12)',
    color: active ? '#fff' : '#c4b5fd',
    transition: 'all 0.15s',
  }),
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
    gap: 14,
    marginBottom: 28,
  },
  statCard: {
    background: 'rgba(139, 92, 246, 0.12)',
    border: '1px solid rgba(139, 92, 246, 0.25)',
    borderRadius: 14,
    padding: '16px 18px',
    backdropFilter: 'blur(8px)',
  },
  statLabel: {
    fontSize: '0.72rem', color: '#94a3b8', textTransform: 'uppercase',
    letterSpacing: '0.05em', marginBottom: 6,
  },
  statValue: { fontSize: '1.8rem', fontWeight: 800, color: '#a78bfa', lineHeight: 1, marginBottom: 4 },
  statSub: { fontSize: '0.76rem', color: '#64748b' },
  panel: {
    background: 'rgba(15,23,42,0.5)',
    border: '1px solid rgba(139,92,246,0.18)',
    borderRadius: 14,
    padding: 20,
    marginBottom: 18,
  },
  panelTitle: {
    fontSize: '1rem', fontWeight: 700, color: '#c4b5fd', marginBottom: 14,
    display: 'flex', alignItems: 'center', gap: 8,
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' },
  th: {
    textAlign: 'left', padding: '8px 10px', color: '#94a3b8',
    fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase',
    letterSpacing: '0.04em', borderBottom: '1px solid rgba(139,92,246,0.15)',
  },
  td: { padding: '10px', color: '#e2e8f0', borderBottom: '1px solid rgba(139,92,246,0.08)' },
  empty: {
    padding: '24px',
    textAlign: 'center',
    color: '#64748b',
    fontSize: '0.85rem',
    background: 'rgba(15,23,42,0.4)',
    borderRadius: 10,
    border: '1px dashed rgba(139,92,246,0.2)',
  },
}

// ── Sparkline (SVG) ──────────────────────────────────────────────────────────

function Sparkline({ data, width = 100, height = 30, color = '#a78bfa' }) {
  if (!data || data.length === 0) return null
  const counts = data.map(d => d.count || 0)
  const max = Math.max(...counts, 1)
  const min = Math.min(...counts, 0)
  const range = max - min || 1
  const step = data.length > 1 ? width / (data.length - 1) : 0
  const points = counts.map((v, i) => {
    const x = i * step
    const y = height - ((v - min) / range) * height
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
      {/* Точки */}
      {counts.map((v, i) => {
        const x = i * step
        const y = height - ((v - min) / range) * height
        return <circle key={i} cx={x} cy={y} r="1.5" fill={color} />
      })}
    </svg>
  )
}

// ── KPI карточка ─────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub }) {
  return (
    <div style={S.statCard}>
      <div style={S.statLabel}>{label}</div>
      <div style={S.statValue}>{value ?? '—'}</div>
      {sub && <div style={S.statSub}>{sub}</div>}
    </div>
  )
}

// ── Главный компонент ────────────────────────────────────────────────────────

export default function PlatformAnalyticsSection({ token }) {
  const [days, setDays] = useState(30)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const r = await apiFetch('get', `/admin/analytics/platform?days=${days}`, token)
      setData(r.data)
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Ошибка загрузки аналитики')
    } finally { setLoading(false) }
  }, [token, days])

  useEffect(() => { load() }, [load])

  const totalSubs = (data?.subscription_dynamics || []).reduce((acc, p) => acc + (p.count || 0), 0)

  return (
    <div style={S.wrap}>
      <div style={S.header}>
        <span style={S.headerIcon}>📊</span>
        <div>
          <h2 style={S.headerTitle}>Аналитика платформы</h2>
          <div style={S.headerSub}>Метрики франшизной сети — рост, отток, география, выручка</div>
        </div>
      </div>

      {/* Фильтр периода */}
      <div style={S.filterRow}>
        {[7, 14, 30, 90].map(d => (
          <button key={d} style={S.filterBtn(days === d)} onClick={() => setDays(d)}>
            {d} дней
          </button>
        ))}
        <button
          onClick={load}
          style={{ ...S.filterBtn(false), marginLeft: 'auto' }}
        >
          ↻ Обновить
        </button>
      </div>

      {err && (
        <div style={{ ...S.panel, borderColor: 'rgba(239,68,68,0.5)', color: '#fca5a5' }}>
          {err}
        </div>
      )}

      {/* KPI */}
      <div style={S.statsGrid}>
        <KpiCard label="Тенантов всего" value={data?.tenants_total} sub="вся платформа" />
        <KpiCard label="Новых за период" value={data?.tenants_new} sub={`за ${days} дн`} />
        <KpiCard label="Активных" value={data?.tenants_active} sub="is_active=true" />
        <KpiCard label="Отток" value={data?.churned} sub="cancelled подписок" />
        <KpiCard label="Avg клиник/тенант" value={data?.avg_clinics_per_tenant} sub="среднее по сети" />
        <KpiCard label="Avg направлений/клинику" value={data?.avg_directions_per_clinic} sub="категории услуг" />
      </div>

      {/* Top тенанты по выручке */}
      <div style={S.panel}>
        <div style={S.panelTitle}>
          <span>🏆</span>
          <span>Top-10 тенантов по выручке за {days} дн</span>
        </div>
        {!data?.top_revenue?.length ? (
          <div style={S.empty}>
            Пока нет оплаченных счетов за выбранный период
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>#</th>
                  <th style={S.th}>Тенант</th>
                  <th style={S.th}>Slug</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>Выручка</th>
                </tr>
              </thead>
              <tbody>
                {data.top_revenue.map((t, i) => (
                  <tr key={t.tenant_id}>
                    <td style={{ ...S.td, color: '#a78bfa', fontWeight: 700 }}>{i + 1}</td>
                    <td style={{ ...S.td, fontWeight: 600 }}>{t.tenant_name}</td>
                    <td style={{ ...S.td, color: '#94a3b8', fontSize: '0.8rem' }}>{t.slug}</td>
                    <td style={{ ...S.td, textAlign: 'right', fontWeight: 700, color: '#a78bfa' }}>
                      {fmtRub(t.revenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* География */}
      <div style={S.panel}>
        <div style={S.panelTitle}>
          <span>🌍</span>
          <span>География франшиз</span>
        </div>
        {!data?.geo_distribution?.length ? (
          <div style={S.empty}>
            Гео-IP включится после первого входа super_admin / franchise_owner.
            <br />
            Данные подтягиваются из <code>audit_log</code> по полям <code>geo_country</code>, <code>geo_city</code>.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Страна</th>
                  <th style={S.th}>Город</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>Входов</th>
                </tr>
              </thead>
              <tbody>
                {data.geo_distribution.map((g, i) => (
                  <tr key={i}>
                    <td style={S.td}>
                      <span style={{ fontWeight: 600 }}>{g.country_name || g.country || '—'}</span>
                      {g.country && (
                        <span style={{ color: '#64748b', marginLeft: 6, fontSize: '0.78rem' }}>
                          {g.country}
                        </span>
                      )}
                    </td>
                    <td style={{ ...S.td, color: '#cbd5e1' }}>{g.city || '—'}</td>
                    <td style={{ ...S.td, textAlign: 'right', fontWeight: 700, color: '#a78bfa' }}>
                      {g.hits}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Динамика подписок */}
      <div style={S.panel}>
        <div style={S.panelTitle}>
          <span>📈</span>
          <span>Динамика новых подписок</span>
          <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: '#94a3b8', fontWeight: 500 }}>
            Всего: <b style={{ color: '#a78bfa' }}>{totalSubs}</b>
          </span>
        </div>
        {!data?.subscription_dynamics?.length ? (
          <div style={S.empty}>Нет подписок за выбранный период</div>
        ) : (
          <>
            <div style={{ marginBottom: 12, height: 60 }}>
              <Sparkline data={data.subscription_dynamics} width={300} height={60} />
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {data.subscription_dynamics.map((p, i) => (
                <div
                  key={i}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 8,
                    background: 'rgba(139,92,246,0.15)',
                    border: '1px solid rgba(139,92,246,0.25)',
                    fontSize: '0.75rem',
                    color: '#c4b5fd',
                  }}
                  title={`${p.day} → ${p.count}`}
                >
                  <span style={{ color: '#94a3b8' }}>
                    {p.day ? new Date(p.day).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) : '—'}
                  </span>
                  <span style={{ marginLeft: 6, fontWeight: 700, color: '#a78bfa' }}>{p.count}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: 20, color: '#a78bfa' }}>
          Загрузка…
        </div>
      )}
    </div>
  )
}
