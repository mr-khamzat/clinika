/**
 * ========================================
 * БЛОК: PatientDocumentsSection — хранилище документов пациента (Глава 9)
 * ========================================
 * Используется внутри PatientCabinet.jsx (вкладка «Документы»).
 *
 * API:
 *   GET    /patient/documents            — список
 *   POST   /patient/documents/upload     — multipart (file+category+title+description+visibility)
 *   GET    /patient/documents/{id}/download — file response (window.open)
 *   (DELETE пациентом не поддерживается бэком — удаление только через клинику)
 *
 * Структура:
 *   1. Категории как табы (Все/Анализы/Рецепты/Направления/Выписки/МРТ/Рентген/Прочее)
 *   2. Drag&drop зона по всему body секции
 *   3. Grid карточек DocumentCard
 *   4. Кнопка «Загрузить» вверху → DocumentUploadModal
 *   5. Preview изображений и PDF → ImageLightbox
 * ========================================
 */
import { useEffect, useState, useCallback, lazy, Suspense, useMemo } from 'react'
import axios from 'axios'
import { API_BASE } from '../config'
import { useToast } from '../design'

const DocumentCard        = lazy(() => import('../components/documents/DocumentCard'))
const DocumentUploadModal = lazy(() => import('../components/documents/DocumentUploadModal'))
const ImageLightbox       = lazy(() => import('../components/documents/ImageLightbox'))

const SESSION_KEY = 'clinika_patient_session'

const CATEGORIES = [
  { key: 'all',          label: 'Все',          icon: 'folder' },
  { key: 'analysis',     label: 'Анализы',      icon: 'biotech' },
  { key: 'prescription', label: 'Рецепты',      icon: 'medication' },
  { key: 'referral',     label: 'Направления',  icon: 'assignment' },
  { key: 'discharge',    label: 'Выписки',      icon: 'description' },
  { key: 'mri',          label: 'МРТ',          icon: 'monitor_heart' },
  { key: 'xray',         label: 'Рентген',      icon: 'wb_iridescent' },
  { key: 'other',        label: 'Прочее',       icon: 'inventory_2' },
]

// SVG illustration для empty state — inline, дружелюбный
function EmptyIllustration() {
  return (
    <svg width="160" height="120" viewBox="0 0 160 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="30" y="20" width="80" height="92" rx="8" fill="#E0E7FF" />
      <rect x="38" y="32" width="64" height="6" rx="3" fill="#A5B4FC" />
      <rect x="38" y="44" width="48" height="4" rx="2" fill="#C7D2FE" />
      <rect x="38" y="54" width="56" height="4" rx="2" fill="#C7D2FE" />
      <rect x="38" y="64" width="40" height="4" rx="2" fill="#C7D2FE" />
      <circle cx="120" cy="36" r="20" fill="#FCD34D" />
      <path d="M114 36L118 40L126 32" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function PatientDocumentsSection({ sessionToken: sessionTokenProp }) {
  const sessionToken = sessionTokenProp || (typeof window !== 'undefined' ? localStorage.getItem(SESSION_KEY) : null)
  const { toast } = useToast()

  const [docs, setDocs]               = useState([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)
  const [tab, setTab]                 = useState('all')
  const [showUpload, setShowUpload]   = useState(false)
  const [preFile, setPreFile]         = useState(null)
  const [preview, setPreview]         = useState(null)
  const [pageDragOver, setPageDragOver] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await axios.get(`${API_BASE}/patient/documents`, { params: { t: sessionToken } })
      setDocs(Array.isArray(r.data) ? r.data : [])
    } catch (e) {
      const status = e?.response?.status
      if (status === 404) setDocs([])
      else if (status === 402) setError('module_off')
      else setError('load_failed')
    } finally {
      setLoading(false)
    }
  }, [sessionToken])

  useEffect(() => { load() }, [load])

  const counts = useMemo(() => {
    const m = { all: docs.length }
    for (const d of docs) {
      const k = d.category || 'other'
      m[k] = (m[k] || 0) + 1
    }
    return m
  }, [docs])

  const filtered = useMemo(() => {
    if (tab === 'all') return docs
    return docs.filter(d => (d.category || 'other') === tab)
  }, [docs, tab])

  const downloadDoc = (doc) => {
    const url = `${API_BASE}/patient/documents/${doc.id}/download?t=${encodeURIComponent(sessionToken || '')}`
    window.open(url, '_blank')
  }

  const previewDoc = async (doc) => {
    // Для preview формируем URL с токеном — браузер откроет в lightbox через img/iframe.
    const file_url = `${API_BASE}/patient/documents/${doc.id}/download?t=${encodeURIComponent(sessionToken || '')}`
    setPreview({ ...doc, file_url })
  }

  const onUploaded = (newDoc) => {
    if (newDoc?.id) setDocs(d => [newDoc, ...d])
    else load()
    toast('Документ загружен', 'success', 2500)
  }

  // Drag&drop на весь блок страницы
  const onPageDragOver = (e) => {
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault()
      setPageDragOver(true)
    }
  }
  const onPageDragLeave = () => setPageDragOver(false)
  const onPageDrop = (e) => {
    e.preventDefault()
    setPageDragOver(false)
    const f = e.dataTransfer?.files?.[0]
    if (f) {
      setPreFile(f)
      setShowUpload(true)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4 animate-pulse">
        <div className="h-12 rounded-2xl bg-slate-200/60" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3,4,5,6].map(i => <div key={i} className="h-44 rounded-2xl bg-slate-200/60" />)}
        </div>
      </div>
    )
  }

  if (error === 'module_off') {
    return (
      <div className="rounded-2xl p-6 text-center" style={{ background: '#FEF3C7', border: '1px solid #FDE68A' }}>
        <span className="material-symbols-outlined text-3xl mb-2 block" style={{ color: '#92400E' }}>lock</span>
        <p className="text-sm font-semibold" style={{ color: '#92400E' }}>Модуль документов не подключён</p>
      </div>
    )
  }
  if (error === 'load_failed') {
    return (
      <div className="rounded-2xl p-6 text-center" style={{ background: '#FEE2E2', border: '1px solid #FECACA' }}>
        <span className="material-symbols-outlined text-3xl mb-2 block" style={{ color: '#991B1B' }}>error</span>
        <p className="text-sm font-semibold" style={{ color: '#991B1B' }}>Не удалось загрузить документы</p>
      </div>
    )
  }

  const uploadUrl = `${API_BASE}/patient/documents/upload?t=${encodeURIComponent(sessionToken || '')}`

  return (
    <div
      className="relative flex flex-col gap-5"
      onDragOver={onPageDragOver}
      onDragLeave={onPageDragLeave}
      onDrop={onPageDrop}
    >
      {/* Drag overlay */}
      {pageDragOver && (
        <div
          className="absolute inset-0 z-50 rounded-3xl flex flex-col items-center justify-center pointer-events-none"
          style={{
            background: 'rgba(99,102,241,.1)',
            border: '3px dashed #6366F1',
            backdropFilter: 'blur(4px)',
          }}
        >
          <span className="material-symbols-outlined text-5xl mb-2" style={{ color: '#4F46E5' }}>cloud_upload</span>
          <p className="text-base font-bold" style={{ color: '#4F46E5' }}>Отпустите файл, чтобы загрузить</p>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-extrabold" style={{ color: '#0F172A' }}>Документы</h2>
          <p className="text-xs mt-0.5" style={{ color: '#64748B' }}>
            {docs.length === 0
              ? 'Загружайте анализы, рецепты, выписки — врач увидит при подготовке к приёму'
              : `${docs.length} ${plural(docs.length, ['документ', 'документа', 'документов'])}`}
          </p>
        </div>
        <button
          onClick={() => { setPreFile(null); setShowUpload(true) }}
          className="px-4 py-2.5 rounded-2xl text-sm font-bold text-white transition-all active:scale-95 flex items-center gap-2"
          style={{
            background: 'linear-gradient(135deg, #6366F1, #A855F7)',
            boxShadow: '0 6px 18px rgba(99,102,241,.3)',
          }}
        >
          <span className="material-symbols-outlined text-base">upload</span>
          Загрузить
        </button>
      </div>

      {/* Tabs */}
      <div className="overflow-x-auto -mx-4 px-4" style={{ scrollbarWidth: 'none' }}>
        <div className="inline-flex gap-1.5 pb-1">
          {CATEGORIES.map(c => {
            const cnt = counts[c.key] || 0
            const active = tab === c.key
            return (
              <button
                key={c.key}
                onClick={() => setTab(c.key)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold transition-all whitespace-nowrap"
                style={{
                  background: active ? '#6366F1' : '#FFFFFF',
                  color: active ? '#FFFFFF' : '#475569',
                  border: active ? '1px solid #6366F1' : '1px solid rgba(0,0,0,.06)',
                  boxShadow: active ? '0 4px 12px rgba(99,102,241,.25)' : 'none',
                }}
              >
                <span
                  className="material-symbols-outlined text-base"
                  style={{ fontVariationSettings: active ? "'FILL' 1" : "'FILL' 0" }}
                >
                  {c.icon}
                </span>
                {c.label}
                {cnt > 0 && (
                  <span
                    className="ml-0.5 px-1.5 rounded-full text-[10px] font-bold"
                    style={{
                      background: active ? 'rgba(255,255,255,.25)' : '#F1F5F9',
                      color: active ? '#FFFFFF' : '#64748B',
                    }}
                  >
                    {cnt}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="rounded-3xl p-10 text-center bg-white" style={{ border: '2px dashed rgba(99,102,241,.2)' }}>
          <div className="flex justify-center mb-4"><EmptyIllustration /></div>
          <p className="text-base font-bold" style={{ color: '#0F172A' }}>
            {tab === 'all' ? 'Документов пока нет' : 'В этой категории пусто'}
          </p>
          <p className="text-sm mt-1.5 max-w-md mx-auto" style={{ color: '#64748B' }}>
            Перетащите файл сюда или нажмите «Загрузить» — анализы, рецепты, направления будут под рукой.
          </p>
          <button
            onClick={() => { setPreFile(null); setShowUpload(true) }}
            className="mt-5 px-4 py-2.5 rounded-2xl text-sm font-bold text-white transition-all active:scale-95"
            style={{
              background: 'linear-gradient(135deg, #6366F1, #A855F7)',
              boxShadow: '0 6px 18px rgba(99,102,241,.3)',
            }}
          >
            Загрузить документ
          </button>
        </div>
      ) : (
        <Suspense fallback={<div className="h-44 rounded-2xl bg-slate-100" />}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(d => (
              <DocumentCard
                key={d.id}
                doc={d}
                onPreview={previewDoc}
                onDownload={downloadDoc}
              />
            ))}
          </div>
        </Suspense>
      )}

      {/* Upload Modal */}
      <Suspense fallback={null}>
        {showUpload && (
          <DocumentUploadModal
            open={showUpload}
            initialFile={preFile}
            uploadUrl={uploadUrl}
            onClose={() => { setShowUpload(false); setPreFile(null) }}
            onUploaded={onUploaded}
          />
        )}
      </Suspense>

      {/* Lightbox */}
      <Suspense fallback={null}>
        {preview && (
          <ImageLightbox
            open={!!preview}
            doc={preview}
            onClose={() => setPreview(null)}
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
