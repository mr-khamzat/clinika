/**
 * AISection v5 — dark theme, история, баланс в реальном времени, экспорт PDF + Excel
 */
import { useState, useCallback, useEffect, useRef, useContext, createContext } from 'react'
import { API_BASE } from '../config'

const API = API_BASE

function apiFetch(token, path, opts = {}) {
  return fetch(API + path, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  })
}

// ── Dark mode ─────────────────────────────────────────────────────────────────

const DarkCtx = createContext(false)
const useD = () => useContext(DarkCtx)

function useIsDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')))
    obs.observe(document.documentElement, { attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])
  return dark
}

const P = (d) => ({
  bg:           d ? '#0f172a' : '#f8fafc',
  card:         d ? '#1e293b' : '#ffffff',
  cardBorder:   d ? '#334155' : '#f1f5f9',
  text1:        d ? '#f1f5f9' : '#0f172a',
  text2:        d ? '#94a3b8' : '#64748b',
  text3:        d ? '#64748b' : '#94a3b8',
  subtle:       d ? '#1e293b' : '#f8fafc',
  border:       d ? '#334155' : '#e2e8f0',
  pillBg:       d ? '#1e293b' : '#f1f5f9',
  pillActive:   d ? '#334155' : '#ffffff',
  inputBg:      d ? '#1e293b' : '#ffffff',
  inputBorder:  d ? '#475569' : '#e2e8f0',
  balBg:        d ? '#1e1b4b' : '#faf5ff',
  balBorder:    d ? '#4c1d95' : '#e9d5ff',
  chatBg:       d ? '#0f172a' : '#fafbfc',
  msgAiBg:      d ? '#1e293b' : '#ffffff',
  msgAiBorder:  d ? '#334155' : '#f1f5f9',
  errBg:        d ? '#450a0a' : '#fff1f2',
  errBorder:    d ? '#7f1d1d' : '#fecdd3',
  errText:      d ? '#fca5a5' : '#be123c',
  codeBg:       d ? '#0f172a' : '#e0f2fe',
  infoBg:       d ? '#0c1a2e' : '#f0f9ff',
  infoBorder:   d ? '#1e40af' : '#bae6fd',
  infoText:     d ? '#93c5fd' : '#0369a1',
  notCfgBg:     d ? '#1e1b4b' : '#faf5ff',
  notCfgBorder: d ? '#4c1d95' : '#c4b5fd',
})

// ── Утилиты ───────────────────────────────────────────────────────────────────

function fmt(n, dec = 2) { return n == null ? '—' : Number(n).toFixed(dec) }
function fmtNum(n) { return n == null ? '—' : Number(n).toLocaleString('ru-RU') }

// ── Экспорт отчётов ───────────────────────────────────────────────────────────

function donutSVG(stats) {
  const segs = [
    { label: 'Подтверждено', v: stats.referrals_confirmed || 0, c: '#16a34a' },
    { label: 'Отменено',     v: stats.referrals_cancelled || 0, c: '#dc2626' },
    { label: 'Истекло',      v: stats.referrals_expired   || 0, c: '#94a3b8' },
    { label: 'В ожидании',   v: stats.referrals_pending   || 0, c: '#f59e0b' },
  ].filter(s => s.v > 0)
  const total = segs.reduce((s, g) => s + g.v, 0)
  if (total === 0) return { svg: '<text x="60" y="68" text-anchor="middle" font-size="11" fill="#94a3b8">Нет данных</text>', legend: '' }
  let angle = -Math.PI / 2
  const R = 52, cx = 65, cy = 65
  const paths = segs.map(seg => {
    const sweep = 2 * Math.PI * (seg.v / total)
    const x1 = cx + R * Math.cos(angle), y1 = cy + R * Math.sin(angle)
    const x2 = cx + R * Math.cos(angle + sweep), y2 = cy + R * Math.sin(angle + sweep)
    const large = sweep > Math.PI ? 1 : 0
    const d = `M${cx},${cy} L${x1.toFixed(1)},${y1.toFixed(1)} A${R},${R},0,${large},1,${x2.toFixed(1)},${y2.toFixed(1)}Z`
    angle += sweep
    return `<path d="${d}" fill="${seg.c}"/>`
  })
  const conv = stats.conversion_rate_pct ?? 0
  const inner = `${paths.join('')}
<circle cx="${cx}" cy="${cy}" r="32" fill="white"/>
<text x="${cx}" y="${cy - 6}" text-anchor="middle" font-size="18" font-weight="bold" fill="#1e293b">${conv}%</text>
<text x="${cx}" y="${cy + 10}" text-anchor="middle" font-size="9" fill="#64748b">конверсия</text>`
  const legend = segs.map(s => `<div class="li"><div class="ld" style="background:${s.c}"></div><span>${s.label}: <b>${s.v}</b></span></div>`).join('')
  return { svg: inner, legend }
}

function barSVG(stats) {
  const bars = [
    { label: 'Конверсия', v: stats.conversion_rate_pct || 0, c: '#16a34a' },
    { label: 'Отменено',  v: stats.cancel_rate_pct     || 0, c: '#dc2626' },
    { label: 'Истекло',   v: stats.expire_rate_pct     || 0, c: '#f59e0b' },
  ]
  const W = 300, H = 180, padL = 36, padB = 36, padT = 24
  const aH = H - padB - padT
  const bW = 64, gap = 28
  const grid = [0, 25, 50, 75, 100].map(p => {
    const y = padT + aH - (p / 100) * aH
    return `<line x1="${padL}" y1="${y}" x2="${W}" y2="${y}" stroke="#f1f5f9" stroke-width="1"/>
<text x="${padL - 4}" y="${y + 4}" text-anchor="end" font-size="8" fill="#94a3b8">${p}%</text>`
  }).join('')
  const rects = bars.map((b, i) => {
    const x = padL + 16 + i * (bW + gap)
    const bH = Math.max(2, (b.v / 100) * aH)
    const y = padT + aH - bH
    return `<rect x="${x}" y="${y}" width="${bW}" height="${bH}" fill="${b.c}" rx="6"/>
<text x="${x + bW / 2}" y="${y - 6}" text-anchor="middle" font-size="11" font-weight="bold" fill="${b.c}">${b.v}%</text>
<text x="${x + bW / 2}" y="${H - 8}" text-anchor="middle" font-size="9" fill="#64748b">${b.label}</text>`
  }).join('')
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="max-width:100%;overflow:visible">${grid}${rects}</svg>`
}

function aiToHtml(text) {
  if (!text) return ''
  return text.split('\n').map(line => {
    if (!line.trim()) return '<div style="height:8px"></div>'
    if (line.startsWith('### ')) return `<h4 style="color:#4c1d95;font-size:14px;margin:14px 0 4px">${line.slice(4)}</h4>`
    if (line.startsWith('## '))  return `<h3 style="color:#312e81;font-size:15px;margin:18px 0 6px">${line.slice(3)}</h3>`
    if (line.startsWith('# '))   return `<h2 style="color:#1e1b4b;font-size:17px;margin:20px 0 8px">${line.slice(2)}</h2>`
    const nm = line.match(/^(\d+)\.\s+\*\*(.+?)\*\*(.*)/)
    if (nm) {
      const rest = nm[3].replace(/\*\*(.+?)\*\*/g, '<strong style="color:#4c1d95">$1</strong>')
      return `<div style="display:flex;gap:10px;margin:10px 0;align-items:flex-start"><div style="min-width:24px;height:24px;background:#7c3aed;color:#fff;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;margin-top:1px">${nm[1]}</div><div><strong style="color:#312e81">${nm[2]}</strong>${rest}</div></div>`
    }
    if (line.startsWith('- ') || line.startsWith('• ')) {
      const c = line.slice(2).replace(/\*\*(.+?)\*\*/g, '<strong style="color:#4c1d95">$1</strong>')
      return `<div style="display:flex;gap:8px;margin:5px 0;align-items:flex-start"><div style="width:6px;height:6px;background:#7c3aed;border-radius:50%;margin-top:8px;flex-shrink:0"></div><div style="color:#374151">${c}</div></div>`
    }
    return `<p style="margin:3px 0;color:#374151">${line.replace(/\*\*(.+?)\*\*/g, '<strong style="color:#4c1d95">$1</strong>')}</p>`
  }).join('\n')
}

function exportPDF(data, days) {
  const { title, result, stats, model, generated_at, type } = data
  const date = new Date(generated_at).toLocaleString('ru-RU')
  const { svg: dSVG, legend: dLegend } = donutSVG(stats)
  const bSVG = barSVG(stats)
  const aiHtml = aiToHtml(result)

  const rateColor = (v, good, ok) => v >= good ? '#16a34a' : v >= ok ? '#d97706' : '#dc2626'
  const rateLabel = (v, good, ok) => v >= good ? '🟢 Хорошо' : v >= ok ? '🟡 Средне' : '🔴 Требует внимания'

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>AI Отчёт — ${title}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#1e293b;font-size:13px;line-height:1.6;background:#f8fafc;padding:0}
@page{size:A4;margin:15mm 18mm}
.page{max-width:860px;margin:0 auto;background:white;padding:32px 36px 28px}
.header{background:linear-gradient(135deg,#312e81 0%,#7c3aed 100%);color:white;padding:28px 32px;border-radius:14px;margin-bottom:24px}
.header h1{font-size:22px;font-weight:800;margin-bottom:4px;letter-spacing:-0.02em}
.header .sub{opacity:.75;font-size:12px;margin-bottom:8px}
.badge{display:inline-flex;align-items:center;background:rgba(255,255,255,.15);padding:3px 14px;border-radius:20px;font-size:11px;font-weight:700;gap:5px}
.sec-title{font-size:12px;font-weight:800;color:#4c1d95;text-transform:uppercase;letter-spacing:.07em;border-bottom:2px solid #ede9fe;padding-bottom:6px;margin:22px 0 14px}
table{width:100%;border-collapse:collapse;font-size:12px}
th{background:#f5f3ff;color:#4c1d95;font-weight:700;padding:9px 14px;text-align:left;border:1px solid #e9d5ff;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
td{padding:9px 14px;border:1px solid #f0f0f0;vertical-align:middle}
tr:nth-child(even) td{background:#fafaf8}
.num{font-weight:800;font-size:16px}
.charts{display:flex;gap:20px;flex-wrap:wrap;justify-content:center;margin:8px 0 16px}
.cbox{background:#faf5ff;border:1px solid #ede9fe;border-radius:12px;padding:18px 22px;text-align:center;flex:1;min-width:200px}
.ctitle{font-size:10px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.07em;margin-bottom:14px}
.legend{display:flex;flex-direction:column;gap:5px;text-align:left;margin-top:10px}
.li{display:flex;align-items:center;gap:6px;font-size:11px;color:#374151}
.ld{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.ai-box{background:#faf5ff;border-left:4px solid #7c3aed;padding:18px 22px;border-radius:0 12px 12px 0;line-height:1.8;font-size:13px}
.footer{margin-top:28px;padding-top:12px;border-top:1px solid #f1f5f9;display:flex;justify-content:space-between;font-size:10px;color:#94a3b8}
.print-btn{position:fixed;top:16px;right:16px;display:flex;gap:8px;z-index:999}
.btn-pdf{background:#7c3aed;color:white;border:none;padding:9px 22px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:6px;box-shadow:0 2px 8px rgba(124,58,237,.35)}
.btn-close{background:white;color:#374151;border:1px solid #e2e8f0;padding:9px 16px;border-radius:8px;font-size:13px;cursor:pointer}
@media print{
  body{background:white;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .print-btn{display:none!important}
  .page{padding:0;max-width:none}
}
</style>
</head>
<body>
<div class="print-btn">
  <button class="btn-pdf" onclick="window.print()">🖨 Сохранить как PDF</button>
  <button class="btn-close" onclick="window.close()">✕ Закрыть</button>
</div>
<div class="page">
  <!-- Шапка -->
  <div class="header">
    <h1>🤖 AI-отчёт: ${title}</h1>
    <div class="sub">${date} &nbsp;·&nbsp; Модель: ${model} &nbsp;·&nbsp; Период: ${days} дней</div>
    <div class="badge">📊 КлиникаСеть AI-аналитика</div>
  </div>

  <!-- Ключевые показатели -->
  <div class="sec-title">Ключевые показатели</div>
  <table>
    <thead><tr><th>Показатель</th><th>Значение</th><th>Доля</th><th>Оценка</th></tr></thead>
    <tbody>
      <tr>
        <td>📋 Всего направлений</td>
        <td><span class="num">${stats.referrals_total}</span></td>
        <td>за ${days} дней</td>
        <td style="color:#64748b">базовый период</td>
      </tr>
      <tr>
        <td>✅ Подтверждено</td>
        <td><span class="num" style="color:#16a34a">${stats.referrals_confirmed}</span></td>
        <td style="color:#16a34a;font-weight:700">${stats.conversion_rate_pct}%</td>
        <td style="color:${rateColor(stats.conversion_rate_pct, 50, 30)}">${rateLabel(stats.conversion_rate_pct, 50, 30)}</td>
      </tr>
      <tr>
        <td>❌ Отменено</td>
        <td><span class="num" style="color:#dc2626">${stats.referrals_cancelled}</span></td>
        <td style="color:#dc2626;font-weight:700">${stats.cancel_rate_pct}%</td>
        <td style="color:${rateColor(100 - stats.cancel_rate_pct, 90, 80)}">${stats.cancel_rate_pct <= 10 ? '🟢 Норма' : stats.cancel_rate_pct <= 20 ? '🟡 Внимание' : '🔴 Высокий %'}</td>
      </tr>
      <tr>
        <td>⏱ Истекло без ответа</td>
        <td><span class="num" style="color:#94a3b8">${stats.referrals_expired}</span></td>
        <td style="color:#94a3b8;font-weight:700">${stats.expire_rate_pct}%</td>
        <td style="color:${stats.expire_rate_pct <= 15 ? '#16a34a' : '#d97706'}">${stats.expire_rate_pct <= 15 ? '🟢 Норма' : '🟡 Внимание'}</td>
      </tr>
      <tr>
        <td>⏳ В ожидании</td>
        <td><span class="num">${stats.referrals_pending}</span></td>
        <td>—</td>
        <td style="color:#64748b">ожидают ответа</td>
      </tr>
      <tr>
        <td>👥 Активных сотрудников</td>
        <td><span class="num">${stats.staff_count}</span></td>
        <td>—</td>
        <td style="color:#64748b">—</td>
      </tr>
      <tr>
        <td>🏥 Активных клиник</td>
        <td><span class="num">${stats.clinic_count}</span></td>
        <td>—</td>
        <td style="color:#64748b">—</td>
      </tr>
    </tbody>
  </table>

  <!-- Диаграммы -->
  <div class="sec-title">Диаграммы</div>
  <div class="charts">
    <div class="cbox" style="max-width:260px">
      <div class="ctitle">Структура направлений</div>
      <svg viewBox="0 0 130 130" width="150" height="150">${dSVG}</svg>
      <div class="legend">${dLegend}</div>
    </div>
    <div class="cbox" style="flex:2;min-width:300px">
      <div class="ctitle">Ключевые показатели (%)</div>
      ${bSVG}
    </div>
  </div>

  <!-- AI анализ -->
  <div class="sec-title">AI Анализ: ${title}</div>
  <div class="ai-box">${aiHtml}</div>

  <!-- Подвал -->
  <div class="footer">
    <span>КлиникаСеть AI · Отчёт: ${date}</span>
    <span>Модель: ${model} · Период: ${days} дней · Всего направлений: ${stats.referrals_total}</span>
  </div>
</div>
</body>
</html>`

  const w = window.open('', '_blank', 'width=1000,height=750')
  if (w) { w.document.write(html); w.document.close() }
}

function exportExcel(data, days) {
  const { title, result, stats, model, generated_at } = data
  const date = new Date(generated_at).toLocaleString('ru-RU')

  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:x="urn:schemas-microsoft-com:office:excel"
xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="UTF-8">
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets>
<x:ExcelWorksheet><x:Name>Сводка</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet>
<x:ExcelWorksheet><x:Name>AI Анализ</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet>
</x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
<style>
body{font-family:Arial,sans-serif;font-size:11pt}
.xl-header{background:#312e81;color:#ffffff;font-weight:bold;font-size:14pt;padding:8pt}
.xl-subheader{background:#7c3aed;color:#ffffff;font-weight:bold;font-size:11pt;padding:6pt}
.xl-th{background:#f5f3ff;color:#4c1d95;font-weight:bold;border:1pt solid #e9d5ff;padding:5pt 8pt}
.xl-td{border:1pt solid #e5e7eb;padding:5pt 8pt}
.xl-even{background:#fafaf8}
.xl-good{color:#16a34a;font-weight:bold}
.xl-bad{color:#dc2626;font-weight:bold}
.xl-warn{color:#d97706;font-weight:bold}
.xl-num{font-size:13pt;font-weight:bold}
.xl-section{background:#ede9fe;font-weight:bold;color:#4c1d95;font-size:12pt;padding:6pt 8pt}
td{vertical-align:middle}
</style>
</head>
<body>
<table width="800" cellspacing="0">
  <!-- Шапка -->
  <tr><td colspan="4" class="xl-header">🤖 AI-отчёт: ${esc(title)}</td></tr>
  <tr><td colspan="4" class="xl-subheader">${esc(date)} · Модель: ${esc(model)} · Период: ${days} дней</td></tr>
  <tr><td colspan="4" style="height:12pt"></td></tr>

  <!-- Ключевые показатели -->
  <tr><td colspan="4" class="xl-section">📊 КЛЮЧЕВЫЕ ПОКАЗАТЕЛИ</td></tr>
  <tr>
    <td class="xl-th" width="200">Показатель</td>
    <td class="xl-th" width="120">Значение</td>
    <td class="xl-th" width="100">Доля (%)</td>
    <td class="xl-th" width="200">Оценка</td>
  </tr>
  <tr>
    <td class="xl-td">📋 Всего направлений</td>
    <td class="xl-td xl-num">${stats.referrals_total}</td>
    <td class="xl-td">—</td>
    <td class="xl-td">за ${days} дней</td>
  </tr>
  <tr class="xl-even">
    <td class="xl-td">✅ Подтверждено</td>
    <td class="xl-td xl-good xl-num">${stats.referrals_confirmed}</td>
    <td class="xl-td xl-good">${stats.conversion_rate_pct}%</td>
    <td class="xl-td xl-good">${stats.conversion_rate_pct >= 50 ? 'Хорошо' : stats.conversion_rate_pct >= 30 ? 'Средне' : 'Требует внимания'}</td>
  </tr>
  <tr>
    <td class="xl-td">❌ Отменено</td>
    <td class="xl-td xl-bad xl-num">${stats.referrals_cancelled}</td>
    <td class="xl-td xl-bad">${stats.cancel_rate_pct}%</td>
    <td class="xl-td ${stats.cancel_rate_pct <= 10 ? 'xl-good' : 'xl-warn'}">${stats.cancel_rate_pct <= 10 ? 'Норма' : 'Внимание'}</td>
  </tr>
  <tr class="xl-even">
    <td class="xl-td">⏱ Истекло</td>
    <td class="xl-td xl-num" style="color:#94a3b8">${stats.referrals_expired}</td>
    <td class="xl-td" style="color:#94a3b8">${stats.expire_rate_pct}%</td>
    <td class="xl-td ${stats.expire_rate_pct <= 15 ? 'xl-good' : 'xl-warn'}">${stats.expire_rate_pct <= 15 ? 'Норма' : 'Внимание'}</td>
  </tr>
  <tr>
    <td class="xl-td">⏳ В ожидании</td>
    <td class="xl-td xl-num">${stats.referrals_pending}</td>
    <td class="xl-td">—</td>
    <td class="xl-td">—</td>
  </tr>
  <tr class="xl-even">
    <td class="xl-td">👥 Сотрудников</td>
    <td class="xl-td xl-num">${stats.staff_count}</td>
    <td class="xl-td">—</td>
    <td class="xl-td">—</td>
  </tr>
  <tr>
    <td class="xl-td">🏥 Клиник</td>
    <td class="xl-td xl-num">${stats.clinic_count}</td>
    <td class="xl-td">—</td>
    <td class="xl-td">—</td>
  </tr>

  <tr><td colspan="4" style="height:16pt"></td></tr>

  <!-- Доли -->
  <tr><td colspan="4" class="xl-section">📈 ПОКАЗАТЕЛИ КОНВЕРСИИ</td></tr>
  <tr>
    <td class="xl-th">Метрика</td><td class="xl-th">Значение %</td>
    <td class="xl-th">Количество</td><td class="xl-th">Из всего</td>
  </tr>
  <tr>
    <td class="xl-td">Конверсия (подтверждение)</td>
    <td class="xl-td xl-good xl-num">${stats.conversion_rate_pct}%</td>
    <td class="xl-td xl-good">${stats.referrals_confirmed}</td>
    <td class="xl-td">из ${stats.referrals_total}</td>
  </tr>
  <tr class="xl-even">
    <td class="xl-td">Отмена</td>
    <td class="xl-td xl-bad xl-num">${stats.cancel_rate_pct}%</td>
    <td class="xl-td xl-bad">${stats.referrals_cancelled}</td>
    <td class="xl-td">из ${stats.referrals_total}</td>
  </tr>
  <tr>
    <td class="xl-td">Истечение срока</td>
    <td class="xl-td xl-num" style="color:#94a3b8">${stats.expire_rate_pct}%</td>
    <td class="xl-td" style="color:#94a3b8">${stats.referrals_expired}</td>
    <td class="xl-td">из ${stats.referrals_total}</td>
  </tr>

  <tr><td colspan="4" style="height:16pt"></td></tr>

  <!-- AI текст -->
  <tr><td colspan="4" class="xl-section">🤖 AI АНАЛИЗ: ${esc(title)}</td></tr>
  ${result.split('\n').map(line => {
    if (!line.trim()) return '<tr><td colspan="4" style="height:6pt"></td></tr>'
    const clean = esc(line).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    if (line.match(/^#{1,3} /)) {
      return `<tr><td colspan="4" style="font-weight:bold;color:#4c1d95;font-size:12pt;padding:5pt 8pt;background:#f5f3ff">${clean.replace(/^#+\s+/, '')}</td></tr>`
    }
    return `<tr><td colspan="4" class="xl-td">${clean}</td></tr>`
  }).join('\n')}

  <tr><td colspan="4" style="height:16pt"></td></tr>
  <tr><td colspan="4" style="color:#94a3b8;font-size:9pt;padding:4pt 8pt">Отчёт сгенерирован: ${esc(date)} · Модель: ${esc(model)} · КлиникаСеть AI</td></tr>
</table>
</body>
</html>`

  const blob = new Blob(['﻿' + html], { type: 'application/vnd.ms-excel;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `ai_${data.type}_${new Date(data.generated_at).toISOString().slice(0, 10)}.xls`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Кнопки экспорта
function ExportButtons({ data, days, style = {} }) {
  const d = useD(); const c = P(d)
  if (!data) return null
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', ...style }}>
      <button
        onClick={() => exportPDF(data, days)}
        style={{
          background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8,
          padding: '7px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 700,
          display: 'flex', alignItems: 'center', gap: 5, transition: 'all 0.15s',
        }}
        title="Открыть PDF-отчёт с диаграммами для сохранения"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 15 }}>picture_as_pdf</span>
        PDF + диаграммы
      </button>
      <button
        onClick={() => exportExcel(data, days)}
        style={{
          background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8,
          padding: '7px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 700,
          display: 'flex', alignItems: 'center', gap: 5, transition: 'all 0.15s',
        }}
        title="Скачать Excel-таблицу с данными"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 15 }}>table_chart</span>
        Excel
      </button>
      <button
        onClick={() => {
          const el = document.createElement('a')
          el.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(data.result)
          el.download = `ai_${data.type}_${new Date(data.generated_at).toISOString().slice(0, 10)}.txt`
          el.click()
        }}
        style={{
          background: c.subtle, border: `1px solid ${c.border}`, borderRadius: 8,
          padding: '7px 14px', cursor: 'pointer', fontSize: 12,
          display: 'flex', alignItems: 'center', gap: 4, color: c.text2,
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>download</span>
        .txt
      </button>
    </div>
  )
}

// ── Spinner ───────────────────────────────────────────────────────────────────

function Spinner({ size = 36, text = 'AI анализирует...' }) {
  const d = useD()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '48px 0' }}>
      <div style={{
        width: size, height: size,
        border: `3px solid ${d ? '#4c1d95' : '#ede9fe'}`,
        borderTop: '3px solid #7c3aed',
        borderRadius: '50%',
        animation: 'aiSpin 0.7s linear infinite',
      }} />
      <span style={{ color: P(d).text3, fontSize: 13 }}>{text}</span>
      <style>{`@keyframes aiSpin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

// ── ErrBanner ─────────────────────────────────────────────────────────────────

function ErrBanner({ msg, onClose }) {
  const d = useD(); const c = P(d)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 16px', background: c.errBg, border: `1px solid ${c.errBorder}`, borderRadius: 10, color: c.errText, fontSize: 13 }}>
      <span className="material-symbols-outlined" style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>error_outline</span>
      <span style={{ flex: 1 }}>{msg}</span>
      {onClose && <span className="material-symbols-outlined" style={{ fontSize: 16, cursor: 'pointer', opacity: 0.6 }} onClick={onClose}>close</span>}
    </div>
  )
}

// ── PeriodPill ────────────────────────────────────────────────────────────────

function PeriodPill({ value, onChange }) {
  const d = useD(); const c = P(d)
  return (
    <div style={{ display: 'flex', background: c.pillBg, borderRadius: 20, padding: 3, gap: 2 }}>
      {[7, 14, 30, 90].map(n => (
        <button key={n} onClick={() => onChange(n)} style={{
          padding: '4px 14px', borderRadius: 16, fontSize: 12, fontWeight: 600, border: 'none',
          background: value === n ? c.pillActive : 'transparent',
          color: value === n ? '#7c3aed' : c.text2,
          cursor: 'pointer',
          boxShadow: value === n ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
          transition: 'all 0.15s',
        }}>{n}д</button>
      ))}
    </div>
  )
}

// ── Markdown-рендер ───────────────────────────────────────────────────────────

function renderInline(text) {
  return text.split(/(\*\*.*?\*\*)/).map((p, i) =>
    p.startsWith('**') && p.endsWith('**')
      ? <strong key={i} style={{ color: '#7c3aed' }}>{p.slice(2, -2)}</strong>
      : p
  )
}

function AIText({ text }) {
  const d = useD(); const c = P(d)
  if (!text) return null
  return (
    <div style={{ fontSize: 14, color: c.text1, lineHeight: 1.8 }}>
      {text.split('\n').map((line, i) => {
        if (!line.trim()) return <div key={i} style={{ height: 8 }} />
        if (line.startsWith('### ')) return <div key={i} style={{ fontWeight: 700, fontSize: 15, color: '#8b5cf6', marginTop: 16, marginBottom: 4 }}>{line.slice(4)}</div>
        if (line.startsWith('## '))  return <div key={i} style={{ fontWeight: 700, fontSize: 16, color: '#7c3aed', marginTop: 20, marginBottom: 6 }}>{line.slice(3)}</div>
        if (line.startsWith('# '))   return <div key={i} style={{ fontWeight: 800, fontSize: 18, color: '#6d28d9', marginTop: 24, marginBottom: 8 }}>{line.slice(2)}</div>
        const nm = line.match(/^(\d+)\.\s+\*\*(.+?)\*\*(.*)/)
        if (nm) return (
          <div key={i} style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <div style={{ width: 24, height: 24, background: '#7c3aed', color: '#fff', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>{nm[1]}</div>
            <div style={{ color: c.text1 }}><strong style={{ color: '#8b5cf6' }}>{nm[2]}</strong>{renderInline(nm[3])}</div>
          </div>
        )
        if (line.startsWith('- ') || line.startsWith('• ')) return (
          <div key={i} style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <div style={{ width: 6, height: 6, background: '#7c3aed', borderRadius: '50%', marginTop: 8, flexShrink: 0 }} />
            <div style={{ color: c.text1 }}>{renderInline(line.slice(2))}</div>
          </div>
        )
        return <div key={i} style={{ color: c.text1 }}>{renderInline(line)}</div>
      })}
    </div>
  )
}

// ── Баланс-виджет ─────────────────────────────────────────────────────────────

function BalanceBar({ token, modelInfo }) {
  const d = useD(); const c = P(d)
  const [balance, setBalance] = useState(null)
  const [loading, setLoading] = useState(true)

  function reload() {
    setLoading(true)
    apiFetch(token, '/ai/balance')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setBalance(data) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    reload()
    const id = setInterval(reload, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [token])

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '10px 16px', background: c.balBg, border: `1px solid ${c.balBorder}`, borderRadius: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="material-symbols-outlined" style={{ color: '#7c3aed', fontSize: 18 }}>smart_toy</span>
        <span style={{ fontWeight: 700, fontSize: 13, color: d ? '#c4b5fd' : '#4c1d95' }}>{modelInfo?.provider?.toUpperCase() || 'AI'}</span>
        {modelInfo?.selected && (
          <span style={{ background: '#7c3aed', color: '#fff', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 8 }}>
            {modelInfo.models?.find(m => m.id === modelInfo.selected)?.name || modelInfo.selected}
          </span>
        )}
      </div>
      <div style={{ width: 1, height: 20, background: c.balBorder }} />
      {loading ? (
        <span style={{ fontSize: 12, color: c.text3 }}>загрузка баланса...</span>
      ) : balance?.available ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16, color: (balance.balance ?? 0) > 5 ? '#16a34a' : '#dc2626' }}>account_balance_wallet</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: (balance.balance ?? 0) > 5 ? '#16a34a' : '#dc2626' }}>${fmt(balance.balance)} {balance.unit}</span>
            <span style={{ fontSize: 11, color: c.text2 }}>баланс</span>
          </div>
          {balance.today?.requests > 0 && (
            <>
              <div style={{ width: 1, height: 16, background: c.balBorder }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: c.text2 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>today</span>
                сегодня: <strong style={{ color: c.text1 }}>{balance.today.requests} зап.</strong>
                · <strong style={{ color: c.text1 }}>${fmt(balance.today.actual_cost)}</strong>
                · <strong style={{ color: c.text1 }}>{fmtNum(balance.today.total_tokens)} tok</strong>
              </div>
            </>
          )}
          <button onClick={reload} title="Обновить баланс" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', borderRadius: 6, display: 'flex', alignItems: 'center' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 15, color: c.text3 }}>refresh</span>
          </button>
        </>
      ) : (
        <span style={{ fontSize: 12, color: c.text3 }}>баланс недоступен</span>
      )}
    </div>
  )
}

// ── Карточки сценариев ────────────────────────────────────────────────────────

const ANALYSIS_TYPES = [
  { type: 'overview',  icon: 'dashboard',       label: 'Общий обзор',   color: '#7c3aed', desc: 'Инсайты по всей клинике' },
  { type: 'services',  icon: 'medical_services', label: 'Услуги',        color: '#0891b2', desc: 'Эффективность по услугам' },
  { type: 'staff',     icon: 'people',           label: 'Сотрудники',    color: '#059669', desc: 'Производительность команды' },
  { type: 'clinics',   icon: 'local_hospital',   label: 'Клиники',       color: '#d97706', desc: 'Сравнение филиалов' },
  { type: 'bonuses',   icon: 'payments',         label: 'Бонусы',        color: '#dc2626', desc: 'Мотивационная система' },
  { type: 'forecast',  icon: 'trending_up',      label: 'Прогноз',       color: '#7c3aed', desc: 'Стратегия на следующий период' },
]

function AnalysisCard({ item, active, onClick, loading }) {
  const d = useD(); const c = P(d)
  const isActive = active === item.type
  const isLoading = loading === item.type
  return (
    <button onClick={() => onClick(item.type)} disabled={isLoading} style={{
      background: isActive ? item.color : c.card,
      border: `2px solid ${isActive ? item.color : c.cardBorder}`,
      borderRadius: 14, padding: '16px 14px', cursor: 'pointer',
      textAlign: 'left', transition: 'all 0.15s',
      boxShadow: isActive ? `0 4px 14px ${item.color}30` : `0 1px 3px rgba(0,0,0,${d ? 0.2 : 0.05})`,
      opacity: isLoading ? 0.7 : 1,
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {isLoading
          ? <div style={{ width: 20, height: 20, border: '2px solid #fff', borderTop: '2px solid transparent', borderRadius: '50%', animation: 'aiSpin 0.7s linear infinite' }} />
          : <span className="material-symbols-outlined" style={{ fontSize: 22, color: isActive ? '#fff' : item.color }}>{item.icon}</span>
        }
        <span style={{ fontWeight: 700, fontSize: 13, color: isActive ? '#fff' : c.text1 }}>{item.label}</span>
      </div>
      <span style={{ fontSize: 11, color: isActive ? 'rgba(255,255,255,0.8)' : c.text3, lineHeight: 1.4 }}>{item.desc}</span>
    </button>
  )
}

// ── Вкладка: Аналитика ────────────────────────────────────────────────────────

function AnalyticsTab({ token, onGoToSettings, isSuperAdmin }) {
  const d = useD(); const c = P(d)
  const [days, setDays] = useState(30)
  const [active, setActive] = useState(null)
  const [loading, setLoading] = useState(null)
  const [results, setResults] = useState({})
  const [err, setErr] = useState('')
  const [notCfg, setNotCfg] = useState(false)

  const run = useCallback(async (type) => {
    setErr(''); setNotCfg(false); setActive(type); setLoading(type)
    try {
      const r = await apiFetch(token, `/ai/analyze?type=${type}&days=${days}`)
      if (r.status === 501) { setNotCfg(true); setLoading(null); return }
      if (!r.ok) { const data = await r.json(); setErr(data.detail?.message || data.detail || 'Ошибка'); setLoading(null); return }
      const data = await r.json()
      setResults(prev => ({ ...prev, [type]: data }))
    } catch { setErr('Сетевая ошибка') }
    setLoading(null)
  }, [token, days])

  const current = active ? results[active] : null

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: c.text2, fontWeight: 500 }}>Выберите сценарий анализа:</div>
        <PeriodPill value={days} onChange={(n) => { setDays(n); setResults({}) }} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 24 }}>
        {ANALYSIS_TYPES.map(item => (
          <AnalysisCard key={item.type} item={item} active={active} onClick={run} loading={loading} />
        ))}
      </div>

      {notCfg && (
        <div style={{ background: c.notCfgBg, border: `1px dashed ${c.notCfgBorder}`, borderRadius: 12, padding: 28, textAlign: 'center' }}>
          <span className="material-symbols-outlined" style={{ fontSize: 40, color: '#7c3aed', display: 'block', marginBottom: 8 }}>auto_awesome</span>
          <div style={{ fontWeight: 700, color: d ? '#c4b5fd' : '#4c1d95', marginBottom: 6 }}>AI не настроен</div>
          <div style={{ fontSize: 13, color: c.text2, marginBottom: 12 }}>Добавьте конфиг провайдера в разделе «Настройки»</div>
          {isSuperAdmin && <button onClick={onGoToSettings} style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>Настроить AI</button>}
        </div>
      )}
      {err && <ErrBanner msg={err} onClose={() => setErr('')} />}

      {loading && <Spinner text={`Анализирую: ${ANALYSIS_TYPES.find(t => t.type === loading)?.label}...`} />}

      {current && !loading && (
        <div style={{ background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 16, boxShadow: `0 4px 20px rgba(0,0,0,${d ? 0.3 : 0.06})`, overflow: 'hidden' }}>
          <div style={{
            padding: '16px 20px', borderBottom: `1px solid ${c.cardBorder}`,
            background: d ? '#1e1b4b' : 'linear-gradient(135deg, #faf5ff, #f3e8ff)',
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          }}>
            <span className="material-symbols-outlined" style={{ color: ANALYSIS_TYPES.find(t => t.type === active)?.color, fontSize: 22 }}>
              {ANALYSIS_TYPES.find(t => t.type === active)?.icon}
            </span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: d ? '#e9d5ff' : '#1e293b' }}>{current.title}</div>
              <div style={{ fontSize: 11, color: c.text3 }}>за {days} дней · {current.model} · {new Date(current.generated_at).toLocaleString('ru-RU')}</div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 16, fontSize: 12, color: c.text2, flexWrap: 'wrap' }}>
              <span><strong style={{ color: c.text1 }}>{current.stats.referrals_total}</strong> направлений</span>
              <span><strong style={{ color: '#16a34a' }}>{current.stats.conversion_rate_pct}%</strong> конверсия</span>
            </div>
          </div>
          <div style={{ padding: '20px 24px' }}>
            <AIText text={current.result} />
          </div>
          <div style={{ padding: '12px 24px 16px', borderTop: `1px solid ${c.cardBorder}`, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button onClick={() => run(active)} style={{ background: c.subtle, border: `1px solid ${c.border}`, borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, color: c.text2 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>refresh</span>
              Перезапустить
            </button>
            <div style={{ width: 1, height: 20, background: c.border }} />
            <ExportButtons data={current} days={days} />
          </div>
        </div>
      )}

      {!active && !notCfg && !err && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: c.text3 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 56, display: 'block', marginBottom: 12 }}>auto_awesome</span>
          <div style={{ fontSize: 14 }}>Выберите сценарий выше для запуска AI-анализа</div>
        </div>
      )}
    </div>
  )
}

// ── Вкладка: Q&A чат ──────────────────────────────────────────────────────────

const QUICK_QUESTIONS = [
  'Почему так много направлений истекает без подтверждения?',
  'Какие услуги приносят больше всего подтверждённых пациентов?',
  'Как повысить конверсию направлений до 50%?',
  'Какой сотрудник наиболее эффективен и почему?',
  'В чём причина высокого процента отмен?',
  'Как сравнить эффективность клиник между собой?',
  'Какую стратегию мотивации персонала вы рекомендуете?',
]

function QATab({ token, onGoToSettings, isSuperAdmin }) {
  const d = useD(); const c = P(d)
  const [question, setQuestion] = useState('')
  const [days, setDays] = useState(30)
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [notCfg, setNotCfg] = useState(false)
  const bottomRef = useRef(null)

  const ask = useCallback(async (q = question) => {
    const txt = (q || question).trim()
    if (!txt) return
    setQuestion(''); setErr(''); setNotCfg(false)
    setMessages(prev => [...prev, { role: 'user', text: txt, ts: new Date().toISOString() }])
    setLoading(true)
    try {
      const r = await apiFetch(token, '/ai/ask', { method: 'POST', body: JSON.stringify({ question: txt, days }) })
      if (r.status === 501) { setNotCfg(true); setLoading(false); return }
      if (!r.ok) { const data = await r.json(); setErr(data.detail?.message || data.detail || 'Ошибка'); setLoading(false); return }
      const data = await r.json()
      setMessages(prev => [...prev, { role: 'assistant', text: data.answer, model: data.model, ts: data.generated_at }])
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
    } catch { setErr('Сетевая ошибка') }
    setLoading(false)
  }, [token, question, days])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {messages.length === 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: c.text3, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Популярные вопросы</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {QUICK_QUESTIONS.map(q => (
              <button key={q} onClick={() => ask(q)} style={{ padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 500, border: `1px solid ${c.border}`, background: c.card, color: c.text2, cursor: 'pointer' }}>{q}</button>
            ))}
          </div>
        </div>
      )}
      {messages.length > 0 && (
        <div style={{ background: c.chatBg, borderRadius: 14, border: `1px solid ${c.chatBorder}`, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 420, overflowY: 'auto' }}>
          {messages.map((m, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, flexDirection: m.role === 'user' ? 'row-reverse' : 'row' }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, background: m.role === 'user' ? (d ? '#334155' : '#e2e8f0') : '#7c3aed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16, color: m.role === 'user' ? c.text2 : '#fff' }}>{m.role === 'user' ? 'person' : 'smart_toy'}</span>
              </div>
              <div style={{ maxWidth: '80%' }}>
                <div style={{ padding: '10px 14px', borderRadius: m.role === 'user' ? '14px 4px 14px 14px' : '4px 14px 14px 14px', background: m.role === 'user' ? '#7c3aed' : c.msgAiBg, border: m.role === 'user' ? 'none' : `1px solid ${c.msgAiBorder}`, boxShadow: `0 1px 3px rgba(0,0,0,${d ? 0.3 : 0.06})` }}>
                  {m.role === 'user' ? <div style={{ fontSize: 14, color: '#fff' }}>{m.text}</div> : <AIText text={m.text} />}
                </div>
                <div style={{ fontSize: 10, color: c.text3, marginTop: 3, textAlign: m.role === 'user' ? 'right' : 'left' }}>
                  {new Date(m.ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}{m.model && ` · ${m.model}`}
                </div>
              </div>
            </div>
          ))}
          {loading && (
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#7c3aed', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#fff' }}>smart_toy</span>
              </div>
              <div style={{ padding: '12px 16px', background: c.msgAiBg, borderRadius: '4px 14px 14px 14px', border: `1px solid ${c.msgAiBorder}` }}>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  {[0, 1, 2].map(j => <div key={j} style={{ width: 6, height: 6, background: '#c4b5fd', borderRadius: '50%', animation: `dotBounce 1.2s ${j * 0.2}s ease-in-out infinite` }} />)}
                </div>
                <style>{`@keyframes dotBounce{0%,80%,100%{opacity:0.3;transform:scale(0.8)}40%{opacity:1;transform:scale(1)}}`}</style>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      )}
      {messages.length > 0 && (
        <button onClick={() => setMessages([])} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: c.text3, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>delete_outline</span>Очистить чат
        </button>
      )}
      {notCfg && <div style={{ background: c.notCfgBg, border: `1px dashed ${c.notCfgBorder}`, borderRadius: 12, padding: 20, textAlign: 'center' }}>
        <div style={{ fontWeight: 700, color: d ? '#c4b5fd' : '#4c1d95', marginBottom: 6 }}>AI не настроен</div>
        {isSuperAdmin && <button onClick={onGoToSettings} style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 18px', cursor: 'pointer', fontSize: 13 }}>Настроить</button>}
      </div>}
      {err && <ErrBanner msg={err} onClose={() => setErr('')} />}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
        <textarea value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask() } }}
          placeholder="Задайте вопрос... (Enter — отправить, Shift+Enter — новая строка)" rows={2}
          style={{ flex: 1, padding: '10px 14px', border: `1px solid ${c.inputBorder}`, borderRadius: 12, fontSize: 14, resize: 'none', fontFamily: 'inherit', outline: 'none', background: c.inputBg, color: c.text1 }}
          onFocus={e => e.target.style.borderColor = '#7c3aed'} onBlur={e => e.target.style.borderColor = c.inputBorder} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <PeriodPill value={days} onChange={setDays} />
          <button onClick={() => ask()} disabled={loading || !question.trim()} style={{ background: loading || !question.trim() ? c.border : '#7c3aed', color: loading || !question.trim() ? c.text3 : '#fff', border: 'none', borderRadius: 10, padding: '10px 20px', cursor: loading || !question.trim() ? 'default' : 'pointer', fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>send</span>
            {loading ? '...' : 'Спросить'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Вкладка: История ──────────────────────────────────────────────────────────

function HistoryTab({ token }) {
  const d = useD(); const c = P(d)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)

  useEffect(() => {
    apiFetch(token, '/ai/history')
      .then(r => r.ok ? r.json() : { history: [] })
      .then(data => setHistory(data.history || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [token])

  if (loading) return <Spinner text="Загрузка истории..." />
  if (history.length === 0) return (
    <div style={{ textAlign: 'center', padding: '48px 0', color: c.text3 }}>
      <span className="material-symbols-outlined" style={{ fontSize: 52, display: 'block', marginBottom: 12 }}>history</span>
      <div style={{ fontSize: 14 }}>История пока пуста</div>
      <div style={{ fontSize: 12, marginTop: 6 }}>Запускайте AI-анализы — они сохраняются автоматически</div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 13, color: c.text2, marginBottom: 4 }}>Последние {history.length} анализов — кликните для просмотра и экспорта</div>
      {history.map((entry, i) => {
        const typeInfo = ANALYSIS_TYPES.find(t => t.type === entry.type)
        const isOpen = expanded === i
        return (
          <div key={i} style={{ background: c.card, border: `1px solid ${isOpen ? '#7c3aed' : c.cardBorder}`, borderRadius: 12, overflow: 'hidden', transition: 'all 0.15s' }}>
            <button onClick={() => setExpanded(isOpen ? null : i)} style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 20, color: typeInfo?.color || '#7c3aed', flexShrink: 0 }}>{typeInfo?.icon || 'auto_awesome'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: c.text1 }}>{entry.title}</div>
                <div style={{ fontSize: 11, color: c.text3, marginTop: 2 }}>{new Date(entry.generated_at).toLocaleString('ru-RU')} · {entry.model} · {entry.stats?.period_days}д</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>{entry.stats?.conversion_rate_pct}% конв.</span>
                <span className="material-symbols-outlined" style={{ fontSize: 18, color: c.text3, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>expand_more</span>
              </div>
            </button>
            {isOpen && (
              <div style={{ padding: '0 18px 18px', borderTop: `1px solid ${c.cardBorder}` }}>
                <div style={{ paddingTop: 14 }}>
                  <AIText text={entry.result} />
                </div>
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${c.cardBorder}` }}>
                  <ExportButtons data={entry} days={entry.stats?.period_days || 30} />
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Вкладка: Настройки ────────────────────────────────────────────────────────

function SettingsTab({ token }) {
  const d = useD(); const c = P(d)
  const [rawJson, setRawJson] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
  const [models, setModels] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [jsonErr, setJsonErr] = useState('')

  useEffect(() => {
    let mounted = true
    Promise.all([
      apiFetch(token, '/ai/config').then(r => r.ok ? r.json() : null),
      apiFetch(token, '/ai/models').then(r => r.ok ? r.json() : null),
    ]).then(([cfg, mods]) => {
      if (!mounted) return
      if (cfg?.config && Object.keys(cfg.config).length > 0) { const cl = { ...cfg.config }; delete cl._meta; setRawJson(JSON.stringify(cl, null, 2)) }
      if (mods) { setModels(mods.models || []); if (mods.selected) setSelectedModel(mods.selected) }
    }).catch(() => {}).finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [token])

  const handleJson = val => { setRawJson(val); setJsonErr(''); if (val.trim()) { try { JSON.parse(val) } catch (e) { setJsonErr(e.message) } } }
  const save = async () => {
    setJsonErr(''); setMsg(null)
    let parsed; try { parsed = JSON.parse(rawJson) } catch (e) { setJsonErr(e.message); return }
    setSaving(true)
    try {
      const r = await apiFetch(token, '/ai/config', { method: 'POST', body: JSON.stringify({ config: parsed, selected_model: selectedModel || null }) })
      if (r.ok) { setMsg({ ok: true, text: 'Конфиг сохранён.' }); const mr = await apiFetch(token, '/ai/models'); if (mr.ok) { const md = await mr.json(); setModels(md.models || []); if (md.selected) setSelectedModel(md.selected) } }
      else { const data = await r.json(); setMsg({ ok: false, text: data.detail || 'Ошибка' }) }
    } catch { setMsg({ ok: false, text: 'Сетевая ошибка' }) }
    setSaving(false)
  }

  if (loading) return <Spinner text="Загрузка конфига..." />

  return (
    <div style={{ maxWidth: 820, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ background: c.infoBg, border: `1px solid ${c.infoBorder}`, borderRadius: 12, padding: '14px 18px', fontSize: 13, color: c.infoText }}>
        <strong>Формат конфига</strong> совместим с <code style={{ background: c.codeBg, padding: '1px 5px', borderRadius: 4 }}>opencode.ai</code>.
        Поле <code style={{ background: c.codeBg, padding: '1px 5px', borderRadius: 4 }}>provider.openai.options</code> должно содержать <code>baseURL</code> и <code>apiKey</code>.
      </div>
      <div>
        <label style={{ display: 'block', fontWeight: 700, fontSize: 13, color: c.text1, marginBottom: 8 }}>JSON-конфиг провайдера</label>
        <textarea value={rawJson} onChange={e => handleJson(e.target.value)} rows={18}
          placeholder={'{\n  "provider": {\n    "openai": {\n      "options": { "baseURL": "https://...", "apiKey": "sk-..." },\n      "models": { "model-id": { "name": "Model Name" } }\n    }\n  }\n}'}
          style={{ width: '100%', padding: '12px 14px', border: `1.5px solid ${jsonErr ? '#ef4444' : c.inputBorder}`, borderRadius: 10, fontSize: 12, fontFamily: 'monospace', resize: 'vertical', background: c.subtle, color: c.text1, lineHeight: 1.65, boxSizing: 'border-box', outline: 'none' }}
          onFocus={e => !jsonErr && (e.target.style.borderColor = '#7c3aed')} onBlur={e => !jsonErr && (e.target.style.borderColor = c.inputBorder)} />
        {jsonErr && <div style={{ color: '#dc2626', fontSize: 12, marginTop: 5, display: 'flex', gap: 4, alignItems: 'center' }}><span className="material-symbols-outlined" style={{ fontSize: 14 }}>error</span>JSON: {jsonErr}</div>}
      </div>
      {models.length > 0 && (
        <div>
          <label style={{ display: 'block', fontWeight: 700, fontSize: 13, color: c.text1, marginBottom: 8 }}>Активная модель</label>
          <select value={selectedModel} onChange={e => setSelectedModel(e.target.value)} style={{ padding: '10px 14px', border: `1.5px solid ${c.inputBorder}`, borderRadius: 10, fontSize: 14, background: c.inputBg, color: c.text1, cursor: 'pointer', minWidth: 360, outline: 'none' }}>
            {models.map(m => <option key={m.id} value={m.id}>{m.name} · {m.id}{m.context ? ` · ctx ${(m.context / 1000).toFixed(0)}k` : ''}</option>)}
          </select>
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button onClick={save} disabled={saving || !!jsonErr || !rawJson.trim()} style={{ background: saving || !!jsonErr || !rawJson.trim() ? c.border : '#7c3aed', color: saving || !!jsonErr || !rawJson.trim() ? c.text3 : '#fff', border: 'none', borderRadius: 10, padding: '10px 28px', cursor: 'pointer', fontWeight: 700, fontSize: 14 }}>
          {saving ? 'Сохраняю...' : 'Сохранить конфиг'}
        </button>
        <button onClick={() => { setRawJson(''); setJsonErr(''); setModels([]); setSelectedModel(''); setMsg(null) }} style={{ background: c.card, border: `1.5px solid ${c.border}`, borderRadius: 10, padding: '10px 20px', cursor: 'pointer', color: '#dc2626', fontWeight: 600, fontSize: 13 }}>Очистить</button>
      </div>
      {msg && <div style={{ padding: '12px 16px', borderRadius: 10, background: msg.ok ? '#f0fdf4' : c.errBg, border: `1px solid ${msg.ok ? '#bbf7d0' : c.errBorder}`, color: msg.ok ? '#166534' : c.errText, fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{msg.ok ? 'check_circle' : 'error'}</span>{msg.text}
      </div>}
      {models.length > 0 && (
        <div style={{ background: c.subtle, borderRadius: 12, border: `1px solid ${c.cardBorder}`, padding: '16px 20px' }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: c.text1, marginBottom: 12 }}>Доступные модели</div>
          {models.map(m => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: m.id === selectedModel ? (d ? '#1e1b4b' : '#faf5ff') : 'transparent', border: `1px solid ${m.id === selectedModel ? (d ? '#4c1d95' : '#e9d5ff') : 'transparent'}`, marginBottom: 6 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16, color: m.id === selectedModel ? '#7c3aed' : c.text3 }}>{m.id === selectedModel ? 'radio_button_checked' : 'radio_button_unchecked'}</span>
              <span style={{ fontWeight: m.id === selectedModel ? 700 : 500, color: m.id === selectedModel ? (d ? '#c4b5fd' : '#4c1d95') : c.text1, fontSize: 13 }}>{m.name}</span>
              <span style={{ color: c.text3, fontSize: 11 }}>{m.id}</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                {m.context && <span style={{ fontSize: 11, color: c.text2, background: c.pillBg, padding: '2px 8px', borderRadius: 8 }}>ctx {(m.context / 1000).toFixed(0)}k</span>}
                {m.output && <span style={{ fontSize: 11, color: c.text2, background: c.pillBg, padding: '2px 8px', borderRadius: 8 }}>out {(m.output / 1000).toFixed(0)}k</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Главный компонент ─────────────────────────────────────────────────────────

const TABS = [
  { key: 'analytics', label: 'Аналитика', icon: 'auto_awesome' },
  { key: 'qa',        label: 'Q&A',       icon: 'chat_bubble_outline' },
  { key: 'history',   label: 'История',   icon: 'history' },
  { key: 'settings',  label: 'Настройки', icon: 'settings', superOnly: true },
]

export default function AISection({ token, isSuperAdmin }) {
  const dark = useIsDark()
  const [tab, setTab] = useState('analytics')
  const [modelInfo, setModelInfo] = useState(null)
  const c = P(dark)

  useEffect(() => {
    apiFetch(token, '/ai/models').then(r => r.ok ? r.json() : null).then(d => { if (d) setModelInfo(d) }).catch(() => {})
  }, [token])

  const goToSettings = () => setTab('settings')
  const visibleTabs = TABS.filter(t => !t.superOnly || isSuperAdmin)

  return (
    <DarkCtx.Provider value={dark}>
      <div style={{ padding: '24px 28px', maxWidth: 980, margin: '0 auto' }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span className="material-symbols-outlined" style={{ color: '#7c3aed', fontSize: 30 }}>auto_awesome</span>
            <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: c.text1 }}>AI-аналитика</h2>
          </div>
          <BalanceBar token={token} modelInfo={modelInfo} />
        </div>
        <div style={{ display: 'flex', gap: 2, marginBottom: 24, borderBottom: `2px solid ${c.cardBorder}` }}>
          {visibleTabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{ padding: '10px 22px', border: 'none', background: 'none', cursor: 'pointer', borderBottom: `2px solid ${tab === t.key ? '#7c3aed' : 'transparent'}`, color: tab === t.key ? '#7c3aed' : c.text2, fontWeight: tab === t.key ? 700 : 500, fontSize: 14, marginBottom: -2, display: 'flex', alignItems: 'center', gap: 6, transition: 'color 0.15s' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 17 }}>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
        {tab === 'analytics' && <AnalyticsTab token={token} onGoToSettings={goToSettings} isSuperAdmin={isSuperAdmin} />}
        {tab === 'qa'        && <QATab        token={token} onGoToSettings={goToSettings} isSuperAdmin={isSuperAdmin} />}
        {tab === 'history'   && <HistoryTab   token={token} />}
        {tab === 'settings'  && isSuperAdmin  && <SettingsTab token={token} />}
      </div>
    </DarkCtx.Provider>
  )
}
