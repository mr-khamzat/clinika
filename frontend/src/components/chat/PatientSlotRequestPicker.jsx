/**
 * chatslot01: пациент выбирает врача/услугу/даты → шлёт slot_request в чат.
 *
 * Props:
 *   open, onClose, threadId, onSent
 */
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import api from '../../api'
import { chatSlotsApi } from '../../api/chatSlots'

export default function PatientSlotRequestPicker({ open, onClose, threadId, onSent }) {
  const [doctorId, setDoctorId] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [doctors, setDoctors] = useState([])
  const [services, setServices] = useState([])
  const [dates, setDates] = useState([])  // ['2026-05-22', ...]
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  // ─── При открытии: загружаем публичный справочник врачей ───
  useEffect(() => {
    if (!open) return
    // Публичный список врачей тенанта: GET /public/{slug}/doctors (без авторизации).
    // slug сохраняется PatientCabinet в localStorage при заходе в кабинет.
    let slug = ''
    try { slug = localStorage.getItem('clinika_patient_slug') || '' } catch {}
    if (slug) {
      api.get(`/public/${slug}/doctors`).then(r => setDoctors(r.data || [])).catch(() => setDoctors([]))
    } else {
      setDoctors([])
    }
    // Публичного эндпоинта услуг нет — оставляем «по описанию» (поле опционально).
    setServices([])
  }, [open])

  // ─── Toggle даты: максимум 7 ───
  function toggleDate(d) {
    setDates(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].slice(0, 7))
  }

  async function send() {
    setBusy(true)
    try {
      await chatSlotsApi.postSlotRequest(threadId, {
        doctor_id: doctorId || null,
        service_id: serviceId || null,
        preferred_dates: dates,
        note: note || null,
      })
      onSent?.()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  // ─── Список ближайших 14 дней ───
  const upcoming = []
  for (let i = 0; i < 14; i++) {
    const d = new Date()
    d.setDate(d.getDate() + i)
    upcoming.push(d.toISOString().slice(0, 10))
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white h-full overflow-y-auto p-4 shadow-xl">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-lg font-semibold">Записаться</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800">✕</button>
        </div>

        <label className="block text-sm text-gray-700 mb-1">Врач (необязательно)</label>
        <select value={doctorId} onChange={e => setDoctorId(e.target.value)}
                className="w-full mb-3 border rounded px-2 py-1.5">
          <option value="">— любой —</option>
          {doctors.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
        </select>

        <label className="block text-sm text-gray-700 mb-1">Услуга (необязательно)</label>
        <select value={serviceId} onChange={e => setServiceId(e.target.value)}
                className="w-full mb-3 border rounded px-2 py-1.5">
          <option value="">— по описанию —</option>
          {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>

        <div className="text-sm text-gray-700 mb-1">Удобные даты (до 7):</div>
        <div className="grid grid-cols-2 gap-1 mb-3">
          {upcoming.map(d => (
            <label key={d} className="flex items-center gap-1 text-xs px-2 py-1 hover:bg-gray-50 rounded cursor-pointer">
              <input type="checkbox" checked={dates.includes(d)} onChange={() => toggleDate(d)} />
              {new Date(d).toLocaleDateString('ru-RU', { weekday: 'short', day: '2-digit', month: '2-digit' })}
            </label>
          ))}
        </div>

        <label className="block text-sm text-gray-700 mb-1">Комментарий</label>
        <textarea value={note} onChange={e => setNote(e.target.value)}
                  className="w-full mb-3 border rounded px-2 py-1.5 text-sm" rows={2}
                  placeholder="например, до обеда удобнее" maxLength={500} />

        <button
          onClick={send}
          disabled={busy}
          className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white py-2 rounded-lg"
        >
          {busy ? 'Отправка...' : 'Запросить запись'}
        </button>
      </div>
    </div>,
    document.body
  )
}
