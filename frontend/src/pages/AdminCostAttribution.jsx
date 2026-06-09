/**
 * ========================================
 * AdminCostAttribution — стоимость тенантов для платформы (super_admin)
 * ========================================
 * Показывает топ-20 тенантов по оценочной стоимости (storage + API + calls).
 * Сводные KPI: total cost платформы / avg / самый дорогой тенант.
 * Селектор периода: текущий / прошлый / 12 месяцев (просмотр истории).
 *
 * Связан с router'ом /admin/cost-attribution
 * (backend/app/routers/admin_cost_attribution.py).
 * Маршрут регистрируется в AdminLayout/AdminRoot отдельно (не здесь).
 * ========================================
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '../api'
import { Card, Button, Chip, Tabs, EmptyState } from '../design'

// ── Утилиты ────────────────────────────────────────────────────────────────

function monthIso(offset = 0) {
  // offset=0 → 1-е число текущего месяца; offset=-1 → прошлого; и т.д.
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() + offset)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}-01`
}

function fmtMonth(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU', { year: 'numeric', month: 'long' })
}

function fmtRub(v) {
  if (v == null) return '—'
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(Number(v))
}

function fmtInt(v) {
  if (v == null) return '—'
  return new Intl.NumberFormat('ru-RU').format(Number(v))
}

// Spark-trend по 12 истории (как в TenantHealth).
function MiniBars({ values }) {
  if (!values || values.length < 2) return <span style={{ color: '#94a3b8' }}>—</span>
  const W = 80
  const H = 20
  const max = Math.max(...values, 1)
  const barW = W / values.length
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
      {values.map((v, i) => {
        const h = (v / max) * H
        return (
          <rect
            key={i}
            x={i * barW + 1}
            y={H - h}
            width={Math.max(barW - 2, 1)}
            height={h}
            fill="#60a5fa"
          />
        )
      })}
    </svg>
  )
}

// ── Drawer с деталями одного тенанта ──────────────────────────────────────

function TenantDetailDrawer({ tenantId, onClose }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const res = await api.get(`/admin/cost-attribution/${tenantId}`)
        if (!cancelled) {
          setData(res.data)
          setError(null)
        }
      } catch (e) {
        if (!cancelled) setError(e?.response?.data?.detail || 'Не удалось загрузить детали')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [tenantId])

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
        <Button kind="ghost" onClick={onClose}>Закрыть</Button>
      </div>

      {loading && <div style={{ marginTop: 24, color: '#64748b' }}>Загрузка…</div>}
      {error && <div style={{ marginTop: 24, color: '#b91c1c' }}>{error}</div>}

      {!loading && data?.current && (
        <>
          <Card title="Текущий период" style={{ marginTop: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <KV label="Период" value={fmtMonth(data.current.period)} />
              <KV label="Стоимость" value={fmtRub(data.current.est_cost_rub)} bold />
              <KV label="Хранилище" value={`${fmtInt(data.current.storage_mb)} МБ`} />
              <KV label="API-запросы" value={fmtInt(data.current.api_requests)} />
              <KV label="Минуты звонков" value={fmtInt(data.current.calls_minutes)} />
              <KV label="Строк в БД (≈)" value={fmtInt(data.current.db_rows_estimate)} />
            </div>
          </Card>

          <Card title={`История (${data.history?.length ?? 0})`} style={{ marginTop: 12 }}>
            {data.history?.length ? (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={th}>Месяц</th>
                    <th style={th}>Стоимость</th>
                    <th style={th}>Хранилище</th>
                    <th style={th}>API</th>
                    <th style={th}>Мин</th>
                  </tr>
                </thead>
                <tbody>
                  {data.history.map(h => (
                    <tr key={h.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={td}>{fmtMonth(h.period)}</td>
                      <td style={td}>{fmtRub(h.est_cost_rub)}</td>
                      <td style={td}>{fmtInt(h.storage_mb)}</td>
                      <td style={td}>{fmtInt(h.api_requests)}</td>
                      <td style={td}>{fmtInt(h.calls_minutes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <EmptyState title="Истории нет" />}
          </Card>
        </>
      )}
    </div>
  )
}

function KV({ label, value, bold = false }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: '#64748b' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: bold ? 700 : 500 }}>{value}</div>
    </div>
  )
}

// ── Корневой компонент ─────────────────────────────────────────────────────

const PERIOD_TABS = [
  { key: 'current',  label: 'Текущий месяц' },
  { key: 'previous', label: 'Прошлый месяц' },
  { key: 'history',  label: 'История (12 мес)' },
]

export default function AdminCostAttribution() {
  const [periodTab, setPeriodTab] = useState('current')
  const [rows, setRows] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [snapshotting, setSnapshotting] = useState(false)
  const [openTenantId, setOpenTenantId] = useState(null)

  // Период для GET / и /summary в зависимости от выбранного таба.
  const period = useMemo(() => {
    if (periodTab === 'current')  return monthIso(0)
    if (periodTab === 'previous') return monthIso(-1)
    return null  // history — без явного period, берём latest
  }, [periodTab])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const params = period ? { period } : {}
      const [topRes, sumRes] = await Promise.all([
        api.get('/admin/cost-attribution/', { params }),
        api.get('/admin/cost-attribution/summary', { params }),
      ])
      setRows(topRes.data || [])
      setSummary(sumRes.data || null)
      setError(null)
    } catch (e) {
      setError(e?.response?.data?.detail || 'Не удалось загрузить данные')
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => { reload() }, [reload])

  const onSnapshot = useCallback(async () => {
    if (!window.confirm('Запустить snapshot для всех тенантов за текущий месяц?')) return
    setSnapshotting(true)
    try {
      await api.post('/admin/cost-attribution/snapshot')
      await reload()
    } catch (e) {
      alert(e?.response?.data?.detail || 'Ошибка snapshot')
    } finally {
      setSnapshotting(false)
    }
  }, [reload])

  return (
    <div style={{ padding: 24, maxWidth: 1280, margin: '0 auto' }}>
      <header style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Стоимость тенантов</h1>
          <p style={{ margin: '4px 0 0', color: '#64748b' }}>
            Сколько каждый тенант стоит платформе: хранилище, API, звонки.
          </p>
        </div>
        <Button kind="primary" onClick={onSnapshot} disabled={snapshotting}>
          {snapshotting ? 'Считаем…' : 'Снять snapshot'}
        </Button>
      </header>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <Card style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: 12, color: '#64748b' }}>Total cost платформы</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>
            {summary ? fmtRub(summary.total_cost_rub) : '—'}
          </div>
          {summary?.period && <div style={{ fontSize: 12, color: '#94a3b8' }}>{fmtMonth(summary.period)}</div>}
        </Card>
        <Card style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: 12, color: '#64748b' }}>Avg per tenant</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>
            {summary ? fmtRub(summary.avg_cost_rub) : '—'}
          </div>
          {summary && <div style={{ fontSize: 12, color: '#94a3b8' }}>тенантов: {summary.tenant_count}</div>}
        </Card>
        <Card style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 12, color: '#64748b' }}>Top heaviest</div>
          {summary?.top_tenant ? (
            <>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{summary.top_tenant.tenant_name}</div>
              <div style={{ fontSize: 14, color: '#b45309' }}>{fmtRub(summary.top_tenant.est_cost_rub)}</div>
            </>
          ) : <div style={{ fontSize: 14, color: '#94a3b8' }}>—</div>}
        </Card>
      </div>

      <Tabs tabs={PERIOD_TABS} value={periodTab} onChange={setPeriodTab} />

      {loading && <div style={{ marginTop: 24, color: '#64748b' }}>Загрузка…</div>}
      {error && <div style={{ marginTop: 24, color: '#b91c1c' }}>{error}</div>}

      {!loading && !error && rows.length === 0 && (
        <EmptyState
          title="Нет снимков"
          description="Запустите snapshot, чтобы собрать данные за текущий период."
        />
      )}

      {!loading && !error && rows.length > 0 && (
        <Card style={{ marginTop: 12, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>
                <th style={th}>#</th>
                <th style={th}>Тенант</th>
                <th style={th}>Хранилище МБ</th>
                <th style={th}>API запросы</th>
                <th style={th}>Минуты</th>
                <th style={th}>Стоимость</th>
                <th style={th}>Действия</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={td}>{idx + 1}</td>
                  <td style={td}>
                    <div style={{ fontWeight: 500 }}>{r.tenant_name}</div>
                    <div style={{ color: '#94a3b8', fontSize: 12 }}>/{r.tenant_slug}</div>
                  </td>
                  <td style={td}>{fmtInt(r.storage_mb)}</td>
                  <td style={td}>{fmtInt(r.api_requests)}</td>
                  <td style={td}>{fmtInt(r.calls_minutes)}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{fmtRub(r.est_cost_rub)}</td>
                  <td style={td}>
                    <Button kind="ghost" size="sm" onClick={() => setOpenTenantId(r.tenant_id)}>
                      Детали
                    </Button>
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
