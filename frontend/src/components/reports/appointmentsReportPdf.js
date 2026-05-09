/**
 * ========================================
 * БЛОК: Генератор PDF-отчёта по приёмам (jspdf + jspdf-autotable)
 * ========================================
 * Формирует красивый PDF с шапкой, KPI-сводкой и таблицей записей,
 * сгруппированной по дням. Поддержка кириллицы — TTF-шрифт Roboto
 * подгружается из /fonts/Roboto-Regular.ttf и /fonts/Roboto-Bold.ttf
 * при первом обращении (через addFileToVFS + addFont).
 * ========================================
 */
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// ── Кэш base64-контента шрифтов: один раз грузим, дальше переиспользуем ──
let _fontCache = null

async function _fetchFontBase64(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Не удалось загрузить шрифт ${url}: ${r.status}`)
  const buf = await r.arrayBuffer()
  // ArrayBuffer → base64
  const bytes = new Uint8Array(buf)
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

async function _ensureCyrillicFonts() {
  if (_fontCache) return _fontCache
  const [reg, bold] = await Promise.all([
    _fetchFontBase64('/fonts/Roboto-Regular.ttf'),
    _fetchFontBase64('/fonts/Roboto-Bold.ttf'),
  ])
  _fontCache = { reg, bold }
  return _fontCache
}

function _registerFonts(doc, fonts) {
  doc.addFileToVFS('Roboto-Regular.ttf', fonts.reg)
  doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal')
  doc.addFileToVFS('Roboto-Bold.ttf', fonts.bold)
  doc.addFont('Roboto-Bold.ttf', 'Roboto', 'bold')
  doc.setFont('Roboto', 'normal')
}

// Карта статусов для отображения
const STATUS_LABEL = {
  pending:   'Ожидает',
  confirmed: 'Подтв.',
  completed: 'Заверш.',
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
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatRub(n) {
  if (n == null) return ''
  return Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 2 })
}

/**
 * Генерация PDF отчёта (async — подгружает кириллический TTF-шрифт).
 * @param {object} data - ответ API /manager/reports/appointments
 * @param {object} meta - { from, to, clinic_name }
 */
export async function generateAppointmentsPDF(data, meta) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })

  // Подгружаем и регистрируем кириллический шрифт Roboto
  try {
    const fonts = await _ensureCyrillicFonts()
    _registerFonts(doc, fonts)
  } catch (e) {
    console.warn('[pdf] не удалось загрузить Roboto, fallback helvetica', e)
    doc.setFont('helvetica', 'normal')
  }

  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()

  // ── Шапка ────────────────────────────────────────────────────────────
  doc.setFillColor(15, 110, 95) // brand teal
  doc.rect(0, 0, pageW, 56, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(18)
  doc.text('КлиникСеть · Отчёт по приёмам', 32, 30)
  doc.setFontSize(10)
  doc.text(
    `Период: ${formatDateRu(meta.from)} — ${formatDateRu(meta.to)}    Клиника: ${meta.clinic_name || 'Все'}`,
    32, 48
  )

  // ── KPI-сводка (4 квадрата) ──────────────────────────────────────────
  const kpi = data.kpi || {}
  const kpiData = [
    { label: 'Всего записей',  value: String(data.total ?? 0) },
    { label: 'Выручка, RUB',   value: formatRub(data.total_revenue ?? 0) },
    { label: 'Средний чек',    value: formatRub(kpi.avg_cheque ?? 0) },
    { label: 'Завершено',      value: String(kpi.by_status?.completed ?? 0) },
  ]
  const cardW = (pageW - 64 - 36) / 4
  const cardY = 72
  doc.setTextColor(35, 35, 35)
  kpiData.forEach((k, i) => {
    const x = 32 + i * (cardW + 12)
    doc.setFillColor(245, 248, 247)
    doc.roundedRect(x, cardY, cardW, 60, 8, 8, 'F')
    doc.setFontSize(9)
    doc.setTextColor(110, 120, 118)
    doc.text(k.label, x + 12, cardY + 18)
    doc.setFontSize(16)
    doc.setTextColor(20, 80, 70)
    doc.text(k.value, x + 12, cardY + 44)
  })

  // ── Таблица записей с группировкой по дням ───────────────────────────
  const groups = {}
  for (const a of data.appointments) {
    if (!groups[a.date]) groups[a.date] = []
    groups[a.date].push(a)
  }
  const orderedDates = Object.keys(groups).sort()

  // Собираем body с разделителями групп + итог по дню
  const head = [['Дата', 'Время', 'Врач', 'Пациент', 'Телефон', 'Статус', 'Цена, RUB', 'Оплата']]
  const body = []
  for (const dt of orderedDates) {
    const items = groups[dt]
    const dayTotal = items.reduce((s, a) => s + (a.price || 0), 0)
    // Заголовок группы (одна строка с merged cell-эффектом)
    body.push([
      { content: formatDateRu(dt), colSpan: 8, styles: {
        fillColor: [232, 240, 238], textColor: [20, 80, 70],
        fontStyle: 'bold', fontSize: 10,
      }}
    ])
    for (const a of items) {
      body.push([
        formatDateRu(a.date),
        a.time,
        a.doctor_name || '',
        a.patient_name || '',
        a.patient_phone || '',
        STATUS_LABEL[a.status] || a.status,
        formatRub(a.price),
        PAYMENT_LABEL[a.payment_method] || a.payment_method || '',
      ])
    }
    // Итог по дню
    body.push([
      { content: `Итого за ${formatDateRu(dt)}: ${items.length} записей`,
        colSpan: 6, styles: { fontStyle: 'bold', halign: 'right', fillColor: [250, 250, 250] }},
      { content: formatRub(dayTotal), styles: { fontStyle: 'bold', fillColor: [250, 250, 250] }},
      { content: '', styles: { fillColor: [250, 250, 250] }},
    ])
  }

  autoTable(doc, {
    head,
    body,
    startY: cardY + 76,
    margin: { left: 32, right: 32 },
    styles: {
      fontSize: 9,
      cellPadding: 4,
      overflow: 'linebreak',
      font: doc.getFont().fontName,
    },
    headStyles: {
      fillColor: [15, 110, 95],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      font: doc.getFont().fontName,
    },
    alternateRowStyles: { fillColor: [252, 252, 252] },
    columnStyles: {
      0: { cellWidth: 70 },
      1: { cellWidth: 50 },
      6: { halign: 'right' },
    },
  })

  // ── Подвал ───────────────────────────────────────────────────────────
  const pageCount = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(140, 140, 140)
    doc.text(
      `Сгенерировано: ${new Date().toLocaleString('ru-RU')}  ·  Страница ${i} из ${pageCount}`,
      32, pageH - 18
    )
  }

  const fname = `appointments_${meta.from}_${meta.to}.pdf`
  doc.save(fname)
}
