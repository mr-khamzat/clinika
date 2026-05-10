/**
 * InventoryAlertsSection — текущие алерты по инвентарю.
 *
 * Два блока:
 *   - Низкие остатки (красные карточки)  — quantity < min_stock_threshold
 *   - Скоро просрочка (жёлтые)           — expiry_date в ближайшие 30 дней
 *   - Просрочено (тёмно-красные)         — expiry_date в прошлом
 *
 * Кнопка «Создать заказ» — открывает простую форму заявки vendor'у
 * (на этом этапе — только prefill списка позиций; реальное API заявок
 * подключится во второй итерации).
 */
import { useEffect, useState, useCallback } from 'react'
import api from '../../api'
import { Card, Button, Chip, Modal, EmptyState, useToast } from '../../design'

export default function InventoryAlertsSection() {
  const { toast } = useToast() || { toast: () => {} }
  const [data, setData] = useState({ low_stock: [], expiring: [], expired: [] })
  const [loading, setLoading] = useState(false)
  const [orderOpen, setOrderOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api({ method: 'GET', url: '/inventory/alerts' })
      setData(res.data || { low_stock: [], expiring: [], expired: [] })
    } catch (e) {
      const msg = e?.response?.data?.detail || 'Ошибка'
      toast?.(String(msg), 'error')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  const low = data.low_stock || []
  const expiring = data.expiring || []
  const expired = data.expired || []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Chip tone="bad">низкие: {low.length}</Chip>
          <Chip tone="warn">скоро просрочка: {expiring.length}</Chip>
          <Chip tone="bad">просрочено: {expired.length}</Chip>
        </div>
        <Button onClick={() => setOrderOpen(true)} disabled={low.length === 0}>
          Создать заказ
        </Button>
      </div>

      {loading && <div className="text-gray-400 text-sm">Загрузка…</div>}

      {/* Низкие остатки */}
      <div>
        <div className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-2">
          Низкие остатки
        </div>
        {low.length === 0 ? (
          <EmptyState title="Все остатки в норме" description="Запасы выше минимальных порогов" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {low.map(a => (
              <Card key={a.item_id}>
                <div className="p-4 border-l-4 border-red-500">
                  <div className="text-xs font-mono text-gray-500">{a.item_sku}</div>
                  <div className="font-semibold mb-1">{a.item_name}</div>
                  <div className="text-sm flex items-center justify-between">
                    <span>остаток</span>
                    <span className="font-mono text-red-600 font-bold">
                      {Number(a.quantity)} / {Number(a.min_threshold)}
                    </span>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Скоро просрочка */}
      <div>
        <div className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-2">
          Скоро просрочка (≤30 дней)
        </div>
        {expiring.length === 0 ? (
          <div className="text-sm text-gray-400">Просрочка в ближайшие 30 дней не ожидается</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {expiring.map(a => (
              <Card key={`${a.item_id}-${a.batch_number || ''}-${a.clinic_id}`}>
                <div className="p-4 border-l-4 border-amber-500">
                  <div className="text-xs font-mono text-gray-500">{a.item_sku}</div>
                  <div className="font-semibold mb-1">{a.item_name}</div>
                  <div className="text-sm flex items-center justify-between">
                    <span>истекает</span>
                    <span className="font-mono text-amber-700">
                      {a.expiry_date} ({a.days_left ?? '—'} дн.)
                    </span>
                  </div>
                  {a.batch_number && (
                    <div className="text-xs text-gray-500">партия {a.batch_number} · {Number(a.quantity)}</div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Просрочено */}
      {expired.length > 0 && (
        <div>
          <div className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-2">
            Просрочено (списать!)
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {expired.map(a => (
              <Card key={`${a.item_id}-${a.batch_number || ''}-${a.clinic_id}-x`}>
                <div className="p-4 border-l-4 border-red-700 bg-red-50/40 dark:bg-red-900/10">
                  <div className="text-xs font-mono text-gray-500">{a.item_sku}</div>
                  <div className="font-semibold mb-1">{a.item_name}</div>
                  <div className="text-sm flex items-center justify-between">
                    <span>истекло</span>
                    <span className="font-mono text-red-700 font-bold">
                      {a.expiry_date}
                    </span>
                  </div>
                  {a.batch_number && (
                    <div className="text-xs text-gray-500">партия {a.batch_number} · {Number(a.quantity)}</div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Модалка «Создать заказ» — заглушка, prefill списком low_stock */}
      <Modal open={orderOpen} onClose={() => setOrderOpen(false)} title="Создать заказ поставщику">
        <div className="p-1 space-y-3">
          <div className="text-sm text-gray-600 dark:text-gray-300">
            Список позиций для заказа (предзаполнение из «низкие остатки»):
          </div>
          <div className="max-h-[400px] overflow-y-auto border rounded-lg p-2">
            {low.length === 0 ? (
              <div className="text-sm text-gray-400 py-4 text-center">Нет позиций к заказу</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="px-2 py-1 text-left">SKU</th>
                    <th className="px-2 py-1 text-left">Название</th>
                    <th className="px-2 py-1 text-right">Остаток</th>
                    <th className="px-2 py-1 text-right">Мин.</th>
                  </tr>
                </thead>
                <tbody>
                  {low.map(a => (
                    <tr key={a.item_id}>
                      <td className="px-2 py-1 font-mono text-xs">{a.item_sku}</td>
                      <td className="px-2 py-1">{a.item_name}</td>
                      <td className="px-2 py-1 text-right font-mono text-red-600">{Number(a.quantity)}</td>
                      <td className="px-2 py-1 text-right font-mono">{Number(a.min_threshold)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="text-xs text-gray-500">
            * Реальная отправка заявки vendor'у — в следующей итерации модуля.
            Сейчас можно скопировать список и отправить вручную.
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOrderOpen(false)}>Закрыть</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
