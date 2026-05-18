/**
 * NoShowSection — пациенты с отменёнными/несостоявшимися визитами.
 *
 * Поля от бэкенда: patient_phone, patient_name, noshow_count,
 * lost_revenue, last_noshow_date. Кандидаты на предоплату/skip-fee.
 */
import { useEffect, useMemo, useState } from 'react'
import api from '../../api'
import { Card, Chip, EmptyState, KpiCard } from '../../design'

function fmt(n) { return typeof n === 'number' ? n.toLocaleString('ru-RU') : '—' }
function money(n) { return typeof n === 'number' ? n.toLocaleString('ru-RU') + ' ₽' : '—' }

function fmtDate(s) {
  if (!s) return '—'
  try { return new Date(s).toLocaleDateString('ru-RU') }
  catch { return s }
}

function shortPhone(p) {
  if (!p) return '—'
  const d = String(p).replace(/\D/g, '')
  if (d.length === 11 && (d[0] === '7' || d[0] === '8')) {
    return `+7 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)}`
  }
  return p
}

function periodPreset(n) {
  const today = new Date()
  const from = new Date(today)
  from.setDate(from.getDate() - n)
  const toISO = d => d.toISOString().slice(0, 10)
  return { date_from: toISO(from), date_to: toISO(today) }
}

export default function NoShowSection({ clinicId = '' }) {
  const [period, setPeriod] = useState(() => periodPreset(90))
  const [presetKey, setPresetKey] = useState('90')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true); setError('')
    try {
      const params = { ...period }
      if (clinicId) params.clinic_id = clinicId
      const r = await api.get('/manager/analytics/noshow', { params })
      setRows(Array.isArray(r.data) ? r.data : [])
    } catch (e) {
      setError(e?.response?.data?.detail || 'Не удалось загрузить аналитику')
    } finally { setLoading(false) }
  }

  useEffect(() => { load() /* eslint-disable-next-line */ }, [period.date_from, period.date_to, clinicId])

  const summary = useMemo(() => {
    const totalNoshows = rows.reduce((s, r) => s + (r.noshow_count || 0), 0)
    const uniquePatients = rows.length
    const lostRevenue = rows.reduce((s, r) => s + (r.lost_revenue || 0), 0)
    return { totalNoshows, uniquePatients, lostRevenue }
  }, [rows])

  const setPreset = (n, key) => { setPeriod(periodPreset(n)); setPresetKey(key) }

  return (
    <>
      {/* Подзаголовок секции */}
      <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--fg-3)' }}>
        Пациенты с отменёнными/несостоявшимися визитами. Кандидаты на предоплату/skip-fee.
      </div>

      {/* Фильтры периода */}
      <Card className="mb-4">
        <div className="flex items-center gap-3 flex-wrap" style={{ padding: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Период
          </span>
          <div style={{ display: 'flex', gap: 4, padding: 2, background: 'var(--bg-1)', borderRadius: 8, border: '1px solid var(--border)' }}>
            {[
              { n: 7,  k: '7',  l: '7 дн.' },
              { n: 30, k: '30', l: '30 дн.' },
              { n: 90, k: '90', l: '90 дн.' },
              { n: 365, k: '365', l: 'Год' },
            ].map(b => (
              <button
                key={b.k}
                onClick={() => setPreset(b.n, b.k)}
                style={{
                  padding: '6px 12px', borderRadius: 6, border: 0, cursor: 'pointer',
                  background: presetKey === b.k ? 'var(--surface)' : 'transparent',
                  color: presetKey === b.k ? 'var(--fg)' : 'var(--fg-3)',
                  fontSize: 12, fontWeight: 600,
                }}
              >{b.l}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
            <input
              type="date" value={period.date_from}
              onChange={e => { setPeriod(p => ({ ...p, date_from: e.target.value })); setPresetKey('custom') }}
              style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-1)', color: 'var(--fg)', fontSize: 12 }}
            />
            <span style={{ color: 'var(--fg-3)', fontSize: 12 }}>—</span>
            <input
              type="date" value={period.date_to}
              onChange={e => { setPeriod(p => ({ ...p, date_to: e.target.value })); setPresetKey('custom') }}
              style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-1)', color: 'var(--fg)', fontSize: 12 }}
            />
          </div>
        </div>
      </Card>

      {/* KPI summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <KpiCard label="Всего пропусков" value={fmt(summary.totalNoshows)} />
        <KpiCard label="Уникальных no-show пациентов" value={fmt(summary.uniquePatients)} />
        <KpiCard label="Потерянная выручка" value={money(summary.lostRevenue)} />
      </div>

      {error && (
        <div style={{
          background: 'var(--bad-soft)', border: '1px solid var(--bad-soft)',
          color: 'var(--bad)', padding: 12, borderRadius: 10, marginBottom: 12, fontSize: 13,
        }}>{error}</div>
      )}

      <Card>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-1)' }}>
                <th style={th()}>ФИО пациента</th>
                <th style={th()}>Телефон</th>
                <th style={{ ...th(), textAlign: 'right' }}>Пропусков</th>
                <th style={{ ...th(), textAlign: 'right' }}>Потерянная выручка</th>
                <th style={th()}>Последний пропуск</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: 'var(--fg-3)' }}>Загрузка…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: 24 }}>
                  <EmptyState icon="event_busy" title="Нет пропусков за период" text="За выбранный период не зафиксировано отменённых или несостоявшихся визитов." />
                </td></tr>
              ) : rows.map((r, i) => (
                <tr key={`${r.patient_phone}-${i}`} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ ...td(), fontWeight: 600 }}>{r.patient_name || '—'}</td>
                  <td style={td()}>
                    {r.patient_phone ? (
                      <a href={`tel:${r.patient_phone}`} style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                        {shortPhone(r.patient_phone)}
                      </a>
                    ) : '—'}
                  </td>
                  <td style={{ ...td(), textAlign: 'right' }}>
                    <Chip variant={r.noshow_count > 3 ? 'bad' : 'warn'} size="sm">
                      {fmt(r.noshow_count)}
                    </Chip>
                  </td>
                  <td style={{ ...td(), textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: 'var(--bad)' }}>
                    {money(r.lost_revenue)}
                  </td>
                  <td style={td()}>{fmtDate(r.last_noshow_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}

function th() {
  return {
    padding: '10px 12px',
    fontSize: 10.5,
    fontWeight: 700,
    color: 'var(--fg-3)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    textAlign: 'left',
    whiteSpace: 'nowrap',
  }
}
function td() {
  return {
    padding: '10px 12px',
    color: 'var(--fg)',
  }
}
