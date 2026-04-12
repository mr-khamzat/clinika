import StatusBadge from './StatusBadge'
import { useNavigate } from 'react-router-dom'

export default function ReferralCard({ referral, onCancelRequest }) {
  const nav = useNavigate()
  const canRequestCancel = ['created', 'confirmed'].includes(referral.status)

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm mb-3">
      <div
        onClick={() => nav(`/qr/${referral.id}`)}
        className="cursor-pointer hover:opacity-80 transition-opacity"
      >
        <div className="flex justify-between items-start mb-2">
          <span className="font-semibold text-gray-800 dark:text-white">{referral.service_name || 'Услуга'}</span>
          <StatusBadge status={referral.status} />
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">📍 {referral.to_clinic_name || 'Клиника'}</p>
        <p className="text-sm text-gray-500 dark:text-gray-400">📞 {referral.patient_phone}</p>
        {referral.bonus_amount && (
          <p className="text-sm text-success font-medium mt-1">+{referral.bonus_amount} Б</p>
        )}
        {referral.status === 'cancel_requested' && referral.cancel_reason && (
          <p className="text-xs text-orange-500 mt-1">⏳ На отмене: «{referral.cancel_reason}»</p>
        )}
        {referral.status === 'cancelled' && referral.cancel_reason && (
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">❌ Отменено: «{referral.cancel_reason}»</p>
        )}
      </div>

      {canRequestCancel && onCancelRequest && (
        <button
          onClick={e => { e.stopPropagation(); onCancelRequest() }}
          className="mt-3 w-full text-xs text-red-400 border border-red-100 dark:border-red-900 rounded-xl py-1.5 hover:bg-red-50 dark:hover:bg-red-900/30 transition"
        >
          Запросить удаление
        </button>
      )}
    </div>
  )
}
