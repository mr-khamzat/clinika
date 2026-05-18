/**
 * AdsSection v3 — preview, stats chart, drag-and-drop, duplicate, schedule, color themes, CSV, report
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { API_BASE } from '../config'
import ImageCropEditor from './ImageCropEditor'
import { generateAdReport } from '../AdReport'

const API = API_BASE

function apiFetch(token, path, opts = {}) {
  return fetch(API + path, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  })
}

// ── JWT decoder (без верификации, только payload — нужен для роли) ──
function decodeJwt(token) {
  if (!token || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    return JSON.parse(atob(padded))
  } catch { return null }
}

// ── WCAG contrast helpers (нужно для ContrastChecker) ──
function relLum(hex) {
  const c = (hex || '').replace('#', '')
  if (c.length < 6) return 1
  const r = parseInt(c.substr(0, 2), 16) / 255
  const g = parseInt(c.substr(2, 2), 16) / 255
  const b = parseInt(c.substr(4, 2), 16) / 255
  const f = v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
function wcagContrast(a, b) {
  const la = relLum(a), lb = relLum(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

// Доминантный цвет фона темы (для контраста). Для градиентов берём первый цвет.
const THEME_BG_HEX = {
  '':        '#06b6d4',
  'violet':  '#8b5cf6',
  'rose':    '#fb7185',
  'emerald': '#34d399',
  'amber':   '#fbbf24',
  'blue':    '#3b82f6',
}

// Переменные для подстановки в тексте
const ALLOWED_VARS = [
  { key: 'patient_name',       label: 'Имя и фамилия пациента' },
  { key: 'patient_first_name', label: 'Имя пациента' },
  { key: 'branch_phone',       label: 'Телефон филиала' },
  { key: 'branch_address',     label: 'Адрес филиала' },
  { key: 'doctor_name',        label: 'Имя врача' },
  { key: 'clinic_name',        label: 'Название клиники' },
  { key: 'service_name',       label: 'Название услуги' },
  { key: 'city',               label: 'Город' },
]

// Категории объявлений (для TagsInput / селектора в форме)
const AD_CATEGORIES = [
  { value: '',         label: '— без категории —' },
  { value: 'promo',    label: 'Акция / Промо' },
  { value: 'doctor',   label: 'Врач' },
  { value: 'reminder', label: 'Напоминание' },
  { value: 'review',   label: 'Отзыв / Рекомендация' },
  { value: 'other',    label: 'Прочее' },
]

// Цвета для multi-line чарта в CompareModal
const COMPARE_COLORS = ['#0097A7', '#7c3aed', '#d97706', '#22c55e', '#ef4444', '#a855f7', '#06b6d4', '#f59e0b']

const STATUS_LABELS = { draft: 'Черновик', active: 'Активно', paused: 'Пауза', completed: 'Завершено', cancelled: 'Отменено' }
const STATUS_COLORS = {
  draft:     'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  active:    'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
  paused:    'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  completed: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-400',
  cancelled: 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400',
}

const DURATION_PRESETS = [
  { label: '1 день', days: 1 }, { label: '3 дня', days: 3 }, { label: '7 дней', days: 7 },
  { label: '14 дней', days: 14 }, { label: '30 дней', days: 30 },
]

const COLOR_THEMES = [
  { id: '',        label: 'Циан',       grad: 'linear-gradient(135deg,#06b6d4,#0d9488)' },
  { id: 'violet',  label: 'Фиолетовый', grad: 'linear-gradient(135deg,#8b5cf6,#9333ea)' },
  { id: 'rose',    label: 'Розовый',    grad: 'linear-gradient(135deg,#fb7185,#db2777)' },
  { id: 'emerald', label: 'Зелёный',    grad: 'linear-gradient(135deg,#34d399,#16a34a)' },
  { id: 'amber',   label: 'Оранжевый',  grad: 'linear-gradient(135deg,#fbbf24,#ea580c)' },
  { id: 'blue',    label: 'Синий',      grad: 'linear-gradient(135deg,#3b82f6,#4f46e5)' },
]

const DAYS_OF_WEEK = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

function addDays(from, n) {
  const d = new Date(from); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10)
}
function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000) }

function Badge({ status }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[status] || 'bg-gray-100 text-gray-600'}`}>{STATUS_LABELS[status] || status}</span>
}

function StatCard({ label, value, icon, colorClass, sub }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700 flex items-center gap-3">
      <span className={`material-symbols-outlined text-3xl ${colorClass}`} style={{ fontVariationSettings: "'FILL' 1" }}>{icon}</span>
      <div>
        <div className="text-xl font-bold text-gray-900 dark:text-white">{value}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
        {sub && <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{sub}</div>}
      </div>
    </div>
  )
}

function ProgressBar({ value, max, colorClass }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div className="mt-1">
      <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
        <span>{value.toLocaleString('ru')} / {max.toLocaleString('ru')}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full">
        <div className={`h-full rounded-full transition-all ${colorClass}`} style={{ width: pct + '%' }} />
      </div>
    </div>
  )
}

// Modal OUTSIDE AdsSection to prevent re-mount on every render (fixes input focus loss)
function Modal({ title, onClose, children, wide = false }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full ${wide ? 'max-w-5xl' : 'max-w-xl'} max-h-[94vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-6 pb-4 border-b border-gray-100 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-800 z-10">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition text-xl leading-none">✕</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}

// ── Live-превью баннера (рендерится прямо в форме, обновляется в realtime) ──
function LivePreview({ form }) {
  const theme = COLOR_THEMES.find(t => t.id === (form.color_theme || '')) || COLOR_THEMES[0]
  const ctaStyles = {
    primary: { bg: 'rgba(255,255,255,0.95)', color: '#0e7490' },
    outline: { bg: 'transparent', color: '#fff', border: '1.5px solid rgba(255,255,255,0.7)' },
    ghost:   { bg: 'rgba(255,255,255,0.18)', color: '#fff' },
  }
  const ctaSty = ctaStyles[form.cta_style] || ctaStyles.primary
  // Контраст: текст белый на фоне темы
  const bgHex = THEME_BG_HEX[form.color_theme || ''] || '#06b6d4'
  const ratio = wcagContrast('#ffffff', bgHex)
  return (
    <div className="sticky top-[80px]">
      <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1.5">
        <span className="material-symbols-outlined text-sm">visibility</span>
        Live-превью
      </div>
      <div className="bg-gray-900 rounded-[34px] p-3 shadow-2xl border-4 border-gray-700 mx-auto" style={{ width: 280 }}>
        <div className="flex justify-between items-center px-2 mb-2 text-white/40 text-[9px]">
          <span>9:41</span>
          <div className="flex gap-1 items-center"><span>●●●</span><span>WiFi</span><span>🔋</span></div>
        </div>
        <div className="bg-white rounded-[20px] overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-cyan-100 flex items-center justify-center text-[10px] font-bold text-cyan-600">К</div>
            <div>
              <div className="text-[11px] font-semibold text-gray-800">Личный кабинет</div>
              <div className="text-[9px] text-gray-400">Клиника</div>
            </div>
          </div>
          <div className="p-2.5">
            <div className="rounded-xl overflow-hidden relative" style={{ background: theme.grad, boxShadow: '0 4px 14px rgba(0,0,0,0.10)' }}>
              {form.image_data ? (
                <img
                  src={'data:' + (form.image_mime || 'image/png') + ';base64,' + form.image_data}
                  alt="preview"
                  style={{ height: Math.min(Number(form.banner_height) || 96, 120), width: '100%', objectFit: 'cover', display: 'block' }} />
              ) : form.image_url ? (
                <img
                  src={form.image_url}
                  alt="preview"
                  style={{ height: Math.min(Number(form.banner_height) || 96, 120), width: '100%', objectFit: 'cover', display: 'block' }} />
              ) : (
                <div style={{ height: Math.min(Number(form.banner_height) || 96, 120) }} />
              )}
              <div className="px-3 py-2.5 text-white">
                <div className="text-[11px] font-bold leading-tight" style={{ textShadow: '0 1px 2px rgba(0,0,0,.3)' }}>
                  {form.title || 'Заголовок объявления'}
                </div>
                {form.body && (
                  <div className="text-[9px] mt-1 text-white/85 leading-snug" style={{ textShadow: '0 1px 1px rgba(0,0,0,.25)' }}>
                    {form.body.slice(0, 90)}{form.body.length > 90 ? '…' : ''}
                  </div>
                )}
                {form.cta_text && (
                  <div className="mt-2">
                    <span className="inline-block text-[10px] font-bold px-3 py-1 rounded-full"
                      style={{ background: ctaSty.bg, color: ctaSty.color, border: ctaSty.border || 'none' }}>
                      {form.cta_text} →
                    </span>
                  </div>
                )}
              </div>
              <span className="absolute top-1.5 right-1.5 text-white/70 text-[8px] bg-black/30 px-1 rounded">РЕКЛАМА</span>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-2 text-[10px] text-gray-500 text-center">
        Обновляется в реальном времени
      </div>
      {ratio < 4.5 && (
        <div className="mt-2 text-[10px] bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 rounded-lg px-2 py-1.5">
          ⚠️ Контраст текста {ratio.toFixed(1)} — рекомендуется ≥ 4.5 (WCAG AA). Текст может быть плохо читаем на этой теме.
        </div>
      )}
    </div>
  )
}

// ── Счётчик символов с подсказками ──
function CharCount({ text, hint }) {
  const len = (text || '').length
  let color = 'text-gray-400'
  let label = 'идеально'
  if (len === 0) { color = 'text-gray-400'; label = '' }
  else if (len < hint.ideal_min) { color = 'text-amber-500'; label = `коротко (идеально ${hint.ideal_min}-${hint.ideal_max})` }
  else if (len <= hint.ideal_max) { color = 'text-emerald-600'; label = '✓ идеальная длина' }
  else if (len <= hint.hard) { color = 'text-amber-500'; label = `длинновато (идеально ${hint.ideal_min}-${hint.ideal_max})` }
  else { color = 'text-red-500'; label = 'слишком длинно' }
  return (
    <div className={`text-[10px] mt-1 flex justify-between items-center ${color}`}>
      <span>{label}</span>
      <span>{len} / {hint.hard}</span>
    </div>
  )
}

// ── Эмодзи-пикер ──
function EmojiPicker({ onPick }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative inline-block">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="text-base px-2 py-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition border border-gray-300 dark:border-gray-600 leading-none"
        title="Вставить эмодзи">
        😊
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg p-2 w-[260px] grid grid-cols-9 gap-0.5">
            {EMOJI_LIBRARY.map((e, i) => (
              <button type="button" key={i} onClick={() => { onPick(e); setOpen(false) }}
                className="text-xl hover:bg-gray-100 dark:hover:bg-gray-700 rounded p-1 transition">
                {e}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── WYSIWYG mini-toolbar (применяет inline-форматирование к textarea) ──
function FormatToolbar({ value, onChange, textareaRef }) {
  const wrap = (before, after = before) => {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const sel = value.slice(start, end) || 'текст'
    const newVal = value.slice(0, start) + before + sel + after + value.slice(end)
    onChange(newVal)
    setTimeout(() => {
      ta.focus()
      ta.selectionStart = start + before.length
      ta.selectionEnd = start + before.length + sel.length
    }, 0)
  }
  // Вставить переменную в позицию курсора
  const insertVar = (token) => {
    const ta = textareaRef.current
    if (!ta) { onChange((value || '') + token); return }
    const start = ta.selectionStart ?? value.length
    const end = ta.selectionEnd ?? value.length
    const newVal = value.slice(0, start) + token + value.slice(end)
    onChange(newVal)
    setTimeout(() => {
      ta.focus()
      ta.selectionStart = ta.selectionEnd = start + token.length
    }, 0)
  }
  return (
    <div className="inline-flex gap-1 ml-2 align-middle items-center">
      <button type="button" onClick={() => wrap('**')} title="Жирный"
        className="px-2 py-0.5 rounded text-[11px] font-bold border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition">
        B
      </button>
      <button type="button" onClick={() => wrap('_')} title="Курсив"
        className="px-2 py-0.5 rounded text-[11px] italic border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition">
        i
      </button>
      <button type="button" onClick={() => wrap('• ', '')} title="Маркер списка"
        className="px-2 py-0.5 rounded text-[11px] border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition">
        •
      </button>
      <VariablePicker onPick={insertVar} />
    </div>
  )
}

const inputCls = 'block w-full mt-1.5 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500 box-border'
const labelCls = 'text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide'

// Стандартный days_config для ScheduleEditorV2 — 7 дней, по умолчанию все включены 0-23
function defaultDaysConfig() {
  return Array.from({ length: 7 }, (_, i) => ({ day: i, hour_from: 9, hour_to: 21, enabled: false }))
}

const EMPTY_FORM = {
  title: '', body: '', image_data: null, image_mime: null, image_url: '', image_author: '', image_author_url: '',
  banner_height: '96',
  interval_seconds: '5', link: '', ad_type: 'banner', pricing_model: 'flat',
  start_date: new Date().toISOString().slice(0, 10),
  end_date: addDays(new Date().toISOString().slice(0, 10), 7),
  price: '0', impressions_limit: '', clicks_limit: '',
  sort_order: '0', color_theme: '',
  // Legacy schedule fields (всё ещё поддерживаем для обратной совместимости)
  schedule_hours_start: '', schedule_hours_end: '', schedule_days: [],
  // ScheduleEditorV2
  schedule: { days_config: defaultDaysConfig(), skip_holidays: false, country: 'RU' },
  // Pro (adspro01)
  budget_total: '', freq_per_day: '', freq_per_hour: '',
  auto_pause_idle_days: '7', attribution_window_days: '7',
  audience: { gender: '', age_min: '', age_max: '', city: '', ltv_min: '' },
  cta_text: '', cta_style: 'primary',
  is_template: false,
  // Phase D
  tags: [], category: '',
}

// CTA presets — частые в медицинских объявлениях
const CTA_PRESETS = [
  '', 'Записаться', 'Подробнее', 'Получить скидку', 'Узнать цену',
  'Записаться онлайн', 'Заказать звонок', 'Бесплатная консультация',
  'Акция действует', 'Связаться',
]

// Популярные эмодзи для медицинских клиник
const EMOJI_LIBRARY = [
  '🩺','💉','🏥','💊','🦷','👶','🧬','🦴','❤️','🩸','🫀','🫁','🧠',
  '🎁','⏰','🔥','✨','⚡','💎','🌟','🏆','✅','📞','📅','💯','🎯',
  '👨‍⚕️','👩‍⚕️','💆','🤰','👁','👃','👄','🦵','🦶',
]

// Лимиты для подсказок длины
const TITLE_HINT = { ideal_min: 30, ideal_max: 50, hard: 200 }
const BODY_HINT  = { ideal_min: 60, ideal_max: 120, hard: 300 }

function BannerPreview({ ad, onClose }) {
  const theme = COLOR_THEMES.find(t => t.id === (ad.color_theme || '')) || COLOR_THEMES[0]
  return (
    <div className="fixed inset-0 bg-black/80 z-[600] flex items-center justify-center p-4" onClick={onClose}>
      <div className="relative" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute -top-10 right-0 text-white/70 hover:text-white text-xl">✕</button>
        <div className="w-[320px] bg-gray-900 rounded-[40px] p-4 shadow-2xl border-4 border-gray-700">
          <div className="flex justify-between items-center px-2 mb-3 text-white/50 text-[10px]">
            <span>9:41</span>
            <div className="flex gap-1 items-center"><span>●●●</span><span>WiFi</span><span>🔋</span></div>
          </div>
          <div className="bg-white rounded-[24px] overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-cyan-100 flex items-center justify-center text-xs font-bold text-cyan-600">К</div>
              <div>
                <div className="text-xs font-semibold text-gray-800">Личный кабинет</div>
                <div className="text-[10px] text-gray-400">Клиника</div>
              </div>
            </div>
            <div style={{
              background: theme.grad,
              height: Math.min((ad.banner_height || 96), 120) + 'px',
              padding: '10px 14px', display: 'flex', flexDirection: 'column',
              justifyContent: 'center', position: 'relative', overflow: 'hidden',
            }}>
              {ad.image_data && (
                <img src={'data:' + (ad.image_mime || 'image/png') + ';base64,' + ad.image_data}
                  alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
              )}
              <div style={{ position: 'relative', zIndex: 1 }}>
                <div style={{ color: 'white', fontWeight: 700, fontSize: 13, lineHeight: 1.3, textShadow: '0 1px 3px rgba(0,0,0,.4)' }}>{ad.title || 'Заголовок баннера'}</div>
                {ad.body && <div style={{ color: 'rgba(255,255,255,.8)', fontSize: 10, marginTop: 2 }}>{ad.body}</div>}
              </div>
            </div>
            <div className="p-3 space-y-2">
              {[1,2,3].map(i => <div key={i} className="h-8 bg-gray-100 rounded-lg" />)}
            </div>
          </div>
          <div className="flex justify-center mt-3"><div className="w-20 h-1 bg-white/30 rounded-full" /></div>
        </div>
        <div className="text-center text-white/50 text-xs mt-3">Предпросмотр в мобильном</div>
      </div>
    </div>
  )
}

function MiniChart({ series, keys, colors, height = 130 }) {
  if (!series || series.length === 0) return <div className="text-center text-gray-400 text-xs py-4">Нет данных</div>
  const maxVal = Math.max(...series.flatMap(d => keys.map(k => d[k] || 0)), 1)
  const W = 560, H = height, pad = { top: 10, right: 10, bottom: 24, left: 40 }
  const IW = W - pad.left - pad.right, IH = H - pad.top - pad.bottom
  const n = series.length
  const x = i => pad.left + (i / Math.max(n - 1, 1)) * IW
  const y = v => pad.top + IH - (v / maxVal) * IH
  const step = Math.max(1, Math.floor(n / 7))
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ overflow: 'visible' }}>
      {[0, 0.5, 1].map((f, fi) => {
        const yv = pad.top + IH - f * IH
        return <g key={fi}>
          <line x1={pad.left} y1={yv} x2={pad.left + IW} y2={yv} stroke="#e5e7eb" strokeWidth="1" />
          <text x={pad.left - 4} y={yv + 4} textAnchor="end" fontSize="9" fill="#9ca3af">{Math.round(f * maxVal)}</text>
        </g>
      })}
      {series.map((d, i) => i % step === 0 ? (
        <text key={i} x={x(i)} y={pad.top + IH + 14} textAnchor="middle" fontSize="9" fill="#9ca3af">{d.date?.slice(5)}</text>
      ) : null)}
      {keys.map((k, ki) => {
        const pts = series.map((d, i) => `${x(i)},${y(d[k] || 0)}`).join(' ')
        const area = `${pts} ${x(n-1)},${pad.top+IH} ${x(0)},${pad.top+IH}`
        return <g key={k}>
          <polygon points={area} fill={colors[ki]} fillOpacity="0.12" />
          <polyline points={pts} fill="none" stroke={colors[ki]} strokeWidth="2" strokeLinejoin="round" />
          <circle cx={x(n-1)} cy={y(series[n-1][k]||0)} r="3.5" fill={colors[ki]} stroke="white" strokeWidth="1.5" />
        </g>
      })}
      <line x1={pad.left} y1={pad.top} x2={pad.left} y2={pad.top+IH} stroke="#e5e7eb" />
      <line x1={pad.left} y1={pad.top+IH} x2={pad.left+IW} y2={pad.top+IH} stroke="#e5e7eb" />
    </svg>
  )
}

// ── Вкладки для StatsModal ──
function StatsTabBar({ value, onChange }) {
  const tabs = [
    { id: 'overview', label: 'Общее',     icon: 'analytics' },
    { id: 'funnel',   label: 'Воронка',   icon: 'filter_alt' },
    { id: 'heatmap',  label: 'Heatmap',   icon: 'calendar_view_month' },
    { id: 'conv',     label: 'Конверсии', icon: 'flag' },
    { id: 'forecast', label: 'Прогноз',   icon: 'trending_up' },
  ]
  return (
    <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 mb-4 overflow-x-auto">
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 transition whitespace-nowrap ${value === t.id ? 'border-cyan-600 text-cyan-700 dark:text-cyan-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
          <span className="material-symbols-outlined text-base">{t.icon}</span>
          {t.label}
        </button>
      ))}
    </div>
  )
}

function StatsTabOverview({ stats }) {
  if (!stats) return <div className="text-center py-12 text-red-400">Нет данных</div>
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Показов',   value: stats.totals.impressions, color: 'text-cyan-600 dark:text-cyan-400' },
          { label: 'Кликов',    value: stats.totals.clicks,      color: 'text-violet-600 dark:text-violet-400' },
          { label: 'Конверсий', value: stats.totals.conversions, color: 'text-amber-600 dark:text-amber-400' },
          { label: 'CTR',       value: stats.totals.ctr + '%',   color: 'text-red-500 dark:text-red-400' },
        ].map(k => (
          <div key={k.label} className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3 text-center">
            <div className={`text-2xl font-bold ${k.color}`}>{typeof k.value === 'number' ? k.value.toLocaleString('ru') : k.value}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{k.label}</div>
          </div>
        ))}
      </div>
      <div className="bg-gray-50 dark:bg-gray-700/30 rounded-xl p-4">
        <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-2">Показы и клики по дням</div>
        <div className="flex gap-4 mb-3">
          {[['#0097A7','Показы'],['#7c3aed','Клики']].map(([c,l]) => (
            <div key={l} className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
              <div className="w-3 h-3 rounded-full" style={{ background: c }} />{l}
            </div>
          ))}
        </div>
        <MiniChart series={stats.series} keys={['impressions','clicks']} colors={['#0097A7','#7c3aed']} height={130} />
      </div>
      {stats.totals.conversions > 0 && (
        <div className="bg-gray-50 dark:bg-gray-700/30 rounded-xl p-4">
          <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-3">Конверсии по дням</div>
          <MiniChart series={stats.series} keys={['conversions']} colors={['#d97706']} height={90} />
        </div>
      )}
    </div>
  )
}

function StatsTabFunnel({ ad, token, days }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    setLoading(true)
    apiFetch(token, `/ads/${ad.id}/funnel?days=${days}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [ad.id, days, token])
  if (loading) return <div className="text-center py-12 text-gray-400">Загрузка...</div>
  if (!data) return <div className="text-center py-12 text-red-400">Ошибка загрузки</div>
  const stageColors = ['#0097A7', '#7c3aed', '#d97706', '#22c55e']
  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_240px] gap-5">
      <div>
        <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-3">Воронка событий</div>
        <div className="space-y-2">
          {(data.stages || []).map((st, i) => {
            const colorBg = stageColors[i % stageColors.length]
            return (
              <div key={st.key}>
                <div className="flex items-center justify-between mb-1">
                  <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">{st.label}</div>
                  <div className="text-sm font-bold tabular-nums" style={{ color: colorBg }}>{(st.value || 0).toLocaleString('ru')}</div>
                </div>
                <div className="h-9 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-700/40 relative">
                  <div className="h-full rounded-lg flex items-center pl-3 text-white text-xs font-semibold"
                    style={{
                      width: ((data.stages[0]?.value || 1) > 0 ? Math.max(8, (st.value || 0) / data.stages[0].value * 100) : 8) + '%',
                      background: `linear-gradient(90deg, ${colorBg}, ${colorBg}cc)`
                    }}>
                    {(st.value || 0).toLocaleString('ru')}
                  </div>
                </div>
                {i < data.stages.length - 1 && st.rate_from_prev != null && (
                  <div className="text-center my-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                    ↓ {((st.rate_from_prev || 0) * 100).toFixed(1)}%
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <div className="space-y-2">
        <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-3 border border-emerald-200 dark:border-emerald-800">
          <div className="text-[10px] uppercase font-semibold text-emerald-700 dark:text-emerald-400 tracking-wide">Выручка</div>
          <div className="text-xl font-bold text-emerald-700 dark:text-emerald-300 mt-1">{Number(data.revenue || 0).toLocaleString('ru')} ₽</div>
        </div>
        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3 border border-amber-200 dark:border-amber-800">
          <div className="text-[10px] uppercase font-semibold text-amber-700 dark:text-amber-400 tracking-wide">CPA (стоимость конверсии)</div>
          <div className="text-xl font-bold text-amber-700 dark:text-amber-300 mt-1">{data.cpa != null ? Number(data.cpa).toLocaleString('ru') + ' ₽' : '—'}</div>
        </div>
        <div className="bg-violet-50 dark:bg-violet-900/20 rounded-xl p-3 border border-violet-200 dark:border-violet-800">
          <div className="text-[10px] uppercase font-semibold text-violet-700 dark:text-violet-400 tracking-wide">ROAS (ROI рекламы)</div>
          <div className="text-xl font-bold text-violet-700 dark:text-violet-300 mt-1">{data.roas != null ? Number(data.roas).toFixed(2) + 'x' : '—'}</div>
        </div>
      </div>
    </div>
  )
}

function StatsTabHeatmap({ ad, token, days }) {
  const [eventType, setEventType] = useState('click')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    setLoading(true)
    apiFetch(token, `/ads/${ad.id}/heatmap?event_type=${eventType}&days=${days}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [ad.id, days, eventType, token])
  // Грид 7×24
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0))
  let maxVal = 1
  if (data?.cells) {
    for (const c of data.cells) {
      if (c.day >= 0 && c.day < 7 && c.hour >= 0 && c.hour < 24) {
        grid[c.day][c.hour] = c.count
        if (c.count > maxVal) maxVal = c.count
      }
    }
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">Тип события:</div>
        {[['impression','Показы'],['click','Клики'],['conversion','Конверсии']].map(([v, l]) => (
          <button key={v} onClick={() => setEventType(v)}
            className={`px-3 py-1 rounded-full text-xs font-semibold border transition ${eventType === v ? 'bg-cyan-600 border-cyan-600 text-white' : 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300'}`}>
            {l}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="text-center py-12 text-gray-400">Загрузка...</div>
      ) : (
        <div className="overflow-x-auto">
          <div className="inline-block min-w-full">
            <div className="flex">
              <div className="w-10" />
              <div className="flex-1 grid gap-px text-[9px] text-gray-400 mb-1" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="text-center">{h % 3 === 0 ? h : ''}</div>
                ))}
              </div>
            </div>
            {DAYS_OF_WEEK.map((label, d) => (
              <div key={d} className="flex items-center mb-px">
                <div className="w-10 text-xs font-semibold text-gray-500 dark:text-gray-400">{label}</div>
                <div className="flex-1 grid gap-px" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
                  {grid[d].map((count, h) => {
                    const intensity = count / maxVal
                    return (
                      <div key={h} title={`${label} ${h}:00 — ${count}`}
                        className="h-5 rounded-sm border border-gray-100 dark:border-gray-700/40"
                        style={{ backgroundColor: count > 0 ? `rgba(124, 58, 237, ${0.15 + intensity * 0.85})` : 'rgba(124, 58, 237, 0.04)' }} />
                    )
                  })}
                </div>
              </div>
            ))}
            <div className="flex items-center gap-1 mt-3 text-[10px] text-gray-500">
              <span>Мало</span>
              {[0.1, 0.3, 0.5, 0.7, 0.95].map(v => (
                <div key={v} className="w-4 h-3 rounded-sm" style={{ backgroundColor: `rgba(124, 58, 237, ${v})` }} />
              ))}
              <span>Много (макс: {maxVal})</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StatsTabConversions({ ad, token }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    setLoading(true)
    apiFetch(token, `/ads/${ad.id}/conversions?limit=50`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [ad.id, token])
  if (loading) return <div className="text-center py-12 text-gray-400">Загрузка...</div>
  if (!data || !data.items || data.items.length === 0) {
    return <div className="text-center py-12 text-gray-400">Пока нет конверсий</div>
  }
  return (
    <div>
      <div className="text-xs text-gray-500 mb-3">Всего конверсий за период: <span className="font-bold text-gray-700 dark:text-gray-300">{data.count}</span></div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700 text-xs text-gray-500 uppercase">
              <th className="text-left py-2 pr-2">Дата</th>
              <th className="text-left py-2 pr-2">Пациент</th>
              <th className="text-left py-2 pr-2">Услуга</th>
              <th className="text-right py-2 pr-2">Выручка</th>
              <th className="text-right py-2">Дней до конв.</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map(it => (
              <tr key={it.event_id} className="border-b border-gray-100 dark:border-gray-800">
                <td className="py-2 pr-2 text-xs text-gray-500">{(it.created_at || '').slice(0, 16).replace('T', ' ')}</td>
                <td className="py-2 pr-2 text-gray-800 dark:text-gray-200">{it.patient || '—'}</td>
                <td className="py-2 pr-2 text-gray-700 dark:text-gray-300">{it.service || '—'}</td>
                <td className="py-2 pr-2 text-right font-semibold text-emerald-600 dark:text-emerald-400">{Number(it.revenue || 0).toLocaleString('ru')} ₽</td>
                <td className="py-2 text-right text-gray-500">{it.days_to_convert != null ? it.days_to_convert + ' дн.' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StatsTabForecast({ ad, token }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    setLoading(true)
    apiFetch(token, `/ads/${ad.id}/forecast`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [ad.id, token])
  if (loading) return <div className="text-center py-12 text-gray-400">Загрузка...</div>
  if (!data) return <div className="text-center py-12 text-red-400">Ошибка загрузки</div>
  const banner = {
    ok:                  { cls: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 text-emerald-800 dark:text-emerald-200', icon: '✅', text: 'Бюджет расходуется в нормальном темпе' },
    budget_exhausting:   { cls: 'bg-red-50 dark:bg-red-900/20 border-red-300 text-red-800 dark:text-red-200',          icon: '🔥', text: 'Бюджет кончится раньше срока — реклама встанет на паузу' },
    budget_underspent:   { cls: 'bg-amber-50 dark:bg-amber-900/20 border-amber-300 text-amber-800 dark:text-amber-200', icon: '⚠️', text: 'Бюджет недозатрачен — попробуйте поднять ставку или расширить аудиторию' },
  }
  const b = banner[data.verdict] || banner.ok
  return (
    <div className="space-y-4">
      <div className={`rounded-xl px-4 py-3 border ${b.cls} flex items-center gap-3`}>
        <span className="text-2xl">{b.icon}</span>
        <div className="text-sm font-semibold">{b.text}</div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Дней до конца бюджета',    value: data.days_left_budget != null ? data.days_left_budget + ' дн.' : '∞',                  color: 'text-red-600 dark:text-red-400' },
          { label: 'Дней до конца кампании',   value: data.days_left_calendar != null ? data.days_left_calendar + ' дн.' : '—',              color: 'text-cyan-600 dark:text-cyan-400' },
          { label: 'Расход / день (средний)',  value: Number(data.spend_per_day_avg || 0).toLocaleString('ru') + ' ₽',                       color: 'text-violet-600 dark:text-violet-400' },
          { label: 'Кликов / день (средний)',  value: Number(data.clk_per_day_avg || 0).toLocaleString('ru', { maximumFractionDigits: 1 }),  color: 'text-amber-600 dark:text-amber-400' },
        ].map(k => (
          <div key={k.label} className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3">
            <div className={`text-2xl font-bold ${k.color}`}>{k.value}</div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{k.label}</div>
          </div>
        ))}
      </div>
      <div className="bg-gray-50 dark:bg-gray-700/30 rounded-xl p-3 text-xs text-gray-600 dark:text-gray-400">
        Показы / день (средний): <span className="font-bold">{Number(data.imp_per_day_avg || 0).toLocaleString('ru')}</span>
      </div>
    </div>
  )
}

function StatsModal({ ad, token, onClose }) {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(30)
  const [tab, setTab] = useState('overview')
  const [reporting, setReporting] = useState(false)

  useEffect(() => {
    setLoading(true)
    apiFetch(token, `/ads/${ad.id}/stats?days=${days}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { setStats(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [ad.id, days, token])

  const openReport = async () => {
    setReporting(true)
    try {
      const r = await apiFetch(token, `/ads/${ad.id}/stats?days=${days}`)
      if (r.ok) generateAdReport(ad, await r.json())
    } catch {}
    setReporting(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[94vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 pb-4 border-b border-gray-100 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-800 z-10">
          <div>
            <h3 className="text-base font-bold text-gray-900 dark:text-white">Статистика</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate max-w-md">{ad.title}</p>
          </div>
          <div className="flex items-center gap-2">
            <select value={days} onChange={e => setDays(Number(e.target.value))}
              className="text-xs border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300">
              {[7,14,30,60,90].map(d => <option key={d} value={d}>{d} дней</option>)}
            </select>
            <button onClick={openReport} disabled={reporting || !stats}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-semibold rounded-lg transition disabled:opacity-50">
              <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>description</span>
              {reporting ? 'Генерация...' : 'Отчёт PDF'}
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none ml-1">✕</button>
          </div>
        </div>
        <div className="p-5">
          <StatsTabBar value={tab} onChange={setTab} />
          {tab === 'overview' && (loading ? <div className="text-center py-12 text-gray-400">Загрузка...</div> : <StatsTabOverview stats={stats} />)}
          {tab === 'funnel'   && <StatsTabFunnel    ad={ad} token={token} days={days} />}
          {tab === 'heatmap'  && <StatsTabHeatmap   ad={ad} token={token} days={days} />}
          {tab === 'conv'     && <StatsTabConversions ad={ad} token={token} />}
          {tab === 'forecast' && <StatsTabForecast  ad={ad} token={token} />}
        </div>
      </div>
    </div>
  )
}


// ── AI-генерация заголовков/описаний (Anthropic Claude через backend /ads/ai-generate) ──
function AiSuggestButton({ kind, form, set }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [variants, setVariants] = useState([])
  const [err, setErr] = useState('')

  const ctx = (form.title || form.audience?.city || form.body || 'медицинская клиника').slice(0, 200)

  const gen = async () => {
    setBusy(true); setErr('')
    try {
      const tk = localStorage.getItem('clinika_token_' + (window.location.pathname.split('/')[1] || ''))
      const r = await fetch(API + '/ads/ai-generate', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: ctx, kind, count: 5 }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        setErr(d.detail || 'Ошибка генерации')
      } else {
        const d = await r.json()
        setVariants(d.variants || [])
        setOpen(true)
      }
    } catch (e) { setErr('Сетевая ошибка') }
    setBusy(false)
  }

  return (
    <>
      <button type="button" onClick={gen} disabled={busy}
        className="text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/30 hover:bg-violet-100 dark:hover:bg-violet-900/50 px-2 py-0.5 rounded-md border border-violet-200 dark:border-violet-700 disabled:opacity-50 inline-flex items-center gap-1">
        <span className="material-symbols-outlined text-xs" style={{ fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
        {busy ? '…' : 'AI'}
      </button>
      {err && <div className="text-[10px] text-red-500 mt-1">{err}</div>}
      {open && variants.length > 0 && (
        <div className="fixed inset-0 bg-black/50 z-[700] flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-md w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-200 dark:border-gray-700">
              <div className="font-bold text-gray-900 dark:text-white">AI-варианты {kind === 'title' ? 'заголовка' : 'описания'}</div>
              <div className="text-xs text-gray-500 mt-1">Выберите один — он подставится в поле</div>
            </div>
            <div className="p-3 space-y-2">
              {variants.map((v, i) => (
                <button type="button" key={i}
                  onClick={() => { set(kind, v); setOpen(false) }}
                  className="w-full text-left px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 hover:border-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition text-sm text-gray-800 dark:text-gray-200">
                  {v}
                </button>
              ))}
            </div>
            <div className="p-3 border-t border-gray-200 dark:border-gray-700 flex justify-end">
              <button type="button" onClick={() => setOpen(false)} className="text-sm text-gray-500 hover:text-gray-700">Закрыть</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── ScheduleEditorV2: 7 строк дней, hour_from/hour_to, skip_holidays ──
function ScheduleEditorV2({ schedule, onChange }) {
  const cfg = schedule?.days_config || defaultDaysConfig()
  const skipHolidays = !!schedule?.skip_holidays
  const updateDay = (idx, patch) => {
    const next = cfg.map((d, i) => i === idx ? { ...d, ...patch } : d)
    onChange({ ...schedule, days_config: next, country: schedule?.country || 'RU' })
  }
  // Активно ли сейчас (по локальному времени)
  const now = new Date()
  const jsDay = now.getDay()                       // 0=вс
  const todayIdx = jsDay === 0 ? 6 : jsDay - 1     // → 0=пн..6=вс
  const hr = now.getHours()
  const todayCfg = cfg[todayIdx]
  const isActive = todayCfg?.enabled && hr >= (todayCfg.hour_from || 0) && hr < (todayCfg.hour_to || 24)
  const anyEnabled = cfg.some(d => d.enabled)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">Расписание по дням</div>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${!anyEnabled ? 'bg-gray-100 dark:bg-gray-700 text-gray-500' : isActive ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' : 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'}`}>
          {!anyEnabled ? 'Расписание выключено (показываем всегда)' : isActive ? '● Сейчас активно' : '○ Сейчас неактивно'}
        </span>
      </div>
      <div className="space-y-1.5">
        {DAYS_OF_WEEK.map((label, i) => {
          const d = cfg[i] || { day: i, hour_from: 9, hour_to: 21, enabled: false }
          return (
            <div key={i} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${d.enabled ? 'bg-cyan-50 dark:bg-cyan-900/20' : 'bg-gray-50 dark:bg-gray-700/30'}`}>
              <label className="flex items-center gap-2 w-20 cursor-pointer">
                <input type="checkbox" checked={!!d.enabled}
                  onChange={e => updateDay(i, { enabled: e.target.checked })}
                  className="w-4 h-4 accent-cyan-600" />
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{label}</span>
              </label>
              <div className="flex items-center gap-1.5 flex-1">
                <select value={d.hour_from} disabled={!d.enabled}
                  onChange={e => updateDay(i, { hour_from: Number(e.target.value) })}
                  className="text-xs border border-gray-300 dark:border-gray-600 rounded-md px-1.5 py-0.5 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-50">
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                </select>
                <span className="text-xs text-gray-400">—</span>
                <select value={d.hour_to} disabled={!d.enabled}
                  onChange={e => updateDay(i, { hour_to: Number(e.target.value) })}
                  className="text-xs border border-gray-300 dark:border-gray-600 rounded-md px-1.5 py-0.5 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-50">
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                </select>
              </div>
            </div>
          )
        })}
      </div>
      <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
        <input type="checkbox" checked={skipHolidays}
          onChange={e => onChange({ ...schedule, skip_holidays: e.target.checked, country: schedule?.country || 'RU' })}
          className="w-4 h-4 accent-cyan-600" />
        <span>Пропускать праздники РФ (выходные и официальные)</span>
      </label>
      <p className="text-[11px] text-gray-400 dark:text-gray-500">Если ни один день не включён — реклама показывается во все дни без ограничений.</p>
    </div>
  )
}

// ── VariablePicker: вставка {{var}} в textarea ──
function VariablePicker({ onPick }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative inline-block">
      <button type="button" onClick={() => setOpen(o => !o)}
        title="Вставить переменную"
        className="text-[10px] px-2 py-0.5 rounded-md border border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/30 leading-none font-semibold">
        {'{{ }}'}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg p-1.5 w-[240px] max-h-[300px] overflow-y-auto">
            {ALLOWED_VARS.map(v => (
              <button type="button" key={v.key}
                onClick={() => { onPick(`{{${v.key}}}`); setOpen(false) }}
                className="w-full text-left px-2.5 py-1.5 rounded-md hover:bg-violet-50 dark:hover:bg-violet-900/30 transition">
                <div className="text-sm font-semibold text-violet-700 dark:text-violet-300">{`{{${v.key}}}`}</div>
                <div className="text-[10px] text-gray-500">{v.label}</div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── TagsInput: chip-style теги (Enter добавляет, Backspace удаляет) ──
function TagsInput({ value, onChange, placeholder = 'Добавить тег…' }) {
  const [draft, setDraft] = useState('')
  const tags = Array.isArray(value) ? value : []
  const addTag = (t) => {
    const v = (t || '').trim().toLowerCase().replace(/\s+/g, '-')
    if (!v) return
    if (tags.includes(v)) return
    onChange([...tags, v])
    setDraft('')
  }
  const removeAt = (i) => onChange(tags.filter((_, idx) => idx !== i))
  return (
    <div className={`mt-1.5 flex flex-wrap gap-1.5 px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 focus-within:ring-2 focus-within:ring-cyan-500/40`}>
      {tags.map((t, i) => (
        <span key={i} className="inline-flex items-center gap-1 bg-cyan-100 dark:bg-cyan-900/40 text-cyan-800 dark:text-cyan-200 text-xs font-semibold px-2 py-0.5 rounded-full">
          #{t}
          <button type="button" onClick={() => removeAt(i)} className="hover:text-red-500" title="Удалить">×</button>
        </span>
      ))}
      <input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(draft) }
          else if (e.key === 'Backspace' && !draft && tags.length > 0) { removeAt(tags.length - 1) }
        }}
        onBlur={() => draft && addTag(draft)}
        placeholder={tags.length === 0 ? placeholder : ''}
        className="flex-1 min-w-[100px] text-sm bg-transparent focus:outline-none text-gray-800 dark:text-gray-200"
      />
    </div>
  )
}

// ── AIImageButton: prompt → POST /ads/ai-image → подстановка url ──
function AIImageButton({ token, onPicked }) {
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const generate = async () => {
    if (!prompt.trim()) { setErr('Опишите изображение'); return }
    setBusy(true); setErr('')
    try {
      const r = await apiFetch(token, '/ads/ai-image', { method: 'POST', body: JSON.stringify({ prompt }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || d.error) { setErr(d.error || d.detail || 'Не удалось сгенерировать'); setBusy(false); return }
      if (d.url) { onPicked(d.url, d.provider || 'ai'); setOpen(false); setPrompt('') }
      else setErr('Пустой ответ')
    } catch { setErr('Сетевая ошибка') }
    setBusy(false)
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 hover:bg-violet-100 transition inline-flex items-center gap-1">
        ✨ AI картинка
      </button>
      {open && (
        <div className="fixed inset-0 bg-black/50 z-[700] flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <h4 className="font-bold text-gray-900 dark:text-white mb-3">AI-генерация баннера</h4>
            <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
              placeholder="Современная стоматологическая клиника, белые тона, профессиональное освещение…"
              rows={4} className={inputCls + ' resize-y'} />
            {err && <div className="mt-2 text-xs text-red-500">{err}</div>}
            <div className="flex justify-end gap-2 mt-4">
              <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Отмена</button>
              <button type="button" onClick={generate} disabled={busy}
                className="px-4 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
                {busy ? 'Генерация…' : 'Сгенерировать'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── StockSearchModal: поиск стоковых картинок ──
function StockSearchModal({ token, onClose, onPick }) {
  const [q, setQ] = useState('')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const search = async () => {
    if (!q.trim()) return
    setLoading(true); setErr('')
    try {
      const r = await apiFetch(token, `/ads/stock-search?q=${encodeURIComponent(q)}`)
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(d.detail || 'Ошибка поиска'); setItems([]) }
      else setItems(d.items || [])
    } catch { setErr('Сетевая ошибка'); setItems([]) }
    setLoading(false)
  }
  return (
    <Modal title="Поиск стоковых изображений" onClose={onClose} wide>
      <div className="flex gap-2 mb-3">
        <input value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && search()}
          placeholder="dentist office, smile, medical clinic…"
          className={inputCls} />
        <button onClick={search} disabled={loading}
          className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white text-sm font-semibold rounded-lg whitespace-nowrap disabled:opacity-50">
          {loading ? '…' : 'Найти'}
        </button>
      </div>
      {err && <div className="text-xs text-red-500 mb-2">{err}</div>}
      {items.length === 0 && !loading && !err && (
        <div className="text-center text-gray-400 py-6 text-sm">Введите запрос и нажмите Найти. Можно искать на английском (Pexels/Unsplash).</div>
      )}
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-[60vh] overflow-y-auto">
        {items.map(it => (
          <button key={it.id} type="button"
            onClick={() => { onPick(it.full, it.author, it.author_url); onClose() }}
            className="group relative rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 hover:border-cyan-400 transition">
            <img src={it.thumb} alt={it.author || ''} className="w-full h-24 object-cover" loading="lazy" />
            {it.author && <div className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[10px] px-1 py-0.5 truncate opacity-0 group-hover:opacity-100">© {it.author}</div>}
          </button>
        ))}
      </div>
    </Modal>
  )
}

function AdForm({ form, set, err, saving, onSave, onCancel, isEdit, onOpenCrop, token }) {
  const fileInputRef = useRef(null)
  const days = daysBetween(form.start_date, form.end_date)
  const [showSchedule, setShowSchedule] = useState(false)
  const [showStock, setShowStock] = useState(false)
  const bodyRef = useRef(null)

  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_320px] gap-6">
      <div className="space-y-4 min-w-0">
      {err && <div className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-sm px-4 py-3 rounded-xl border border-red-200 dark:border-red-700">{err}</div>}

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className={labelCls}>Заголовок *</label>
          <div className="flex items-center gap-2">
            <EmojiPicker onPick={(e) => set('title', form.title + e)} />
            <AiSuggestButton kind="title" form={form} set={set} />
          </div>
        </div>
        <input value={form.title} onChange={e => set('title', e.target.value)} placeholder="🎁 Скидка 20% на МРТ — только до конца недели" className={inputCls} />
        <CharCount text={form.title} hint={TITLE_HINT} />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center">
            <label className={labelCls}>Текст объявления</label>
            <FormatToolbar value={form.body} onChange={(v) => set('body', v)} textareaRef={bodyRef} />
          </div>
          <AiSuggestButton kind="body" form={form} set={set} />
        </div>
        <textarea ref={bodyRef} value={form.body} onChange={e => set('body', e.target.value)} placeholder="Что предлагаете? Используйте B/I для выделения, • для маркеров." rows={3}
          className={inputCls + ' resize-y'} />
        <CharCount text={form.body} hint={BODY_HINT} />
      </div>

      {/* CTA-кнопка */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Текст CTA-кнопки</label>
          <select value={form.cta_text}
            onChange={e => set('cta_text', e.target.value)}
            className={inputCls}>
            {CTA_PRESETS.map(c => <option key={c} value={c}>{c || '— без кнопки —'}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Стиль CTA</label>
          <select value={form.cta_style}
            onChange={e => set('cta_style', e.target.value)}
            disabled={!form.cta_text}
            className={inputCls}>
            <option value="primary">Заметная (primary)</option>
            <option value="outline">Контурная (outline)</option>
            <option value="ghost">Полупрозрачная (ghost)</option>
          </select>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className={labelCls}>Изображение баннера</label>
          <div className="flex items-center gap-1.5">
            <AIImageButton token={token} onPicked={(url) => { set('image_url', url); set('image_author', ''); set('image_author_url', '') }} />
            <button type="button" onClick={() => setShowStock(true)}
              className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-cyan-300 dark:border-cyan-700 bg-cyan-50 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-100 transition">
              🔍 Стоки
            </button>
          </div>
        </div>
        {/* URL-картинка (от AI/стоков) — отображается если нет загруженной image_data */}
        {form.image_url && !form.image_data && (
          <div className="mb-2 rounded-xl border border-cyan-200 dark:border-cyan-700 overflow-hidden bg-white dark:bg-gray-800">
            <img src={form.image_url} alt="picked" className="w-full object-cover" style={{ height: (form.banner_height || 96) + 'px' }} />
            <div className="px-3 py-2 flex items-center justify-between text-xs">
              <span className="text-gray-500 truncate">
                {form.image_author
                  ? <>фото by {form.image_author_url ? <a href={form.image_author_url} target="_blank" rel="noopener noreferrer" className="text-cyan-600 hover:underline">{form.image_author}</a> : form.image_author}</>
                  : 'URL изображения'}
              </span>
              <button type="button" onClick={() => { set('image_url', ''); set('image_author', ''); set('image_author_url', '') }}
                className="text-red-500 hover:text-red-700 ml-2">✕</button>
            </div>
          </div>
        )}
        <div className={`mt-1.5 border-2 border-dashed rounded-xl p-3 text-center cursor-pointer transition ${form.image_data ? 'border-green-400 dark:border-green-600 bg-green-50 dark:bg-green-900/20' : 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/30 hover:border-cyan-400'}`}
          onClick={() => fileInputRef.current?.click()}>
          {form.image_data ? (
            <div>
              <img src={'data:' + (form.image_mime || 'image/png') + ';base64,' + form.image_data} alt="preview"
                style={{ height: (form.banner_height || 96) + 'px' }} className="w-full object-cover rounded-lg block" />
              <div className="flex gap-2 mt-2 justify-center">
                <button type="button" onClick={e => { e.stopPropagation(); onOpenCrop({ data: form.image_data, mime: form.image_mime || 'image/jpeg' }) }}
                  className="text-xs text-cyan-600 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-900/30 px-3 py-1 rounded-lg border border-cyan-200 dark:border-cyan-700 hover:bg-cyan-100 transition">
                  ✂️ Редактировать
                </button>
                <button type="button" onClick={e => { e.stopPropagation(); set('image_data', null); set('image_mime', null) }}
                  className="text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/30 px-3 py-1 rounded-lg border border-red-200 dark:border-red-700 hover:bg-red-100 transition">
                  ✕ Удалить
                </button>
              </div>
            </div>
          ) : (
            <div className="text-gray-400 dark:text-gray-500 text-sm">
              <div className="text-3xl mb-1">🖼️</div>
              <div>Нажмите для выбора файла</div>
              <div className="text-xs mt-1">PNG, JPG, SVG до 2MB</div>
            </div>
          )}
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
          onChange={e => {
            const file = e.target.files[0]; if (!file) return
            const reader = new FileReader()
            reader.onload = ev => {
              const b64 = ev.target.result.split(',')[1]
              set('image_mime', file.type)
              onOpenCrop({ data: b64, mime: file.type })
            }
            reader.readAsDataURL(file); e.target.value = ''
          }} />
      </div>

      <div>
        <label className={labelCls}>Цветовая тема баннера</label>
        <div className="flex gap-2 flex-wrap mt-1.5">
          {COLOR_THEMES.map(t => (
            <button key={t.id} type="button" onClick={() => set('color_theme', t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium transition ${form.color_theme === t.id ? 'border-cyan-500 ring-2 ring-cyan-300 dark:ring-cyan-700' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'}`}>
              <div className="w-4 h-4 rounded-md flex-shrink-0" style={{ background: t.grad }} />
              <span className="text-gray-700 dark:text-gray-300">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <label className={labelCls}>Ссылка при клике</label>
          <input value={form.link} onChange={e => set('link', e.target.value)} placeholder="https://..." className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Высота (px)</label>
          <input type="number" value={form.banner_height} onChange={e => set('banner_height', e.target.value)} min="40" max="400" className={inputCls} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={labelCls}>Тип</label>
          <select value={form.ad_type} onChange={e => set('ad_type', e.target.value)} className={inputCls}>
            <option value="banner">Баннер</option>
            <option value="interstitial">Промежуточный</option>
            <option value="native">Нативный</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Модель оплаты</label>
          <select value={form.pricing_model} onChange={e => set('pricing_model', e.target.value)} className={inputCls}>
            <option value="flat">Фиксированная</option>
            <option value="cpc">За клик (CPC)</option>
            <option value="cpm">За 1000 показов (CPM)</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Интервал карусели</label>
          <div className="flex items-center gap-2 mt-1.5">
            <input type="number" value={form.interval_seconds} onChange={e => set('interval_seconds', e.target.value)} min="1" max="60"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/40" />
            <span className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">сек</span>
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center gap-3 mb-2">
          <label className={labelCls}>Период показа</label>
          {days >= 1 && <span className={`text-xs font-semibold ${days <= 3 ? 'text-red-500' : 'text-green-600 dark:text-green-400'}`}>{days} дн.</span>}
        </div>
        <div className="flex gap-2 flex-wrap mb-2">
          {DURATION_PRESETS.map(p => {
            const ed = addDays(form.start_date, p.days)
            const active = form.end_date === ed
            return (
              <button key={p.days} type="button" onClick={() => set('end_date', ed)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition ${active ? 'bg-cyan-600 border-cyan-600 text-white' : 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-cyan-400'}`}>
                {p.label}
              </button>
            )
          })}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Дата начала *</label>
            <input type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Дата окончания *</label>
            <input type="date" value={form.end_date} onChange={e => set('end_date', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Стоимость, ₽ *</label>
            <input type="number" value={form.price} onChange={e => set('price', e.target.value)} placeholder="0" className={inputCls} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Лимит показов</label>
          <input type="number" value={form.impressions_limit} onChange={e => set('impressions_limit', e.target.value)} placeholder="Без лимита" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Лимит кликов</label>
          <input type="number" value={form.clicks_limit} onChange={e => set('clicks_limit', e.target.value)} placeholder="Без лимита" className={inputCls} />
        </div>
      </div>

      {/* ───────── PRO: Бюджет, Frequency capping, Авто-пауза ───────── */}
      <div className="border-l-4 border-cyan-400 bg-cyan-50/40 dark:bg-cyan-900/10 rounded-r-xl px-3 py-3">
        <div className="text-xs font-semibold text-cyan-700 dark:text-cyan-400 mb-2 flex items-center gap-1.5">
          <span className="material-symbols-outlined text-base">workspace_premium</span>
          Pro-настройки (опц.)
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Бюджет, ₽ (auto-pause)</label>
            <input type="number" value={form.budget_total} onChange={e => set('budget_total', e.target.value)} placeholder="Без лимита" className={inputCls} />
            <div className="text-[10px] text-gray-500 mt-1">Авто-пауза при достижении</div>
          </div>
          <div>
            <label className={labelCls}>Окно атрибуции, дн.</label>
            <input type="number" value={form.attribution_window_days} onChange={e => set('attribution_window_days', e.target.value)} placeholder="7" className={inputCls} />
            <div className="text-[10px] text-gray-500 mt-1">Засчитывать конверсии за N дней после клика</div>
          </div>
          <div>
            <label className={labelCls}>Не чаще, /день одному</label>
            <input type="number" value={form.freq_per_day} onChange={e => set('freq_per_day', e.target.value)} placeholder="Без лимита" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Не чаще, /час одному</label>
            <input type="number" value={form.freq_per_hour} onChange={e => set('freq_per_hour', e.target.value)} placeholder="Без лимита" className={inputCls} />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Авто-пауза если простой N дней</label>
            <input type="number" value={form.auto_pause_idle_days} onChange={e => set('auto_pause_idle_days', e.target.value)} placeholder="7" className={inputCls} />
          </div>
        </div>
      </div>

      {/* ───────── PRO: Таргетинг по аудитории ───────── */}
      <div className="border-l-4 border-violet-400 bg-violet-50/40 dark:bg-violet-900/10 rounded-r-xl px-3 py-3">
        <div className="text-xs font-semibold text-violet-700 dark:text-violet-400 mb-2 flex items-center gap-1.5">
          <span className="material-symbols-outlined text-base">groups</span>
          Таргетинг (показывать только тем, кто подходит)
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Пол</label>
            <select value={form.audience.gender} onChange={e => set('audience', { ...form.audience, gender: e.target.value })} className={inputCls}>
              <option value="">— любой —</option>
              <option value="M">Мужской</option>
              <option value="F">Женский</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Город</label>
            <input type="text" value={form.audience.city} onChange={e => set('audience', { ...form.audience, city: e.target.value })} placeholder="любой" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Возраст от</label>
            <input type="number" value={form.audience.age_min} onChange={e => set('audience', { ...form.audience, age_min: e.target.value })} placeholder="—" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Возраст до</label>
            <input type="number" value={form.audience.age_max} onChange={e => set('audience', { ...form.audience, age_max: e.target.value })} placeholder="—" className={inputCls} />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>LTV пациента не менее, ₽</label>
            <input type="number" value={form.audience.ltv_min} onChange={e => set('audience', { ...form.audience, ltv_min: e.target.value })} placeholder="0 = всем" className={inputCls} />
            <div className="text-[10px] text-gray-500 mt-1">Только для пациентов с накопленной выручкой</div>
          </div>
        </div>
      </div>

      <div className="border border-gray-200 dark:border-gray-600 rounded-xl overflow-hidden">
        <button type="button" onClick={() => setShowSchedule(s => !s)}
          className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-700/50 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition">
          <span className="flex items-center gap-2">
            <span className="material-symbols-outlined text-base text-gray-500">schedule</span>
            Расписание показа (v2)
            {form.schedule?.days_config?.some(d => d.enabled) && (
              <span className="text-xs bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-400 px-2 py-0.5 rounded-full">Настроено</span>
            )}
          </span>
          <span className="material-symbols-outlined text-base text-gray-400">{showSchedule ? 'expand_less' : 'expand_more'}</span>
        </button>
        {showSchedule && (
          <div className="px-4 py-4">
            <ScheduleEditorV2 schedule={form.schedule} onChange={(s) => set('schedule', s)} />
          </div>
        )}
      </div>

      {/* Категория + теги */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Категория</label>
          <select value={form.category || ''} onChange={e => set('category', e.target.value)} className={inputCls}>
            {AD_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Теги</label>
          <TagsInput value={form.tags || []} onChange={(t) => set('tags', t)} placeholder="acne, весна-2026, …" />
          <div className="text-[10px] text-gray-500 mt-1">Enter для добавления. Используются для группировки и фильтрации.</div>
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} className="px-5 py-2 rounded-xl border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 transition">
          Отмена
        </button>
        <button type="button" onClick={onSave} disabled={saving}
          className={`px-6 py-2 rounded-xl text-sm font-semibold text-white transition ${saving ? 'bg-gray-400 cursor-not-allowed' : 'bg-cyan-600 hover:bg-cyan-700'}`}>
          {saving ? (isEdit ? 'Сохранение...' : 'Создание...') : (isEdit ? 'Сохранить' : 'Создать объявление')}
        </button>
      </div>

      {/* Чекбокс «сохранить как шаблон» */}
      <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
        <input type="checkbox" checked={!!form.is_template}
          onChange={e => set('is_template', e.target.checked)}
          className="w-4 h-4 accent-cyan-600" />
        <span>Сохранить как шаблон (не идёт в показы, можно использовать как основу для будущих)</span>
      </label>
      </div>
      <div className="hidden md:block">
        <LivePreview form={form} />
      </div>
      {showStock && (
        <StockSearchModal token={token} onClose={() => setShowStock(false)}
          onPick={(url, author, authorUrl) => { set('image_url', url); set('image_author', author || ''); set('image_author_url', authorUrl || '') }} />
      )}
    </div>
  )
}

// ── CompareModal: сравнение нескольких объявлений по выбранной метрике ──
function CompareModal({ ids, ads, token, onClose }) {
  const [metric, setMetric] = useState('clicks')
  const [days, setDays] = useState(30)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!ids || ids.length < 2) return
    setLoading(true)
    apiFetch(token, `/ads/compare?ids=${ids.join(',')}&metric=${metric}&days=${days}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [ids, metric, days, token])
  // Превращаем data.series (объект ad_id → {title, points:[{date,value}]}) в плоский series для MiniChart
  const seriesIds = data?.series ? Object.keys(data.series) : []
  // Строим объединённый timeline: ключи — даты, поля — ad_id
  const adKeys = seriesIds  // массив id, по которым рисуем
  const dateSet = new Set()
  for (const aid of seriesIds) for (const p of (data.series[aid]?.points || [])) dateSet.add(p.date)
  const allDates = Array.from(dateSet).sort()
  const merged = allDates.map(date => {
    const row = { date }
    for (const aid of seriesIds) {
      const pt = (data.series[aid]?.points || []).find(p => p.date === date)
      row[aid] = pt ? pt.value : 0
    }
    return row
  })
  const colors = seriesIds.map((_, i) => COMPARE_COLORS[i % COMPARE_COLORS.length])
  const METRICS = [['clicks', 'Клики'], ['impressions', 'Показы'], ['conversions', 'Конверсии'], ['revenue', 'Выручка']]
  return (
    <Modal title={`Сравнение ${ids.length} объявлений`} onClose={onClose} wide>
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-500">Метрика:</span>
          {METRICS.map(([v, l]) => (
            <button key={v} onClick={() => setMetric(v)}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition ${metric === v ? 'bg-cyan-600 border-cyan-600 text-white' : 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300'}`}>
              {l}
            </button>
          ))}
        </div>
        <select value={days} onChange={e => setDays(Number(e.target.value))}
          className="text-xs border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300">
          {[7, 14, 30, 60, 90].map(d => <option key={d} value={d}>{d} дней</option>)}
        </select>
      </div>
      {loading ? (
        <div className="text-center py-12 text-gray-400">Загрузка...</div>
      ) : !data ? (
        <div className="text-center py-12 text-red-400">Ошибка загрузки</div>
      ) : (
        <>
          <div className="bg-gray-50 dark:bg-gray-700/30 rounded-xl p-4 mb-3">
            {/* Легенда */}
            <div className="flex flex-wrap gap-3 mb-3">
              {seriesIds.map((aid, i) => (
                <div key={aid} className="flex items-center gap-1.5 text-xs">
                  <div className="w-3 h-3 rounded-full" style={{ background: colors[i] }} />
                  <span className="text-gray-700 dark:text-gray-300 max-w-[200px] truncate">{data.series[aid]?.title || (ads.find(a => a.id === aid)?.title) || aid.slice(0, 8)}</span>
                </div>
              ))}
            </div>
            <MiniChart series={merged} keys={adKeys} colors={colors} height={220} />
          </div>
          {/* Сводная таблица: сумма по метрике на ad */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-xs uppercase text-gray-500">
                  <th className="text-left py-2 pr-2">Объявление</th>
                  <th className="text-right py-2 pr-2">Сумма ({METRICS.find(([v]) => v === metric)?.[1]})</th>
                </tr>
              </thead>
              <tbody>
                {seriesIds.map((aid, i) => {
                  const sum = (data.series[aid]?.points || []).reduce((s, p) => s + (p.value || 0), 0)
                  return (
                    <tr key={aid} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="py-2 pr-2 flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: colors[i] }} />
                        <span className="truncate max-w-[400px]">{data.series[aid]?.title || aid}</span>
                      </td>
                      <td className="py-2 pr-2 text-right font-bold tabular-nums">{Number(sum).toLocaleString('ru', { maximumFractionDigits: 2 })}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  )
}

// ── TemplateGalleryModal: категории + список шаблонов + seed ──
function TemplateGalleryModal({ token, onClose, onUse }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [category, setCategory] = useState('')
  const [seeding, setSeeding] = useState(false)
  const reload = async () => {
    setLoading(true)
    try {
      const r = await apiFetch(token, '/ads/templates')
      if (r.ok) setItems(await r.json())
    } catch {}
    setLoading(false)
  }
  useEffect(() => { reload() }, [])
  const filtered = category ? items.filter(t => (t.category || 'other') === category) : items
  const seed = async () => {
    setSeeding(true)
    try {
      const r = await apiFetch(token, '/ads/templates/seed', { method: 'POST' })
      if (r.ok) await reload()
      else alert('Не удалось создать стартовые шаблоны')
    } catch { alert('Сетевая ошибка') }
    setSeeding(false)
  }
  const useTpl = async (tplId) => {
    try {
      const r = await apiFetch(token, `/ads/${tplId}/use-template`, { method: 'POST' })
      if (r.ok) { const ad = await r.json(); onUse(ad); onClose() }
    } catch {}
  }
  return (
    <Modal title="Галерея шаблонов" onClose={onClose} wide>
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <span className="text-xs text-gray-500">Категория:</span>
        {[{ value: '', label: 'Все' }, ...AD_CATEGORIES.filter(c => c.value)].map(c => (
          <button key={c.value} onClick={() => setCategory(c.value)}
            className={`px-3 py-1 rounded-full text-xs font-semibold border transition ${category === c.value ? 'bg-purple-600 border-purple-600 text-white' : 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-purple-400'}`}>
            {c.label}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="py-10 text-center text-gray-400">Загрузка...</div>
      ) : items.length === 0 ? (
        <div className="py-10 text-center text-gray-400">
          <span className="material-symbols-outlined text-5xl block mb-2">bookmark_add</span>
          <div>Шаблонов ещё нет.</div>
          <button onClick={seed} disabled={seeding}
            className="mt-3 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
            {seeding ? 'Создаём…' : '✨ Создать стартовые шаблоны'}
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[60vh] overflow-y-auto">
            {filtered.map(t => (
              <button key={t.id} type="button" onClick={() => useTpl(t.id)}
                className="text-left border border-gray-200 dark:border-gray-700 rounded-xl p-3 hover:border-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <div className="font-semibold text-gray-900 dark:text-white text-sm flex-1 min-w-0 truncate">{t.title}</div>
                  {t.category && <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 font-semibold">{(AD_CATEGORIES.find(c => c.value === t.category) || {}).label || t.category}</span>}
                </div>
                {t.body && <div className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">{t.body}</div>}
                <div className="text-[10px] text-gray-400 mt-1.5 flex items-center gap-2">
                  {t.cta_text && <span>CTA: {t.cta_text}</span>}
                  {t.audience && <span>🎯 Таргет</span>}
                </div>
              </button>
            ))}
          </div>
          {filtered.length === 0 && (
            <div className="py-6 text-center text-gray-400 text-sm">В этой категории шаблонов нет.</div>
          )}
          <div className="mt-3 text-right">
            <button onClick={seed} disabled={seeding} className="text-xs text-purple-600 hover:text-purple-800 disabled:opacity-50">
              {seeding ? '…' : '+ Добавить стартовые шаблоны'}
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}

// ── BulkGenerateModal: AI генерация N вариантов ──
function BulkGenerateModal({ token, onClose, onDone }) {
  const [serviceName, setServiceName] = useState('')
  const [servicePrice, setServicePrice] = useState('')
  const [count, setCount] = useState(3)
  const [busy, setBusy] = useState(false)
  const [items, setItems] = useState([])
  const [err, setErr] = useState('')
  const generate = async () => {
    if (!serviceName.trim()) { setErr('Укажите название услуги'); return }
    setBusy(true); setErr('')
    try {
      const r = await apiFetch(token, '/ads/bulk-generate', {
        method: 'POST',
        body: JSON.stringify({
          service_name: serviceName.trim(),
          service_price: servicePrice ? Number(servicePrice) : null,
          count: Number(count),
        }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(d.detail || 'Ошибка генерации'); setBusy(false); return }
      setItems(d.items || [])
    } catch { setErr('Сетевая ошибка') }
    setBusy(false)
  }
  const activate = async (id) => {
    try {
      const r = await apiFetch(token, `/ads/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'active' }) })
      if (r.ok) { setItems(prev => prev.map(it => it.id === id ? { ...it, status: 'active' } : it)); onDone?.() }
    } catch {}
  }
  const remove = async (id) => {
    if (!confirm('Удалить этот черновик?')) return
    try {
      const r = await apiFetch(token, `/ads/${id}`, { method: 'DELETE' })
      if (r.ok) { setItems(prev => prev.filter(it => it.id !== id)); onDone?.() }
    } catch {}
  }
  return (
    <Modal title="🪄 Сгенерировать варианты" onClose={onClose} wide>
      {items.length === 0 ? (
        <div className="space-y-3">
          <div>
            <label className={labelCls}>Название услуги</label>
            <input value={serviceName} onChange={e => setServiceName(e.target.value)}
              placeholder="Профессиональная гигиена полости рта" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Цена, ₽ (опционально)</label>
            <input type="number" value={servicePrice} onChange={e => setServicePrice(e.target.value)}
              placeholder="3500" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Количество вариантов: <span className="font-bold text-cyan-600">{count}</span></label>
            <input type="range" min="1" max="5" value={count}
              onChange={e => setCount(Number(e.target.value))}
              className="w-full mt-2 accent-cyan-600" />
          </div>
          {err && <div className="text-xs text-red-500">{err}</div>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Отмена</button>
            <button type="button" onClick={generate} disabled={busy}
              className="px-5 py-2 bg-cyan-600 hover:bg-cyan-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
              {busy ? 'Генерация…' : 'Сгенерировать'}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
          <div className="text-xs text-gray-500 mb-2">Создано черновиков: {items.length}. Активируйте те, что нравятся; остальные удалите.</div>
          {items.map(it => (
            <div key={it.id} className="border border-gray-200 dark:border-gray-700 rounded-xl p-3 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm text-gray-900 dark:text-white">{it.title}</div>
                {it.body && <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">{it.body}</div>}
                <div className="text-[10px] text-gray-400 mt-1">Статус: {STATUS_LABELS[it.status] || it.status}</div>
              </div>
              <div className="flex gap-1.5 flex-shrink-0">
                {it.status !== 'active' && (
                  <button onClick={() => activate(it.id)} className="px-3 py-1 text-xs font-semibold rounded-lg bg-green-500 hover:bg-green-600 text-white">Активировать</button>
                )}
                <button onClick={() => remove(it.id)} className="px-2 py-1 text-xs rounded-lg bg-red-50 hover:bg-red-100 text-red-600">Удалить</button>
              </div>
            </div>
          ))}
          <div className="text-right pt-3">
            <button onClick={onClose} className="px-4 py-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 text-sm rounded-lg">Готово</button>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ── ShareToBranchModal: копирование в другой филиал франшизы ──
function ShareToBranchModal({ ad, token, onClose, onDone }) {
  const [siblings, setSiblings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [targetId, setTargetId] = useState('')
  const [activate, setActivate] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    apiFetch(token, '/ads/franchise-siblings')
      .then(r => r.ok ? r.json() : [])
      .then(d => { setSiblings(d || []); setLoading(false) })
      .catch(() => { setSiblings([]); setLoading(false) })
  }, [token])
  const submit = async () => {
    if (!targetId) { setErr('Выберите филиал'); return }
    setBusy(true); setErr('')
    try {
      const r = await apiFetch(token, `/ads/${ad.id}/share`, {
        method: 'POST',
        body: JSON.stringify({ tenant_id: targetId, activate }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(d.detail || 'Не удалось скопировать'); setBusy(false); return }
      const target = siblings.find(s => s.id === targetId)
      alert(`Скопировано в «${target?.name || 'филиал'}»`)
      onDone?.(); onClose()
    } catch { setErr('Сетевая ошибка') }
    setBusy(false)
  }
  return (
    <Modal title="📤 Копировать в филиал" onClose={onClose}>
      {loading ? (
        <div className="py-8 text-center text-gray-400">Загрузка…</div>
      ) : siblings.length === 0 ? (
        <div className="py-8 text-center text-gray-500 text-sm">
          Этот тенант не входит в франшизу — шаринг недоступен.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-sm text-gray-700 dark:text-gray-300 mb-2">Куда скопировать «<b>{ad.title}</b>»?</div>
          <div className="space-y-1.5 max-h-[40vh] overflow-y-auto">
            {siblings.map(s => (
              <label key={s.id} className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition ${targetId === s.id ? 'border-cyan-500 bg-cyan-50 dark:bg-cyan-900/20' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'}`}>
                <input type="radio" name="target" checked={targetId === s.id} onChange={() => setTargetId(s.id)} className="accent-cyan-600" />
                <div className="flex-1">
                  <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">{s.name}</div>
                  <div className="text-[11px] text-gray-500">{s.slug}</div>
                </div>
              </label>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
            <input type="checkbox" checked={activate} onChange={e => setActivate(e.target.checked)} className="w-4 h-4 accent-cyan-600" />
            <span>Сразу активировать (потребует одобрения в целевом филиале)</span>
          </label>
          {err && <div className="text-xs text-red-500">{err}</div>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Отмена</button>
            <button type="button" onClick={submit} disabled={busy || !targetId}
              className="px-5 py-2 bg-cyan-600 hover:bg-cyan-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
              {busy ? '…' : 'Скопировать'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ── ApprovalBadge: pending/rejected плашка на карточке ──
function ApprovalBadge({ status, note }) {
  if (status === 'pending') {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 border border-orange-300 font-semibold" title={note || 'Ожидает одобрения'}>🕒 На проверке</span>
  }
  if (status === 'rejected') {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border border-gray-300 font-semibold" title={note || 'Отклонено'}>❌ Отклонено</span>
  }
  return null
}

export default function AdsSection({ token }) {
  const [ads, setAds] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterTag, setFilterTag] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [healthIssues, setHealthIssues] = useState(null) // { issues: [...] }
  const [healthBusy, setHealthBusy] = useState(false)
  const [bulkSel, setBulkSel] = useState(new Set())  // bulk-выбор по id
  const [compareSel, setCompareSel] = useState(new Set())  // multi-select для сравнения
  const [showCompare, setShowCompare] = useState(false)
  const [editAd, setEditAd] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [selected, setSelected] = useState(null)
  const [updatingStatus, setUpdatingStatus] = useState(null)
  const [cropCtx, setCropCtx] = useState(null)
  const [previewAd, setPreviewAd] = useState(null)
  const [statsAd, setStatsAd] = useState(null)
  const [dragId, setDragId] = useState(null)
  const [dragOver, setDragOver] = useState(null)
  const [showGallery, setShowGallery] = useState(false)
  const [showBulkGen, setShowBulkGen] = useState(false)
  const [shareAd, setShareAd] = useState(null)
  const [approveBusy, setApproveBusy] = useState(null)

  // Роль текущего пользователя — для UI approval. director+ может одобрять.
  const userRole = (() => {
    const payload = decodeJwt(token)
    return payload?.role || payload?.user_role || ''
  })()
  const canApprove = ['owner', 'director', 'franchise_owner', 'superadmin', 'admin'].includes(userRole)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const load = useCallback(async () => {
    setLoading(true)
    try {
      let url
      if (filterTag.trim()) {
        url = `/ads/by-tags?tags=${encodeURIComponent(filterTag.trim())}`
      } else {
        url = `/ads${filterStatus ? `?status=${filterStatus}` : ''}`
      }
      const r = await apiFetch(token, url)
      if (r.ok) setAds(await r.json())
    } catch {}
    setLoading(false)
  }, [token, filterStatus, filterTag])

  useEffect(() => { load() }, [load])

  const resetForm = () => { setForm(EMPTY_FORM); setErr('') }

  // Конвертирует legacy schedule { days:[0,1,..], hours:[9,10,..] } в days_config v2
  const legacyToV2 = (schedule) => {
    if (!schedule) return { days_config: defaultDaysConfig(), skip_holidays: false, country: 'RU' }
    // Если уже v2 — возвращаем как есть
    if (Array.isArray(schedule.days_config)) {
      // Заполняем недостающие дни
      const byIdx = {}
      schedule.days_config.forEach(d => { byIdx[d.day] = d })
      return {
        days_config: Array.from({ length: 7 }, (_, i) => byIdx[i] || { day: i, hour_from: 9, hour_to: 21, enabled: false }),
        skip_holidays: !!schedule.skip_holidays,
        country: schedule.country || 'RU',
      }
    }
    const days = Array.isArray(schedule.days) ? schedule.days : null
    const hours = Array.isArray(schedule.hours) ? schedule.hours : null
    const hour_from = hours?.length ? Math.min(...hours) : 9
    const hour_to = hours?.length ? Math.max(...hours) + 1 : 21
    const enabledSet = days ? new Set(days) : new Set([0,1,2,3,4,5,6])
    return {
      days_config: Array.from({ length: 7 }, (_, i) => ({
        day: i, hour_from, hour_to,
        enabled: days ? enabledSet.has(i) : false,
      })),
      skip_holidays: false,
      country: 'RU',
    }
  }

  const openEdit = (ad) => {
    setEditAd(ad)
    const schedule = ad.schedule || {}
    setForm({
      title: ad.title || '', body: ad.body || '',
      image_data: ad.image_data || null, image_mime: ad.image_mime || null,
      image_url: ad.image_url || '', image_author: '', image_author_url: '',
      banner_height: String(ad.banner_height || 96),
      interval_seconds: String(ad.interval_seconds || 5),
      link: ad.link || '', ad_type: ad.ad_type || 'banner',
      pricing_model: ad.pricing_model || 'flat',
      start_date: ad.start_date || new Date().toISOString().slice(0, 10),
      end_date: ad.end_date || addDays(new Date().toISOString().slice(0, 10), 7),
      price: String(ad.price ?? 0),
      impressions_limit: ad.impressions_limit ? String(ad.impressions_limit) : '',
      clicks_limit: ad.clicks_limit ? String(ad.clicks_limit) : '',
      budget_total: ad.budget_total != null ? String(ad.budget_total) : '',
      freq_per_day: ad.freq_per_day ? String(ad.freq_per_day) : '',
      freq_per_hour: ad.freq_per_hour ? String(ad.freq_per_hour) : '',
      auto_pause_idle_days: String(ad.auto_pause_idle_days ?? 7),
      attribution_window_days: String(ad.attribution_window_days ?? 7),
      audience: ad.audience ? {
        gender: ad.audience.gender || '', age_min: ad.audience.age_min || '',
        age_max: ad.audience.age_max || '', city: ad.audience.city || '',
        ltv_min: ad.audience.ltv_min || ''
      } : { gender: '', age_min: '', age_max: '', city: '', ltv_min: '' },
      cta_text: ad.cta_text || '',
      cta_style: ad.cta_style || 'primary',
      is_template: !!ad.is_template,
      sort_order: String(ad.sort_order ?? 0),
      color_theme: ad.color_theme || '',
      // Legacy (для обратной совместимости — не используются в новом UI)
      schedule_days: schedule.days || [],
      schedule_hours_start: schedule.hours?.length ? String(Math.min(...schedule.hours)) : '',
      schedule_hours_end: schedule.hours?.length ? String(Math.max(...schedule.hours)) : '',
      // v2
      schedule: legacyToV2(schedule),
      tags: Array.isArray(ad.tags) ? ad.tags : [],
      category: ad.category || '',
    })
    setErr('')
  }

  const validate = () => {
    if (!form.title.trim()) { setErr('Укажите заголовок'); return false }
    if (!form.start_date || !form.end_date) { setErr('Укажите даты'); return false }
    return true
  }

  const buildSchedule = () => {
    // Приоритет — v2 (days_config). Если ни один день не enabled — расписания нет.
    const v2 = form.schedule
    if (v2?.days_config?.some(d => d.enabled)) {
      // Сохраняем v2 как есть; также формируем legacy-поля days/hours для совместимости с backend
      const enabledDays = v2.days_config.filter(d => d.enabled).map(d => d.day)
      // Если у всех включённых дней одинаковый диапазон часов — пишем единый hours-массив
      const enabledCfgs = v2.days_config.filter(d => d.enabled)
      const sameRange = enabledCfgs.every(d => d.hour_from === enabledCfgs[0].hour_from && d.hour_to === enabledCfgs[0].hour_to)
      let hours = null
      if (sameRange && enabledCfgs.length > 0) {
        const { hour_from, hour_to } = enabledCfgs[0]
        if (hour_to > hour_from) hours = Array.from({ length: hour_to - hour_from }, (_, i) => hour_from + i)
      }
      return {
        days_config: v2.days_config,
        skip_holidays: !!v2.skip_holidays,
        country: v2.country || 'RU',
        days: enabledDays.length > 0 ? enabledDays : null,
        hours,
      }
    }
    // Fallback к legacy полям (если по какой-то причине заполнены)
    const days = form.schedule_days?.length > 0 ? form.schedule_days : null
    let hours = null
    if (form.schedule_hours_start !== '' && form.schedule_hours_end !== '') {
      const s = Number(form.schedule_hours_start), e = Number(form.schedule_hours_end)
      if (e >= s) hours = Array.from({ length: e - s + 1 }, (_, i) => s + i).filter(h => h >= 0 && h <= 23)
    }
    if (!days && !hours) return null
    return { days, hours }
  }

  const buildPayload = () => {
    // Очищаем audience от пустых ключей
    const aud = {}
    Object.entries(form.audience || {}).forEach(([k, v]) => {
      if (v !== '' && v !== null && v !== undefined) {
        aud[k] = (k === 'age_min' || k === 'age_max' || k === 'ltv_min' || k === 'ltv_max') ? Number(v) : v
      }
    })
    return {
      title: form.title.trim(), body: form.body.trim() || null,
      image_data: form.image_data || null, image_mime: form.image_mime || null,
      image_url: form.image_url || null,
      banner_height: Number(form.banner_height) || 96,
      interval_seconds: Number(form.interval_seconds) || 5,
      link: form.link.trim() || null, ad_type: form.ad_type,
      pricing_model: form.pricing_model, start_date: form.start_date, end_date: form.end_date,
      price: Number(form.price) || 0,
      impressions_limit: form.impressions_limit ? Number(form.impressions_limit) : null,
      clicks_limit: form.clicks_limit ? Number(form.clicks_limit) : null,
      sort_order: Number(form.sort_order) || 0,
      color_theme: form.color_theme || null,
      schedule: buildSchedule(),
      // Pro
      budget_total: form.budget_total ? Number(form.budget_total) : null,
      freq_per_day: form.freq_per_day ? Number(form.freq_per_day) : null,
      freq_per_hour: form.freq_per_hour ? Number(form.freq_per_hour) : null,
      auto_pause_idle_days: form.auto_pause_idle_days ? Number(form.auto_pause_idle_days) : 7,
      attribution_window_days: form.attribution_window_days ? Number(form.attribution_window_days) : 7,
      audience: Object.keys(aud).length > 0 ? aud : null,
      cta_text: form.cta_text || null,
      cta_style: form.cta_style || 'primary',
      is_template: !!form.is_template,
      // Phase D: теги и категория
      tags: Array.isArray(form.tags) && form.tags.length > 0 ? form.tags : null,
      category: form.category || null,
    }
  }

  const save = async () => {
    if (!validate()) return
    setSaving(true); setErr('')
    try {
      const r = await apiFetch(token, '/ads', { method: 'POST', body: JSON.stringify(buildPayload()) })
      if (r.ok) { setShowCreate(false); resetForm(); load() }
      else { const d = await r.json(); setErr(d.detail?.message || d.detail || 'Ошибка') }
    } catch { setErr('Сетевая ошибка') }
    setSaving(false)
  }

  const saveEdit = async () => {
    if (!validate()) return
    setSaving(true); setErr('')
    try {
      const r = await apiFetch(token, `/ads/${editAd.id}`, { method: 'PATCH', body: JSON.stringify(buildPayload()) })
      if (r.ok) { setEditAd(null); resetForm(); load() }
      else { const d = await r.json(); setErr(d.detail?.message || d.detail || 'Ошибка') }
    } catch { setErr('Сетевая ошибка') }
    setSaving(false)
  }

  const updateStatus = async (ad, status) => {
    setUpdatingStatus(ad.id)
    try {
      const r = await apiFetch(token, `/ads/${ad.id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
      if (r.ok) load()
    } catch {}
    setUpdatingStatus(null)
  }

  const createAbVariant = async (ad) => {
    if (!confirm('Создать A/B-вариант на основе этого объявления?')) return
    try {
      // Берём существующее ad как basis, отправляем как создание variant'а
      const payload = {
        title: ad.title + ' (вариант)',
        body: ad.body || '',
        link: ad.link || '',
        ad_type: ad.ad_type || 'banner',
        pricing_model: ad.pricing_model || 'flat',
        start_date: ad.start_date,
        end_date: ad.end_date,
        price: ad.price,
        impressions_limit: ad.impressions_limit,
        clicks_limit: ad.clicks_limit,
        budget_total: ad.budget_total,
        freq_per_day: ad.freq_per_day,
        freq_per_hour: ad.freq_per_hour,
        auto_pause_idle_days: ad.auto_pause_idle_days,
        attribution_window_days: ad.attribution_window_days,
        audience: ad.audience,
        image_data: ad.image_data,
        image_mime: ad.image_mime,
        banner_height: ad.banner_height,
        color_theme: ad.color_theme,
      }
      const parentId = ad.parent_ad_id || ad.id
      const r = await apiFetch(token, `/ads/${parentId}/variant`, { method: 'POST', body: JSON.stringify(payload) })
      if (r.ok) { const d = await r.json(); alert(`Создан вариант ${d.variant?.ab_variant || ''} — отредактируйте и запустите`); load() }
      else { const d = await r.json(); alert(d.detail || 'Ошибка создания варианта') }
    } catch { alert('Сетевая ошибка') }
  }

  const declareWinner = async (ad) => {
    const parentId = ad.parent_ad_id || ad.id
    if (!confirm('Объявить победителя A/B по CTR? Остальные варианты встанут на паузу.')) return
    const r = await apiFetch(token, `/ads/${parentId}/declare-winner`, { method: 'POST' })
    if (r.ok) {
      const d = await r.json()
      alert(`Победитель: вариант ${d.winner_variant} с CTR ${d.winner_ctr}%`)
      load()
    } else {
      const d = await r.json()
      alert(d.detail || 'Не удалось')
    }
  }

  const [templates, setTemplates] = useState([])
  const [showTemplates, setShowTemplates] = useState(false)
  const loadTemplates = async () => {
    try {
      const r = await apiFetch(token, '/ads/templates')
      if (r.ok) setTemplates(await r.json())
    } catch {}
  }
  const useTemplate = async (tplId) => {
    const r = await apiFetch(token, `/ads/${tplId}/use-template`, { method: 'POST' })
    if (r.ok) {
      setShowTemplates(false)
      const newAd = await r.json()
      openEdit(newAd)  // сразу открываем редактор для финального ввода
      load()
    }
  }

  const duplicate = async (ad) => {
    try {
      const r = await apiFetch(token, `/ads/${ad.id}/duplicate`, { method: 'POST' })
      if (r.ok) load()
    } catch {}
  }

  // ── Approval workflow ──
  const approveAd = async (ad) => {
    setApproveBusy(ad.id)
    try {
      const r = await apiFetch(token, `/ads/${ad.id}/approve`, { method: 'POST', body: JSON.stringify({}) })
      if (r.ok) load()
      else { const d = await r.json().catch(() => ({})); alert(d.detail || 'Не удалось одобрить') }
    } catch { alert('Сетевая ошибка') }
    setApproveBusy(null)
  }
  const rejectAd = async (ad) => {
    const note = prompt('Причина отклонения (≥ 3 символов):', '')
    if (note == null) return
    if (note.trim().length < 3) { alert('Причина должна быть не короче 3 символов'); return }
    setApproveBusy(ad.id)
    try {
      const r = await apiFetch(token, `/ads/${ad.id}/reject`, { method: 'POST', body: JSON.stringify({ note: note.trim() }) })
      if (r.ok) load()
      else { const d = await r.json().catch(() => ({})); alert(d.detail || 'Не удалось отклонить') }
    } catch { alert('Сетевая ошибка') }
    setApproveBusy(null)
  }

  // ── Compare multi-select ──
  const toggleCompareSel = (id) => setCompareSel(s => {
    const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n
  })

  // ── Использование шаблона из галереи: открываем форму редактирования сразу ──
  const useTemplateFromGallery = (newAd) => {
    openEdit(newAd)
    load()
  }

  const handleDrop = async (targetId) => {
    if (!dragId || dragId === targetId) { setDragId(null); setDragOver(null); return }
    const reordered = [...ads]
    const fromIdx = reordered.findIndex(a => a.id === dragId)
    const toIdx = reordered.findIndex(a => a.id === targetId)
    const [moved] = reordered.splice(fromIdx, 1)
    reordered.splice(toIdx, 0, moved)
    setAds(reordered)
    setDragId(null); setDragOver(null)
    try {
      await apiFetch(token, '/ads/reorder', { method: 'PATCH', body: JSON.stringify(reordered.map((a, i) => ({ id: a.id, sort_order: i }))) })
    } catch {}
  }

  const runHealthCheck = async () => {
    setHealthBusy(true)
    try {
      const r = await apiFetch(token, '/ads/health-check')
      if (r.ok) setHealthIssues(await r.json())
    } catch {}
    setHealthBusy(false)
  }
  const autoPauseDead = async () => {
    if (!confirm('Поставить на паузу всю мёртвую рекламу?')) return
    const r = await apiFetch(token, '/ads/health-check/auto-pause', { method: 'POST' })
    if (r.ok) { const d = await r.json(); alert(`Поставлено на паузу: ${d.paused}`); load(); setHealthIssues(null) }
  }
  const bulkAction = async (action) => {
    if (bulkSel.size === 0) return
    if (action === 'delete' && !confirm(`Удалить ${bulkSel.size} объявлений?`)) return
    const r = await apiFetch(token, '/ads/bulk', { method: 'POST', body: JSON.stringify({ ids: [...bulkSel], action }) })
    if (r.ok) { setBulkSel(new Set()); load() }
  }
  const toggleSel = (id) => setBulkSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const exportCSV = () => {
    const headers = ['ID', 'Заголовок', 'Статус', 'Тип', 'Показы', 'Клики', 'Конверсии', 'CTR%', 'Начало', 'Конец', 'Цена']
    const rows = ads.map(a => {
      const ctr = a.impressions_count > 0 ? ((a.clicks_count / a.impressions_count) * 100).toFixed(1) : '0'
      return [a.id, a.title, STATUS_LABELS[a.status] || a.status, a.ad_type,
              a.impressions_count, a.clicks_count, a.conversions_count, ctr, a.start_date, a.end_date, a.price]
    })
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n')
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'ads_export.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  const totalImpressions = ads.reduce((s, a) => s + (a.impressions_count || 0), 0)
  const totalClicks = ads.reduce((s, a) => s + (a.clicks_count || 0), 0)
  const totalConversions = ads.reduce((s, a) => s + (a.conversions_count || 0), 0)
  const activeCount = ads.filter(a => a.status === 'active').length
  const ctr = totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(1) : '0.0'
  const FILTER_BTNS = ['', 'active', 'draft', 'paused', 'completed', 'cancelled']

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Рекламные объявления</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Управление баннерами карусели для пациентов</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setShowGallery(true)}
            className="flex items-center gap-1.5 px-3 py-2 border border-purple-300 bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-xl text-xs font-semibold hover:bg-purple-100 transition">
            <span className="material-symbols-outlined text-sm">collections_bookmark</span>📚 Из шаблона
          </button>
          <button onClick={() => setShowBulkGen(true)}
            className="flex items-center gap-1.5 px-3 py-2 border border-fuchsia-300 bg-fuchsia-50 dark:bg-fuchsia-900/30 text-fuchsia-700 dark:text-fuchsia-300 rounded-xl text-xs font-semibold hover:bg-fuchsia-100 transition">
            <span className="material-symbols-outlined text-sm">auto_awesome</span>🪄 Варианты
          </button>
          <button onClick={runHealthCheck} disabled={healthBusy}
            className="flex items-center gap-1.5 px-3 py-2 border border-amber-300 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-xl text-xs font-semibold hover:bg-amber-100 transition">
            <span className="material-symbols-outlined text-sm">monitor_heart</span>
            {healthBusy ? '…' : 'Проверка'}
          </button>
          <button onClick={exportCSV}
            className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-xl text-xs font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition">
            <span className="material-symbols-outlined text-sm">download</span>CSV
          </button>
          <button onClick={() => { setShowCreate(true); resetForm() }}
            className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-xl text-sm font-semibold transition">
            <span className="material-symbols-outlined text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>add</span>
            Создать объявление
          </button>
        </div>
      </div>

      {/* Health-check результаты */}
      {healthIssues && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-2xl p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="font-semibold text-amber-900 dark:text-amber-200 flex items-center gap-2">
              <span className="material-symbols-outlined">monitor_heart</span>
              Проверка здоровья: найдено проблем — {healthIssues.total}
            </div>
            <div className="flex gap-2">
              {healthIssues.total > 0 && (
                <button onClick={autoPauseDead} className="text-xs px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold">
                  Авто-пауза всех
                </button>
              )}
              <button onClick={() => setHealthIssues(null)} className="text-xs px-3 py-1.5 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg">
                Скрыть
              </button>
            </div>
          </div>
          {healthIssues.total === 0 ? (
            <div className="text-sm text-amber-700 dark:text-amber-300">Всё в порядке — мёртвой рекламы нет.</div>
          ) : (
            <ul className="space-y-1">
              {healthIssues.issues.map((it, i) => (
                <li key={i} className="text-sm text-amber-900 dark:text-amber-200">
                  <b>{it.title}</b> — <span className="text-amber-700 dark:text-amber-400">{it.details}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Bulk-actions bar (показывается если что-то выбрано) */}
      {bulkSel.size > 0 && (
        <div className="sticky top-0 z-10 bg-cyan-600 text-white rounded-xl px-4 py-2 mb-4 flex items-center justify-between shadow-lg">
          <div className="text-sm font-semibold">Выбрано: {bulkSel.size}</div>
          <div className="flex gap-2">
            <button onClick={() => bulkAction('activate')} className="text-xs px-3 py-1.5 bg-white text-cyan-700 hover:bg-cyan-50 rounded-lg font-semibold">▶ Запустить</button>
            <button onClick={() => bulkAction('pause')} className="text-xs px-3 py-1.5 bg-white text-cyan-700 hover:bg-cyan-50 rounded-lg font-semibold">⏸ Пауза</button>
            <button onClick={() => bulkAction('delete')} className="text-xs px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg font-semibold">✕ Удалить</button>
            <button onClick={() => setBulkSel(new Set())} className="text-xs px-3 py-1.5 bg-cyan-700 hover:bg-cyan-800 rounded-lg">Сбросить</button>
          </div>
        </div>
      )}

      <div className="bg-cyan-50 dark:bg-cyan-900/20 border border-cyan-200 dark:border-cyan-800 rounded-2xl p-4 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <span className="material-symbols-outlined text-cyan-600 dark:text-cyan-400 text-lg" style={{fontVariationSettings:"'FILL' 1"}}>info</span>
          <span className="text-sm font-bold text-cyan-800 dark:text-cyan-300">Требования к изображению баннера</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
          {[['🖼️ Формат','JPG, PNG, SVG'],['📐 Ширина','480px'],['📏 Высота','96px / 160px / макс 180px'],['⬛ Соотношение','5:1 (480×96) или 3:1 (480×160)'],['💾 Размер файла','до 2 МБ'],['🎨 Цветовой режим','RGB']].map(([k,v]) => (
            <div key={k} className="bg-white dark:bg-gray-800 rounded-xl px-3 py-2 border border-cyan-100 dark:border-cyan-800">
              <div className="text-gray-500 dark:text-gray-400 mb-0.5">{k}</div>
              <div className="font-semibold text-gray-800 dark:text-gray-200">{v}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <StatCard label="Активных" value={activeCount} icon="campaign" colorClass="text-green-500" />
        <StatCard label="Показов" value={totalImpressions.toLocaleString('ru')} icon="visibility" colorClass="text-cyan-500" />
        <StatCard label="Кликов" value={totalClicks.toLocaleString('ru')} icon="ads_click" colorClass="text-violet-500" />
        <StatCard label="Конверсий" value={totalConversions.toLocaleString('ru')} icon="flag" colorClass="text-amber-500" />
        <StatCard label="CTR" value={`${ctr}%`} icon="percent" colorClass="text-red-500" sub={`${totalClicks} / ${totalImpressions}`} />
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-4">
        <div className="flex gap-2 flex-wrap flex-1 items-center">
          {FILTER_BTNS.map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              disabled={!!filterTag}
              className={`px-4 py-1.5 rounded-full text-xs font-medium border transition ${filterStatus === s ? 'bg-cyan-600 border-cyan-600 text-white' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-cyan-400'} ${filterTag ? 'opacity-40 pointer-events-none' : ''}`}>
              {s ? STATUS_LABELS[s] : 'Все'}
            </button>
          ))}
          <input
            type="text"
            value={filterTag}
            onChange={e => setFilterTag(e.target.value)}
            placeholder="🔍 тег"
            title="Фильтр по тегу (e.g. acne)"
            className="px-3 py-1.5 text-xs border border-gray-300 dark:border-gray-600 rounded-full bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 w-32 focus:outline-none focus:border-cyan-400"
          />
          {filterTag && (
            <button onClick={() => setFilterTag('')} className="text-[10px] text-gray-400 hover:text-gray-700">✕ Сбросить</button>
          )}
        </div>
        <span className="text-xs text-gray-400 dark:text-gray-500">↕ Перетащите для сортировки</span>
      </div>

      {/* Compare bar (multi-select) */}
      {compareSel.size > 0 && (
        <div className="bg-violet-50 dark:bg-violet-900/20 border border-violet-300 dark:border-violet-700 rounded-xl px-4 py-2 mb-4 flex items-center justify-between">
          <div className="text-sm text-violet-700 dark:text-violet-300 font-semibold">
            Выбрано для сравнения: {compareSel.size}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowCompare(true)}
              disabled={compareSel.size < 2}
              className="text-xs px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg font-semibold disabled:opacity-40">
              📊 Сравнить ({compareSel.size})
            </button>
            <button onClick={() => setCompareSel(new Set())} className="text-xs px-3 py-1.5 bg-white dark:bg-gray-700 hover:bg-gray-100 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg">
              Сбросить
            </button>
          </div>
        </div>
      )}

      {err && !showCreate && !editAd && (
        <div className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-sm px-4 py-3 rounded-xl mb-4 border border-red-200 dark:border-red-700">{err}</div>
      )}

      {loading ? (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">Загрузка...</div>
      ) : ads.length === 0 ? (
        <div className="text-center py-16 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-700">
          <span className="material-symbols-outlined text-5xl text-gray-300 dark:text-gray-600 block mb-3">campaign</span>
          <div className="font-semibold text-gray-500 dark:text-gray-400">Объявлений нет</div>
          <div className="text-sm text-gray-400 dark:text-gray-500 mt-1">Создайте первое объявление</div>
        </div>
      ) : (
        <div className="space-y-3">
          {ads.map(ad => {
            const daysLeft = daysBetween(new Date().toISOString().slice(0, 10), ad.end_date)
            const adCtr = ad.impressions_count > 0 ? ((ad.clicks_count / ad.impressions_count) * 100).toFixed(1) : '0.0'
            const isOpen = selected === ad.id
            return (
              <div key={ad.id}
                draggable
                onDragStart={() => setDragId(ad.id)}
                onDragEnd={() => { setDragId(null); setDragOver(null) }}
                onDragOver={e => { e.preventDefault(); setDragOver(ad.id) }}
                onDrop={() => handleDrop(ad.id)}
                onClick={() => setSelected(isOpen ? null : ad.id)}
                className={`bg-white dark:bg-gray-800 rounded-2xl border transition cursor-grab active:cursor-grabbing select-none ${dragOver === ad.id ? 'border-cyan-400 shadow-lg ring-2 ring-cyan-300 dark:ring-cyan-700' : isOpen ? 'border-cyan-500 dark:border-cyan-600 shadow-md' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'} ${dragId === ad.id ? 'opacity-50' : ''}`}>
                <div className="p-4">
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={bulkSel.has(ad.id)}
                      onChange={() => toggleSel(ad.id)}
                      onClick={e => e.stopPropagation()}
                      className="mt-1 w-4 h-4 accent-cyan-600 cursor-pointer flex-shrink-0"
                      title="Выбрать для массовой операции"
                    />
                    <input
                      type="checkbox"
                      checked={compareSel.has(ad.id)}
                      onChange={() => toggleCompareSel(ad.id)}
                      onClick={e => e.stopPropagation()}
                      className="mt-1 w-4 h-4 accent-violet-600 cursor-pointer flex-shrink-0"
                      title="Выбрать для сравнения"
                    />
                    <span className="material-symbols-outlined text-lg text-gray-300 dark:text-gray-600 mt-0.5 flex-shrink-0">drag_indicator</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1.5">
                        <span className="font-bold text-gray-900 dark:text-white text-sm">{ad.title}</span>
                        <Badge status={ad.status} />
                        <ApprovalBadge status={ad.approval_status} note={ad.approval_note} />
                        {ad.status === 'paused' && (ad.impressions_limit || ad.clicks_limit) && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-700">⏸ Авто-пауза</span>
                        )}
                        {ad.ab_variant && (
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${ad.ab_winner ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-300' : 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 border border-violet-300'}`}>
                            {ad.ab_winner ? '🏆 ' : '🅰🅱 '}Вариант {ad.ab_variant}
                          </span>
                        )}
                        {ad.audience && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 border border-violet-200" title={JSON.stringify(ad.audience)}>
                            🎯 Таргет
                          </span>
                        )}
                        {ad.budget_total != null && (
                          <span className={`text-xs px-2 py-0.5 rounded-full ${ad.spent_total >= ad.budget_total ? 'bg-red-50 dark:bg-red-900/30 text-red-600' : 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 border border-emerald-200'}`}>
                            💰 {(ad.spent_total||0).toLocaleString('ru')} / {ad.budget_total.toLocaleString('ru')}₽
                          </span>
                        )}
                        {ad.roi != null && (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${ad.roi >= 0 ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' : 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400'}`}>
                            ROI {ad.roi > 0 ? '+' : ''}{ad.roi}%
                          </span>
                        )}
                        <span className="text-xs text-cyan-600 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-900/30 px-2 py-0.5 rounded-full">⏱ {ad.interval_seconds || 5}с</span>
                        {ad.color_theme && (
                          <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ background: (COLOR_THEMES.find(t=>t.id===ad.color_theme)||COLOR_THEMES[0]).grad }} />
                        )}
                        {ad.schedule && <span className="text-xs px-2 py-0.5 rounded-full bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400">📅 Расписание</span>}
                        {ad.category && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 border border-indigo-200">
                            {(AD_CATEGORIES.find(c => c.value === ad.category) || {}).label || ad.category}
                          </span>
                        )}
                        {Array.isArray(ad.tags) && ad.tags.slice(0, 3).map(tag => (
                          <span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">#{tag}</span>
                        ))}
                        {Array.isArray(ad.tags) && ad.tags.length > 3 && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500">+{ad.tags.length - 3}</span>
                        )}
                        {(ad.freq_per_day || ad.freq_per_hour) && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400" title={`Частота: ${ad.freq_per_hour||'∞'}/час, ${ad.freq_per_day||'∞'}/день`}>
                            🚦 Cap
                          </span>
                        )}
                        {ad.status === 'active' && daysLeft >= 0 && (
                          <span className={`text-xs px-2 py-0.5 rounded-full ${daysLeft <= 3 ? 'text-red-500 bg-red-50 dark:bg-red-900/30' : 'text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700'}`}>
                            {daysLeft === 0 ? 'Последний день' : `${daysLeft} дн.`}
                          </span>
                        )}
                      </div>
                      {ad.body && <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 truncate">{ad.body}</p>}
                      <div className="flex items-center gap-4 text-xs flex-wrap">
                        <span className="text-gray-400 dark:text-gray-500">📅 {ad.start_date} — {ad.end_date}</span>
                        <span className="text-cyan-600 dark:text-cyan-400 font-semibold">👁 {(ad.impressions_count||0).toLocaleString('ru')}</span>
                        <span className="text-violet-600 dark:text-violet-400 font-semibold">🖱 {(ad.clicks_count||0).toLocaleString('ru')}</span>
                        <span className="text-amber-600 dark:text-amber-400 font-semibold">🎯 {(ad.conversions_count||0).toLocaleString('ru')}</span>
                        <span className="text-red-500 dark:text-red-400 font-semibold">CTR {adCtr}%</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0 flex-wrap" onClick={e => e.stopPropagation()}>
                      <button onClick={() => setPreviewAd(ad)} title="Предпросмотр"
                        className="p-1.5 rounded-lg text-gray-400 hover:text-cyan-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition">
                        <span className="material-symbols-outlined text-base" style={{fontVariationSettings:"'FILL' 1"}}>phone_iphone</span>
                      </button>
                      <button onClick={() => setStatsAd(ad)} title="Статистика"
                        className="p-1.5 rounded-lg text-gray-400 hover:text-violet-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition">
                        <span className="material-symbols-outlined text-base" style={{fontVariationSettings:"'FILL' 1"}}>bar_chart</span>
                      </button>
                      <button onClick={() => duplicate(ad)} title="Дублировать"
                        className="p-1.5 rounded-lg text-gray-400 hover:text-green-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition">
                        <span className="material-symbols-outlined text-base" style={{fontVariationSettings:"'FILL' 1"}}>content_copy</span>
                      </button>
                      <button onClick={() => createAbVariant(ad)} title="Создать A/B-вариант"
                        className="p-1.5 rounded-lg text-gray-400 hover:text-violet-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition">
                        <span className="material-symbols-outlined text-base" style={{fontVariationSettings:"'FILL' 1"}}>science</span>
                      </button>
                      <button onClick={() => setShareAd(ad)} title="📤 Поделиться с филиалом"
                        className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition">
                        <span className="material-symbols-outlined text-base" style={{fontVariationSettings:"'FILL' 1"}}>share</span>
                      </button>
                      <button onClick={() => openEdit(ad)}
                        className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition">✏️</button>
                      {canApprove && ad.approval_status === 'pending' && (
                        <>
                          <button onClick={() => approveAd(ad)} disabled={approveBusy === ad.id}
                            title="Одобрить"
                            className="px-2 py-1.5 text-xs font-semibold rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white transition disabled:opacity-50">
                            ✅ Одобрить
                          </button>
                          <button onClick={() => rejectAd(ad)} disabled={approveBusy === ad.id}
                            title="Отклонить"
                            className="px-2 py-1.5 text-xs font-semibold rounded-lg bg-red-500 hover:bg-red-600 text-white transition disabled:opacity-50">
                            ❌ Отклонить
                          </button>
                        </>
                      )}
                      {ad.status === 'draft' && (
                        <button onClick={() => updateStatus(ad, 'active')} disabled={updatingStatus === ad.id}
                          className="px-2 py-1.5 text-xs font-semibold rounded-lg bg-green-500 text-white hover:bg-green-600 transition whitespace-nowrap">▶ Пуск</button>
                      )}
                      {ad.status === 'active' && (
                        <button onClick={() => updateStatus(ad, 'paused')} disabled={updatingStatus === ad.id}
                          className="px-2 py-1.5 text-xs font-semibold rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition">⏸</button>
                      )}
                      {ad.status === 'paused' && (
                        <button onClick={() => updateStatus(ad, 'active')} disabled={updatingStatus === ad.id}
                          className="px-2 py-1.5 text-xs font-semibold rounded-lg bg-green-500 text-white hover:bg-green-600 transition">▶</button>
                      )}
                      {!['cancelled','completed'].includes(ad.status) && (
                        <button onClick={() => updateStatus(ad, 'cancelled')} disabled={updatingStatus === ad.id}
                          className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition" title="Отменить">
                          <span className="material-symbols-outlined text-base">close</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {isOpen && (
                    <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                        {[
                          { label: 'Показы', value: ad.impressions_count||0, limit: ad.impressions_limit, cls: 'text-cyan-600 dark:text-cyan-400', bar: 'bg-cyan-500' },
                          { label: 'Клики', value: ad.clicks_count||0, limit: ad.clicks_limit, cls: 'text-violet-600 dark:text-violet-400', bar: 'bg-violet-500' },
                          { label: 'Конверсии', value: ad.conversions_count||0, limit: null, cls: 'text-amber-600 dark:text-amber-400', bar: null },
                          { label: 'CTR', value: adCtr+'%', limit: null, cls: 'text-red-500 dark:text-red-400', bar: null },
                        ].map(s => (
                          <div key={s.label} className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3">
                            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide">{s.label}</div>
                            <div className={`text-2xl font-bold ${s.cls}`}>{typeof s.value==='number' ? s.value.toLocaleString('ru') : s.value}</div>
                            {s.limit && <ProgressBar value={s.value} max={s.limit} colorClass={s.bar} />}
                          </div>
                        ))}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3">
                          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide">Карусель</div>
                          <div className="text-sm text-gray-700 dark:text-gray-300 space-y-0.5">
                            <div>⏱ Интервал: <span className="font-semibold">{ad.interval_seconds||5} сек</span></div>
                            <div>📐 Высота: <span className="font-semibold">{ad.banner_height||96}px</span></div>
                            {ad.image_data && <div className="text-green-600 dark:text-green-400">🖼️ Изображение загружено</div>}
                          </div>
                        </div>
                        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3">
                          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide">Ссылка</div>
                          {ad.link
                            ? <a href={ad.link} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} className="text-cyan-600 dark:text-cyan-400 text-xs break-all hover:underline">{ad.link}</a>
                            : <span className="text-gray-400 dark:text-gray-500 text-sm">Не указана</span>}
                        </div>
                        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3">
                          {ad.schedule ? (
                            <>
                              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide">Расписание</div>
                              {ad.schedule.days && <div className="text-xs text-gray-700 dark:text-gray-300">{ad.schedule.days.map(d=>DAYS_OF_WEEK[d]).join(', ')}</div>}
                              {ad.schedule.hours?.length > 0 && <div className="text-xs text-gray-700 dark:text-gray-300">{Math.min(...ad.schedule.hours)}:00 – {Math.max(...ad.schedule.hours)}:00</div>}
                            </>
                          ) : (
                            <>
                              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide">Цена</div>
                              <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">{Number(ad.price).toLocaleString('ru')} ₽</div>
                              <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{{ flat:'Фикс.', cpc:'CPC', cpm:'CPM' }[ad.pricing_model]}</div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Модалка выбора шаблона */}
      {showTemplates && (
        <Modal title="Выбрать шаблон" onClose={() => setShowTemplates(false)}>
          {templates.length === 0 ? (
            <div className="py-10 text-center text-gray-400">
              <span className="material-symbols-outlined text-5xl block mb-2">bookmark_add</span>
              <div>Шаблонов ещё нет.</div>
              <div className="text-xs mt-1">Сохраните любое объявление как шаблон в форме создания.</div>
            </div>
          ) : (
            <ul className="space-y-2 max-h-[60vh] overflow-y-auto">
              {templates.map(t => (
                <li key={t.id}
                    className="border border-gray-200 dark:border-gray-700 rounded-xl p-3 hover:border-cyan-400 dark:hover:border-cyan-500 cursor-pointer transition"
                    onClick={() => useTemplate(t.id)}>
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <div className="font-semibold text-gray-900 dark:text-white text-sm flex-1 min-w-0 truncate">{t.title}</div>
                    {t.cta_text && <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-50 text-cyan-700">CTA: {t.cta_text}</span>}
                    {t.audience && <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-50 text-violet-700">🎯 Таргет</span>}
                  </div>
                  {t.body && <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{t.body}</div>}
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}

      {showCreate && (
        <Modal title="Новое объявление" onClose={() => setShowCreate(false)} wide>
          <AdForm form={form} set={set} err={err} saving={saving} onSave={save} onCancel={() => setShowCreate(false)} isEdit={false} onOpenCrop={src => setCropCtx({ ...src, target: 'create' })} token={token} />
        </Modal>
      )}

      {editAd && (
        <Modal title="Редактировать объявление" onClose={() => setEditAd(null)} wide>
          <AdForm form={form} set={set} err={err} saving={saving} onSave={saveEdit} onCancel={() => setEditAd(null)} isEdit={true} onOpenCrop={src => setCropCtx({ ...src, target: 'edit' })} token={token} />
        </Modal>
      )}

      {cropCtx && (
        <div className="fixed inset-0 bg-black/75 z-[500] flex items-center justify-center p-4" onClick={() => setCropCtx(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-bold text-gray-900 dark:text-white text-base flex items-center gap-2">
                <span className="material-symbols-outlined text-cyan-500" style={{fontVariationSettings:"'FILL' 1"}}>crop</span>
                Редактор изображения
              </h4>
              <button onClick={() => setCropCtx(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none">✕</button>
            </div>
            <ImageCropEditor
              src={cropCtx.data} mime={cropCtx.mime}
              onDone={(b64, mime) => { set('image_data', b64); set('image_mime', mime); setCropCtx(null) }}
              onCancel={() => setCropCtx(null)}
            />
          </div>
        </div>
      )}

      {previewAd && <BannerPreview ad={previewAd} onClose={() => setPreviewAd(null)} />}
      {statsAd && <StatsModal ad={statsAd} token={token} onClose={() => setStatsAd(null)} />}

      {/* Новые модалки фазы UI-апдейта */}
      {showGallery && (
        <TemplateGalleryModal token={token} onClose={() => setShowGallery(false)} onUse={useTemplateFromGallery} />
      )}
      {showBulkGen && (
        <BulkGenerateModal token={token} onClose={() => setShowBulkGen(false)} onDone={load} />
      )}
      {shareAd && (
        <ShareToBranchModal ad={shareAd} token={token} onClose={() => setShareAd(null)} onDone={load} />
      )}
      {showCompare && compareSel.size >= 2 && (
        <CompareModal ids={[...compareSel]} ads={ads} token={token} onClose={() => setShowCompare(false)} />
      )}
    </div>
  )
}
