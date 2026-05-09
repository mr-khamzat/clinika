/**
 * ========================================
 * БЛОК: Генератор Excel-отчёта по приёмам (xlsx)
 * ========================================
 * Три листа:
 *   • «Приёмы»     — все записи с auto-filter и sticky header
 *   • «KPI»        — сводные показатели + по статусам
 *   • «По врачам»  — топ-10 врачей по количеству приёмов
 * ========================================
 */
import * as XLSX from 'xlsx'

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

/**
 * Формирует и скачивает .xlsx файл.
 * @param {object} data - ответ API /manager/reports/appointments
 * @param {object} meta - { from, to, clinic_name }
 */
export async function generateAppointmentsExcel(data, meta) {
  const wb = XLSX.utils.book_new()

  // ── Лист 1: Приёмы ─────────────────────────────────────────────────
  const apptHeaders = [
    'Дата', 'Время', 'Врач', 'Специальность', 'Клиника',
    'Пациент', 'Телефон', 'Статус', 'Цена ₽', 'Оплата', 'Заметки',
  ]
  const apptRows = (data.appointments || []).map(a => ([
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
  ]))

  const wsAppts = XLSX.utils.aoa_to_sheet([apptHeaders, ...apptRows])

  // Auto-filter на все колонки + freeze header (sticky header)
  const lastCol = XLSX.utils.encode_col(apptHeaders.length - 1)
  const lastRow = apptRows.length + 1
  wsAppts['!autofilter'] = { ref: `A1:${lastCol}${lastRow}` }
  wsAppts['!freeze'] = { ySplit: 1 }
  wsAppts['!cols'] = [
    { wch: 12 }, { wch: 8 },  { wch: 28 }, { wch: 18 }, { wch: 22 },
    { wch: 24 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 30 },
  ]
  XLSX.utils.book_append_sheet(wb, wsAppts, 'Приёмы')

  // ── Лист 2: KPI ────────────────────────────────────────────────────
  const kpi = data.kpi || {}
  const kpiRows = [
    ['Параметр', 'Значение'],
    ['Период с',           formatDateRu(meta.from)],
    ['Период по',          formatDateRu(meta.to)],
    ['Клиника',            meta.clinic_name || 'Все'],
    ['Всего записей',      data.total ?? 0],
    ['Общая выручка, ₽',   data.total_revenue ?? 0],
    ['Средний чек, ₽',     kpi.avg_cheque ?? 0],
    [],
    ['По статусам', 'Кол-во'],
    ...Object.entries(kpi.by_status || {}).map(
      ([s, c]) => [STATUS_LABEL[s] || s, c]
    ),
  ]
  const wsKpi = XLSX.utils.aoa_to_sheet(kpiRows)
  wsKpi['!cols'] = [{ wch: 28 }, { wch: 24 }]
  XLSX.utils.book_append_sheet(wb, wsKpi, 'KPI')

  // ── Лист 3: По врачам (топ-10) ─────────────────────────────────────
  const docHeaders = ['Врач', 'Специальность', 'Записей', 'Выручка ₽']
  const docRows = (kpi.top_doctors || []).map(d => [
    d.doctor_name,
    d.specialty,
    d.count,
    d.revenue,
  ])
  const wsDocs = XLSX.utils.aoa_to_sheet([docHeaders, ...docRows])
  wsDocs['!cols'] = [{ wch: 28 }, { wch: 22 }, { wch: 12 }, { wch: 16 }]
  if (docRows.length > 0) {
    wsDocs['!autofilter'] = {
      ref: `A1:${XLSX.utils.encode_col(docHeaders.length - 1)}${docRows.length + 1}`,
    }
  }
  XLSX.utils.book_append_sheet(wb, wsDocs, 'По врачам')

  // ── Скачивание файла ───────────────────────────────────────────────
  const fname = `appointments_${meta.from}_${meta.to}.xlsx`
  XLSX.writeFile(wb, fname)
}
