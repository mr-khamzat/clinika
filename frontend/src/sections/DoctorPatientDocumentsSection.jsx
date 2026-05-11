/**
 * ========================================
 * БЛОК: DoctorPatientDocumentsSection — документы пациента глазами врача (Глава 9)
 * ========================================
 * Используется внутри DoctorLayout.jsx — контекстная панель «Документы пациента»
 * в карточке приёма / списке моих пациентов.
 *
 * API:
 *   GET /doctor/patients/{patient_id}/documents
 *   GET /doctor/patients/{patient_id}/documents/{doc_id}/download
 *
 * Бэкенд сам фильтрует по visibility — врач видит только те документы,
 * чей visibility включает врачей (doctors/clinic/admins+doctors).
 *
 * Props:
 *   patientId — number | string (ID пациента в МИС/в системе)
 *   compact   — boolean (если true — без header, для встраивания)
 * ========================================
 */
import { useEffect, useState, lazy, Suspense, useCallback } from 'react'
import api from '../api'
import { useToast } from '../design'

const DocumentCard  = lazy(() => import('../components/documents/DocumentCard'))
const ImageLightbox = lazy(() => import('../components/documents/ImageLightbox'))

export default function DoctorPatientDocumentsSection({ patientId, compact = false }) {
  const { toast } = useToast()
  const [docs, setDocs]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [preview, setPreview] = useState(null)

  const load = useCallback(async () => {
    if (!patientId) { setLoading(false); setDocs([]); return }
    setLoading(true); setError(null)
    try {
      const r = await api.get(`/doctor/patients/${patientId}/documents`)
      setDocs(Array.isArray(r.data) ? r.data : (r.data?.documents || []))
    } catch (e) {
      const s = e?.response?.status
      if (s === 404) setDocs([])
      else if (s === 403) setError('forbidden')
      else if (s === 402) setError('module_off')
      else setError('load_failed')
    } finally {
      setLoading(false)
    }
  }, [patientId])

  useEffect(() => { load() }, [load])

  const downloadDoc = (doc) => {
    // axios с auth-headers → blob → URL
    api.get(`/doctor/patients/${patientId}/documents/${doc.id}/download`, { responseType: 'blob' })
      .then(r => {
        const url = URL.createObjectURL(r.data)
        const a = document.createElement('a')
        a.href = url
        a.download = doc.title || `document_${doc.id}`
        document.body.appendChild(a); a.click(); a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      })
      .catch(() => toast('Не удалось скачать файл', 'error', 3000))
  }

  const previewDoc = async (doc) => {
    try {
      const r = await api.get(`/doctor/patients/${patientId}/documents/${doc.id}/download`, { responseType: 'blob' })
      const file_url = URL.createObjectURL(r.data)
      setPreview({ ...doc, file_url, _blobUrl: file_url })
    } catch {
      toast('Не удалось открыть документ', 'error', 3000)
    }
  }

  const closePreview = () => {
    if (preview?._blobUrl) URL.revokeObjectURL(preview._blobUrl)
    setPreview(null)
  }

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 animate-pulse">
        {[1,2,3,4].map(i => <div key={i} className="h-40 rounded-2xl" style={{ background: 'var(--accent-soft)' }} />)}
      </div>
    )
  }

  if (error === 'forbidden') {
    return (
      <div className="rounded-2xl p-5 text-center" style={{ background: 'var(--accent-soft)', border: '1px dashed var(--border)' }}>
        <span className="material-symbols-outlined text-3xl mb-1 block" style={{ color: 'var(--fg-3)' }}>visibility_off</span>
        <p className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>Пациент не открыл документы для врачей</p>
        <p className="text-xs mt-1" style={{ color: 'var(--fg-3)' }}>Спросите его лично или попросите загрузить в кабинет</p>
      </div>
    )
  }
  if (error === 'module_off') {
    return (
      <div className="rounded-2xl p-5 text-center" style={{ background: 'var(--accent-soft)' }}>
        <span className="material-symbols-outlined text-3xl mb-1 block" style={{ color: 'var(--fg-3)' }}>lock</span>
        <p className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>Модуль документов не подключён</p>
      </div>
    )
  }
  if (error === 'load_failed') {
    return (
      <div className="rounded-2xl p-5 text-center" style={{ background: '#FEE2E2' }}>
        <span className="material-symbols-outlined text-3xl mb-1 block" style={{ color: '#991B1B' }}>error</span>
        <p className="text-sm font-semibold" style={{ color: '#991B1B' }}>Не удалось загрузить документы</p>
      </div>
    )
  }

  if (docs.length === 0) {
    return (
      <div className="rounded-2xl p-5 text-center" style={{ background: 'var(--accent-soft)', border: '1px dashed var(--border)' }}>
        <span className="material-symbols-outlined text-3xl mb-1 block" style={{ color: 'var(--fg-3)' }}>folder_off</span>
        <p className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>Пока документов нет</p>
        <p className="text-xs mt-1" style={{ color: 'var(--fg-3)' }}>Пациент пока не загружал материалы для врача</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {!compact && (
        <div className="flex items-center justify-between">
          <p className="text-xs" style={{ color: 'var(--fg-3)' }}>
            {docs.length} {plural(docs.length, ['документ', 'документа', 'документов'])} · доступны для врача
          </p>
        </div>
      )}
      <Suspense fallback={<div className="h-40 rounded-2xl" style={{ background: 'var(--accent-soft)' }} />}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {docs.map(d => (
            <DocumentCard
              key={d.id}
              doc={d}
              onPreview={previewDoc}
              onDownload={downloadDoc}
              readOnly
            />
          ))}
        </div>
      </Suspense>

      <Suspense fallback={null}>
        {preview && (
          <ImageLightbox
            open={!!preview}
            doc={preview}
            onClose={closePreview}
            onDownload={downloadDoc}
          />
        )}
      </Suspense>
    </div>
  )
}

function plural(n, f) {
  const abs = Math.abs(n) % 100
  const n1 = abs % 10
  if (abs > 10 && abs < 20) return f[2]
  if (n1 > 1 && n1 < 5) return f[1]
  if (n1 === 1) return f[0]
  return f[2]
}
