import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api'
import { listManagerClinics, updateClinic } from '../api'

const DAY_NAMES = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье']
const DAY_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

function defaultSchedule() {
  return Array.from({ length: 7 }, (_, i) => ({
    day_of_week: i,
    is_active: i < 5, // Mon-Fri active by default
    open_time: '09:00',
    close_time: '18:00',
  }))
}

export default function ClinicSchedules() {
  const nav = useNavigate()
  const [clinics, setClinics] = useState([])
  const [selectedClinic, setSelectedClinic] = useState(null)
  const [schedule, setSchedule] = useState(defaultSchedule())
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [clinicEdit, setClinicEdit] = useState({ name: '', address: '', phone: '' })
  const [savingClinic, setSavingClinic] = useState(false)
  const [clinicSaved, setClinicSaved] = useState(false)

  useEffect(() => {
    listManagerClinics().then(r => {
      const c = Array.isArray(r.data) ? r.data : []
      setClinics(c)
      if (c.length > 0) handleSelectClinic(c[0])
    })
  }, [])

  const handleSelectClinic = async (clinic) => {
    setSelectedClinic(clinic)
    setClinicEdit({ name: clinic.name || '', address: clinic.address || '', phone: clinic.phone || '' })
    setClinicSaved(false)
    setLoading(true)
    setSaved(false)
    setError('')
    try {
      const res = await api.get(`/clinics/${clinic.id}/schedule`)
      if (Array.isArray(res.data) && res.data.length > 0) {
        setSchedule(res.data.map(d => ({
          day_of_week: d.day_of_week,
          is_active: d.is_active,
          open_time: d.open_time,
          close_time: d.close_time,
        })))
      } else {
        setSchedule(defaultSchedule())
      }
    } catch {
      setSchedule(defaultSchedule())
    } finally {
      setLoading(false)
    }
  }

  const handleSaveClinic = async () => {
    if (!selectedClinic) return
    setSavingClinic(true)
    setError('')
    try {
      await updateClinic(selectedClinic.id, clinicEdit)
      setClinicSaved(true)
      setClinics(prev => prev.map(c => c.id === selectedClinic.id ? { ...c, ...clinicEdit } : c))
      setSelectedClinic(prev => ({ ...prev, ...clinicEdit }))
      setTimeout(() => setClinicSaved(false), 3000)
    } catch (e) {
      setError(e.response?.data?.detail || 'Ошибка сохранения клиники')
    } finally {
      setSavingClinic(false)
    }
  }

  const updateDay = (idx, field, value) => {
    setSchedule(prev => prev.map((d, i) => i === idx ? { ...d, [field]: value } : d))
    setSaved(false)
  }

  const handleSave = async () => {
    if (!selectedClinic) return
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      await api.put(`/clinics/${selectedClinic.id}/schedule`, schedule)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setError(e.response?.data?.detail || 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4 pb-24">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => nav(-1)} className="text-gray-400 hover:text-gray-600">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <h1 className="text-xl font-bold text-gray-800">Расписание клиник</h1>
      </div>

      {/* Clinic selector */}
      <div className="bg-white rounded-2xl shadow-sm mb-4 overflow-hidden">
        {clinics.map(c => (
          <button
            key={c.id}
            onClick={() => handleSelectClinic(c)}
            className={`w-full text-left px-4 py-3 text-sm font-medium border-b border-gray-50 last:border-0 transition-colors ${
              selectedClinic?.id === c.id ? 'bg-primary/5 text-primary' : 'text-gray-700 hover:bg-gray-50'
            }`}
          >
            {c.name}
            {selectedClinic?.id === c.id && <span className="ml-2 text-xs">✓</span>}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4">
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      )}

      {saved && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 mb-4">
          <p className="text-green-700 text-sm font-medium">Расписание сохранено</p>
        </div>
      )}

      {clinicSaved && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 mb-4">
          <p className="text-green-700 text-sm font-medium">Данные клиники сохранены</p>
        </div>
      )}

      {loading ? (
        <div className="text-center text-gray-400 text-sm py-12">Загрузка...</div>
      ) : selectedClinic ? (
        <>
          {/* Clinic info edit */}
          <div className="bg-white rounded-2xl p-4 shadow-sm mb-4">
            <p className="text-sm font-semibold text-gray-700 mb-3">Данные клиники</p>
            <div className="space-y-2">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Название</label>
                <input type="text" value={clinicEdit.name} onChange={e => setClinicEdit(c => ({ ...c, name: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl p-2.5 text-sm focus:outline-none focus:border-primary" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Адрес</label>
                <input type="text" value={clinicEdit.address} onChange={e => setClinicEdit(c => ({ ...c, address: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl p-2.5 text-sm focus:outline-none focus:border-primary" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Телефон</label>
                <input type="tel" value={clinicEdit.phone} onChange={e => setClinicEdit(c => ({ ...c, phone: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl p-2.5 text-sm focus:outline-none focus:border-primary" />
              </div>
              <button onClick={handleSaveClinic} disabled={savingClinic}
                className="w-full bg-primary text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50">
                {savingClinic ? 'Сохранение...' : 'Сохранить данные клиники'}
              </button>
            </div>
          </div>

          <p className="text-sm font-semibold text-gray-600 mb-3">Расписание</p>
          <div className="space-y-2 mb-5">
            {schedule.map((day, idx) => (
              <div
                key={day.day_of_week}
                className={`bg-white rounded-2xl px-4 py-3 shadow-sm flex items-center gap-3 ${!day.is_active ? 'opacity-60' : ''}`}
              >
                {/* Toggle */}
                <button
                  type="button"
                  onClick={() => updateDay(idx, 'is_active', !day.is_active)}
                  className={`relative inline-flex w-10 h-5 rounded-full flex-shrink-0 transition-colors ${day.is_active ? 'bg-primary' : 'bg-gray-200'}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${day.is_active ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>

                {/* Day name */}
                <span className={`text-sm font-medium w-28 flex-shrink-0 ${day.is_active ? 'text-gray-800' : 'text-gray-400'}`}>
                  {DAY_NAMES[day.day_of_week]}
                </span>

                {/* Time inputs */}
                {day.is_active ? (
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      type="time"
                      value={day.open_time}
                      onChange={e => updateDay(idx, 'open_time', e.target.value)}
                      className="border border-gray-200 rounded-xl px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:border-primary w-[90px]"
                    />
                    <span className="text-gray-400 text-xs">—</span>
                    <input
                      type="time"
                      value={day.close_time}
                      onChange={e => updateDay(idx, 'close_time', e.target.value)}
                      className="border border-gray-200 rounded-xl px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:border-primary w-[90px]"
                    />
                  </div>
                ) : (
                  <span className="text-xs text-gray-400">Выходной</span>
                )}
              </div>
            ))}
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full bg-primary text-white rounded-xl py-3.5 text-sm font-semibold disabled:opacity-50"
          >
            {saving ? 'Сохранение...' : 'Сохранить расписание'}
          </button>
        </>
      ) : null}
    </div>
  )
}
