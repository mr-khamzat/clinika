/**
 * ========================================
 * БЛОК: phoneActions — единые действия по телефону
 * ========================================
 * Универсальные хелперы для интеграции с Calls (Electron) и обычным браузером.
 *
 * - callPhone(phone)      — открывает Calls deep-link или tel:
 * - whatsappPhone(phone)  — открывает https://wa.me/{phone} (внешний браузер из Calls)
 * - telHref(phone)        — строит href для <a>
 * - waHref(phone)         — строит href для <a>
 * - cleanPhone(phone)     — выкусывает только цифры
 *
 * Поддержка Electron-окружения (Clinikset Calls):
 *   window.clinikset.isElectron === true
 *   window.clinikset.shell.openExternal(url)
 * ========================================
 */

/** Возвращает только цифры из строки (нужно для wa.me/E.164) */
export function cleanPhone(phone) {
  return String(phone || '').replace(/\D/g, '')
}

/** href для tel:-ссылки (без пробелов, плюс сохраняем) */
export function telHref(phone) {
  if (!phone) return ''
  const norm = String(phone).trim().replace(/\s/g, '')
  return `tel:${norm}`
}

/** href для WhatsApp wa.me (только цифры) */
export function waHref(phone) {
  const c = cleanPhone(phone)
  return c ? `https://wa.me/${c}` : ''
}

/**
 * href для WhatsApp wa.me с предзаполненным текстом.
 * Использует click-to-chat URL (без WhatsApp Business API).
 * Регистратор кликает → открывается WhatsApp с набранным сообщением → жмёт «отправить».
 */
export function waHrefWithText(phone, text) {
  const c = cleanPhone(phone)
  if (!c) return ''
  const t = encodeURIComponent(String(text || ''))
  return `https://wa.me/${c}${t ? '?text=' + t : ''}`
}

/**
 * Звонок по номеру.
 * Если открыто в Calls (Electron) — пробуем deep-link clinikset://call?phone=...
 * Иначе — стандартный tel:
 */
export function callPhone(phone) {
  if (!phone) return
  const isElectron = !!(typeof window !== 'undefined' && window.clinikset?.isElectron)
  if (isElectron) {
    try {
      window.location.href = `clinikset://call?phone=${encodeURIComponent(phone)}`
      return
    } catch { /* fallback ниже */ }
  }
  try {
    window.location.href = telHref(phone)
  } catch { /* noop */ }
}

/**
 * Открыть WhatsApp.
 * В Electron — через shell.openExternal (внешний браузер).
 * В вебе — window.open.
 */
export function whatsappPhone(phone, text) {
  const url = text ? waHrefWithText(phone, text) : waHref(phone)
  if (!url) return
  const isElectron = !!(typeof window !== 'undefined' && window.clinikset?.isElectron)
  if (isElectron && typeof window.clinikset.shell?.openExternal === 'function') {
    try {
      window.clinikset.shell.openExternal(url)
      return
    } catch { /* fallback ниже */ }
  }
  try {
    window.open(url, '_blank', 'noopener,noreferrer')
  } catch { /* noop */ }
}

/** Печать визита/QR через дочернее окно (fallback когда нет /visit-pdf endpoint) */
export function printVisit({ patient_name, patient_phone, qr_code, doctor_name, date, time, clinic_name } = {}) {
  const w = window.open('', '_blank', 'width=420,height=600')
  if (!w) return
  const safe = (s) => String(s || '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]))
  const qrTag = qr_code
    ? `<img src="data:image/png;base64,${qr_code}" alt="QR"/>`
    : ''
  w.document.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Визит</title>
<style>
body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;text-align:center;padding:24px;color:#0f172a}
h2{margin:8px 0}
.muted{color:#64748b;font-size:13px}
img{width:280px;height:280px;border:1px solid #e2e8f0;border-radius:12px;padding:12px;background:#fff;margin:16px auto;display:block}
.row{margin:6px 0}
@media print{body{padding:0}}
</style></head><body>
<h2>${safe(patient_name || patient_phone || '—')}</h2>
${doctor_name ? `<div class="row"><b>Врач:</b> ${safe(doctor_name)}</div>` : ''}
${clinic_name ? `<div class="row"><b>Клиника:</b> ${safe(clinic_name)}</div>` : ''}
${date || time ? `<div class="row"><b>Когда:</b> ${safe(date || '')} ${safe(time || '')}</div>` : ''}
${qrTag}
<div class="muted">Распечатано из Clinika</div>
<script>setTimeout(()=>{window.print();},200);window.onafterprint=()=>window.close();</script>
</body></html>`)
  w.document.close()
}
