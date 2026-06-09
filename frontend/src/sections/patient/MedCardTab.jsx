// ═════ БЛОК: MedCardTab — премиум-медкарта пациента (Клиника) ═════
// Mobile-first, аккордеон-секции с цветной accent-полосой слева.
// Tailwind dark mode (class). Material-symbols-outlined с FILL=1.
// Stagger pop-in, glass карточки, secondary cards с premium styling.
//
// Props: { token, sessionToken, phone, apiBase }
//
// Эндпоинты (через session_token):
//   GET /patient/medcard/diagnoses
//   GET /patient/medcard/allergies
//   GET /patient/medcard/vaccinations
//   GET /patient/medcard/timeline
import { useEffect, useState, useCallback } from 'react'
import axios from 'axios'

// ═════ Палитра по типу секции ═════
// red→allergies, blue→diagnoses, green→vaccinations, purple→prescriptions, cyan→labs
const SECTION_THEME = {
  timeline:     { accent: '#0EA5E9', from: '#0EA5E9', to: '#0284C7', soft: '#E0F2FE', icon: 'history' },
  diagnoses:    { accent: '#1565C0', from: '#3B82F6', to: '#1565C0', soft: '#DBEAFE', icon: 'local_hospital' },
  allergies:    { accent: '#EF4444', from: '#F87171', to: '#EF4444', soft: '#FEE2E2', icon: 'warning' },
  vaccinations: { accent: '#10B981', from: '#34D399', to: '#10B981', soft: '#D1FAE5', icon: 'vaccines' },
}

const SEVERITY_LABEL = {
  mild:     { label: 'лёгкая',  color: '#10B981', bg: '#ECFDF5', icon: 'sentiment_satisfied' },
  moderate: { label: 'средняя', color: '#F59E0B', bg: '#FFFBEB', icon: 'sentiment_neutral' },
  severe:   { label: 'тяжёлая', color: '#EF4444', bg: '#FEF2F2', icon: 'sentiment_very_dissatisfied' },
}

const DOC_TYPE_LABEL = {
  reference:  { label: 'Справка',     icon: 'description' },
  extract:    { label: 'Выписка',     icon: 'article' },
  sick_leave: { label: 'Больничный',  icon: 'sick' },
  other:      { label: 'Документ',    icon: 'folder' },
}
export { DOC_TYPE_LABEL }

function formatDate(iso) {
  if (!iso) return null
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })
  } catch { return iso }
}

// ═════ БЛОК: Section — премиум-аккордеон с accent-баром ═════
function Section({ themeKey, title, count, children, defaultOpen = true, index = 0 }) {
  const [open, setOpen] = useState(defaultOpen)
  const t = SECTION_THEME[themeKey] || SECTION_THEME.diagnoses
  const countLabel = count > 0 ? `${count} запис${count === 1 ? 'ь' : count < 5 ? 'и' : 'ей'}` : 'нет данных'
  return (
    <div
      className="medcard-section relative bg-white dark:bg-gray-800 rounded-2xl overflow-hidden"
      style={{
        border: '1px solid rgba(0,0,0,.06)',
        boxShadow: '0 4px 16px rgba(0,0,0,.06), inset 0 1px 0 rgba(255,255,255,.5)',
        animation: `medcard-pop .42s cubic-bezier(.22,1,.36,1) ${index * 0.05}s both`,
      }}
    >
      {/* Accent bar — 3px inset слева */}
      <div
        aria-hidden
        className="absolute left-0 top-0 bottom-0"
        style={{ width: 3, background: `linear-gradient(180deg, ${t.from}, ${t.to})` }}
      />
      <button
        onClick={() => setOpen(!open)}
        className="w-full pl-5 pr-4 py-4 flex items-center justify-between gap-3 active:scale-[.99] transition-transform"
        type="button"
      >
        <div className="flex items-center gap-3 min-w-0">
          {/* Gradient icon chip */}
          <div
            className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{
              background: `linear-gradient(135deg, ${t.from}, ${t.to})`,
              boxShadow: `0 6px 16px ${t.accent}40, inset 0 1px 0 rgba(255,255,255,.4)`,
            }}
          >
            <span className="material-symbols-outlined text-white text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>
              {t.icon}
            </span>
          </div>
          <div className="text-left min-w-0">
            <h2 className="font-bold text-gray-800 dark:text-gray-100 text-[15px] truncate">{title}</h2>
            <div className="flex items-center gap-1.5 mt-0.5">
              {/* Count pill */}
              <span
                className="inline-flex items-center text-[10.5px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: `${t.accent}1A`, color: t.accent }}
              >
                {countLabel}
              </span>
            </div>
          </div>
        </div>
        <span
          className="material-symbols-outlined text-gray-400 dark:text-gray-500 text-xl transition-transform flex-shrink-0"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
        >
          expand_more
        </span>
      </button>
      <div
        className="overflow-hidden transition-[max-height,opacity] duration-300"
        style={{ maxHeight: open ? 5000 : 0, opacity: open ? 1 : 0 }}
      >
        <div className="px-4 pb-4 pt-1">{children}</div>
      </div>
    </div>
  )
}

// ═════ БЛОК: DiagnosisCard — premium sub-card ═════
function DiagnosisCard({ d, index = 0 }) {
  return (
    <div
      className="medcard-subcard relative bg-gradient-to-br from-blue-50/60 to-white dark:from-blue-900/10 dark:to-gray-800/50 rounded-xl p-3.5 mb-2 last:mb-0"
      style={{
        border: '1px solid rgba(21,101,192,.10)',
        boxShadow: '0 2px 8px rgba(21,101,192,.04), inset 0 1px 0 rgba(255,255,255,.5)',
        animation: `medcard-pop .35s cubic-bezier(.22,1,.36,1) ${index * 0.05}s both`,
      }}
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
             style={{ background: 'linear-gradient(135deg,#3B82F6,#1565C0)', boxShadow: '0 4px 12px rgba(21,101,192,.25)' }}>
          <span className="material-symbols-outlined text-white text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>local_hospital</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            {d.icd10_code && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md"
                    style={{ background: '#E0F2FE', color: '#0369A1' }}>{d.icd10_code}</span>
            )}
            {d.is_chronic && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md inline-flex items-center gap-0.5"
                    style={{ background: '#FEF3C7', color: '#92400E' }}>
                <span className="material-symbols-outlined text-[12px]" style={{ fontVariationSettings: "'FILL' 1" }}>schedule</span>
                хронический
              </span>
            )}
          </div>
          <p className="font-semibold text-gray-800 dark:text-gray-100 text-sm mt-1 break-words leading-snug">{d.name}</p>
          {d.notes && <p className="text-xs text-gray-600 dark:text-gray-300 mt-1 break-words leading-relaxed">{d.notes}</p>}
          <div className="flex items-center gap-2 mt-2 text-[11px] text-gray-500 dark:text-gray-400 flex-wrap">
            {d.diagnosed_at && (
              <span className="inline-flex items-center gap-0.5">
                <span className="material-symbols-outlined text-[12px]">event</span>
                {formatDate(d.diagnosed_at)}
              </span>
            )}
            {d.doctor_name && <span className="opacity-70">· {d.doctor_name}</span>}
          </div>
        </div>
      </div>
    </div>
  )
}

// ═════ БЛОК: AllergyCard — premium sub-card с severity-badge ═════
function AllergyCard({ a, index = 0 }) {
  const sev = SEVERITY_LABEL[a.severity] || SEVERITY_LABEL.mild
  return (
    <div
      className="medcard-subcard relative bg-gradient-to-br from-red-50/60 to-white dark:from-red-900/10 dark:to-gray-800/50 rounded-xl p-3.5 mb-2 last:mb-0"
      style={{
        border: '1px solid rgba(239,68,68,.10)',
        boxShadow: '0 2px 8px rgba(239,68,68,.04), inset 0 1px 0 rgba(255,255,255,.5)',
        animation: `medcard-pop .35s cubic-bezier(.22,1,.36,1) ${index * 0.05}s both`,
      }}
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
             style={{ background: 'linear-gradient(135deg,#F87171,#EF4444)', boxShadow: '0 4px 12px rgba(239,68,68,.25)' }}>
          <span className="material-symbols-outlined text-white text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>warning</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="font-semibold text-gray-800 dark:text-gray-100 text-sm break-words">{a.allergen}</p>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md inline-flex items-center gap-0.5"
                  style={{ background: sev.bg, color: sev.color }}>
              <span className="material-symbols-outlined text-[11px]" style={{ fontVariationSettings: "'FILL' 1" }}>{sev.icon}</span>
              {sev.label}
            </span>
          </div>
          {a.reaction && <p className="text-xs text-gray-600 dark:text-gray-300 mt-1 break-words leading-relaxed">{a.reaction}</p>}
          {a.noted_at && (
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5 inline-flex items-center gap-0.5">
              <span className="material-symbols-outlined text-[12px]">event</span>
              {formatDate(a.noted_at)}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ═════ БЛОК: VaccinationCard — premium sub-card ═════
function VaccinationCard({ v, index = 0 }) {
  return (
    <div
      className="medcard-subcard relative bg-gradient-to-br from-green-50/60 to-white dark:from-green-900/10 dark:to-gray-800/50 rounded-xl p-3.5 mb-2 last:mb-0"
      style={{
        border: '1px solid rgba(16,185,129,.10)',
        boxShadow: '0 2px 8px rgba(16,185,129,.04), inset 0 1px 0 rgba(255,255,255,.5)',
        animation: `medcard-pop .35s cubic-bezier(.22,1,.36,1) ${index * 0.05}s both`,
      }}
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
             style={{ background: 'linear-gradient(135deg,#34D399,#10B981)', boxShadow: '0 4px 12px rgba(16,185,129,.25)' }}>
          <span className="material-symbols-outlined text-white text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>vaccines</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="font-semibold text-gray-800 dark:text-gray-100 text-sm break-words">{v.vaccine_name}</p>
            {v.dose_number && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md"
                    style={{ background: '#D1FAE5', color: '#065F46' }}>доза {v.dose_number}</span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-2 text-[11px] text-gray-500 dark:text-gray-400 flex-wrap">
            {v.given_at && (
              <span className="inline-flex items-center gap-0.5">
                <span className="material-symbols-outlined text-[12px]">event</span>
                {formatDate(v.given_at)}
              </span>
            )}
            {v.expires_at && <span>· действует до {formatDate(v.expires_at)}</span>}
            {v.batch_number && <span>· серия {v.batch_number}</span>}
          </div>
          {v.doctor_name && <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 opacity-70">{v.doctor_name}</p>}
        </div>
      </div>
    </div>
  )
}

// ═════ БЛОК: EmptyState — пусто с illustration ═════
function EmptyState({ icon, text, accent = '#94A3B8' }) {
  return (
    <div className="text-center py-7 px-4">
      <div
        className="w-14 h-14 rounded-2xl mx-auto mb-2.5 flex items-center justify-center"
        style={{
          background: `linear-gradient(135deg, ${accent}1A, ${accent}0A)`,
          border: `1px dashed ${accent}40`,
        }}
      >
        <span className="material-symbols-outlined text-3xl" style={{ color: accent, opacity: .7 }}>{icon}</span>
      </div>
      <p className="text-xs text-gray-400 dark:text-gray-500">{text}</p>
    </div>
  )
}


// ═════ БЛОК: TimelineItem — хронология приёмов ═════
function TimelineItem({ it, index = 0 }) {
  const colors = {
    referral:    { bg: 'linear-gradient(135deg,#38BDF8,#0EA5E9)', soft: '#E0F2FE', fg: '#0369A1' },
    appointment: { bg: 'linear-gradient(135deg,#4ADE80,#22C55E)', soft: '#DCFCE7', fg: '#166534' },
    mis_visit:   { bg: 'linear-gradient(135deg,#A78BFA,#8B5CF6)', soft: '#EDE9FE', fg: '#6D28D9' },
  }
  const c = colors[it.type] || { bg: 'linear-gradient(135deg,#94A3B8,#64748B)', soft: '#F3F4F6', fg: '#6B7280' }
  const dateStr = it.date ? formatDate(it.date) : '—'
  return (
    <div
      className="relative bg-white dark:bg-gray-800/60 rounded-xl p-3 flex items-start gap-3 transition-transform active:scale-[.99]"
      style={{
        border: '1px solid rgba(0,0,0,.06)',
        boxShadow: '0 2px 8px rgba(0,0,0,.04), inset 0 1px 0 rgba(255,255,255,.5)',
        animation: `medcard-pop .35s cubic-bezier(.22,1,.36,1) ${index * 0.04}s both`,
      }}
    >
      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
           style={{ background: c.bg, boxShadow: `0 4px 10px ${c.fg}30` }}>
        <span className="material-symbols-outlined text-white text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>
          {it.icon || 'event_note'}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                style={{ background: c.soft, color: c.fg }}>{it.category}</span>
          <span className="text-[11px] text-gray-400 dark:text-gray-500">{dateStr}</span>
        </div>
        <div className="text-[14px] font-semibold text-gray-800 dark:text-gray-100 mt-1 truncate">{it.title || '—'}</div>
        {it.subtitle && <div className="text-[12px] text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">{it.subtitle}</div>}
        {it.price > 0 && (
          <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
            {it.price.toLocaleString('ru')} ₽{it.payment_method ? ` · ${it.payment_method}` : ''}
          </div>
        )}
      </div>
    </div>
  )
}

// ═════ БЛОК: MedCardTab — главный компонент ═════
export default function MedCardTab({ sessionToken, apiBase = '/api' }) {
  const [diagnoses, setDiagnoses] = useState([])
  const [allergies, setAllergies] = useState([])
  const [vaccinations, setVaccinations] = useState([])
  const [timeline, setTimeline] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    if (!sessionToken) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const cfg = { params: { session_token: sessionToken, t: sessionToken } }
      const [d, a, v, tl] = await Promise.all([
        axios.get(`${apiBase}/patient/medcard/diagnoses`, cfg).catch(() => ({ data: [] })),
        axios.get(`${apiBase}/patient/medcard/allergies`, cfg).catch(() => ({ data: [] })),
        axios.get(`${apiBase}/patient/medcard/vaccinations`, cfg).catch(() => ({ data: [] })),
        axios.get(`${apiBase}/patient/medcard/timeline`, cfg).catch(() => ({ data: { items: [] } })),
      ])
      setDiagnoses(Array.isArray(d.data) ? d.data : [])
      setAllergies(Array.isArray(a.data) ? a.data : [])
      setVaccinations(Array.isArray(v.data) ? v.data : [])
      setTimeline(Array.isArray(tl.data?.items) ? tl.data.items : [])
    } catch (e) {
      setError('Не удалось загрузить медкарту')
    } finally {
      setLoading(false)
    }
  }, [sessionToken, apiBase])

  useEffect(() => { load() }, [load])

  // ═════ Inline-стили: keyframes для stagger pop-in и shimmer ═════
  const styleBlock = (
    <style>{`
      @keyframes medcard-pop {
        from { opacity: 0; transform: translateY(8px) scale(.985) }
        to   { opacity: 1; transform: translateY(0)   scale(1) }
      }
      @keyframes medcard-shimmer {
        0%   { background-position: -200% 0 }
        100% { background-position: 200% 0 }
      }
      .medcard-skel {
        background: linear-gradient(90deg, rgba(148,163,184,.10) 25%, rgba(148,163,184,.20) 50%, rgba(148,163,184,.10) 75%);
        background-size: 200% 100%;
        animation: medcard-shimmer 1.6s linear infinite;
      }
    `}</style>
  )

  if (loading) {
    return (
      <>
        {styleBlock}
        <div className="space-y-3">
          {[0,1,2].map(i => (
            <div key={i} className="bg-white dark:bg-gray-800 rounded-2xl p-5"
                 style={{ border: '1px solid rgba(0,0,0,.06)', boxShadow: '0 4px 16px rgba(0,0,0,.06)' }}>
              <div className="flex items-center gap-3 mb-3">
                <div className="medcard-skel w-11 h-11 rounded-2xl" />
                <div className="flex-1">
                  <div className="medcard-skel h-4 rounded w-1/2 mb-2" />
                  <div className="medcard-skel h-3 rounded w-1/4" />
                </div>
              </div>
              <div className="medcard-skel h-3 rounded w-3/4" />
            </div>
          ))}
        </div>
      </>
    )
  }

  if (error) {
    return (
      <>
        {styleBlock}
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 text-center"
             style={{ border: '1px solid rgba(0,0,0,.06)', boxShadow: '0 4px 16px rgba(0,0,0,.06)' }}>
          <div className="w-14 h-14 rounded-2xl mx-auto mb-3 flex items-center justify-center"
               style={{ background: 'linear-gradient(135deg,#FEE2E2,#FECACA)' }}>
            <span className="material-symbols-outlined text-red-500 text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>error</span>
          </div>
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{error}</p>
          <button
            onClick={load}
            className="mt-3 px-4 py-2 rounded-xl font-semibold text-xs text-white transition-transform active:scale-95"
            style={{ background: 'linear-gradient(135deg,#0097A7,#1565C0)', boxShadow: '0 4px 12px rgba(0,151,167,.3)' }}
          >
            Повторить
          </button>
        </div>
      </>
    )
  }

  const total = diagnoses.length + allergies.length + vaccinations.length + timeline.length
  if (total === 0) {
    return (
      <>
        {styleBlock}
        <div
          className="relative bg-white dark:bg-gray-800 rounded-2xl p-8 text-center overflow-hidden"
          style={{
            border: '1px solid rgba(0,0,0,.06)',
            boxShadow: '0 4px 16px rgba(0,0,0,.06), inset 0 1px 0 rgba(255,255,255,.5)',
            animation: 'medcard-pop .42s cubic-bezier(.22,1,.36,1) both',
          }}
        >
          <div
            aria-hidden
            className="absolute -top-12 -right-12 w-40 h-40 rounded-full opacity-30"
            style={{ background: 'radial-gradient(circle, rgba(21,101,192,.25), transparent 70%)' }}
          />
          <div className="relative">
            <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-4"
                 style={{
                   background: 'linear-gradient(135deg,#3B82F6,#1565C0)',
                   boxShadow: '0 12px 28px rgba(21,101,192,.3), inset 0 1px 0 rgba(255,255,255,.4)',
                 }}>
              <span className="material-symbols-outlined text-white text-4xl" style={{ fontVariationSettings: "'FILL' 1" }}>medical_information</span>
            </div>
            <p className="text-gray-800 dark:text-gray-100 font-extrabold text-base">Медкарта пуста</p>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1.5 max-w-xs mx-auto leading-relaxed">
              Здесь появятся ваши диагнозы, аллергии и прививки
            </p>
          </div>
        </div>
      </>
    )
  }

  let sectionIdx = 0
  return (
    <>
      {styleBlock}
      <div className="space-y-3">
        {/* Уровень 1: автоматическая хронология приёмов */}
        {timeline.length > 0 && (
          <Section themeKey="timeline" title="Хронология" count={timeline.length} index={sectionIdx++}>
            <div className="space-y-2">
              {timeline.slice(0, 50).map((it, i) => (
                <TimelineItem key={`${it.type}-${i}`} it={it} index={i} />
              ))}
              {timeline.length > 50 && (
                <div className="text-center text-[12px] text-gray-400 dark:text-gray-500 py-2">
                  Показано 50 из {timeline.length}
                </div>
              )}
            </div>
          </Section>
        )}
        <Section themeKey="diagnoses" title="Диагнозы" count={diagnoses.length} index={sectionIdx++}>
          {diagnoses.length === 0
            ? <EmptyState icon="medical_information" text="Диагнозов нет" accent="#1565C0" />
            : diagnoses.map((d, i) => <DiagnosisCard key={d.id} d={d} index={i} />)}
        </Section>

        <Section themeKey="allergies" title="Аллергии" count={allergies.length} index={sectionIdx++}>
          {allergies.length === 0
            ? <EmptyState icon="warning" text="Аллергий не зафиксировано" accent="#EF4444" />
            : allergies.map((a, i) => <AllergyCard key={a.id} a={a} index={i} />)}
        </Section>

        <Section themeKey="vaccinations" title="Прививки" count={vaccinations.length} index={sectionIdx++}>
          {vaccinations.length === 0
            ? <EmptyState icon="vaccines" text="Прививок не зафиксировано" accent="#10B981" />
            : vaccinations.map((v, i) => <VaccinationCard key={v.id} v={v} index={i} />)}
        </Section>
      </div>
    </>
  )
}
