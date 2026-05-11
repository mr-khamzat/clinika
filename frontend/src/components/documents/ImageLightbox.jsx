/**
 * ========================================
 * БЛОК: ImageLightbox — fullscreen-просмотр документа (Глава 9)
 * ========================================
 * Простой оверлей для preview изображений и PDF.
 * Клик по фону / Esc / кнопка [×] — закрытие.
 *
 * Props:
 *   open   — boolean
 *   doc    — {id, title, mime_type, file_url?, ...}
 *   onClose — () => void
 *   onDownload — (doc) => void   (опционально, кнопка «Скачать» в шапке)
 * ========================================
 */
import { useEffect } from 'react'

export default function ImageLightbox({ open, doc, onClose, onDownload }) {
  useEffect(() => {
    if (!open) return
    const onKey = e => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    // body scroll lock
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  if (!open || !doc) return null

  const isImage = (doc.mime_type || '').startsWith('image/')
  const isPdf = (doc.mime_type || '').toLowerCase().includes('pdf')
  const url = doc.file_url || doc.url || ''

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,.92)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      {/* Top bar */}
      <div
        className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3"
        style={{ background: 'linear-gradient(180deg, rgba(0,0,0,.6), transparent)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="text-white">
          <p className="text-sm font-bold truncate max-w-[60vw]">{doc.title || 'Документ'}</p>
          <p className="text-xs opacity-70">{doc.mime_type}</p>
        </div>
        <div className="flex items-center gap-2">
          {onDownload && (
            <button
              onClick={() => onDownload(doc)}
              className="w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-90"
              style={{ background: 'rgba(255,255,255,.15)' }}
              title="Скачать"
            >
              <span className="material-symbols-outlined text-white text-xl">download</span>
            </button>
          )}
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-90"
            style={{ background: 'rgba(255,255,255,.15)' }}
            title="Закрыть"
          >
            <span className="material-symbols-outlined text-white text-xl">close</span>
          </button>
        </div>
      </div>

      {/* Content */}
      <div
        className="w-full h-full flex items-center justify-center p-4 pt-16 pb-8"
        onClick={e => e.stopPropagation()}
      >
        {isImage && url && (
          <img
            src={url}
            alt={doc.title || 'preview'}
            className="max-w-full max-h-full object-contain rounded-xl"
            style={{ boxShadow: '0 12px 40px rgba(0,0,0,.5)' }}
          />
        )}
        {isPdf && url && (
          <iframe
            src={url}
            title={doc.title || 'PDF'}
            className="w-full h-full rounded-xl bg-white"
            style={{ maxWidth: 1200 }}
          />
        )}
        {!isImage && !isPdf && (
          <div className="rounded-2xl bg-white p-8 text-center max-w-md">
            <span className="material-symbols-outlined text-5xl mb-3 block" style={{ color: '#94A3B8' }}>draft</span>
            <p className="text-sm font-semibold" style={{ color: '#0F172A' }}>
              Предпросмотр недоступен
            </p>
            <p className="text-xs mt-1" style={{ color: '#64748B' }}>
              Скачайте файл, чтобы открыть его в подходящем приложении
            </p>
            {onDownload && (
              <button
                onClick={() => onDownload(doc)}
                className="mt-4 px-4 py-2 rounded-xl text-sm font-bold text-white"
                style={{ background: '#6366F1' }}
              >
                Скачать
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
