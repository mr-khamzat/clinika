/** pages/director/NetworkDashboard.jsx — обёртка для DirectorLayout. */
import { Suspense, lazy } from "react"
import useAuthStore from "../../store/auth"

const NetworkDashboard = lazy(() => import("../../sections/network/NetworkDashboard"))

export default function DirectorNetworkPage() {
  const token = useAuthStore(s => s.token)
  return (
    <Suspense fallback={<div className="text-center py-10 text-gray-400">Загрузка раздела…</div>}>
      <NetworkDashboard token={token} />
    </Suspense>
  )
}
