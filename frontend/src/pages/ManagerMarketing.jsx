/**
 * ========================================
 * БЛОК: ManagerMarketing — страница «Маркетинг» в кабинете управляющего
 * ========================================
 * Управление маркетинговыми расходами, справочником каналов и атрибуцией
 * пациентов к каналам. Три вкладки:
 *   • Расходы            — таблица записей ad_spend с KPI и CRUD
 *   • Каналы             — справочник marketing_channels (CRUD только tenant-каналов)
 *   • Атрибуция пациентов — patient_attribution + поиск по телефону/ФИО
 *
 * Backend API (Stage 1 уже задеплоен):
 *   GET/POST/PATCH/DELETE /marketing/channels
 *   GET/POST/PATCH/DELETE /marketing/ad-spend
 *   GET/POST/PATCH/DELETE /marketing/attribution
 *
 * Stage 2+3 (отчёты, импорт) — другой агент, не трогаем.
 * ========================================
 */
import { lazy, Suspense, useState } from 'react'
import ManagerShell from './_ManagerShell'
import { Tabs } from '../design'

const AdSpendTab = lazy(() => import('../components/marketing/AdSpendTab'))
const ChannelsTab = lazy(() => import('../components/marketing/ChannelsTab'))
const AttributionTab = lazy(() => import('../components/marketing/AttributionTab'))

const TABS = [
  { id: 'spend',       label: 'Расходы' },
  { id: 'channels',    label: 'Каналы' },
  { id: 'attribution', label: 'Атрибуция пациентов' },
]

export default function ManagerMarketing() {
  const [tab, setTab] = useState('spend')

  return (
    <ManagerShell
      active="marketing"
      title="Маркетинг"
      subtitle="Расходы на рекламу, каналы привлечения и атрибуция пациентов"
      icon="campaign"
    >
      {/* ─── Tabs ─── */}
      <div className="mb-4 overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
        <Tabs items={TABS} value={tab} onChange={setTab} />
      </div>

      {/* ─── Контент таба ─── */}
      <Suspense fallback={
        <div className="space-y-2">
          <div className="rounded-2xl h-16 animate-pulse" style={{ background: 'var(--bg-2)' }} />
          <div className="rounded-2xl h-32 animate-pulse" style={{ background: 'var(--bg-2)' }} />
        </div>
      }>
        {tab === 'spend' && <AdSpendTab />}
        {tab === 'channels' && <ChannelsTab />}
        {tab === 'attribution' && <AttributionTab />}
      </Suspense>
    </ManagerShell>
  )
}
