/**
 * ========================================
 * БЛОК: DirectorDoctors — таблица врачей сети
 * ========================================
 * Колонки: ФИО, клиника, выработка, кол-во приёмов, рейтинг, средний чек.
 * Мобильная версия — карточки.
 * ========================================
 */
import { useEffect, useState, useMemo } from 'react'
import api from '../../api'
import { Card, EmptyState, Skeleton } from '../../design'
import { useDirectorPeriod } from '../DirectorLayout'
import { fmtRUB, fmtInt } from './_DirectorCharts'

const COLS = [
  { key: 'name',         label: 'ФИО',      align: 'left'  },
  { key: 'clinic',       label: 'Клиника',  align: 'left',  hideMobile: true },
  { key: 'revenue',      label: 'Выработка',align: 'right' },
  { key: 'appointments', label: 'Приёмы',   align: 'right' },
  { key: 'avg_check',    label: 'Ср. чек',  align: 'right', hideMobile: true },
  { key: 'rating',       label: 'Рейтинг',  align: 'right', hideMobile: true },
]

export default function DirectorDoctors() {
  const { from, to } = useDirectorPeriod()
  const [doctors, setDoctors] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sortKey, setSortKey] = useState('revenue')
  const [sortDir, setSortDir] = useState('desc')
  const [search, setSearch] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true); setError('')
    api.get('/director/pnl/by-doctor', { params: { from, to } })
      .then(r => {
        if (!alive) return
        const arr = r.data?.doctors || r.data?.items || []
        setDoctors(Array.isArray(arr) ? arr : [])
      })
      .catch(() => { if (alive) setError('Бэкенд по врачам недоступен') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [from, to])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    let arr = !s ? [...doctors] : doctors.filter(d =>
      String(d.name || d.full_name || '').toLowerCase().includes(s) ||
      String(d.clinic || d.clinic_name || '').toLowerCase().includes(s)
    )
    arr.sort((a, b) => {
      const av = a[sortKey] ?? (sortKey === 'name' ? (a.full_name || '') : 0)
      const bv = b[sortKey] ?? (sortKey === 'name' ? (b.full_name || '') : 0)
      if (typeof av === 'string') {
        return sortDir === 'asc' ? String(av).localeCompare(bv || '', 'ru') : String(bv || '').localeCompare(av || '', 'ru')
      }
      const an = Number(av || 0), bn = Number(bv || 0)
      return sortDir === 'asc' ? an - bn : bn - an
    })
    return arr
  }, [doctors, search, sortKey, sortDir])

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  if (loading) return <Card padded><Skeleton height={300} /></Card>
  if (error && !doctors.length) return <EmptyState icon="cloud_off" title="Бэкенд по врачам пока не готов" />

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <Card padded>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--fg)' }}>Врачи сети</div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>{fmtInt(doctors.length)} врачей</div>
          </div>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по ФИО или клинике..."
            style={{
              padding: '10px 14px', borderRadius: 10,
              background: 'var(--bg-1)', border: '1px solid var(--border)',
              color: 'var(--fg)', fontSize: 13,
              minWidth: 220, minHeight: 40, width: '100%', maxWidth: 320,
            }}
          />
        </div>
      </Card>

      {/* Mobile: карточки */}
      <div className="sm:hidden flex flex-col gap-2">
        {filtered.map((d, i) => (
          <Card key={`m-${i}`} padded>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg)' }}>{d.name || d.full_name}</div>
                {(d.clinic || d.clinic_name) && (
                  <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>{d.clinic || d.clinic_name}</div>
                )}
              </div>
              {d.rating != null && (
                <span className="inline-flex items-center gap-1" style={{ fontSize: 12, color: 'var(--good)', fontWeight: 600 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>star</span>
                  {Number(d.rating).toFixed(1)}
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2 mt-3">
              <div>
                <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase' }}>Выработка</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>{fmtRUB(d.revenue || d.amount || 0)}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase' }}>Приёмы</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg)' }}>{fmtInt(d.appointments || 0)}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase' }}>Ср. чек</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg)' }}>{fmtRUB(d.avg_check || 0)}</div>
              </div>
            </div>
          </Card>
        ))}
        {filtered.length === 0 && <Card padded><EmptyState icon="medical_services" title="Нет врачей" /></Card>}
      </div>

      {/* Desktop: таблица */}
      <Card padded className="hidden sm:block">
        <div className="overflow-x-auto" style={{ marginLeft: -8, marginRight: -8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {COLS.map(col => (
                  <th
                    key={col.key}
                    onClick={() => toggleSort(col.key)}
                    className={col.hideMobile ? 'hidden md:table-cell' : ''}
                    style={{
                      textAlign: col.align, padding: '8px',
                      fontSize: 11, color: 'var(--fg-3)', fontWeight: 700,
                      textTransform: 'uppercase', letterSpacing: '0.05em',
                      cursor: 'pointer', userSelect: 'none',
                    }}
                  >
                    {col.label}
                    {sortKey === col.key && (
                      <span style={{ marginLeft: 4, color: 'var(--accent)' }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((d, i) => (
                <tr key={`d-${i}`} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 8px', fontWeight: 600, color: 'var(--fg)' }}>{d.name || d.full_name}</td>
                  <td className="hidden md:table-cell" style={{ padding: '10px 8px', color: 'var(--fg-2)' }}>{d.clinic || d.clinic_name || '—'}</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', color: 'var(--accent)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtRUB(d.revenue || d.amount || 0)}</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', color: 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>{fmtInt(d.appointments || 0)}</td>
                  <td className="hidden md:table-cell" style={{ padding: '10px 8px', textAlign: 'right', color: 'var(--fg-2)', fontVariantNumeric: 'tabular-nums' }}>{fmtRUB(d.avg_check || 0)}</td>
                  <td className="hidden md:table-cell" style={{ padding: '10px 8px', textAlign: 'right', color: 'var(--fg-2)' }}>
                    {d.rating != null ? Number(d.rating).toFixed(1) + ' ★' : '—'}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={COLS.length} style={{ padding: 20, textAlign: 'center', color: 'var(--fg-3)' }}>Не найдено</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
