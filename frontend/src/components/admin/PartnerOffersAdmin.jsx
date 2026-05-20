/**
 * ========================================
 * БЛОК: Корневой экран "Партнёрский прайс" (две вкладки)
 * ========================================
 * - Вкладка "Услуги в прайсе" — partner_service_offers.
 * - Вкладка "Категории"      — partner_categories.
 * Регистрация маршрута/пункта меню — в Task 9 (другой агент).
 * ========================================
 */
import { useState } from 'react'
import PartnerCategoriesTab from './PartnerCategoriesTab'
import PartnerOffersTab from './PartnerOffersTab'

export default function PartnerOffersAdmin() {
  const [tab, setTab] = useState('offers')
  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold p-4">Партнёрский прайс</h1>
      <div className="flex gap-2 px-4 border-b">
        <button
          className={`px-4 py-2 ${tab === 'offers' ? 'border-b-2 border-blue-600 font-semibold' : 'text-gray-600 hover:text-gray-900'}`}
          onClick={() => setTab('offers')}
        >
          Услуги в прайсе
        </button>
        <button
          className={`px-4 py-2 ${tab === 'cats' ? 'border-b-2 border-blue-600 font-semibold' : 'text-gray-600 hover:text-gray-900'}`}
          onClick={() => setTab('cats')}
        >
          Категории
        </button>
      </div>
      {tab === 'offers' ? <PartnerOffersTab /> : <PartnerCategoriesTab />}
    </div>
  )
}
