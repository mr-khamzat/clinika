/**
 * pages/director/PatientEngagement.jsx — тонкая страница-обёртка для DirectorLayout.
 * Импортирует userToken из useAuthStore (общий паттерн директорских страниц).
 */
import { Suspense, lazy } from 'react'
import useAuthStore from '../../store/auth'

const PatientEngagement = lazy(() => import('../../sections/engagement/PatientEngagement'))

export default function DirectorPatientEngagementPage() {
  const token = useAuthStore(s => s.token)
  return (
    <Suspense fallback={<div className="text-center py-10 text-gray-400">Загрузка раздела…</div>}>
      <PatientEngagement token={token} />
    </Suspense>
  )
}
