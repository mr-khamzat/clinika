/**
 * ========================================
 * БЛОК: ManagerAnalytics (premium редизайн)
 * ========================================
 * Аналитика менеджера — конверсия, дин. графики, топ услуг, сравнение клиник.
 * Бизнес-логика и API не изменены.
 * ========================================
 */
import { useEffect, useState, lazy, Suspense } from 'react'
import { getAnalytics } from '../api'
import { Card, Chip, KpiCard, KpiRow, EmptyState, Tabs, ClinicScopeSelector, Skeleton, TableSkeleton } from '../design'
import useClinicScope from '../lib/useClinicScope'
import ManagerShell from './_ManagerShell'

// Ленивая загрузка LTV-секции (платный модуль ltv_pro)
const LtvAnalyticsSection = lazy(() => import('../sections/ltv/LtvAnalyticsSection'))
// Ленивая загрузка секции «Звонки» — история CallLog + аналитика
const CallLogSection = lazy(() => import('../sections/calls/CallLogSection'))

function fmt(n) { return typeof n === 'number' ? n.toLocaleString('ru-RU') : '—' }

function DailyChart({ data }) {
  if (!data || data.length === 0) {
    return <div className="text-center py-8 text-sm" style={{ color: 'var(--fg-3)' }}>Нет данных</div>
  }
  const W = 500, H = 160, PAD = { top: 12, right: 12, bottom: 28, left: 36 }
  const chartW = W - PAD.left - PAD.right, chartH = H - PAD.top - PAD.bottom
  const maxVal = Math.max(...data.map(d => d.total), 1)
  const step = chartW / (data.length - 1 || 1)
  const toX = (i) => PAD.left + i * step
  const toY = (v) => PAD.top + chartH - (v / maxVal) * chartH
  const polyTotal = data.map((d, i) => `${toX(i)},${toY(d.total)}`).join(' ')
  const polyConf  = data.map((d, i) => `${toX(i)},${toY(d.confirmed)}`).join(' ')
  const grid = [0, .25, .5, .75, 1].map(p => ({ y: toY(Math.round(maxVal * p)), val: Math.round(maxVal * p) }))
  const labels = data.map((d, i) => ({ i, label: d.date.slice(8) })).filter(({ i }) => i % 5 === 0 || i === data.length - 1)
  const areaPath = data.length > 1
    ? `${polyTotal.replace(/,/g, ' ').split(' ').reduce((acc, v, i, arr) => {
        if (i === 0) return `M ${v} ${arr[1]}`
        if (i % 2 === 1) return acc
        return `${acc} L ${v} ${arr[i + 1]}`
      }, '')} L ${toX(data.length - 1)} ${PAD.top + chartH} L ${PAD.left} ${PAD.top + chartH} Z`
    : ''
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 200 }}>
      {grid.map(({ y, val }) => (
        <g key={y}>
          <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="var(--line)" strokeWidth="1" />
          <text x={PAD.left - 6} y={y + 4} textAnchor="end" fontSize="9" fill="var(--fg-4)">{val}</text>
        </g>
      ))}
      {areaPath && <path d={areaPath} fill="var(--accent-soft)" stroke="none" />}
      <polyline points={polyTotal} fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      <polyline points={polyConf}  fill="none" stroke="var(--good)"   strokeWidth="2"   strokeLinejoin="round" strokeLinecap="round" strokeDasharray="4,3" />
      {data.map((d, i) => (
        <g key={i}>
          <circle cx={toX(i)} cy={toY(d.total)}     r="2.5" fill="var(--accent)" />
          <circle cx={toX(i)} cy={toY(d.confirmed)} r="2"   fill="var(--good)" />
        </g>
      ))}
      {labels.map(({ i, label }) => (
        <text key={i} x={toX(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="var(--fg-3)">{label}</text>
      ))}
    </svg>
  )
}

function Bar({ pct, label, value, color = 'var(--accent)' }) {
  const safe = Math.min(Math.max(pct || 0, 0), 100)
  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs mb-1" style={{ fontVariantNumeric: 'tabular-nums' }}>
        <span style={{ color: 'var(--fg-2)' }}>{label}</span>
        <span style={{ color: 'var(--fg)', fontWeight: 700 }}>{value}</span>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: 'var(--bg-2)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${safe}%`, background: `linear-gradient(90deg, ${color}, var(--accent-2))`, borderRadius: 999, transition: 'width 600ms ease' }} />
      </div>
    </div>
  )
}

export default function ManagerAnalytics() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  // Активная вкладка верхнего уровня: 'overview' | 'ltv'
  const [tab, setTab]         = useState('overview')

  // ── Scope: выбор клиники для фильтрации аналитики ───────────────────────
  // У lika clinic_id=Лорсанова → видит только её. Главный manager без
  // clinic_id видит все клиники тенанта.
  const scope = useClinicScope()

  useEffect(() => {
    if (tab !== 'overview') return
    setLoading(true)
    getAnalytics(scope.selectedId || undefined)
      .then(r => setData(r.data))
      .catch(() => setError('Ошибка загрузки аналитики'))
      .finally(() => setLoading(false))
  }, [tab, scope.selectedId])

  const conv      = data?.conversion_rate ?? 0
  const thisMonth = data?.this_month ?? {}
  const lastMonth = data?.last_month ?? {}
  const totalRefs = data?.daily?.reduce((s, d) => s + d.total, 0) ?? 0
  const totalConf = data?.daily?.reduce((s, d) => s + d.confirmed, 0) ?? 0

  return (
    <ManagerShell
      active="analytics"
      title="Аналитика"
      subtitle="Конверсия, динамика, сравнение клиник"
      icon="bar_chart"
    >
      {/* ─── Переключатель верхнего уровня + селектор клиники ─── */}
      <div className="mb-4 flex items-center gap-3 flex-wrap">
        <Tabs
          items={[
            { id: 'overview', label: 'Аналитика' },
            { id: 'ltv',      label: 'LTV' },
            { id: 'calls',    label: 'Звонки' },
          ]}
          value={tab}
          onChange={setTab}
        />
        <div className="flex-1" />
        {/* Селектор клиники для текущего пользователя.
            Если клиника одна — рендерится статичный label; если несколько —
            select с опцией «Все клиники» (для manager без user.clinic_id). */}
        {scope.clinics.length > 0 && (
          <ClinicScopeSelector
            clinics={scope.clinics}
            selectedId={scope.selectedId}
            onChange={scope.setSelectedId}
            allowAll={scope.isMultiClinic}
          />
        )}
      </div>

      {tab === 'ltv' && (
        <Suspense fallback={
          <Card>
            <div className="flex items-center justify-center py-16">
              <div className="w-8 h-8 rounded-full animate-spin" style={{ border: '3px solid var(--accent-soft)', borderTopColor: 'var(--accent)' }} />
            </div>
          </Card>
        }>
          {/* Прокидываем clinic_id из scope (пустая строка = «все клиники»);
              передача любого значения, включая '', включает externallyControlled
              в LtvAnalyticsSection и скрывает её внутренний селектор. */}
          <LtvAnalyticsSection clinicId={scope.selectedId} />
        </Suspense>
      )}

      {tab === 'calls' && (
        <Suspense fallback={
          <Card>
            <div className="flex items-center justify-center py-16">
              <div className="w-8 h-8 rounded-full animate-spin" style={{ border: '3px solid var(--accent-soft)', borderTopColor: 'var(--accent)' }} />
            </div>
          </Card>
        }>
          {/* Прокидываем clinic_id из scope — фильтр звонков по клинике. */}
          <CallLogSection clinicId={scope.selectedId} />
        </Suspense>
      )}

      {tab === 'overview' && error && (
        <div
          className="mb-4 rounded-xl p-3"
          style={{ background: 'var(--bad-soft)', border: '1px solid var(--bad-soft)', color: 'var(--bad)' }}
        >
          <p className="text-sm">{error}</p>
        </div>
      )}

      {tab === 'overview' && (loading ? (
        // W3: shimmer-плейсхолдеры вместо спиннера при загрузке всей секции
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card>
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Skeleton width={140} height={11} />
              <Skeleton width={200} height={48} variant="rect" />
              <Skeleton width="60%" height={12} />
            </div>
          </Card>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12 }}>
            {[0, 1, 2, 3].map(i => (
              <Skeleton key={i} width="100%" height={84} variant="rect" />
            ))}
          </div>
          <Card>
            <div style={{ padding: 16 }}>
              <TableSkeleton rows={5} cols={4} rowHeight={20} />
            </div>
          </Card>
        </div>
      ) : (
        <>
          {/* ─── Hero ─── */}
          <div
            className="mb-4 p-5 text-white"
            style={{
              background: 'linear-gradient(135deg, var(--accent), var(--accent-2))',
              borderRadius: 'var(--radius-lg)',
              boxShadow: '0 14px 40px oklch(0.55 0.16 240 / 0.25)',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.85, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Конверсия за 30 дней
            </div>
            <div className="font-semibold mt-1" style={{ fontSize: 48, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
              {conv}%
            </div>
            <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>
              подтверждено / создано
            </div>
            <div className="flex gap-6 mt-4 pt-4" style={{ borderTop: '1px solid oklch(1 0 0 / 0.15)' }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{fmt(totalRefs)}</div>
                <div style={{ fontSize: 11, opacity: 0.8 }}>направлений</div>
              </div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'oklch(0.92 0.18 150)' }}>{fmt(totalConf)}</div>
                <div style={{ fontSize: 11, opacity: 0.8 }}>подтверждено</div>
              </div>
            </div>
          </div>

          {/* ─── KPI Row ─── */}
          <KpiRow cols={4} className="mb-4">
            <KpiCard label="Месяц текущий" value={fmt(thisMonth.total)} delta={`${fmt(thisMonth.confirmed)} подтв.`} trend="up" />
            <KpiCard label="Месяц прошлый" value={fmt(lastMonth.total)} delta={`${fmt(lastMonth.confirmed)} подтв.`} trend="flat" />
            <KpiCard label="Бонусы (мес.)"  value={`${fmt(thisMonth.bonuses)} Б`} delta={`пред: ${fmt(lastMonth.bonuses)} Б`} trend="up" />
            <KpiCard label="Конверсия"      value={`${conv}%`} delta="за 30 дней" trend={conv >= 50 ? 'up' : 'flat'} />
          </KpiRow>

          {/* ─── График + сравнение месяцев ─── */}
          <div className="grid gap-4 md:grid-cols-3 mb-4">
            <Card className="md:col-span-2">
              <Card.Header>
                <div>
                  <Card.Title>Динамика 30 дней</Card.Title>
                  <Card.Subtitle>Создано · Подтверждено</Card.Subtitle>
                </div>
                <div className="flex gap-3 text-xs" style={{ color: 'var(--fg-3)' }}>
                  <span className="flex items-center gap-1.5">
                    <span style={{ width: 10, height: 10, borderRadius: 999, background: 'var(--accent)' }} />Всего
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span style={{ width: 10, height: 10, borderRadius: 999, background: 'var(--good)' }} />Подтв.
                  </span>
                </div>
              </Card.Header>
              <DailyChart data={data?.daily} />
            </Card>

            <Card>
              <Card.Header>
                <Card.Title>Сравнение месяцев</Card.Title>
              </Card.Header>
              {[
                ['Этот месяц', thisMonth, 'var(--accent)'],
                ['Прошлый',    lastMonth, 'var(--fg-4)'],
              ].map(([label, d, color]) => (
                <div
                  key={label}
                  className="rounded-xl p-3 mb-2"
                  style={{ background: 'var(--bg-1)', border: `1px solid var(--border)` }}
                >
                  <div className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color }}>{label}</div>
                  <div className="space-y-1.5 text-xs" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    <div className="flex justify-between"><span style={{ color: 'var(--fg-3)' }}>Направлений</span><b style={{ color: 'var(--fg)' }}>{fmt(d.total)}</b></div>
                    <div className="flex justify-between"><span style={{ color: 'var(--fg-3)' }}>Подтверждено</span><b style={{ color: 'var(--good)' }}>{fmt(d.confirmed)}</b></div>
                    <div className="flex justify-between"><span style={{ color: 'var(--fg-3)' }}>Бонусы</span><b style={{ color: 'var(--warn)' }}>{fmt(d.bonuses)} Б</b></div>
                  </div>
                </div>
              ))}
            </Card>
          </div>

          {/* ─── Топ услуг ─── */}
          <Card padded={false} className="mb-4">
            <div className="flex items-center justify-between p-4 pb-3" style={{ borderBottom: '1px solid var(--line)' }}>
              <div>
                <Card.Title>Топ услуг</Card.Title>
                <Card.Subtitle>По количеству направлений</Card.Subtitle>
              </div>
              <span
                className="inline-grid place-items-center"
                style={{ width: 32, height: 32, borderRadius: 9, background: 'var(--warn-soft)', color: 'var(--warn)' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}>star</span>
              </span>
            </div>
            {(data?.top_services ?? []).length === 0 ? (
              <EmptyState
                icon={<span className="material-symbols-outlined" style={{ fontSize: 28, fontVariationSettings: "'FILL' 1" }}>star</span>}
                title="Нет данных"
                message="Услуги ещё не выбирались в направлениях."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: 'var(--bg-1)' }}>
                      <th className="text-left px-4 py-2.5" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)' }}>Услуга</th>
                      <th className="text-right px-2 py-2.5" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)' }}>Всего</th>
                      <th className="text-right px-2 py-2.5" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)' }}>Подтв.</th>
                      <th className="text-right px-4 py-2.5" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)' }}>Бонусы</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.top_services ?? []).map((s, i, arr) => (
                      <tr key={s.service_id} style={{ borderBottom: i < arr.length - 1 ? '1px solid var(--line)' : 'none' }}>
                        <td className="px-4 py-3 text-xs font-semibold" style={{ color: 'var(--fg)' }}>{s.name}</td>
                        <td className="px-2 py-3 text-right text-xs" style={{ color: 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>{s.total}</td>
                        <td className="px-2 py-3 text-right text-xs font-semibold" style={{ color: 'var(--good)', fontVariantNumeric: 'tabular-nums' }}>{s.confirmed}</td>
                        <td className="px-4 py-3 text-right text-xs font-semibold" style={{ color: 'var(--warn)', fontVariantNumeric: 'tabular-nums' }}>{fmt(s.bonus_total)} Б</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* ─── Конверсия по сотрудникам ─── */}
          <Card padded={false} className="mb-4">
            <div className="flex items-center justify-between p-4 pb-3" style={{ borderBottom: '1px solid var(--line)' }}>
              <div>
                <Card.Title>Конверсия по сотрудникам</Card.Title>
                <Card.Subtitle>Подтверждено / создано</Card.Subtitle>
              </div>
              <span
                className="inline-grid place-items-center"
                style={{ width: 32, height: 32, borderRadius: 9, background: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}>person_check</span>
              </span>
            </div>
            {(data?.admin_conversion ?? []).length === 0 ? (
              <EmptyState title="Нет данных" message="Сотрудники ещё не оформляли направления." />
            ) : (
              <div>
                {(data?.admin_conversion ?? []).map((a, i, arr) => (
                  <div
                    key={a.admin_id}
                    className="px-4 py-3"
                    style={{ borderBottom: i < arr.length - 1 ? '1px solid var(--line)' : 'none' }}
                  >
                    <div className="flex justify-between items-center mb-2 gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate" style={{ color: 'var(--fg)' }}>{a.full_name}</div>
                        <div className="text-xs truncate" style={{ color: 'var(--fg-3)' }}>{a.clinic_name}</div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-base font-bold" style={{ color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>{a.conversion_pct}%</div>
                        <div className="text-xs" style={{ color: 'var(--fg-3)' }}>{a.confirmed}/{a.total}</div>
                      </div>
                    </div>
                    <div style={{ height: 5, borderRadius: 999, background: 'var(--bg-2)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.min(a.conversion_pct, 100)}%`, background: 'linear-gradient(90deg, var(--accent), var(--accent-2))', borderRadius: 999 }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* ─── Сравнение клиник ─── */}
          <Card padded={false}>
            <div className="flex items-center justify-between p-4 pb-3" style={{ borderBottom: '1px solid var(--line)' }}>
              <div>
                <Card.Title>Сравнение клиник</Card.Title>
                <Card.Subtitle>Поток и конверсия</Card.Subtitle>
              </div>
              <span
                className="inline-grid place-items-center"
                style={{ width: 32, height: 32, borderRadius: 9, background: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}>business</span>
              </span>
            </div>
            {(data?.clinic_comparison ?? []).length === 0 ? (
              <EmptyState title="Нет данных" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: 'var(--bg-1)' }}>
                      <th className="text-left px-4 py-2.5" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)' }}>Клиника</th>
                      <th className="text-right px-2 py-2.5" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)' }}>Напр.</th>
                      <th className="text-right px-2 py-2.5" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)' }}>Подтв.</th>
                      <th className="text-right px-4 py-2.5" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)' }}>Конв.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.clinic_comparison ?? []).map((c, i, arr) => (
                      <tr key={c.clinic_id} style={{ borderBottom: i < arr.length - 1 ? '1px solid var(--line)' : 'none' }}>
                        <td className="px-4 py-3 text-xs font-medium" style={{ color: 'var(--fg)' }}>{c.name}</td>
                        <td className="px-2 py-3 text-right text-xs" style={{ color: 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>{c.total}</td>
                        <td className="px-2 py-3 text-right text-xs" style={{ color: 'var(--good)', fontVariantNumeric: 'tabular-nums' }}>{c.confirmed}</td>
                        <td className="px-4 py-3 text-right text-xs font-bold" style={{ color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>{c.conversion_pct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      ))}
    </ManagerShell>
  )
}
