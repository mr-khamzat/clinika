/**
 * ========================================
 * БЛОК: PaymentsListSection — список платежей пациентов клиники
 * ========================================
 * Модуль: online_payments_pro
 *
 * Endpoint: GET /clinics/{id}/payments?status&from&to
 *
 * Фильтры: статус, дата от/до.
 * Действия: возврат (POST /payments/{id}/refund) — для manager.
 * ========================================
 */
import { useEffect, useState, useCallback } from 'react'
import api from '../../api'
import { useConfirm, EmptyState } from '../../design'

const STATUS_LABEL = {
  pending: { text: 'Ожидает', color: '#f59e0b' },
  succeeded: { text: 'Оплачен', color: '#10b981' },
  cancelled: { text: 'Отменён', color: '#94a3b8' },
  refunded: { text: 'Возврат', color: '#ef4444' },
}

const fmtRub = (v) => `${Math.round(Number(v || 0)).toLocaleString('ru')} ₽`

export default function PaymentsListSection({ token, clinicId, showToast }) {
  const [items, setItems] = useState([])
  const [statusFilter, setStatusFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [refundingId, setRefundingId] = useState(null)
  // Замена window.confirm на Modal-диалог из design-system
  const { confirm, ConfirmHost } = useConfirm()

  const _toast = (kind, msg) => {
    if (typeof showToast === 'function') showToast(kind, msg)
  }

  const load = useCallback(async () => {
    if (!clinicId) return
    setLoading(true)
    try {
      const params = {}
      if (statusFilter) params.status = statusFilter
      const r = await api.get(`/clinics/${clinicId}/payments`, { params })
      setItems(Array.isArray(r.data) ? r.data : [])
    } catch (e) {
      _toast('error', e?.response?.data?.detail || 'Ошибка загрузки платежей')
    } finally {
      setLoading(false)
    }
  }, [clinicId, statusFilter])

  useEffect(() => {
    load()
  }, [load])

  const handleRefund = async (id) => {
    const ok = await confirm('Сделать полный возврат?', { okText: 'Вернуть', danger: true })
    if (!ok) return
    setRefundingId(id)
    try {
      await api.post(`/payments/${id}/refund`, {})
      _toast('success', 'Возврат инициирован')
      await load()
    } catch (e) {
      _toast('error', e?.response?.data?.detail || 'Ошибка возврата')
    } finally {
      setRefundingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-extrabold text-gray-900 dark:text-white">
          Онлайн-платежи
        </h2>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
        >
          <option value="">Все статусы</option>
          <option value="pending">Ожидает</option>
          <option value="succeeded">Оплачен</option>
          <option value="cancelled">Отменён</option>
          <option value="refunded">Возврат</option>
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <div className="w-7 h-7 border-4 border-[#0097A7] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<span className="material-symbols-outlined" style={{ fontSize: 24 }}>payments</span>}
          title="Нет платежей"
          message="Здесь появятся оплаты пациентов после первой транзакции."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr className="text-left text-xs text-gray-500 dark:text-gray-400">
                <th className="px-3 py-2">Дата</th>
                <th className="px-3 py-2">Пациент</th>
                <th className="px-3 py-2">Сумма</th>
                <th className="px-3 py-2">Шлюз</th>
                <th className="px-3 py-2">Статус</th>
                <th className="px-3 py-2">Действия</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => {
                const st = STATUS_LABEL[p.status] || { text: p.status, color: '#64748b' }
                return (
                  <tr
                    key={p.id}
                    className="border-t border-gray-100 dark:border-gray-700 text-gray-800 dark:text-gray-200"
                  >
                    <td className="px-3 py-2 whitespace-nowrap">
                      {p.created_at ? new Date(p.created_at).toLocaleString('ru') : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{p.patient_name || '—'}</div>
                      <div className="text-xs text-gray-500">{p.patient_phone}</div>
                    </td>
                    <td className="px-3 py-2 font-semibold">{fmtRub(p.amount)}</td>
                    <td className="px-3 py-2 capitalize">{p.gateway}</td>
                    <td className="px-3 py-2">
                      <span
                        className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase"
                        style={{ background: `${st.color}22`, color: st.color }}
                      >
                        {st.text}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {p.status === 'succeeded' && (
                        <button
                          onClick={() => handleRefund(p.id)}
                          disabled={refundingId === p.id}
                          className="text-xs text-red-600 hover:underline disabled:opacity-50"
                        >
                          {refundingId === p.id ? 'Возврат…' : 'Вернуть'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmHost />
    </div>
  )
}
