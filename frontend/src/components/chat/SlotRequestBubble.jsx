/**
 * chatslot01: бабл «пациент просит запись» — рендерится в чате клиники.
 *
 * Props:
 *   message        — { payload: SlotRequestPayload, ... }
 *   isStaff        — true если рендерим в ClinicChatSection (показываем кнопку «Предложить слоты»)
 *   onOfferRequest — callback: parent открывает ClinicSlotPicker, преднастроенный на doctor/service/dates
 */
export default function SlotRequestBubble({ message, isStaff = false, onOfferRequest }) {
  const req = message?.payload || {}
  // Готовим читаемую строку дат (ru-RU)
  const dates = (req.preferred_dates || [])
    .map(d => new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }))
    .join(', ')

  return (
    <div className="rounded-2xl p-3 bg-amber-50 border border-amber-100 max-w-md">
      <div className="text-xs text-amber-800 font-semibold mb-1">📅 Пациент просит запись</div>
      {dates && <div className="text-sm text-gray-700">Желаемые даты: {dates}</div>}
      {req.note && <div className="text-sm text-gray-700 mt-1">«{req.note}»</div>}
      {isStaff && (
        <button
          type="button"
          onClick={() => onOfferRequest?.(req)}
          className="mt-2 text-sm bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-lg"
        >
          Предложить слоты
        </button>
      )}
    </div>
  )
}
