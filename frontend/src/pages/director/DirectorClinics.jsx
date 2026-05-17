/**
 * ========================================
 * БЛОК: DirectorClinics — сравнение клиник сети
 * ========================================
 * Таблица: название, город, выручка, приёмы, маржа, рейтинг.
 * Сортировка по любому столбцу. На MVP без карты и без детальной страницы клиники.
 * ========================================
 */
import { useEffect, useState, useMemo } from 'react'
import api from '../../api'
import { Card, Button, EmptyState, Skeleton, useToast } from '../../design'
import { useDirectorPeriod } from '../DirectorLayout'
import { fmtRUB, fmtInt, fmtPct } from './_DirectorCharts'

// ─── Универсальный helper: GET blob → save as ────────────────────────────────
async function downloadBlob(url, params, filename, toast) {
  try {
    const res = await api.get(url, { params, responseType: 'blob' })
    const blob = res.data instanceof Blob ? res.data : new Blob([res.data])
    const link = document.createElement('a')
    const objUrl = URL.createObjectURL(blob)
    link.href = objUrl
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    setTimeout(() => URL.revokeObjectURL(objUrl), 1000)
  } catch (e) {
    if (typeof toast === 'function') toast('Не удалось выгрузить отчёт', 'error')
  }
}

const COLS = [
  { key: 'name',         label: 'Клиника',   align: 'left'  },
  { key: 'city',         label: 'Город',     align: 'left',  hideMobile: true },
  { key: 'revenue',      label: 'Выручка',   align: 'right' },
  { key: 'appointments', label: 'Приёмы',    align: 'right' },
  { key: 'margin_pct',   label: 'Маржа',     align: 'right', hideMobile: true },
  { key: 'rating',       label: 'Рейтинг',   align: 'right', hideMobile: true },
]

export default function DirectorClinics() {
  const { from, to } = useDirectorPeriod()
  const { toast } = useToast()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sortKey, setSortKey] = useState('revenue')
  const [sortDir, setSortDir] = useState('desc')

  useEffect(() => {
    let alive = true
    setLoading(true); setError('')
    Promise.allSettled([
      api.get('/director/clinics', { params: { from, to } }),
      api.get('/director/pnl/by-clinic', { params: { from, to } }),
    ]).then(([cR, pR]) => {
      if (!alive) return
      if (cR.status === 'fulfilled') {
        setData(cR.value.data)
      } else if (pR.status === 'fulfilled') {
        // fallback: используем pnl by-clinic если /clinics не реализован
        setData({ clinics: pR.value.data.clinics || [] })
      } else {
        setError('Бэкенд клиник недоступен')
      }
      setLoading(false)
    })
    return () => { alive = false }
  }, [from, to])

  const clinics = data?.clinics || []
  const sorted = useMemo(() => {
    const arr = [...clinics]
    arr.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey]
      if (typeof av === 'string') {
        return sortDir === 'asc' ? String(av).localeCompare(bv || '', 'ru') : String(bv || '').localeCompare(av || '', 'ru')
      }
      const an = Number(av || 0), bn = Number(bv || 0)
      return sortDir === 'asc' ? an - bn : bn - an
    })
    return arr
  }, [clinics, sortKey, sortDir])

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  if (loading) {
    return <Card padded><Skeleton height={300} /></Card>
  }
  if (error && !data) {
    return <EmptyState icon="cloud_off" title="Бэкенд клиник пока не готов" />
  }

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <Card padded>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--fg)' }}>Клиники сети</div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>{fmtInt(clinics.length)} клиник · нажмите на колонку для сортировки</div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="ghost"
              onClick={() => downloadBlob(
                '/director/export/clinics.xlsx',
                { from, to },
                `clinics_${from}_${to}.xlsx`,
                toast,
              )}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>download</span>
              Excel
            </Button>
            <Button
              variant="ghost"
              onClick={() => downloadBlob(
                '/director/export/clinics.pdf',
                { from, to },
                `clinics_${from}_${to}.pdf`,
                toast,
              )}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>picture_as_pdf</span>
              PDF
            </Button>
          </div>
        </div>
      </Card>

      {/* Mobile: карточки */}
      <div className="sm:hidden flex flex-col gap-2">
        {sorted.map((c, i) => (
          <Card key={`m-${i}`} padded>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg)' }}>{c.name || c.slug}</div>
                {c.city && <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>{c.city}</div>}
              </div>
              {c.rating != null && (
                <span className="inline-flex items-center gap-1" style={{ fontSize: 12, color: 'var(--good)', fontWeight: 600 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>star</span>
                  {Number(c.rating).toFixed(1)}
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2 mt-3">
              <div>
                <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase' }}>Выручка</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>{fmtRUB(c.revenue || 0)}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase' }}>Приёмы</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg)' }}>{fmtInt(c.appointments || 0)}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase' }}>Маржа</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--good)' }}>
                  {c.margin_pct != null ? fmtPct(c.margin_pct) : '—'}
                </div>
              </div>
            </div>
          </Card>
        ))}
        {sorted.length === 0 && <Card padded><EmptyState icon="local_hospital" title="Нет клиник" /></Card>}
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
              {sorted.map((c, i) => (
                <tr key={`c-${i}`} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 8px', fontWeight: 600, color: 'var(--fg)' }}>{c.name || c.slug}</td>
                  <td className="hidden md:table-cell" style={{ padding: '10px 8px', color: 'var(--fg-2)' }}>{c.city || '—'}</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', color: 'var(--accent)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtRUB(c.revenue || 0)}</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', color: 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>{fmtInt(c.appointments || 0)}</td>
                  <td className="hidden md:table-cell" style={{ padding: '10px 8px', textAlign: 'right', color: 'var(--good)', fontWeight: 600 }}>
                    {c.margin_pct != null ? fmtPct(c.margin_pct) : '—'}
                  </td>
                  <td className="hidden md:table-cell" style={{ padding: '10px 8px', textAlign: 'right', color: 'var(--fg-2)' }}>
                    {c.rating != null ? Number(c.rating).toFixed(1) + ' ★' : '—'}
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr><td colSpan={COLS.length} style={{ padding: 20, textAlign: 'center', color: 'var(--fg-3)' }}>Нет клиник</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
