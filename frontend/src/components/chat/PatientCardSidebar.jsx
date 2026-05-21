/**
 * chatslot01: карточка пациента в сайдбаре ClinicChatSection.
 *
 * Подтягивает: имя/телефон из patient_account, mis_sync_state, последние визиты из МИС.
 * Endpoint /clinic-chat/threads/{thread_id}/patient-context уже существует (см. clinic_chat.py:494).
 *
 * Props:
 *   threadId
 */
import { useEffect, useState } from 'react'
import api from '../../api'

// ─── Лейблы статуса синхронизации с МИС ───
const STATE_LABELS = {
  pending: { label: '⏳ Проверка в МИС…', color: 'text-amber-600' },
  linked: { label: '✅ Найден в МИС', color: 'text-green-700' },
  created: { label: '✅ Создан в МИС', color: 'text-green-700' },
  manual_required: { label: '⚠️ Требуется дозаполнение', color: 'text-red-600' },
  ambiguous: { label: '⚠️ Несколько аккаунтов с этим телефоном', color: 'text-red-600' },
  no_phone: { label: '⚠️ Телефон не указан', color: 'text-red-600' },
  error: { label: '⚠️ МИС недоступен', color: 'text-orange-600' },
}

export default function PatientCardSidebar({ threadId }) {
  const [ctx, setCtx] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!threadId) return
    setLoading(true)
    api.get(`/clinic-chat/threads/${threadId}/patient-context`)
       .then(r => setCtx(r.data))
       .catch(() => setCtx(null))
       .finally(() => setLoading(false))
  }, [threadId])

  if (loading) return <div className="p-3 text-sm text-gray-500">Загрузка карточки…</div>
  if (!ctx) return <div className="p-3 text-sm text-gray-500">Карточка недоступна</div>

  const state = STATE_LABELS[ctx.mis_sync_state] || STATE_LABELS.pending

  return (
    <div className="p-3 border-l border-gray-200 bg-white text-sm">
      <div className="font-semibold mb-1">{ctx.name || 'Без имени'}</div>
      <div className="text-gray-600 mb-2">{ctx.phone}</div>
      <div className={`text-xs mb-3 ${state.color}`}>{state.label}</div>

      {ctx.last_visits && ctx.last_visits.length > 0 && (
        <>
          <div className="text-xs text-gray-500 mb-1">Последние визиты:</div>
          <div className="flex flex-col gap-0.5 mb-3">
            {ctx.last_visits.slice(0, 5).map((v, i) => (
              <div key={i} className="text-xs text-gray-700">
                {new Date(v.date).toLocaleDateString('ru-RU')} — {v.doctor} ({v.service})
              </div>
            ))}
          </div>
        </>
      )}

      {ctx.balance !== undefined && (
        <div className="text-xs text-gray-700">Баланс: <b>{ctx.balance} ₽</b></div>
      )}
    </div>
  )
}
