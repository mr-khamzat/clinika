/**
 * pages/admin/PatientEngagement.jsx — тонкая страница-обёртка для AdminLayout.
 * Просто ре-экспортирует основной компонент из sections/engagement/.
 *
 * Так задано в ТЗ:
 * «case 'engagement': return <Suspense><PatientEngagement token={adminToken} /></Suspense>»
 */
import PatientEngagement from '../../sections/engagement/PatientEngagement'

export default function PatientEngagementAdminPage(props) {
  return <PatientEngagement {...props} />
}
