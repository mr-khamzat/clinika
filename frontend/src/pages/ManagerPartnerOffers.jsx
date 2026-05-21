/**
 * ========================================
 * БЛОК: ManagerPartnerOffers — страница «Партнёрский прайс» в кабинете управляющего
 * ========================================
 * Оборачивает PartnerOffersAdmin (две вкладки: «Услуги в прайсе» + «Категории»)
 * в общий ManagerShell (sticky topbar + bottom nav), чтобы из неё работали меню
 * и кнопка возврата на главную, как на остальных Manager-страницах.
 *
 * Активный раздел в bottom-nav — 'partner_offers' (см. _ManagerShell.jsx MGR_NAV).
 * Lazy-load PartnerOffersAdmin — чтобы не тащить вкладки в initial bundle менеджера.
 * ========================================
 */
import { lazy, Suspense } from 'react'
import ManagerShell from './_ManagerShell'

const PartnerOffersAdmin = lazy(() => import('../components/admin/PartnerOffersAdmin'))

export default function ManagerPartnerOffers() {
  return (
    <ManagerShell
      active="partner_offers"
      title="Партнёрский прайс"
      subtitle="Категории и услуги в прайсе для бонусов внешним врачам"
      icon="price_change"
    >
      <Suspense fallback={
        <div className="space-y-2">
          <div className="rounded-2xl h-16 animate-pulse" style={{ background: '#e5e7eb' }} />
          <div className="rounded-2xl h-64 animate-pulse" style={{ background: '#e5e7eb' }} />
        </div>
      }>
        <PartnerOffersAdmin />
      </Suspense>
    </ManagerShell>
  )
}
