/**
 * ========================================
 * БЛОК: SmsMarketingSection — модуль SMS-маркетинга
 * ========================================
 * Главный wrapper с Tabs для 4 подразделов:
 *   - Кампании  (SmsCampaignsSection)
 *   - Шаблоны   (SmsTemplatesSection)
 *   - История   (SmsHistorySection)
 *   - Аналитика (SmsAnalyticsSection)
 *
 * Все эндпоинты — /sms/* с require_module("sms_marketing").
 * При отсутствии подписки секции внутри показывают CTA «Подключить модуль».
 * ========================================
 */
import { useState } from 'react'
import { Tabs } from '../../design'
import SmsCampaignsSection from './SmsCampaignsSection'
import SmsTemplatesSection from './SmsTemplatesSection'
import SmsHistorySection from './SmsHistorySection'
import SmsAnalyticsSection from './SmsAnalyticsSection'

export default function SmsMarketingSection({ token }) {
  const [tab, setTab] = useState('campaigns')

  const tabs = [
    { id: 'campaigns', label: 'Кампании' },
    { id: 'templates', label: 'Шаблоны' },
    { id: 'history',   label: 'История' },
    { id: 'analytics', label: 'Аналитика' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-extrabold text-gray-900 dark:text-white flex items-center gap-2">
          <span
            className="material-symbols-outlined text-[#0097A7]"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            sms
          </span>
          SMS-маркетинг
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Шаблоны, рассылки спящим пациентам, история отправок и аналитика доставки
        </p>
      </div>

      <Tabs items={tabs} value={tab} onChange={setTab} />

      <div>
        {tab === 'campaigns' && <SmsCampaignsSection token={token} />}
        {tab === 'templates' && <SmsTemplatesSection token={token} />}
        {tab === 'history'   && <SmsHistorySection   token={token} />}
        {tab === 'analytics' && <SmsAnalyticsSection token={token} />}
      </div>
    </div>
  )
}
