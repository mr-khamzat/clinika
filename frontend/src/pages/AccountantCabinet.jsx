/**
 * ========================================
 * БЛОК: AccountantCabinet — корневой роутер кабинета бухгалтера
 * ========================================
 * Лениво-загружаемые страницы под /{slug}/accountant/*.
 * Phase 2 страницы (payments/payroll/spending/reports) — stub'ы,
 * подключение реальных модулей оставлено на следующего агента.
 * ========================================
 */
import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'

const AccSummary          = lazy(() => import('./accountant/AccSummary'))
const AccCash             = lazy(() => import('./accountant/AccCash'))
const AccActs             = lazy(() => import('./accountant/AccActs'))
const AccIncomingInvoices = lazy(() => import('./accountant/AccIncomingInvoices'))

// Phase 2 placeholders — отдельный агент допишет реальные модули,
// пока показываем stub чтобы навигация не падала с ChunkLoadError.
const AccPayments = lazy(() => import('./accountant/AccPayments').catch(() => ({ default: Stub })))
const AccPayroll  = lazy(() => import('./accountant/AccPayroll').catch(()  => ({ default: Stub })))
const AccSpending = lazy(() => import('./accountant/AccSpending').catch(() => ({ default: Stub })))
const AccReports  = lazy(() => import('./accountant/AccReports').catch(()  => ({ default: Stub })))

function Stub() {
  return <div style={{ padding: 24, color: 'var(--fg-2)' }}>Страница в разработке</div>
}

export default function AccountantCabinet() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh' }} />}>
      <Routes>
        <Route index element={<Navigate to="summary" replace />} />
        <Route path="summary"  element={<AccSummary />} />
        <Route path="cash"     element={<AccCash />} />
        <Route path="acts"     element={<AccActs />} />
        <Route path="incoming-invoices" element={<AccIncomingInvoices />} />
        <Route path="payments" element={<AccPayments />} />
        <Route path="payroll"  element={<AccPayroll />} />
        <Route path="spending" element={<AccSpending />} />
        <Route path="reports"  element={<AccReports />} />
      </Routes>
    </Suspense>
  )
}
