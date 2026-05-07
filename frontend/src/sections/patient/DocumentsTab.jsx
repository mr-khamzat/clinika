// Вкладка "Документы" в кабинете пациента: справки, выписки, больничные.
// Список с иконками по типу и кнопкой "Скачать" (стримит файл, проверяя ownership).
//
// Props: { sessionToken, apiBase }
//
// Эндпоинты:
//   GET /patient/documents
//   GET /patient/documents/{id}/download
import { useEffect, useState, useCallback } from 'react'
import axios from 'axios'
import { useToast } from '../../design'

const DOC_TYPE = {
  reference:  { label: 'Справка',     icon: 'description', color: '#0EA5E9', bg: '#E0F2FE' },
  extract:    { label: 'Выписка',     icon: 'article',     color: '#8B5CF6', bg: '#F3E8FF' },
  sick_leave: { label: 'Больничный',  icon: 'sick',        color: '#F59E0B', bg: '#FEF3C7' },
  other:      { label: 'Документ',    icon: 'folder',      color: '#64748B', bg: '#F1F5F9' },
}

function formatDate(iso) {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })
  } catch { return iso }
}

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}

function DocCard({ doc, onDownload, downloading }) {
  const meta = DOC_TYPE[doc.doc_type] || DOC_TYPE.other
  return (
    <div className="bg-white rounded-3xl p-4"
         style={{ border: '1px solid rgba(0,0,0,.06)', boxShadow: '0 2px 12px rgba(0,0,0,.04)' }}>
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
             style={{ background: meta.bg }}>
          <span className="material-symbols-outlined text-xl" style={{ color: meta.color }}>{meta.icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md"
                  style={{ background: meta.bg, color: meta.color }}>{meta.label}</span>
          </div>
          <p className="font-semibold text-gray-800 text-sm mt-1 break-words">{doc.filename}</p>
          {doc.description && (
            <p className="text-xs text-gray-600 mt-1 break-words">{doc.description}</p>
          )}
          <div className="flex items-center gap-2 mt-2 text-[11px] text-gray-500 flex-wrap">
            {doc.issued_at && <span>{formatDate(doc.issued_at)}</span>}
            {doc.size_bytes ? <span>· {formatSize(doc.size_bytes)}</span> : null}
          </div>
        </div>
      </div>
      <button
        onClick={() => onDownload(doc)}
        disabled={downloading === doc.id}
        className="mt-3 w-full py-3 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 active:opacity-80 disabled:opacity-50"
        style={{ background: '#0EA5E9', color: '#fff' }}
        type="button"
      >
        {downloading === doc.id ? (
          <>
            <span className="material-symbols-outlined text-base animate-spin">progress_activity</span>
            Скачивается...
          </>
        ) : (
          <>
            <span className="material-symbols-outlined text-base">download</span>
            Скачать
          </>
        )}
      </button>
    </div>
  )
}

export default function DocumentsTab({ sessionToken, apiBase = '/api' }) {
  // Замена alert на Toast
  const { toast } = useToast()
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [downloading, setDownloading] = useState(null)

  const load = useCallback(async () => {
    if (!sessionToken) { setLoading(false); return }
    setLoading(true); setError(null)
    try {
      const r = await axios.get(`${apiBase}/patient/documents`, {
        params: { session_token: sessionToken, t: sessionToken },
      })
      setDocs(Array.isArray(r.data) ? r.data : [])
    } catch {
      setError('Не удалось загрузить документы')
    } finally {
      setLoading(false)
    }
  }, [sessionToken, apiBase])

  useEffect(() => { load() }, [load])

  const handleDownload = async (doc) => {
    setDownloading(doc.id)
    try {
      const r = await axios.get(`${apiBase}/patient/documents/${doc.id}/download`, {
        params: { session_token: sessionToken, t: sessionToken },
        responseType: 'blob',
      })
      // Создаём временную ссылку и кликаем по ней
      const url = URL.createObjectURL(new Blob([r.data], { type: doc.mime || 'application/octet-stream' }))
      const a = document.createElement('a')
      a.href = url
      a.download = doc.filename || 'document'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {
      toast('Не удалось скачать файл', 'error')
    } finally {
      setDownloading(null)
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[0,1].map(i => (
          <div key={i} className="bg-white rounded-3xl p-5 animate-pulse"
               style={{ border: '1px solid rgba(0,0,0,.06)' }}>
            <div className="h-5 bg-gray-100 rounded w-3/4 mb-2" />
            <div className="h-3 bg-gray-100 rounded w-1/2" />
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white rounded-3xl p-5 text-center"
           style={{ border: '1px solid rgba(0,0,0,.06)' }}>
        <p className="text-sm text-red-500">{error}</p>
        <button onClick={load} className="text-xs text-blue-500 mt-2">Повторить</button>
      </div>
    )
  }

  if (docs.length === 0) {
    return (
      <div className="bg-white rounded-3xl p-8 text-center"
           style={{ border: '1px solid rgba(0,0,0,.06)', boxShadow: '0 2px 12px rgba(0,0,0,.04)' }}>
        <div className="w-16 h-16 rounded-3xl flex items-center justify-center mx-auto mb-4"
             style={{ background: 'linear-gradient(135deg,#FEF3C7,#FDE68A)' }}>
          <span className="material-symbols-outlined text-amber-500 text-3xl">folder_open</span>
        </div>
        <p className="text-gray-700 font-bold">Документов пока нет</p>
        <p className="text-gray-400 text-sm mt-1">Когда клиника выпишет вам справку или выписку — она появится здесь</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {docs.map(d => (
        <DocCard key={d.id} doc={d} onDownload={handleDownload} downloading={downloading} />
      ))}
    </div>
  )
}
