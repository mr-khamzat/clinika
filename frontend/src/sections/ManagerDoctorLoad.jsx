/**
 * ========================================
 * БЛОК: ManagerDoctorLoad (Глава 4 — Manager productivity)
 * ========================================
 * Heatmap-аналитика загрузки врачей. Для каждого врача — матрица
 * 7 дней × часы с цветовой шкалой:
 *   0     → серый (var(--bg-2))
 *   1-2   → жёлтый
 *   3-4   → оранжевый
 *   5+    → красный
 *
 * Карточка врача:
 *   • avg_load_pct, idle_windows_count, overtime_days
 *   • tooltip на ячейке с пациентами
 *   • Сортировка по умолчанию — по загрузке убыванию
 *
 * Экспорт CSV кнопкой (без html2canvas — нативный Blob download).
 * ========================================
 */
import { useEffect, useMemo, useState } from 'react'
import api from '../api'
import { Card, Button, EmptyState } from '../design'

// Цветовая шкала ячейки
function cellColor(count) {
  if (!count || count === 0) return 'var(--bg-2)'
  if (count <= 2) return 'oklch(0.86 0.16 95)'    // yellow soft
  if (count <= 4) return 'oklch(0.74 0.18 60)'    // orange
  return 'oklch(0.65 0.22 25)'                    // red
}

function cellTextColor(count) {
  if (!count) return 'var(--fg-3)'
  if (count <= 2) return 'oklch(0.30 0.06 95)'
  return 'white'
}

export default function ManagerDoctorLoad() {
  const today = new Date()
  const monthAgo = new Date(today); monthAgo.setDate(today.getDate() - 30)
  const fmt = (d) => d.toISOString().slice(0, 10)
  const [filter, setFilter] = useState({
    clinic_id: '',
    date_from: fmt(monthAgo),
    date_to:   fmt(today),
  })
  const [clinics, setClinics] = useState([])
  const [data, setData] = useState({ doctors: [], hours: [], days: [] })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/manager/clinics-accessible')
      .then(r => setClinics(Array.isArray(r.data) ? r.data : []))
      .catch(() => setClinics([]))
  }, [])

  const load = async () => {
    setLoading(true)
    try {
      const params = { date_from: filter.date_from, date_to: filter.date_to }
      if (filter.clinic_id) params.clinic_id = filter.clinic_id
      const r = await api.get('/manager/analytics/doctor-load', { params })
      setData(r.data || { doctors: [], hours: [], days: [] })
    } catch {
      setData({ doctors: [], hours: [], days: [] })
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [filter.clinic_id, filter.date_from, filter.date_to])

  const exportCsv = () => {
    const rows = []
    rows.push(['Врач', 'Специализация', 'Загрузка %', 'Простой (окна)', 'Дней с переработкой', 'Всего приёмов'])
    data.doctors.forEach(d => {
      rows.push([d.full_name, d.specialty || '', d.avg_load_pct, d.idle_windows_count, d.overtime_days, d.total_appointments])
    })
    const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `doctor-load-${filter.date_from}_${filter.date_to}.csv`
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
  }

  return (
    <div>
      {/* ─── Toolbar ─── */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12,
        padding: 12, background: 'var(--surface)',
        border: '1px solid var(--border)', borderRadius: 'var(--radius)',
      }}>
        {clinics.length > 1 && (
          <select
            value={filter.clinic_id}
            onChange={e => setFilter(f => ({ ...f, clinic_id: e.target.value }))}
            style={selectStyle}
          >
            <option value="">Все клиники</option>
            {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <input type="date" value={filter.date_from}
               onChange={e => setFilter(f => ({ ...f, date_from: e.target.value }))}
               style={selectStyle} />
        <span style={{ color: 'var(--fg-3)', fontSize: 12 }}>—</span>
        <input type="date" value={filter.date_to}
               onChange={e => setFilter(f => ({ ...f, date_to: e.target.value }))}
               style={selectStyle} />
        <div style={{ flex: 1 }} />
        <Button size="sm" variant="secondary" onClick={exportCsv}>Экспорт CSV</Button>
      </div>

      {/* ─── Heatmap карточки ─── */}
      {loading ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--fg-3)' }}>Загрузка…</div>
      ) : data.doctors.length === 0 ? (
        <EmptyState
          title="Нет данных"
          subtitle="Записи за выбранный период не найдены"
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {data.doctors.map(doc => (
            <DoctorHeatmap key={doc.doctor_id} doc={doc} days={data.days} hours={data.hours} />
          ))}
        </div>
      )}
    </div>
  )
}

function DoctorHeatmap({ doc, days, hours }) {
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{doc.full_name}</div>
          <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>{doc.specialty || 'Специализация не указана'}</div>
        </div>
        <Stat label="Загрузка" value={`${doc.avg_load_pct}%`} accent="var(--accent)" />
        <Stat label="Окна простоя" value={doc.idle_windows_count} accent="oklch(0.74 0.13 95)" />
        <Stat label="Переработки" value={doc.overtime_days} accent={doc.overtime_days > 0 ? 'oklch(0.65 0.22 25)' : 'var(--fg-3)'} />
        <Stat label="Приёмов всего" value={doc.total_appointments} />
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 2, fontSize: 11 }}>
          <thead>
            <tr>
              <th style={{ width: 36 }} />
              {hours.map(h => (
                <th key={h} style={{ width: 36, color: 'var(--fg-3)', fontWeight: 500, padding: '4px 0' }}>
                  {h.slice(0, 2)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((d, dowIdx) => (
              <tr key={d}>
                <td style={{ color: 'var(--fg-3)', fontWeight: 600, paddingRight: 6, textAlign: 'right' }}>{d}</td>
                {hours.map((h, hIdx) => {
                  const count = doc.load_matrix?.[dowIdx]?.[hIdx] || 0
                  const tooltip = doc.tooltip_data?.[`${dowIdx}-${hIdx}`]
                  return (
                    <td key={hIdx}>
                      <div
                        title={tooltip ? `${count} приём(ов)\n${tooltip}` : `${count} приём(ов)`}
                        style={{
                          width: 32, height: 24, display: 'grid', placeItems: 'center',
                          borderRadius: 4, fontSize: 10, fontWeight: 700,
                          background: cellColor(count), color: cellTextColor(count),
                          cursor: count > 0 ? 'help' : 'default',
                        }}
                      >
                        {count || ''}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function Stat({ label, value, accent }) {
  return (
    <div style={{
      padding: '6px 10px', background: 'var(--bg-1)',
      border: '1px solid var(--border)', borderRadius: 8,
      minWidth: 80,
    }}>
      <div style={{ fontSize: 10, color: 'var(--fg-3)', fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: accent || 'var(--fg)' }}>{value}</div>
    </div>
  )
}

const selectStyle = {
  height: 32, padding: '0 8px', fontSize: 12,
  background: 'var(--bg-2)', color: 'var(--fg)',
  border: '1px solid var(--border)', borderRadius: 8,
}
