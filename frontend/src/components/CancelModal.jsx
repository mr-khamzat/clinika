import { useState } from 'react'
import { requestCancelReferral } from '../api'

export default function CancelModal({ referral, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!reason.trim()) { setError('Укажите причину удаления'); return }
    setLoading(true)
    setError('')
    try {
      await requestCancelReferral(referral.id, reason.trim())
      onDone()
    } catch (err) {
      setError(err.response?.data?.detail || 'Ошибка отправки запроса')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="px-5 pt-5 pb-3">
          <h2 className="text-base font-bold text-gray-800 dark:text-white mb-1">Запрос на удаление</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            <span className="font-medium text-gray-700 dark:text-gray-300">{referral.service_name}</span>
            {' · '}{referral.patient_phone}
          </p>
        </div>

        <div className="px-5 pb-5">
          <form onSubmit={handleSubmit}>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Причина <span className="text-red-500">*</span>
            </label>
            <textarea
              rows={3}
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Например: ошибочно создано, пациент отказался..."
              className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-xl p-3 text-gray-800 text-sm focus:outline-none focus:border-red-400 resize-none"
            />
            {error && <p className="text-red-500 text-sm mt-2">{error}</p>}

            <div className="flex gap-3 mt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-xl py-3 text-sm font-medium"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={loading || !reason.trim()}
                className="flex-1 bg-red-500 text-white rounded-xl py-3 text-sm font-semibold disabled:opacity-50"
              >
                {loading ? 'Отправка...' : 'Отправить запрос'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
