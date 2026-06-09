/**
 * AdminApiQuotas — управление лимитами API по тенантам (super_admin).
 *
 * Backend (quota01):
 *   GET    /admin/quotas/                        — список тенантов с квотами и текущим использованием
 *   GET    /admin/quotas/alerts                  — тенанты, у которых usage ≥ 80% от лимита
 *   GET    /admin/quotas/{tenant_id}             — детали + история 30 дней
 *   PUT    /admin/quotas/{tenant_id}             — изменить квоты
 *   POST   /admin/quotas/{tenant_id}/reset       — обнулить usage
 */
import { useEffect, useMemo, useState, useCallback } from 'react'
import api from '../api'
import {
  Page,
  PageHeader,
  Card,
  Button,
  Chip,
  Tabs,
  EmptyState,
  Skeleton,
} from '../design'

const FIELDS = [
  { key: 'requests_per_minute', label: 'RPM',       unit: 'req/min' },
  { key: 'requests_per_day',    label: 'RPD',       unit: 'req/day' },
  { key: 'storage_mb_limit',    label: 'Storage',   unit: 'MB' },
  { key: 'users_limit',         label: 'Users',     unit: '' },
  { key: 'calls_minutes_per_month', label: 'Calls', unit: 'мин/мес' },
]

function pct(used, limit) {
  if (!limit) return 0
  const v = Math.round((Number(used || 0) / Number(limit)) * 100)
  return Math.min(999, Math.max(0, v))
}

function chipVariant(p) {
  if (p >= 95) return 'bad'
  if (p >= 80) return 'warn'
  if (p >= 50) return 'accent'
  return 'good'
}

export default function AdminApiQuotas() {
  const [tab, setTab] = useState('all')          // all | alerts
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null) // tenant detail drawer
  const [editing, setEditing] = useState(null)   // tenant edit modal
  const [savingId, setSavingId] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const url = tab === 'alerts' ? '/admin/quotas/alerts' : '/admin/quotas/'
      const r = await api.get(url)
      setRows(Array.isArray(r.data) ? r.data : (r.data?.items || []))
    } catch (e) {
      setError(e?.response?.data?.detail || e.message)
    } finally {
      setLoading(false)
    }
  }, [tab])

  useEffect(() => { load() }, [load])

  const openDetail = async (tenantId) => {
    try {
      const r = await api.get(`/admin/quotas/${tenantId}`)
      setSelected(r.data)
    } catch (e) {
      alert('Не удалось загрузить детали: ' + (e?.response?.data?.detail || e.message))
    }
  }

  const startEdit = (row) => {
    setEditing({
      tenant_id: row.tenant_id || row.id,
      tenant_name: row.tenant_name || row.name || '',
      requests_per_minute: row.requests_per_minute,
      requests_per_day: row.requests_per_day,
      storage_mb_limit: row.storage_mb_limit,
      users_limit: row.users_limit,
      calls_minutes_per_month: row.calls_minutes_per_month,
    })
  }

  const saveQuotas = async () => {
    if (!editing) return
    setSavingId(editing.tenant_id)
    try {
      const payload = {}
      for (const f of FIELDS) payload[f.key] = Number(editing[f.key] || 0)
      await api.put(`/admin/quotas/${editing.tenant_id}`, payload)
      setEditing(null)
      await load()
    } catch (e) {
      alert('Ошибка: ' + (e?.response?.data?.detail || e.message))
    } finally {
      setSavingId('')
    }
  }

  const resetUsage = async (tenantId) => {
    if (!confirm('Обнулить usage для этого тенанта?')) return
    setSavingId(tenantId)
    try {
      await api.post(`/admin/quotas/${tenantId}/reset`)
      await load()
    } catch (e) {
      alert('Ошибка: ' + (e?.response?.data?.detail || e.message))
    } finally {
      setSavingId('')
    }
  }

  return (
    <Page>
      <PageHeader
        title="API Quotas"
        subtitle="Лимиты на запросы/storage/users по тенантам и текущее потребление"
      />

      <Tabs
        items={[
          { key: 'all',    label: 'Все тенанты' },
          { key: 'alerts', label: 'Близко к лимиту' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {loading && (
        <Card>
          <div style={{ padding: 16 }}>
            <Skeleton lines={6} />
          </div>
        </Card>
      )}

      {error && (
        <Card>
          <div style={{ padding: 16, color: 'var(--bad, #b91c1c)' }}>{error}</div>
        </Card>
      )}

      {!loading && !error && rows.length === 0 && (
        <EmptyState
          icon="speed"
          title={tab === 'alerts' ? 'Нет тенантов близко к лимиту' : 'Нет данных по квотам'}
        />
      )}

      {!loading && !error && rows.length > 0 && (
        <Card>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ background: 'var(--surface-2)' }}>
                  <th style={{ textAlign: 'left',  padding: 10 }}>Тенант</th>
                  {FIELDS.map(f => (
                    <th key={f.key} style={{ textAlign: 'right', padding: 10 }}>{f.label}</th>
                  ))}
                  <th style={{ textAlign: 'right', padding: 10 }}>Действия</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => {
                  const tid = row.tenant_id || row.id
                  const u = row.usage || {}
                  return (
                    <tr key={tid || idx} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: 10 }}>
                        <button
                          type="button"
                          onClick={() => openDetail(tid)}
                          style={{ background: 'transparent', border: 'none', textDecoration: 'underline', cursor: 'pointer', color: 'var(--accent)', padding: 0 }}
                        >
                          {row.tenant_name || row.name || tid?.slice(0, 8)}
                        </button>
                      </td>
                      {FIELDS.map(f => {
                        const limit = row[f.key]
                        const usedKey =
                          f.key === 'requests_per_minute' ? 'requests_used_rpm'
                          : f.key === 'requests_per_day'    ? 'requests_used_today'
                          : f.key === 'storage_mb_limit'    ? 'storage_mb_used'
                          : f.key === 'users_limit'         ? 'users_count'
                          : f.key === 'calls_minutes_per_month' ? 'calls_minutes_used'
                          : null
                        const used = usedKey ? (u[usedKey] ?? row[usedKey] ?? 0) : 0
                        const p = pct(used, limit)
                        return (
                          <td key={f.key} style={{ padding: 10, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            <div>{Number(used).toLocaleString('ru-RU')} / {Number(limit || 0).toLocaleString('ru-RU')}</div>
                            <Chip size="sm" variant={chipVariant(p)}>{p}%</Chip>
                          </td>
                        )
                      })}
                      <td style={{ padding: 10, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <Button size="sm" variant="ghost" onClick={() => startEdit(row)} disabled={savingId === tid}>Изменить</Button>{' '}
                        <Button size="sm" variant="ghost" onClick={() => resetUsage(tid)} disabled={savingId === tid}>Reset</Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {editing && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setEditing(null) }}
        >
          <div
            style={{
              background: 'var(--surface)', borderRadius: 16, padding: 24, width: 'min(520px, 90vw)',
              border: '1px solid var(--border)',
            }}
          >
            <h3 style={{ marginTop: 0 }}>Квоты — {editing.tenant_name}</h3>
            <div style={{ display: 'grid', gap: 12 }}>
              {FIELDS.map(f => (
                <label key={f.key} style={{ display: 'grid', gap: 4 }}>
                  <span style={{ fontSize: 13, color: 'var(--fg-muted)' }}>
                    {f.label} <span style={{ color: 'var(--fg-3)' }}>({f.unit})</span>
                  </span>
                  <input
                    type="number"
                    min="0"
                    value={editing[f.key] ?? ''}
                    onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value })}
                    style={{
                      padding: '8px 12px', borderRadius: 10,
                      border: '1px solid var(--border)', background: 'var(--surface-2)',
                      color: 'var(--fg)', fontSize: 14,
                    }}
                  />
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
              <Button variant="ghost" onClick={() => setEditing(null)}>Отмена</Button>
              <Button variant="primary" onClick={saveQuotas} disabled={!!savingId}>
                {savingId ? 'Сохранение…' : 'Сохранить'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setSelected(null) }}
        >
          <div
            style={{
              background: 'var(--surface)', borderRadius: 16, padding: 24, width: 'min(720px, 90vw)',
              maxHeight: '80vh', overflowY: 'auto',
              border: '1px solid var(--border)',
            }}
          >
            <h3 style={{ marginTop: 0 }}>
              {selected.tenant_name || selected.tenant_id?.slice(0, 8)}
            </h3>
            <p style={{ color: 'var(--fg-muted)', fontSize: 13, marginTop: -4 }}>
              История использования за 30 дней
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 16 }}>
              {FIELDS.map(f => (
                <div key={f.key} style={{ padding: 12, borderRadius: 12, background: 'var(--surface-2)' }}>
                  <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{f.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 600 }}>
                    {Number(selected[f.key] || 0).toLocaleString('ru-RU')}
                  </div>
                </div>
              ))}
            </div>
            {Array.isArray(selected.history) && selected.history.length > 0 && (
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead>
                  <tr><th align="left">Дата</th><th align="right">RPM peak</th><th align="right">RPD</th><th align="right">Storage MB</th><th align="right">Calls min</th></tr>
                </thead>
                <tbody>
                  {selected.history.slice(0, 30).map((h, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: 6 }}>{h.period}</td>
                      <td style={{ padding: 6, textAlign: 'right' }}>{h.requests_peak_rpm ?? '-'}</td>
                      <td style={{ padding: 6, textAlign: 'right' }}>{h.requests_count ?? 0}</td>
                      <td style={{ padding: 6, textAlign: 'right' }}>{h.storage_mb_used ?? 0}</td>
                      <td style={{ padding: 6, textAlign: 'right' }}>{h.calls_minutes_used ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <Button variant="ghost" onClick={() => setSelected(null)}>Закрыть</Button>
            </div>
          </div>
        </div>
      )}
    </Page>
  )
}
