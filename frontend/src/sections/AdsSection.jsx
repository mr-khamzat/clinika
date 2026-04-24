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
function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-6 pb-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition text-xl leading-none">✕</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}

const inputCls = 'block w-full mt-1.5 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500 box-border'
const labelCls = 'text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide'

const EMPTY_FORM = {
  title: '', body: '', image_data: null, image_mime: null, banner_height: '96',
  interval_seconds: '5', link: '', ad_type: 'banner', pricing_model: 'flat',
  start_date: new Date().toISOString().slice(0, 10),
  end_date: addDays(new Date().toISOString().slice(0, 10), 7),
  price: '0', impressions_limit: '', clicks_limit: '',
  sort_order: '0', color_theme: '',
  schedule_hours_start: '', schedule_hours_end: '', schedule_days: [],
}

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

function StatsModal({ ad, token, onClose }) {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(30)
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
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 pb-4 border-b border-gray-100 dark:border-gray-700">
          <div>
            <h3 className="text-base font-bold text-gray-900 dark:text-white">Статистика</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate max-w-xs">{ad.title}</p>
          </div>
          <div className="flex items-center gap-2">
            <select value={days} onChange={e => setDays(Number(e.target.value))}
              className="text-xs border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300">
              {[7,14,30,60,90].map(d => <option key={d} value={d}>{d} дней</option>)}
            </select>
            <button onClick={openReport} disabled={reporting || !stats}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-semibold rounded-lg transition disabled:opacity-50">
              <span className="material-symbols-outlined text-sm" style={{fontVariationSettings:"'FILL' 1"}}>description</span>
              {reporting ? 'Генерация...' : 'Отчёт PDF'}
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none ml-1">✕</button>
          </div>
        </div>
        <div className="p-5">
          {loading ? (
            <div className="text-center py-12 text-gray-400">Загрузка...</div>
          ) : !stats ? (
            <div className="text-center py-12 text-red-400">Ошибка загрузки</div>
          ) : (
            <div className="space-y-5">
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: 'Показов', value: stats.totals.impressions, color: 'text-cyan-600 dark:text-cyan-400' },
                  { label: 'Кликов', value: stats.totals.clicks, color: 'text-violet-600 dark:text-violet-400' },
                  { label: 'Конверсий', value: stats.totals.conversions, color: 'text-amber-600 dark:text-amber-400' },
                  { label: 'CTR', value: stats.totals.ctr + '%', color: 'text-red-500 dark:text-red-400' },
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
                      <div className="w-3 h-3 rounded-full" style={{background:c}} />{l}
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
          )}
        </div>
      </div>
    </div>
  )
}

function AdForm({ form, set, err, saving, onSave, onCancel, isEdit, onOpenCrop }) {
  const fileInputRef = useRef(null)
  const days = daysBetween(form.start_date, form.end_date)
  const [showSchedule, setShowSchedule] = useState(false)

  const toggleDay = (idx) => {
    const curr = form.schedule_days || []
    const next = curr.includes(idx) ? curr.filter(d => d !== idx) : [...curr, idx].sort((a,b)=>a-b)
    set('schedule_days', next)
  }

  return (
    <div className="space-y-4">
      {err && <div className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-sm px-4 py-3 rounded-xl border border-red-200 dark:border-red-700">{err}</div>}

      <div>
        <label className={labelCls}>Заголовок *</label>
        <input value={form.title} onChange={e => set('title', e.target.value)} placeholder="Акция: скидка 20% на МРТ" className={inputCls} />
      </div>

      <div>
        <label className={labelCls}>Текст объявления</label>
        <textarea value={form.body} onChange={e => set('body', e.target.value)} placeholder="Подробное описание..." rows={3}
          className={inputCls + ' resize-y'} />
      </div>

      <div>
        <label className={labelCls}>Изображение баннера</label>
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

      <div className="border border-gray-200 dark:border-gray-600 rounded-xl overflow-hidden">
        <button type="button" onClick={() => setShowSchedule(s => !s)}
          className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-700/50 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition">
          <span className="flex items-center gap-2">
            <span className="material-symbols-outlined text-base text-gray-500">schedule</span>
            Расписание показа
            {(form.schedule_days?.length > 0 || form.schedule_hours_start) && (
              <span className="text-xs bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-400 px-2 py-0.5 rounded-full">Настроено</span>
            )}
          </span>
          <span className="material-symbols-outlined text-base text-gray-400">{showSchedule ? 'expand_less' : 'expand_more'}</span>
        </button>
        {showSchedule && (
          <div className="px-4 py-4 space-y-4">
            <div>
              <label className={labelCls}>Дни показа (пусто = все дни)</label>
              <div className="flex gap-2 mt-2 flex-wrap">
                {DAYS_OF_WEEK.map((d, i) => (
                  <button key={i} type="button" onClick={() => toggleDay(i)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition ${(form.schedule_days || []).includes(i) ? 'bg-cyan-600 border-cyan-600 text-white' : 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-cyan-400'}`}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Час начала (0–23)</label>
                <input type="number" value={form.schedule_hours_start} onChange={e => set('schedule_hours_start', e.target.value)}
                  placeholder="9" min="0" max="23" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Час окончания (0–23)</label>
                <input type="number" value={form.schedule_hours_end} onChange={e => set('schedule_hours_end', e.target.value)}
                  placeholder="21" min="0" max="23" className={inputCls} />
              </div>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500">Реклама показывается только в указанные часы и дни</p>
          </div>
        )}
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
    </div>
  )
}

export default function AdsSection({ token }) {
  const [ads, setAds] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('')
  const [showCreate, setShowCreate] = useState(false)
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

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = filterStatus ? `?status=${filterStatus}` : ''
      const r = await apiFetch(token, `/ads${params}`)
      if (r.ok) setAds(await r.json())
    } catch {}
    setLoading(false)
  }, [token, filterStatus])

  useEffect(() => { load() }, [load])

  const resetForm = () => { setForm(EMPTY_FORM); setErr('') }

  const openEdit = (ad) => {
    setEditAd(ad)
    const schedule = ad.schedule || {}
    setForm({
      title: ad.title || '', body: ad.body || '',
      image_data: ad.image_data || null, image_mime: ad.image_mime || null,
      banner_height: String(ad.banner_height || 96),
      interval_seconds: String(ad.interval_seconds || 5),
      link: ad.link || '', ad_type: ad.ad_type || 'banner',
      pricing_model: ad.pricing_model || 'flat',
      start_date: ad.start_date || new Date().toISOString().slice(0, 10),
      end_date: ad.end_date || addDays(new Date().toISOString().slice(0, 10), 7),
      price: String(ad.price ?? 0),
      impressions_limit: ad.impressions_limit ? String(ad.impressions_limit) : '',
      clicks_limit: ad.clicks_limit ? String(ad.clicks_limit) : '',
      sort_order: String(ad.sort_order ?? 0),
      color_theme: ad.color_theme || '',
      schedule_days: schedule.days || [],
      schedule_hours_start: schedule.hours?.length ? String(Math.min(...schedule.hours)) : '',
      schedule_hours_end: schedule.hours?.length ? String(Math.max(...schedule.hours)) : '',
    })
    setErr('')
  }

  const validate = () => {
    if (!form.title.trim()) { setErr('Укажите заголовок'); return false }
    if (!form.start_date || !form.end_date) { setErr('Укажите даты'); return false }
    return true
  }

  const buildSchedule = () => {
    const days = form.schedule_days?.length > 0 ? form.schedule_days : null
    let hours = null
    if (form.schedule_hours_start !== '' && form.schedule_hours_end !== '') {
      const s = Number(form.schedule_hours_start), e = Number(form.schedule_hours_end)
      if (e >= s) hours = Array.from({ length: e - s + 1 }, (_, i) => s + i).filter(h => h >= 0 && h <= 23)
    }
    if (!days && !hours) return null
    return { days, hours }
  }

  const buildPayload = () => ({
    title: form.title.trim(), body: form.body.trim() || null,
    image_data: form.image_data || null, image_mime: form.image_mime || null,
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
  })

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

  const duplicate = async (ad) => {
    try {
      const r = await apiFetch(token, `/ads/${ad.id}/duplicate`, { method: 'POST' })
      if (r.ok) load()
    } catch {}
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
        <div className="flex items-center gap-2">
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
        <div className="flex gap-2 flex-wrap flex-1">
          {FILTER_BTNS.map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`px-4 py-1.5 rounded-full text-xs font-medium border transition ${filterStatus === s ? 'bg-cyan-600 border-cyan-600 text-white' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-cyan-400'}`}>
              {s ? STATUS_LABELS[s] : 'Все'}
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-400 dark:text-gray-500">↕ Перетащите для сортировки</span>
      </div>

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
                    <span className="material-symbols-outlined text-lg text-gray-300 dark:text-gray-600 mt-0.5 flex-shrink-0">drag_indicator</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1.5">
                        <span className="font-bold text-gray-900 dark:text-white text-sm">{ad.title}</span>
                        <Badge status={ad.status} />
                        {ad.status === 'paused' && (ad.impressions_limit || ad.clicks_limit) && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-700">⏸ Авто-пауза</span>
                        )}
                        <span className="text-xs text-cyan-600 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-900/30 px-2 py-0.5 rounded-full">⏱ {ad.interval_seconds || 5}с</span>
                        {ad.color_theme && (
                          <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ background: (COLOR_THEMES.find(t=>t.id===ad.color_theme)||COLOR_THEMES[0]).grad }} />
                        )}
                        {ad.schedule && <span className="text-xs px-2 py-0.5 rounded-full bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400">📅 Расписание</span>}
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
                      <button onClick={() => openEdit(ad)}
                        className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition">✏️</button>
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

      {showCreate && (
        <Modal title="Новое объявление" onClose={() => setShowCreate(false)}>
          <AdForm form={form} set={set} err={err} saving={saving} onSave={save} onCancel={() => setShowCreate(false)} isEdit={false} onOpenCrop={src => setCropCtx({ ...src, target: 'create' })} />
        </Modal>
      )}

      {editAd && (
        <Modal title="Редактировать объявление" onClose={() => setEditAd(null)}>
          <AdForm form={form} set={set} err={err} saving={saving} onSave={saveEdit} onCancel={() => setEditAd(null)} isEdit={true} onOpenCrop={src => setCropCtx({ ...src, target: 'edit' })} />
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
    </div>
  )
}
