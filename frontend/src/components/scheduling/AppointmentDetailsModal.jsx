/**
 * AppointmentDetailsModal — модалка «Карточка приёма».
 *
 * Открывается из расписания (WeekScheduleSection) при клике на занятый слот.
 * Содержит четыре вкладки:
 *   1. «Заключение»  — заключение врача + рекомендации (POST/GET /appointments/{id}/outcome)
 *   2. «Файлы»       — drag-and-drop загрузка / список / удаление вложений
 *   3. «Направления» — внутриклинические направления (к врачу/КТ/МРТ/анализы/процедура)
 *   4. «История»     — последние приёмы того же пациента (по телефону)
 *
 * Стиль: дизайн-система (Modal, Card, Button, Tabs, Avatar, Chip).
 * Mobile-friendly: одна колонка на узком экране, тач-цели ≥44px.
 */
import { useEffect, useMemo, useState, useRef } from 'react'
import api from '../../api'
import { Modal, Button, Tabs, Chip, Avatar } from '../../design'

// ── Метаданные target_type для направлений ─────────────────────────────────
const TARGET_TYPES = [
  { id: 'doctor',    label: 'К врачу',     icon: 'stethoscope' },
  { id: 'ct',        label: 'КТ',          icon: 'monitor_heart' },
  { id: 'mri',       label: 'МРТ',         icon: 'monitor_heart' },
  { id: 'xray',      label: 'Рентген',     icon: 'radiology' },
  { id: 'lab',       label: 'Анализы',     icon: 'science' },
  { id: 'procedure', label: 'Процедура',   icon: 'medical_services' },
]

const STATUS_CHIP = {
  pending:   { label: 'Ожидает',     variant: 'warn' },
  confirmed: { label: 'Подтверждён', variant: 'accent' },
  completed: { label: 'Выполнено',   variant: 'good' },
  cancelled: { label: 'Отменён',     variant: 'bad' },
  no_show:   { label: 'Не пришёл',   variant: 'default' },
}

const REF_STATUS_CHIP = {
  pending:   { label: 'Ожидает',   variant: 'warn' },
  scheduled: { label: 'Записан',   variant: 'accent' },
  done:      { label: 'Выполнено', variant: 'good' },
  cancelled: { label: 'Отменено',  variant: 'bad' },
}

function formatDate(d) {
  if (!d) return ''
  try {
    return new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  } catch { return d }
}

function formatBytes(n) {
  if (!n) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`
  return `${(n / 1024 / 1024).toFixed(2)} МБ`
}

const STATUSES = [
  { id: 'pending',   label: 'Ожидает',     bg: '#fef3c7', fg: '#92400e' },
  { id: 'confirmed', label: 'Подтверждён', bg: '#dbeafe', fg: '#075985' },
  { id: 'completed', label: 'Выполнено',   bg: '#dcfce7', fg: '#14532d' },
  { id: 'cancelled', label: 'Отменён',     bg: '#fee2e2', fg: '#9f1239' },
  { id: 'no_show',   label: 'Не пришёл',   bg: '#f3e8ff', fg: '#581c87' },
]
const PRIORITIES = [
  { id: 'normal',  label: 'Обычный',         icon: '',  bg: 'var(--bg-2)',                                  fg: 'var(--fg-2)' },
  { id: 'high',    label: 'Приоритетный',    icon: '⭐', bg: 'rgba(250,204,21,0.30)',                        fg: '#854d0e' },
  { id: 'urgent',  label: 'Срочный',         icon: '⚡', bg: 'rgba(239,68,68,0.28)',                         fg: '#9f1239' },
]

export default function AppointmentDetailsModal({ ctx, onClose, onChanged }) {
  // ctx = { appointment, date, start_time }
  const appt = ctx?.appointment || {}
  const apptId = appt.id
  const [tab, setTab] = useState('outcome')
  const [localStatus, setLocalStatus] = useState(appt.status || 'pending')
  const [localPriority, setLocalPriority] = useState(appt.priority || 'normal')
  const [busy, setBusy] = useState(null)

  if (!apptId) return null

  async function changeStatus(s) {
    if (busy || s === localStatus) return
    setBusy('status')
    try {
      await api.patch("/appointments/" + apptId + "/status", { status: s })
      setLocalStatus(s)
      if (onChanged) onChanged()
    } catch (e) { window.alert('Ошибка: ' + (e?.response?.data?.detail || e.message)) }
    finally { setBusy(null) }
  }

  async function changePriority(p) {
    if (busy || p === localPriority) return
    setBusy('priority')
    try {
      await api.patch("/appointments/" + apptId, { priority: p })
      setLocalPriority(p)
      if (onChanged) onChanged()
    } catch (e) { window.alert('Ошибка: ' + (e?.response?.data?.detail || e.message)) }
    finally { setBusy(null) }
  }

  // Шапка
  const statusInfo = STATUS_CHIP[localStatus] || STATUS_CHIP.pending

  return (
    <Modal
      open
      onClose={onClose}
      title={(
        <div className="flex items-center gap-3">
          <Avatar name={appt.patient_name || appt.patient_phone || 'П'} size={40} />
          <div>
            <div className="text-base font-bold" style={{ color: 'var(--fg)' }}>
              {appt.patient_name || 'Без имени'}
            </div>
            <div className="text-xs" style={{ color: 'var(--fg-3)' }}>
              {appt.patient_phone} · {formatDate(ctx.date)} {ctx.start_time}
            </div>
          </div>
          <div className="ml-auto"><Chip variant={statusInfo.variant}>{statusInfo.label}</Chip></div>
        </div>
      )}
      size="lg"
    >
      <div className="mb-3">
        <Tabs
          items={[
            { id: 'outcome',     label: 'Заключение' },
            { id: 'attachments', label: 'Файлы' },
            { id: 'referrals',   label: 'Направления' },
            { id: 'history',     label: 'История' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>

      {/* Toggle статуса и приоритета — всегда виден на всех вкладках */}
      <div className="mb-3 flex flex-col gap-2" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 12, padding: 10 }}>
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[11px] uppercase font-bold tracking-wide" style={{ color: 'var(--fg-3)', minWidth: 70 }}>Статус</span>
          {STATUSES.map(s => (
            <button key={s.id} onClick={() => changeStatus(s.id)} disabled={busy==='status'}
              className="px-3 py-1.5 rounded-lg text-[12px] font-semibold transition"
              style={localStatus === s.id
                ? { background: s.bg, color: s.fg, border: "1px solid " + s.fg + "55" }
                : { background: 'var(--surface)', color: 'var(--fg-2)', border: '1px solid var(--border)', opacity: busy ? 0.5 : 1 }}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[11px] uppercase font-bold tracking-wide" style={{ color: 'var(--fg-3)', minWidth: 70 }}>Приоритет</span>
          {PRIORITIES.map(p => (
            <button key={p.id} onClick={() => changePriority(p.id)} disabled={busy==='priority'}
              className="px-3 py-1.5 rounded-lg text-[12px] font-semibold transition flex items-center gap-1"
              style={localPriority === p.id
                ? { background: p.bg, color: p.fg, border: '1px solid currentColor' }
                : { background: 'var(--surface)', color: 'var(--fg-2)', border: '1px solid var(--border)', opacity: busy ? 0.5 : 1 }}>
              {p.icon && <span>{p.icon}</span>}{p.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'outcome'     && <OutcomeTab     apptId={apptId} onChanged={onChanged} />}
      {tab === 'attachments' && <AttachmentsTab apptId={apptId} onChanged={onChanged} />}
      {tab === 'referrals'   && <ReferralsTab   apptId={apptId} appt={appt} onChanged={onChanged} />}
      {tab === 'history'     && <HistoryTab     phone={appt.patient_phone} />}
    </Modal>
  )
}


// ─────────────────────────────────────────────────────────────────────────
// БЛОК: Вкладка «Заключение»
// ─────────────────────────────────────────────────────────────────────────

function OutcomeTab({ apptId, onChanged }) {
  const [conclusion, setConclusion] = useState('')
  const [recommendations, setRecommendations] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    api.get(`/appointments/${apptId}/outcome`)
      .then(r => {
        if (!alive) return
        if (r.data) {
          setConclusion(r.data.conclusion || '')
          setRecommendations(r.data.recommendations || '')
          setSavedAt(r.data.updated_at || r.data.created_at)
        }
      })
      .catch(e => alive && setErr(e?.response?.data?.detail || 'Ошибка загрузки'))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [apptId])

  const save = async () => {
    if (!conclusion.trim()) { setErr('Заключение не может быть пустым'); return }
    setErr('')
    setSaving(true)
    try {
      const r = await api.post(`/appointments/${apptId}/outcome`, {
        conclusion, recommendations: recommendations || null,
      })
      setSavedAt(r.data.updated_at || r.data.created_at)
      onChanged && onChanged()
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="py-8 text-center" style={{ color: 'var(--fg-3)' }}>Загрузка…</div>

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--fg-2)' }}>
          Заключение врача *
        </label>
        <textarea
          rows={6}
          value={conclusion}
          onChange={e => setConclusion(e.target.value)}
          placeholder="Диагноз, описание состояния, выводы…"
          className="w-full text-sm"
          style={{
            padding: '10px 12px',
            borderRadius: '10px',
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'var(--fg)',
            resize: 'vertical',
            minHeight: 120,
          }}
        />
      </div>
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--fg-2)' }}>
          Рекомендации
        </label>
        <textarea
          rows={4}
          value={recommendations}
          onChange={e => setRecommendations(e.target.value)}
          placeholder="Препараты, режим, повторный визит…"
          className="w-full text-sm"
          style={{
            padding: '10px 12px',
            borderRadius: '10px',
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'var(--fg)',
            resize: 'vertical',
            minHeight: 80,
          }}
        />
      </div>
      {err && <div className="text-xs" style={{ color: 'var(--bad, #f43f5e)' }}>{err}</div>}
      <div className="flex items-center gap-3 mt-1">
        <Button variant="primary" onClick={save} disabled={saving}>
          {saving ? 'Сохраняю…' : 'Сохранить заключение'}
        </Button>
        {savedAt && <span className="text-xs" style={{ color: 'var(--fg-3)' }}>
          Обновлено: {new Date(savedAt).toLocaleString('ru-RU')}
        </span>}
      </div>
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────
// БЛОК: Вкладка «Файлы»
// ─────────────────────────────────────────────────────────────────────────

function AttachmentsTab({ apptId, onChanged }) {
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')
  const [drag, setDrag] = useState(false)
  const inputRef = useRef(null)

  const reload = async () => {
    setLoading(true); setErr('')
    try {
      const r = await api.get(`/appointments/${apptId}/attachments`)
      setList(r.data || [])
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Ошибка загрузки')
    } finally { setLoading(false) }
  }
  useEffect(() => { reload() }, [apptId])

  const upload = async (files) => {
    if (!files || !files.length) return
    setErr(''); setUploading(true)
    try {
      for (const file of files) {
        const fd = new FormData()
        fd.append('file', file)
        await api.post(`/appointments/${apptId}/attachments`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
      }
      await reload()
      onChanged && onChanged()
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Не удалось загрузить файл')
    } finally { setUploading(false) }
  }

  const onDrop = (e) => {
    e.preventDefault(); setDrag(false)
    upload(e.dataTransfer.files)
  }

  const remove = async (id) => {
    if (!window.confirm('Удалить файл?')) return
    try {
      await api.delete(`/appointments/${apptId}/attachments/${id}`)
      await reload()
      onChanged && onChanged()
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Не удалось удалить')
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Drop-zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className="text-center cursor-pointer transition-colors"
        style={{
          border: `2px dashed ${drag ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: 12,
          padding: '24px 16px',
          background: drag ? 'rgba(0,151,167,0.08)' : 'var(--surface)',
          color: 'var(--fg-2)',
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 36, color: 'var(--accent)' }}>upload_file</span>
        <div className="text-sm mt-2" style={{ color: 'var(--fg)' }}>
          {uploading ? 'Загружаю…' : 'Перетащите файлы или нажмите для выбора'}
        </div>
        <div className="text-xs mt-1" style={{ color: 'var(--fg-3)' }}>
          PDF / JPG / PNG / WEBP, до 25 МБ
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
          style={{ display: 'none' }}
          onChange={(e) => { upload(e.target.files); e.target.value = '' }}
        />
      </div>

      {err && <div className="text-xs" style={{ color: '#f43f5e' }}>{err}</div>}

      {/* Список файлов */}
      {loading ? (
        <div className="py-8 text-center" style={{ color: 'var(--fg-3)' }}>Загрузка…</div>
      ) : list.length === 0 ? (
        <div className="py-6 text-center text-sm" style={{ color: 'var(--fg-3)' }}>Файлов пока нет</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map(att => (
            <li key={att.id}
              className="flex items-center gap-3"
              style={{
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
              }}
            >
              <FilePreview att={att} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate" style={{ color: 'var(--fg)' }}>{att.file_name}</div>
                <div className="text-xs" style={{ color: 'var(--fg-3)' }}>
                  {formatBytes(att.size_bytes)} · {att.mime_type || '—'} · {new Date(att.uploaded_at).toLocaleString('ru-RU')}
                </div>
              </div>
              <a
                href={att.file_url}
                target="_blank" rel="noreferrer"
                className="text-sm font-medium"
                style={{ color: 'var(--accent)', textDecoration: 'none', minHeight: 44, display: 'inline-flex', alignItems: 'center', padding: '0 8px' }}
                title="Открыть"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>open_in_new</span>
              </a>
              <button
                onClick={() => remove(att.id)}
                aria-label="Удалить"
                className="rounded-lg"
                style={{
                  width: 44, height: 44,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  border: '1px solid var(--border)', background: 'var(--surface)', color: '#f43f5e',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>delete</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function FilePreview({ att }) {
  const isImage = (att.mime_type || '').startsWith('image/')
  if (isImage) {
    return (
      <a href={att.file_url} target="_blank" rel="noreferrer" style={{ flexShrink: 0 }}>
        <img
          src={att.file_url} alt={att.file_name}
          style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }}
        />
      </a>
    )
  }
  return (
    <div
      style={{
        width: 48, height: 48, borderRadius: 8,
        background: 'var(--surface-2, rgba(0,0,0,0.04))',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        border: '1px solid var(--border)', flexShrink: 0,
      }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 24, color: 'var(--accent)' }}>
        {(att.mime_type || '').includes('pdf') ? 'picture_as_pdf' : 'description'}
      </span>
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────
// БЛОК: Вкладка «Направления»
// ─────────────────────────────────────────────────────────────────────────

function ReferralsTab({ apptId, appt, onChanged }) {
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [creating, setCreating] = useState(false)
  const [doctors, setDoctors] = useState([])

  const reload = async () => {
    setLoading(true); setErr('')
    try {
      const r = await api.get(`/appointments/${apptId}/referrals`)
      setList(r.data || [])
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Ошибка загрузки')
    } finally { setLoading(false) }
  }
  useEffect(() => { reload() }, [apptId])

  // Список врачей подтянем лениво при открытии формы создания
  const loadDoctors = async () => {
    if (doctors.length) return
    try {
      const r = await api.get('/doctors')
      setDoctors(r.data || [])
    } catch { /* ignore */ }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm" style={{ color: 'var(--fg-2)' }}>
          Направлений: <strong style={{ color: 'var(--fg)' }}>{list.length}</strong>
        </div>
        {!creating && (
          <Button variant="primary" size="sm" onClick={() => { setCreating(true); loadDoctors() }}
            leftIcon={<span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>}>
            Создать направление
          </Button>
        )}
      </div>

      {creating && (
        <CreateReferralForm
          apptId={apptId}
          doctors={doctors}
          sourceDoctorId={appt?.doctor_id}
          onCancel={() => setCreating(false)}
          onCreated={async () => { setCreating(false); await reload(); onChanged && onChanged() }}
        />
      )}

      {err && <div className="text-xs" style={{ color: '#f43f5e' }}>{err}</div>}

      {loading ? (
        <div className="py-8 text-center" style={{ color: 'var(--fg-3)' }}>Загрузка…</div>
      ) : list.length === 0 ? (
        <div className="py-6 text-center text-sm" style={{ color: 'var(--fg-3)' }}>Направлений пока нет</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map(ref => {
            const tt = TARGET_TYPES.find(t => t.id === ref.target_type) || { label: ref.target_type, icon: 'help' }
            const st = REF_STATUS_CHIP[ref.status] || REF_STATUS_CHIP.pending
            return (
              <li key={ref.id}
                style={{
                  padding: '10px 12px', borderRadius: 10,
                  border: '1px solid var(--border)', background: 'var(--surface)',
                }}
              >
                <div className="flex items-start gap-3 flex-wrap">
                  <span className="material-symbols-outlined" style={{ fontSize: 22, color: 'var(--accent)' }}>{tt.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium" style={{ color: 'var(--fg)' }}>
                      {tt.label}
                      {ref.target_doctor_name && <> · {ref.target_doctor_name}</>}
                      {ref.target_service && <> · {ref.target_service}</>}
                    </div>
                    {ref.notes && (
                      <div className="text-xs mt-1" style={{ color: 'var(--fg-2)' }}>{ref.notes}</div>
                    )}
                    <div className="text-xs mt-1" style={{ color: 'var(--fg-3)' }}>
                      {new Date(ref.created_at).toLocaleString('ru-RU')}
                    </div>
                  </div>
                  <Chip variant={st.variant}>{st.label}</Chip>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function CreateReferralForm({ apptId, doctors, sourceDoctorId, onCancel, onCreated }) {
  const [targetType, setTargetType] = useState('doctor')
  const [targetDoctorId, setTargetDoctorId] = useState('')
  const [targetService, setTargetService] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // Список врачей: исключаем самого себя
  const filteredDoctors = useMemo(
    () => (doctors || []).filter(d => d.id !== sourceDoctorId),
    [doctors, sourceDoctorId]
  )

  const submit = async () => {
    setErr('')
    if (targetType === 'doctor' && !targetDoctorId) { setErr('Выберите врача'); return }
    if (targetType !== 'doctor' && !targetService.trim()) {
      setErr('Опишите исследование/процедуру'); return
    }
    setBusy(true)
    try {
      await api.post(`/appointments/${apptId}/referrals`, {
        target_type: targetType,
        target_doctor_id: targetType === 'doctor' ? targetDoctorId : null,
        target_service: targetType !== 'doctor' ? targetService : null,
        notes: notes || null,
      })
      onCreated && onCreated()
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Не удалось создать')
    } finally { setBusy(false) }
  }

  return (
    <div
      style={{
        padding: 12, borderRadius: 10,
        border: '1px solid var(--border)', background: 'var(--surface-2, rgba(0,0,0,0.03))',
      }}
      className="flex flex-col gap-2"
    >
      <div className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>Новое направление</div>

      {/* Тип */}
      <div className="flex flex-wrap gap-1">
        {TARGET_TYPES.map(t => (
          <button
            key={t.id}
            onClick={() => setTargetType(t.id)}
            className="text-xs font-medium"
            style={{
              padding: '8px 12px', borderRadius: 999, minHeight: 36,
              border: `1px solid ${targetType === t.id ? 'var(--accent)' : 'var(--border)'}`,
              background: targetType === t.id ? 'var(--accent)' : 'var(--surface)',
              color: targetType === t.id ? '#fff' : 'var(--fg-2)',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {targetType === 'doctor' ? (
        <select
          value={targetDoctorId}
          onChange={e => setTargetDoctorId(e.target.value)}
          className="text-sm"
          style={{
            padding: '10px 12px', borderRadius: 10,
            border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg)',
            minHeight: 44,
          }}
        >
          <option value="">— выберите врача —</option>
          {filteredDoctors.map(d => (
            <option key={d.id} value={d.id}>
              {d.full_name}{d.specialty ? ` · ${d.specialty}` : ''}
            </option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          value={targetService}
          onChange={e => setTargetService(e.target.value)}
          placeholder="Например, КТ грудной клетки с контрастом"
          className="text-sm"
          style={{
            padding: '10px 12px', borderRadius: 10,
            border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg)',
            minHeight: 44,
          }}
        />
      )}

      <textarea
        rows={2}
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder="Заметки врача (необязательно)"
        className="text-sm"
        style={{
          padding: '10px 12px', borderRadius: 10,
          border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg)',
          resize: 'vertical', minHeight: 60,
        }}
      />

      {err && <div className="text-xs" style={{ color: '#f43f5e' }}>{err}</div>}

      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" onClick={submit} disabled={busy}>
          {busy ? 'Создаю…' : 'Создать'}
        </Button>
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={busy}>Отмена</Button>
      </div>
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────
// БЛОК: Вкладка «История»
// ─────────────────────────────────────────────────────────────────────────

function HistoryTab({ phone }) {
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!phone) { setLoading(false); return }
    let alive = true
    setLoading(true); setErr('')
    api.get(`/patients/${encodeURIComponent(phone)}/history`)
      .then(r => alive && setList(r.data || []))
      .catch(e => alive && setErr(e?.response?.data?.detail || 'Ошибка загрузки'))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [phone])

  if (!phone) {
    return <div className="py-6 text-center text-sm" style={{ color: 'var(--fg-3)' }}>
      Нет телефона пациента
    </div>
  }
  if (loading) {
    return <div className="py-8 text-center" style={{ color: 'var(--fg-3)' }}>Загрузка…</div>
  }
  if (err) {
    return <div className="text-xs py-4" style={{ color: '#f43f5e' }}>{err}</div>
  }
  // Показываем максимум 10 в превью
  const items = list.slice(0, 10)
  if (items.length === 0) {
    return <div className="py-6 text-center text-sm" style={{ color: 'var(--fg-3)' }}>
      Других приёмов не найдено
    </div>
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map(it => {
        const st = STATUS_CHIP[it.status] || STATUS_CHIP.pending
        return (
          <div
            key={it.id}
            style={{
              padding: '10px 12px', borderRadius: 10,
              border: '1px solid var(--border)', background: 'var(--surface)',
            }}
          >
            <div className="flex items-start gap-2 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium" style={{ color: 'var(--fg)' }}>
                  {formatDate(it.appointment_date)} {it.start_time}
                  {it.doctor_name && <> · {it.doctor_name}</>}
                  {it.doctor_specialty && <span style={{ color: 'var(--fg-3)' }}> · {it.doctor_specialty}</span>}
                </div>
                {it.conclusion && (
                  <div className="text-xs mt-1" style={{ color: 'var(--fg-2)', whiteSpace: 'pre-line' }}>
                    {it.conclusion.length > 240 ? it.conclusion.slice(0, 240) + '…' : it.conclusion}
                  </div>
                )}
                {!it.conclusion && it.notes && (
                  <div className="text-xs mt-1" style={{ color: 'var(--fg-3)' }}>{it.notes}</div>
                )}
                {(it.has_outcome || it.referrals_count > 0) && (
                  <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                    {it.has_outcome && <Chip variant="good">Заключение</Chip>}
                    {it.referrals_count > 0 && <Chip variant="accent">{it.referrals_count} напр.</Chip>}
                  </div>
                )}
              </div>
              <Chip variant={st.variant}>{st.label}</Chip>
            </div>
          </div>
        )
      })}
      {list.length > 10 && (
        <div className="text-xs text-center mt-1" style={{ color: 'var(--fg-3)' }}>
          и ещё {list.length - 10}…
        </div>
      )}
    </div>
  )
}
