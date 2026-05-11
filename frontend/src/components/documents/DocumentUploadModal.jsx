/**
 * ========================================
 * БЛОК: DocumentUploadModal — загрузка документа (Глава 9)
 * ========================================
 * File picker / drag&drop + поля категории/названия/описания/visibility
 * + progress bar на XMLHttpRequest.
 *
 * Лимит файла: 20 MB
 * Допустимые MIME: pdf, jpeg, png, heic, dicom (по расширению .dcm)
 *
 * Props:
 *   open       — boolean
 *   initialFile — File | null (если кинул через drag&drop в основную страницу)
 *   uploadUrl   — string  (полный URL endpoint, со встроенным ?t=...)
 *   onClose    — () => void
 *   onUploaded — (doc) => void  (вызвать с ответом backend)
 * ========================================
 */
import { useState, useRef, useEffect } from 'react'
import { Modal, Button } from '../../design'

const MAX_SIZE = 20 * 1024 * 1024  // 20 MB
const ALLOWED_EXT = ['pdf', 'jpg', 'jpeg', 'png', 'heic', 'heif', 'dcm', 'dicom']
const ALLOWED_MIME_HINT = 'application/pdf,image/jpeg,image/png,image/heic,image/heif,.dcm,.dicom'

const CATEGORIES = [
  { key: 'analysis',     label: 'Анализы' },
  { key: 'prescription', label: 'Рецепты' },
  { key: 'referral',     label: 'Направления' },
  { key: 'discharge',    label: 'Выписки' },
  { key: 'mri',          label: 'МРТ' },
  { key: 'xray',         label: 'Рентген' },
  { key: 'other',        label: 'Прочее' },
]

const VISIBILITIES = [
  { key: 'private', label: 'Только я',           sub: 'Никто из персонала не видит',   icon: 'lock' },
  { key: 'doctors', label: 'Я и врачи',          sub: 'Врачи увидят при подготовке к приёму', icon: 'medical_services' },
  { key: 'admins',  label: 'Я и админы клиники', sub: 'Регистратура сможет помочь',    icon: 'admin_panel_settings' },
]

function extOf(filename = '') {
  const m = filename.toLowerCase().match(/\.([a-z0-9]+)$/)
  return m ? m[1] : ''
}

export default function DocumentUploadModal({ open, initialFile = null, uploadUrl, onClose, onUploaded }) {
  const [file, setFile]           = useState(null)
  const [category, setCategory]   = useState('analysis')
  const [title, setTitle]         = useState('')
  const [description, setDesc]    = useState('')
  const [visibility, setVis]      = useState('doctors')
  const [progress, setProgress]   = useState(0)
  const [busy, setBusy]           = useState(false)
  const [error, setError]         = useState('')
  const [dragOver, setDragOver]   = useState(false)
  const inputRef = useRef(null)
  const xhrRef = useRef(null)

  // Сброс при открытии
  useEffect(() => {
    if (open) {
      setFile(initialFile || null)
      setProgress(0); setError(''); setBusy(false)
      if (initialFile && !title) {
        // auto-fill title from filename
        const fname = (initialFile.name || '').replace(/\.[^.]+$/, '')
        setTitle(fname.slice(0, 80))
      }
    }
  }, [open, initialFile])  // eslint-disable-line

  const pick = () => inputRef.current?.click()

  const handleFile = (f) => {
    setError('')
    if (!f) { setFile(null); return }
    const ext = extOf(f.name)
    if (!ALLOWED_EXT.includes(ext)) {
      setError(`Тип файла не поддерживается. Разрешены: ${ALLOWED_EXT.join(', ')}`)
      return
    }
    if (f.size > MAX_SIZE) {
      setError(`Файл больше 20 МБ (${(f.size / 1024 / 1024).toFixed(1)} МБ)`)
      return
    }
    setFile(f)
    if (!title) setTitle((f.name || '').replace(/\.[^.]+$/, '').slice(0, 80))
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer?.files?.[0]
    if (f) handleFile(f)
  }

  const cancelUpload = () => {
    xhrRef.current?.abort()
    setBusy(false); setProgress(0)
  }

  const submit = () => {
    if (!file) { setError('Выберите файл'); return }
    if (!title.trim()) { setError('Введите название'); return }

    setBusy(true); setError(''); setProgress(0)

    const fd = new FormData()
    fd.append('file', file)
    fd.append('category', category)
    fd.append('title', title.trim())
    fd.append('description', description.trim())
    fd.append('visibility', visibility)

    const xhr = new XMLHttpRequest()
    xhrRef.current = xhr
    xhr.open('POST', uploadUrl)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      setBusy(false)
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const doc = JSON.parse(xhr.responseText)
          onUploaded?.(doc)
          onClose?.()
        } catch {
          onUploaded?.(null); onClose?.()
        }
      } else {
        let msg = 'Не удалось загрузить файл'
        try {
          const d = JSON.parse(xhr.responseText)
          msg = d?.detail || msg
        } catch {}
        if (xhr.status === 413) msg = 'Файл слишком большой'
        setError(msg)
      }
    }
    xhr.onerror = () => { setBusy(false); setError('Ошибка сети') }
    xhr.onabort = () => { setBusy(false); setProgress(0) }
    xhr.send(fd)
  }

  return (
    <Modal
      open={open}
      onClose={() => { if (busy) cancelUpload(); else onClose?.() }}
      title="Загрузить документ"
      size="md"
      actions={
        <div className="flex gap-2 justify-end w-full">
          {busy ? (
            <Button variant="secondary" onClick={cancelUpload}>Отменить</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={onClose}>Отмена</Button>
              <Button onClick={submit} disabled={!file || !title.trim()}>Загрузить</Button>
            </>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Dropzone */}
        {!file ? (
          <div
            onClick={pick}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className="rounded-2xl p-8 text-center cursor-pointer transition-all"
            style={{
              border: dragOver ? '2px dashed #6366F1' : '2px dashed rgba(0,0,0,.12)',
              background: dragOver ? 'rgba(99,102,241,.06)' : '#F8FAFC',
            }}
          >
            <span
              className="material-symbols-outlined text-4xl mb-2 block"
              style={{ color: dragOver ? '#6366F1' : '#94A3B8' }}
            >
              cloud_upload
            </span>
            <p className="text-sm font-semibold" style={{ color: '#0F172A' }}>
              Перетащите файл или нажмите, чтобы выбрать
            </p>
            <p className="text-xs mt-1" style={{ color: '#64748B' }}>
              PDF, JPG, PNG, HEIC, DICOM · до 20 МБ
            </p>
          </div>
        ) : (
          <div
            className="rounded-2xl p-4 flex items-center gap-3"
            style={{ background: '#F8FAFC', border: '1px solid rgba(0,0,0,.06)' }}
          >
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(99,102,241,.1)' }}
            >
              <span className="material-symbols-outlined" style={{ color: '#4F46E5', fontVariationSettings: "'FILL' 1" }}>draft</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate" style={{ color: '#0F172A' }}>{file.name}</p>
              <p className="text-xs" style={{ color: '#64748B' }}>{(file.size / 1024 / 1024).toFixed(2)} МБ</p>
            </div>
            {!busy && (
              <button
                onClick={() => { setFile(null); setProgress(0) }}
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ color: '#94A3B8' }}
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            )}
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept={ALLOWED_MIME_HINT}
          onChange={e => handleFile(e.target.files?.[0])}
          style={{ display: 'none' }}
        />

        {/* Category */}
        <div>
          <label className="text-sm font-semibold mb-1.5 block" style={{ color: '#0F172A' }}>Категория</label>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map(c => (
              <button
                key={c.key}
                onClick={() => setCategory(c.key)}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
                style={{
                  background: category === c.key ? '#6366F1' : '#F1F5F9',
                  color: category === c.key ? '#FFFFFF' : '#475569',
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Title */}
        <div>
          <label className="text-sm font-semibold mb-1.5 block" style={{ color: '#0F172A' }}>
            Название <span style={{ color: '#DC2626' }}>*</span>
          </label>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Например: Анализ крови 12.05.2026"
            maxLength={120}
            className="w-full rounded-xl px-3 py-2 text-sm"
            style={{ border: '1px solid rgba(0,0,0,.1)', background: '#F8FAFC', outline: 'none' }}
          />
        </div>

        {/* Description */}
        <div>
          <label className="text-sm font-semibold mb-1.5 block" style={{ color: '#0F172A' }}>
            Описание <span style={{ color: '#94A3B8', fontWeight: 400 }}>(необязательно)</span>
          </label>
          <textarea
            value={description}
            onChange={e => setDesc(e.target.value)}
            placeholder="Контекст, врач, клиника"
            rows={2}
            maxLength={500}
            className="w-full rounded-xl px-3 py-2 text-sm resize-none"
            style={{ border: '1px solid rgba(0,0,0,.1)', background: '#F8FAFC', outline: 'none' }}
          />
        </div>

        {/* Visibility */}
        <div>
          <label className="text-sm font-semibold mb-1.5 block" style={{ color: '#0F172A' }}>Кто увидит</label>
          <div className="flex flex-col gap-1.5">
            {VISIBILITIES.map(v => (
              <label
                key={v.key}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all"
                style={{
                  background: visibility === v.key ? 'rgba(99,102,241,.06)' : '#F8FAFC',
                  border: visibility === v.key ? '1px solid rgba(99,102,241,.3)' : '1px solid rgba(0,0,0,.06)',
                }}
              >
                <input
                  type="radio"
                  name="visibility"
                  value={v.key}
                  checked={visibility === v.key}
                  onChange={() => setVis(v.key)}
                  style={{ accentColor: '#6366F1' }}
                />
                <span
                  className="material-symbols-outlined text-base flex-shrink-0"
                  style={{ color: '#6366F1', fontVariationSettings: "'FILL' 1" }}
                >
                  {v.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold" style={{ color: '#0F172A' }}>{v.label}</p>
                  <p className="text-xs" style={{ color: '#64748B' }}>{v.sub}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Progress */}
        {busy && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold" style={{ color: '#475569' }}>Загрузка…</span>
              <span className="text-xs font-bold" style={{ color: '#4F46E5' }}>{progress}%</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: '#E2E8F0' }}>
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${progress}%`, background: 'linear-gradient(90deg, #6366F1, #A855F7)' }}
              />
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-xl px-3 py-2 text-xs" style={{ background: '#FEE2E2', color: '#991B1B' }}>
            {error}
          </div>
        )}
      </div>
    </Modal>
  )
}
