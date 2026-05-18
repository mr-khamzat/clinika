/**
 * PatientEngagement.jsx — корневой компонент раздела «Пациенты ЛК» (CRM-hub).
 * Подключается тремя layout-ами: AdminLayout, FranchiseOwnerCabinet, DirectorLayout.
 *
 * Локальные tab-ы (без роутера):
 *   - dashboard:   сводные метрики + графики
 *   - patients:    таблица + фильтры + bulk-actions
 *   - suggestions: автогенерируемые подсказки менеджеру
 *   - campaigns:   список push-кампаний
 *
 * Глобальные модальные окна:
 *   - PatientCardModal       — открывается из любого места по patientId
 *   - PushComposeModal       — создание кампании (из suggestions, из patients bulk, из CampaignsList)
 *   - SegmentEditorModal     — создать/редактировать сегмент
 *   - PushTemplatesModal     — каталог шаблонов
 *   - CampaignDetailsModal   — детальная стата кампании
 */
import { useState, lazy, Suspense } from 'react'

const EngagementDashboard  = lazy(() => import('./EngagementDashboard'))
const PatientsTable        = lazy(() => import('./PatientsTable'))
const SuggestionsBoard     = lazy(() => import('./SuggestionsBoard'))
const CampaignsList        = lazy(() => import('./CampaignsList'))
const PatientCardModal     = lazy(() => import('./PatientCardModal'))
const PushComposeModal     = lazy(() => import('./PushComposeModal'))
const SegmentEditorModal   = lazy(() => import('./SegmentEditorModal'))
const PushTemplatesModal   = lazy(() => import('./PushTemplatesModal'))
// CampaignDetailsModal — именованный export из CampaignsList; обернём через ленивую stub-обёртку:
const CampaignDetailsModal = lazy(() => import('./CampaignsList').then(m => ({ default: m.CampaignDetailsModal })))

const TABS = [
  { id: 'dashboard',   label: 'Дашборд',     icon: 'space_dashboard' },
  { id: 'patients',    label: 'Пациенты',    icon: 'groups' },
  { id: 'suggestions', label: 'Подсказки',   icon: 'tips_and_updates' },
  { id: 'campaigns',   label: 'Кампании',    icon: 'campaign' },
]

function SectionLoader() {
  return <div className="text-center py-10 text-gray-400">Загрузка…</div>
}

export default function PatientEngagement({ token }) {
  const [tab, setTab] = useState('dashboard')

  // global modals
  const [openCardId, setOpenCardId] = useState(null)
  const [composeInitial, setComposeInitial] = useState(null) // null или объект → откроет PushComposeModal
  const [editSegment, setEditSegment] = useState(null)       // null или { id?, initialFilter? } → откроет SegmentEditorModal
  const [showTemplates, setShowTemplates] = useState(false)
  const [campaignDetailsId, setCampaignDetailsId] = useState(null)

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-2 border border-gray-200 dark:border-gray-700 flex flex-wrap items-center gap-1 shadow-sm">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 transition ${
              tab === t.id
                ? 'bg-gradient-to-r from-cyan-500 to-teal-500 text-white shadow'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}>
            <span className="material-symbols-outlined text-base" style={tab === t.id ? { fontVariationSettings: "'FILL' 1" } : undefined}>{t.icon}</span>
            {t.label}
          </button>
        ))}

        <div className="ml-auto flex flex-wrap gap-1">
          <button onClick={() => setShowTemplates(true)}
            className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-1">
            <span className="material-symbols-outlined text-base">description</span>Шаблоны
          </button>
          <button onClick={() => setEditSegment({})}
            className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-1">
            <span className="material-symbols-outlined text-base">group_add</span>Новый сегмент
          </button>
        </div>
      </div>

      <Suspense fallback={<SectionLoader />}>
        {tab === 'dashboard'   && <EngagementDashboard token={token} />}

        {tab === 'patients'    && (
          <PatientsTable
            token={token}
            onOpenCard={setOpenCardId}
            onCreateCampaign={(ids) => setComposeInitial({ patient_ids: ids })}
            onSaveSegment={(ids) => setEditSegment({ initialFilter: { patient_ids: ids } })}
            onBulkTag={(ids) => alert(`Bulk-тэг для ${ids.length} пациентов — TODO: модалка выбора тэга`)}
          />
        )}

        {tab === 'suggestions' && (
          <SuggestionsBoard
            token={token}
            onOpenCard={setOpenCardId}
            onComposePush={(initial) => setComposeInitial(initial)}
          />
        )}

        {tab === 'campaigns'   && (
          <CampaignsList
            token={token}
            onCompose={(initial) => setComposeInitial(initial || {})}
            onOpenDetails={(id) => setCampaignDetailsId(id)}
          />
        )}
      </Suspense>

      {/* Глобальные модалки */}
      <Suspense fallback={null}>
        {openCardId && (
          <PatientCardModal token={token} patientId={openCardId} onClose={() => setOpenCardId(null)} />
        )}
        {composeInitial && (
          <PushComposeModal
            token={token}
            initial={composeInitial}
            onClose={() => setComposeInitial(null)}
            onCreated={() => setComposeInitial(null)}
          />
        )}
        {editSegment && (
          <SegmentEditorModal
            token={token}
            segment={editSegment.id ? editSegment : null}
            initialFilter={editSegment.initialFilter}
            onClose={() => setEditSegment(null)}
            onSaved={() => setEditSegment(null)}
          />
        )}
        {showTemplates && (
          <PushTemplatesModal token={token} onClose={() => setShowTemplates(false)} />
        )}
        {campaignDetailsId && (
          <CampaignDetailsModal token={token} campaignId={campaignDetailsId} onClose={() => setCampaignDetailsId(null)} />
        )}
      </Suspense>
    </div>
  )
}
