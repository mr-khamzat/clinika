import { useEffect, useState } from 'react'
import api from '../../api'
import PartnerOfferPicker from './PartnerOfferPicker'
import InternalServicePicker from './InternalServicePicker'

// ─────────────────────────────────────────────────────────────────────
// CreateReferralWizard — 3-шаговый визард создания направления.
//   Шаг 1: режим (своя клиника / другая клиника франшизы)
//   Шаг 2: выбор услуги (InternalServicePicker | PartnerOfferPicker)
//   Шаг 3: данные пациента + submit
//
// API:
//   GET  /admins/me      — текущий пользователь (его clinic_id для internal)
//   GET  /clinics/       — список клиник для select (только франшиза-сёстры)
//   POST /referrals/     — создание направления
//
// Props:
//   onCreated(referral)  — колбэк после успешного создания
// ─────────────────────────────────────────────────────────────────────
export default function CreateReferralWizard({ onCreated }) {
  const [step, setStep] = useState(1)
  const [mode, setMode] = useState('internal') // 'internal' | 'external'
  const [me, setMe] = useState(null)
  const [otherClinics, setOtherClinics] = useState([])
  const [toClinicId, setToClinicId] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [patientPhone, setPatientPhone] = useState('')
  const [patientName, setPatientName] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    api.get('/admins/me').then(r => setMe(r.data)).catch(() => setMe(null))
    api.get('/clinics/').then(r => setOtherClinics(r.data?.items || r.data || [])).catch(() => setOtherClinics([]))
  }, [])

  const targetClinic = mode === 'internal' ? me?.clinic_id : toClinicId

  // ─── БЛОК: Отправка направления на сервер ───
  const submit = async () => {
    if (!targetClinic || !serviceId || !patientPhone) {
      setError('Заполните все обязательные поля')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const r = await api.post('/referrals/', {
        to_clinic_id: targetClinic,
        service_id: serviceId,
        patient_phone: patientPhone,
        patient_name: patientName || null,
        notes: notes || null,
      })
      onCreated?.(r.data)
    } catch (e) {
      setError(e.response?.data?.detail || 'Ошибка создания')
    } finally {
      setSubmitting(false)
    }
  }

  // ─── БЛОК: Badge сверху — есть ли бонус за это направление ───
  const bonusBadge = mode === 'external'
    ? <span className="ml-3 inline-block px-2 py-1 bg-green-100 text-green-700 text-sm rounded">💰 Бонус начислится</span>
    : <span className="ml-3 inline-block px-2 py-1 bg-gray-100 text-gray-600 text-sm rounded">Без бонуса (своя клиника)</span>

  if (!me) return <div>Загрузка…</div>

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h2 className="text-xl font-bold mb-4">Создать направление {bonusBadge}</h2>

      {step === 1 && (
        <div className="space-y-4">
          <h3 className="font-medium">Шаг 1. Куда направить пациента?</h3>
          <label className="flex items-start gap-3 p-3 border rounded cursor-pointer hover:bg-gray-50">
            <input type="radio" checked={mode === 'internal'} onChange={() => setMode('internal')} />
            <div>
              <div className="font-medium">🏥 В свою клинику</div>
              <div className="text-sm text-gray-500">Запись к врачу, анализы, услуги — весь каталог</div>
            </div>
          </label>
          <label className="flex items-start gap-3 p-3 border rounded cursor-pointer hover:bg-gray-50">
            <input type="radio" checked={mode === 'external'} onChange={() => setMode('external')} />
            <div className="flex-1">
              <div className="font-medium">🏢 В другую клинику франшизы</div>
              <div className="text-sm text-gray-500">Только партнёрский прайс. Бонус начисляется.</div>
              {mode === 'external' && (
                <select
                  className="border rounded px-3 py-2 mt-2 w-full"
                  value={toClinicId}
                  onChange={e => setToClinicId(e.target.value)}
                >
                  <option value="">— выберите клинику —</option>
                  {otherClinics.filter(c => c.id !== me.clinic_id).map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              )}
            </div>
          </label>
          <button
            className="bg-blue-600 text-white px-6 py-2 rounded disabled:opacity-50"
            disabled={mode === 'external' && !toClinicId}
            onClick={() => setStep(2)}
          >
            Далее →
          </button>
        </div>
      )}

      {step === 2 && (
        <div>
          <h3 className="font-medium mb-3">Шаг 2. Выбор услуги</h3>
          {mode === 'internal'
            ? <InternalServicePicker value={serviceId} onChange={setServiceId} />
            : <PartnerOfferPicker clinicId={toClinicId} value={serviceId} onChange={setServiceId} />}
          <div className="mt-4 flex gap-2">
            <button className="px-4 py-2" onClick={() => setStep(1)}>← Назад</button>
            <button
              className="bg-blue-600 text-white px-6 py-2 rounded disabled:opacity-50"
              disabled={!serviceId}
              onClick={() => setStep(3)}
            >
              Далее →
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          <h3 className="font-medium">Шаг 3. Данные пациента</h3>
          <input
            className="border rounded px-3 py-2 w-full"
            placeholder="Телефон пациента *"
            value={patientPhone}
            onChange={e => setPatientPhone(e.target.value)}
          />
          <input
            className="border rounded px-3 py-2 w-full"
            placeholder="ФИО (опционально)"
            value={patientName}
            onChange={e => setPatientName(e.target.value)}
          />
          <textarea
            className="border rounded px-3 py-2 w-full"
            placeholder="Заметки"
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
          {error && <div className="text-red-600">{error}</div>}
          <div className="flex gap-2">
            <button className="px-4 py-2" onClick={() => setStep(2)}>← Назад</button>
            <button
              className="bg-blue-600 text-white px-6 py-2 rounded disabled:opacity-50"
              disabled={submitting}
              onClick={submit}
            >
              {submitting ? 'Создаю…' : 'Создать направление'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
