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
import { useEffect, useState, useCallback, useMemo } from 'react'
import axios from 'axios'
import { API_BASE } from '../config'

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

// ── Donut chart (CSS conic-gradient) ────────────────────────────────────────
function DonutChart({ data, size = 180 }) {
  // data: [{ label, value, color }]
  const total = data.reduce((s, x) => s + Number(x.value || 0), 0)
  if (!total) {
    return (
      <div
        className="rounded-full grid place-items-center text-xs text-gray-400"
        style={{ width: size, height: size, background: '#f3f4f6' }}
      >
        Нет данных
      </div>
    )
  }

  // Строим conic-gradient: накопительно от 0deg до 360deg
  let acc = 0
  const stops = data.map((d) => {
    const pct = (Number(d.value) / total) * 100
    const from = acc
    acc += pct
    return `${d.color} ${from}% ${acc}%`
  }).join(', ')

  const inner = Math.round(size * 0.62)

  return (
    <div
      className="relative rounded-full mx-auto"
      style={{
        width: size, height: size,
        background: `conic-gradient(${stops})`,
        flexShrink: 0,
      }}
      role="img"
      aria-label="Распределение по категориям"
    >
      <div
        className="absolute rounded-full grid place-items-center"
        style={{
          width: inner, height: inner,
          top: (size - inner) / 2, left: (size - inner) / 2,
          background: '#fff',
          boxShadow: 'inset 0 0 0 1px #f3f4f6',
        }}
      >
        <div className="text-center">
          <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Всего</p>
          <p className="text-base font-extrabold text-gray-900 leading-none mt-0.5">
            {fmtRub(total)}
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Bar chart by month (12 столбцов) ─────────────────────────────────────────
function MonthBars({ values }) {
  const max = Math.max(1, ...values.map(v => Number(v || 0)))
  return (
    <div className="flex items-end gap-1.5 h-32" style={{ paddingBottom: 22 }}>
      {values.map((v, i) => {
        const h = Math.round((Number(v || 0) / max) * 100)
        return (
          <div key={i} className="flex-1 flex flex-col items-center relative group">
            <div className="w-full flex-1 flex items-end">
              <div
                className="w-full rounded-t-md transition-all"
                style={{
                  height: `${h}%`,
                  minHeight: v > 0 ? 4 : 0,
                  background: v > 0
                    ? 'linear-gradient(180deg, #1565C0 0%, #0097A7 100%)'
                    : '#f3f4f6',
                }}
                title={`${MONTH_NAMES[i]}: ${fmtRub(v)}`}
              />
            </div>
            <p className="text-[10px] text-gray-500 mt-1 font-medium absolute -bottom-5">
              {MONTH_NAMES[i]}
            </p>
          </div>
        )
      })}
    </div>
  )
}

// ── Top-5 клиник: горизонтальные бары ───────────────────────────────────────
function ClinicBars({ entries }) {
  if (!entries.length) {
    return <p className="text-xs text-gray-500 text-center py-4">Нет данных по клиникам</p>
  }
  const max = Math.max(1, ...entries.map(([, v]) => Number(v || 0)))
  return (
    <div className="space-y-2.5">
      {entries.map(([name, val], idx) => {
        const w = (Number(val) / max) * 100
        return (
          <div key={name + idx}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-semibold text-gray-700 truncate pr-2">{name}</span>
              <span className="font-bold text-gray-900 flex-shrink-0">{fmtRub(val)}</span>
            </div>
            <div className="rounded-full overflow-hidden" style={{ height: 8, background: '#f3f4f6' }}>
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${w}%`,
                  background: `linear-gradient(90deg, ${CAT_PALETTE[idx % CAT_PALETTE.length]} 0%, #0097A7 100%)`,
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

  if (error === 'module_off') {
    return (
      <div className="px-1 pt-2">
        <div className="rounded-2xl p-6 text-center" style={{ background: '#fef3c7', border: '1px solid #fde68a' }}>
          <span className="material-symbols-outlined text-3xl mb-2 block" style={{ color: '#92400e' }}>lock</span>
          <p className="text-sm font-semibold" style={{ color: '#92400e' }}>
            Модуль расходника не подключен.
          </p>
          <p className="text-xs mt-1" style={{ color: '#92400e' }}>
            Свяжитесь с менеджером клиники.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="px-1 pt-2 pb-6 space-y-3">
      {/* ── Header: year selector + PDF ── */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1 p-1 rounded-xl" style={{ background: '#f3f4f6' }}>
          {getYearOptions().map(y => {
            const active = y === year
            return (
              <button
                key={y}
                onClick={() => setYear(y)}
                className="px-3 py-1.5 rounded-lg text-sm font-bold transition-all"
                style={{
                  background: active ? '#fff' : 'transparent',
                  color: active ? '#0097A7' : '#6b7280',
                  boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                }}
              >
                {y}
              </button>
            )
          })}
        </div>
        <button
          onClick={handlePdf}
          className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold transition-all active:scale-95"
          style={{ background: '#0097A7', color: '#fff' }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}>
            picture_as_pdf
          </span>
          Скачать PDF
        </button>
      </div>

      {loading ? (
        <>
          <div className="rounded-3xl h-32 animate-pulse" style={{ background: '#e5e7eb' }} />
          <div className="rounded-2xl h-48 animate-pulse" style={{ background: '#e5e7eb' }} />
          <div className="rounded-2xl h-40 animate-pulse" style={{ background: '#e5e7eb' }} />
        </>
      ) : error === 'load' ? (
        <div className="rounded-xl p-4 text-center text-sm" style={{ background: '#fee2e2', color: '#991b1b' }}>
          Не удалось загрузить данные расходника.
        </div>
      ) : (
        <>
          {/* ── Total spent (hero card) ── */}
          <div
            className="relative overflow-hidden rounded-3xl p-5 text-white"
            style={{
              background: 'linear-gradient(135deg, #0A2342 0%, #1565C0 60%, #0097A7 100%)',
              boxShadow: '0 12px 32px rgba(21,101,192,0.25)',
            }}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-blue-200 text-xs font-medium uppercase tracking-wide">Потрачено в {year}</p>
                <p className="text-4xl font-black leading-none mt-1">{fmtRub(summary?.total_spent)}</p>
                <p className="text-blue-200 text-xs mt-1.5">
                  Приёмов: <span className="text-white font-bold">{summary?.appointments_count || 0}</span>
                </p>
              </div>
              <span
                className="material-symbols-outlined opacity-60"
                style={{ fontSize: 56, fontVariationSettings: "'FILL' 1" }}
              >
                receipt_long
              </span>
            </div>

            {/* loyalty earned + saved */}
            <div className="grid grid-cols-2 gap-2 mt-4">
              <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.15)' }}>
                <p className="text-[10px] uppercase tracking-wide text-blue-200 font-semibold">Начислено баллов</p>
                <p className="text-lg font-extrabold mt-0.5">
                  {Number(summary?.loyalty_earned_this_year || 0).toLocaleString('ru-RU')}
                </p>
              </div>
              <div className="rounded-xl p-3" style={{ background: 'rgba(16,185,129,0.25)' }}>
                <p className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: '#a7f3d0' }}>
                  Сэкономлено
                </p>
                <p className="text-lg font-extrabold mt-0.5" style={{ color: '#ecfdf5' }}>
                  {fmtRub(summary?.saved_with_loyalty)}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {/* ── By category (donut + legend) ── */}
            <div className="rounded-2xl p-4" style={{ background: '#fff', border: '1px solid #e5e7eb' }}>
              <h3 className="text-sm font-bold text-gray-900 mb-3">По категориям услуг</h3>
              {catEntries.length === 0 ? (
                <p className="text-xs text-gray-500 text-center py-6">Нет данных</p>
              ) : (
                <div className="flex flex-col sm:flex-row items-center gap-4">
                  <DonutChart data={catEntries} size={160} />
                  <div className="flex-1 w-full space-y-1.5">
                    {catEntries.map((c, idx) => (
                      <div key={c.label + idx} className="flex items-center gap-2 text-xs">
                        <span
                          className="inline-block flex-shrink-0 rounded-full"
                          style={{ width: 10, height: 10, background: c.color }}
                        />
                        <span className="flex-1 truncate text-gray-700">{c.label}</span>
                        <span className="font-bold text-gray-900 flex-shrink-0">{fmtRub(c.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ── By clinic (top-5) ── */}
            <div className="rounded-2xl p-4" style={{ background: '#fff', border: '1px solid #e5e7eb' }}>
              <h3 className="text-sm font-bold text-gray-900 mb-3">Топ-5 клиник</h3>
              <ClinicBars entries={clinicEntries} />
            </div>
          </div>

          {/* ── By month ── */}
          <div className="rounded-2xl p-4" style={{ background: '#fff', border: '1px solid #e5e7eb' }}>
            <h3 className="text-sm font-bold text-gray-900 mb-3">По месяцам</h3>
            <MonthBars values={monthValues} />
          </div>
        </>
      )}
    </div>
  )
}
