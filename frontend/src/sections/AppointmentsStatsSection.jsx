/**
 * AppointmentsStatsSection — дашборд статистики записей для франшизы и супервизора.
 * Показывает: KPI total/today/byStatus + таблицу врачей с разбивкой по статусам.
 *
 * Backend: GET /appointments/stats?days=N
 *
 * Миграция (#29): дизайн-система — Card, KpiRow, KpiCard, Tabs, Chip, EmptyState.
 */
import { useEffect, useState } from 'react'
import api from '../api'
import { Card, KpiRow, KpiCard, Tabs, Chip, EmptyState } from '../design'

const STATUS_LABEL = {
  pending: 'Ожидает',
  confirmed: 'Подтв.',
  cancelled: 'Отмена',
  completed: 'Заверш.',
  no_show: 'Не пришёл',
}
// Цвета для стек-бара (визуальные, поэтому остаются inline)
const STATUS_COLOR = {
  pending: '#f59e0b',
  confirmed: '#10b981',
  cancelled: '#ef4444',
  completed: '#6b7280',
  no_show: '#eab308',
}

// ===== БЛОК: Период (табы 7/30/90/365 дней) =====
const PERIOD_ITEMS = [
  { id: '7',   label: '7д'  },
  { id: '30',  label: '30д' },
  { id: '90',  label: '90д' },
  { id: '365', label: 'Год' },
]

export default function AppointmentsStatsSection({ token }) {
  const [days, setDays]     = useState(30)
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.get('/appointments/stats', { params: { days } })
      .then(r => setData(r.data))
      .catch(() => setData({ total: 0, today: 0, by_status: {}, doctors: [] }))
      .finally(() => setLoading(false))
  }, [days])

  if (loading) return <div className="p-6 text-center" style={{ color: 'var(--fg-3)' }}>Загрузка…</div>
  if (!data) return null

  return (
    <div className="px-4 pb-24 max-w-5xl mx-auto">
      {/* ===== БЛОК: Заголовок и переключатель периода ===== */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-black mb-1">Записи к врачам</h2>
          <p className="text-sm" style={{ color: 'var(--fg-3)' }}>Статистика онлайн-записи за выбранный период.</p>
        </div>
        <Tabs
          items={PERIOD_ITEMS}
          value={String(days)}
          onChange={(id) => setDays(parseInt(id, 10))}
        />
      </div>

      {/* ===== БЛОК: KPI ===== */}
      <KpiRow cols={4} className="mb-5">
        <KpiCard label="Всего"          value={data.total} />
        <KpiCard label="Сегодня"        value={data.today} />
        <KpiCard label="Подтверждённых" value={data.by_status?.confirmed || 0} />
        <KpiCard label="Отменённых"     value={data.by_status?.cancelled || 0} trend="down" />
      </KpiRow>

      {/* ===== БЛОК: Распределение по статусам (стек-бар) ===== */}
      {data.total > 0 && (
        <Card className="mb-5">
          <Card.Header>
            <Card.Title>Распределение по статусам</Card.Title>
          </Card.Header>
          {/* Сам стек-бар оставлен с inline-цветами (визуальная диаграмма) */}
          <div className="flex h-8 rounded-lg overflow-hidden" style={{ background: 'var(--bg-2)' }}>
            {Object.entries(data.by_status).map(([st, cnt]) => {
              const pct = (cnt / data.total) * 100
              return (
                <div key={st} title={`${STATUS_LABEL[st] || st}: ${cnt}`}
                  className="h-full flex items-center justify-center text-xs font-bold text-white"
                  style={{ width: `${pct}%`, background: STATUS_COLOR[st] || '#9ca3af' }}>
                  {pct >= 7 ? `${Math.round(pct)}%` : ''}
                </div>
              )
            })}
          </div>
          {/* Легенда — Chip-ы со статусами */}
          <div className="flex flex-wrap gap-2 mt-3">
            {Object.entries(data.by_status).map(([st, cnt]) => (
              <Chip key={st} variant={chipVariant(st)} dot>
                {STATUS_LABEL[st] || st}: <b className="ml-1">{cnt}</b>
              </Chip>
            ))}
          </div>
        </Card>
      )}

      {/* ===== БЛОК: Таблица по врачам ===== */}
      <Card padded={false}>
        <div className="px-5 pt-4 pb-3">
          <Card.Title>По врачам</Card.Title>
        </div>
        {data.doctors?.length === 0 ? (
          <EmptyState
            icon="📊"
            title="Нет данных за период"
            message="Когда появятся записи — здесь будет разбивка по врачам."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead style={{ background: 'var(--bg-2)', color: 'var(--fg-3)' }}>
                <tr>
                  <th className="text-left p-3 font-semibold text-xs">Врач</th>
                  <th className="text-right p-3 font-semibold text-xs">Всего</th>
                  <th className="text-right p-3 font-semibold text-xs hidden sm:table-cell">Подтв.</th>
                  <th className="text-right p-3 font-semibold text-xs hidden sm:table-cell">Заверш.</th>
                  <th className="text-right p-3 font-semibold text-xs hidden md:table-cell">Отмен.</th>
                  <th className="text-right p-3 font-semibold text-xs hidden md:table-cell">Не пришёл</th>
                </tr>
              </thead>
              <tbody>
                {data.doctors.map(d => (
                  <tr key={d.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="p-3 font-semibold">{d.name}</td>
                    <td className="p-3 text-right font-bold tabular-nums">{d.total}</td>
                    <td className="p-3 text-right tabular-nums hidden sm:table-cell" style={{ color: 'var(--good)' }}>{d.by_status?.confirmed || '—'}</td>
                    <td className="p-3 text-right tabular-nums hidden sm:table-cell" style={{ color: 'var(--fg-3)' }}>{d.by_status?.completed || '—'}</td>
                    <td className="p-3 text-right tabular-nums hidden md:table-cell" style={{ color: 'var(--bad)' }}>{d.by_status?.cancelled || '—'}</td>
                    <td className="p-3 text-right tabular-nums hidden md:table-cell" style={{ color: 'var(--warn)' }}>{d.by_status?.no_show || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

// ===== Утилита: маппинг статуса на вариант Chip =====
function chipVariant(status) {
  switch (status) {
    case 'confirmed': return 'good'
    case 'cancelled': return 'bad'
    case 'pending':   return 'warn'
    case 'no_show':   return 'warn'
    case 'completed': return 'default'
    default:          return 'default'
  }
}
