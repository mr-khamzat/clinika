// ═════ БЛОК: DocumentsTab — премиум preview-grid документов ═════
// Вкладка "Документы" в кабинете пациента: справки, выписки, больничные.
// Grid 2-cols с thumbnail-карточками, фильтры-чипы, "Скачать всё".
//
// Props: { sessionToken, apiBase }
//
// Эндпоинты:
//   GET /patient/documents
//   GET /patient/documents/{id}/download
import { useEffect, useState, useCallback, useMemo } from 'react'
import axios from 'axios'
import { useToast } from '../../design'

// ═════ БЛОК: DocumentsTab — мета типов документов ═════
const DOC_TYPE = {
  reference:  { label: 'Справка',     icon: 'description', tint: '#0EA5E9', gradient: 'linear-gradient(135deg,#7DD3FC,#0284C7)', bg: 'linear-gradient(135deg,#F0F9FF,#E0F2FE)', group: 'reports' },
  extract:    { label: 'Выписка',     icon: 'article',     tint: '#8B5CF6', gradient: 'linear-gradient(135deg,#C4B5FD,#7C3AED)', bg: 'linear-gradient(135deg,#FAF5FF,#F3E8FF)', group: 'reports' },
  sick_leave: { label: 'Больничный',  icon: 'sick',        tint: '#F59E0B', gradient: 'linear-gradient(135deg,#FCD34D,#D97706)', bg: 'linear-gradient(135deg,#FFFBEB,#FEF3C7)', group: 'reports' },
  lab:        { label: 'Анализ',      icon: 'science',     tint: '#10B981', gradient: 'linear-gradient(135deg,#6EE7B7,#059669)', bg: 'linear-gradient(135deg,#ECFDF5,#D1FAE5)', group: 'lab' },
  scan:       { label: 'Снимок',      icon: 'image',       tint: '#EC4899', gradient: 'linear-gradient(135deg,#F9A8D4,#DB2777)', bg: 'linear-gradient(135deg,#FDF2F8,#FCE7F3)', group: 'scan' },
  other:      { label: 'Документ',    icon: 'folder',      tint: '#64748B', gradient: 'linear-gradient(135deg,#CBD5E1,#475569)', bg: 'linear-gradient(135deg,#F8FAFC,#F1F5F9)', group: 'other' },
}

// ═════ БЛОК: DocumentsTab — детектор группы из filename/mime ═════
function detectGroup(doc) {
  const explicit = DOC_TYPE[doc.doc_type]
  if (explicit) return explicit.group
  const name = (doc.filename || '').toLowerCase()
  const mime = (doc.mime || '').toLowerCase()
  if (/(jpg|jpeg|png|webp|heic|gif|bmp|tiff)/.test(name) || mime.startsWith('image/')) return 'scan'
  if (/(анализ|lab|кровь|моч|results)/.test(name)) return 'lab'
  if (/(заключ|выписк|справк|епикриз|extract|reference|conclusion)/.test(name)) return 'reports'
  return 'other'
}

// ═════ БЛОК: DocumentsTab — мета по расширению файла (для thumbnail) ═════
function detectFileMeta(doc) {
  const t = DOC_TYPE[doc.doc_type]
  if (t) return t
  const name = (doc.filename || '').toLowerCase()
  const mime = (doc.mime || '').toLowerCase()
  if (/(jpg|jpeg|png|webp|heic|gif|bmp|tiff)$/.test(name) || mime.startsWith('image/')) return DOC_TYPE.scan
  if (/\.pdf$/.test(name) || mime === 'application/pdf') return DOC_TYPE.reference
  if (/(анализ|lab)/.test(name)) return DOC_TYPE.lab
  return DOC_TYPE.other
}

function formatDate(iso) {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: '2-digit' })
  } catch { return iso }
}

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}

function fileExt(name = '') {
  const m = String(name).match(/\.([a-z0-9]+)$/i)
  return m ? m[1].toUpperCase() : ''
}

// ═════ БЛОК: DocumentsTab — DocCard (preview-thumbnail) ═════
function DocCard({ doc, onDownload, downloading, index }) {
  const meta = detectFileMeta(doc)
  const ext = fileExt(doc.filename)
  const isDownloading = downloading === doc.id

  return (
    <button
      type="button"
      onClick={() => onDownload(doc)}
      disabled={isDownloading}
      className="text-left bg-white dark:bg-gray-800 rounded-2xl overflow-hidden transition-all active:scale-[.97] disabled:opacity-60"
      style={{
        border: '1px solid rgba(0,0,0,.05)',
        boxShadow: '0 4px 16px rgba(0,0,0,.06), inset 0 1px 0 rgba(255,255,255,.5)',
        animation: `docPop 360ms cubic-bezier(.4,0,.2,1) ${index * 50}ms both`,
      }}
    >
      {/* ═════ БЛОК: DocCard — thumbnail с gradient ═════ */}
      <div
        className="relative w-full flex items-center justify-center overflow-hidden"
        style={{
          height: 112,
          background: meta.bg,
        }}
      >
        {/* Декоративный blob в углу */}
        <div
          className="absolute pointer-events-none"
          style={{
            top: -20,
            right: -20,
            width: 80,
            height: 80,
            background: meta.gradient,
            opacity: 0.15,
            borderRadius: '50%',
            filter: 'blur(12px)',
          }}
        />
        <div
          className="relative w-14 h-14 rounded-2xl flex items-center justify-center"
          style={{
            background: 'rgba(255,255,255,.7)',
            boxShadow: '0 6px 16px rgba(0,0,0,.08), inset 0 1px 0 rgba(255,255,255,.7)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: 28,
              background: meta.gradient,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              fontVariationSettings: "'FILL' 1",
            }}
          >
            {meta.icon}
          </span>
        </div>
        {/* Метка типа */}
        <span
          className="absolute top-2 left-2 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md"
          style={{
            background: 'rgba(255,255,255,.85)',
            color: meta.tint,
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            letterSpacing: '.6px',
          }}
        >
          {meta.label}
        </span>
        {/* Расширение */}
        {ext && (
          <span
            className="absolute bottom-2 right-2 text-[9px] font-bold px-1.5 py-0.5 rounded"
            style={{
              background: 'rgba(15,23,42,.78)',
              color: '#fff',
              letterSpacing: '.4px',
            }}
          >
            {ext}
          </span>
        )}
        {/* Состояние загрузки overlay */}
        {isDownloading && (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,.7)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
          >
            <span
              className="material-symbols-outlined animate-spin"
              style={{ fontSize: 28, color: meta.tint }}
            >
              progress_activity
            </span>
          </div>
        )}
      </div>

      {/* ═════ БЛОК: DocCard — название и метаданные ═════ */}
      <div className="p-3">
        <p
          className="font-semibold text-gray-900 dark:text-gray-50 text-sm leading-tight"
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            minHeight: 32,
          }}
        >
          {doc.filename || '—'}
        </p>
        <div className="flex items-center justify-between gap-1 mt-1.5">
          {doc.issued_at && (
            <span className="text-[10px] text-gray-500 dark:text-gray-400 inline-flex items-center gap-0.5">
              <span className="material-symbols-outlined" style={{ fontSize: 11 }}>event</span>
              {formatDate(doc.issued_at)}
            </span>
          )}
          {doc.size_bytes ? (
            <span className="text-[10px] text-gray-500 dark:text-gray-400">{formatSize(doc.size_bytes)}</span>
          ) : null}
        </div>
      </div>
    </button>
  )
}

// ═════ БЛОК: DocumentsTab — фильтр-чипы ═════
const FILTERS = [
  { key: 'all',     label: 'Все',         icon: 'apps' },
  { key: 'lab',     label: 'Анализы',     icon: 'science' },
  { key: 'scan',    label: 'Снимки',      icon: 'image' },
  { key: 'reports', label: 'Заключения',  icon: 'description' },
]

function FilterChip({ chip, active, count, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 inline-flex items-center gap-1.5 px-3 h-9 rounded-full text-xs font-bold transition-all active:scale-95"
      style={{
        background: active ? 'linear-gradient(135deg,#0097A7 0%,#1565C0 100%)' : 'rgba(255,255,255,.8)',
        color: active ? '#fff' : '#475569',
        border: active ? '1px solid transparent' : '1px solid rgba(0,0,0,.06)',
        boxShadow: active
          ? '0 6px 14px rgba(21,101,192,.28), inset 0 1px 0 rgba(255,255,255,.3)'
          : '0 2px 6px rgba(0,0,0,.04), inset 0 1px 0 rgba(255,255,255,.5)',
      }}
    >
      <span
        className="material-symbols-outlined"
        style={{
          fontSize: 16,
          fontVariationSettings: active ? "'FILL' 1" : "'FILL' 0",
        }}
      >
        {chip.icon}
      </span>
      {chip.label}
      {typeof count === 'number' && (
        <span
          className="ml-0.5 px-1.5 rounded-full text-[10px] font-bold"
          style={{
            background: active ? 'rgba(255,255,255,.25)' : 'rgba(0,151,167,.12)',
            color: active ? '#fff' : '#0097A7',
            minWidth: 18,
            textAlign: 'center',
          }}
        >
          {count}
        </span>
      )}
    </button>
  )
}

export default function DocumentsTab({ sessionToken, apiBase = '/api' }) {
  // Замена alert на Toast
  const { toast } = useToast()
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [downloading, setDownloading] = useState(null)
  const [filter, setFilter] = useState('all')
  const [downloadingAll, setDownloadingAll] = useState(false)

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

  // Скачать все документы (по одному, через тот же endpoint)
  const handleDownloadAll = async () => {
    if (downloadingAll || docs.length === 0) return
    setDownloadingAll(true)
    try {
      for (const d of docs) {
        await handleDownload(d)
        await new Promise((r) => setTimeout(r, 250))
      }
      toast(`Скачано ${docs.length} файл(ов)`, 'success')
    } catch {
      // noop — индивидуальные ошибки уже показываются toast'ом
    } finally {
      setDownloadingAll(false)
    }
  }

  // ═════ БЛОК: DocumentsTab — счётчики по фильтрам ═════
  const counts = useMemo(() => {
    const c = { all: docs.length, lab: 0, scan: 0, reports: 0, other: 0 }
    for (const d of docs) {
      const g = detectGroup(d)
      c[g] = (c[g] || 0) + 1
    }
    return c
  }, [docs])

  const filtered = useMemo(() => {
    if (filter === 'all') return docs
    return docs.filter((d) => detectGroup(d) === filter)
  }, [docs, filter])

  if (loading) {
    return (
      <div>
        <style>{`@keyframes docPop{from{opacity:0;transform:translateY(8px) scale(.96)}to{opacity:1;transform:none}}`}</style>
        <div className="grid grid-cols-2 gap-3">
          {[0,1,2,3].map(i => (
            <div key={i} className="bg-white dark:bg-gray-800 rounded-2xl overflow-hidden animate-pulse"
                 style={{ border: '1px solid rgba(0,0,0,.05)', boxShadow: '0 4px 16px rgba(0,0,0,.05)' }}>
              <div className="h-28 bg-gray-100 dark:bg-gray-700" />
              <div className="p-3">
                <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded w-3/4 mb-1.5" />
                <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 text-center"
           style={{ border: '1px solid rgba(0,0,0,.05)', boxShadow: '0 4px 16px rgba(0,0,0,.06)' }}>
        <p className="text-sm text-red-500">{error}</p>
        <button onClick={load} className="text-xs text-blue-500 mt-2 font-semibold">Повторить</button>
      </div>
    )
  }

  if (docs.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-8 text-center"
           style={{ border: '1px solid rgba(0,0,0,.05)', boxShadow: '0 4px 16px rgba(0,0,0,.06), inset 0 1px 0 rgba(255,255,255,.5)' }}>
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
             style={{
               background: 'linear-gradient(135deg,#FFFBEB,#FEF3C7)',
               boxShadow: '0 6px 16px rgba(245,158,11,.15), inset 0 1px 0 rgba(255,255,255,.6)',
             }}>
          <span
            className="material-symbols-outlined text-3xl"
            style={{
              background: 'linear-gradient(135deg,#FCD34D,#D97706)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              fontVariationSettings: "'FILL' 1",
            }}
          >
            folder_open
          </span>
        </div>
        <p className="text-gray-800 dark:text-gray-100 font-bold">Документов пока нет</p>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">Когда клиника выпишет вам справку или выписку — она появится здесь</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <style>{`@keyframes docPop{from{opacity:0;transform:translateY(8px) scale(.96)}to{opacity:1;transform:none}}`}</style>

      {/* ═════ БЛОК: DocumentsTab — шапка с "Скачать всё" ═════ */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            Всего файлов
          </p>
          <p className="text-lg font-bold text-gray-900 dark:text-gray-50 leading-tight">
            {docs.length}
            <span className="text-xs font-medium text-gray-400 dark:text-gray-500 ml-1.5">
              {filter !== 'all' && `· отфильтровано ${filtered.length}`}
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={handleDownloadAll}
          disabled={downloadingAll || docs.length === 0}
          className="shrink-0 inline-flex items-center gap-1.5 px-3.5 h-10 rounded-2xl font-bold text-xs transition-all active:scale-95 disabled:opacity-60"
          style={{
            background: 'linear-gradient(135deg,#0097A7 0%,#1565C0 100%)',
            color: '#fff',
            boxShadow: '0 6px 16px rgba(21,101,192,.28), inset 0 1px 0 rgba(255,255,255,.3)',
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: 16,
              fontVariationSettings: "'FILL' 1",
              animation: downloadingAll ? 'spin 1s linear infinite' : 'none',
            }}
          >
            {downloadingAll ? 'progress_activity' : 'download_for_offline'}
          </span>
          {downloadingAll ? 'Скачивается...' : 'Скачать всё'}
        </button>
      </div>

      {/* ═════ БЛОК: DocumentsTab — фильтр-чипы (horizontal scroll) ═════ */}
      <div
        className="-mx-1 px-1 overflow-x-auto"
        style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
      >
        <div className="flex items-center gap-2 pb-1" style={{ minWidth: 'min-content' }}>
          {FILTERS.map((f) => (
            <FilterChip
              key={f.key}
              chip={f}
              active={filter === f.key}
              count={counts[f.key]}
              onClick={() => setFilter(f.key)}
            />
          ))}
        </div>
        <style>{`.overflow-x-auto::-webkit-scrollbar{display:none}`}</style>
      </div>

      {/* ═════ БЛОК: DocumentsTab — grid 2-cols ═════ */}
      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 text-center"
             style={{ border: '1px solid rgba(0,0,0,.05)', boxShadow: '0 4px 16px rgba(0,0,0,.06)' }}>
          <span className="material-symbols-outlined text-gray-300 dark:text-gray-600" style={{ fontSize: 32 }}>filter_alt_off</span>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">В этой категории документов нет</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {filtered.map((d, i) => (
            <DocCard key={d.id} doc={d} onDownload={handleDownload} downloading={downloading} index={i} />
          ))}
        </div>
      )}

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
