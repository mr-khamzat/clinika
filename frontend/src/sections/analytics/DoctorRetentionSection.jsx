/**
 * DoctorRetentionSection — возвратность пациентов по врачам.
 *
 * Таблица врачей за период: total приёмов, уникальные пациенты,
 * первичные/повторные, retention rate. Drill-down кликом по врачу —
 * модалка со списком пациентов (ФИО + телефон + признак повторно).
 *
 * "Повторно" = пациент уже был у этого врача до начала периода.
 */
import { useEffect, useMemo, useState } from 'react'
import api from '../../api'
import { Card, Chip, EmptyState, KpiCard, Modal, Button } from '../../design'

function fmt(n) { return typeof n === 'number' ? n.toLocaleString('ru-RU') : '—' }
function pct(v) {
  if (!v || isNaN(v)) return '0%'
  return Math.round(v * 100) + '%'
}
function fmtDate(s) {
  if (!s) return '—'
  try { return new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }) }
  catch { return s }
}

function shortPhone(p) {
  if (!p) return '—'
  // Простое форматирование: +7 (900) 000-00-00
  const d = p.replace(/\D/g, '')
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

export default function DoctorRetentionSection({ clinicId = '' }) {
  // По умолчанию — последние 30 дней
  const [period, setPeriod] = useState(() => periodPreset(30))
  const [presetKey, setPresetKey] = useState('30')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // drill-down модалка
  const [drillDoctor, setDrillDoctor] = useState(null)
  const [drillRows, setDrillRows] = useState([])
  const [drillLoading, setDrillLoading] = useState(false)
  const [drillError, setDrillError] = useState('')

  const load = async () => {
    setLoading(true); setError('')
    try {
      const params = { ...period }
      if (clinicId) params.clinic_id = clinicId
      const r = await api.get('/manager/analytics/doctor-retention', { params })
      setRows(Array.isArray(r.data) ? r.data : [])
    } catch (e) {
      setError(e?.response?.data?.detail || 'Не удалось загрузить аналитику')
    } finally { setLoading(false) }
  }

  useEffect(() => { load() /* eslint-disable-next-line */ }, [period.date_from, period.date_to, clinicId])

  const openDrill = async (doc) => {
    setDrillDoctor(doc); setDrillRows([]); setDrillError(''); setDrillLoading(true)
    try {
      const params = { ...period }
      if (clinicId) params.clinic_id = clinicId
      const r = await api.get(`/manager/analytics/doctor-retention/${doc.doctor_id}/patients`, { params })
      setDrillRows(Array.isArray(r.data) ? r.data : [])
    } catch (e) {
      setDrillError(e?.response?.data?.detail || 'Не удалось загрузить пациентов')
    } finally { setDrillLoading(false) }
  }

  const summary = useMemo(() => {
    const total = rows.reduce((s, r) => s + r.total, 0)
    const repeat = rows.reduce((s, r) => s + r.repeat_visits, 0)
    const first = rows.reduce((s, r) => s + r.first_visits, 0)
    const uniq = rows.reduce((s, r) => s + r.unique_patients, 0)
    return { total, repeat, first, uniq, rate: total ? repeat / total : 0 }
  }, [rows])

  const setPreset = (n, key) => { setPeriod(periodPreset(n)); setPresetKey(key) }

  return (
    <>
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
        <KpiCard label="Уникальных пациентов" value={fmt(summary.uniq)} />
        <KpiCard label="Повторных" value={fmt(summary.repeat)} delta={pct(summary.rate) + ' возвратность'} />
        <KpiCard label="Первичных" value={fmt(summary.first)} />
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
                <th style={th()}>Специализация</th>
                <th style={th()}>Клиника</th>
                <th style={{ ...th(), textAlign: 'right' }}>Приёмов</th>
                <th style={{ ...th(), textAlign: 'right' }}>Уникальных</th>
                <th style={{ ...th(), textAlign: 'right' }}>Первично</th>
                <th style={{ ...th(), textAlign: 'right' }}>Повторно</th>
                <th style={{ ...th(), textAlign: 'right' }}>Возвратность</th>
                <th style={th()}></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} style={{ padding: 24, textAlign: 'center', color: 'var(--fg-3)' }}>Загрузка…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} style={{ padding: 24 }}>
                  <EmptyState icon="hub" title="Нет приёмов за период" text="Возможно, выбран неверный период или у клиники ещё нет записей." />
                </td></tr>
              ) : rows.map(r => (
                <tr key={r.doctor_id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={td()}>
                    <button onClick={() => openDrill(r)} style={{
                      background: 'transparent', border: 0, padding: 0, cursor: 'pointer',
                      fontWeight: 600, color: 'var(--accent)', textAlign: 'left',
                    }} title="Подробно по пациентам">
                      {r.doctor_name}
                    </button>
                  </td>
                  <td style={td()}>{r.specialty || '—'}</td>
                  <td style={td()}>{r.clinic_name || '—'}</td>
                  <td style={{ ...td(), textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt(r.total)}</td>
                  <td style={{ ...td(), textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(r.unique_patients)}</td>
                  <td style={{ ...td(), textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--fg-2)' }}>{fmt(r.first_visits)}</td>
                  <td style={{ ...td(), textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--good)', fontWeight: 600 }}>{fmt(r.repeat_visits)}</td>
                  <td style={{ ...td(), textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    <Chip
                      variant={r.retention_rate >= 0.4 ? 'good' : r.retention_rate >= 0.2 ? 'warn' : 'neutral'}
                      size="sm"
                    >{pct(r.retention_rate)}</Chip>
                  </td>
                  <td style={{ ...td(), textAlign: 'right' }}>
                    <Button size="xs" variant="secondary" onClick={() => openDrill(r)}>
                      Пациенты
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Drill-down modal */}
      {drillDoctor && (
        <Modal
          open={!!drillDoctor}
          onClose={() => setDrillDoctor(null)}
          size="lg"
          title={`Пациенты · ${drillDoctor.doctor_name}`}
          actions={<Button variant="secondary" size="md" onClick={() => setDrillDoctor(null)}>Закрыть</Button>}
        >
          <div style={{ marginBottom: 10, fontSize: 12, color: 'var(--fg-3)' }}>
            Период: {fmtDate(period.date_from)} — {fmtDate(period.date_to)} ·
            Всего приёмов: <b>{drillDoctor.total}</b> ·
            Уникальных: <b>{drillDoctor.unique_patients}</b> ·
            Повторно: <b style={{ color: 'var(--good)' }}>{drillDoctor.repeat_visits} ({pct(drillDoctor.retention_rate)})</b>
          </div>

          {drillError && (
            <div style={{
              background: 'var(--bad-soft)', border: '1px solid var(--bad-soft)',
              color: 'var(--bad)', padding: 10, borderRadius: 8, marginBottom: 10, fontSize: 13,
            }}>{drillError}</div>
          )}

          {drillLoading ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-3)' }}>Загрузка…</div>
          ) : drillRows.length === 0 ? (
            <EmptyState icon="person_off" title="Нет данных" text="Не найдено пациентов в этом периоде." />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-1)' }}>
                    <th style={th()}>ФИО</th>
                    <th style={th()}>Телефон</th>
                    <th style={{ ...th(), textAlign: 'right' }}>Визитов в периоде</th>
                    <th style={th()}>Последний визит</th>
                    <th style={th()}>Первый визит к врачу</th>
                    <th style={th()}>Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {drillRows.map(p => (
                    <tr key={p.patient_phone} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={td()}>{p.patient_name || '—'}</td>
                      <td style={td()}>
                        <a href={`tel:${p.patient_phone}`} style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                          {shortPhone(p.patient_phone)}
                        </a>
                      </td>
                      <td style={{ ...td(), textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{p.visits_in_period}</td>
                      <td style={td()}>{fmtDate(p.last_visit_in_period)}</td>
                      <td style={td()}>{fmtDate(p.first_visit_overall)}</td>
                      <td style={td()}>
                        <Chip variant={p.is_repeat ? 'good' : 'neutral'} size="sm">
                          {p.is_repeat ? 'Повторно' : 'Первично'}
                        </Chip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}
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
