/**
 * ========================================
 * БЛОК: DocumentCard — карточка документа (Глава 9)
 * ========================================
 * Используется в PatientDocumentsSection и DoctorPatientDocumentsSection.
 *
 * Props:
 *   doc        — {id, category, title, description, file_size, mime_type, uploaded_at, visibility, file_url?}
 *   onPreview  — (doc) => void  (для image/pdf — открыть лайтбокс)
 *   onDownload — (doc) => void
 *   onDelete   — (doc) => void  (optional, без неё — read-only режим)
 *   readOnly   — boolean
 * ========================================
 */

const CATEGORY_META = {
  analysis:    { label: 'Анализ',     color: '#06B6D4' },
  prescription:{ label: 'Рецепт',     color: '#10B981' },
  referral:    { label: 'Направление',color: '#F59E0B' },
  discharge:   { label: 'Выписка',    color: '#EF4444' },
  mri:         { label: 'МРТ',        color: '#8B5CF6' },
  xray:        { label: 'Рентген',    color: '#6366F1' },
  other:       { label: 'Прочее',     color: '#64748B' },
}

function iconForMime(mime = '') {
  const m = (mime || '').toLowerCase()
  if (m.includes('pdf')) return { icon: 'picture_as_pdf', color: '#DC2626' }
  if (m.startsWith('image/')) return { icon: 'image', color: '#0EA5E9' }
  if (m.includes('dicom')) return { icon: 'monitor_heart', color: '#7C3AED' }
  if (m.includes('word') || m.includes('msword')) return { icon: 'description', color: '#2563EB' }
  return { icon: 'draft', color: '#64748B' }
}

function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return '—'
  const b = Number(bytes)
  if (b < 1024) return `${b} Б`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} КБ`
  return `${(b / 1024 / 1024).toFixed(1)} МБ`
}

function fmtDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch { return iso }
}

const VIS_LABEL = {
  private:   { label: 'только я',  icon: 'lock',  color: '#64748B' },
  doctors:   { label: 'врачи',     icon: 'medical_services', color: '#0EA5E9' },
  admins:    { label: 'админы',    icon: 'admin_panel_settings', color: '#F59E0B' },
  clinic:    { label: 'клиника',   icon: 'local_hospital', color: '#10B981' },
}

export default function DocumentCard({ doc, onPreview, onDownload, onDelete, readOnly = false }) {
  const cat = CATEGORY_META[doc.category] || CATEGORY_META.other
  const ic = iconForMime(doc.mime_type)
  const vis = VIS_LABEL[doc.visibility] || null
  const isImage = (doc.mime_type || '').startsWith('image/')
  const isPdf = (doc.mime_type || '').toLowerCase().includes('pdf')

  return (
    <div
      className="rounded-2xl bg-white p-4 transition-all hover:shadow-md group flex flex-col"
      style={{ border: '1px solid rgba(0,0,0,.06)', minHeight: 180 }}
    >
      {/* Header: icon + category */}
      <div className="flex items-start justify-between mb-3">
        <button
          onClick={() => (isImage || isPdf) ? onPreview?.(doc) : onDownload?.(doc)}
          className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
        >
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: `${ic.color}15` }}
          >
            <span
              className="material-symbols-outlined text-2xl"
              style={{ color: ic.color, fontVariationSettings: "'FILL' 1" }}
            >
              {ic.icon}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <span
              className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide mb-0.5"
              style={{ background: `${cat.color}15`, color: cat.color }}
            >
              {cat.label}
            </span>
          </div>
        </button>
      </div>

      {/* Title + description */}
      <div className="flex-1 mb-3 min-w-0">
        <p className="text-sm font-bold leading-snug truncate" style={{ color: '#0F172A' }} title={doc.title}>
          {doc.title || 'Без названия'}
        </p>
        {doc.description && (
          <p className="text-xs mt-1 line-clamp-2" style={{ color: '#64748B' }}>
            {doc.description}
          </p>
        )}
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-2 text-[11px] mb-3" style={{ color: '#94A3B8' }}>
        <span>{fmtDate(doc.uploaded_at)}</span>
        <span>·</span>
        <span>{fmtSize(doc.file_size)}</span>
        {vis && (
          <>
            <span>·</span>
            <span className="inline-flex items-center gap-0.5" style={{ color: vis.color }}>
              <span className="material-symbols-outlined text-xs" style={{ fontVariationSettings: "'FILL' 1" }}>{vis.icon}</span>
              {vis.label}
            </span>
          </>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 mt-auto">
        {(isImage || isPdf) && (
          <button
            onClick={() => onPreview?.(doc)}
            className="flex-1 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95 flex items-center justify-center gap-1"
            style={{ background: '#F1F5F9', color: '#334155' }}
          >
            <span className="material-symbols-outlined text-base">visibility</span>
            Открыть
          </button>
        )}
        <button
          onClick={() => onDownload?.(doc)}
          className="flex-1 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95 flex items-center justify-center gap-1"
          style={{ background: 'rgba(99,102,241,.1)', color: '#4F46E5' }}
        >
          <span className="material-symbols-outlined text-base">download</span>
          Скачать
        </button>
        {!readOnly && onDelete && (
          <button
            onClick={() => onDelete?.(doc)}
            className="w-9 rounded-xl flex items-center justify-center transition-all active:scale-95"
            style={{ background: '#FEF2F2', color: '#DC2626' }}
            title="Удалить"
          >
            <span className="material-symbols-outlined text-base">delete</span>
          </button>
        )}
      </div>
    </div>
  )
}
