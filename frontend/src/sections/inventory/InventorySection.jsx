/**
 * ========================================
 * БЛОК: InventorySection — учёт инвентаря (W7 master plan)
 * ========================================
 * Главный wrapper с Tabs для 4 подразделов:
 *   - Каталог   (InventoryItemsSection)
 *   - Остатки   (InventoryStocksSection)
 *   - Движения  (InventoryMovementsSection)
 *   - Алерты    (InventoryAlertsSection)
 *
 * Все эндпоинты — /inventory/* с require_module("inventory").
 * Гейт показа в навигации — на уровне AdminLayout.visibleNav.
 * ========================================
 */
import { useState } from 'react'
import { Tabs } from '../../design'
import InventoryItemsSection from './InventoryItemsSection'
import InventoryStocksSection from './InventoryStocksSection'
import InventoryMovementsSection from './InventoryMovementsSection'
import InventoryAlertsSection from './InventoryAlertsSection'

export default function InventorySection({ token }) {
  const [tab, setTab] = useState('items')

  const tabs = [
    { id: 'items',     label: 'Каталог' },
    { id: 'stocks',    label: 'Остатки' },
    { id: 'movements', label: 'Движения' },
    { id: 'alerts',    label: 'Алерты' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-extrabold text-gray-900 dark:text-white flex items-center gap-2">
          <span
            className="material-symbols-outlined text-[#0097A7]"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            inventory_2
          </span>
          Учёт инвентаря
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Расходные материалы, оборудование, медикаменты — остатки, движения, алерты
        </p>
      </div>

      <Tabs items={tabs} value={tab} onChange={setTab} />

      {tab === 'items'     && <InventoryItemsSection     token={token} />}
      {tab === 'stocks'    && <InventoryStocksSection    token={token} />}
      {tab === 'movements' && <InventoryMovementsSection token={token} />}
      {tab === 'alerts'    && <InventoryAlertsSection    token={token} />}
    </div>
  )
}
