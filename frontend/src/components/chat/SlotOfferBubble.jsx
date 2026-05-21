/**
 * chatslot01: интерактивная карточка слотов от клиники в чате пациента.
 *
 * Props:
 *   message   — { id, payload: SlotOfferPayload, message_type, ... }
 *   isPatient — true если рендерим в PatientChatSection (показываем кликабельные кнопки)
 *   threadId  — нужен для bookSlot вызова
 *   onBooked  — callback после успешного бронирования (parent перезагружает ленту)
 */
import { useState } from 'react'
import { chatSlotsApi } from '../../api/chatSlots'

// Локальный форматтер времени слота (ru-RU, короткий)
function formatSlotLabel(startAt) {
  const d = new Date(startAt)
  return d.toLocaleString('ru-RU', {
    weekday: 'short', day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function SlotOfferBubble({ message, isPatient = false, threadId, onBooked }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const offer = message?.payload || {}
  const slots = Array.isArray(offer.slots) ? offer.slots : []

  // Состояние оффера:
  //  • expired       — TTL истёк (или message_type == slot_expired)
  //  • superseded    — один из слотов уже забронирован (offer.booked_slot_idx)
  const expired = offer.status === 'expired' || message?.message_type === 'slot_expired'
  const superseded = offer.status === 'superseded'

  async function handleClick(slotIdx) {
    if (!isPatient || busy || expired || superseded) return
    setBusy(true)
    setErr(null)
    try {
      const res = await chatSlotsApi.bookSlot(threadId, message.id, slotIdx)
      onBooked?.(res)
    } catch (e) {
      const code = e?.response?.status
      if (code === 409) setErr('Слот уже занят — выбери другой')
      else if (code === 410) setErr('Слоты больше неактуальны')
      else setErr('Не удалось забронировать')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-2xl p-3 bg-blue-50 border border-blue-100 max-w-md">
      <div className="text-xs text-gray-600 mb-2">
        {expired ? '⏱ Слоты больше неактуальны'
          : superseded ? '✅ Один из слотов выбран'
          : '🗓 Выберите удобный слот:'}
      </div>
      <div className="flex flex-col gap-1.5">
        {slots.map((s, i) => {
          const isBooked = superseded && offer.booked_slot_idx === i
          const disabled = expired || superseded || s.taken || !isPatient || busy
          return (
            <button
              key={i}
              type="button"
              onClick={() => handleClick(i)}
              disabled={disabled}
              className={`text-sm text-left px-3 py-2 rounded-lg border transition ${
                isBooked ? 'bg-green-100 border-green-300 text-green-800 font-semibold' :
                s.taken ? 'bg-gray-100 border-gray-200 text-gray-400 line-through' :
                disabled ? 'bg-white border-gray-200 text-gray-500' :
                'bg-white border-blue-200 hover:bg-blue-100 cursor-pointer'
              }`}
            >
              {isBooked && '✅ '}{formatSlotLabel(s.start_at)}
              {s.taken && !isBooked && ' (занят)'}
            </button>
          )
        })}
      </div>
      {err && <div className="mt-2 text-xs text-red-600">{err}</div>}
    </div>
  )
}
