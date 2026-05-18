/**
 * RetentionMisSection — возвратность пациентов по врачам (источник: МИС).
 *
 * Точнее обычной retention-секции, потому что для каждой записи МИС
 * проставлен флаг is_first_doctor — первый ли это визит этого пациента
 * к этому врачу. Поля от бэкенда: doctor_id_mis, doctor_name,
 * clinic_id_mis, clinic_name, total, first_visits, repeat_visits,
 * retention_rate, revenue.
 *
 * Без drill-down — это уже есть в DoctorRetentionSection.
 */
import { useEffect, useMemo, useState } from 'react'
import api from '../../api'
import { Card, Chip, EmptyState, KpiCard } from '../../design'

function fmt(n) { return typeof n === 'number' ? n.toLocaleString('ru-RU') : '—' }
function money(n) { return typeof n === 'number' ? n.toLocaleString('ru-RU') + ' ₽' : '—' }
function pct(v) {
  if (!v || isNaN(v)) return '0%'
  return Math.round(v * 100) + '%'
}

function periodPreset(n) {
  const today = new Date()
  const from = new Date(today)
  from.setDate(from.getDate() - n)
  const toISO = d => d.toISOString().slice(0, 10)
  return { date_from: toISO(from), date_to: toISO(today) }
}

export default function RetentionMisSection({ clinicId = '' }) {
  const [period, setPeriod] = useState(() => periodPreset(30))
  const [presetKey, setPresetKey] = useState('30')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true); setError('')
    try {
      const params = { ...period }
      if (clinicId) params.clinic_id = clinicId
      const r = await api.get('/manager/analytics/retention-mis', { params })
      setRows(Array.isArray(r.data) ? r.data : [])
    } catch (e) {
      setError(e?.response?.data?.detail || 'Не удалось загрузить аналитику')
    } finally { setLoading(false) }
  }

  useEffect(() => { load() /* eslint-disable-next-line */ }, [period.date_from, period.date_to, clinicId])

  const summary = useMemo(() => {
    const total = rows.reduce((s, r) => s + (r.total || 0), 0)
    const repeat = rows.reduce((s, r) => s + (r.repeat_visits || 0), 0)
    const first = rows.reduce((s, r) => s + (r.first_visits || 0), 0)
    const revenue = rows.reduce((s, r) => s + (r.revenue || 0), 0)
    return { total, repeat, first, revenue, rate: total ? repeat / total : 0 }
  }, [rows])

  const setPreset = (n, key) => { setPeriod(periodPreset(n)); setPresetKey(key) }

  return (
    <>
      {/* Подзаголовок секции */}
      <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--fg-3)' }}>
        Возвратность из МИС (точнее данных — флаг is_first_doctor)
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <KpiCard label="Всего приёмов" value={fmt(summary.total)} />
        <KpiCard label="Первичных" value={fmt(summary.first)} />
        <KpiCard label="Повторных" value={fmt(summary.repeat)} delta={pct(summary.rate) + ' возвратность'} />
        <KpiCard label="Выручка" value={money(summary.revenue)} />
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
                <th style={th()}>Врач</th>
                <th style={th()}>Клиника</th>
                <th style={{ ...th(), textAlign: 'right' }}>Приёмов</th>
                <th style={{ ...th(), textAlign: 'right' }}>Первично</th>
                <th style={{ ...th(), textAlign: 'right' }}>Повторно</th>
                <th style={{ ...th(), textAlign: 'right' }}>Возвратность</th>
                <th style={{ ...th(), textAlign: 'right' }}>Выручка</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: 'var(--fg-3)' }}>Загрузка…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: 24 }}>
                  <EmptyState icon="hub" title="Нет приёмов за период" text="Возможно, выбран неверный период или данные из МИС ещё не пришли." />
                </td></tr>
              ) : rows.map((r, i) => (
                <tr key={`${r.doctor_id_mis}-${r.clinic_id_mis}-${i}`} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ ...td(), fontWeight: 600 }}>{r.doctor_name || '—'}</td>
                  <td style={td()}>{r.clinic_name || '—'}</td>
                  <td style={{ ...td(), textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt(r.total)}</td>
                  <td style={{ ...td(), textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--fg-2)' }}>{fmt(r.first_visits)}</td>
                  <td style={{ ...td(), textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--good)', fontWeight: 600 }}>{fmt(r.repeat_visits)}</td>
                  <td style={{ ...td(), textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    <Chip
                      variant={r.retention_rate >= 0.4 ? 'good' : r.retention_rate >= 0.2 ? 'warn' : 'neutral'}
                      size="sm"
                    >{pct(r.retention_rate)}</Chip>
                  </td>
                  <td style={{ ...td(), textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{money(r.revenue)}</td>
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
