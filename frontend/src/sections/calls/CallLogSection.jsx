/**
 * ========================================
 * БЛОК: CallLogSection — история и аналитика звонков (CallLog)
 * ========================================
 * Tabs: «История» / «Аналитика».
 *
 * История:
 *   - Фильтры: период (7д/30д/90д), тип, статус, поиск по имени
 *   - Таблица: Дата | Кто | Кому | Тип | Длительность | Статус
 *   - Пагинация: «Загрузить ещё»
 *
 * Аналитика:
 *   - KpiRow: всего/аудио/видео/пропущено
 *   - KpiRow: ср. длительность / сумма / peak hour / конверсия
 *   - Топ звонящих / принимающих
 *   - Динамика по дням (SVG bar-chart)
 *   - Распределение по часам (SVG bar)
 *
 * Кнопка «Экспорт CSV» — POST через axios.responseType=blob, имя
 *   «звонки-АРЦ-YYYY-MM-DD.csv».
 *
 * Использует общий axios-инстанс api (с auto-refresh interceptor)
 *   и дизайн-систему (Card, KpiCard, KpiRow, Tabs, Button, Chip,
 *   Avatar, EmptyState, useToast).
 * ========================================
 */
import { useEffect, useMemo, useState } from 'react'
import api from '../../api'
import {
  Card, KpiCard, KpiRow, Tabs, Button, Chip, Avatar, EmptyState, useToast,
  Skeleton, TableSkeleton,
} from '../../design'

// ─── Хелперы форматирования ───────────────────────────────────────────────
const PERIODS = [
  { id: '7',  label: '7 дней',  days: 7 },
  { id: '30', label: '30 дней', days: 30 },
  { id: '90', label: '90 дней', days: 90 },
]

const TYPE_OPTIONS = [
  { id: '',      label: 'Все типы' },
  { id: 'audio', label: 'Аудио' },
  { id: 'video', label: 'Видео' },
]

const STATUS_OPTIONS = [
  { id: '',          label: 'Все статусы' },
  { id: 'completed', label: 'Состоялись' },
  { id: 'missed',    label: 'Пропущены' },
  { id: 'declined',  label: 'Отклонены' },
]

const STATUS_LABEL = {
  answered:  { text: 'Состоялся', tone: 'good' },
  missed:    { text: 'Пропущен',  tone: 'bad'  },
  rejected:  { text: 'Отклонён',  tone: 'warn' },
  busy:      { text: 'Занято',    tone: 'warn' },
}

const TYPE_LABEL = {
  audio: { text: 'Аудио', icon: 'call' },
  video: { text: 'Видео', icon: 'videocam' },
}

const ROLE_LABEL = {
  super_admin:     'Владелец платформы',
  franchise_owner: 'Владелец',
  manager:         'Управляющий',
  reg:             'Регистратор',
  doctor:          'Врач',
  nurse:           'Медсестра',
  recruiter:       'Рекрутер',
  partner_doctor:  'Врач-партнёр',
  visiting_doctor: 'Приходящий врач',
}

function fmtDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const day = String(d.getDate()).padStart(2, '0')
  const mon = String(d.getMonth() + 1).padStart(2, '0')
  const yr  = d.getFullYear()
  const hh  = String(d.getHours()).padStart(2, '0')
  const mm  = String(d.getMinutes()).padStart(2, '0')
  return `${day}.${mon}.${yr} ${hh}:${mm}`
}

function fmtDuration(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0))
  if (s < 60) return `${s} с`
  const m = Math.floor(s / 60)
  const r = s % 60
  if (m < 60) return r ? `${m} м ${r} с` : `${m} м`
  const h = Math.floor(m / 60)
  const mm = m % 60
  return mm ? `${h} ч ${mm} м` : `${h} ч`
}

function fmtNum(n) {
  return typeof n === 'number' ? n.toLocaleString('ru-RU') : '—'
}

function periodToISO(periodId) {
  const p = PERIODS.find(x => x.id === periodId) || PERIODS[1]
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - p.days)
  return { from: from.toISOString(), to: to.toISOString(), days: p.days }
}

// ─── Простые SVG-чарты ────────────────────────────────────────────────────
function BarChart({ data, xKey = 'date', yKey = 'count', label = 'Звонки' }) {
  if (!Array.isArray(data) || data.length === 0) {
    return <div className="text-center py-8 text-sm" style={{ color: 'var(--fg-3)' }}>Нет данных</div>
  }
  const W = 560, H = 160
  const PAD = { top: 12, right: 8, bottom: 26, left: 32 }
  const cw = W - PAD.left - PAD.right
  const ch = H - PAD.top - PAD.bottom
  const max = Math.max(1, ...data.map(d => Number(d[yKey] || 0)))
  const bw = cw / data.length
  const labels = data.map((d, i) => ({ i, label: String(d[xKey] || '').slice(-5) }))
    .filter(({ i }) => i % Math.max(1, Math.ceil(data.length / 6)) === 0 || i === data.length - 1)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 200 }}>
      {[0, .25, .5, .75, 1].map(p => {
        const y = PAD.top + ch - p * ch
        const v = Math.round(max * p)
        return (
          <g key={p}>
            <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="var(--line)" strokeWidth="1" />
            <text x={PAD.left - 5} y={y + 4} textAnchor="end" fontSize="9" fill="var(--fg-4)">{v}</text>
          </g>
        )
      })}
      {data.map((d, i) => {
        const v = Number(d[yKey] || 0)
        const h = (v / max) * ch
        const x = PAD.left + i * bw + 1
        const y = PAD.top + ch - h
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={Math.max(2, bw - 2)}
            height={Math.max(0, h)}
            fill="var(--accent)"
            opacity={v ? 0.9 : 0.25}
          >
            <title>{`${d[xKey]}: ${v}`}</title>
          </rect>
        )
      })}
      {labels.map(({ i, label }) => (
        <text
          key={i}
          x={PAD.left + i * bw + bw / 2}
          y={H - 8}
          textAnchor="middle"
          fontSize="9"
          fill="var(--fg-3)"
        >
          {label}
        </text>
      ))}
    </svg>
  )
}

function HoursChart({ peak }) {
  if (!Array.isArray(peak) || peak.length === 0) {
    return <div className="text-center py-8 text-sm" style={{ color: 'var(--fg-3)' }}>Нет данных</div>
  }
  const W = 560, H = 140
  const PAD = { top: 10, right: 8, bottom: 24, left: 32 }
  const cw = W - PAD.left - PAD.right
  const ch = H - PAD.top - PAD.bottom
  const max = Math.max(1, ...peak.map(p => p.count || 0))
  const bw = cw / 24
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 160 }}>
      {[0, .5, 1].map(p => {
        const y = PAD.top + ch - p * ch
        const v = Math.round(max * p)
        return (
          <g key={p}>
            <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="var(--line)" strokeWidth="1" />
            <text x={PAD.left - 5} y={y + 4} textAnchor="end" fontSize="9" fill="var(--fg-4)">{v}</text>
          </g>
        )
      })}
      {peak.map((p, i) => {
        const v = p.count || 0
        const h = (v / max) * ch
        const x = PAD.left + i * bw + 1
        const y = PAD.top + ch - h
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={Math.max(2, bw - 2)}
            height={Math.max(0, h)}
            fill="var(--accent-2)"
            opacity={v ? 0.9 : 0.2}
          >
            <title>{`${String(i).padStart(2, '0')}:00 — ${v}`}</title>
          </rect>
        )
      })}
      {[0, 6, 12, 18, 23].map(h => (
        <text
          key={h}
          x={PAD.left + h * bw + bw / 2}
          y={H - 6}
          textAnchor="middle"
          fontSize="9"
          fill="var(--fg-3)"
        >
          {String(h).padStart(2, '0')}
        </text>
      ))}
    </svg>
  )
}

// ─── Главный компонент ─────────────────────────────────────────────────────
export default function CallLogSection({ clinicId, brandShort = 'Клиника' }) {
  const { toast } = useToast()
  const [tab, setTab]             = useState('history')
  const [period, setPeriod]       = useState('30')
  const [type, setType]           = useState('')
  const [status, setStatus]       = useState('')
  const [search, setSearch]       = useState('')

  // История
  const [items, setItems]         = useState([])
  const [total, setTotal]         = useState(0)
  const [offset, setOffset]       = useState(0)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const limit = 50

  // Аналитика
  const [stats, setStats]         = useState(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [exporting, setExporting] = useState(false)

  // Перезагружаем историю при смене фильтров (offset = 0 → новый список)
  useEffect(() => {
    if (tab !== 'history') return
    const { from, to } = periodToISO(period)
    setLoading(true)
    setError('')
    const params = { from, to, limit, offset: 0 }
    if (type)     params.type     = type
    if (status)   params.status   = status
    if (clinicId) params.clinic_id = clinicId
    if (search)   params.search   = search
    api.get('/calls/log', { params })
      .then(r => {
        const data = r.data || {}
        setItems(Array.isArray(data.items) ? data.items : [])
        setTotal(Number(data.total || 0))
        setOffset(Array.isArray(data.items) ? data.items.length : 0)
      })
      .catch((e) => {
        const msg = e?.response?.data?.detail || 'Ошибка загрузки истории'
        setError(typeof msg === 'string' ? msg : 'Ошибка загрузки истории')
      })
      .finally(() => setLoading(false))
  }, [tab, period, type, status, search, clinicId])

  const loadMore = () => {
    if (loading) return
    if (items.length >= total) return
    const { from, to } = periodToISO(period)
    setLoading(true)
    const params = { from, to, limit, offset }
    if (type)     params.type     = type
    if (status)   params.status   = status
    if (clinicId) params.clinic_id = clinicId
    if (search)   params.search   = search
    api.get('/calls/log', { params })
      .then(r => {
        const more = Array.isArray(r.data?.items) ? r.data.items : []
        setItems(prev => [...prev, ...more])
        setOffset(prev => prev + more.length)
      })
      .catch(() => toast('Не удалось дозагрузить', 'error'))
      .finally(() => setLoading(false))
  }

  // Загрузка статистики при переключении на «Аналитика»
  useEffect(() => {
    if (tab !== 'stats') return
    const p = PERIODS.find(x => x.id === period) || PERIODS[1]
    const { from, to } = periodToISO(period)
    setStatsLoading(true)
    const params = { from, to, period_days: p.days }
    if (clinicId) params.clinic_id = clinicId
    api.get('/calls/stats', { params })
      .then(r => setStats(r.data || null))
      .catch(() => {
        setStats(null)
        toast('Не удалось загрузить аналитику', 'error')
      })
      .finally(() => setStatsLoading(false))
  }, [tab, period, clinicId])

  // Экспорт CSV
  const onExport = async () => {
    if (exporting) return
    setExporting(true)
    try {
      const { from, to } = periodToISO(period)
      const params = { from, to }
      if (type)     params.type     = type
      if (status)   params.status   = status
      if (clinicId) params.clinic_id = clinicId
      const r = await api.get('/calls/log/export.csv', { params, responseType: 'blob' })
      const today = new Date()
      const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
      const filename = `звонки-${brandShort}-${stamp}.csv`
      const blob = new Blob([r.data], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast('CSV сохранён', 'success')
    } catch (e) {
      toast('Не удалось выгрузить CSV', 'error')
    } finally {
      setExporting(false)
    }
  }

  // ─── KPI: расчёты для аналитики ──────────────────────────────────────
  const kpi = useMemo(() => {
    if (!stats) return null
    const totalC = Number(stats.total_calls || 0)
    const completed = Number(stats.completed || 0)
    const conv = totalC ? Math.round((completed / totalC) * 100) : 0
    const peakHour = (() => {
      const arr = Array.isArray(stats.peak_hours) ? stats.peak_hours : []
      let best = { hour: 0, count: -1 }
      for (const it of arr) {
        if ((it.count || 0) > best.count) best = it
      }
      if (best.count <= 0) return '—'
      return `${String(best.hour).padStart(2, '0')}:00`
    })()
    return {
      total: totalC,
      audio: stats.audio_calls || 0,
      video: stats.video_calls || 0,
      missed: stats.missed || 0,
      avg: stats.avg_duration_sec || 0,
      sumDur: stats.total_duration_sec || 0,
      peakHour,
      conv,
    }
  }, [stats])

  // ─── Render ─────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* ─── Шапка с табами + период + экспорт ─── */}
      <div className="flex items-center gap-3 flex-wrap">
        <Tabs
          items={[
            { id: 'history', label: 'История' },
            { id: 'stats',   label: 'Аналитика' },
          ]}
          value={tab}
          onChange={setTab}
        />
        <Tabs
          items={PERIODS.map(p => ({ id: p.id, label: p.label }))}
          value={period}
          onChange={setPeriod}
        />
        <div className="flex-1" />
        <Button
          variant="secondary"
          size="sm"
          onClick={onExport}
          disabled={exporting}
          leftIcon={
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>file_download</span>
          }
        >
          {exporting ? 'Экспорт…' : 'Экспорт CSV'}
        </Button>
      </div>

      {/* ─── Tab: История ─── */}
      {tab === 'history' && (
        <>
          {/* Фильтры истории */}
          <Card>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="text-sm rounded-lg px-3 py-1.5"
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  color: 'var(--fg)',
                }}
              >
                {TYPE_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="text-sm rounded-lg px-3 py-1.5"
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  color: 'var(--fg)',
                }}
              >
                {STATUS_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
              <input
                type="text"
                placeholder="Поиск по имени собеседника"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="text-sm rounded-lg px-3 py-1.5 flex-1 min-w-[200px]"
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  color: 'var(--fg)',
                }}
              />
              <span className="text-xs" style={{ color: 'var(--fg-3)' }}>
                Найдено: <b style={{ color: 'var(--fg)' }}>{fmtNum(total)}</b>
              </span>
            </div>
          </Card>

          {/* Таблица истории */}
          <Card padded={false}>
            {error && (
              <div className="p-3" style={{ color: 'var(--bad)', fontSize: 13 }}>{error}</div>
            )}
            {loading && items.length === 0 ? (
              // W3: shimmer-плейсхолдер вместо спиннера при первичной загрузке
              <div style={{ padding: 16 }}>
                <TableSkeleton rows={6} cols={6} rowHeight={20} />
              </div>
            ) : items.length === 0 ? (
              <EmptyState
                icon={
                  <span className="material-symbols-outlined" style={{ fontSize: 28 }}>call</span>
                }
                title="Нет звонков за выбранный период"
                message="Попробуйте изменить фильтры или расширить период."
              />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ background: 'var(--bg-1)' }}>
                        <th className="text-left px-4 py-2.5" style={thStyle}>Дата/время</th>
                        <th className="text-left px-3 py-2.5" style={thStyle}>Кто</th>
                        <th className="text-left px-3 py-2.5" style={thStyle}>Кому</th>
                        <th className="text-left px-3 py-2.5" style={thStyle}>Тип</th>
                        <th className="text-right px-3 py-2.5" style={thStyle}>Длительность</th>
                        <th className="text-left px-4 py-2.5" style={thStyle}>Статус</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it, i, arr) => {
                        const t = TYPE_LABEL[it.type] || { text: it.type, icon: 'call' }
                        const s = STATUS_LABEL[it.status] || { text: it.status, tone: 'default' }
                        return (
                          <tr key={it.id} style={{ borderBottom: i < arr.length - 1 ? '1px solid var(--line)' : 'none' }}>
                            <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: 'var(--fg-2)', fontVariantNumeric: 'tabular-nums' }}>
                              {fmtDateTime(it.started_at)}
                            </td>
                            <td className="px-3 py-3 text-xs">
                              <div className="flex items-center gap-2 min-w-0">
                                <Avatar size="sm" name={it.caller?.full_name || '—'} />
                                <div className="min-w-0">
                                  <div className="font-medium truncate" style={{ color: 'var(--fg)' }}>
                                    {it.caller?.full_name || '—'}
                                  </div>
                                  <div className="text-[10.5px] truncate" style={{ color: 'var(--fg-3)' }}>
                                    {ROLE_LABEL[it.caller?.role] || it.caller?.role || ''}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-3 text-xs">
                              <div className="flex items-center gap-2 min-w-0">
                                <Avatar size="sm" name={it.callee?.full_name || '—'} />
                                <div className="min-w-0">
                                  <div className="font-medium truncate" style={{ color: 'var(--fg)' }}>
                                    {it.callee?.full_name || '—'}
                                  </div>
                                  <div className="text-[10.5px] truncate" style={{ color: 'var(--fg-3)' }}>
                                    {ROLE_LABEL[it.callee?.role] || it.callee?.role || ''}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-3 text-xs">
                              <div className="inline-flex items-center gap-1.5" style={{ color: 'var(--fg-2)' }}>
                                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{t.icon}</span>
                                <span>{t.text}</span>
                              </div>
                            </td>
                            <td className="px-3 py-3 text-xs text-right" style={{ color: 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>
                              {it.status === 'answered' ? fmtDuration(it.duration_sec) : '—'}
                            </td>
                            <td className="px-4 py-3 text-xs">
                              <Chip variant={s.tone}>{s.text}</Chip>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {items.length < total && (
                  <div className="flex items-center justify-center py-3">
                    <Button variant="ghost" size="sm" onClick={loadMore} disabled={loading}>
                      {loading ? 'Загрузка…' : `Загрузить ещё (${total - items.length})`}
                    </Button>
                  </div>
                )}
              </>
            )}
          </Card>
        </>
      )}

      {/* ─── Tab: Аналитика ─── */}
      {tab === 'stats' && (
        <>
          {statsLoading && !stats ? (
            <Card>
              <div className="flex items-center justify-center py-16">
                <div
                  className="w-8 h-8 rounded-full animate-spin"
                  style={{ border: '3px solid var(--accent-soft)', borderTopColor: 'var(--accent)' }}
                />
              </div>
            </Card>
          ) : !stats || (stats.total_calls || 0) === 0 ? (
            <Card>
              <EmptyState
                icon={
                  <span className="material-symbols-outlined" style={{ fontSize: 28 }}>analytics</span>
                }
                title="Нет данных за выбранный период"
                message="Когда сотрудники начнут звонить — здесь появится аналитика."
              />
            </Card>
          ) : (
            <>
              {/* KpiRow #1 */}
              <KpiRow cols={4}>
                <KpiCard label="Всего звонков" value={fmtNum(kpi?.total || 0)} />
                <KpiCard label="Аудио"         value={fmtNum(kpi?.audio || 0)} />
                <KpiCard label="Видео"         value={fmtNum(kpi?.video || 0)} />
                <KpiCard label="Пропущено"     value={fmtNum(kpi?.missed || 0)} trend="down" />
              </KpiRow>

              {/* KpiRow #2 */}
              <KpiRow cols={4}>
                <KpiCard label="Ср. длительность" value={fmtDuration(kpi?.avg || 0)} />
                <KpiCard label="Сумма времени"    value={fmtDuration(kpi?.sumDur || 0)} />
                <KpiCard label="Пиковый час"      value={kpi?.peakHour || '—'} />
                <KpiCard label="Конверсия"        value={`${kpi?.conv || 0}%`} trend={kpi?.conv >= 50 ? 'up' : 'down'} />
              </KpiRow>

              {/* Топ звонящих + принимающих */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card padded={false}>
                  <div className="p-4 pb-3" style={{ borderBottom: '1px solid var(--line)' }}>
                    <Card.Title>Топ звонящих</Card.Title>
                    <Card.Subtitle>Кто звонит больше всех</Card.Subtitle>
                  </div>
                  <TopList items={stats.top_callers || []} />
                </Card>
                <Card padded={false}>
                  <div className="p-4 pb-3" style={{ borderBottom: '1px solid var(--line)' }}>
                    <Card.Title>Топ принимающих</Card.Title>
                    <Card.Subtitle>Кому чаще всего звонят</Card.Subtitle>
                  </div>
                  <TopList items={stats.top_callees || []} />
                </Card>
              </div>

              {/* Динамика по дням */}
              <Card>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <Card.Title>Динамика по дням</Card.Title>
                    <Card.Subtitle>Количество звонков</Card.Subtitle>
                  </div>
                </div>
                <BarChart data={stats.daily_trend || []} xKey="date" yKey="count" />
              </Card>

              {/* Распределение по часам */}
              <Card>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <Card.Title>Распределение по часам</Card.Title>
                    <Card.Subtitle>Активность в течение суток (UTC)</Card.Subtitle>
                  </div>
                </div>
                <HoursChart peak={stats.peak_hours || []} />
              </Card>
            </>
          )}
        </>
      )}
    </div>
  )
}

const thStyle = {
  fontSize: 10.5,
  fontWeight: 700,
  color: 'var(--fg-3)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  borderBottom: '1px solid var(--border)',
}

function TopList({ items }) {
  if (!items || items.length === 0) {
    return (
      <EmptyState title="Нет данных" message="Пока никто не звонил в выбранном периоде." />
    )
  }
  return (
    <div>
      {items.map((it, i, arr) => (
        <div
          key={it.user_id}
          className="px-4 py-3 flex items-center gap-3"
          style={{ borderBottom: i < arr.length - 1 ? '1px solid var(--line)' : 'none' }}
        >
          <Avatar size="sm" name={it.full_name || '—'} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold truncate" style={{ color: 'var(--fg)' }}>
              {it.full_name || '—'}
            </div>
            <div className="text-[10.5px] truncate" style={{ color: 'var(--fg-3)' }}>
              {ROLE_LABEL[it.role] || it.role || ''}
            </div>
          </div>
          <div className="text-right">
            <div className="text-base font-bold" style={{ color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>
              {fmtNum(it.count || 0)}
            </div>
            <div className="text-[10.5px]" style={{ color: 'var(--fg-3)' }}>
              {fmtDuration(it.total_duration_sec || 0)}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
