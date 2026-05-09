/**
 * ========================================
 * БЛОК: AppointmentsReportModal — модалка выгрузки отчёта по приёмам
 * ========================================
 * Открывается из ManagerAppointments по кнопке «Выгрузить отчёт».
 * Поля: From-To, Doctor, Clinic, Status, Format (PDF / Excel / CSV).
 * Превью KPI (предзагрузка), кнопка «Скачать».
 *
 * Бэкенд: GET /manager/reports/appointments
 *   → { appointments: [...], total, total_revenue, kpi: {...} }
 * Файл генерируется на фронте: jspdf+autotable / xlsx / простой CSV.
 * ========================================
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import api from '../../api'
import { Modal, Button, KpiRow, KpiCard, useToast } from '../../design'
import { generateAppointmentsPDF } from './appointmentsReportPdf'
import { generateAppointmentsExcel } from './appointmentsReportExcel'
import { generateAppointmentsCSV } from './appointmentsReportCsv'

// ───── Хелперы дат ─────
function isoDate(d) {
  // YYYY-MM-DD без часовых зон
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function startOfMonth() {
  const d = new Date()
  d.setDate(1)
  return isoDate(d)
}

function todayIso() {
  return isoDate(new Date())
}

// ───── Список статусов ─────
const STATUS_OPTIONS = [
  { value: 'pending',   label: 'Ожидает' },
  { value: 'confirmed', label: 'Подтверждена' },
  { value: 'completed', label: 'Завершена' },
  { value: 'cancelled', label: 'Отменена' },
  { value: 'no_show',   label: 'Не пришёл' },
]

const FORMAT_OPTIONS = [
  { value: 'pdf',   label: 'PDF' },
  { value: 'xlsx',  label: 'Excel' },
  { value: 'csv',   label: 'CSV' },
]

export default function AppointmentsReportModal({ open, onClose }) {
  const toast = useToast()

  // ── Состояния формы ──
  const [fromDate, setFromDate] = useState(startOfMonth())
  const [toDate,   setToDate]   = useState(todayIso())
  const [doctorId, setDoctorId] = useState('')
  const [clinicId, setClinicId] = useState('')
  const [statusVal, setStatusVal] = useState('') // одно значение (multi-select упрощён до одного)
  const [format, setFormat] = useState('pdf')

  // ── Справочники: врачи + клиники ──
  const [doctors, setDoctors] = useState([])
  const [clinics, setClinics] = useState([])

  // ── Превью KPI ──
  const [preview, setPreview] = useState(null)        // данные ответа API
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [downloading, setDownloading] = useState(false)

  // ── Загрузка справочников при открытии ──
  useEffect(() => {
    if (!open) return
    api.get('/doctors').then(r => setDoctors(Array.isArray(r.data) ? r.data : [])).catch(() => setDoctors([]))
    api.get('/manager/clinics/').then(r => setClinics(Array.isArray(r.data) ? r.data : [])).catch(() => setClinics([]))
  }, [open])

  // ── Параметры запроса ──
  const queryParams = useMemo(() => {
    const p = { from_date: fromDate, to_date: toDate }
    if (doctorId)  p.doctor_id = doctorId
    if (clinicId)  p.clinic_id = clinicId
    if (statusVal) p.status = statusVal
    return p
  }, [fromDate, toDate, doctorId, clinicId, statusVal])

  // ── Загрузка превью KPI (debounce 400ms) ──
  useEffect(() => {
    if (!open) return
    if (!fromDate || !toDate) return
    let alive = true
    setLoadingPreview(true)
    const t = setTimeout(() => {
      api.get('/manager/reports/appointments', { params: queryParams })
        .then(r => { if (alive) setPreview(r.data) })
        .catch(() => { if (alive) setPreview(null) })
        .finally(() => { if (alive) setLoadingPreview(false) })
    }, 400)
    return () => { alive = false; clearTimeout(t) }
  }, [open, queryParams, fromDate, toDate])

  // ── Скачивание файла ──
  const handleDownload = useCallback(async () => {
    if (!fromDate || !toDate) {
      toast.error('Выберите период')
      return
    }
    setDownloading(true)
    try {
      // Если уже есть свежий preview — используем его, иначе грузим
      let data = preview
      if (!data) {
        const r = await api.get('/manager/reports/appointments', { params: queryParams })
        data = r.data
      }
      if (!data || !Array.isArray(data.appointments) || data.appointments.length === 0) {
        toast.warn ? toast.warn('Нет данных за период') : toast.error('Нет данных за период')
        return
      }
      const meta = {
        from: fromDate,
        to: toDate,
        clinic_name: clinicId
          ? (clinics.find(c => c.id === clinicId)?.name || '')
          : 'Все клиники',
      }
      if (format === 'pdf') {
        await generateAppointmentsPDF(data, meta)
      } else if (format === 'xlsx') {
        await generateAppointmentsExcel(data, meta)
      } else {
        generateAppointmentsCSV(data, meta)
      }
      toast.success ? toast.success('Файл сохранён') : null
    } catch (err) {
      console.error('[report] download failed', err)
      toast.error('Ошибка при формировании отчёта')
    } finally {
      setDownloading(false)
    }
  }, [fromDate, toDate, preview, queryParams, format, clinics, clinicId, toast])

  // ── Стили инпутов в шапке формы ──
  const inputStyle = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 10,
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--fg)',
    fontSize: 13.5,
  }
  const labelStyle = {
    display: 'block',
    fontSize: 12,
    color: 'var(--fg-3)',
    marginBottom: 4,
    fontWeight: 500,
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Выгрузка отчёта по приёмам"
      size="lg"
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button
            variant="primary"
            onClick={handleDownload}
            disabled={downloading || loadingPreview}
          >
            {downloading ? 'Формируется…' : 'Скачать'}
          </Button>
        </>
      }
    >
      {/* ── Форма параметров ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
        <div>
          <label style={labelStyle}>С даты</label>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>По дату</label>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Врач</label>
          <select value={doctorId} onChange={e => setDoctorId(e.target.value)} style={inputStyle}>
            <option value="">Все врачи</option>
            {doctors.map(d => (
              <option key={d.id} value={d.id}>{d.full_name}{d.specialty ? ` — ${d.specialty}` : ''}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Клиника</label>
          <select value={clinicId} onChange={e => setClinicId(e.target.value)} style={inputStyle}>
            <option value="">Все клиники</option>
            {clinics.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Статус</label>
          <select value={statusVal} onChange={e => setStatusVal(e.target.value)} style={inputStyle}>
            <option value="">Все статусы</option>
            {STATUS_OPTIONS.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Формат файла</label>
          <select value={format} onChange={e => setFormat(e.target.value)} style={inputStyle}>
            {FORMAT_OPTIONS.map(f => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Превью KPI ── */}
      <div style={{ marginTop: 18 }}>
        <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 8, fontWeight: 500 }}>
          {loadingPreview ? 'Загрузка превью…' : 'Превью за выбранный период'}
        </div>
        {preview ? (
          <KpiRow>
            <KpiCard label="Записей" value={String(preview.total ?? 0)} />
            <KpiCard label="Выручка, ₽" value={Number(preview.total_revenue || 0).toLocaleString('ru-RU')} />
            <KpiCard label="Средний чек, ₽" value={Number(preview.kpi?.avg_cheque || 0).toLocaleString('ru-RU')} />
            <KpiCard
              label="Завершено"
              value={String((preview.kpi?.by_status?.completed) ?? 0)}
            />
          </KpiRow>
        ) : (
          <div style={{ color: 'var(--fg-3)', fontSize: 13 }}>
            {loadingPreview ? '…' : 'Выберите период, чтобы увидеть KPI'}
          </div>
        )}
      </div>

      {/* ── Подсказка про лимит ── */}
      <div style={{ marginTop: 14, fontSize: 11.5, color: 'var(--fg-3)' }}>
        Период не более 6 месяцев. Лимит выгрузки: 5000 записей.
      </div>
    </Modal>
  )
}
