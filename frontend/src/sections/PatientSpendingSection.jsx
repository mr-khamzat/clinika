/**
 * ========================================
 * БЛОК: PatientSpendingSection — «Расходник» пациента (Глава 8)
 * ========================================
 * Используется внутри PatientCabinet.jsx (вкладка «Расходник»).
 *
 * API:
 *   GET /patient/spending-summary?year=YYYY
 *     → { year, total_spent, appointments_count,
 *         by_category: { [cat]: amount }, by_clinic: { [name]: amount },
 *         by_month: number[12], loyalty_earned_this_year, saved_with_loyalty }
 *   GET /patient/spending-summary/export.pdf?year=YYYY  (window.open)
 *
 * Графика (без recharts):
 *   - Donut chart by_category — CSS conic-gradient
 *   - Bar chart by_month — 12 CSS-столбцов
 *   - Top-5 by_clinic — горизонтальные «бары»
 *
 * Mobile-first: на телефоне stack, на десктопе grid 2 кол.
 * ========================================
 */
import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import axios from 'axios'
import { API_BASE } from '../config'

// ═════ БЛОК: useCountUp — animated number tween ═════
function useCountUp(target, { duration = 1200, enabled = true } = {}) {
  const [value, setValue] = useState(enabled ? 0 : target)
  const rafRef = useRef(null)
  const startRef = useRef(null)
  const fromRef = useRef(0)
  useEffect(() => {
    if (!enabled) { setValue(target); return }
    const from = 0
    const to = Number(target) || 0
    if (to === from) { setValue(to); return }
    cancelAnimationFrame(rafRef.current)
    startRef.current = null
    fromRef.current = from
    const step = (ts) => {
      if (startRef.current == null) startRef.current = ts
      const elapsed = ts - startRef.current
      const t = Math.min(1, elapsed / duration)
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t)
      setValue(Math.round(from + (to - from) * eased))
      if (t < 1) rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target, duration, enabled])
  return value
}

const SESSION_KEY = 'clinika_patient_session'

// Палитра для категорий — повторяющийся circular pattern
const CAT_PALETTE = [
  '#0097A7', '#1565C0', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#06b6d4',
]

const MONTH_NAMES = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек']

function fmtRub(v) {
  const n = Number(v || 0)
  if (!Number.isFinite(n)) return '0 ₽'
  return `${n.toLocaleString('ru-RU')} ₽`
}

function getYearOptions() {
  const cur = new Date().getFullYear()
  return [cur, cur - 1, cur - 2]
}

// ═════ БЛОК: DonutChart — donut с count-up центром ═════
function DonutChart({ data, size = 180 }) {
  // data: [{ label, value, color }]
  const total = data.reduce((s, x) => s + Number(x.value || 0), 0)
  const animatedTotal = useCountUp(total, { duration: 1200 })

  if (!total) {
    return (
      <div
        className="rounded-full grid place-items-center text-xs text-gray-400 dark:text-gray-500"
        style={{
          width: size, height: size,
          background: '#f3f4f6',
          boxShadow: 'inset 0 2px 8px rgba(0,0,0,.06)',
        }}
      >
        Нет данных
      </div>
    )
  }

  let acc = 0
  const stops = data.map((d) => {
    const pct = (Number(d.value) / total) * 100
    const from = acc
    acc += pct
    return `${d.color} ${from}% ${acc}%`
  }).join(', ')

  const inner = Math.round(size * 0.64)

  return (
    <div
      className="relative rounded-full mx-auto"
      style={{
        width: size, height: size,
        background: `conic-gradient(${stops})`,
        flexShrink: 0,
        boxShadow: '0 12px 32px rgba(0,0,0,.10), inset 0 0 0 2px rgba(255,255,255,.6)',
        animation: 'spendDonutIn .9s cubic-bezier(.22,1,.36,1) both',
      }}
      role="img"
      aria-label="Распределение по категориям"
    >
      <div
        className="absolute rounded-full grid place-items-center"
        style={{
          width: inner, height: inner,
          top: (size - inner) / 2, left: (size - inner) / 2,
          background: 'linear-gradient(180deg,#ffffff 0%,#f8fafc 100%)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,.7), 0 4px 12px rgba(0,0,0,.05)',
        }}
      >
        <div className="text-center px-2">
          <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-bold">Всего</p>
          <p
            className="font-black text-gray-900 dark:text-gray-100 leading-none mt-1 tabular-nums"
            style={{ fontSize: size >= 180 ? 18 : 15 }}
          >
            {animatedTotal.toLocaleString('ru-RU')}
          </p>
          <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 font-semibold">₽</p>
        </div>
      </div>
    </div>
  )
}

// ═════ БЛОК: MonthBars — гистограмма по месяцам со stagger ═════
function MonthBars({ values }) {
  const max = Math.max(1, ...values.map(v => Number(v || 0)))
  const curMonth = new Date().getMonth()
  return (
    <div className="flex items-end gap-1.5 h-36" style={{ paddingBottom: 22 }}>
      {values.map((v, i) => {
        const h = Math.round((Number(v || 0) / max) * 100)
        const isCurrent = i === curMonth
        return (
          <div key={i} className="flex-1 flex flex-col items-center relative group">
            <div className="w-full flex-1 flex items-end">
              <div
                className="spend-bar w-full rounded-t-lg"
                style={{
                  height: `${h}%`,
                  minHeight: v > 0 ? 4 : 0,
                  background: v > 0
                    ? (isCurrent
                        ? 'linear-gradient(180deg, #0097A7 0%, #10B981 100%)'
                        : 'linear-gradient(180deg, #1565C0 0%, #0097A7 100%)')
                    : '#f3f4f6',
                  boxShadow: v > 0 ? '0 2px 6px rgba(21,101,192,.25), inset 0 1px 0 rgba(255,255,255,.3)' : 'none',
                  animationDelay: `${i * 0.05}s`,
                }}
                title={`${MONTH_NAMES[i]}: ${fmtRub(v)}`}
              />
            </div>
            <p
              className="text-[10px] mt-1 font-bold absolute -bottom-5"
              style={{ color: isCurrent ? '#0097A7' : '#9ca3af' }}
            >
              {MONTH_NAMES[i]}
            </p>
          </div>
        )
      })}
    </div>
  )
}

// ═════ БЛОК: ClinicBars — топ-5 клиник со stagger ═════
function ClinicBars({ entries }) {
  if (!entries.length) {
    return <p className="text-xs text-gray-500 dark:text-gray-400 text-center py-4">Нет данных по клиникам</p>
  }
  const max = Math.max(1, ...entries.map(([, v]) => Number(v || 0)))
  return (
    <div className="space-y-3">
      {entries.map(([name, val], idx) => {
        const w = (Number(val) / max) * 100
        const color = CAT_PALETTE[idx % CAT_PALETTE.length]
        return (
          <div
            key={name + idx}
            className="spend-row"
            style={{ animationDelay: `${idx * 0.05}s` }}
          >
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="inline-flex items-center gap-1.5 font-bold text-gray-700 dark:text-gray-200 truncate pr-2">
                <span
                  className="inline-grid place-items-center rounded-md flex-shrink-0 text-[10px] font-black text-white"
                  style={{ width: 18, height: 18, background: color }}
                >
                  {idx + 1}
                </span>
                <span className="truncate">{name}</span>
              </span>
              <span className="font-extrabold tabular-nums flex-shrink-0" style={{ color: '#0097A7' }}>
                {fmtRub(val)}
              </span>
            </div>
            <div
              className="rounded-full overflow-hidden"
              style={{
                height: 10,
                background: '#f3f4f6',
                boxShadow: 'inset 0 1px 2px rgba(0,0,0,.06)',
              }}
            >
              <div
                className="spend-bar-h h-full rounded-full relative overflow-hidden"
                style={{
                  width: `${w}%`,
                  background: `linear-gradient(90deg, ${color} 0%, #0097A7 100%)`,
                  boxShadow: `0 2px 6px ${color}55, inset 0 1px 0 rgba(255,255,255,.3)`,
                  animationDelay: `${idx * 0.05}s`,
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function PatientSpendingSection({ sessionToken: sessionTokenProp }) {
  const sessionToken = sessionTokenProp || (typeof window !== 'undefined' ? localStorage.getItem(SESSION_KEY) : null)
  const [year, setYear] = useState(new Date().getFullYear())
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await axios.get(`${API_BASE}/patient/spending-summary`, {
        params: { t: sessionToken, year },
      })
      setSummary(r?.data || null)
    } catch (e) {
      const status = e?.response?.status
      if (status === 402) setError('module_off')
      else setError('load')
    } finally {
      setLoading(false)
    }
  }, [sessionToken, year])

  useEffect(() => { load() }, [load])

  const handlePdf = () => {
    // Открываем PDF в новой вкладке. Сессия передаётся через ?t=...
    const u = `${API_BASE}/patient/spending-summary/export.pdf?year=${year}&t=${encodeURIComponent(sessionToken || '')}`
    window.open(u, '_blank', 'noopener,noreferrer')
  }

  // Подготовка donut-данных
  const catEntries = useMemo(() => {
    const obj = summary?.by_category || {}
    return Object.entries(obj)
      .map(([k, v]) => ({ label: k, value: Number(v) || 0 }))
      .filter(x => x.value > 0)
      .sort((a, b) => b.value - a.value)
      .map((x, i) => ({ ...x, color: CAT_PALETTE[i % CAT_PALETTE.length] }))
  }, [summary])

  const clinicEntries = useMemo(() => {
    const obj = summary?.by_clinic || {}
    return Object.entries(obj)
      .map(([k, v]) => [k, Number(v) || 0])
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
  }, [summary])

  const monthValues = useMemo(() => {
    const arr = Array.isArray(summary?.by_month) ? summary.by_month.slice(0, 12) : []
    while (arr.length < 12) arr.push(0)
    return arr.map(v => Number(v) || 0)
  }, [summary])

  // Производные показатели для summary-блока «Среднее за месяц / Топ клиника / Самая дорогая категория»
  const monthsWithSpend = monthValues.filter(v => v > 0).length || 1
  const avgPerMonth = Math.round((Number(summary?.total_spent) || 0) / monthsWithSpend)
  const topClinic = clinicEntries[0]
  const topCategory = catEntries[0]

  const animatedTotal = useCountUp(Number(summary?.total_spent) || 0, { duration: 1200, enabled: !loading && !error })

  if (error === 'module_off') {
    return (
      <div className="px-1 pt-2">
        <div
          className="rounded-2xl p-6 text-center"
          style={{
            background: 'linear-gradient(180deg,#fef3c7 0%,#fde68a 100%)',
            border: '1px solid #fde68a',
            boxShadow: '0 4px 16px rgba(245,158,11,.18), inset 0 1px 0 rgba(255,255,255,.5)',
          }}
        >
          <span className="material-symbols-outlined text-4xl mb-2 block" style={{ color: '#92400e', fontVariationSettings: "'FILL' 1" }}>lock</span>
          <p className="text-sm font-bold" style={{ color: '#92400e' }}>Модуль расходника не подключен</p>
          <p className="text-xs mt-1" style={{ color: '#92400e' }}>Свяжитесь с менеджером клиники.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="px-1 pt-2 pb-6 space-y-3">
      <style>{`
        @keyframes spendPop { from{opacity:0; transform:translateY(10px) scale(.98)} to{opacity:1; transform:translateY(0) scale(1)} }
        @keyframes spendHeroIn { from{opacity:0; transform:translateY(14px)} to{opacity:1; transform:translateY(0)} }
        @keyframes spendBarUp { from{transform:scaleY(0); opacity:.4} to{transform:scaleY(1); opacity:1} }
        @keyframes spendBarH { from{width:0; opacity:.4} to{opacity:1} }
        @keyframes spendDonutIn { from{opacity:0; transform:scale(.85) rotate(-12deg)} to{opacity:1; transform:scale(1) rotate(0)} }
        @keyframes spendShimmer { 0%{transform:translateX(-100%)} 100%{transform:translateX(100%)} }
        .spend-card { animation: spendPop .55s cubic-bezier(.22,1,.36,1) both; }
        .spend-hero { animation: spendHeroIn .7s cubic-bezier(.22,1,.36,1) both; }
        .spend-bar { transform-origin: bottom; animation: spendBarUp .8s cubic-bezier(.22,1,.36,1) both; }
        .spend-bar-h { animation: spendBarH 1s cubic-bezier(.22,1,.36,1) both; }
        .spend-row { animation: spendPop .55s cubic-bezier(.22,1,.36,1) both; }
        .spend-tap:active { transform: scale(.97); }
      `}</style>

      {/* ═════ БЛОК: Header — year-chips + PDF ═════ */}
      <div className="flex items-center justify-between gap-2">
        <div
          className="flex gap-1 p-1 rounded-xl bg-gray-100 dark:bg-gray-800/60"
          style={{ boxShadow: 'inset 0 1px 2px rgba(0,0,0,.04)' }}
        >
          {getYearOptions().map(y => {
            const active = y === year
            return (
              <button
                key={y}
                onClick={() => setYear(y)}
                className="spend-tap px-3 py-1.5 rounded-lg text-sm font-bold transition-all"
                style={{
                  background: active ? 'linear-gradient(135deg,#fff,#f8fafc)' : 'transparent',
                  color: active ? '#0097A7' : '#6b7280',
                  boxShadow: active ? '0 2px 8px rgba(0,151,167,.18), inset 0 1px 0 rgba(255,255,255,.6)' : 'none',
                }}
              >
                {y}
              </button>
            )
          })}
        </div>
        <button
          onClick={handlePdf}
          className="spend-tap inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-bold transition-all"
          style={{
            background: 'linear-gradient(135deg,#0097A7 0%,#1565C0 100%)',
            color: '#fff',
            boxShadow: '0 4px 12px rgba(0,151,167,.32), inset 0 1px 0 rgba(255,255,255,.3)',
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}>
            picture_as_pdf
          </span>
          PDF
        </button>
      </div>

      {loading ? (
        <>
          <div className="rounded-3xl h-44 animate-pulse bg-gray-200 dark:bg-gray-800" />
          <div className="rounded-2xl h-52 animate-pulse bg-gray-200 dark:bg-gray-800" />
          <div className="rounded-2xl h-40 animate-pulse bg-gray-200 dark:bg-gray-800" />
        </>
      ) : error === 'load' ? (
        <div
          className="rounded-2xl p-4 text-center text-sm font-semibold"
          style={{
            background: 'linear-gradient(180deg,#fee2e2 0%,#fecaca 100%)',
            color: '#991b1b',
            border: '1px solid #fecaca',
          }}
        >
          Не удалось загрузить данные расходника.
        </div>
      ) : (
        <>
          {/* ═════ БЛОК: Hero — total spent с count-up + decorative ═════ */}
          <div
            className="spend-hero relative overflow-hidden rounded-3xl p-5 text-white"
            style={{
              background: 'linear-gradient(135deg, #0A2342 0%, #1565C0 55%, #0097A7 100%)',
              boxShadow: '0 14px 40px rgba(21,101,192,0.28), inset 0 1px 0 rgba(255,255,255,.25)',
            }}
          >
            {/* shimmer overlay */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: 'linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.18) 50%, transparent 70%)',
                animation: 'spendShimmer 4s ease-in-out infinite',
              }}
            />
            {/* decorative icon */}
            <span
              className="material-symbols-outlined absolute pointer-events-none"
              style={{
                top: -16, right: -16, fontSize: 180, opacity: 0.10,
                fontVariationSettings: "'FILL' 1",
                transform: 'rotate(-6deg)',
              }}
            >
              receipt_long
            </span>

            <div className="relative">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-blue-100 text-[10px] font-bold uppercase tracking-widest opacity-85">
                    Потрачено в {year}
                  </p>
                  <p
                    className="font-black leading-none mt-1 tabular-nums tracking-tight"
                    style={{ fontSize: 'clamp(34px, 9vw, 44px)' }}
                  >
                    {animatedTotal.toLocaleString('ru-RU')}
                    <span className="text-lg font-bold opacity-85 ml-2">₽</span>
                  </p>
                  <p className="text-blue-100 text-xs mt-2 inline-flex items-center gap-1.5">
                    <span className="material-symbols-outlined" style={{ fontSize: 14, fontVariationSettings: "'FILL' 1" }}>event</span>
                    Приёмов: <span className="text-white font-bold tabular-nums">{summary?.appointments_count || 0}</span>
                  </p>
                </div>
              </div>

              {/* loyalty earned + saved */}
              <div className="grid grid-cols-2 gap-2.5 mt-4">
                <div
                  className="rounded-2xl p-3"
                  style={{
                    background: 'rgba(255,255,255,0.16)',
                    border: '1px solid rgba(255,255,255,.22)',
                    backdropFilter: 'blur(6px)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,.3)',
                  }}
                >
                  <p className="text-[10px] uppercase tracking-wider text-blue-100 font-bold inline-flex items-center gap-1">
                    <span className="material-symbols-outlined" style={{ fontSize: 13, fontVariationSettings: "'FILL' 1" }}>workspace_premium</span>
                    Начислено баллов
                  </p>
                  <p className="text-lg font-extrabold mt-0.5 tabular-nums">
                    {Number(summary?.loyalty_earned_this_year || 0).toLocaleString('ru-RU')}
                  </p>
                </div>
                <div
                  className="rounded-2xl p-3"
                  style={{
                    background: 'rgba(16,185,129,0.28)',
                    border: '1px solid rgba(167,243,208,.4)',
                    backdropFilter: 'blur(6px)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,.25)',
                  }}
                >
                  <p className="text-[10px] uppercase tracking-wider font-bold inline-flex items-center gap-1" style={{ color: '#a7f3d0' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 13, fontVariationSettings: "'FILL' 1" }}>savings</span>
                    Сэкономлено
                  </p>
                  <p className="text-lg font-extrabold mt-0.5 tabular-nums" style={{ color: '#ecfdf5' }}>
                    {fmtRub(summary?.saved_with_loyalty)}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* ═════ БЛОК: Категории-chips — горизонтальный scroll ═════ */}
          {catEntries.length > 0 && (
            <div className="-mx-1 px-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
              <div className="flex gap-2 pb-1" style={{ minWidth: 'min-content' }}>
                {catEntries.map((c, idx) => (
                  <div
                    key={c.label + idx}
                    className="spend-card inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 flex-shrink-0"
                    style={{
                      background: '#fff',
                      border: `1.5px solid ${c.color}33`,
                      boxShadow: '0 2px 8px rgba(0,0,0,.04), inset 0 1px 0 rgba(255,255,255,.5)',
                      animationDelay: `${idx * 0.05}s`,
                    }}
                  >
                    <span
                      className="inline-block rounded-full flex-shrink-0"
                      style={{
                        width: 8, height: 8,
                        background: c.color,
                        boxShadow: `0 0 0 2px ${c.color}22`,
                      }}
                    />
                    <span className="text-xs font-bold text-gray-700 dark:text-gray-200 whitespace-nowrap">{c.label}</span>
                    <span className="text-xs font-extrabold tabular-nums" style={{ color: c.color }}>
                      {fmtRub(c.value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {/* ═════ БЛОК: Donut по категориям ═════ */}
            <div
              className="spend-card rounded-2xl p-4 bg-white dark:bg-gray-900"
              style={{
                border: '1px solid rgba(0,0,0,.06)',
                boxShadow: '0 4px 16px rgba(0,0,0,.06), inset 0 1px 0 rgba(255,255,255,.5)',
              }}
            >
              <h3 className="text-sm font-extrabold text-gray-900 dark:text-gray-100 mb-3 inline-flex items-center gap-1.5">
                <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#0097A7', fontVariationSettings: "'FILL' 1" }}>donut_large</span>
                По категориям услуг
              </h3>
              {catEntries.length === 0 ? (
                <p className="text-xs text-gray-500 dark:text-gray-400 text-center py-6">Нет данных</p>
              ) : (
                <div className="flex flex-col sm:flex-row items-center gap-4">
                  <DonutChart data={catEntries} size={180} />
                  <div className="flex-1 w-full space-y-2">
                    {catEntries.map((c, idx) => {
                      const total = catEntries.reduce((s, x) => s + x.value, 0) || 1
                      const pct = Math.round((c.value / total) * 100)
                      return (
                        <div
                          key={c.label + idx}
                          className="spend-row flex items-center gap-2 text-xs"
                          style={{ animationDelay: `${idx * 0.05}s` }}
                        >
                          <span
                            className="inline-block flex-shrink-0 rounded-md"
                            style={{
                              width: 12, height: 12,
                              background: c.color,
                              boxShadow: `0 0 0 2px ${c.color}22`,
                            }}
                          />
                          <span className="flex-1 truncate font-semibold text-gray-700 dark:text-gray-200">{c.label}</span>
                          <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 tabular-nums">{pct}%</span>
                          <span className="font-extrabold text-gray-900 dark:text-gray-100 flex-shrink-0 tabular-nums">{fmtRub(c.value)}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* ═════ БЛОК: Top-5 клиник ═════ */}
            <div
              className="spend-card rounded-2xl p-4 bg-white dark:bg-gray-900"
              style={{
                border: '1px solid rgba(0,0,0,.06)',
                boxShadow: '0 4px 16px rgba(0,0,0,.06), inset 0 1px 0 rgba(255,255,255,.5)',
                animationDelay: '0.08s',
              }}
            >
              <h3 className="text-sm font-extrabold text-gray-900 dark:text-gray-100 mb-3 inline-flex items-center gap-1.5">
                <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#1565C0', fontVariationSettings: "'FILL' 1" }}>local_hospital</span>
                Топ-5 клиник
              </h3>
              <ClinicBars entries={clinicEntries} />
            </div>
          </div>

          {/* ═════ БЛОК: By month ═════ */}
          <div
            className="spend-card rounded-2xl p-4 bg-white dark:bg-gray-900"
            style={{
              border: '1px solid rgba(0,0,0,.06)',
              boxShadow: '0 4px 16px rgba(0,0,0,.06), inset 0 1px 0 rgba(255,255,255,.5)',
              animationDelay: '0.12s',
            }}
          >
            <h3 className="text-sm font-extrabold text-gray-900 dark:text-gray-100 mb-3 inline-flex items-center gap-1.5">
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#10B981', fontVariationSettings: "'FILL' 1" }}>bar_chart</span>
              По месяцам
            </h3>
            <MonthBars values={monthValues} />
          </div>

          {/* ═════ БЛОК: Summary — Среднее / Топ клиника / Самая дорогая категория ═════ */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {[
              {
                icon: 'trending_up',
                color: '#0097A7',
                label: 'Среднее за месяц',
                value: fmtRub(avgPerMonth),
                sub: monthsWithSpend > 0 ? `за ${monthsWithSpend} ${monthsWithSpend === 1 ? 'месяц' : monthsWithSpend < 5 ? 'месяца' : 'месяцев'}` : 'нет данных',
              },
              {
                icon: 'local_hospital',
                color: '#1565C0',
                label: 'Топ клиника',
                value: topClinic ? topClinic[0] : '—',
                sub: topClinic ? fmtRub(topClinic[1]) : '',
              },
              {
                icon: 'savings',
                color: '#A855F7',
                label: 'Самая дорогая категория',
                value: topCategory ? topCategory.label : '—',
                sub: topCategory ? fmtRub(topCategory.value) : '',
              },
            ].map((s, idx) => (
              <div
                key={s.label}
                className="spend-card rounded-2xl p-3.5 bg-white dark:bg-gray-900"
                style={{
                  border: '1px solid rgba(0,0,0,.06)',
                  boxShadow: '0 4px 16px rgba(0,0,0,.06), inset 0 1px 0 rgba(255,255,255,.5)',
                  animationDelay: `${0.18 + idx * 0.05}s`,
                  borderLeft: `4px solid ${s.color}`,
                }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="inline-grid place-items-center rounded-lg flex-shrink-0"
                    style={{
                      width: 28, height: 28,
                      background: `${s.color}15`,
                      color: s.color,
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 17, fontVariationSettings: "'FILL' 1" }}>
                      {s.icon}
                    </span>
                  </span>
                  <p className="text-[10px] uppercase tracking-wider font-bold text-gray-500 dark:text-gray-400 leading-tight">
                    {s.label}
                  </p>
                </div>
                <p className="text-sm font-extrabold text-gray-900 dark:text-gray-100 leading-tight truncate">
                  {s.value}
                </p>
                {s.sub && <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 truncate">{s.sub}</p>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
