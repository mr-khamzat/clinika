/**
 * ========================================
 * БЛОК: ReceiptsListSection — список фискальных чеков клиники
 * ========================================
 * Модуль: fiscal_54fz_pro
 *
 * Endpoint: GET /clinics/{id}/receipts?from&to
 *
 * Показывает: дата, тип операции, сумма, ФД/ФН/ФП, QR (ссылка ФНС).
 * ========================================
 */
import { useEffect, useState, useCallback } from 'react'
import axios from 'axios'
import { API_BASE } from '../../config'

const authH = (token) => ({ Authorization: `Bearer ${token}` })

const OP_LABEL = {
  sale: 'Продажа',
  refund_sale: 'Возврат',
  sale_correction: 'Коррекция',
}

const fmtRub = (v) => `${Math.round(Number(v || 0)).toLocaleString('ru')} ₽`

export default function ReceiptsListSection({ token, clinicId, showToast }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  const _toast = (kind, msg) => {
    if (typeof showToast === 'function') showToast(kind, msg)
  }

  const load = useCallback(async () => {
    if (!clinicId) return
    setLoading(true)
    try {
      const r = await axios.get(`${API_BASE}/clinics/${clinicId}/receipts`, {
        headers: authH(token),
      })
      setItems(Array.isArray(r.data) ? r.data : [])
    } catch (e) {
      _toast('error', e?.response?.data?.detail || 'Ошибка загрузки чеков')
    } finally {
      setLoading(false)
    }
  }, [clinicId, token])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-extrabold text-gray-900 dark:text-white">
        Фискальные чеки 54-ФЗ
      </h2>

      {loading ? (
        <div className="flex justify-center py-10">
          <div className="w-7 h-7 border-4 border-[#0097A7] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-sm text-gray-500 py-8 text-center">
          Чеков пока нет — настройте ОФД и нажмите «Обновить чеки сейчас».
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr className="text-left text-xs text-gray-500 dark:text-gray-400">
                <th className="px-3 py-2">Дата</th>
                <th className="px-3 py-2">Тип</th>
                <th className="px-3 py-2">Сумма</th>
                <th className="px-3 py-2">ФД / ФН</th>
                <th className="px-3 py-2">ОФД</th>
                <th className="px-3 py-2">QR</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-gray-100 dark:border-gray-700 text-gray-800 dark:text-gray-200"
                >
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.receipt_at ? new Date(r.receipt_at).toLocaleString('ru') : '—'}
                  </td>
                  <td className="px-3 py-2">{OP_LABEL[r.operation_type] || r.operation_type}</td>
                  <td className="px-3 py-2 font-semibold">{fmtRub(r.total_sum)}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    <div>{r.fiscal_doc_number || '—'}</div>
                    <div className="text-gray-400">{r.fiscal_storage_number || '—'}</div>
                  </td>
                  <td className="px-3 py-2 capitalize">{r.ofd_provider}</td>
                  <td className="px-3 py-2">
                    {r.qr_code ? (
                      <a
                        href={`https://lkdr.nalog.ru/check/?${r.qr_code}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#0097A7] hover:underline text-xs"
                      >
                        Проверить ↗
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
