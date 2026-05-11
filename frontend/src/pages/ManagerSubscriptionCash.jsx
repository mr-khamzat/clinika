/**
 * ========================================
 * БЛОК: ManagerSubscriptionCash (premium-страница)
 * ========================================
 * Wrapper-page для роута /manager/subscription-cash.
 * Оборачивает ManagerSubscriptionCashSection в общий ManagerShell.
 * ========================================
 */
import ManagerSubscriptionCashSection from '../sections/ManagerSubscriptionCashSection'
import ManagerShell from './_ManagerShell'

export default function ManagerSubscriptionCash() {
  return (
    <ManagerShell
      active="subscription_cash"
      title="Подписки (наличные)"
      subtitle="Активация тарифа за наличную оплату с печатью квитанции"
      icon="payments"
    >
      <ManagerSubscriptionCashSection />
    </ManagerShell>
  )
}
