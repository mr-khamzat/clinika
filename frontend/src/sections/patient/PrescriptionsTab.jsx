// ═════ БЛОК: PrescriptionsTab — премиум карточки рецептов ═════
// Вкладка "Назначения" в кабинете пациента: лекарства из МИС и локального кэша.
// Премиум карточки: hero-иконка по форме, расписание приёма (утро/день/вечер/ночь),
// прогресс-бар курса, кнопка "Принял дозу", status chip.
//
// Props: { sessionToken, apiBase }
//
// Эндпоинт:
//   GET /patient/prescriptions  → { items: [...], mis_available: bool, count: int }
import { useEffect, useState, useCallback, useMemo } from 'react'
import axios from 'axios'

function formatDate(iso) {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })
  } catch { return iso }
}

function formatDateShort(iso) {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })
  } catch { return iso }
}

// ═════ БЛОК: PrescriptionsTab — детектор формы лекарства по названию ═════
function detectForm(name = '', dosage = '') {
  const s = `${name} ${dosage}`.toLowerCase()
  if (/(сироп|раств|капл|суспенз|микстур|жидк|спрей|ингал|мл\b)/i.test(s)) {
    return { icon: 'water_drop', label: 'жидкость', gradient: 'linear-gradient(135deg,#67E8F9,#0EA5E9)', tint: '#0EA5E9', bg: 'linear-gradient(135deg,#ECFEFF,#CFFAFE)' }
  }
  if (/(капсул|caps)/i.test(s)) {
    return { icon: 'pill', label: 'капсула', gradient: 'linear-gradient(135deg,#A78BFA,#7C3AED)', tint: '#7C3AED', bg: 'linear-gradient(135deg,#F5F3FF,#EDE9FE)' }
  }
  if (/(мазь|крем|гель|бальзам|пласт)/i.test(s)) {
    return { icon: 'healing', label: 'мазь', gradient: 'linear-gradient(135deg,#FBBF24,#F59E0B)', tint: '#D97706', bg: 'linear-gradient(135deg,#FFFBEB,#FEF3C7)' }
  }
  if (/(укол|инъек|ампул|шприц)/i.test(s)) {
    return { icon: 'syringe', label: 'инъекция', gradient: 'linear-gradient(135deg,#FCA5A5,#EF4444)', tint: '#DC2626', bg: 'linear-gradient(135deg,#FEF2F2,#FEE2E2)' }
  }
  // Дефолт — таблетка
  return { icon: 'medication', label: 'таблетка', gradient: 'linear-gradient(135deg,#22D3EE,#1565C0)', tint: '#0097A7', bg: 'linear-gradient(135deg,#ECFEFF,#E0F7FA)' }
}

// ═════ БЛОК: PrescriptionsTab — парсинг частоты в слоты ═════
// Возвращает массив активных слотов из (утро/день/вечер/ночь).
// Если ничего не распознано — пытаемся вывести по числу: 1=утро, 2=утро+вечер, 3=утро+день+вечер, 4=все.
function parseFrequencyToSlots(freq = '') {
  const s = String(freq).toLowerCase()
  const slots = new Set()
  if (/утр|morning|после\s*завтр/.test(s)) slots.add('morning')
  if (/(в\s+обед|днем|дня|после\s*обед|noon|midday|полдн)/.test(s)) slots.add('noon')
  if (/(вечер|после\s*ужин|evening)/.test(s)) slots.add('evening')
  if (/(ночь|перед\s*сном|night)/.test(s)) slots.add('night')
  if (slots.size > 0) return slots
  // Парсим числа
  const m = s.match(/(\d+)\s*(р|раз)/) || s.match(/^(\d+)/)
  const n = m ? parseInt(m[1], 10) : 0
  if (n >= 4) return new Set(['morning', 'noon', 'evening', 'night'])
  if (n === 3) return new Set(['morning', 'noon', 'evening'])
  if (n === 2) return new Set(['morning', 'evening'])
  if (n === 1) return new Set(['morning'])
  return new Set()
}

// ═════ БЛОК: PrescriptionsTab — парсинг длительности в дни ═════
function parseDurationDays(duration = '') {
  const s = String(duration).toLowerCase()
  const m = s.match(/(\d+)/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (/нед/.test(s)) return n * 7
  if (/мес/.test(s)) return n * 30
  return n
}

// ═════ БЛОК: PrescriptionsTab — Slot (один временной слот приёма) ═════
const SLOT_META = [
  { key: 'morning', label: 'Утро',  time: '08:00', icon: 'wb_sunny' },
  { key: 'noon',    label: 'День',  time: '13:00', icon: 'wb_twilight' },
  { key: 'evening', label: 'Вечер', time: '19:00', icon: 'partly_cloudy_night' },
  { key: 'night',   label: 'Ночь',  time: '23:00', icon: 'bedtime' },
]

function Slot({ slot, active, taken, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={!active}
      className="flex-1 flex flex-col items-center justify-center py-2 rounded-xl transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
      style={{
        background: taken
          ? 'linear-gradient(135deg,#10B981,#059669)'
          : active
          ? 'rgba(0,151,167,.08)'
          : 'rgba(148,163,184,.08)',
        border: taken
          ? '1px solid rgba(16,185,129,.4)'
          : active
          ? '1px solid rgba(0,151,167,.22)'
          : '1px solid rgba(148,163,184,.18)',
        color: taken ? '#fff' : active ? '#0097A7' : '#94A3B8',
        boxShadow: taken ? '0 4px 10px rgba(16,185,129,.22), inset 0 1px 0 rgba(255,255,255,.25)' : 'none',
      }}
    >
      <span
        className="material-symbols-outlined"
        style={{ fontSize: 16, lineHeight: '16px', fontVariationSettings: taken ? "'FILL' 1" : "'FILL' 0" }}
      >
        {taken ? 'check_circle' : slot.icon}
      </span>
      <span className="font-semibold mt-0.5" style={{ fontSize: 10, lineHeight: '12px' }}>{slot.label}</span>
      <span className="opacity-70" style={{ fontSize: 9, lineHeight: '11px' }}>{slot.time}</span>
    </button>
  )
}

// ═════ БЛОК: PrescriptionsTab — PrescriptionCard ═════
function PrescriptionCard({ p, index }) {
  const isLive = p.source === 'mis'
  const form = useMemo(() => detectForm(p.drug_name, p.dosage), [p.drug_name, p.dosage])
  const slots = useMemo(() => parseFrequencyToSlots(p.frequency), [p.frequency])
  const totalDays = useMemo(() => parseDurationDays(p.duration), [p.duration])

  // Локальный state: какие слоты уже приняты сегодня + сколько дней прошло
  const [taken, setTaken] = useState(() => new Set())
  const [dayIndex, setDayIndex] = useState(() => {
    if (!p.prescribed_at) return 1
    try {
      const start = new Date(p.prescribed_at)
      const days = Math.floor((Date.now() - start.getTime()) / (24 * 3600 * 1000)) + 1
      return Math.max(1, totalDays ? Math.min(days, totalDays) : days)
    } catch { return 1 }
  })

  const isFinished = totalDays && dayIndex >= totalDays
  const progress = totalDays ? Math.min(100, (dayIndex / totalDays) * 100) : 0

  const toggleSlot = (k) => {
    setTaken((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  // Кнопка "Принял дозу" — отмечает следующий неотмеченный активный слот
  const handleDose = () => {
    const nextSlot = SLOT_META.find((s) => slots.has(s.key) && !taken.has(s.key))
    if (nextSlot) {
      setTaken((prev) => new Set(prev).add(nextSlot.key))
      // tactile hint
      if (navigator.vibrate) navigator.vibrate(10)
    } else if (!totalDays || dayIndex < totalDays) {
      // Новый день — сбрасываем
      setTaken(new Set())
      setDayIndex((d) => d + 1)
    }
  }

  const dosesTakenToday = taken.size
  const totalSlots = slots.size

  return (
    <div
      className="bg-white dark:bg-gray-800 rounded-2xl overflow-hidden"
      style={{
        border: '1px solid rgba(0,0,0,.05)',
        boxShadow: '0 4px 16px rgba(0,0,0,.06), inset 0 1px 0 rgba(255,255,255,.5)',
        animation: `prescPop 360ms cubic-bezier(.4,0,.2,1) ${index * 50}ms both`,
      }}
    >
      {/* ═════ БЛОК: PrescriptionCard — hero header ═════ */}
      <div className="p-4 pb-3">
        <div className="flex items-start gap-3">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 relative"
            style={{
              background: form.bg,
              boxShadow: '0 4px 12px rgba(0,0,0,.05), inset 0 1px 0 rgba(255,255,255,.5)',
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{
                fontSize: 24,
                background: form.gradient,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                fontVariationSettings: "'FILL' 1",
              }}
            >
              {form.icon}
            </span>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <p className="font-bold text-gray-900 dark:text-gray-50 text-base leading-tight break-words flex-1">
                {p.drug_name || '—'}
              </p>
              {p.dosage && (
                <span
                  className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-lg shrink-0"
                  style={{
                    background: form.bg,
                    color: form.tint,
                    border: '1px solid rgba(0,0,0,.04)',
                    letterSpacing: '.5px',
                  }}
                >
                  {p.dosage}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-md inline-flex items-center gap-1"
                style={{
                  background: isFinished ? 'rgba(148,163,184,.14)' : 'rgba(16,185,129,.14)',
                  color: isFinished ? '#64748B' : '#059669',
                }}
              >
                <span
                  className="inline-block rounded-full"
                  style={{ width: 6, height: 6, background: isFinished ? '#94A3B8' : '#10B981' }}
                />
                {isFinished ? 'Закончен' : 'Активный'}
              </span>
              {!isLive && (
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-md"
                  style={{ background: '#FEF3C7', color: '#92400E' }}
                >
                  из кэша
                </span>
              )}
              {p.doctor_name && (
                <span className="text-[10px] text-gray-500 dark:text-gray-400 truncate">· {p.doctor_name}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ═════ БЛОК: PrescriptionCard — расписание приёма ═════ */}
      {totalSlots > 0 && (
        <div className="px-4 pb-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              Расписание
            </p>
            <p className="text-[10px] text-gray-500 dark:text-gray-400">
              <span className="font-bold text-gray-700 dark:text-gray-200">{dosesTakenToday}</span>
              <span className="opacity-60">/{totalSlots} сегодня</span>
            </p>
          </div>
          <div className="flex items-stretch gap-1.5">
            {SLOT_META.map((s) => (
              <Slot
                key={s.key}
                slot={s}
                active={slots.has(s.key)}
                taken={taken.has(s.key)}
                onToggle={() => toggleSlot(s.key)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ═════ БЛОК: PrescriptionCard — мета (даты, длительность) ═════ */}
      <div className="px-4 pb-3 flex items-center gap-3 text-[11px] text-gray-500 dark:text-gray-400 flex-wrap">
        {p.prescribed_at && (
          <span className="inline-flex items-center gap-1">
            <span className="material-symbols-outlined" style={{ fontSize: 12 }}>event</span>
            с {formatDateShort(p.prescribed_at)}
          </span>
        )}
        {totalDays && (
          <span className="inline-flex items-center gap-1">
            <span className="material-symbols-outlined" style={{ fontSize: 12 }}>timer</span>
            {totalDays} дн.
          </span>
        )}
        {p.frequency && !totalSlots && (
          <span className="inline-flex items-center gap-1">
            <span className="material-symbols-outlined" style={{ fontSize: 12 }}>schedule</span>
            {p.frequency}
          </span>
        )}
      </div>

      {/* ═════ БЛОК: PrescriptionCard — кнопка "Принял дозу" ═════ */}
      {!isFinished && totalSlots > 0 && (
        <div className="px-4 pb-3">
          <button
            type="button"
            onClick={handleDose}
            disabled={dosesTakenToday >= totalSlots}
            className="w-full py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 transition-all active:scale-[.98] disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background:
                dosesTakenToday >= totalSlots
                  ? 'rgba(16,185,129,.12)'
                  : 'linear-gradient(135deg,#0097A7 0%,#1565C0 100%)',
              color: dosesTakenToday >= totalSlots ? '#059669' : '#fff',
              boxShadow:
                dosesTakenToday >= totalSlots
                  ? 'none'
                  : '0 6px 16px rgba(21,101,192,.28), inset 0 1px 0 rgba(255,255,255,.35)',
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}
            >
              {dosesTakenToday >= totalSlots ? 'check_circle' : 'add_circle'}
            </span>
            {dosesTakenToday >= totalSlots ? 'Все дозы приняты сегодня' : 'Принял дозу'}
          </button>
        </div>
      )}

      {/* ═════ БЛОК: PrescriptionCard — прогресс курса ═════ */}
      {totalDays ? (
        <div className="px-4 pb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400">
              Курс
            </span>
            <span className="text-[10px] font-bold text-gray-700 dark:text-gray-200">
              {dayIndex}<span className="opacity-50">/{totalDays} дн.</span>
            </span>
          </div>
          <div
            className="w-full rounded-full overflow-hidden"
            style={{ height: 4, background: 'rgba(148,163,184,.18)' }}
          >
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${progress}%`,
                background: isFinished
                  ? 'linear-gradient(90deg,#94A3B8,#64748B)'
                  : 'linear-gradient(90deg,#0097A7 0%,#1565C0 100%)',
                boxShadow: isFinished ? 'none' : '0 0 8px rgba(21,101,192,.4)',
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default function PrescriptionsTab({ sessionToken, apiBase = '/api' }) {
  const [items, setItems] = useState([])
  const [misAvailable, setMisAvailable] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    if (!sessionToken) { setLoading(false); return }
    setLoading(true); setError(null)
    try {
      const r = await axios.get(`${apiBase}/patient/prescriptions`, {
        params: { session_token: sessionToken, t: sessionToken },
      })
      setItems(Array.isArray(r.data?.items) ? r.data.items : [])
      setMisAvailable(Boolean(r.data?.mis_available))
    } catch {
      setError('Не удалось загрузить назначения')
    } finally {
      setLoading(false)
    }
  }, [sessionToken, apiBase])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div className="space-y-3">
        <style>{`@keyframes prescPop{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}`}</style>
        {[0,1].map(i => (
          <div key={i} className="bg-white dark:bg-gray-800 rounded-2xl p-4 animate-pulse"
               style={{ border: '1px solid rgba(0,0,0,.05)', boxShadow: '0 4px 16px rgba(0,0,0,.05)' }}>
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gray-100 dark:bg-gray-700" />
              <div className="flex-1">
                <div className="h-4 bg-gray-100 dark:bg-gray-700 rounded w-3/4 mb-2" />
                <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded w-1/2" />
              </div>
            </div>
            <div className="h-10 bg-gray-50 dark:bg-gray-700/50 rounded-xl mt-3" />
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 text-center"
           style={{ border: '1px solid rgba(0,0,0,.05)', boxShadow: '0 4px 16px rgba(0,0,0,.06)' }}>
        <p className="text-sm text-red-500">{error}</p>
        <button onClick={load} className="text-xs text-blue-500 mt-2 font-semibold">Повторить</button>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-8 text-center"
           style={{ border: '1px solid rgba(0,0,0,.05)', boxShadow: '0 4px 16px rgba(0,0,0,.06), inset 0 1px 0 rgba(255,255,255,.5)' }}>
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
             style={{
               background: 'linear-gradient(135deg,#ECFEFF,#E0F7FA)',
               boxShadow: '0 6px 16px rgba(0,151,167,.15), inset 0 1px 0 rgba(255,255,255,.6)',
             }}>
          <span
            className="material-symbols-outlined text-3xl"
            style={{
              background: 'linear-gradient(135deg,#22D3EE,#1565C0)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              fontVariationSettings: "'FILL' 1",
            }}
          >
            medication
          </span>
        </div>
        <p className="text-gray-800 dark:text-gray-100 font-bold">Назначений пока нет</p>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
          {misAvailable
            ? 'Здесь появятся лекарства, выписанные врачом'
            : 'МИС недоступна — назначения появятся, когда связь восстановится'}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <style>{`@keyframes prescPop{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}`}</style>
      {!misAvailable && items.length > 0 && (
        <div
          className="rounded-2xl p-3 flex items-center gap-2 text-xs"
          style={{
            background: 'linear-gradient(135deg,#FFFBEB,#FEF3C7)',
            border: '1px solid rgba(245,158,11,.3)',
            color: '#92400E',
            boxShadow: '0 4px 16px rgba(245,158,11,.08), inset 0 1px 0 rgba(255,255,255,.5)',
          }}
        >
          <span className="material-symbols-outlined text-base" style={{ color: '#D97706' }}>cloud_off</span>
          <span className="font-medium">Показаны данные из кэша. Подключение к МИС временно недоступно.</span>
        </div>
      )}
      {items.map((p, i) => (
        <PrescriptionCard key={`${p.source}-${p.id || p.mis_id || i}`} p={p} index={i} />
      ))}
    </div>
  )
}
