// Patient Vitals tab — показатели здоровья + интеграция с Apple Health.
// Mobile-first Tailwind. Без сторонних чарт-библиотек — sparkline через inline SVG.
//
// Apple Health: реальный sync делает нативное iOS-приложение-обёртка через
// мост window.ClinikaBridge.requestHealthSync(payload). Мост сам POST-ит
// собранные сэмплы на /patient/vitals/sync/apple-health с переданным session_token.
// Если приложения нет (обычный браузер на iOS) — показываем подсказку.

import { useEffect, useMemo, useState, useCallback } from 'react'
import axios from 'axios'
import { API_BASE, BASE_PATH } from '../../config'
import { useToast } from '../../design'

const API = `${API_BASE}${BASE_PATH}`

// Список метрик: подпись, иконка Material Symbols, единица, форматтер.
const METRICS = {
  heart_rate:        { label: 'Пульс',        icon: 'favorite',         unit: 'уд/мин', fmt: v => Math.round(v) },
  blood_pressure_sys:{ label: 'Давление',     icon: 'monitor_heart',    unit: 'мм рт.ст.', fmt: v => Math.round(v) },
  blood_pressure_dia:{ label: 'Давление (д.)',icon: 'monitor_heart',    unit: 'мм рт.ст.', fmt: v => Math.round(v) },
  spo2:              { label: 'SpO₂',         icon: 'spo2',             unit: '%',     fmt: v => Math.round(v) },
  glucose:           { label: 'Глюкоза',      icon: 'water_drop',       unit: 'ммоль/л', fmt: v => Number(v).toFixed(1) },
  weight_kg:         { label: 'Вес',          icon: 'monitor_weight',   unit: 'кг',    fmt: v => Number(v).toFixed(1) },
  height_cm:         { label: 'Рост',         icon: 'height',           unit: 'см',    fmt: v => Math.round(v) },
  temperature:       { label: 'Температура',  icon: 'thermostat',       unit: '°C',    fmt: v => Number(v).toFixed(1) },
  steps:             { label: 'Шаги',         icon: 'directions_walk',  unit: 'шагов', fmt: v => Math.round(v).toLocaleString('ru-RU') },
  sleep_minutes:     { label: 'Сон',          icon: 'bedtime',          unit: 'мин',   fmt: v => `${Math.floor(v/60)} ч ${Math.round(v%60)} м` },
  hrv:               { label: 'HRV',          icon: 'graphic_eq',       unit: 'мс',    fmt: v => Math.round(v) },
}

const KPI_ORDER = ['heart_rate', 'blood_pressure_sys', 'spo2', 'steps']
const ALL_ORDER = [
  'heart_rate', 'blood_pressure_sys', 'blood_pressure_dia',
  'spo2', 'temperature', 'glucose',
  'steps', 'weight_kg', 'height_cm', 'sleep_minutes', 'hrv',
]

// Простой SVG-sparkline без зависимостей.
function Sparkline({ points, width = 280, height = 64, color = '#0097A7' }) {
  if (!points || points.length < 2) {
    return <div className="text-xs text-gray-400 italic py-6 text-center">Недостаточно данных</div>
  }
  const values = points.map(p => p.v).filter(v => v != null && !isNaN(v))
  if (values.length < 2) {
    return <div className="text-xs text-gray-400 italic py-6 text-center">Недостаточно данных</div>
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const stepX = width / (points.length - 1)
  const path = points.map((p, i) => {
    const x = (i * stepX).toFixed(1)
    const v = p.v == null ? (min + max) / 2 : p.v
    const y = (height - ((v - min) / range) * (height - 8) - 4).toFixed(1)
    return `${i === 0 ? 'M' : 'L'} ${x} ${y}`
  }).join(' ')
  // Заливка под линией
  const lastX = ((points.length - 1) * stepX).toFixed(1)
  const fillPath = `${path} L ${lastX} ${height} L 0 ${height} Z`
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-16" preserveAspectRatio="none">
      <path d={fillPath} fill={color} fillOpacity="0.12" />
      <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Карточка KPI: крупное значение + delta vs неделя.
function KpiCard({ metricKey, data }) {
  const meta = METRICS[metricKey]
  if (!meta) return null
  const value = data?.value
  const delta = data?.delta_week
  const deltaSign = delta == null ? null : (delta > 0 ? '+' : '')
  const deltaColor = delta == null ? 'text-gray-400'
    : (delta > 0 ? 'text-rose-600' : 'text-emerald-600')

  return (
    <div className="bg-white rounded-2xl p-3 shadow-sm border border-gray-100 flex flex-col gap-1 min-w-0">
      <div className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-gray-500">
        <span className="material-symbols-rounded text-base" style={{ color: '#0097A7' }}>{meta.icon}</span>
        <span className="truncate">{meta.label}</span>
      </div>
      <div className="text-xl font-bold text-gray-900 leading-tight">
        {value != null ? meta.fmt(value) : '—'}
      </div>
      <div className="text-[11px] text-gray-400">{meta.unit}</div>
      {delta != null && (
        <div className={`text-[11px] font-medium ${deltaColor}`}>
          {deltaSign}{Number(delta).toFixed(1)} за неделю
        </div>
      )}
    </div>
  )
}

// Карточка с графиком (sparkline) по конкретной метрике.
function MetricChartCard({ metricKey, sessionToken }) {
  const meta = METRICS[metricKey]
  const [points, setPoints] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!sessionToken) return
    let cancelled = false
    setLoading(true)
    axios.get(`${API}/patient/vitals/series`, {
      params: { metric: metricKey, days: 30, session_token: sessionToken },
    })
      .then(r => { if (!cancelled) setPoints(r.data?.points || []) })
      .catch(() => { if (!cancelled) setPoints([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [metricKey, sessionToken])

  const last = points && points.length ? points[points.length - 1].v : null

  return (
    <div className="snap-start shrink-0 w-64 bg-white rounded-2xl p-3 shadow-sm border border-gray-100">
      <div className="flex items-center gap-1 mb-1">
        <span className="material-symbols-rounded text-base" style={{ color: '#0097A7' }}>{meta.icon}</span>
        <span className="text-sm font-medium text-gray-700">{meta.label}</span>
      </div>
      <div className="text-lg font-semibold text-gray-900">
        {last != null ? meta.fmt(last) : '—'}
        <span className="text-xs text-gray-400 font-normal ml-1">{meta.unit}</span>
      </div>
      {loading
        ? <div className="text-xs text-gray-400 py-6 text-center">Загрузка…</div>
        : <Sparkline points={points || []} />}
      <div className="text-[10px] text-gray-400 text-right">за 30 дней</div>
    </div>
  )
}

// Bottom sheet — модалка снизу для ручного ввода.
function AddVitalSheet({ open, onClose, onSubmit }) {
  const [metric, setMetric] = useState('heart_rate')
  const [value, setValue] = useState('')
  const [extraDia, setExtraDia] = useState('')  // для давления — диастолическое
  const [submitting, setSubmitting] = useState(false)

  if (!open) return null
  const meta = METRICS[metric]
  const isBp = metric === 'blood_pressure_sys'

  const handleSubmit = async () => {
    if (!value) return
    setSubmitting(true)
    try {
      // Для давления — две записи (sys и dia), второй с тем же measured_at.
      const measured = new Date().toISOString()
      if (isBp) {
        await onSubmit({ metric: 'blood_pressure_sys', value: Number(value), unit: 'mmHg', measured_at: measured })
        if (extraDia) {
          await onSubmit({ metric: 'blood_pressure_dia', value: Number(extraDia), unit: 'mmHg', measured_at: measured })
        }
      } else {
        await onSubmit({ metric, value: Number(value), unit: meta.unit, measured_at: measured })
      }
      setValue('')
      setExtraDia('')
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div
        className="w-full bg-white rounded-t-3xl p-4 pb-8 max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
        style={{ animation: 'slideUp 0.2s ease-out' }}
      >
        <div className="w-12 h-1.5 bg-gray-300 rounded-full mx-auto mb-3" />
        <h3 className="text-lg font-semibold mb-3 text-gray-900">Добавить запись</h3>

        <label className="block text-xs text-gray-500 mb-1">Показатель</label>
        <select
          value={metric}
          onChange={e => setMetric(e.target.value)}
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 mb-3 text-sm bg-gray-50"
        >
          {ALL_ORDER.filter(k => k !== 'blood_pressure_dia').map(k => (
            <option key={k} value={k}>{METRICS[k].label}</option>
          ))}
        </select>

        {isBp ? (
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Систолическое</label>
              <input
                type="number" inputMode="numeric"
                value={value} onChange={e => setValue(e.target.value)}
                placeholder="120"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Диастолическое</label>
              <input
                type="number" inputMode="numeric"
                value={extraDia} onChange={e => setExtraDia(e.target.value)}
                placeholder="80"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
              />
            </div>
          </div>
        ) : (
          <>
            <label className="block text-xs text-gray-500 mb-1">Значение ({meta.unit})</label>
            <input
              type="number" inputMode="decimal" step="0.1"
              value={value} onChange={e => setValue(e.target.value)}
              placeholder={meta.unit}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 mb-3 text-sm"
            />
          </>
        )}

        <button
          onClick={handleSubmit}
          disabled={!value || submitting}
          className="w-full py-3 rounded-xl text-white font-medium text-sm disabled:opacity-50"
          style={{ background: '#0097A7' }}
        >
          {submitting ? 'Сохраняю…' : 'Сохранить'}
        </button>
        <button
          onClick={onClose}
          className="w-full py-3 mt-2 rounded-xl text-gray-600 font-medium text-sm"
        >
          Отмена
        </button>
      </div>
    </div>
  )
}

// ── Главный компонент таба ───────────────────────────────────────────────────
export default function VitalsTab({ token, sessionToken, phone }) {
  // Замена alert на Toast
  const { toast } = useToast()
  const [summary, setSummary] = useState({})
  const [loading, setLoading] = useState(true)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [syncStatus, setSyncStatus] = useState(null)

  const isIOS = useMemo(() => /iPhone|iPad/.test(navigator.userAgent), [])
  const hasBridge = typeof window !== 'undefined' && !!window.ClinikaBridge?.requestHealthSync

  const reload = useCallback(async () => {
    if (!sessionToken) { setLoading(false); return }
    setLoading(true)
    try {
      const r = await axios.get(`${API}/patient/vitals/summary`, {
        params: { session_token: sessionToken },
      })
      setSummary(r.data?.latest || {})
    } catch (e) {
      // тихо — таб виден всем, даже без данных
    } finally {
      setLoading(false)
    }
  }, [sessionToken])

  useEffect(() => { reload() }, [reload])

  const submitManual = async (payload) => {
    await axios.post(`${API}/patient/vitals`, payload, {
      params: { session_token: sessionToken },
    })
    await reload()
  }

  const handleAppleHealth = () => {
    if (!isIOS) {
      toast('Apple Health доступен только на iPhone/iPad.', 'info', 5000)
      return
    }
    if (!hasBridge) {
      toast('Откройте кабинет в приложении КлиникСеть на iPhone — для синхронизации с Apple Health нужно нативное приложение.', 'info', 6000)
      return
    }
    try {
      // Передаём бриджу токен и base url — нативная часть POST-ит сэмплы сама.
      const payload = {
        endpoint: `${API}/patient/vitals/sync/apple-health`,
        sessionToken,
        metrics: Object.keys(METRICS),
        days: 30,
      }
      setSyncStatus('Запрашиваю доступ…')
      Promise.resolve(window.ClinikaBridge.requestHealthSync(payload))
        .then(() => {
          setSyncStatus('Синхронизация завершена')
          reload()
          setTimeout(() => setSyncStatus(null), 2500)
        })
        .catch((e) => {
          setSyncStatus('Ошибка синхронизации')
          setTimeout(() => setSyncStatus(null), 2500)
        })
    } catch (e) {
      setSyncStatus('Ошибка синхронизации')
      setTimeout(() => setSyncStatus(null), 2500)
    }
  }

  return (
    <div className="px-3 pt-3 pb-24">
      <style>{`@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        {KPI_ORDER.map(k => <KpiCard key={k} metricKey={k} data={summary[k]} />)}
      </div>

      {/* Apple Health */}
      {isIOS && (
        <div className="bg-white rounded-2xl p-3 mb-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-2">
            <span className="material-symbols-rounded" style={{ color: '#FF3B30' }}>favorite</span>
            <span className="text-sm font-semibold text-gray-800">Apple Health</span>
          </div>
          <p className="text-xs text-gray-500 mb-2">
            Синхронизируйте показатели с iPhone и Apple Watch.
          </p>
          <button
            onClick={handleAppleHealth}
            className="w-full py-2.5 rounded-xl text-white font-medium text-sm"
            style={{ background: '#000' }}
          >
            Синхронизировать с Apple Health
          </button>
          {syncStatus && (
            <div className="text-xs text-gray-500 mt-2 text-center">{syncStatus}</div>
          )}
        </div>
      )}

      {/* Charts row — горизонтальный скролл */}
      <h3 className="text-sm font-semibold text-gray-700 mb-2 px-1">Графики</h3>
      <div className="flex gap-2 overflow-x-auto snap-x snap-mandatory -mx-3 px-3 pb-2 mb-4"
           style={{ scrollbarWidth: 'none' }}>
        {ALL_ORDER.map(k => (
          <MetricChartCard key={k} metricKey={k} sessionToken={sessionToken} />
        ))}
      </div>

      {/* Add manual button */}
      <button
        onClick={() => setSheetOpen(true)}
        className="fixed bottom-20 right-4 z-30 rounded-full shadow-lg px-4 py-3 flex items-center gap-1 text-white font-medium text-sm"
        style={{ background: '#0097A7' }}
      >
        <span className="material-symbols-rounded text-base">add</span>
        Добавить
      </button>

      {loading && (
        <div className="text-xs text-gray-400 text-center py-4">Загрузка показателей…</div>
      )}
      {!loading && Object.keys(summary).length === 0 && (
        <div className="text-center py-8">
          <span className="material-symbols-rounded text-5xl text-gray-300">monitor_heart</span>
          <p className="text-sm text-gray-500 mt-2">Пока нет записей</p>
          <p className="text-xs text-gray-400 mt-1">Добавьте показатели вручную или через Apple Health</p>
        </div>
      )}

      <AddVitalSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onSubmit={submitManual}
      />
    </div>
  )
}
