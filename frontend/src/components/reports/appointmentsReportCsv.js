/**
 * ========================================
 * БЛОК: Генератор CSV-отчёта по приёмам (fallback)
 * ========================================
 * Простой CSV (разделитель ;) с BOM для Excel.
 * ========================================
 */

const STATUS_LABEL = {
  pending:   'Ожидает',
  confirmed: 'Подтверждена',
  completed: 'Завершена',
  cancelled: 'Отменена',
  no_show:   'Не пришёл',
}

const PAYMENT_LABEL = {
  acquiring: 'Эквайринг',
  cash:      'Наличные',
  transfer:  'Перевод',
}

function formatDateRu(iso) {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('ru-RU')
}

function escCsv(v) {
  if (v == null) return ''
  const s = String(v).replace(/"/g, '""')
  if (/[;"\n\r]/.test(s)) return `"${s}"`
  return s
}

export function generateAppointmentsCSV(data, meta) {
  const headers = [
    'Дата', 'Время', 'Врач', 'Специальность', 'Клиника',
    'Пациент', 'Телефон', 'Статус', 'Цена', 'Оплата', 'Заметки',
  ]
  const lines = [headers.join(';')]
  for (const a of data.appointments || []) {
    lines.push([
      formatDateRu(a.date),
      a.time,
      a.doctor_name,
      a.doctor_specialty,
      a.clinic_name,
      a.patient_name,
      a.patient_phone,
      STATUS_LABEL[a.status] || a.status,
      a.price ?? 0,
      PAYMENT_LABEL[a.payment_method] || a.payment_method || '',
      a.notes,
    ].map(escCsv).join(';'))
  }
  // BOM для Excel + CRLF
  const csv = '﻿' + lines.join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `appointments_${meta.from}_${meta.to}.csv`
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, 100)
}
