/**
 * ========================================
 * БЛОК: DirectorServices — таблица услуг
 * ========================================
 * Колонки: услуга, выручка, кол-во, средняя цена, маржа.
 * Мобильная версия — карточки.
 * ========================================
 */
import { useEffect, useState, useMemo } from 'react'
import api from '../../api'
import { Card, EmptyState, Skeleton } from '../../design'
import { useDirectorPeriod } from '../DirectorLayout'
import { fmtRUB, fmtInt, fmtPct } from './_DirectorCharts'

const COLS = [
  { key: 'name',         label: 'Услуга',    align: 'left'  },
  { key: 'revenue',      label: 'Выручка',   align: 'right' },
  { key: 'count',        label: 'Кол-во',    align: 'right' },
  { key: 'avg_price',    label: 'Ср. цена',  align: 'right', hideMobile: true },
  { key: 'margin_pct',   label: 'Маржа',     align: 'right', hideMobile: true },
]

export default function DirectorServices() {
  const { from, to } = useDirectorPeriod()
  const [services, setServices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sortKey, setSortKey] = useState('revenue')
  const [sortDir, setSortDir] = useState('desc')
  const [search, setSearch] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true); setError('')
    api.get('/director/pnl/by-service', { params: { from, to } })
      .then(r => {
        if (!alive) return
        const arr = r.data?.services || r.data?.items || []
        setServices(Array.isArray(arr) ? arr : [])
      })
      .catch(() => { if (alive) setError('Бэкенд по услугам недоступен') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [from, to])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    let arr = !s ? [...services] : services.filter(x => String(x.name || '').toLowerCase().includes(s))
    arr.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey]
      if (typeof av === 'string') {
        return sortDir === 'asc' ? String(av).localeCompare(bv || '', 'ru') : String(bv || '').localeCompare(av || '', 'ru')
      }
      const an = Number(av || 0), bn = Number(bv || 0)
      return sortDir === 'asc' ? an - bn : bn - an
    })
    return arr
  }, [services, search, sortKey, sortDir])

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  if (loading) return <Card padded><Skeleton height={300} /></Card>
  if (error && !services.length) return <EmptyState icon="cloud_off" title="Бэкенд по услугам пока не готов" />

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <Card padded>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--fg)' }}>Услуги сети</div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>{fmtInt(services.length)} услуг</div>
          </div>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск услуги..."
            style={{
              padding: '10px 14px', borderRadius: 10,
              background: 'var(--bg-1)', border: '1px solid var(--border)',
              color: 'var(--fg)', fontSize: 13,
              minWidth: 200, minHeight: 40, width: '100%', maxWidth: 320,
            }}
          />
        </div>
      </Card>

      {/* Mobile карточки */}
      <div className="sm:hidden flex flex-col gap-2">
        {filtered.map((s, i) => (
          <Card key={`ms-${i}`} padded>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg)' }}>{s.name}</div>
            <div className="grid grid-cols-3 gap-2 mt-3">
              <div>
                <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase' }}>Выручка</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>{fmtRUB(s.revenue || 0)}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase' }}>Кол-во</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg)' }}>{fmtInt(s.count || 0)}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase' }}>Маржа</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--good)' }}>
                  {s.margin_pct != null ? fmtPct(s.margin_pct) : '—'}
                </div>
              </div>
            </div>
          </Card>
        ))}
        {filtered.length === 0 && <Card padded><EmptyState icon="list_alt" title="Нет услуг" /></Card>}
      </div>

      {/* Desktop таблица */}
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
              {filtered.map((s, i) => (
                <tr key={`s-${i}`} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 8px', fontWeight: 600, color: 'var(--fg)' }}>{s.name}</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', color: 'var(--accent)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtRUB(s.revenue || 0)}</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', color: 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>{fmtInt(s.count || 0)}</td>
                  <td className="hidden md:table-cell" style={{ padding: '10px 8px', textAlign: 'right', color: 'var(--fg-2)' }}>{fmtRUB(s.avg_price || 0)}</td>
                  <td className="hidden md:table-cell" style={{ padding: '10px 8px', textAlign: 'right', color: 'var(--good)' }}>
                    {s.margin_pct != null ? fmtPct(s.margin_pct) : '—'}
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
