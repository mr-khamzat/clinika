/**
 * AdReport.js — генератор HTML-отчёта для рекламодателя.
 * Открывает новую вкладку с красивым отчётом + SVG-графики.
 * Можно распечатать / сохранить как PDF через Ctrl+P.
 */

const COLORS = {
  impressions: '#0097A7',
  clicks:      '#7c3aed',
  conversions: '#d97706',
  ctr:         '#dc2626',
}

function svgLineChart(series, keys, width = 600, height = 180) {
  if (!series || series.length === 0) return '<p style="color:#94a3b8;font-size:13px">Нет данных</p>'

  const pad = { top: 20, right: 20, bottom: 40, left: 50 }
  const W = width - pad.left - pad.right
  const H = height - pad.top - pad.bottom
  const n = series.length

  const maxVal = Math.max(...series.flatMap(d => keys.map(k => d[k] || 0)), 1)

  const x = i => pad.left + (i / (n - 1)) * W
  const y = v => pad.top + H - (v / maxVal) * H

  // Grid lines
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const yv = pad.top + H - f * H
    const val = Math.round(f * maxVal)
    return `
      <line x1="${pad.left}" y1="${yv}" x2="${pad.left + W}" y2="${yv}" stroke="#e2e8f0" stroke-width="1"/>
      <text x="${pad.left - 6}" y="${yv + 4}" text-anchor="end" font-size="10" fill="#94a3b8">${val}</text>
    `
  }).join('')

  // X axis labels (every ~7 days)
  const step = Math.max(1, Math.floor(n / 7))
  const xLabels = series.map((d, i) => {
    if (i % step !== 0 && i !== n - 1) return ''
    const label = d.date ? d.date.slice(5) : ''
    return `<text x="${x(i)}" y="${pad.top + H + 18}" text-anchor="middle" font-size="10" fill="#94a3b8">${label}</text>`
  }).join('')

  // Lines + areas
  const paths = keys.map(k => {
    const color = COLORS[k] || '#64748b'
    const pts = series.map((d, i) => `${x(i)},${y(d[k] || 0)}`).join(' ')
    const areaBottom = `${x(n - 1)},${pad.top + H} ${x(0)},${pad.top + H}`
    return `
      <defs>
        <linearGradient id="grad_${k}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.15"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <polygon points="${pts} ${areaBottom}" fill="url(#grad_${k})"/>
      <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    `
  }).join('')

  // Dots at last point
  const dots = keys.map(k => {
    const last = series[n - 1]
    const color = COLORS[k] || '#64748b'
    return `<circle cx="${x(n - 1)}" cy="${y(last[k] || 0)}" r="4" fill="${color}" stroke="white" stroke-width="2"/>`
  }).join('')

  return `
    <svg width="100%" viewBox="0 0 ${width} ${height}" style="overflow:visible">
      ${gridLines}
      ${xLabels}
      ${paths}
      ${dots}
      <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + H}" stroke="#e2e8f0" stroke-width="1"/>
      <line x1="${pad.left}" y1="${pad.top + H}" x2="${pad.left + W}" y2="${pad.top + H}" stroke="#e2e8f0" stroke-width="1"/>
    </svg>
  `
}

function svgBarChart(series, width = 600, height = 140) {
  if (!series || series.length === 0) return ''
  const pad = { top: 16, right: 20, bottom: 36, left: 50 }
  const W = width - pad.left - pad.right
  const H = height - pad.top - pad.bottom
  const n = series.length
  const maxVal = Math.max(...series.map(d => d.impressions || 0), 1)
  const barW = Math.max(4, W / n - 3)
  const x = i => pad.left + (i / n) * W + (W / n - barW) / 2

  const bars = series.map((d, i) => {
    const h = ((d.impressions || 0) / maxVal) * H
    const yv = pad.top + H - h
    const label = d.date ? d.date.slice(5) : ''
    const showLabel = i % Math.max(1, Math.floor(n / 7)) === 0
    return `
      <rect x="${x(i)}" y="${yv}" width="${barW}" height="${h}" rx="3" fill="#0097A7" opacity="0.75"/>
      ${showLabel ? `<text x="${x(i) + barW / 2}" y="${pad.top + H + 16}" text-anchor="middle" font-size="9" fill="#94a3b8">${label}</text>` : ''}
    `
  }).join('')

  const gridLines = [0, 0.5, 1].map(f => {
    const yv = pad.top + H - f * H
    const val = Math.round(f * maxVal)
    return `
      <line x1="${pad.left}" y1="${yv}" x2="${pad.left + W}" y2="${yv}" stroke="#f1f5f9" stroke-width="1"/>
      <text x="${pad.left - 6}" y="${yv + 4}" text-anchor="end" font-size="10" fill="#94a3b8">${val}</text>
    `
  }).join('')

  return `
    <svg width="100%" viewBox="0 0 ${width} ${height}" style="overflow:visible">
      ${gridLines}${bars}
      <line x1="${pad.left}" y1="${pad.top + H}" x2="${pad.left + W}" y2="${pad.top + H}" stroke="#e2e8f0"/>
    </svg>
  `
}

export function generateAdReport(ad, stats) {
  const { totals, series } = stats
  const generatedAt = new Date().toLocaleString('ru-RU')
  const days = stats.days || 30

  const ctrTrend = series.map(d => ({
    ...d,
    ctr: d.impressions > 0 ? parseFloat((d.clicks / d.impressions * 100).toFixed(1)) : 0,
  }))

  const peakDay = [...series].sort((a, b) => b.impressions - a.impressions)[0]
  const peakClick = [...series].sort((a, b) => b.clicks - a.clicks)[0]
  const activeDays = series.filter(d => d.impressions > 0).length

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Отчёт по рекламе — ${ad.title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0 }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8fafc; color: #1e293b; }
    .page { max-width: 900px; margin: 0 auto; padding: 40px 32px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; padding-bottom: 24px; border-bottom: 2px solid #e2e8f0; }
    .header-left h1 { font-size: 26px; font-weight: 800; color: #0097A7; margin-bottom: 4px; }
    .header-left p { font-size: 13px; color: #64748b; }
    .logo { font-size: 22px; font-weight: 900; color: #0097A7; letter-spacing: -0.5px; }
    .logo span { color: #003845; }
    .meta { background: white; border-radius: 16px; padding: 20px 24px; margin-bottom: 24px; border: 1px solid #e2e8f0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
    .meta-item label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: .5px; display: block; margin-bottom: 4px; }
    .meta-item value { font-size: 14px; font-weight: 600; color: #1e293b; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 24px; }
    .kpi-card { background: white; border-radius: 14px; padding: 18px 20px; border: 1px solid #e2e8f0; text-align: center; }
    .kpi-value { font-size: 32px; font-weight: 800; margin-bottom: 4px; }
    .kpi-label { font-size: 12px; color: #64748b; }
    .card { background: white; border-radius: 16px; padding: 22px 24px; margin-bottom: 20px; border: 1px solid #e2e8f0; }
    .card h3 { font-size: 15px; font-weight: 700; color: #1e293b; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
    .legend { display: flex; gap: 20px; margin-bottom: 12px; flex-wrap: wrap; }
    .legend-item { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #64748b; }
    .legend-dot { width: 12px; height: 12px; border-radius: 50%; }
    .insight-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 16px; }
    .insight { background: #f8fafc; border-radius: 10px; padding: 14px 16px; }
    .insight label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: .5px; display: block; margin-bottom: 4px; }
    .insight value { font-size: 15px; font-weight: 700; color: #1e293b; }
    .footer { text-align: center; color: #94a3b8; font-size: 12px; padding-top: 32px; border-top: 1px solid #e2e8f0; margin-top: 32px; }
    .badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; }
    .badge-active { background: #dcfce7; color: #16a34a; }
    .badge-paused { background: #fef3c7; color: #d97706; }
    .badge-other  { background: #f1f5f9; color: #64748b; }
    @media print {
      body { background: white; }
      .page { padding: 20px; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
<div class="page">

  <!-- Шапка -->
  <div class="header">
    <div class="header-left">
      <h1>${ad.title}</h1>
      <p>Рекламный отчёт за ${days} дней &nbsp;·&nbsp; Сформирован: ${generatedAt}</p>
    </div>
    <div class="logo"><span>Клиник</span>Сеть</div>
  </div>

  <!-- Параметры кампании -->
  <div class="meta">
    <div class="meta-item">
      <label>Статус</label>
      <value>
        <span class="badge ${ad.status === 'active' ? 'badge-active' : ad.status === 'paused' ? 'badge-paused' : 'badge-other'}">
          ${{ active:'Активно', paused:'Пауза', draft:'Черновик', completed:'Завершено', cancelled:'Отменено' }[ad.status] || ad.status}
        </span>
      </value>
    </div>
    <div class="meta-item">
      <label>Период размещения</label>
      <value>${ad.start_date} — ${ad.end_date}</value>
    </div>
    <div class="meta-item">
      <label>Модель оплаты</label>
      <value>${{ flat:'Фиксированная', cpc:'За клик (CPC)', cpm:'За 1000 показов (CPM)' }[ad.pricing_model] || ad.pricing_model}</value>
    </div>
    <div class="meta-item">
      <label>Стоимость</label>
      <value>${Number(ad.price).toLocaleString('ru')} ₽</value>
    </div>
    <div class="meta-item">
      <label>Тип</label>
      <value>${{ banner:'Баннер', interstitial:'Промежуточный', native:'Нативный' }[ad.ad_type] || ad.ad_type}</value>
    </div>
    <div class="meta-item">
      <label>Ссылка</label>
      <value style="word-break:break-all;font-size:12px">${ad.link || 'Не указана'}</value>
    </div>
  </div>

  <!-- KPI -->
  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-value" style="color:#0097A7">${totals.impressions.toLocaleString('ru')}</div>
      <div class="kpi-label">👁 Показов</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-value" style="color:#7c3aed">${totals.clicks.toLocaleString('ru')}</div>
      <div class="kpi-label">🖱 Кликов</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-value" style="color:#d97706">${totals.conversions.toLocaleString('ru')}</div>
      <div class="kpi-label">🎯 Конверсий</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-value" style="color:#dc2626">${totals.ctr}%</div>
      <div class="kpi-label">📊 CTR</div>
    </div>
  </div>

  <!-- График: показы и клики по дням -->
  <div class="card">
    <h3>📈 Динамика показов и кликов</h3>
    <div class="legend">
      <div class="legend-item"><div class="legend-dot" style="background:#0097A7"></div> Показы</div>
      <div class="legend-item"><div class="legend-dot" style="background:#7c3aed"></div> Клики</div>
    </div>
    ${svgLineChart(series, ['impressions', 'clicks'])}
    <div class="insight-grid">
      <div class="insight">
        <label>Активных дней</label>
        <value>${activeDays} из ${days}</value>
      </div>
      <div class="insight">
        <label>Пик показов</label>
        <value>${peakDay ? peakDay.date.slice(5) + ' — ' + peakDay.impressions : '—'}</value>
      </div>
      <div class="insight">
        <label>Пик кликов</label>
        <value>${peakClick ? peakClick.date.slice(5) + ' — ' + peakClick.clicks : '—'}</value>
      </div>
    </div>
  </div>

  <!-- График: столбцы показов -->
  <div class="card">
    <h3>📊 Показы по дням</h3>
    ${svgBarChart(series)}
  </div>

  <!-- График CTR -->
  <div class="card">
    <h3>📉 CTR по дням (%)</h3>
    <div class="legend">
      <div class="legend-item"><div class="legend-dot" style="background:#dc2626"></div> CTR %</div>
    </div>
    ${svgLineChart(ctrTrend, ['ctr'])}
  </div>

  <!-- Итоги -->
  <div class="card">
    <h3>🏁 Итоговые показатели</h3>
    <div class="insight-grid">
      <div class="insight">
        <label>Всего показов</label>
        <value>${totals.impressions.toLocaleString('ru')}</value>
      </div>
      <div class="insight">
        <label>Всего кликов</label>
        <value>${totals.clicks.toLocaleString('ru')}</value>
      </div>
      <div class="insight">
        <label>Конверсий</label>
        <value>${totals.conversions.toLocaleString('ru')}</value>
      </div>
      <div class="insight">
        <label>CTR</label>
        <value>${totals.ctr}%</value>
      </div>
      <div class="insight">
        <label>Цена за показ</label>
        <value>${totals.impressions > 0 ? (ad.price / totals.impressions).toFixed(2) : '—'} ₽</value>
      </div>
      <div class="insight">
        <label>Цена за клик</label>
        <value>${totals.clicks > 0 ? (ad.price / totals.clicks).toFixed(2) : '—'} ₽</value>
      </div>
    </div>
  </div>

  <div class="footer">
    КлиникСеть &nbsp;·&nbsp; Отчёт сформирован автоматически &nbsp;·&nbsp; ${generatedAt}
    <br><br>
    <button class="no-print" onclick="window.print()"
      style="margin-top:8px;padding:10px 28px;background:#0097A7;color:white;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer">
      🖨️ Сохранить как PDF
    </button>
  </div>

</div>
</body>
</html>`

  const w = window.open('', '_blank')
  w.document.write(html)
  w.document.close()
}
