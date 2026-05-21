/**
 * chatslot01: drawer для регистратора — выбор врача → услуги → 2-3 свободных слотов.
 * Открывается из ClinicChatSection. После выбора шлёт slot_offer в thread.
 *
 * Props:
 *   open: bool
 *   onClose: () => void
 *   threadId: UUID
 *   defaults: { doctor_id?, service_id?, preferred_dates? } — из slot_request пациента
 *   onSent: () => void — после успешной отправки offer'а
 */
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import api from '../../api'
import { chatSlotsApi } from '../../api/chatSlots'

export default function ClinicSlotPicker({ open, onClose, threadId, defaults = {}, onSent }) {
  const [doctorId, setDoctorId] = useState(defaults.doctor_id || '')
  const [serviceId, setServiceId] = useState(defaults.service_id || '')
  const [doctors, setDoctors] = useState([])
  const [services, setServices] = useState([])
  const [freeSlots, setFreeSlots] = useState([])  // {start_at, duration_min}
  const [selected, setSelected] = useState([])     // массив выбранных индексов
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  // ─── Загрузка справочников при открытии ───
  useEffect(() => {
    if (!open) return
    api.get('/manager/doctors/').then(r => setDoctors(r.data || [])).catch(() => setDoctors([]))
    api.get('/manager/services/').then(r => setServices(r.data || [])).catch(() => setServices([]))
  }, [open])

  // ─── Подтягиваем свободные слоты выбранного врача (7 дней) ───
  useEffect(() => {
    if (!doctorId) { setFreeSlots([]); return }
    // Endpoint /manager/doctors/{id}/free-slots может ещё не существовать —
    // при 404 просто оставляем пустой список (Task 11 поправит backend, если нужно).
    api.get(`/manager/doctors/${doctorId}/free-slots?days=7`)
       .then(r => setFreeSlots(r.data || []))
       .catch(() => setFreeSlots([]))
  }, [doctorId])

  // ─── Toggle слота: до 5 максимум ───
  function toggleSlot(i) {
    setSelected(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i].slice(0, 5))
  }

  async function send() {
    if (!doctorId || !serviceId || selected.length === 0) {
      setErr('Выбери врача, услугу и хотя бы один слот')
      return
    }
    setBusy(true); setErr(null)
    try {
      const slots = selected.map((idx, i) => ({
        idx: i,
        start_at: freeSlots[idx].start_at,
        duration_min: freeSlots[idx].duration_min,
      }))
      await chatSlotsApi.postSlotOffer(threadId, { doctor_id: doctorId, service_id: serviceId, slots })
      onSent?.()
      onClose()
    } catch (e) {
      setErr('Не удалось отправить — попробуй ещё раз')
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white h-full overflow-y-auto p-4 shadow-xl">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-lg font-semibold">Предложить слоты</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800">✕</button>
        </div>

        <label className="block text-sm text-gray-700 mb-1">Врач</label>
        <select value={doctorId} onChange={e => setDoctorId(e.target.value)}
                className="w-full mb-3 border rounded px-2 py-1.5">
          <option value="">— выбери —</option>
          {doctors.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
        </select>

        <label className="block text-sm text-gray-700 mb-1">Услуга</label>
        <select value={serviceId} onChange={e => setServiceId(e.target.value)}
                className="w-full mb-3 border rounded px-2 py-1.5">
          <option value="">— выбери —</option>
          {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>

        <div className="text-sm text-gray-700 mb-1">Свободные слоты (до 5):</div>
        <div className="flex flex-col gap-1 mb-3 max-h-72 overflow-y-auto">
          {freeSlots.map((s, i) => (
            <label key={i} className="flex items-center gap-2 text-sm px-2 py-1 hover:bg-gray-50 rounded cursor-pointer">
              <input type="checkbox" checked={selected.includes(i)} onChange={() => toggleSlot(i)} />
              {new Date(s.start_at).toLocaleString('ru-RU', {
                weekday: 'short', day: '2-digit', month: '2-digit',
                hour: '2-digit', minute: '2-digit'
              })}
            </label>
          ))}
          {freeSlots.length === 0 && doctorId && <div className="text-xs text-gray-500">Нет свободных слотов на 7 дней</div>}
        </div>

        {err && <div className="text-sm text-red-600 mb-2">{err}</div>}

        <button
          onClick={send}
          disabled={busy}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white py-2 rounded-lg"
        >
          {busy ? 'Отправка...' : `Отправить (${selected.length})`}
        </button>
      </div>
    </div>,
    document.body
  )
}
