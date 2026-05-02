import { useNavigate } from 'react-router-dom'
import InterClinicInvoicesSection from '../sections/InterClinicInvoicesSection'

function PageHeader() {
  const nav = useNavigate()
  return (
    <div className="sticky top-14 z-30 bg-[#f7f9fb]/90 dark:bg-gray-900/90 backdrop-blur-sm px-4 pt-4 pb-3 border-b border-[#eceef0]/60 dark:border-gray-700/60 mb-4">
      <div className="flex items-center gap-3">
        <button onClick={() => nav('/manager')} className="w-8 h-8 rounded-xl bg-white dark:bg-gray-800 flex items-center justify-center shadow-sm active:scale-95 transition-transform">
          <span className="material-symbols-outlined text-[#727783] text-xl">arrow_back_ios_new</span>
        </button>
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-xl text-blue-600" style={{ fontVariationSettings:"'FILL' 1" }}>receipt_long</span>
          <h1 className="text-lg font-extrabold text-[#191c1e] dark:text-white font-headline">Межклиничные счета</h1>
        </div>
      </div>
    </div>
  )
}

export default function ManagerInvoices() {
  return (
    <div className="min-h-screen bg-[#f7f9fb] dark:bg-gray-900">
      <PageHeader />
      <div className="px-4 pb-24">
        <InterClinicInvoicesSection isSupervisor={false} />
      </div>
    </div>
  )
}
