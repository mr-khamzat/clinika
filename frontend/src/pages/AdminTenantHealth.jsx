/**
 * ========================================
 * AdminTenantHealth — мониторинг здоровья тенантов (super_admin)
 * ========================================
 * Показывает текущий score (0..100) каждого активного тенанта + alert_level
 * (green / yellow / red). Позволяет:
 *   - фильтровать по alert_level
 *   - детально смотреть факторы тенанта
 *   - вручную пересчитать score для конкретного тенанта
 *
 * Связан с router'ом /admin/tenant-health
 * (backend/app/routers/admin_tenant_health.py).
 * Маршрут регистрируется в AdminLayout/AdminRoot отдельно (не здесь).
 * ========================================
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '../api'
import { Card, Button, Chip, Tabs, EmptyState } from '../design'

// ── Локальные константы ─────────────────────────────────────────────────────

const LEVEL_LABELS = {
  green:  'Здоровые',
  yellow: 'Внимание',
  red:    'Риск отвала',
}

const LEVEL_TONES = {
  green:  'success',
  yellow: 'warning',
  red:    'danger',
}

const PAYMENT_LABELS = {
  ok: 'Оплачено',
  overdue: 'Просрочка',
  failed: 'Ошибка платежа',
  unknown: 'Нет данных',
}

const TABS = [
  { key: 'all',    label: 'Все' },
  { key: 'red',    label: 'Риск' },
  { key: 'yellow', label: 'Внимание' },
  { key: 'green',  label: 'Здоровые' },
]

// ── Утилиты ────────────────────────────────────────────────────────────────

function scoreTone(score) {
  if (score == null) return 'neutral'
  if (score >= 70) return 'success'
  if (score >= 40) return 'warning'
  return 'danger'
}

function fmtPct(v) {
  if (v == null) return '—'
  return `${Math.round(Number(v))}%`
}

// Компактный «спарклайн» — последние N значений из истории нарисованы через
// inline-SVG без зависимостей. Если данных <2 — просто прочерк.
function MiniTrend({ values }) {
  if (!values || values.length < 2) return <span style={{ color: '#94a3b8' }}>—</span>
  const W = 80
  const H = 24
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * W
      const y = H - ((v - min) / span) * H
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

// ── Drawer с деталями одного тенанта ──────────────────────────────────────

function TenantDetailDrawer({ tenantId, onClose }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get(`/admin/tenant-health/${tenantId}`)
      setData(res.data)
      setError(null)
    } catch (e) {
      setError(e?.response?.data?.detail || 'Не удалось загрузить детали')
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => { load() }, [load])

  const onRecompute = useCallback(async () => {
    try {
      await api.post(`/admin/tenant-health/${tenantId}/recompute`)
      await load()
    } catch (e) {
      alert(e?.response?.data?.detail || 'Ошибка пересчёта')
    }
  }, [tenantId, load])

  return (
    <div
      style={{
        position: 'fixed',
        right: 0,
        top: 0,
        bottom: 0,
        width: 'min(560px, 100vw)',
        background: 'var(--ks-surface, #fff)',
        boxShadow: '-10px 0 30px rgba(15,23,42,.18)',
        zIndex: 60,
        padding: 24,
        overflowY: 'auto',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>
          {data?.tenant_name || 'Тенант'}
          {data?.tenant_slug ? <span style={{ color: '#64748b', marginLeft: 8, fontWeight: 400 }}>/{data.tenant_slug}</span> : null}
        </h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button kind="secondary" onClick={onRecompute}>Пересчитать</Button>
          <Button kind="ghost" onClick={onClose}>Закрыть</Button>
        </div>
      </div>

      {loading && <div style={{ marginTop: 24, color: '#64748b' }}>Загрузка…</div>}
      {error && <div style={{ marginTop: 24, color: '#b91c1c' }}>{error}</div>}

      {!loading && data?.current && (
        <>
          <Card style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ fontSize: 36, fontWeight: 700, color: scoreTone(data.current.score) === 'danger' ? '#b91c1c' : scoreTone(data.current.score) === 'warning' ? '#b45309' : '#15803d' }}>
                {data.current.score}
              </div>
              <Chip tone={LEVEL_TONES[data.current.alert_level]}>
                {LEVEL_LABELS[data.current.alert_level]}
              </Chip>
              <div style={{ marginLeft: 'auto', color: '#64748b', fontSize: 12 }}>
                {data.current.captured_at ? new Date(data.current.captured_at).toLocaleString('ru-RU') : ''}
              </div>
            </div>
          </Card>

          <Card title="Факторы" style={{ marginTop: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                <tr><td style={tdLabel}>Активность 30д</td><td style={tdVal}>{fmtPct((data.current.factors?.activity_30d ?? 0) * 100)}</td></tr>
                <tr><td style={tdLabel}>Платёжный статус</td><td style={tdVal}>{PAYMENT_LABELS[data.current.factors?.payment_status] || data.current.factors?.payment_status || '—'}</td></tr>
                <tr><td style={tdLabel}>Риск оттока</td><td style={tdVal}>{fmtPct(data.current.factors?.churn_risk_pct)}</td></tr>
                <tr><td style={tdLabel}>Тикеты в саппорт 30д</td><td style={tdVal}>{data.current.factors?.support_tickets_30d ?? 0}</td></tr>
                <tr><td style={tdLabel}>Адопция фич</td><td style={tdVal}>{fmtPct(data.current.factors?.feature_adoption_pct)}</td></tr>
                <tr><td style={tdLabel}>Активность пользователей</td><td style={tdVal}>{fmtPct(data.current.factors?.users_active_pct)}</td></tr>
                <tr><td style={tdLabel}>Источник</td><td style={tdVal}>{data.current.factors?._source ?? '—'}</td></tr>
              </tbody>
            </table>
          </Card>

          <Card title={`История (${data.history?.length ?? 0})`} style={{ marginTop: 12 }}>
            {data.history?.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.history.slice(0, 30).map(h => (
                  <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <span style={{ color: '#64748b', minWidth: 140 }}>
                      {h.captured_at ? new Date(h.captured_at).toLocaleString('ru-RU') : ''}
                    </span>
                    <span style={{ fontWeight: 600 }}>{h.score}</span>
                    <Chip tone={LEVEL_TONES[h.alert_level]} size="sm">{h.alert_level}</Chip>
                  </div>
                ))}
              </div>
            ) : <EmptyState title="Истории пока нет" />}
          </Card>
        </>
      )}
    </div>
  )
}

const tdLabel = { padding: '6px 8px', color: '#64748b', fontSize: 13 }
const tdVal   = { padding: '6px 8px', fontSize: 13, fontWeight: 500, textAlign: 'right' }

// ── Корневой компонент ─────────────────────────────────────────────────────

export default function AdminTenantHealth() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('all')
  const [openTenantId, setOpenTenantId] = useState(null)
  const [recomputing, setRecomputing] = useState(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/admin/tenant-health/')
      setRows(data || [])
      setError(null)
    } catch (e) {
      setError(e?.response?.data?.detail || 'Не удалось загрузить тенантов')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  const filtered = useMemo(() => {
    if (tab === 'all') return rows
    return rows.filter(r => r.alert_level === tab)
  }, [rows, tab])

  const onRecompute = useCallback(async (tenantId) => {
    setRecomputing(tenantId)
    try {
      await api.post(`/admin/tenant-health/${tenantId}/recompute`)
      await reload()
    } catch (e) {
      alert(e?.response?.data?.detail || 'Ошибка пересчёта')
    } finally {
      setRecomputing(null)
    }
  }, [reload])

  // Сводные KPI
  const summary = useMemo(() => {
    const total = rows.length
    const red = rows.filter(r => r.alert_level === 'red').length
    const yellow = rows.filter(r => r.alert_level === 'yellow').length
    const green = rows.filter(r => r.alert_level === 'green').length
    return { total, red, yellow, green }
  }, [rows])

  return (
    <div style={{ padding: 24, maxWidth: 1280, margin: '0 auto' }}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Здоровье тенантов</h1>
        <p style={{ margin: '4px 0 0', color: '#64748b' }}>
          Скоринг 0..100 с разбивкой по факторам. Чем ниже — тем выше риск отвала.
        </p>
      </header>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <Card style={{ flex: 1, minWidth: 140 }}>
          <div style={{ fontSize: 12, color: '#64748b' }}>Всего тенантов</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.total}</div>
        </Card>
        <Card style={{ flex: 1, minWidth: 140 }}>
          <div style={{ fontSize: 12, color: '#64748b' }}>Риск</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#b91c1c' }}>{summary.red}</div>
        </Card>
        <Card style={{ flex: 1, minWidth: 140 }}>
          <div style={{ fontSize: 12, color: '#64748b' }}>Внимание</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#b45309' }}>{summary.yellow}</div>
        </Card>
        <Card style={{ flex: 1, minWidth: 140 }}>
          <div style={{ fontSize: 12, color: '#64748b' }}>Здоровые</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#15803d' }}>{summary.green}</div>
        </Card>
      </div>

      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      {loading && <div style={{ marginTop: 24, color: '#64748b' }}>Загрузка…</div>}
      {error && <div style={{ marginTop: 24, color: '#b91c1c' }}>{error}</div>}

      {!loading && !error && filtered.length === 0 && (
        <EmptyState
          title="Нет данных"
          description="Снимков ещё не накопилось — запустите пересчёт для нужного тенанта."
        />
      )}

      {!loading && !error && filtered.length > 0 && (
        <Card style={{ marginTop: 12, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>
                <th style={th}>Тенант</th>
                <th style={th}>Score</th>
                <th style={th}>Уровень</th>
                <th style={th}>Активность</th>
                <th style={th}>Платёж</th>
                <th style={th}>Действия</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.tenant_id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={td}>
                    <div style={{ fontWeight: 500 }}>{r.tenant_name}</div>
                    <div style={{ color: '#94a3b8', fontSize: 12 }}>/{r.tenant_slug}</div>
                  </td>
                  <td style={td}>
                    {r.score == null ? (
                      <span style={{ color: '#94a3b8' }}>—</span>
                    ) : (
                      <span style={{
                        fontWeight: 700,
                        color: scoreTone(r.score) === 'danger'
                          ? '#b91c1c'
                          : scoreTone(r.score) === 'warning'
                            ? '#b45309'
                            : '#15803d',
                      }}>{r.score}</span>
                    )}
                  </td>
                  <td style={td}>
                    {r.alert_level ? (
                      <Chip tone={LEVEL_TONES[r.alert_level]}>
                        {LEVEL_LABELS[r.alert_level] || r.alert_level}
                      </Chip>
                    ) : <span style={{ color: '#94a3b8' }}>—</span>}
                  </td>
                  <td style={td}>{fmtPct((r.factors?.activity_30d ?? 0) * 100)}</td>
                  <td style={td}>{PAYMENT_LABELS[r.factors?.payment_status] || r.factors?.payment_status || '—'}</td>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Button
                        kind="secondary"
                        size="sm"
                        onClick={() => onRecompute(r.tenant_id)}
                        disabled={recomputing === r.tenant_id}
                      >
                        {recomputing === r.tenant_id ? '...' : 'Пересчёт'}
                      </Button>
                      <Button kind="ghost" size="sm" onClick={() => setOpenTenantId(r.tenant_id)}>
                        Детали
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {openTenantId && (
        <TenantDetailDrawer
          tenantId={openTenantId}
          onClose={() => setOpenTenantId(null)}
        />
      )}
    </div>
  )
}

const th = { padding: '10px 8px', fontSize: 12, color: '#64748b', fontWeight: 600 }
const td = { padding: '10px 8px', fontSize: 14 }
