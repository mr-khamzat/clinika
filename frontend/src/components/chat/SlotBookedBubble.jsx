/**
 * chatslot01: системное сообщение «✅ Запись подтверждена».
 *
 * Props:
 *   message — { text, payload: SlotBookedPayload { appointment_id, doctor_name, service_name, start_at, duration_min } }
 */
export default function SlotBookedBubble({ message }) {
  const p = message?.payload || {}
  // Форматируем дату/время начала приёма (если есть)
  const dt = p.start_at
    ? new Date(p.start_at).toLocaleString('ru-RU', {
        weekday: 'short', day: '2-digit', month: '2-digit',
        hour: '2-digit', minute: '2-digit',
      })
    : ''

  return (
    <div className="rounded-xl px-3 py-2 bg-green-50 border border-green-200 text-sm text-green-800 max-w-md mx-auto text-center">
      ✅ Запись подтверждена
      {p.doctor_name && <div className="text-xs text-green-700">{p.doctor_name}</div>}
      {dt && <div className="text-xs text-green-700">{dt}</div>}
    </div>
  )
}
