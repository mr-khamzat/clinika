/**
 * ========================================
 * БЛОК: LoyaltySection — программа лояльности (W5 master plan)
 * ========================================
 * Главный wrapper с Tabs для 4 подразделов:
 *   - Тиры          (LoyaltyTiersSection)
 *   - Правила       (LoyaltyRulesSection)
 *   - История       (LoyaltyTransactionsSection)
 *   - Обмен баллов  (LoyaltyExchangeSection)
 *
 * Все эндпоинты — /loyalty/* с require_module("loyalty_pro").
 * При отсутствии подписки показываем CTA «Подключить модуль».
 * ========================================
 */
import { useState } from 'react'
import { Tabs } from '../../design'
import LoyaltyTiersSection from './LoyaltyTiersSection'
import LoyaltyRulesSection from './LoyaltyRulesSection'
import LoyaltyTransactionsSection from './LoyaltyTransactionsSection'
import LoyaltyExchangeSection from './LoyaltyExchangeSection'

export default function LoyaltySection({ token }) {
  const [tab, setTab] = useState('tiers')

  const tabs = [
    { id: 'tiers',    label: 'Тиры' },
    { id: 'rules',    label: 'Правила начисления' },
    { id: 'history',  label: 'История' },
    { id: 'exchange', label: 'Обмен баллов' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-extrabold text-gray-900 dark:text-white flex items-center gap-2">
          <span
            className="material-symbols-outlined text-[#0097A7]"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            loyalty
          </span>
          Программа лояльности
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Тиры, автоначисления, история операций и каталог обмена баллов
        </p>
      </div>

      <Tabs items={tabs} value={tab} onChange={setTab} />

      <div>
        {tab === 'tiers'    && <LoyaltyTiersSection token={token} />}
        {tab === 'rules'    && <LoyaltyRulesSection token={token} />}
        {tab === 'history'  && <LoyaltyTransactionsSection token={token} />}
        {tab === 'exchange' && <LoyaltyExchangeSection token={token} />}
      </div>
    </div>
  )
}
