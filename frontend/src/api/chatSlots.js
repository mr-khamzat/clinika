/**
 * chatslot01: API клиент для slot-booking endpoints чата.
 *
 * Используется в SlotOfferBubble / SlotRequestBubble / ClinicSlotPicker / PatientSlotRequestPicker.
 */
import api from './index'

export const chatSlotsApi = {
  // Регистратор → пациент (POST /clinic-chat/threads/{thread_id}/slot-offer)
  postSlotOffer: (threadId, body) =>
    api.post(`/clinic-chat/threads/${threadId}/slot-offer`, body).then(r => r.data),

  // Пациент → клиника (POST /patient/chat/threads/{thread_id}/slot-request)
  postSlotRequest: (threadId, body) =>
    api.post(`/patient/chat/threads/${threadId}/slot-request`, body).then(r => r.data),

  // Пациент кликает слот — Idempotency-Key защищает от двойного клика
  bookSlot: (threadId, messageId, slotIdx) =>
    api.post(
      `/patient/chat/threads/${threadId}/book-slot`,
      { message_id: messageId, slot_idx: slotIdx },
      { headers: { 'Idempotency-Key': `${threadId}-${messageId}-${slotIdx}` } }
    ).then(r => r.data),
}
