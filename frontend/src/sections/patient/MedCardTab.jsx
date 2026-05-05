// Вкладка "Медкарта" в кабинете пациента: диагнозы, аллергии, прививки.
// Mobile-first, аккордеон-секции. Tailwind + Material Symbols.
//
// Props: { token (patient JWT, не используется здесь), sessionToken, phone, apiBase }
//
// Эндпоинты (через session_token):
//   GET /patient/medcard/diagnoses
//   GET /patient/medcard/allergies
//   GET /patient/medcard/vaccinations
import { useEffect, useState, useCallback } from 'react'
import axios from 'axios'

const SEVERITY_LABEL = {
  mild:     { label: 'лёгкая',  color: '#10B981', bg: '#ECFDF5' },
  moderate: { label: 'средняя', color: '#F59E0B', bg: '#FFFBEB' },
  severe:   { label: 'тяжёлая', color: '#EF4444', bg: '#FEF2F2' },
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

function Section({ icon, title, count, color, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bg-white rounded-3xl overflow-hidden"
         style={{ border: '1px solid rgba(0,0,0,.06)', boxShadow: '0 2px 12px rgba(0,0,0,.04)' }}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-5 py-4 flex items-center justify-between gap-3 active:bg-gray-50"
        type="button"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center"
               style={{ background: `${color}1A` }}>
            <span className="material-symbols-outlined text-xl" style={{ color }}>{icon}</span>
          </div>
          <div className="text-left">
            <h2 className="font-bold text-gray-800 text-sm">{title}</h2>
            <p className="text-xs text-gray-400">{count > 0 ? `${count} запис${count === 1 ? 'ь' : count < 5 ? 'и' : 'ей'}` : 'нет данных'}</p>
          </div>
        </div>
        <span className="material-symbols-outlined text-gray-400 text-xl">
          {open ? 'expand_less' : 'expand_more'}
        </span>
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </div>
  )
}

function DiagnosisCard({ d }) {
  return (
    <div className="bg-gray-50 rounded-2xl p-4 mb-2 last:mb-0">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {d.icd10_code && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md"
                    style={{ background: '#E0F2FE', color: '#0369A1' }}>{d.icd10_code}</span>
            )}
            {d.is_chronic && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md"
                    style={{ background: '#FEF3C7', color: '#92400E' }}>хронический</span>
            )}
          </div>
          <p className="font-semibold text-gray-800 text-sm mt-1 break-words">{d.name}</p>
          {d.notes && <p className="text-xs text-gray-600 mt-1 break-words">{d.notes}</p>}
          <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-500 flex-wrap">
            {d.diagnosed_at && <span>{formatDate(d.diagnosed_at)}</span>}
            {d.doctor_name && <span>· {d.doctor_name}</span>}
          </div>
        </div>
      </div>
    </div>
  )
}

function AllergyCard({ a }) {
  const sev = SEVERITY_LABEL[a.severity] || SEVERITY_LABEL.mild
  return (
    <div className="bg-gray-50 rounded-2xl p-4 mb-2 last:mb-0">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-gray-800 text-sm break-words">{a.allergen}</p>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md"
                  style={{ background: sev.bg, color: sev.color }}>{sev.label}</span>
          </div>
          {a.reaction && <p className="text-xs text-gray-600 mt-1 break-words">{a.reaction}</p>}
          {a.noted_at && <p className="text-[11px] text-gray-500 mt-1">{formatDate(a.noted_at)}</p>}
        </div>
      </div>
    </div>
  )
}

function VaccinationCard({ v }) {
  return (
    <div className="bg-gray-50 rounded-2xl p-4 mb-2 last:mb-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-semibold text-gray-800 text-sm break-words">{v.vaccine_name}</p>
          {v.dose_number && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md"
                  style={{ background: '#E0F2FE', color: '#0369A1' }}>доза {v.dose_number}</span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-2 text-[11px] text-gray-500 flex-wrap">
          {v.given_at && <span><span className="material-symbols-outlined text-[12px] align-middle">event</span> {formatDate(v.given_at)}</span>}
          {v.expires_at && <span>· действует до {formatDate(v.expires_at)}</span>}
          {v.batch_number && <span>· серия {v.batch_number}</span>}
        </div>
        {v.doctor_name && <p className="text-[11px] text-gray-500 mt-1">{v.doctor_name}</p>}
      </div>
    </div>
  )
}

function EmptyState({ icon, text }) {
  return (
    <div className="text-center py-6">
      <span className="material-symbols-outlined text-3xl text-gray-300">{icon}</span>
      <p className="text-xs text-gray-400 mt-2">{text}</p>
    </div>
  )
}

export default function MedCardTab({ sessionToken, apiBase = '/api' }) {
  const [diagnoses, setDiagnoses] = useState([])
  const [allergies, setAllergies] = useState([])
  const [vaccinations, setVaccinations] = useState([])
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
      const [d, a, v] = await Promise.all([
        axios.get(`${apiBase}/patient/medcard/diagnoses`, cfg).catch(() => ({ data: [] })),
        axios.get(`${apiBase}/patient/medcard/allergies`, cfg).catch(() => ({ data: [] })),
        axios.get(`${apiBase}/patient/medcard/vaccinations`, cfg).catch(() => ({ data: [] })),
      ])
      setDiagnoses(Array.isArray(d.data) ? d.data : [])
      setAllergies(Array.isArray(a.data) ? a.data : [])
      setVaccinations(Array.isArray(v.data) ? v.data : [])
    } catch (e) {
      setError('Не удалось загрузить медкарту')
    } finally {
      setLoading(false)
    }
  }, [sessionToken, apiBase])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div className="space-y-3">
        {[0,1,2].map(i => (
          <div key={i} className="bg-white rounded-3xl p-5 animate-pulse"
               style={{ border: '1px solid rgba(0,0,0,.06)' }}>
            <div className="h-5 bg-gray-100 rounded w-1/2 mb-2" />
            <div className="h-3 bg-gray-100 rounded w-3/4" />
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white rounded-3xl p-5 text-center"
           style={{ border: '1px solid rgba(0,0,0,.06)' }}>
        <p className="text-sm text-red-500">{error}</p>
        <button onClick={load} className="text-xs text-blue-500 mt-2">Повторить</button>
      </div>
    )
  }

  const total = diagnoses.length + allergies.length + vaccinations.length
  if (total === 0) {
    return (
      <div className="bg-white rounded-3xl p-8 text-center"
           style={{ border: '1px solid rgba(0,0,0,.06)', boxShadow: '0 2px 12px rgba(0,0,0,.04)' }}>
        <div className="w-16 h-16 rounded-3xl flex items-center justify-center mx-auto mb-4"
             style={{ background: 'linear-gradient(135deg,#E0F2FE,#BAE6FD)' }}>
          <span className="material-symbols-outlined text-blue-400 text-3xl">medical_information</span>
        </div>
        <p className="text-gray-700 font-bold">Медкарта пуста</p>
        <p className="text-gray-400 text-sm mt-1">Здесь появятся ваши диагнозы, аллергии и прививки</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <Section icon="local_hospital" title="Диагнозы" count={diagnoses.length} color="#EF4444">
        {diagnoses.length === 0
          ? <EmptyState icon="medical_information" text="Диагнозов нет" />
          : diagnoses.map(d => <DiagnosisCard key={d.id} d={d} />)}
      </Section>

      <Section icon="warning" title="Аллергии" count={allergies.length} color="#F59E0B">
        {allergies.length === 0
          ? <EmptyState icon="warning" text="Аллергий не зафиксировано" />
          : allergies.map(a => <AllergyCard key={a.id} a={a} />)}
      </Section>

      <Section icon="vaccines" title="Прививки" count={vaccinations.length} color="#10B981">
        {vaccinations.length === 0
          ? <EmptyState icon="vaccines" text="Прививок не зафиксировано" />
          : vaccinations.map(v => <VaccinationCard key={v.id} v={v} />)}
      </Section>
    </div>
  )
}
