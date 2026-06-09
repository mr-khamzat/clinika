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

const API = `${API_BASE}`

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

// ═════ БЛОК: METRIC_THEME — gradient-палитра по типу метрики ═════
// Каждая метрика имеет свой premium-gradient для иконки-чипа + sparkline accent.
// Логика: трактуем рост/падение каждой метрики так, чтобы стрелка показывала
// корректное «лучше/хуже» (например, рост веса — нейтрально, рост температуры — плохо).
const METRIC_THEME = {
  heart_rate:         { from: '#EC4899', to: '#BE185D', soft: 'rgba(236,72,153,0.12)', tint: '#EC4899', deltaBad: 'up' },
  blood_pressure_sys: { from: '#EF4444', to: '#DC2626', soft: 'rgba(239,68,68,0.12)',  tint: '#EF4444', deltaBad: 'up' },
  blood_pressure_dia: { from: '#EF4444', to: '#DC2626', soft: 'rgba(239,68,68,0.12)',  tint: '#EF4444', deltaBad: 'up' },
  spo2:               { from: '#06B6D4', to: '#0E7490', soft: 'rgba(6,182,212,0.12)',  tint: '#06B6D4', deltaBad: 'down' },
  glucose:            { from: '#A855F7', to: '#7C3AED', soft: 'rgba(168,85,247,0.12)', tint: '#A855F7', deltaBad: 'up' },
  weight_kg:          { from: '#3B82F6', to: '#1D4ED8', soft: 'rgba(59,130,246,0.12)', tint: '#3B82F6', deltaBad: 'neutral' },
  height_cm:          { from: '#0EA5E9', to: '#0369A1', soft: 'rgba(14,165,233,0.12)', tint: '#0EA5E9', deltaBad: 'neutral' },
  temperature:        { from: '#F97316', to: '#EA580C', soft: 'rgba(249,115,22,0.12)', tint: '#F97316', deltaBad: 'up' },
  steps:              { from: '#10B981', to: '#047857', soft: 'rgba(16,185,129,0.12)', tint: '#10B981', deltaBad: 'down' },
  sleep_minutes:      { from: '#6366F1', to: '#4338CA', soft: 'rgba(99,102,241,0.12)', tint: '#6366F1', deltaBad: 'down' },
  hrv:                { from: '#14B8A6', to: '#0F766E', soft: 'rgba(20,184,166,0.12)', tint: '#14B8A6', deltaBad: 'down' },
}

const DEFAULT_THEME = { from: '#0EA5E9', to: '#0369A1', soft: 'rgba(14,165,233,0.12)', tint: '#0EA5E9', deltaBad: 'neutral' }
const themeFor = (k) => METRIC_THEME[k] || DEFAULT_THEME

// Определяет цвет дельты по правилу метрики:
// deltaBad: 'up' → рост = плохо (red), падение = хорошо (green)
// deltaBad: 'down' → рост = хорошо (green), падение = плохо (red)
// deltaBad: 'neutral' → нейтральный gray-tone
function deltaSentiment(metricKey, delta) {
  if (delta == null || delta === 0) return 'neutral'
  const rule = themeFor(metricKey).deltaBad
  if (rule === 'neutral') return 'neutral'
  if (rule === 'up') return delta > 0 ? 'bad' : 'good'
  return delta > 0 ? 'good' : 'bad'
}

// Простой SVG-sparkline без зависимостей.
function Sparkline({ points, width = 280, height = 64, color = '#0097A7', fillColor = null }) {
  if (!points || points.length < 2) {
    return <div className="text-xs text-gray-400 dark:text-gray-500 italic py-6 text-center">Недостаточно данных</div>
  }
  const values = points.map(p => p.v).filter(v => v != null && !isNaN(v))
  if (values.length < 2) {
    return <div className="text-xs text-gray-400 dark:text-gray-500 italic py-6 text-center">Недостаточно данных</div>
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
      <path d={fillPath} fill={fillColor || color} fillOpacity={fillColor ? 1 : 0.12} />
      <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ═════ БЛОК: VitalsCard — премиум-карточка метрики с trend + sparkline ═════
// Большая gradient-иконка, крупное значение, цветной trend-arrow, мини-sparkline,
// дата последнего замера. Используется в основной сетке метрик кабинета.
function VitalsCard({ metricKey, data, sparkPoints, index = 0 }) {
  const meta = METRICS[metricKey]
  const theme = themeFor(metricKey)
  if (!meta) return null

  const value = data?.value
  const delta = data?.delta_week
  const sentiment = deltaSentiment(metricKey, delta)
  const arrow = delta == null || delta === 0 ? '—' : (delta > 0 ? '↑' : '↓')
  const deltaColor =
    sentiment === 'bad'  ? 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10'
  : sentiment === 'good' ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10'
                         : 'text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700/40'

  const measuredAt = data?.measured_at || data?.last_at
  const dateLabel = measuredAt
    ? new Date(measuredAt).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })
    : null

  return (
    <div
      className="vitals-card relative bg-white dark:bg-gray-800 rounded-2xl p-3 flex flex-col gap-2 min-w-0 overflow-hidden active:scale-[.97] transition-transform"
      style={{
        boxShadow: '0 4px 16px rgba(0,0,0,.06), inset 0 1px 0 rgba(255,255,255,.5)',
        animation: `vitalsPop .42s cubic-bezier(.22,.61,.36,1) both`,
        animationDelay: `${index * 0.05}s`,
      }}
    >
      {/* Декоративный gradient blob в углу */}
      <div
        className="absolute -top-8 -right-8 w-24 h-24 rounded-full opacity-[0.10] dark:opacity-[0.18] pointer-events-none"
        style={{ background: `radial-gradient(circle, ${theme.from} 0%, transparent 70%)` }}
      />

      {/* Иконка-чип с gradient */}
      <div className="flex items-start justify-between gap-2">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{
            background: `linear-gradient(135deg, ${theme.from} 0%, ${theme.to} 100%)`,
            boxShadow: `0 6px 14px -4px ${theme.from}55, inset 0 1px 0 rgba(255,255,255,.35)`,
          }}
        >
          <span
            className="material-symbols-outlined text-white"
            style={{ fontSize: 22, fontVariationSettings: "'FILL' 1" }}
          >
            {meta.icon}
          </span>
        </div>
        {delta != null && (
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full inline-flex items-center gap-0.5 ${deltaColor}`}>
            <span>{arrow}</span>
            <span>{Math.abs(Number(delta)).toFixed(1)}</span>
          </span>
        )}
      </div>

      {/* Название */}
      <div className="text-[12px] font-semibold text-gray-700 dark:text-gray-300 truncate leading-tight">
        {meta.label}
      </div>

      {/* Значение + единица */}
      <div className="flex items-baseline gap-1 leading-none">
        <span className="text-[26px] font-black text-gray-900 dark:text-gray-50 tracking-tight">
          {value != null ? meta.fmt(value) : '—'}
        </span>
        <span className="text-[11px] font-medium text-gray-400 dark:text-gray-500 truncate">
          {meta.unit}
        </span>
      </div>

      {/* Sparkline за неделю */}
      <div className="-mx-1">
        <MiniSparkline points={sparkPoints} color={theme.tint} fillColor={theme.soft} />
      </div>

      {/* Дата последнего замера */}
      <div className="flex items-center justify-between text-[10px] text-gray-400 dark:text-gray-500 -mt-1">
        <span>{dateLabel || 'нет данных'}</span>
        <span>неделя</span>
      </div>
    </div>
  )
}

// ═════ БЛОК: MiniSparkline — компактный SVG-график для VitalsCard ═════
function MiniSparkline({ points, color = '#0EA5E9', fillColor = 'rgba(14,165,233,0.12)' }) {
  const width = 120
  const height = 32
  const valid = (points || []).filter(p => p != null && p.v != null && !isNaN(p.v))
  if (valid.length < 2) {
    return (
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-8" preserveAspectRatio="none">
        <line x1="0" y1={height / 2} x2={width} y2={height / 2}
              stroke={color} strokeOpacity="0.25" strokeDasharray="3 3" strokeWidth="1.5" />
      </svg>
    )
  }
  const values = valid.map(p => p.v)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const stepX = width / (valid.length - 1)
  const coords = valid.map((p, i) => {
    const x = (i * stepX)
    const y = (height - ((p.v - min) / range) * (height - 6) - 3)
    return [x, y]
  })
  const path = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const lastX = coords[coords.length - 1][0].toFixed(1)
  const fillPath = `${path} L ${lastX} ${height} L 0 ${height} Z`
  const [lx, ly] = coords[coords.length - 1]
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-8" preserveAspectRatio="none">
      <path d={fillPath} fill={fillColor} />
      <path d={path} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx.toFixed(1)} cy={ly.toFixed(1)} r="2.2" fill={color} stroke="#fff" strokeWidth="1.2" />
    </svg>
  )
}

// ═════ БЛОК: MetricChartCard — premium widescreen-карточка с графиком за 30 дней ═════
function MetricChartCard({ metricKey, sessionToken, index = 0 }) {
  const meta = METRICS[metricKey]
  const theme = themeFor(metricKey)
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
    <div
      className="snap-start shrink-0 w-64 bg-white dark:bg-gray-800 rounded-2xl p-3.5 relative overflow-hidden active:scale-[.97] transition-transform"
      style={{
        boxShadow: '0 4px 16px rgba(0,0,0,.06), inset 0 1px 0 rgba(255,255,255,.5)',
        animation: `vitalsPop .42s cubic-bezier(.22,.61,.36,1) both`,
        animationDelay: `${index * 0.05}s`,
      }}
    >
      <div
        className="absolute -top-10 -right-10 w-28 h-28 rounded-full opacity-[0.10] dark:opacity-[0.18] pointer-events-none"
        style={{ background: `radial-gradient(circle, ${theme.from} 0%, transparent 70%)` }}
      />
      <div className="flex items-center gap-2 mb-2">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{
            background: `linear-gradient(135deg, ${theme.from} 0%, ${theme.to} 100%)`,
            boxShadow: `0 4px 10px -3px ${theme.from}55, inset 0 1px 0 rgba(255,255,255,.35)`,
          }}
        >
          <span
            className="material-symbols-outlined text-white"
            style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}
          >
            {meta.icon}
          </span>
        </div>
        <span className="text-[13px] font-semibold text-gray-700 dark:text-gray-200 truncate">{meta.label}</span>
      </div>
      <div className="flex items-baseline gap-1 mb-1">
        <span className="text-xl font-black text-gray-900 dark:text-gray-50 tracking-tight">
          {last != null ? meta.fmt(last) : '—'}
        </span>
        <span className="text-[11px] text-gray-400 dark:text-gray-500 font-medium">{meta.unit}</span>
      </div>
      {loading
        ? <div className="text-xs text-gray-400 dark:text-gray-500 py-6 text-center">Загрузка…</div>
        : <Sparkline points={points || []} color={theme.tint} fillColor={theme.soft} />}
      <div className="text-[10px] text-gray-400 dark:text-gray-500 text-right mt-1">за 30 дней</div>
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
        className="w-full bg-white dark:bg-gray-800 rounded-t-3xl p-4 pb-8 max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
        style={{ animation: 'slideUp 0.2s ease-out' }}
      >
        <div className="w-12 h-1.5 bg-gray-300 rounded-full mx-auto mb-3" />
        <h3 className="text-lg font-semibold mb-3 text-gray-900 dark:text-gray-100">Добавить запись</h3>

        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Показатель</label>
        <select
          value={metric}
          onChange={e => setMetric(e.target.value)}
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 mb-3 text-sm bg-gray-50 dark:bg-gray-700/30"
        >
          {ALL_ORDER.filter(k => k !== 'blood_pressure_dia').map(k => (
            <option key={k} value={k}>{METRICS[k].label}</option>
          ))}
        </select>

        {isBp ? (
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Систолическое</label>
              <input
                type="number" inputMode="numeric"
                value={value} onChange={e => setValue(e.target.value)}
                placeholder="120"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Диастолическое</label>
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
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Значение ({meta.unit})</label>
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
          className="w-full py-3 mt-2 rounded-xl text-gray-600 dark:text-gray-300 font-medium text-sm"
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
  const [availableSources, setAvailableSources] = useState([])
  const [loading, setLoading] = useState(true)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [syncStatus, setSyncStatus] = useState(null)
  // sparkPoints[metricKey] = массив точек за 7 дней (для премиум-карточек метрик)
  const [sparkPoints, setSparkPoints] = useState({})

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
      setAvailableSources(Array.isArray(r.data?.available_sources) ? r.data.available_sources : [])
    } catch (e) {
      // тихо — таб виден всем, даже без данных
    } finally {
      setLoading(false)
    }
  }, [sessionToken])

  useEffect(() => { reload() }, [reload])

  // ═════ БЛОК: загрузка sparkline-точек за 7 дней для каждой видимой метрики ═════
  useEffect(() => {
    if (!sessionToken) return
    const visibleKeys = Object.keys(summary).filter(
      k => k !== 'blood_pressure_dia' && summary[k]?.value != null
    )
    const keysToLoad = [...new Set([...KPI_ORDER, ...visibleKeys])]
    let cancelled = false
    Promise.all(
      keysToLoad.map(k =>
        axios.get(`${API}/patient/vitals/series`, {
          params: { metric: k, days: 7, session_token: sessionToken },
        })
          .then(r => [k, r.data?.points || []])
          .catch(() => [k, []])
      )
    ).then(results => {
      if (cancelled) return
      const next = {}
      results.forEach(([k, pts]) => { next[k] = pts })
      setSparkPoints(next)
    })
    return () => { cancelled = true }
  }, [sessionToken, summary])

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

  // Базовый набор + любые дополнительные метрики где у пациента есть данные
  const extraKeys = Object.keys(summary).filter(k =>
    !KPI_ORDER.includes(k) && k !== 'blood_pressure_dia' && summary[k]?.value != null
  )
  const visibleMetricKeys = [...KPI_ORDER, ...extraKeys]

  return (
    <div className="px-3 pt-3 pb-24">
      {/* ═════ БЛОК: keyframes для премиум-карточек VitalsTab ═════ */}
      <style>{`
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes vitalsPop {
          0%   { opacity: 0; transform: translateY(8px) scale(.96); }
          60%  { opacity: 1; transform: translateY(-1px) scale(1.01); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes vitalsFabPulse {
          0%, 100% { box-shadow: 0 10px 28px -8px rgba(0,151,167,.55), 0 4px 14px rgba(0,0,0,.10), inset 0 1px 0 rgba(255,255,255,.35); }
          50%      { box-shadow: 0 14px 36px -8px rgba(0,151,167,.75), 0 4px 14px rgba(0,0,0,.12), inset 0 1px 0 rgba(255,255,255,.35); }
        }
      `}</style>

      {/* ═════ БЛОК: сетка премиум-карточек метрик (2 cols mobile / 3 cols tablet) ═════ */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-5">
        {visibleMetricKeys.map((k, i) => (
          <VitalsCard
            key={k}
            metricKey={k}
            data={summary[k]}
            sparkPoints={sparkPoints[k]}
            index={i}
          />
        ))}
      </div>

      {/* ═════ БЛОК: Apple Health-карточка (premium glass) ═════ */}
      {availableSources.includes('apple') && isIOS && (
        <div
          className="relative overflow-hidden rounded-2xl p-4 mb-5 bg-white dark:bg-gray-800"
          style={{
            boxShadow: '0 4px 16px rgba(0,0,0,.06), inset 0 1px 0 rgba(255,255,255,.5)',
            animation: 'vitalsPop .42s cubic-bezier(.22,.61,.36,1) both',
          }}
        >
          <div
            className="absolute -top-12 -right-12 w-32 h-32 rounded-full opacity-[0.12] dark:opacity-[0.20] pointer-events-none"
            style={{ background: 'radial-gradient(circle, #FF3B30 0%, transparent 70%)' }}
          />
          <div className="flex items-center gap-2.5 mb-2">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{
                background: 'linear-gradient(135deg,#FF3B30 0%,#B91C1C 100%)',
                boxShadow: '0 6px 14px -4px rgba(255,59,48,.45), inset 0 1px 0 rgba(255,255,255,.35)',
              }}
            >
              <span className="material-symbols-outlined text-white" style={{ fontSize: 20, fontVariationSettings: "'FILL' 1" }}>favorite</span>
            </div>
            <span className="text-[15px] font-bold text-gray-900 dark:text-gray-50">Apple Health</span>
          </div>
          <p className="text-[12px] text-gray-500 dark:text-gray-400 mb-3 leading-relaxed">
            Синхронизируйте показатели с iPhone и Apple Watch.
          </p>
          <button
            onClick={handleAppleHealth}
            className="w-full py-2.5 rounded-xl text-white font-semibold text-[13px] active:scale-[.97] transition-transform"
            style={{
              background: 'linear-gradient(135deg,#1f2937 0%,#000 100%)',
              boxShadow: '0 6px 14px -4px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.18)',
            }}
          >
            Синхронизировать с Apple Health
          </button>
          {syncStatus && (
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-2 text-center">{syncStatus}</div>
          )}
        </div>
      )}

      {/* ═════ БЛОК: Графики 30-дней — горизонтальный snap-скролл ═════ */}
      <div className="flex items-center justify-between mb-2.5 px-1">
        <h3 className="text-[15px] font-bold text-gray-900 dark:text-gray-50 tracking-tight">Графики</h3>
        <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-400 dark:text-gray-500">30 дней</span>
      </div>
      <div className="flex gap-2.5 overflow-x-auto snap-x snap-mandatory -mx-3 px-3 pb-3 mb-4"
           style={{ scrollbarWidth: 'none' }}>
        {ALL_ORDER.map((k, i) => (
          <MetricChartCard key={k} metricKey={k} sessionToken={sessionToken} index={i} />
        ))}
      </div>

      {/* ═════ БЛОК: FAB — добавить запись вручную ═════ */}
      <button
        onClick={() => setSheetOpen(true)}
        className="fixed bottom-20 right-4 z-30 rounded-full px-4 py-3 flex items-center gap-1.5 text-white font-semibold text-sm active:scale-[.95] transition-transform"
        style={{
          background: 'linear-gradient(135deg,#06B6D4 0%,#0097A7 60%,#0E7490 100%)',
          animation: 'vitalsFabPulse 2.6s ease-in-out infinite',
        }}
      >
        <span className="material-symbols-outlined text-base" style={{ fontVariationSettings: "'FILL' 1" }}>add</span>
        Добавить
      </button>

      {loading && (
        <div className="text-xs text-gray-400 dark:text-gray-500 text-center py-4">Загрузка показателей…</div>
      )}
      {!loading && Object.keys(summary).length === 0 && (
        <div className="text-center py-10">
          <div
            className="w-16 h-16 rounded-2xl mx-auto mb-3 flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg,#EF4444 0%,#DC2626 100%)',
              boxShadow: '0 10px 24px -8px rgba(239,68,68,.45), inset 0 1px 0 rgba(255,255,255,.35)',
            }}
          >
            <span className="material-symbols-outlined text-white" style={{ fontSize: 32, fontVariationSettings: "'FILL' 1" }}>monitor_heart</span>
          </div>
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Пока нет записей</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Добавьте показатели вручную или через Apple Health</p>
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
