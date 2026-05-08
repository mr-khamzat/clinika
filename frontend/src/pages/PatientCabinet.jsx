import { useEffect, useState, useCallback, useRef, lazy, Suspense } from 'react'
import axios from 'axios'
import { API_BASE, BASE_PATH, SLUG } from '../config'
// Дизайн-система: Card/Button/Chip/Tabs/EmptyState/Modal + хуки уведомлений
import { Card, Button, Chip, Tabs, EmptyState, Modal, useToast, useConfirm } from '../design'
// Единый хук переключения темы (общий с другими кабинетами)
import useTheme from '../lib/useTheme'
// Telegram Web App SDK — динамическая загрузка (только в /p/, не в глобальном index.html)
import { loadTelegramSDK } from '../lib/tg'

// Лениво подгружаемые вкладки кабинета (записи, медкарта, документы, рецепты, витальные)
const AppointmentsTab  = lazy(() => import('../sections/patient/AppointmentsTab'))
const MedCardTab       = lazy(() => import('../sections/patient/MedCardTab'))
const DocumentsTab     = lazy(() => import('../sections/patient/DocumentsTab'))
const PrescriptionsTab = lazy(() => import('../sections/patient/PrescriptionsTab'))
const VitalsTab        = lazy(() => import('../sections/patient/VitalsTab'))
// W6: AI-ассистент пациенту через Gemini — плавающий чат-виджет
const PatientAiWidget  = lazy(() => import('../sections/patient/PatientAiWidget'))

const API = API_BASE
const TOKEN_KEY   = 'clinika_patient_token'
const REF_KEY     = 'clinika_patient_ref'
const SESSION_KEY = 'clinika_patient_session'
const SLUG_KEY    = 'clinika_patient_slug'

// Сохраняем slug при каждом заходе в кабинет — это позволяет корню /
// сделать редирект сюда, если PWA-ярлык открылся в корневом scope.
if (typeof window !== 'undefined' && SLUG) {
  try { localStorage.setItem(SLUG_KEY, SLUG) } catch {}
}

// Подключаем PWA-манифест синхронно (до load) с актуальными параметрами:
//   ?t={patient_token} — если пациент пришёл по QR, бекенд сразу создаст session
//                        и впишет её в start_url. Иначе iOS закеширует manifest
//                        со старым start_url=/{slug}/p (без сессии).
//   ?s={session_token} — при повторных заходах из LS.
if (typeof document !== 'undefined' && SLUG) {
  try {
    const old = document.querySelector('link[rel="manifest"]')
    if (old) old.parentNode.removeChild(old)
    const params = new URLSearchParams({ slug: SLUG })
    const urlT = new URLSearchParams(window.location.search).get('t')
    const urlS = new URLSearchParams(window.location.search).get('s')
    const lsS = (() => { try { return localStorage.getItem('clinika_patient_session') } catch { return null } })()
    if (urlS) params.set('s', urlS)
    else if (lsS) params.set('s', lsS)
    else if (urlT) params.set('t', urlT)
    const link = document.createElement('link')
    link.rel = 'manifest'
    link.href = `${API_BASE}/portal/manifest.json?${params.toString()}`
    document.head.appendChild(link)
  } catch {}
  if (!document.querySelector('meta[name="apple-mobile-web-app-capable"]')) {
    const m1 = document.createElement('meta'); m1.name = 'apple-mobile-web-app-capable'; m1.content = 'yes'; document.head.appendChild(m1)
    const m2 = document.createElement('meta'); m2.name = 'apple-mobile-web-app-status-bar-style'; m2.content = 'black-translucent'; document.head.appendChild(m2)
    const m3 = document.createElement('meta'); m3.name = 'theme-color'; m3.content = '#0A2342'; document.head.appendChild(m3)
  }
}

// Перенацеливает <link rel="manifest"> на серверный manifest с session_token
// в start_url. iOS Safari читает manifest при «Add to Home Screen» → ярлык
// получит ссылку вида /{slug}/p?s={session}, и при открытии в standalone-mode
// (где LocalStorage отдельный) PatientCabinet заавтологинится по ?s.
function updateManifestStartUrl(sessionToken) {
  if (typeof document === 'undefined' || !SLUG) return
  try {
    let link = document.querySelector('link[rel="manifest"]')
    if (!link) {
      link = document.createElement('link')
      link.rel = 'manifest'
      document.head.appendChild(link)
    }
    const params = new URLSearchParams({ slug: SLUG })
    if (sessionToken) params.set('s', sessionToken)
    // Уникальный ts ломает iOS-кеш предыдущего манифеста
    params.set('v', String(Date.now()))
    link.href = `${API_BASE}/portal/manifest.json?${params.toString()}`
  } catch {}
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmt(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' })
}
function fmtMis(str) {
  if (!str) return '—'
  const m = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек']
  const [dp, tp] = str.split(' ')
  if (!dp) return str
  const [d, mo, y] = dp.split('.')
  return tp ? `${+d} ${m[+mo-1]} ${y}, ${tp}` : `${+d} ${m[+mo-1]} ${y}`
}

// ── Утилиты для премиум-фич ──────────────────────────────────────────────────
function digitsOnly(s) { return String(s||'').replace(/\D/g,'') }
function buildTel(phone) { return phone ? `tel:${String(phone).replace(/\s/g,'')}` : '' }
function buildWhatsApp(phone) {
  const d = digitsOnly(phone); if (!d) return ''
  return `https://wa.me/${d}`
}
function buildMapUrl(addr, lat, lng) {
  if (lat && lng) return `https://yandex.ru/maps/?ll=${lng},${lat}&pt=${lng},${lat}&z=16`
  return `https://yandex.ru/maps/?text=${encodeURIComponent(addr||'')}`
}
function hoursUntil(dateIso, hhmm) {
  if (!dateIso) return Infinity
  try {
    const t = (hhmm||'00:00').slice(0,5)
    const dt = new Date(`${dateIso}T${t}:00`)
    return (dt.getTime() - Date.now()) / 3600000
  } catch { return Infinity }
}

// ICS-файл (Add to Calendar) — генерируется на клиенте, скачивается через Blob
function downloadIcs(apt) {
  const date = apt.appointment_date
  const start = (apt.start_time||'').slice(0,5)
  const end = (apt.end_time||start||'').slice(0,5)
  if (!date || !start) return
  const dt = (d, t) => `${d.replace(/-/g,'')}T${t.replace(':','')}00`
  const uid = `apt-${apt.id}@clinika`
  const summary = `Приём: ${apt.doctor_name || 'Врач'}`
  const loc = [apt.clinic_name, apt.clinic_address].filter(Boolean).join(', ')
  const desc = apt.short_code ? `Код визита: ${apt.short_code}` : ''
  const ics = [
    'BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Clinika//RU','CALSCALE:GREGORIAN','METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dt(new Date().toISOString().slice(0,10), new Date().toISOString().slice(11,16))}`,
    `DTSTART:${dt(date, start)}`,
    `DTEND:${dt(date, end || start)}`,
    `SUMMARY:${summary}`,
    `LOCATION:${loc}`,
    `DESCRIPTION:${desc}`,
    'END:VEVENT','END:VCALENDAR',
  ].join('\r\n')
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = `appointment-${apt.id}.ics`
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 500)
}

function googleCalendarUrl(apt) {
  const date = apt.appointment_date
  const start = (apt.start_time||'').slice(0,5)
  const end = (apt.end_time||start||'').slice(0,5)
  if (!date || !start) return '#'
  const dt = (d, t) => `${d.replace(/-/g,'')}T${t.replace(':','')}00`
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Приём: ${apt.doctor_name || 'Врач'}`,
    dates: `${dt(date,start)}/${dt(date, end || start)}`,
    details: apt.short_code ? `Код визита: ${apt.short_code}` : '',
    location: [apt.clinic_name, apt.clinic_address].filter(Boolean).join(', '),
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

// "Чек" визита — открываем красивую HTML-страницу для печати/сохранения в PDF
// (window.print() поддерживает любые шрифты браузера, включая кириллицу).
// Принимает опциональный toast(message, level) для уведомлений вместо alert.
// TODO(W3): функция top-level — нет доступа к хуку useToast.
//   Передаём toast через notify-параметр из вызывающего компонента;
//   alert() остаётся как deep-fallback на случай вызова без notify.
function downloadVisitPdf(visit, patient, notify) {
  try {
    const services = Array.isArray(visit.services) ? visit.services : []
    let computed = 0
    services.forEach(s => { computed += parseFloat(s.value || s.price || 0) || 0 })
    const total = computed || visit.sum_value || 0
    const esc = (s) => String(s ?? '—').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]))
    const rows = services.map(s => `
      <tr>
        <td>${esc(s.title || '—')}${s.code ? `<div class="muted">Код: ${esc(s.code)}</div>` : ''}${s.profession_title ? `<div class="muted">${esc(s.profession_title)}</div>` : ''}</td>
        <td class="num">${(s.count || 1)} шт.</td>
        <td class="num">${(parseFloat(s.value || s.price || 0) || 0).toLocaleString('ru-RU')} ₽</td>
      </tr>`).join('')

    const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>Чек визита</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; margin: 0; padding: 32px; color: #1f2937; }
  .head { border-bottom: 2px solid #0097A7; padding-bottom: 16px; margin-bottom: 20px; }
  h1 { margin: 0 0 6px; font-size: 22px; color: #0A2342; }
  .meta { font-size: 13px; color: #6b7280; line-height: 1.6; }
  .meta b { color: #1f2937; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th { text-align: left; padding: 10px 8px; border-bottom: 1px solid #d1d5db; font-size: 12px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.5px; }
  td { padding: 12px 8px; border-bottom: 1px solid #e5e7eb; font-size: 13px; vertical-align: top; }
  td.num { text-align: right; white-space: nowrap; }
  .muted { font-size: 11px; color: #9ca3af; margin-top: 3px; }
  .total { margin-top: 20px; padding: 16px; background: #f0f9ff; border-radius: 12px; display: flex; justify-content: space-between; align-items: center; }
  .total span { font-size: 14px; color: #6b7280; }
  .total b { font-size: 20px; color: #0097A7; }
  .foot { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #9ca3af; text-align: center; }
  @media print { body { padding: 16px; } .noprint { display: none !important; } }
  .actions { margin-bottom: 20px; display: flex; gap: 8px; }
  .btn { padding: 10px 18px; background: #0097A7; color: #fff; border: 0; border-radius: 8px; font-size: 14px; cursor: pointer; font-weight: 600; }
  .btn-secondary { background: #e5e7eb; color: #1f2937; }
</style></head>
<body>
  <div class="actions noprint">
    <button class="btn" onclick="window.print()">📄 Сохранить как PDF / Распечатать</button>
    <button class="btn btn-secondary" onclick="window.close()">Закрыть</button>
  </div>
  <div class="head">
    <h1>${esc(visit.clinic || 'Клиника')}</h1>
    <div class="meta">
      <b>Пациент:</b> ${esc(patient || '—')}<br>
      <b>Дата визита:</b> ${esc(visit.time_start || '—')}<br>
      ${visit.doctor ? `<b>Врач:</b> ${esc(visit.doctor)}<br>` : ''}
    </div>
  </div>
  ${services.length > 0 ? `
  <table>
    <thead><tr><th>Услуга</th><th class="num">Кол-во</th><th class="num">Цена</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>` : '<p style="color:#9ca3af;">Услуги не указаны</p>'}
  <div class="total">
    <span>Итого к оплате:</span>
    <b>${total.toLocaleString('ru-RU')} ₽</b>
  </div>
  <div class="foot">Документ сформирован из личного кабинета пациента</div>
  <script>
    // Если печать вызвана автоматически — закрыть окно после её завершения
    window.addEventListener('afterprint', () => setTimeout(() => window.close(), 300))
  </script>
</body></html>`

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const w = window.open(url, '_blank')
    if (!w) {
      notify ? notify('Разрешите всплывающие окна для скачивания чека', 'warn') : alert('Разрешите всплывающие окна для скачивания чека')
      URL.revokeObjectURL(url)
      return
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  } catch (e) {
    notify ? notify('Не удалось открыть чек', 'error') : alert('Не удалось открыть чек')
  }
}

const STATUS_CFG = {
  created:          { label: 'Активно',      dot: '#3B82F6', bg: 'rgba(59,130,246,.1)',  text: '#1D4ED8' },
  confirmed:        { label: 'Подтверждено', dot: '#10B981', bg: 'rgba(16,185,129,.1)',  text: '#065F46' },
  expired:          { label: 'Истекло',      dot: '#9CA3AF', bg: 'rgba(156,163,175,.1)', text: '#6B7280' },
  cancel_requested: { label: 'На отмене',    dot: '#F59E0B', bg: 'rgba(245,158,11,.1)',  text: '#92400E' },
  cancelled:        { label: 'Отменено',     dot: '#EF4444', bg: 'rgba(239,68,68,.1)',   text: '#991B1B' },
}
const VISIT_STATUS = {
  completed: { label: 'Завершён',  color: '#10B981' },
  upcoming:  { label: 'Предстоит', color: '#3B82F6' },
  refused:   { label: 'Отменён',   color: '#EF4444' },
}
const CARD_GRADS = [
  ['#1565C0','#0D47A1'],
  ['#00695C','#004D40'],
  ['#6A1B9A','#4A148C'],
  ['#E65100','#BF360C'],
  ['#1B5E20','#33691E'],
]

// ── AdBanner component ───────────────────────────────────────────────────────
const AD_THEMES = [
  { bg: 'linear-gradient(135deg,#003845,#0097A7)', glow: 'rgba(0,151,167,.4)' },
  { bg: 'linear-gradient(135deg,#1a0038,#7c3aed)', glow: 'rgba(124,58,237,.4)' },
  { bg: 'linear-gradient(135deg,#7c1900,#ff6a00)', glow: 'rgba(255,106,0,.4)'  },
]
function AdBanner({ ads, idx, setIdx }) {
  if (!ads || ads.length === 0) return null
  const ad = ads[idx]
  const th = AD_THEMES[idx % AD_THEMES.length]
  return (
    <div key={idx}
      onClick={() => { if(ad.link) window.open(ad.link,'_blank'); axios.post(API+'/ads/'+ad.id+'/event',{event_type:'click'}).catch(()=>{}) }}
      className="rounded-2xl p-4 relative overflow-hidden cursor-pointer"
      style={{ background: th.bg, boxShadow: `0 4px 24px ${th.glow}` }}>
      <div className="absolute inset-0 overflow-hidden rounded-2xl pointer-events-none">
        <div className="absolute inset-0 w-1/2" style={{ background: 'linear-gradient(90deg,transparent,rgba(255,255,255,.06),transparent)', animation: 'shimmer 3s ease-in-out infinite' }} />
      </div>
      {(ad.image_data || ad.image_url) ? (
        <div className="relative">
          <img
            src={ad.image_data
              ? `data:${ad.image_mime || 'image/png'};base64,${ad.image_data}`
              : ad.image_url}
            alt={ad.title}
            className="w-full rounded-xl object-cover block"
            style={{ height: ad.banner_height || 80 }} />
          <span className="absolute top-2 right-2 text-white/70 text-[10px] bg-black/30 px-1.5 py-0.5 rounded-full">РЕКЛАМА</span>
          {ad.title && <p className="text-white font-bold text-sm mt-2 truncate">{ad.title}</p>}
          {ad.body && <p className="text-white/65 text-xs mt-0.5 truncate">{ad.body}</p>}
        </div>
      ) : (
        <div className="flex items-center gap-3 relative">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,255,255,.2)' }}>
            <span className="material-symbols-outlined text-white text-lg" style={{ fontVariationSettings:"'FILL' 1" }}>campaign</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-sm truncate">{ad.title}</p>
            {ad.body && <p className="text-white/70 text-xs mt-0.5 truncate">{ad.body}</p>}
          </div>
          <span className="text-white/60 text-xs bg-white/10 px-2 py-0.5 rounded-full flex-shrink-0">РЕКЛАМА</span>
        </div>
      )}
      {ads.length > 1 && (
        <div className="flex justify-center gap-1.5 mt-3">
          {ads.map((_,i) => (
            <div key={i} onClick={e=>{e.stopPropagation();setIdx(i)}}
              style={{ width: i===idx ? 16 : 5, height: 5, borderRadius: 3, background: i===idx ? 'white' : 'rgba(255,255,255,.4)', transition: 'all .3s', cursor: 'pointer' }} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Push helpers ──────────────────────────────────────────────────────────────
async function subscribePush(phone, token) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false
  try {
    const sw = await navigator.serviceWorker.ready
    const keyRes = await axios.get(`${API}/push/vapid-key`)
    const b64 = keyRes.data.public_key.replace(/-/g,'+').replace(/_/g,'/')
    const raw = atob(b64)
    const key = new Uint8Array([...raw].map(c => c.charCodeAt(0)))
    const sub = await sw.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
    const s = sub.toJSON()
    await axios.post(`${API}/push/subscribe`, { endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, patient_phone: phone, patient_token: token })
    return true
  } catch { return false }
}
async function registerSW() {
  if (!('serviceWorker' in navigator)) return
  try { await navigator.serviceWorker.register('/' + SLUG + '/sw.js', { scope: '/' + SLUG + '/' }) } catch {}
}

// ── QR Fullscreen ─────────────────────────────────────────────────────────────
function QrFullscreen({ qr, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center" style={{ background: 'linear-gradient(160deg,#0A2342 0%,#1565C0 100%)' }} onClick={onClose}>
      <div className="flex items-center gap-3 mb-8">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,.15)' }}>
          <span className="material-symbols-outlined text-white text-2xl" style={{ fontVariationSettings:"'FILL' 1" }}>medical_services</span>
        </div>
        <span className="text-white text-2xl font-extrabold tracking-tight">Clinika</span>
      </div>
      <p className="text-blue-200 text-sm mb-6 text-center px-8">Покажите этот QR-код врачу или администратору</p>
      <div className="bg-white rounded-3xl shadow-2xl" style={{ padding: 16, boxShadow: '0 0 60px rgba(255,255,255,.2)' }}>
        <img src={`data:image/png;base64,${qr}`} alt="QR" style={{ width: 280, height: 280, display: 'block', borderRadius: 0 }} />
      </div>
      <p className="text-blue-300 text-xs mt-8">Нажмите в любом месте, чтобы закрыть</p>
    </div>
  )
}

// ── Login Screen ──────────────────────────────────────────────────────────────
// TODO(design-system): Логин-экран сохраняем с собственным премиум-glassmorphism дизайном
//   (gradient background, blur-card). Переход на <Card>/<Button> сломает уникальный
//   look-and-feel брендового экрана входа. Будет переосмыслено отдельно в рамках Этапа 6.
function LoginScreen({ onLogin, errorMsg }) {
  const [code, setCode] = useState('')
  const [phone, setPhone] = useState('+7')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(errorMsg || '')

  const submit = async (e) => {
    e.preventDefault()
    if (!code || !phone) { setErr('Введите код и телефон'); return }
    setLoading(true); setErr('')
    try {
      const r = await axios.post(`${API}/patient/by-code`, { code: parseInt(code), phone })
      onLogin(r.data.referral_id, r.data.patient_token, r.data.session_token)
    } catch (e) { setErr(e.response?.data?.detail || 'Направление не найдено') }
    finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-5" style={{ background: 'linear-gradient(160deg,#0A2342 0%,#1565C0 60%,#0097A7 100%)' }}>
      <style>{`
        @keyframes floatIn { from{opacity:0;transform:translateY(24px)} to{opacity:1;transform:translateY(0)} }
        .login-card { animation: floatIn .5s cubic-bezier(.22,1,.36,1) }
      `}</style>
      {/* Logo */}
      <div className="mb-10 text-center login-card">
        <div className="w-24 h-24 rounded-3xl mx-auto mb-5 flex items-center justify-center" style={{ background: 'rgba(255,255,255,.15)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,.2)', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
          <span className="material-symbols-outlined text-white text-5xl" style={{ fontVariationSettings:"'FILL' 1" }}>medical_services</span>
        </div>
        <h1 className="text-4xl font-black text-white tracking-tight">Clinika</h1>
        <p className="text-blue-200 mt-2">Личный кабинет пациента</p>
      </div>

      {/* Card */}
      <div className="w-full max-w-sm login-card" style={{ animationDelay: '.1s', background: 'rgba(255,255,255,.07)', backdropFilter: 'blur(24px)', borderRadius: 28, border: '1px solid rgba(255,255,255,.12)', padding: 28 }}>
        <h2 className="text-xl font-bold text-white mb-1">Войти в кабинет</h2>
        <p className="text-blue-200 text-sm mb-6">Введите код из направления или записи к врачу и ваш телефон</p>
        <form onSubmit={submit} className="space-y-3">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-blue-300 text-xl pointer-events-none">tag</span>
            <input type="number" inputMode="numeric" placeholder="Код направления" value={code} onChange={e => setCode(e.target.value)}
              className="w-full h-14 pl-12 pr-4 rounded-2xl text-white placeholder-blue-300/60 text-base focus:outline-none focus:ring-2 focus:ring-white/30"
              style={{ background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.15)' }} />
          </div>
          <div className="relative">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-blue-300 text-xl pointer-events-none">phone</span>
            <input type="tel" placeholder="+7 900 000-00-00" value={phone} onChange={e => setPhone(e.target.value)}
              className="w-full h-14 pl-12 pr-4 rounded-2xl text-white placeholder-blue-300/60 text-base focus:outline-none focus:ring-2 focus:ring-white/30"
              style={{ background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.15)' }} />
          </div>
          {err && <div className="flex items-center gap-2 bg-red-500/20 text-red-200 rounded-xl px-3 py-2 text-sm"><span className="material-symbols-outlined text-base">error</span>{err}</div>}
          <button type="submit" disabled={loading}
            className="w-full h-14 rounded-2xl font-bold text-base text-white disabled:opacity-50 transition-all active:scale-[.98]"
            style={{ background: 'linear-gradient(135deg,#0097A7,#1565C0)', boxShadow: '0 8px 32px rgba(0,151,167,.4)' }}>
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Поиск...
              </span>
            ) : 'Найти направление'}
          </button>
        </form>
      </div>
      <p className="text-blue-300/60 text-xs mt-8">КлиникСеть — современная медицина</p>
    </div>
  )
}

// ===== БЛОК: Status Badge — статус направления =====
// Маппинг статусов на Chip-варианты дизайн-системы (good/warn/bad/default).
const STATUS_VARIANT = {
  created:          'accent',
  confirmed:        'good',
  expired:          'default',
  cancel_requested: 'warn',
  cancelled:        'bad',
}
function StatusBadge({ status }) {
  const cfg = STATUS_CFG[status] || { label: status }
  const variant = STATUS_VARIANT[status] || 'default'
  return (
    <Chip variant={variant} dot className="font-bold">
      {cfg.label}
    </Chip>
  )
}

// ── Referral Card ─────────────────────────────────────────────────────────────
function ReferralCard({ referral, index, onQr }) {
  const [g1, g2] = CARD_GRADS[index % CARD_GRADS.length]
  const isActive = referral.status === 'created' || referral.status === 'confirmed'

  return (
    <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: '0 2px 10px rgba(0,0,0,.07)', border: '1px solid rgba(0,0,0,.06)' }}>
      {/* Compact colour strip */}
      <div className="px-4 py-3 flex items-center gap-3 relative overflow-hidden"
        style={{ background: `linear-gradient(135deg, ${g1}, ${g2})` }}>
        <div className="absolute -right-3 -top-3 w-16 h-16 rounded-full" style={{ background: 'rgba(255,255,255,.08)' }} />
        <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 relative"
          style={{ background: 'rgba(255,255,255,.2)' }}>
          <span className="material-symbols-outlined text-white text-base"
            style={{ fontVariationSettings:"'FILL' 1" }}>local_hospital</span>
        </div>
        <div className="flex-1 min-w-0 relative">
          <p className="text-white font-bold text-sm leading-tight truncate">{referral.to_clinic_name || 'Клиника'}</p>
          <p className="text-white/65 text-xs truncate mt-0.5">{referral.service_name}</p>
        </div>
        <StatusBadge status={referral.status} />
      </div>
      {/* Details row */}
      <div className="px-4 py-2.5 space-y-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <span className="material-symbols-outlined text-[13px] text-gray-400">calendar_today</span>
            <span className="font-semibold text-gray-700">
              {referral.appointment_at ? fmt(referral.appointment_at) : fmt(referral.created_at)}
            </span>
          </span>
          {referral.short_code && (
            <span className="flex items-center gap-1">
              <span className="material-symbols-outlined text-[13px] text-gray-400">tag</span>
              <span className="font-bold text-gray-700 tracking-widest">{referral.short_code}</span>
            </span>
          )}
          {referral.from_clinic_name && (
            <span className="flex items-center gap-1 min-w-0">
              <span className="material-symbols-outlined text-[13px] text-gray-400">arrow_forward</span>
              <span className="truncate">{referral.from_clinic_name}</span>
            </span>
          )}
        </div>
        {referral.notes && (
          <p className="text-xs text-gray-400 italic truncate">"{referral.notes}"</p>
        )}
        {isActive && referral.qr_code && (
          <button onClick={() => onQr(referral.qr_code)}
            className="w-full h-9 rounded-xl flex items-center justify-center gap-2 font-bold text-xs transition-all active:scale-[.98]"
            style={{ background: 'linear-gradient(135deg,#0097A7,#1565C0)', color: 'white', boxShadow: '0 3px 10px rgba(0,151,167,.25)' }}>
            <span className="material-symbols-outlined text-base"
              style={{ fontVariationSettings:"'FILL' 1" }}>qr_code_2</span>
            Показать QR-код
          </button>
        )}
        {referral.status === 'confirmed' && (
          <div className="flex items-center gap-1.5 text-xs text-emerald-600">
            <span className="material-symbols-outlined text-sm"
              style={{ fontVariationSettings:"'FILL' 1" }}>check_circle</span>
            <span className="font-semibold">Подтверждено {referral.confirmed_at ? fmt(referral.confirmed_at) : ''}</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Visit Card ─────────────────────────────────────────────────────────────────
function fmtMisDate(str) {
  if (!str) return '—'
  const m = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек']
  const [dp, tp] = str.split(' ')
  if (!dp) return str
  const [d, mo, y] = dp.split('.')
  return tp ? `${+d} ${m[+mo-1]} ${y}, ${tp}` : `${+d} ${m[+mo-1]} ${y}`
}
const VISIT_COLORS = { completed: '#10B981', upcoming: '#3B82F6', refused: '#EF4444' }

function VisitCard({ visit, patientName }) {
  // Toast вместо alert при ошибках формирования чека
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)
  const services = Array.isArray(visit.services) ? visit.services : []
  const first = services[0]?.title || '—'
  const doctor = visit.doctor || '—'
  const clinic = visit.clinic || '—'
  const status = visit.status || ''
  const vc = VISIT_STATUS[status] || { label: status, color: '#9CA3AF' }
  const total = visit.sum_value || 0
  const isFirst = visit.is_first_clinic || visit.is_first
  const canPdf = (services.length > 0) || total > 0

  return (
    <div className="bg-white rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(0,0,0,.06)', boxShadow: '0 2px 12px rgba(0,0,0,.05)' }}>
      <div className="flex items-stretch">
        {/* Left color bar */}
        <div className="w-1 flex-shrink-0 rounded-l-2xl" style={{ background: vc.color }} />
        <div className="flex-1 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="font-bold text-gray-900 text-sm leading-snug truncate">{first}</p>
              <p className="text-xs text-gray-400 mt-0.5 truncate">{doctor}</p>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {isFirst && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(124,58,237,.1)', color: '#7C3AED' }}>1-й</span>}
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${vc.color}18`, color: vc.color }}>{vc.label}</span>
            </div>
          </div>
          <div className="flex items-center gap-3 mt-2">
            <span className="flex items-center gap-1 text-xs text-gray-400">
              <span className="material-symbols-outlined text-sm">schedule</span>
              {fmtMisDate(visit.time_start)}
            </span>
            <span className="flex items-center gap-1 text-xs text-gray-400 truncate">
              <span className="material-symbols-outlined text-sm">location_on</span>
              <span className="truncate">{clinic}</span>
            </span>
          </div>
          {(total > 0 || services.length > 1) && (
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-50">
              {total > 0 && <span className="text-sm font-extrabold" style={{ color: '#0097A7' }}>{total.toLocaleString('ru-RU')} ₽</span>}
              {services.length > 1 && (
                <button onClick={() => setOpen(v => !v)} className="flex items-center gap-0.5 text-xs font-semibold ml-auto" style={{ color: '#1565C0' }}>
                  {open ? 'Скрыть' : `${services.length} услуг`}
                  <span className="material-symbols-outlined text-sm">{open ? 'expand_less' : 'expand_more'}</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      {open && services.length > 0 && (
        <div className="px-4 pb-4 space-y-1.5">
          {services.map((s, i) => (
            <div key={i} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
              <span className="text-xs text-gray-600 flex-1 mr-3 truncate">{s.title || '—'}</span>
              {(s.value || s.price) && <span className="text-xs font-bold text-gray-800 flex-shrink-0">{parseInt(s.value || s.price || 0).toLocaleString('ru-RU')} ₽</span>}
            </div>
          ))}
        </div>
      )}
      {canPdf && (
        <div className="px-4 pb-3 -mt-1">
          <button onClick={async () => { if (pdfBusy) return; setPdfBusy(true); await downloadVisitPdf(visit, patientName, toast); setPdfBusy(false) }}
            className="w-full h-9 rounded-xl flex items-center justify-center gap-1.5 text-xs font-semibold transition-all active:scale-[.97]"
            style={{ background:'#F1F5F9', color:'#1E293B', border:'1px solid #E2E8F0' }}>
            <span className="material-symbols-outlined text-base">download</span>
            {pdfBusy ? 'Готовим PDF...' : 'Скачать чек (PDF)'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Appointment Card (запись к врачу) ────────────────────────────────────────
function fmtAptDate(iso) {
  if (!iso) return '—'
  const m = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек']
  const w = ['вс','пн','вт','ср','чт','пт','сб']
  const d = new Date(iso + 'T00:00')
  if (isNaN(d.getTime())) return iso
  return `${d.getDate()} ${m[d.getMonth()]}, ${w[d.getDay()]}`
}

function AppointmentCard({ apt, onQr, onCancelled, onRescheduleStart }) {
  // Замена alert на Toast
  const { toast } = useToast()
  const status = String(apt.status || '').toLowerCase()
  const cfg = status === 'confirmed'
    ? { label: 'Подтверждена', dot: '#10B981', bg: 'rgba(16,185,129,.1)', text: '#065F46' }
    : { label: 'Ожидает',      dot: '#F59E0B', bg: 'rgba(245,158,11,.1)', text: '#92400E' }
  const startHHMM = (apt.start_time || '').slice(0,5)
  const endHHMM   = (apt.end_time   || '').slice(0,5)
  const tooLate = hoursUntil(apt.appointment_date, apt.start_time) < 6
  const [confirming, setConfirming] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [showCal, setShowCal] = useState(false)

  async function doCancel() {
    if (!apt.patient_token) { toast('Токен записи отсутствует', 'warn'); return }
    setCancelling(true)
    try {
      await axios.post(`${API}/patient/appointment/${apt.id}/cancel`, { reason: 'Отменено пациентом' }, { params:{ t: apt.patient_token } })
      setConfirming(false)
      onCancelled && onCancelled(apt.id)
    } catch (e) {
      toast(e.response?.data?.detail || 'Не удалось отменить', 'error')
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl overflow-hidden card-in" style={{ border:'1px solid rgba(0,0,0,.05)', boxShadow:'0 2px 12px rgba(0,0,0,.05)' }}>
      <div className="px-4 py-3 flex items-center gap-3 relative overflow-hidden"
        style={{ background:'linear-gradient(135deg,#0097A7,#1565C0)' }}>
        <div className="absolute -right-3 -top-3 w-16 h-16 rounded-full" style={{ background:'rgba(255,255,255,.08)' }} />
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 relative" style={{ background:'rgba(255,255,255,.2)' }}>
          <span className="material-symbols-outlined text-white text-lg" style={{ fontVariationSettings:"'FILL' 1" }}>stethoscope</span>
        </div>
        <div className="flex-1 min-w-0 relative">
          <p className="text-white font-bold text-sm leading-tight truncate">{apt.doctor_name || 'Врач'}</p>
          <p className="text-white/70 text-xs truncate mt-0.5">{apt.specialty || apt.clinic_name || '—'}</p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-1 rounded-full flex-shrink-0"
          style={{ background:cfg.bg, color:cfg.text }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background:cfg.dot }} />
          {cfg.label}
        </span>
      </div>
      <div className="px-4 py-3 space-y-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px] text-gray-400">calendar_today</span>
            <span className="font-semibold text-gray-700">{fmtAptDate(apt.appointment_date)}</span>
          </span>
          {(startHHMM || endHHMM) && (
            <span className="flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px] text-gray-400">schedule</span>
              <span className="font-semibold text-gray-700">{startHHMM}{endHHMM ? ` – ${endHHMM}` : ''}</span>
            </span>
          )}
          {apt.clinic_name && (
            <span className="flex items-center gap-1 min-w-0">
              <span className="material-symbols-outlined text-[14px] text-gray-400">location_on</span>
              <span className="truncate">{apt.clinic_name}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 pt-1">
          {apt.qr_code ? (
            <button onClick={() => onQr(apt.qr_code)}
              className="flex-1 h-9 rounded-xl flex items-center justify-center gap-2 font-bold text-xs transition-all active:scale-[.98]"
              style={{ background:'linear-gradient(135deg,#0097A7,#1565C0)', color:'white', boxShadow:'0 3px 10px rgba(0,151,167,.25)' }}>
              <span className="material-symbols-outlined text-base" style={{ fontVariationSettings:"'FILL' 1" }}>qr_code_2</span>
              Показать QR
            </button>
          ) : (
            <span className="text-xs text-gray-400">QR недоступен</span>
          )}
          {apt.short_code && (
            <span className="px-2.5 py-1.5 rounded-lg text-xs font-bold tracking-widest flex-shrink-0"
              style={{ background:'#fff8e1', color:'#e65100', border:'1px solid #ffe082' }}>
              {apt.short_code}
            </span>
          )}
        </div>

        {/* Контакты клиники в один клик — адаптив 1/3 кнопки в ряд */}
        {(apt.clinic_phone || apt.clinic_address || apt.clinic_latitude) && (
          <div className="grid grid-cols-3 gap-1.5 pt-2">
            {apt.clinic_phone && (
              <a href={buildTel(apt.clinic_phone)}
                className="h-9 rounded-xl flex items-center justify-center gap-1 text-xs font-semibold transition-all active:scale-[.97]"
                style={{ background:'#E0F7FA', color:'#00838F' }}>
                <span className="material-symbols-outlined text-base">call</span>
                <span className="hidden sm:inline">Позвонить</span>
              </a>
            )}
            {apt.clinic_phone && (
              <a href={buildWhatsApp(apt.clinic_phone)} target="_blank" rel="noreferrer"
                className="h-9 rounded-xl flex items-center justify-center gap-1 text-xs font-semibold transition-all active:scale-[.97]"
                style={{ background:'#E8F5E9', color:'#2E7D32' }}>
                <span className="material-symbols-outlined text-base">chat</span>
                <span className="hidden sm:inline">WhatsApp</span>
              </a>
            )}
            {(apt.clinic_address || apt.clinic_latitude) && (
              <a href={buildMapUrl(apt.clinic_address, apt.clinic_latitude, apt.clinic_longitude)} target="_blank" rel="noreferrer"
                className="h-9 rounded-xl flex items-center justify-center gap-1 text-xs font-semibold transition-all active:scale-[.97]"
                style={{ background:'#FFF3E0', color:'#E65100' }}>
                <span className="material-symbols-outlined text-base">map</span>
                <span className="hidden sm:inline">Маршрут</span>
              </a>
            )}
          </div>
        )}

        {/* Кнопки управления: календарь / перенос / отмена — только для активных */}
        {(status === 'pending' || status === 'confirmed') && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 pt-2">
            <div className="relative">
              <button onClick={() => setShowCal(v => !v)}
                className="w-full h-9 rounded-xl flex items-center justify-center gap-1 text-xs font-semibold border transition-all active:scale-[.97]"
                style={{ background:'#fff', borderColor:'#E5E7EB', color:'#1A2B3C' }}>
                <span className="material-symbols-outlined text-base">event_available</span>
                В календарь
              </button>
              {showCal && (
                <div className="absolute z-30 left-0 right-0 mt-1 rounded-xl bg-white shadow-lg border border-gray-100 overflow-hidden">
                  <button onClick={() => { downloadIcs(apt); setShowCal(false) }}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50">
                    .ics (Apple/Outlook)
                  </button>
                  <a href={googleCalendarUrl(apt)} target="_blank" rel="noreferrer" onClick={() => setShowCal(false)}
                    className="w-full block text-left px-3 py-2 text-xs hover:bg-gray-50 border-t border-gray-50">
                    Google Calendar
                  </a>
                </div>
              )}
            </div>
            <button onClick={() => onRescheduleStart && onRescheduleStart(apt)} disabled={tooLate}
              title={tooLate ? 'Позвоните в клинику' : 'Перенести запись'}
              className="h-9 rounded-xl flex items-center justify-center gap-1 text-xs font-semibold border transition-all active:scale-[.97]"
              style={{ background:'#fff', borderColor:'#E5E7EB', color: tooLate ? '#9CA3AF' : '#1565C0', cursor: tooLate ? 'not-allowed' : 'pointer', opacity: tooLate ? .65 : 1 }}>
              <span className="material-symbols-outlined text-base">update</span>
              Перенести
            </button>
            <button onClick={() => !tooLate && setConfirming(true)} disabled={tooLate}
              title={tooLate ? 'Позвоните в клинику' : 'Отменить запись'}
              className="h-9 rounded-xl flex items-center justify-center gap-1 text-xs font-semibold border transition-all active:scale-[.97]"
              style={{ background:'#fff', borderColor:'#FECACA', color: tooLate ? '#9CA3AF' : '#DC2626', cursor: tooLate ? 'not-allowed' : 'pointer', opacity: tooLate ? .65 : 1 }}>
              <span className="material-symbols-outlined text-base">close</span>
              Отменить
            </button>
          </div>
        )}
      </div>

      {/* ===== БЛОК: Confirm-модалка отмены через дизайн-систему ===== */}
      <Modal
        open={confirming}
        onClose={() => !cancelling && setConfirming(false)}
        title="Отменить запись?"
        size="sm"
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={cancelling}>
              Передумал
            </Button>
            <Button variant="danger" onClick={doCancel} disabled={cancelling}>
              {cancelling ? 'Отмена…' : 'Да, отменить'}
            </Button>
          </>
        }
      >
        <p className="text-sm" style={{ color: 'var(--fg-2)' }}>
          {apt.doctor_name || 'Врач'} · {fmtAptDate(apt.appointment_date)}{startHHMM ? `, ${startHHMM}` : ''}
        </p>
      </Modal>
    </div>
  )
}

// ── AptControls: блок управления (календарь / перенос / отмена) ─────────────
function AptControls({ apt, tooLate, onCancelled, onRescheduleStart }) {
  // Замена alert на Toast
  const { toast } = useToast()
  const [confirming, setConfirming] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [showCal, setShowCal] = useState(false)

  async function doCancel() {
    if (!apt.patient_token) { toast('Токен записи отсутствует', 'warn'); return }
    setCancelling(true)
    try {
      await axios.post(`${API}/patient/appointment/${apt.id}/cancel`, { reason: 'Отменено пациентом' }, { params:{ t: apt.patient_token } })
      setConfirming(false)
      onCancelled && onCancelled(apt.id)
    } catch (e) {
      toast(e.response?.data?.detail || 'Не удалось отменить', 'error')
    } finally { setCancelling(false) }
  }

  return (
    <>
      <div className="bg-white rounded-2xl p-3 grid grid-cols-1 sm:grid-cols-3 gap-2" style={{ border:'1px solid rgba(0,0,0,.06)' }}>
        <div className="relative">
          <button onClick={() => setShowCal(v => !v)}
            className="w-full h-11 rounded-xl flex items-center justify-center gap-1.5 text-sm font-semibold border transition-all active:scale-[.97]"
            style={{ background:'#fff', borderColor:'#E5E7EB', color:'#1A2B3C' }}>
            <span className="material-symbols-outlined text-base">event_available</span>
            В календарь
          </button>
          {showCal && (
            <div className="absolute z-30 left-0 right-0 mt-1 rounded-xl bg-white shadow-lg border border-gray-100 overflow-hidden">
              <button onClick={() => { downloadIcs(apt); setShowCal(false) }} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50">.ics (Apple/Outlook)</button>
              <a href={googleCalendarUrl(apt)} target="_blank" rel="noreferrer" onClick={() => setShowCal(false)} className="w-full block text-left px-3 py-2 text-sm hover:bg-gray-50 border-t border-gray-50">Google Calendar</a>
            </div>
          )}
        </div>
        <button onClick={() => onRescheduleStart && onRescheduleStart(apt)} disabled={tooLate}
          title={tooLate ? 'Позвоните в клинику' : 'Перенести запись'}
          className="h-11 rounded-xl flex items-center justify-center gap-1.5 text-sm font-semibold border transition-all active:scale-[.97]"
          style={{ background:'#fff', borderColor:'#E5E7EB', color: tooLate ? '#9CA3AF' : '#1565C0', opacity: tooLate ? .65 : 1, cursor: tooLate ? 'not-allowed' : 'pointer' }}>
          <span className="material-symbols-outlined text-base">update</span>
          Перенести
        </button>
        <button onClick={() => !tooLate && setConfirming(true)} disabled={tooLate}
          title={tooLate ? 'Позвоните в клинику' : 'Отменить запись'}
          className="h-11 rounded-xl flex items-center justify-center gap-1.5 text-sm font-semibold border transition-all active:scale-[.97]"
          style={{ background:'#fff', borderColor:'#FECACA', color: tooLate ? '#9CA3AF' : '#DC2626', opacity: tooLate ? .65 : 1, cursor: tooLate ? 'not-allowed' : 'pointer' }}>
          <span className="material-symbols-outlined text-base">close</span>
          Отменить
        </button>
      </div>

      {/* ===== БЛОК: Confirm-модалка отмены через дизайн-систему ===== */}
      <Modal
        open={confirming}
        onClose={() => !cancelling && setConfirming(false)}
        title="Отменить запись?"
        size="sm"
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={cancelling}>
              Передумал
            </Button>
            <Button variant="danger" onClick={doCancel} disabled={cancelling}>
              {cancelling ? 'Отмена…' : 'Да, отменить'}
            </Button>
          </>
        }
      >
        <p className="text-sm" style={{ color: 'var(--fg-2)' }}>
          {apt.doctor_name || 'Врач'} · {fmtAptDate(apt.appointment_date)} {(apt.start_time||'').slice(0,5)}
        </p>
      </Modal>
    </>
  )
}

// ── Chat Tab (вариант D — гибрид AI + регистратура) ──────────────────────────
// Аналог SupportTab, но через /patient/chat — AI-ассистент + админ.
function ChatTab({ phone, sessionToken }) {
  const [chat, setChat] = useState(null)        // { id, mode, ai_messages_today, ai_daily_limit, ... }
  const [msgs, setMsgs] = useState([])
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  // Загрузка / обновление истории. Polling каждые 5 сек.
  const loadList = useCallback(async () => {
    if (!sessionToken) { setLoading(false); return }
    try {
      const r = await axios.get(`${API}/patient/chat`, { params: { t: sessionToken } })
      const list = Array.isArray(r.data?.chats) ? r.data.chats : []
      if (list.length === 0) {
        setChat(null); setMsgs([]); setLoading(false); return
      }
      const latest = list[0]
      const r2 = await axios.get(`${API}/patient/chat/${latest.id}/messages`, { params: { t: sessionToken } })
      setChat(r2.data?.chat || latest)
      setMsgs(Array.isArray(r2.data?.messages) ? r2.data.messages : [])
    } catch (e) {
      setError(e?.response?.data?.detail || 'Не удалось загрузить чат')
    } finally {
      setLoading(false)
    }
  }, [sessionToken])

  useEffect(() => {
    loadList()
    const id = setInterval(loadList, 5000)  // ловим ответы админа
    return () => clearInterval(id)
  }, [loadList])
  useEffect(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }, [msgs])

  // Отправка сообщения
  const send = async (e) => {
    e?.preventDefault?.()
    const t = (text || '').trim()
    if (!t || sending || !sessionToken) return
    setText(''); setSending(true); setError('')
    const optimistic = {
      id: 'tmp-' + Date.now(),
      sender: 'patient',
      text: t,
      created_at: new Date().toISOString(),
      _pending: true,
    }
    setMsgs(prev => [...prev, optimistic])
    try {
      const body = { text: t }
      if (chat?.id) body.chat_id = chat.id
      const r = await axios.post(`${API}/patient/chat/send`, body, { params: { t: sessionToken } })
      const newOnes = Array.isArray(r.data?.new_messages) ? r.data.new_messages : []
      setMsgs(prev => {
        const cleaned = prev.filter(m => m.id !== optimistic.id)
        return [...cleaned, ...newOnes]
      })
      if (r.data?.chat) setChat(r.data.chat)
    } catch (err) {
      setMsgs(prev => prev.filter(m => m.id !== optimistic.id))
      setText(t)
      setError(err?.response?.data?.detail || 'Не удалось отправить сообщение')
    } finally {
      setSending(false)
    }
  }

  // Явная просьба пациента «передать живому администратору»
  const requestManual = async () => {
    if (!chat?.id || !sessionToken) return
    try {
      const r = await axios.post(`${API}/patient/chat/${chat.id}/manual`, {}, { params: { t: sessionToken } })
      if (r.data?.chat) setChat(r.data.chat)
      const newOnes = Array.isArray(r.data?.new_messages) ? r.data.new_messages : []
      if (newOnes.length) setMsgs(prev => [...prev, ...newOnes])
    } catch (e) {
      setError(e?.response?.data?.detail || 'Не удалось переключить чат')
    }
  }

  const isManual = chat?.mode === 'manual'
  const limit = chat?.ai_daily_limit || 20
  const used = chat?.ai_messages_today || 0
  const limitExceeded = !isManual && used >= limit
  const fmtTime = (iso) => {
    if (!iso) return ''
    try {
      const d = new Date(iso)
      return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
    } catch { return '' }
  }

  // Авто-фокус на чат при открытии вкладки — поле ввода и сообщения должны быть видны без скролла
  useEffect(() => {
    setTimeout(() => {
      const root = document.getElementById('chat-tab-root')
      if (root) root.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)
  }, [])

  return (
    <div id="chat-tab-root" className="flex flex-col" style={{ height: 'min(70vh, calc(100svh - 200px))', minHeight: 380 }}>
      {/* Header — компактный на mobile */}
      <div className="flex items-center gap-2 sm:gap-3 mb-2 sm:mb-3 p-2 sm:p-4 rounded-2xl flex-shrink-0" style={{ background: 'linear-gradient(135deg,#0097A7,#1565C0)' }}>
        <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,255,255,.2)' }}>
          <span className="material-symbols-outlined text-white text-lg sm:text-xl" style={{ fontVariationSettings:"'FILL' 1" }}>support_agent</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-white text-sm truncate">Чат клиники</p>
          <p className="text-blue-100 text-[11px] truncate">
            {isManual ? 'Отвечает администратор' : 'AI-ассистент 24/7'}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
          <span className="text-emerald-200 text-[11px] font-semibold hidden sm:inline">
            {isManual ? 'Передан админу' : 'Онлайн'}
          </span>
        </div>
      </div>

      {/* Плашки статуса */}
      {isManual && (
        <div className="mb-2 px-3 py-2 rounded-xl text-xs flex items-start gap-2"
          style={{ background: '#FFF7ED', border: '1px solid #FED7AA', color: '#9A3412' }}>
          <span className="material-symbols-outlined text-base flex-shrink-0" style={{ marginTop: 1 }}>schedule</span>
          <span>Ваш вопрос ждёт ответа администратора. Обычно отвечаем в рабочее время в течение нескольких минут.</span>
        </div>
      )}
      {!isManual && limitExceeded && (
        <div className="mb-2 px-3 py-2 rounded-xl text-xs flex items-start gap-2"
          style={{ background: '#FEF3C7', border: '1px solid #FDE68A', color: '#92400E' }}>
          <span className="material-symbols-outlined text-base flex-shrink-0" style={{ marginTop: 1 }}>info</span>
          <span>Лимит автоответов исчерпан до завтра. Можете продолжить — администратор ответит вам в этом же чате.</span>
        </div>
      )}
      {error && (
        <div className="mb-2 px-3 py-2 rounded-xl text-xs flex items-start gap-2"
          style={{ background: '#FEE2E2', border: '1px solid #FECACA', color: '#991B1B' }}>
          <span className="material-symbols-outlined text-base flex-shrink-0">error</span>
          <span>{error}</span>
        </div>
      )}

      {/* Список сообщений */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-2 pb-2 -mx-1 px-1">
          {msgs.length === 0 && (
            <EmptyState
              icon={<span className="material-symbols-outlined text-3xl">chat_bubble</span>}
              title="Начните диалог с клиникой"
              message="Спросите про услуги, цены, расписание врачей. AI-ассистент ответит сразу."
            />
          )}
          {msgs.map((m, i) => {
            const isPatient = m.sender === 'patient'
            const isAdmin = m.sender === 'admin'
            const isAssistant = m.sender === 'assistant'
            return (
              <div key={m.id || i} className={`flex ${isPatient ? 'justify-end' : 'justify-start'}`}>
                {!isPatient && (
                  <div className="w-7 h-7 rounded-full flex items-center justify-center mr-2 mt-1 flex-shrink-0"
                    style={{
                      background: isAdmin
                        ? 'linear-gradient(135deg,#16A34A,#15803D)'
                        : 'linear-gradient(135deg,#0097A7,#1565C0)',
                    }}>
                    <span className="material-symbols-outlined text-white text-xs" style={{ fontVariationSettings:"'FILL' 1" }}>
                      {isAdmin ? 'badge' : 'smart_toy'}
                    </span>
                  </div>
                )}
                <div style={{
                  maxWidth: '82%',
                  padding: '8px 12px',
                  borderRadius: isPatient ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                  background: isPatient
                    ? 'linear-gradient(135deg,#1565C0,#0097A7)'
                    : (isAdmin ? '#F0FDF4' : 'white'),
                  boxShadow: '0 2px 8px rgba(0,0,0,.06)',
                  border: !isPatient ? '1px solid ' + (isAdmin ? '#BBF7D0' : 'rgba(0,0,0,.06)') : 'none',
                  opacity: m._pending ? 0.7 : 1,
                }}>
                  <p className="text-sm whitespace-pre-wrap break-words" style={{ color: isPatient ? 'white' : '#1F2937' }}>
                    {m.text}
                  </p>
                  <div className="flex items-center justify-between gap-2 mt-1">
                    <span className="text-[10px]" style={{ color: isPatient ? 'rgba(255,255,255,.7)' : '#9CA3AF' }}>
                      {isAssistant && '🤖 Авто-ответ'}
                      {isAdmin && '👤 Администратор'}
                    </span>
                    <span className="text-[10px]" style={{ color: isPatient ? 'rgba(255,255,255,.6)' : '#9CA3AF' }}>
                      {fmtTime(m.created_at)}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Кнопка «Нужен живой ответ?» (если ветка ещё AI) */}
      {!isManual && !loading && (
        <div className="pb-1">
          <button onClick={requestManual} type="button"
            className="w-full h-9 rounded-xl flex items-center justify-center gap-1.5 text-xs font-semibold transition-all active:scale-[.98]"
            style={{ background: '#FFF7ED', color: '#9A3412', border: '1px solid #FED7AA' }}>
            <span className="material-symbols-outlined text-[16px]">support_agent</span>
            Нужен живой ответ?
          </button>
        </div>
      )}

      {/* Поле ввода — адаптив (h-11 на mobile, h-12 на tablet) */}
      <form onSubmit={send} className="flex gap-2 pt-2">
        <input ref={inputRef}
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={isManual ? 'Сообщение администратору...' : 'Спросите про услуги, врачей...'}
          disabled={sending}
          className="flex-1 h-11 sm:h-12 px-3 sm:px-4 rounded-2xl text-sm focus:outline-none disabled:opacity-60"
          style={{ background: 'white', border: '1.5px solid rgba(0,0,0,.08)', boxShadow: '0 2px 8px rgba(0,0,0,.04)' }} />
        <button type="submit" disabled={!text.trim() || sending}
          className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl flex items-center justify-center disabled:opacity-40 transition-all active:scale-95 flex-shrink-0"
          style={{ background: 'linear-gradient(135deg,#0097A7,#1565C0)' }}>
          {sending ? (
            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <span className="material-symbols-outlined text-white text-xl" style={{ fontVariationSettings:"'FILL' 1" }}>send</span>
          )}
        </button>
      </form>
    </div>
  )
}

// ── Doctors / Booking / Reviews — компоненты (перенесены из PatientPortal) ───
const MONTHS_R = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек']
const DAYS_R = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб']
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function Stars({ rating, size=14, color='#F59E0B' }) {
  const r = rating || 0
  return (
    <span style={{ display:'inline-flex', gap:1 }}>
      {[1,2,3,4,5].map(i => {
        const fill = Math.min(1, Math.max(0, r - i + 1))
        return (
          <span key={i} style={{ position:'relative', fontSize:size, lineHeight:1 }}>
            <span style={{ color:'#E5E7EB' }}>★</span>
            <span style={{ position:'absolute', left:0, top:0, overflow:'hidden', width:`${fill*100}%`, color }}>★</span>
          </span>
        )
      })}
    </span>
  )
}

function StarSelect({ value, onChange }) {
  const [hover, setHover] = useState(0)
  return (
    <div style={{ display:'flex', gap:6 }}>
      {[1,2,3,4,5].map(i => (
        <span key={i}
          onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(0)}
          onClick={() => onChange(i)}
          style={{ fontSize:32, color: i<=(hover||value)?'#F59E0B':'#D1D5DB', cursor:'pointer', transition:'color .15s' }}>
          ★
        </span>
      ))}
    </div>
  )
}

function DocAvatar({ name, photo, size=52, primary='#0097A7' }) {
  if (photo) return <img src={photo} alt={name} style={{ width:size, height:size, borderRadius:'50%', objectFit:'cover', flexShrink:0 }} />
  const initials = (name||'').split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase()||'?'
  return (
    <div style={{ width:size, height:size, borderRadius:'50%', background:`linear-gradient(135deg,${primary},#1565C0)`, display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontWeight:700, fontSize:size*0.35, flexShrink:0 }}>
      {initials}
    </div>
  )
}

function RatingBar({ star, count, total, primary }) {
  const pct = total>0 ? Math.round(count/total*100) : 0
  return (
    <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
      <span style={{ fontSize:11, color:'#9CA3AF', width:10, textAlign:'right' }}>{star}</span>
      <span style={{ fontSize:10, color:'#F59E0B' }}>★</span>
      <div style={{ flex:1, height:5, background:'#F3F4F6', borderRadius:3, overflow:'hidden' }}>
        <div style={{ width:`${pct}%`, height:'100%', background:primary, borderRadius:3 }} />
      </div>
      <span style={{ fontSize:11, color:'#9CA3AF', width:20 }}>{count}</span>
    </div>
  )
}

// TODO(design-system): SheetModal — кастомная bottom-sheet модалка для booking/review
//   форм. Замена на <Modal> возможна, но эти формы (QuickBook, ReviewForm) активно
//   используют собственные стили; перевод требует совместного переосмысления формы.
//   Оставляем как есть до отдельного редизайна форм записи к врачу.
function SheetModal({ open, onClose, title, children }) {
  if (!open) return null
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.55)', zIndex:200, display:'flex', alignItems:'flex-end', justifyContent:'center' }}
      onClick={e => { if (e.target===e.currentTarget) onClose() }}>
      <div style={{ background:'#fff', borderRadius:'22px 22px 0 0', padding:'20px 20px 36px', width:'100%', maxWidth:500, maxHeight:'92vh', overflowY:'auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <h3 style={{ margin:0, fontSize:16, color:'#1A2B3C', fontWeight:700 }}>{title}</h3>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:22, color:'#9CA3AF', cursor:'pointer' }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function ReviewForm({ doctorId, tenantId, primary, onClose, onDone }) {
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [name, setName] = useState('')
  const [anon, setAnon] = useState(false)
  const [saving, setSaving] = useState(false)
  const [ok, setOk] = useState(false)
  const [err, setErr] = useState('')

  async function submit() {
    if (!rating) { setErr('Поставьте оценку'); return }
    setSaving(true); setErr('')
    try {
      await axios.post(`${API}/reviews`, {
        doctor_id: doctorId, tenant_id: tenantId, rating,
        comment: comment.trim()||null,
        patient_name: anon?null:(name.trim()||'Пациент'),
        is_anonymous: anon,
      })
      setOk(true)
      setTimeout(() => { onDone && onDone() }, 1500)
    } catch(e) { setErr(e.response?.data?.detail||'Ошибка отправки') }
    finally { setSaving(false) }
  }

  if (ok) return (
    <div style={{ textAlign:'center', padding:'28px 0' }}>
      <div style={{ fontSize:48 }}>🙏</div>
      <p style={{ fontWeight:700, color:'#1A2B3C', marginTop:8, fontSize:16 }}>Спасибо за отзыв!</p>
      <p style={{ fontSize:13, color:'#6B7280' }}>Отзыв появится после проверки</p>
    </div>
  )

  return (
    <div>
      <div style={{ marginBottom:16 }}>
        <p style={{ fontSize:13, color:'#6B7280', marginBottom:10 }}>Ваша оценка:</p>
        <StarSelect value={rating} onChange={setRating} />
      </div>
      <textarea value={comment} onChange={e=>setComment(e.target.value)}
        placeholder="Расскажите о своём визите..." rows={4}
        style={{ width:'100%', padding:'12px', border:'1.5px solid #E5E7EB', borderRadius:12, fontSize:14, outline:'none', resize:'vertical', fontFamily:'inherit', boxSizing:'border-box' }} />
      <div style={{ display:'flex', gap:10, marginTop:10, alignItems:'center' }}>
        <input value={name} onChange={e=>setName(e.target.value)} placeholder="Ваше имя" disabled={anon}
          style={{ flex:1, padding:'11px 12px', border:'1.5px solid #E5E7EB', borderRadius:10, fontSize:14, outline:'none', opacity:anon?0.4:1 }} />
        <label style={{ display:'flex', gap:6, alignItems:'center', fontSize:13, color:'#6B7280', cursor:'pointer', whiteSpace:'nowrap' }}>
          <input type="checkbox" checked={anon} onChange={e=>setAnon(e.target.checked)} />
          Анонимно
        </label>
      </div>
      {err && <p style={{ color:'#EF4444', fontSize:13, marginTop:8 }}>{err}</p>}
      <div style={{ display:'flex', gap:8, marginTop:14 }}>
        <button onClick={submit} disabled={saving||!rating}
          style={{ flex:1, padding:'13px', background:`linear-gradient(135deg,${primary},#1565C0)`, color:'#fff', border:'none', borderRadius:12, fontSize:14, fontWeight:600, cursor:'pointer', opacity:(saving||!rating)?0.6:1 }}>
          {saving?'Отправка...':'Отправить'}
        </button>
        <button onClick={onClose}
          style={{ padding:'13px 16px', background:'none', border:'1.5px solid #E5E7EB', borderRadius:12, fontSize:14, color:'#6B7280', cursor:'pointer' }}>
          Отмена
        </button>
      </div>
    </div>
  )
}

function QuickBook({ doctor, primary, onClose, onBooked, patientName, patientPhone }) {
  const dates = Array.from({length:14},(_,i)=>{ const d=new Date(); d.setDate(d.getDate()+i); return d })
  const [selDate, setSelDate] = useState(null)
  const [slots, setSlots] = useState([])
  const [slotsLoading, setSL] = useState(false)
  const [selSlot, setSlot] = useState(null)
  const [name, setName] = useState(patientName||'')
  const [booking, setBooking] = useState(false)
  const [done, setDone] = useState(null)
  const [err, setErr] = useState('')
  // Доступность по дням: { 'YYYY-MM-DD': {free_slots, has_schedule} }
  const [availMap, setAvailMap] = useState(null) // null = ещё не загружено
  const [availLoading, setAvLoad] = useState(true)
  const [hasAnySchedule, setHasAnySchedule] = useState(true)

  // При открытии модала тянем availability на 14 дней
  useEffect(() => {
    let alive = true
    ;(async () => {
      setAvLoad(true)
      try {
        const today = new Date()
        const to = new Date(); to.setDate(to.getDate() + 13)
        const r = await axios.get(`${API}/public/${SLUG}/doctors/${doctor.id}/availability`, {
          params: { from: isoDate(today), to: isoDate(to) },
        })
        if (!alive) return
        const map = {}
        ;(r.data?.days || []).forEach(d => { map[d.date] = d })
        setAvailMap(map)
        setHasAnySchedule(!!r.data?.has_any_schedule)
      } catch {
        if (!alive) return
        setAvailMap({})
        setHasAnySchedule(false)
      } finally {
        if (alive) setAvLoad(false)
      }
    })()
    return () => { alive = false }
  }, [doctor.id])

  async function pickDate(d) {
    const key = isoDate(d)
    // запрещаем выбирать дни без свободных слотов
    if (availMap && (!availMap[key] || !availMap[key].free_slots)) return
    setSelDate(d); setSlot(null); setSlots([]); setSL(true)
    try {
      const r = await axios.get(`${API}/public/${SLUG}/doctors/${doctor.id}/slots`, { params:{ date: key } })
      // фильтруем только реально свободные
      const list = Array.isArray(r.data) ? r.data.filter(s => s.available !== false) : []
      setSlots(list)
    } catch { setSlots([]) }
    finally { setSL(false) }
  }

  async function book() {
    if (!selSlot) { setErr('Выберите время'); return }
    setBooking(true); setErr('')
    try {
      const r = await axios.post(`${API}/public/${SLUG}/book`, {
        doctor_id: doctor.id,
        appointment_date: isoDate(selDate),
        start_time: selSlot,
        patient_name: name || patientName || 'Пациент',
        patient_phone: patientPhone || '',
      })
      setDone(r.data)
      onBooked && onBooked()
    } catch(e) { setErr(e.response?.data?.detail||'Ошибка записи') }
    finally { setBooking(false) }
  }

  if (done) return (
    <div style={{ textAlign:'center', padding:'16px 0' }}>
      <div style={{ fontSize:48, marginBottom:8 }}>✅</div>
      <h4 style={{ margin:'0 0 6px', color:'#1A2B3C', fontSize:17 }}>Запись создана!</h4>
      <p style={{ fontSize:13, color:'#6B7280', marginBottom:16 }}>{fmt(done.appointment_date)}, {done.start_time}</p>
      {done.qr_code && <img src={done.qr_code.startsWith('data:')?done.qr_code:`data:image/png;base64,${done.qr_code}`} alt="QR" style={{ width:150, height:150, borderRadius:12, border:'1px solid #E5E7EB', marginBottom:10 }} />}
      {done.short_code && <p style={{ fontSize:14, color:'#6B7280' }}>Код: <b style={{ fontSize:22, color:'#1A2B3C' }}>{done.short_code}</b></p>}
      <button onClick={onClose}
        style={{ marginTop:14, padding:'12px 28px', background:`linear-gradient(135deg,${primary},#1565C0)`, color:'#fff', border:'none', borderRadius:12, fontSize:14, fontWeight:600, cursor:'pointer' }}>
        Готово
      </button>
    </div>
  )

  // Если у врача вообще нет расписания
  if (!availLoading && !hasAnySchedule) return (
    <div>
      <div style={{ display:'flex', gap:12, alignItems:'center', marginBottom:16, padding:'12px', background:'#F8FAFF', borderRadius:12 }}>
        <DocAvatar name={doctor.full_name} photo={doctor.photo_url} size={44} primary={primary} />
        <div>
          <div style={{ fontWeight:700, fontSize:14, color:'#1A2B3C' }}>{doctor.full_name}</div>
          <div style={{ fontSize:12, color:'#6B7280' }}>{doctor.specialty}</div>
        </div>
      </div>
      <div style={{ textAlign:'center', padding:'24px 12px' }}>
        <div style={{ fontSize:42, marginBottom:8 }}>📅</div>
        <p style={{ fontWeight:700, color:'#1A2B3C', fontSize:15, margin:'0 0 4px' }}>У врача пока нет расписания</p>
        <p style={{ fontSize:13, color:'#6B7280', margin:0 }}>Запишитесь позже — расписание появится в кабинете</p>
        <button onClick={onClose}
          style={{ marginTop:18, padding:'11px 24px', background:`linear-gradient(135deg,${primary},#1565C0)`, color:'#fff', border:'none', borderRadius:12, fontSize:14, fontWeight:600, cursor:'pointer' }}>
          Закрыть
        </button>
      </div>
    </div>
  )

  return (
    <div>
      <div style={{ display:'flex', gap:12, alignItems:'center', marginBottom:16, padding:'12px', background:'#F8FAFF', borderRadius:12 }}>
        <DocAvatar name={doctor.full_name} photo={doctor.photo_url} size={44} primary={primary} />
        <div>
          <div style={{ fontWeight:700, fontSize:14, color:'#1A2B3C' }}>{doctor.full_name}</div>
          <div style={{ fontSize:12, color:'#6B7280' }}>{doctor.specialty}</div>
        </div>
      </div>
      <p style={{ fontSize:13, fontWeight:600, color:'#1A2B3C', marginBottom:10 }}>Выберите дату:</p>

      {availLoading ? (
        <p style={{ textAlign:'center', color:'#9CA3AF', fontSize:13, padding:'12px 0' }}>Загрузка расписания...</p>
      ) : (
        <div style={{ display:'flex', gap:6, overflowX:'auto', paddingBottom:6, marginBottom:14, scrollbarWidth:'none' }}>
          {dates.map(d => {
            const key = isoDate(d)
            const info = availMap?.[key]
            const free = info?.free_slots || 0
            const enabled = free > 0
            const isSel = selDate && isoDate(selDate) === key
            return (
              <button key={d.toISOString()} onClick={() => pickDate(d)} disabled={!enabled}
                style={{
                  flexShrink:0, minWidth:54, padding:'8px 6px', borderRadius:10,
                  border:`1.5px solid ${isSel?primary:(enabled?'#E5E7EB':'#F3F4F6')}`,
                  background:isSel?primary+'18':(enabled?'#fff':'#F9FAFB'),
                  cursor:enabled?'pointer':'not-allowed',
                  textAlign:'center',
                  opacity:enabled?1:.55,
                  position:'relative',
                }}>
                <div style={{ fontWeight:600, fontSize:12, color:isSel?primary:(enabled?'#1A2B3C':'#9CA3AF') }}>
                  {d.getDate()} {MONTHS_R[d.getMonth()]}
                </div>
                <div style={{ fontSize:10, color:'#9CA3AF' }}>{DAYS_R[d.getDay()]}</div>
                {enabled && (
                  <div style={{ fontSize:9, color: isSel?primary:'#10B981', fontWeight:700, marginTop:2 }}>
                    {free} {free === 1 ? 'слот' : (free < 5 ? 'слота' : 'слотов')}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      )}

      {!availLoading && availMap && Object.values(availMap).every(d => !d.free_slots) && (
        <p style={{ textAlign:'center', color:'#9CA3AF', fontSize:13, padding:'12px 0' }}>
          На ближайшие 2 недели свободных слотов нет
        </p>
      )}

      {selDate && (
        slotsLoading
          ? <p style={{ textAlign:'center', color:'#9CA3AF', fontSize:13, padding:'12px 0' }}>Загрузка слотов...</p>
          : slots.length===0
            ? <p style={{ textAlign:'center', color:'#9CA3AF', fontSize:13, padding:'12px 0' }}>Нет свободных слотов</p>
            : <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:6, marginBottom:14 }}>
                {slots.map(s => (
                  <button key={s.start_time} onClick={() => setSlot(s.start_time)}
                    style={{ padding:'9px 4px', borderRadius:8, border:`1.5px solid ${selSlot===s.start_time?primary:'#E5E7EB'}`, background:selSlot===s.start_time?primary+'18':'#fff', color:selSlot===s.start_time?primary:'#1A2B3C', fontWeight:selSlot===s.start_time?700:400, cursor:'pointer', fontSize:13 }}>
                    {s.start_time}
                  </button>
                ))}
              </div>
      )}
      {selSlot && (
        <div>
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="Ваше имя"
            style={{ width:'100%', padding:'11px 12px', border:'1.5px solid #E5E7EB', borderRadius:10, fontSize:14, outline:'none', marginBottom:10, boxSizing:'border-box' }} />
          {err && <p style={{ color:'#EF4444', fontSize:13, marginBottom:8 }}>{err}</p>}
          <button onClick={book} disabled={booking}
            style={{ width:'100%', padding:'13px', background:`linear-gradient(135deg,${primary},#1565C0)`, color:'#fff', border:'none', borderRadius:12, fontSize:14, fontWeight:600, cursor:'pointer', opacity:booking?0.7:1 }}>
            {booking?'Запись...':`Записаться на ${selSlot}`}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Перенос записи: модалка с выбором нового слота к тому же врачу ──────────
// TODO(design-system): RescheduleModal — bottom-sheet с горизонтальным списком
//   дней и сеткой слотов; на <Modal> легко уносится, но потеряется специфичная
//   мобильная динамика (max-height, overflow). Переведём при редизайне формы
//   записи (вместе с QuickBook/SheetModal).
function RescheduleModal({ apt, primary, onClose, onDone }) {
  // Подгружаем доступность по тому же doctor_id что и в записи
  const dates = Array.from({length:14},(_,i)=>{ const d=new Date(); d.setDate(d.getDate()+i); return d })
  const [selDate, setSelDate] = useState(null)
  const [slots, setSlots] = useState([])
  const [slotsLoading, setSL] = useState(false)
  const [selSlot, setSlot] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [availMap, setAvailMap] = useState(null)
  const [availLoading, setAvLoad] = useState(true)

  useEffect(() => {
    let alive = true
    ;(async () => {
      setAvLoad(true)
      try {
        const today = new Date()
        const to = new Date(); to.setDate(to.getDate() + 13)
        const r = await axios.get(`${API}/public/${SLUG}/doctors/${apt.doctor_id}/availability`, {
          params: { from: isoDate(today), to: isoDate(to) },
        })
        if (!alive) return
        const map = {}; (r.data?.days||[]).forEach(d => { map[d.date] = d })
        setAvailMap(map)
      } catch { if (alive) setAvailMap({}) }
      finally { if (alive) setAvLoad(false) }
    })()
    return () => { alive = false }
  }, [apt.doctor_id])

  async function pickDate(d) {
    const key = isoDate(d)
    if (availMap && (!availMap[key] || !availMap[key].free_slots)) return
    setSelDate(d); setSlot(null); setSlots([]); setSL(true)
    try {
      const r = await axios.get(`${API}/public/${SLUG}/doctors/${apt.doctor_id}/slots`, { params:{ date: key } })
      const list = Array.isArray(r.data) ? r.data.filter(s => s.available !== false) : []
      setSlots(list)
    } catch { setSlots([]) } finally { setSL(false) }
  }

  async function submit() {
    if (!selSlot) { setErr('Выберите время'); return }
    if (!apt.patient_token) { setErr('Токен записи отсутствует — войдите заново по QR'); return }
    setBusy(true); setErr('')
    try {
      const r = await axios.post(
        `${API}/patient/appointment/${apt.id}/reschedule`,
        { appointment_date: isoDate(selDate), start_time: selSlot },
        { params: { t: apt.patient_token } }
      )
      onDone && onDone(r.data)
      onClose && onClose()
    } catch (e) {
      const code = e.response?.status
      setErr(e.response?.data?.detail || (code === 409 ? 'Слот уже занят, выберите другое время' : 'Не удалось перенести'))
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center" style={{ background:'rgba(0,0,0,.5)' }} onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-5 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-gray-900 text-base">Перенос записи</h3>
          <button onClick={onClose} className="text-gray-400 text-2xl leading-none">×</button>
        </div>
        <p className="text-xs text-gray-500 mb-4">{apt.doctor_name} · {apt.clinic_name}</p>

        <p style={{ fontSize:13, fontWeight:600, color:'#1A2B3C', marginBottom:8 }}>Выберите новую дату:</p>
        {availLoading ? (
          <p style={{ textAlign:'center', color:'#9CA3AF', fontSize:13, padding:'12px 0' }}>Загрузка расписания...</p>
        ) : (
          <div style={{ display:'flex', gap:6, overflowX:'auto', paddingBottom:6, marginBottom:14, scrollbarWidth:'none' }}>
            {dates.map(d => {
              const key = isoDate(d)
              const info = availMap?.[key]
              const free = info?.free_slots || 0
              const enabled = free > 0
              const isSel = selDate && isoDate(selDate) === key
              return (
                <button key={d.toISOString()} onClick={() => pickDate(d)} disabled={!enabled}
                  style={{ flexShrink:0, minWidth:54, padding:'8px 6px', borderRadius:10, border:`1.5px solid ${isSel?primary:(enabled?'#E5E7EB':'#F3F4F6')}`, background:isSel?primary+'18':(enabled?'#fff':'#F9FAFB'), cursor:enabled?'pointer':'not-allowed', textAlign:'center', opacity:enabled?1:.55 }}>
                  <div style={{ fontWeight:600, fontSize:12, color:isSel?primary:(enabled?'#1A2B3C':'#9CA3AF') }}>
                    {d.getDate()} {MONTHS_R[d.getMonth()]}
                  </div>
                  <div style={{ fontSize:10, color:'#9CA3AF' }}>{DAYS_R[d.getDay()]}</div>
                  {enabled && <div style={{ fontSize:9, color: isSel?primary:'#10B981', fontWeight:700, marginTop:2 }}>{free}</div>}
                </button>
              )
            })}
          </div>
        )}

        {selDate && (
          slotsLoading
            ? <p style={{ textAlign:'center', color:'#9CA3AF', fontSize:13, padding:'12px 0' }}>Загрузка слотов...</p>
            : slots.length===0
              ? <p style={{ textAlign:'center', color:'#9CA3AF', fontSize:13, padding:'12px 0' }}>Нет свободных слотов</p>
              : <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:6, marginBottom:14 }}>
                  {slots.map(s => (
                    <button key={s.start_time} onClick={() => setSlot(s.start_time)}
                      style={{ padding:'9px 4px', borderRadius:8, border:`1.5px solid ${selSlot===s.start_time?primary:'#E5E7EB'}`, background:selSlot===s.start_time?primary+'18':'#fff', color:selSlot===s.start_time?primary:'#1A2B3C', fontWeight:selSlot===s.start_time?700:400, cursor:'pointer', fontSize:13 }}>
                      {s.start_time}
                    </button>
                  ))}
                </div>
        )}
        {err && <p style={{ color:'#EF4444', fontSize:13, marginBottom:8 }}>{err}</p>}
        <button onClick={submit} disabled={!selSlot || busy}
          className="w-full h-12 rounded-2xl text-sm font-bold text-white transition-all"
          style={{ background:`linear-gradient(135deg,${primary},#1565C0)`, opacity: (!selSlot || busy) ? .55 : 1 }}>
          {busy ? 'Переносим...' : (selSlot ? `Перенести на ${selSlot}` : 'Выберите время')}
        </button>
      </div>
    </div>
  )
}

// ── Полноэкранный профиль врача ─────────────────────────────────────────────
// TODO(design-system): DoctorProfileModal — полноэкранный экран профиля врача
//   с фиксированным header/footer и сложной структурой. Переход на <Modal>
//   сломает плавающий action-bar и safe-area inset обработку. Оставляем
//   с собственной разметкой; компоненты <Card>/<Button> внедрим точечно при
//   следующем редизайне профиля врача.
function DoctorProfileModal({ doc, tenantId, primary, patientName, patientPhone, onRefreshHistory, onClose }) {
  const [profile, setProfile] = useState(null)
  const [profLoading, setPL] = useState(true)
  const [bookOpen, setBookOpen] = useState(false)
  const [revOpen, setRevOpen] = useState(false)

  useEffect(() => {
    let alive = true
    setPL(true)
    axios.get(`${API}/public/${SLUG}/doctors/${doc.id}/profile`)
      .then(r => { if (alive) setProfile(r.data) })
      .catch(() => { if (alive) setProfile(null) })
      .finally(() => { if (alive) setPL(false) })
    // блокируем прокрутку body на время модалки
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { alive = false; document.body.style.overflow = prev }
  }, [doc.id])

  // данные врача — приоритет detailed, fallback на исходную карточку
  const d = profile?.doctor || doc
  const avg = profile?.avg_rating ?? doc.avg_rating
  const totalReviews = profile?.total_reviews ?? doc.review_count ?? 0
  const reviews = profile?.reviews || []
  const breakdown = profile?.rating_breakdown || {}
  const hasSchedule = (profile?.doctor?.has_schedule) ?? doc.has_schedule

  return (
    <div style={{ position:'fixed', inset:0, zIndex:300, background:'#F0F4F8', display:'flex', flexDirection:'column', animation:'docProfIn .28s cubic-bezier(.22,1,.36,1)' }}>
      <style>{`@keyframes docProfIn{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}`}</style>

      {/* Header с back-button — z-index приоритетный, чтобы кнопка была кликабельна на мобильнике */}
      <div style={{ position:'sticky', top:0, zIndex:50, background:`linear-gradient(135deg,${primary},#1565C0)`, color:'#fff', paddingTop:'env(safe-area-inset-top,0px)', boxShadow:'0 2px 12px rgba(0,0,0,.15)' }}>
        <div style={{ display:'flex', alignItems:'center', padding:'10px 12px', gap:10 }}>
          <button onClick={onClose} aria-label="Назад"
            style={{ width:44, height:44, minWidth:44, borderRadius:14, background:'rgba(255,255,255,.22)', border:'none', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
            <span className="material-symbols-outlined" style={{ color:'#fff', fontSize:24 }}>arrow_back</span>
          </button>
          <div style={{ flex:1, minWidth:0 }}>
            <p style={{ margin:0, fontSize:11, color:'rgba(255,255,255,.7)', fontWeight:600, letterSpacing:.5, textTransform:'uppercase' }}>Профиль врача</p>
            <p style={{ margin:0, fontSize:14, color:'#fff', fontWeight:700, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{d.full_name}</p>
          </div>
          <button onClick={onClose} aria-label="Закрыть"
            style={{ width:40, height:40, borderRadius:12, background:'rgba(255,255,255,.18)', border:'none', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
            <span className="material-symbols-outlined" style={{ color:'#fff', fontSize:22 }}>close</span>
          </button>
        </div>
      </div>

      {/* Контент */}
      <div style={{ flex:1, overflowY:'auto', padding:'16px 14px 110px', maxWidth:560, width:'100%', margin:'0 auto', boxSizing:'border-box' }}>
        {/* Карточка с фото и основной инфой */}
        <div style={{ background:'#fff', borderRadius:24, padding:20, boxShadow:'0 4px 20px rgba(0,0,0,.06)', border:'1px solid rgba(0,0,0,.04)', marginBottom:14 }}>
          <div style={{ display:'flex', gap:16, alignItems:'flex-start' }}>
            {/* Большое фото / placeholder */}
            {d.photo_url ? (
              <img src={d.photo_url} alt={d.full_name}
                style={{ width:96, height:96, borderRadius:24, objectFit:'cover', flexShrink:0, boxShadow:'0 4px 14px rgba(0,0,0,.1)' }} />
            ) : (
              <div style={{ width:96, height:96, borderRadius:24, background:`linear-gradient(135deg,${primary},#1565C0)`, display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontWeight:700, fontSize:32, flexShrink:0, boxShadow:'0 4px 14px rgba(0,0,0,.1)' }}>
                {(d.full_name||'?').split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase()}
              </div>
            )}
            <div style={{ flex:1, minWidth:0 }}>
              <h2 style={{ margin:'0 0 4px', fontSize:18, fontWeight:800, color:'#1A2B3C', lineHeight:1.25 }}>{d.full_name}</h2>
              <p style={{ margin:'0 0 6px', fontSize:14, color:primary, fontWeight:700 }}>{d.specialty || 'Врач'}</p>
              {d.experience_years && (
                <p style={{ margin:'0 0 4px', fontSize:12, color:'#6B7280' }}>
                  <span style={{ fontWeight:600, color:'#1A2B3C' }}>Стаж:</span> {d.experience_years} лет
                </p>
              )}
              {d.clinic_name && (
                <p style={{ margin:0, fontSize:12, color:'#9CA3AF' }}>{d.clinic_name}</p>
              )}
            </div>
          </div>

          {/* Рейтинг крупно */}
          {avg ? (
            <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:14, paddingTop:14, borderTop:'1px solid #F3F4F6' }}>
              <div style={{ fontSize:32, fontWeight:800, color:'#1A2B3C', lineHeight:1 }}>{avg}</div>
              <div>
                <Stars rating={avg} size={16} />
                <div style={{ fontSize:12, color:'#9CA3AF', marginTop:2 }}>{totalReviews} {totalReviews===1?'отзыв':(totalReviews<5?'отзыва':'отзывов')}</div>
              </div>
            </div>
          ) : (
            <p style={{ margin:'14px 0 0', paddingTop:14, borderTop:'1px solid #F3F4F6', fontSize:12, color:'#9CA3AF' }}>Пока нет оценок</p>
          )}
        </div>

        {/* Биография — полностью без обрезки */}
        {d.bio && (
          <div style={{ background:'#fff', borderRadius:24, padding:18, boxShadow:'0 4px 20px rgba(0,0,0,.06)', border:'1px solid rgba(0,0,0,.04)', marginBottom:14 }}>
            <h3 style={{ margin:'0 0 8px', fontSize:14, fontWeight:700, color:'#1A2B3C' }}>О враче</h3>
            <p style={{ margin:0, fontSize:14, color:'#374151', lineHeight:1.6, whiteSpace:'pre-wrap' }}>{d.bio}</p>
          </div>
        )}

        {d.education && (
          <div style={{ background:'#fff', borderRadius:24, padding:18, boxShadow:'0 4px 20px rgba(0,0,0,.06)', border:'1px solid rgba(0,0,0,.04)', marginBottom:14 }}>
            <h3 style={{ margin:'0 0 8px', fontSize:14, fontWeight:700, color:'#1A2B3C' }}>Образование</h3>
            <p style={{ margin:0, fontSize:14, color:'#374151', lineHeight:1.6, whiteSpace:'pre-wrap' }}>{d.education}</p>
          </div>
        )}

        {/* Распределение оценок */}
        {totalReviews > 0 && (
          <div style={{ background:'#fff', borderRadius:24, padding:18, boxShadow:'0 4px 20px rgba(0,0,0,.06)', border:'1px solid rgba(0,0,0,.04)', marginBottom:14 }}>
            <h3 style={{ margin:'0 0 12px', fontSize:14, fontWeight:700, color:'#1A2B3C' }}>Оценки</h3>
            {[5,4,3,2,1].map(s => <RatingBar key={s} star={s} count={breakdown[s]||0} total={totalReviews} primary={primary} />)}
          </div>
        )}

        {/* Список отзывов */}
        <div style={{ background:'#fff', borderRadius:24, padding:'4px 18px 14px', boxShadow:'0 4px 20px rgba(0,0,0,.06)', border:'1px solid rgba(0,0,0,.04)' }}>
          <h3 style={{ margin:'14px 0 6px', fontSize:14, fontWeight:700, color:'#1A2B3C' }}>Отзывы пациентов</h3>
          {profLoading && <p style={{ textAlign:'center', color:'#9CA3AF', fontSize:13, padding:'12px 0' }}>Загрузка...</p>}
          {!profLoading && reviews.length === 0 && (
            <p style={{ textAlign:'center', color:'#9CA3AF', fontSize:13, padding:'14px 0' }}>Отзывов пока нет</p>
          )}
          {reviews.map(r => (
            <div key={r.id} style={{ padding:'12px 0', borderTop:'1px solid #F0F1F5' }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                <span style={{ fontWeight:600, fontSize:13, color:'#1A2B3C' }}>{r.is_anonymous ? 'Анонимно' : (r.patient_name || 'Пациент')}</span>
                <span style={{ fontSize:11, color:'#9CA3AF' }}>{fmt(r.created_at)}</span>
              </div>
              <Stars rating={r.rating} size={13} />
              {r.comment && <p style={{ margin:'6px 0 0', fontSize:13, color:'#374151', lineHeight:1.55 }}>{r.comment}</p>}
            </div>
          ))}
        </div>
      </div>

      {/* Плавающие кнопки внизу */}
      <div style={{ position:'fixed', left:0, right:0, bottom:0, padding:'10px 14px', paddingBottom:'calc(env(safe-area-inset-bottom,0px) + 10px)', background:'rgba(255,255,255,.96)', backdropFilter:'blur(12px)', borderTop:'1px solid rgba(0,0,0,.06)', boxShadow:'0 -4px 20px rgba(0,0,0,.06)', zIndex:6 }}>
        <div style={{ maxWidth:560, margin:'0 auto', display:'flex', gap:8 }}>
          <button onClick={() => setRevOpen(true)}
            style={{ flex:1, padding:'13px', background:'#fff', color:primary, border:`1.5px solid ${primary}`, borderRadius:14, fontSize:14, fontWeight:700, cursor:'pointer' }}>
            ✍️ Отзыв
          </button>
          {hasSchedule && (
            <button onClick={() => setBookOpen(true)}
              style={{ flex:2, padding:'13px', background:`linear-gradient(135deg,${primary},#1565C0)`, color:'#fff', border:'none', borderRadius:14, fontSize:14, fontWeight:700, cursor:'pointer', boxShadow:'0 4px 14px rgba(0,151,167,.3)' }}>
              Записаться к врачу
            </button>
          )}
        </div>
      </div>

      <SheetModal open={bookOpen} onClose={() => setBookOpen(false)} title="Запись к врачу">
        <QuickBook doctor={d} primary={primary} patientName={patientName} patientPhone={patientPhone}
          onClose={() => setBookOpen(false)} onBooked={onRefreshHistory} />
      </SheetModal>
      <SheetModal open={revOpen} onClose={() => setRevOpen(false)} title="Оставить отзыв">
        <ReviewForm doctorId={d.id} tenantId={tenantId} primary={primary}
          onClose={() => setRevOpen(false)} onDone={() => setRevOpen(false)} />
      </SheetModal>
    </div>
  )
}

function DoctorCard({ doc, tenantId, primary, patientName, patientPhone, onRefreshHistory }) {
  const [bookOpen, setBookOpen] = useState(false)
  const [revOpen, setRevOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)

  return (
    <div style={{ background:'#fff', borderRadius:18, border:'1px solid #EAECF0', overflow:'hidden', marginBottom:12, boxShadow:'0 2px 10px rgba(0,0,0,.05)' }}>
      {/* Кликабельная область — открывает полный профиль */}
      <button type="button" onClick={() => setProfileOpen(true)}
        style={{ display:'block', width:'100%', padding:'18px 16px 14px', background:'transparent', border:'none', textAlign:'left', cursor:'pointer' }}>
        <div style={{ display:'flex', gap:14, alignItems:'flex-start' }}>
          <DocAvatar name={doc.full_name} photo={doc.photo_url} size={60} primary={primary} />
          <div style={{ flex:1, minWidth:0 }}>
            <h3 style={{ margin:'0 0 2px', fontSize:15, color:'#1A2B3C', fontWeight:700, lineHeight:1.3 }}>{doc.full_name}</h3>
            <p style={{ margin:'0 0 3px', fontSize:13, color:primary, fontWeight:600 }}>{doc.specialty||'Врач'}</p>
            <p style={{ margin:'0 0 5px', fontSize:12, color:'#9CA3AF' }}>
              {doc.experience_years ? `Стаж ${doc.experience_years} лет · ` : ''}{doc.clinic_name}
            </p>
            {doc.avg_rating ? (
              <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                <Stars rating={doc.avg_rating} size={13} />
                <b style={{ fontSize:13, color:'#1A2B3C' }}>{doc.avg_rating}</b>
                <span style={{ fontSize:12, color:'#C4C9D4' }}>({doc.review_count})</span>
              </div>
            ) : <span style={{ fontSize:12, color:'#C4C9D4' }}>Нет оценок</span>}
          </div>
          <span className="material-symbols-outlined" style={{ color:'#C4C9D4', fontSize:22 }}>chevron_right</span>
        </div>
        {doc.bio && (
          <p style={{ margin:'12px 0 0', fontSize:13, color:'#6B7280', lineHeight:1.6, display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>
            {doc.bio}
          </p>
        )}
      </button>

      <div style={{ display:'flex', borderTop:'1px solid #F3F4F6' }}>
        {doc.has_schedule && (
          <button onClick={(e) => { e.stopPropagation(); setBookOpen(true) }}
            style={{ flex:2, padding:'13px', background:`linear-gradient(135deg,${primary},#1565C0)`, color:'#fff', border:'none', fontSize:13, fontWeight:700, cursor:'pointer', letterSpacing:.3 }}>
            Записаться
          </button>
        )}
        <button onClick={(e) => { e.stopPropagation(); setRevOpen(true) }}
          style={{ flex:1, padding:'13px', border:'none', borderLeft: doc.has_schedule ? '1px solid rgba(255,255,255,.15)' : '1px solid #F3F4F6', color: doc.has_schedule ? 'rgba(255,255,255,.85)' : '#6B7280', fontSize:12, cursor:'pointer', background: doc.has_schedule ? 'transparent' : '#FAFBFF' }}>
          ✍️ Отзыв
        </button>
      </div>

      {profileOpen && (
        <DoctorProfileModal doc={doc} tenantId={tenantId} primary={primary}
          patientName={patientName} patientPhone={patientPhone}
          onRefreshHistory={onRefreshHistory}
          onClose={() => setProfileOpen(false)} />
      )}

      <SheetModal open={bookOpen} onClose={() => setBookOpen(false)} title="Запись к врачу">
        <QuickBook doctor={doc} primary={primary} patientName={patientName} patientPhone={patientPhone}
          onClose={() => setBookOpen(false)} onBooked={onRefreshHistory} />
      </SheetModal>
      <SheetModal open={revOpen} onClose={() => setRevOpen(false)} title="Оставить отзыв">
        <ReviewForm doctorId={doc.id} tenantId={tenantId} primary={primary}
          onClose={() => setRevOpen(false)} onDone={() => setRevOpen(false)} />
      </SheetModal>
    </div>
  )
}

function DoctorsTab({ primary, patientName, patientPhone, onRefreshHistory }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [specFilter, setSpec] = useState('')

  useEffect(() => {
    axios.get(`${API}/public/${SLUG}/clinic`)
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={{ display:'flex', justifyContent:'center', padding:'40px 0' }}><div style={{ width:32, height:32, border:`3px solid #E0F7FA`, borderTopColor:primary, borderRadius:'50%', animation:'spin .8s linear infinite' }}/></div>
  if (!data) return <p style={{ textAlign:'center', color:'#9CA3AF', padding:'40px 0' }}>Не удалось загрузить список врачей</p>

  const { specialties = [], doctors = [] } = data
  const filtered = specFilter ? doctors.filter(d => d.specialty===specFilter) : doctors
  const sorted = [...filtered.filter(d=>d.has_schedule), ...filtered.filter(d=>!d.has_schedule)]
  const tenantId = data.tenant?.id

  return (
    <div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      {specialties.length>1 && (
        <div style={{ display:'flex', gap:6, overflowX:'auto', paddingBottom:4, marginBottom:14, scrollbarWidth:'none' }}>
          {['', ...specialties].map(s => (
            <button key={s||'all'} onClick={() => setSpec(s)}
              style={{ flexShrink:0, padding:'6px 14px', borderRadius:20, border:`1.5px solid ${specFilter===s?primary:'#E5E7EB'}`, background:specFilter===s?primary+'14':'#fff', color:specFilter===s?primary:'#6B7280', fontSize:13, fontWeight:specFilter===s?700:400, cursor:'pointer', whiteSpace:'nowrap' }}>
              {s||'Все специальности'}
            </button>
          ))}
        </div>
      )}
      {sorted.length===0
        ? <p style={{ textAlign:'center', color:'#9CA3AF', padding:'40px 0' }}>Нет врачей</p>
        : sorted.map(doc => (
          <DoctorCard key={doc.id} doc={doc} tenantId={tenantId} primary={primary}
            patientName={patientName} patientPhone={patientPhone} onRefreshHistory={onRefreshHistory} />
        ))
      }
    </div>
  )
}

// ===== БЛОК: HealthHub — подвкладки «Здоровье» (Vitals/MedCard/Prescriptions/Documents) =====
// Подвкладки переключаются через <Tabs> дизайн-системы (горизонтальный список со скроллом).
function HealthHub({ sessionToken, phone }) {
  const [sub, setSub] = useState('vitals')
  const SUBS = [
    { key: 'vitals',        label: 'Показатели', icon: 'monitoring' },
    { key: 'medcard',       label: 'Карта',      icon: 'medical_information' },
    { key: 'prescriptions', label: 'Лекарства',  icon: 'medication' },
    { key: 'documents',     label: 'Документы',  icon: 'folder' },
  ]
  // items для <Tabs> — лейблы с иконками material-symbols
  const tabItems = SUBS.map(s => ({
    id: s.key,
    label: (
      <span className="inline-flex items-center gap-1">
        <span className="material-symbols-outlined" style={{ fontSize: 15 }}>{s.icon}</span>
        {s.label}
      </span>
    ),
  }))
  return (
    <div>
      <div className="mb-4 -mx-1 px-1 overflow-x-auto pb-1">
        <Tabs items={tabItems} value={sub} onChange={setSub} />
      </div>
      <Suspense fallback={<div className="text-center py-12 text-gray-400 text-sm">Загрузка…</div>}>
        {sub === 'vitals'        && <VitalsTab sessionToken={sessionToken} phone={phone} />}
        {sub === 'medcard'       && <MedCardTab sessionToken={sessionToken} phone={phone} apiBase={API_BASE} />}
        {sub === 'prescriptions' && <PrescriptionsTab sessionToken={sessionToken} apiBase={API_BASE} />}
        {sub === 'documents'     && <DocumentsTab sessionToken={sessionToken} apiBase={API_BASE} />}
      </Suspense>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function PatientCabinet() {
  // Замена alert/confirm на Toast и Modal
  const { toast } = useToast()
  const { confirm, ConfirmHost } = useConfirm()
  // Единый переключатель темы (синхронизирован с другими кабинетами)
  const { isDark, toggle: toggleTheme } = useTheme()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showLogin, setShowLogin] = useState(false)
  const [tab, setTab] = useState('home')
  const [fullscreenQr, setFullscreenQr] = useState(null)
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushLoading, setPushLoading] = useState(false)
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [showInstall, setShowInstall] = useState(false)
  const [showIosHint, setShowIosHint] = useState(false)
  const [searchQ, setSearchQ] = useState('')
  const [bannerAds, setBannerAds] = useState([])
  const [bannerIdx, setBannerIdx] = useState(0)
  // ── Премиум-фичи ──
  const [reschedAptId, setReschedAptId] = useState(null) // открытая модалка переноса
  const [familyOpen, setFamilyOpen] = useState(false)
  const [familyList, setFamilyList] = useState([])
  const [activeProfilePhone, setActiveProfilePhone] = useState(null) // телефон активного профиля

  useEffect(() => {
    registerSW()
    // Telegram SDK подгружается ТОЛЬКО для /p/ — пациенты могут заходить через
    // Telegram-бот, и тогда нужен initData. Лендинг и кабинеты сотрудников
    // его не загружают (см. lib/tg.js loadTelegramSDK).
    loadTelegramSDK()
    const handler = (e) => { e.preventDefault(); setDeferredPrompt(e); setShowInstall(true) }
    window.addEventListener('beforeinstallprompt', handler)
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || !!window.navigator.standalone
    const dismissed = localStorage.getItem('clinika_ios_hint_ts')
    const staleDays = dismissed ? (Date.now() - parseInt(dismissed)) / 86400000 : 999
    if (isIos && !isStandalone && staleDays > 7) setShowIosHint(true)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  useEffect(() => {
    if (bannerAds.length > 1) {
      const id = setInterval(() => setBannerIdx(i => (i+1) % bannerAds.length), 5000)
      return () => clearInterval(id)
    }
  }, [bannerAds.length])

  useEffect(() => {
    const urlPath = window.location.pathname
    const urlSearch = window.location.search
    const urlMatch = urlPath.match(/\/p\/([0-9a-f-]{36})/)
    const urlToken = new URLSearchParams(urlSearch).get('t')
    const urlSession = new URLSearchParams(urlSearch).get('s')

    // Загрузка рекламы — независимо от способа входа
    const loadAds = () => axios.get(`${API}/ads/active`, { params: { slug: SLUG, ad_type: 'banner' } })
      .then(r => setBannerAds(Array.isArray(r.data) ? r.data : [])).catch(() => {})

    // 1) Авто-вход по URL с patient_token (QR-сценарий): /{slug}/p/{id}?t={token}
    if (urlMatch && urlToken) {
      const urlId = urlMatch[1]
      localStorage.setItem(TOKEN_KEY, urlToken)
      localStorage.setItem(REF_KEY, urlId)
      loadData(urlId, urlToken)
      loadAds()
      return
    }

    // 2) Авто-вход по session_token из URL (опционально)
    if (urlSession) {
      localStorage.setItem(SESSION_KEY, urlSession)
      restoreFromSession(urlSession); loadAds(); return
    }

    // 3) Автологин по сохранённой long-lived session (PWA-ярлык, повторный заход)
    const session = localStorage.getItem(SESSION_KEY)
    if (session) {
      restoreFromSession(session); loadAds(); return
    }

    // 4) Старая схема: TOKEN_KEY + REF_KEY (совместимость)
    const token = localStorage.getItem(TOKEN_KEY)
    const refId = localStorage.getItem(REF_KEY)
    if (token && refId) {
      loadData(refId, token); loadAds(); return
    }

    setLoading(false); setShowLogin(true)
  }, [])

  const ensureSession = async (token) => {
    if (localStorage.getItem(SESSION_KEY)) {
      updateManifestStartUrl(localStorage.getItem(SESSION_KEY))
      try { window.history.replaceState(null, '', `/${SLUG}/p?s=${encodeURIComponent(localStorage.getItem(SESSION_KEY))}`) } catch {}
      return
    }
    try {
      const r = await axios.post(`${API}/patient/session/from-token`, { patient_token: token })
      const s = r.data.session_token
      if (s) {
        localStorage.setItem(SESSION_KEY, s)
        updateManifestStartUrl(s)
        try { window.history.replaceState(null, '', `/${SLUG}/p?s=${encodeURIComponent(s)}`) } catch {}
      }
    } catch {}
  }

  const loadData = async (refId, token) => {
    setLoading(true); setError('')
    try {
      const r = await axios.get(`${API}/patient/${refId}?t=${token}`)
      setData(r.data)
      ensureSession(token)
    } catch (e) {
      const status = e.response?.status
      // 403 (просрочен/невалидный токен), 404 (направление удалено), 410 — фолбэк на session
      if (status === 403 || status === 404 || status === 410) {
        localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(REF_KEY)
        const s = localStorage.getItem(SESSION_KEY)
        if (s) { restoreFromSession(s); return }
        setError('')
        setShowLogin(true)
      } else {
        setError(e.response?.data?.detail || 'Ошибка загрузки')
      }
    } finally { setLoading(false) }
  }

  const restoreFromSession = async (sessionToken) => {
    setLoading(true); setError('')
    try {
      const r = await axios.post(`${API}/patient/session/restore`, { session_token: sessionToken })
      setData(r.data)
      if (r.data.referral_id && r.data.patient_token) {
        localStorage.setItem(TOKEN_KEY, r.data.patient_token)
        localStorage.setItem(REF_KEY, r.data.referral_id)
      }
      updateManifestStartUrl(sessionToken)
      try { window.history.replaceState(null, '', `/${SLUG}/p?s=${encodeURIComponent(sessionToken)}`) } catch {}
    } catch (e) {
      if (e.response?.status === 401) {
        localStorage.removeItem(SESSION_KEY)
        setShowLogin(true)
      } else {
        setError(e.response?.data?.detail || 'Ошибка загрузки')
      }
    } finally { setLoading(false) }
  }

  const handleLogin = (refId, token, sessionToken) => {
    localStorage.setItem(TOKEN_KEY, token); localStorage.setItem(REF_KEY, refId)
    if (sessionToken) localStorage.setItem(SESSION_KEY, sessionToken)
    setShowLogin(false); loadData(refId, token)
  }

  // Универсальный reload — работает и в session-режиме, и в legacy (token+ref)
  const reloadCabinet = useCallback(async () => {
    const session = localStorage.getItem(SESSION_KEY)
    if (session) { await restoreFromSession(session); return }
    const refId = localStorage.getItem(REF_KEY)
    const tk = localStorage.getItem(TOKEN_KEY)
    if (refId && tk) { await loadData(refId, tk) }
  }, [])

  // ── Семейный аккаунт: загрузка списка ──
  const loadFamily = useCallback(async () => {
    const session = localStorage.getItem(SESSION_KEY)
    if (!session) { setFamilyList([]); return }
    try {
      const r = await axios.get(`${API}/patient/family`, { params: { t: session } })
      setFamilyList(Array.isArray(r.data) ? r.data : [])
    } catch { setFamilyList([]) }
  }, [])

  useEffect(() => { if (data) loadFamily() }, [data, loadFamily])

  const switchProfile = async (memberPhone, shortCode) => {
    const session = localStorage.getItem(SESSION_KEY)
    if (!session) { toast('Только из session-режима. Войдите по коду заново.', 'warn', 5000); return }
    try {
      const r = await axios.post(`${API}/patient/session/switch`, { phone: memberPhone, short_code: shortCode }, { params: { t: session } })
      const newSession = r.data.session_token
      if (newSession) {
        localStorage.setItem(SESSION_KEY, newSession)
        localStorage.removeItem(TOKEN_KEY)
        localStorage.removeItem(REF_KEY)
        setActiveProfilePhone(memberPhone)
        setFamilyOpen(false)
        await restoreFromSession(newSession)
      }
    } catch (e) {
      toast(e.response?.data?.detail || 'Не удалось переключиться', 'error')
    }
  }

  const handlePushToggle = async () => {
    if (pushEnabled) return
    setPushLoading(true)
    try {
      if ((await Notification.requestPermission()) === 'granted') {
        const ok = await subscribePush(data?.patient_phone, localStorage.getItem(TOKEN_KEY))
        setPushEnabled(ok)
      }
    } catch {}
    setPushLoading(false)
  }

  const handleInstall = async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt(); await deferredPrompt.userChoice
    setDeferredPrompt(null); setShowInstall(false)
  }

  const handleLogout = async () => {
    const session = localStorage.getItem(SESSION_KEY)
    if (session) {
      try { await axios.post(`${API}/patient/session/logout`, { session_token: session }) } catch {}
    }
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(REF_KEY)
    localStorage.removeItem(SESSION_KEY)
    localStorage.removeItem(SLUG_KEY)
    setData(null); setShowLogin(true)
  }

  // ── Loading ──
  if (loading) return (
    <div className="min-h-screen flex flex-col items-center justify-center" style={{ background: 'linear-gradient(160deg,#0A2342 0%,#1565C0 60%,#0097A7 100%)' }}>
      <div className="w-20 h-20 rounded-3xl flex items-center justify-center mb-6" style={{ background: 'rgba(255,255,255,.15)', backdropFilter: 'blur(12px)' }}>
        <span className="material-symbols-outlined text-white text-4xl animate-pulse" style={{ fontVariationSettings:"'FILL' 1" }}>medical_services</span>
      </div>
      <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin mb-3" />
      <p className="text-blue-200 text-sm">Загрузка кабинета...</p>
    </div>
  )

  if (fullscreenQr) return <QrFullscreen qr={fullscreenQr} onClose={() => setFullscreenQr(null)} />
  if (showLogin) return <LoginScreen onLogin={handleLogin} errorMsg={error} />
  if (!data) return null

  const isApt = data?.type === 'appointment'
  const { current, other_referrals = [], mis_info, mis_visits = [], appointments = [], patient_name: _pname, patient_phone: _pphone } = isApt ? {} : data
  const patient_name  = isApt ? data.patient_name  : _pname
  const patient_phone = isApt ? data.patient_phone : _pphone
  const allRefs = isApt ? [] : [current, ...other_referrals].filter(Boolean)
  const activeRefs = allRefs.filter(r => r.status === 'created' || r.status === 'confirmed')
  const searchedRefs = searchQ ? allRefs.filter(r => (r.to_clinic_name + r.service_name + (r.short_code||'')).toLowerCase().includes(searchQ.toLowerCase())) : allRefs

  const TABS = isApt
    ? [
        { key: 'home',    icon: 'home',       label: 'Запись'  },
        { key: 'support', icon: 'chat_bubble', label: 'Чат'    },
      ]
    : [
        { key: 'home',         icon: 'home',                label: 'Главная'    },
        { key: 'appointments', icon: 'event_available',     label: 'Записи'     },
        { key: 'referrals',    icon: 'assignment',          label: 'Направления'},
        { key: 'health',       icon: 'health_and_safety',   label: 'Здоровье'   },
        { key: 'doctors',      icon: 'stethoscope',         label: 'Врачи'      },
        { key: 'support',      icon: 'chat_bubble',         label: 'Чат'        },
      ]

  const initials = (patient_name || patient_phone || 'П').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase()

  return (
    <div className="min-h-screen pb-24" style={{ background: '#F0F4F8' }}>
      <style>{`
        @keyframes slideUp { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        @keyframes tabSlide { from{opacity:0;transform:translateX(16px)} to{opacity:1;transform:translateX(0)} }
        .tab-enter { animation: tabSlide .25s cubic-bezier(.22,1,.36,1) }
        .card-in { animation: slideUp .35s cubic-bezier(.22,1,.36,1) both }
        @keyframes shimmer { 0%{transform:translateX(-100%)} 100%{transform:translateX(100%)} }
        @keyframes adGlow { 0%,100%{opacity:.7} 50%{opacity:1} }
      `}</style>

      {/* ── Hero Header ── */}
      <div className="relative overflow-hidden" style={{ background: 'linear-gradient(145deg,#0A2342 0%,#1565C0 70%,#0097A7 100%)', paddingBottom: 32 }}>
        {/* Decorative blobs */}
        <div className="absolute top-0 right-0 w-40 h-40 rounded-full" style={{ background: 'rgba(0,151,167,.2)', filter: 'blur(40px)', transform: 'translate(30%,-30%)' }} />
        <div className="absolute bottom-0 left-0 w-32 h-32 rounded-full" style={{ background: 'rgba(255,255,255,.05)', filter: 'blur(30px)', transform: 'translate(-30%,30%)' }} />

        <div className="relative max-w-lg mx-auto px-5 pt-12 pb-2">
          {/* Top bar */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="text-blue-200 text-xs font-medium">Добро пожаловать</p>
              <h1 className="text-white font-extrabold text-xl leading-tight mt-0.5 truncate max-w-[220px]">{patient_name || patient_phone}</h1>
            </div>
            <div className="flex items-center gap-2">
              {!pushEnabled && 'Notification' in window && (
                <button onClick={handlePushToggle} disabled={pushLoading}
                  className="w-10 h-10 rounded-xl flex items-center justify-center transition-all active:scale-90"
                  style={{ background: 'rgba(255,255,255,.15)' }}>
                  <span className="material-symbols-outlined text-white text-xl">notifications</span>
                </button>
              )}
              {pushEnabled && (
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(16,185,129,.25)' }}>
                  <span className="material-symbols-outlined text-emerald-300 text-xl" style={{ fontVariationSettings:"'FILL' 1" }}>notifications_active</span>
                </div>
              )}
              {(typeof window !== 'undefined' && localStorage.getItem(SESSION_KEY)) && (
                <button onClick={() => setFamilyOpen(true)} title="Семья"
                  className="w-10 h-10 rounded-xl flex items-center justify-center transition-all active:scale-90 relative"
                  style={{ background: 'rgba(255,255,255,.15)' }}>
                  <span className="material-symbols-outlined text-white text-xl">group</span>
                  {familyList.length > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center"
                      style={{ background:'#10B981', color:'#fff' }}>
                      {familyList.length}
                    </span>
                  )}
                </button>
              )}
              {/* Переключатель темы — единый хук useTheme */}
              <button onClick={toggleTheme}
                title={isDark ? 'Светлая тема' : 'Тёмная тема'}
                aria-label="Тема"
                className="w-10 h-10 rounded-xl flex items-center justify-center transition-all active:scale-90"
                style={{ background: 'rgba(255,255,255,.15)' }}>
                <span className="material-symbols-outlined text-white/80 text-xl">
                  {isDark ? 'light_mode' : 'dark_mode'}
                </span>
              </button>
              <button onClick={handleLogout}
                className="w-10 h-10 rounded-xl flex items-center justify-center transition-all active:scale-90"
                style={{ background: 'rgba(255,255,255,.15)' }}>
                <span className="material-symbols-outlined text-white/80 text-xl">logout</span>
              </button>
            </div>
          </div>

          {/* Patient hero card */}
          <div className="rounded-3xl p-5 flex items-center gap-4" style={{ background: 'rgba(255,255,255,.1)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,.15)' }}>
            {/* Avatar */}
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 font-black text-xl text-white" style={{ background: 'linear-gradient(135deg,#0097A7,#0A2342)', boxShadow: '0 4px 16px rgba(0,0,0,.3)' }}>
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-bold truncate">{patient_name || '—'}</p>
              <p className="text-blue-200 text-sm truncate">{patient_phone}</p>
              {mis_info?.card_number && (
                <p className="text-blue-300 text-xs mt-0.5">Карта МИС: №{mis_info.card_number}</p>
              )}
            </div>
            {mis_info?.birth_date && (
              <div className="text-right flex-shrink-0">
                <p className="text-blue-200 text-[10px]">Возраст</p>
                <p className="text-white font-bold text-sm">{mis_info.age || mis_info.birth_date}</p>
              </div>
            )}
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3 mt-4">
            {[
              { val: allRefs.length,    label: 'Направлений', tab: 'referrals', icon: 'assignment',  color: '#93C5FD' },
              { val: mis_visits.length, label: 'Визитов',     tab: 'history',   icon: 'history',     color: '#6EE7B7' },
              { val: activeRefs.length, label: 'Активных',    tab: 'referrals', icon: 'radio_button_checked', color: '#FCA5A5' },
            ].map(s => (
              <button key={s.tab + s.label} onClick={() => setTab(s.tab)}
                className="rounded-2xl py-3 px-2 text-center transition-all active:scale-95"
                style={{ background: 'rgba(255,255,255,.12)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,.12)' }}>
                <span className="material-symbols-outlined text-sm mb-1 block" style={{ color: s.color, fontVariationSettings:"'FILL' 1" }}>{s.icon}</span>
                <p className="text-xl font-black text-white leading-none">{s.val}</p>
                <p className="text-[10px] font-medium mt-1" style={{ color: 'rgba(255,255,255,.6)' }}>{s.label}</p>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Ad Banner (top) ── */}
      {bannerAds.length > 0 && (
        <div className="max-w-lg mx-auto px-4 -mt-4 mb-0 relative z-10">
          <AdBanner ads={bannerAds} idx={bannerIdx} setIdx={setBannerIdx} />
        </div>
      )}

      {/* ── Content ── */}
      <div className="max-w-lg mx-auto px-4 pt-5">
        {/* Android PWA — нативный prompt */}
        {showInstall && (
          <div className="rounded-2xl p-4 mb-4 flex items-center gap-3" style={{ background: 'linear-gradient(135deg,#1565C0,#0097A7)', boxShadow: '0 4px 20px rgba(21,101,192,.3)' }}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(255,255,255,.2)' }}>
              <span className="material-symbols-outlined text-white text-xl" style={{ fontVariationSettings:"'FILL' 1" }}>install_mobile</span>
            </div>
            <div className="flex-1">
              <p className="text-white font-bold text-sm">Добавить на экран «Домой»</p>
              <p className="text-blue-100 text-xs">Открывать как приложение — вход сохранится</p>
            </div>
            {/* Кнопки используют дизайн-систему: secondary (на цветной подложке выглядит как «белая») и ghost для закрытия */}
            <Button size="sm" variant="secondary" onClick={handleInstall} className="flex-shrink-0">Добавить</Button>
            <button onClick={() => setShowInstall(false)} aria-label="Закрыть"
              className="text-white/60 text-xl leading-none flex-shrink-0 w-11 h-11 flex items-center justify-center">×</button>
          </div>
        )}

        {/* iOS — ручная подсказка */}
        {showIosHint && (
          <div className="rounded-2xl p-4 mb-4" style={{ background: 'linear-gradient(135deg,#0A2342,#1565C0)', boxShadow: '0 4px 20px rgba(10,35,66,.4)' }}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 text-xl" style={{ background: 'rgba(255,255,255,.15)' }}>📲</div>
              <div className="flex-1">
                <p className="text-white font-bold text-sm mb-1">Добавить на экран «Домой»</p>
                <p className="text-blue-200 text-xs leading-relaxed">
                  Нажмите <span className="bg-white/15 rounded px-1.5 py-0.5 font-semibold text-white">↑ Поделиться</span> → <span className="font-semibold text-white">«На экран «Домой»»</span>
                </p>
                <p className="text-blue-300 text-xs mt-1.5">Авторизация сохранится — вход не потребуется</p>
              </div>
              <button onClick={() => { setShowIosHint(false); localStorage.setItem('clinika_ios_hint_ts', String(Date.now())) }}
                className="text-white/50 text-2xl leading-none flex-shrink-0">×</button>
            </div>
          </div>
        )}

        {/* ── HOME (направления) ── */}
        {tab === 'home' && isApt && (
          <div className="space-y-4 tab-enter px-1 pt-2">
            {/* Статус записи */}
            <div className="flex justify-center">
              <span className="px-4 py-1.5 rounded-full text-sm font-bold"
                style={{
                  background: String(data.status).includes('completed') ? 'rgba(16,185,129,.1)' : 'rgba(0,151,167,.1)',
                  color: String(data.status).includes('completed') ? '#065F46' : '#0097A7'
                }}>
                {String(data.status).includes('completed') ? '✓ Приём завершён' : '⏳ Ожидает приёма'}
              </span>
            </div>

            {/* QR-код */}
            {!String(data.status).includes('completed') && data.qr_code && (
              <div className="rounded-3xl overflow-hidden" style={{ background: 'linear-gradient(135deg,#0097A7 0%,#004D5F 100%)', boxShadow: '0 8px 32px rgba(0,151,167,.3)' }}>
                <div className="p-5">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#34d399' }} />
                    <p className="text-emerald-300 text-xs font-bold uppercase tracking-wide">Запись к врачу</p>
                  </div>
                  <h3 className="text-white font-extrabold text-lg leading-tight">{data.doctor_name}</h3>
                  <p className="text-blue-200 text-sm mt-0.5">{data.clinic_name}</p>
                </div>
                <button onClick={() => setFullscreenQr(data.qr_code)}
                  className="w-full py-4 flex items-center justify-center gap-3 transition-all active:opacity-80"
                  style={{ background: 'rgba(0,0,0,.25)', borderTop: '1px solid rgba(255,255,255,.1)' }}>
                  <span className="material-symbols-outlined text-white text-3xl" style={{ fontVariationSettings:"'FILL' 1" }}>qr_code_2</span>
                  <div className="text-left">
                    <p className="text-white font-bold text-base">Показать QR врачу</p>
                    <p className="text-blue-200 text-xs">Нажмите для полноэкранного QR</p>
                  </div>
                  <span className="material-symbols-outlined text-white/60 text-xl ml-auto">chevron_right</span>
                </button>
              </div>
            )}

            {/* ===== БЛОК: Детали приёма — <Card> дизайн-системы ===== */}
            <Card className="space-y-4">
              {[
                { icon: 'calendar_today', label: 'Дата',    value: new Date(data.appointment_date + 'T00:00').toLocaleDateString('ru-RU', { weekday:'long', day:'numeric', month:'long', year:'numeric' }), color: '#0097A7', bg: '#e0f7fa' },
                { icon: 'schedule',       label: 'Время',   value: (data.start_time || '').slice(0,5) + ' — ' + (data.end_time || '').slice(0,5), color: '#0097A7', bg: '#e0f7fa' },
                { icon: 'stethoscope',    label: 'Врач',    value: data.doctor_name, color: '#7b1fa2', bg: '#f3e5f5' },
                { icon: 'local_hospital', label: 'Клиника', value: data.clinic_name, color: '#2e7d32', bg: '#e8f5e9' },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: item.bg }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 20, color: item.color, fontVariationSettings:"'FILL' 1" }}>{item.icon}</span>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide">{item.label}</p>
                    <p className="text-sm font-bold text-gray-800 mt-0.5">{item.value}</p>
                  </div>
                </div>
              ))}
            </Card>

            {/* Код для врача */}
            {!String(data.status).includes('completed') && data.short_code && (
              <div className="rounded-2xl p-4 text-center" style={{ background: '#fff8e1', border: '1px solid #ffe082' }}>
                <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: '#e65100' }}>Код для врача (если нет QR)</p>
                <p className="text-5xl font-black" style={{ color: '#e65100', letterSpacing: 12 }}>{data.short_code}</p>
              </div>
            )}

            {/* ===== БЛОК: Контакты клиники — <Card> дизайн-системы ===== */}
            {(data.clinic_phone || data.clinic_address || data.clinic_latitude) && (
              <Card padded={false} className="p-3">
                <p className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: 'var(--fg-3)' }}>Связь с клиникой</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {data.clinic_phone && (
                    <a href={buildTel(data.clinic_phone)} className="h-10 rounded-xl flex items-center justify-center gap-1.5 text-sm font-semibold" style={{ background:'#E0F7FA', color:'#00838F' }}>
                      <span className="material-symbols-outlined text-base">call</span> Позвонить
                    </a>
                  )}
                  {data.clinic_phone && (
                    <a href={buildWhatsApp(data.clinic_phone)} target="_blank" rel="noreferrer" className="h-10 rounded-xl flex items-center justify-center gap-1.5 text-sm font-semibold" style={{ background:'#E8F5E9', color:'#2E7D32' }}>
                      <span className="material-symbols-outlined text-base">chat</span> WhatsApp
                    </a>
                  )}
                  {(data.clinic_address || data.clinic_latitude) && (
                    <a href={buildMapUrl(data.clinic_address, data.clinic_latitude, data.clinic_longitude)} target="_blank" rel="noreferrer" className="h-10 rounded-xl flex items-center justify-center gap-1.5 text-sm font-semibold" style={{ background:'#FFF3E0', color:'#E65100' }}>
                      <span className="material-symbols-outlined text-base">map</span> Маршрут
                    </a>
                  )}
                </div>
              </Card>
            )}

            {/* Управление: календарь / перенос / отмена (только для активных) */}
            {(data.status === 'pending' || data.status === 'confirmed') && (() => {
              const aptObj = {
                id: data.id, patient_token: data.patient_token,
                doctor_id: data.doctor_id, doctor_name: data.doctor_name, specialty: data.specialty,
                clinic_id: data.clinic_id, clinic_name: data.clinic_name,
                clinic_address: data.clinic_address, clinic_phone: data.clinic_phone,
                clinic_latitude: data.clinic_latitude, clinic_longitude: data.clinic_longitude,
                appointment_date: data.appointment_date,
                start_time: data.start_time, end_time: data.end_time,
                status: data.status, short_code: data.short_code,
                qr_code: data.qr_code,
              }
              const tooLate = hoursUntil(data.appointment_date, data.start_time) < 6
              return (
                <AptControls apt={aptObj} tooLate={tooLate}
                  onCancelled={reloadCabinet}
                  onRescheduleStart={(a) => setReschedAptId(a)} />
              )
            })()}
          </div>
        )}

        {tab === 'home' && !isApt && (
          <div className="space-y-5 tab-enter">
            {/* Записи к врачу — поверх всего на главной */}
            {appointments.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-bold text-gray-800 flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-base" style={{ color:'#0097A7', fontVariationSettings:"'FILL' 1" }}>event</span>
                    Мои записи к врачу
                  </h2>
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background:'rgba(0,151,167,.1)', color:'#0097A7' }}>
                    {appointments.length}
                  </span>
                </div>
                <div className="space-y-3">
                  {appointments.map(a => (
                    <AppointmentCard key={a.id} apt={a}
                      onQr={setFullscreenQr}
                      onCancelled={reloadCabinet}
                      onRescheduleStart={(apt) => setReschedAptId(apt)} />
                  ))}
                </div>
              </div>
            )}

            {/* Подготовка к приёму — карточка показывается если в активной записи (<24h)
                есть prep_instructions у услуги, или у активного направления */}
            {(() => {
              // приоритет: ближайшая активная Appointment с привязкой к направлению (через service)
              // Здесь упрощаем: показываем prep из current?.service_prep_instructions
              const prep = current?.service_prep_instructions
              if (!prep) return null
              return (
                <div className="rounded-3xl p-5" style={{ background:'linear-gradient(135deg,#FEF3C7,#FDE68A)', border:'1px solid #FCD34D' }}>
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background:'rgba(217,119,6,.15)' }}>
                      <span className="material-symbols-outlined text-amber-700 text-xl" style={{ fontVariationSettings:"'FILL' 1" }}>info</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-amber-900 text-sm">Подготовка к приёму</p>
                      <p className="text-amber-800 text-sm mt-1 leading-relaxed whitespace-pre-wrap">{prep}</p>
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* Active QR — show current referral's QR prominently */}
            {current?.status === 'created' && current?.qr_code && (
              <div className="rounded-3xl overflow-hidden" style={{ background: 'linear-gradient(135deg,#0097A7 0%,#1565C0 100%)', boxShadow: '0 8px 32px rgba(0,151,167,.3)' }}>
                <div className="p-5">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                    <p className="text-emerald-300 text-xs font-bold uppercase tracking-wide">Активное направление</p>
                  </div>
                  <h3 className="text-white font-extrabold text-lg leading-tight">{current.to_clinic_name}</h3>
                  <p className="text-blue-200 text-sm mt-0.5">{current.service_name}</p>
                </div>
                <button onClick={() => setFullscreenQr(current.qr_code)}
                  className="w-full py-4 flex items-center justify-center gap-3 transition-all active:opacity-80"
                  style={{ background: 'rgba(0,0,0,.25)', borderTop: '1px solid rgba(255,255,255,.1)' }}>
                  <span className="material-symbols-outlined text-white text-3xl" style={{ fontVariationSettings:"'FILL' 1" }}>qr_code_2</span>
                  <div className="text-left">
                    <p className="text-white font-bold text-base">Показать QR-код</p>
                    <p className="text-blue-200 text-xs">Для предъявления на стойке</p>
                  </div>
                  <span className="material-symbols-outlined text-white/60 text-xl ml-auto">chevron_right</span>
                </button>
              </div>
            )}

            {/* ===== БЛОК: Контакты клиники активного направления — <Card> ===== */}
            {current?.status === 'created' && (current?.to_clinic_phone || current?.to_clinic_address || current?.to_clinic_latitude) && (
              <Card padded={false} className="p-3">
                <p className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: 'var(--fg-3)' }}>Связь с клиникой</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {current.to_clinic_phone && (
                    <a href={buildTel(current.to_clinic_phone)}
                      className="h-10 rounded-xl flex items-center justify-center gap-1.5 text-sm font-semibold"
                      style={{ background:'#E0F7FA', color:'#00838F' }}>
                      <span className="material-symbols-outlined text-base">call</span> Позвонить
                    </a>
                  )}
                  {current.to_clinic_phone && (
                    <a href={buildWhatsApp(current.to_clinic_phone)} target="_blank" rel="noreferrer"
                      className="h-10 rounded-xl flex items-center justify-center gap-1.5 text-sm font-semibold"
                      style={{ background:'#E8F5E9', color:'#2E7D32' }}>
                      <span className="material-symbols-outlined text-base">chat</span> WhatsApp
                    </a>
                  )}
                  {(current.to_clinic_address || current.to_clinic_latitude) && (
                    <a href={buildMapUrl(current.to_clinic_address, current.to_clinic_latitude, current.to_clinic_longitude)} target="_blank" rel="noreferrer"
                      className="h-10 rounded-xl flex items-center justify-center gap-1.5 text-sm font-semibold"
                      style={{ background:'#FFF3E0', color:'#E65100' }}>
                      <span className="material-symbols-outlined text-base">map</span> Маршрут
                    </a>
                  )}
                </div>
              </Card>
            )}

            {/* Recent active referrals */}
            {activeRefs.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-bold text-gray-800">Активные направления</h2>
                  <button onClick={() => setTab('referrals')} className="text-sm font-semibold flex items-center gap-0.5" style={{ color: '#1565C0' }}>
                    Все <span className="material-symbols-outlined text-sm">chevron_right</span>
                  </button>
                </div>
                <div className="space-y-2">
                  {/* ===== БЛОК: Краткие карточки активных направлений (используют <Card> из дизайн-системы) ===== */}
                  {activeRefs.slice(0,2).map((r,i) => (
                    <Card key={r.id} className="card-in" padded={false}>
                      <div className="p-3.5 flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `linear-gradient(135deg,${CARD_GRADS[i%CARD_GRADS.length][0]},${CARD_GRADS[i%CARD_GRADS.length][1]})` }}>
                          <span className="material-symbols-outlined text-white text-base" style={{ fontVariationSettings:"'FILL' 1" }}>local_hospital</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold truncate" style={{ color: 'var(--fg)' }}>{r.to_clinic_name}</p>
                          <p className="text-xs truncate" style={{ color: 'var(--fg-3)' }}>{r.service_name}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {r.short_code && <span className="text-xs font-bold tracking-wider" style={{ color: 'var(--fg-3)' }}>{r.short_code}</span>}
                          <StatusBadge status={r.status} />
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Recent visit */}
            {mis_visits.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-bold text-gray-800">Последний визит</h2>
                  <button onClick={() => setTab('history')} className="text-sm font-semibold flex items-center gap-0.5" style={{ color: '#1565C0' }}>
                    История <span className="material-symbols-outlined text-sm">chevron_right</span>
                  </button>
                </div>
                <VisitCard visit={mis_visits[0]} patientName={patient_name} />
              </div>
            )}

            {/*
              ── TODO: Лекарства/назначения из МИС ──
              МИС-API Renovatio метода для получения назначений пациента не предоставляет
              (нет ни getPatientPrescriptions, ни эквивалента). Когда такой endpoint появится —
              сюда подставлять данные из data.mis_prescriptions (бэкенд: _load_mis_data).
              Сейчас — закомментированный блок-заглушка ниже.
            */}
            {/*
            <div className="bg-white rounded-3xl p-5" style={{ border:'1px solid rgba(0,0,0,.06)', boxShadow:'0 2px 12px rgba(0,0,0,.04)' }}>
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-base" style={{ color:'#0097A7' }}>medication</span>
                <h2 className="font-bold text-gray-800 text-sm">Мои назначения</h2>
              </div>
              <p className="text-xs text-gray-400 mt-2">Скоро появится: список лекарств с инструкциями, выписанных врачом</p>
            </div>
            */}

            {/* ===== БЛОК: Empty state — ничего пока нет ===== */}
            {allRefs.length === 0 && mis_visits.length === 0 && appointments.length === 0 && (
              <Card className="text-center">
                <EmptyState
                  icon={<span className="material-symbols-outlined text-3xl">medical_services</span>}
                  title="Добро пожаловать!"
                  message="Здесь появятся ваши направления, записи к врачам и история визитов"
                />
              </Card>
            )}
          </div>
        )}

        {/* ── REFERRALS ── */}
        {tab === 'referrals' && !data?.type && (
          <div className="tab-enter">
            <div className="relative mb-4">
              <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-xl pointer-events-none">search</span>
              <input type="text" placeholder="Поиск по клинике, услуге..." value={searchQ} onChange={e => setSearchQ(e.target.value)}
                className="w-full h-12 pl-12 pr-4 rounded-2xl text-sm focus:outline-none focus:ring-2"
                style={{ background: 'white', border: '1.5px solid rgba(0,0,0,.08)', boxShadow: '0 2px 8px rgba(0,0,0,.05)' }} />
            </div>
            {searchedRefs.length === 0 ? (
              <EmptyState
                icon={<span className="material-symbols-outlined text-3xl">inbox</span>}
                title="Направлений нет"
                message={searchQ ? 'По запросу ничего не найдено' : 'Когда врач выпишет направление — оно появится здесь'}
              />
            ) : (
              <div className="space-y-4">
                {searchedRefs.map((r, i) => <ReferralCard key={r.id} referral={r} index={i} onQr={setFullscreenQr} />)}
              </div>
            )}
          </div>
        )}

        {/* ── HISTORY ── */}
        {tab === 'history' && !data?.type && (
          <div className="tab-enter">
            {mis_visits.length === 0 ? (
              <EmptyState
                icon={<span className="material-symbols-outlined text-3xl">history</span>}
                title="История пуста"
                message="После первого визита в клинику ваша история появится здесь"
              />
            ) : (
              <>
                <div className="flex items-center gap-2 mb-4 p-3 rounded-2xl" style={{ background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.15)' }}>
                  <span className="material-symbols-outlined text-emerald-500 text-base" style={{ fontVariationSettings:"'FILL' 1" }}>verified</span>
                  <p className="text-emerald-700 text-xs font-semibold">Данные из медицинской системы клиники</p>
                </div>
                <div className="space-y-3">
                  {mis_visits.map((v, i) => <VisitCard key={i} visit={v} patientName={patient_name} />)}
                </div>
                {bannerAds.length > 0 && (
                  <div className="mt-5">
                    <AdBanner ads={bannerAds} idx={bannerIdx} setIdx={setBannerIdx} />
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── DOCTORS ── */}
        {tab === 'doctors' && !data?.type && (
          <div className="tab-enter px-1 pt-2">
            <DoctorsTab primary="#0097A7" patientName={patient_name} patientPhone={patient_phone} onRefreshHistory={() => {
              const refId = localStorage.getItem(REF_KEY)
              const tk = localStorage.getItem(TOKEN_KEY)
              if (refId && tk) loadData(refId, tk)
            }} />
          </div>
        )}

        {/* ── SUPPORT ── */}
        {tab === 'support' && !data?.type && (
          <div className="tab-enter">
            <ChatTab phone={patient_phone} sessionToken={localStorage.getItem(SESSION_KEY)} />
          </div>
        )}

        {/* ── APPOINTMENTS — мои записи к врачам ── */}
        {tab === 'appointments' && !data?.type && (
          <div className="tab-enter">
            <Suspense fallback={<div className="text-center py-12 text-gray-400 text-sm">Загрузка…</div>}>
              <AppointmentsTab
                sessionToken={localStorage.getItem(SESSION_KEY)}
                onBookNew={() => window.location.href = `${BASE_PATH}/book`}
              />
            </Suspense>
          </div>
        )}

        {/* ── HEALTH — медкарта/анализы/назначения/документы/витальные ── */}
        {tab === 'health' && !data?.type && (
          <div className="tab-enter">
            <Suspense fallback={<div className="text-center py-12 text-gray-400 text-sm">Загрузка…</div>}>
              <HealthHub sessionToken={localStorage.getItem(SESSION_KEY)} phone={patient_phone} />
            </Suspense>
          </div>
        )}
      </div>

      {/* ── Bottom Navigation ── */}
      <div className="fixed bottom-0 left-0 right-0 z-40" style={{ background: 'rgba(255,255,255,.95)', backdropFilter: 'blur(20px)', borderTop: '1px solid rgba(0,0,0,.07)', paddingBottom: 'env(safe-area-inset-bottom,0px)' }}>
        <div className="max-w-lg mx-auto flex items-center justify-around px-2 py-2">
          {TABS.map(t => {
            const isActive = tab === t.key
            return (
              <button key={t.key} onClick={() => setTab(t.key)}
                className="flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-2xl transition-all"
                style={{ color: isActive ? '#1565C0' : '#9CA3AF', background: isActive ? 'rgba(21,101,192,.08)' : 'transparent' }}>
                <span className="material-symbols-outlined text-2xl leading-none transition-all"
                  style={{ fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0", transform: isActive ? 'scale(1.1)' : 'scale(1)' }}>
                  {t.icon}
                </span>
                <span className="text-[10px] font-semibold">{t.label}</span>
                {isActive && <span className="w-1 h-1 rounded-full" style={{ background: '#1565C0' }} />}
              </button>
            )
          })}
        </div>
      </div>

      {/* Перенос записи */}
      {reschedAptId && (
        <RescheduleModal apt={reschedAptId} primary="#0097A7"
          onClose={() => setReschedAptId(null)}
          onDone={() => { setReschedAptId(null); reloadCabinet() }} />
      )}

      {/* Семейный аккаунт */}
      {familyOpen && (
        <FamilyModal
          ownerName={patient_name} ownerPhone={patient_phone}
          members={familyList}
          onClose={() => setFamilyOpen(false)}
          onChanged={loadFamily}
          onSwitch={switchProfile} />
      )}

      {/* W6: AI-ассистент через Gemini — плавающий чат-виджет.
          Сам прячется при 402 (модуль ai_assistant не подключён). */}
      {patient_phone && SLUG && (
        <Suspense fallback={null}>
          <PatientAiWidget
            apiBase={API}
            patientPhone={patient_phone}
            tenantSlug={SLUG}
          />
        </Suspense>
      )}
    </div>
  )
}

// ── Семейный аккаунт: модалка ────────────────────────────────────────────────
function FamilyModal({ ownerName, ownerPhone, members, onClose, onChanged, onSwitch }) {
  // Замена window.confirm на Modal
  const { confirm, ConfirmHost } = useConfirm()
  const [phone, setPhone] = useState('+7')
  const [name, setName] = useState('')
  const [relation, setRelation] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [switchTarget, setSwitchTarget] = useState(null)
  const [shortCode, setShortCode] = useState('')

  async function add() {
    setErr('')
    const digits = (phone || '').replace(/\D/g, '')
    if (digits.length < 10) { setErr('Введите номер телефона полностью (10–11 цифр)'); return }
    if (!name.trim()) { setErr('Введите имя'); return }
    setBusy(true)
    try {
      const session = localStorage.getItem('clinika_patient_session')
      if (!session) { setErr('Сессия истекла, перезайдите в кабинет'); setBusy(false); return }
      await axios.post(`${API}/patient/family/add`,
        { phone: phone.trim(), name: name.trim(), relation: relation.trim() || null },
        { params: { t: session } }
      )
      setShowAdd(false); setPhone('+7'); setName(''); setRelation('')
      onChanged && onChanged()
    } catch (e) {
      const status = e.response?.status
      const detail = e.response?.data?.detail
      if (status === 409) setErr('Этот человек уже в вашем списке')
      else if (status === 401) setErr('Сессия истекла, перезайдите')
      else if (status === 400) setErr(detail || 'Некорректные данные')
      else setErr(detail || `Ошибка ${status || ''}: не удалось добавить`)
      console.warn('[family/add] error', status, detail, e)
    } finally { setBusy(false) }
  }

  async function remove(id) {
    if (!(await confirm('Удалить из списка?', { danger: true, okText: 'Удалить' }))) return
    try {
      const session = localStorage.getItem('clinika_patient_session')
      await axios.delete(`${API}/patient/family/${id}`, { params: { t: session } })
      onChanged && onChanged()
    } catch {}
  }

  async function doSwitch() {
    const code = parseInt(shortCode, 10)
    if (!code) { setErr('Введите код'); return }
    setBusy(true); setErr('')
    try {
      await onSwitch(switchTarget.phone, code)
    } catch (e) {
      setErr('Не удалось переключиться')
    } finally { setBusy(false) }
  }

  return (
    <>
      <ConfirmHost />
      {/* ===== БЛОК: Семейный аккаунт — переиспользует <Modal> дизайн-системы ===== */}
      <Modal open={true} onClose={onClose} title="Семья" size="md">
        {/* Owner */}
        <div className="rounded-2xl p-3 mb-3" style={{ background:'#F0F9FF', border:'1px solid #BAE6FD' }}>
          <p className="text-xs font-semibold text-sky-700 uppercase tracking-wide">Текущий профиль</p>
          <p className="text-sm font-bold text-gray-800 mt-0.5">{ownerName || ownerPhone}</p>
          <p className="text-xs text-gray-500">{ownerPhone}</p>
        </div>

        {/* List */}
        {members.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-4">Семейный список пуст</p>
        ) : (
          <div className="space-y-2 mb-3">
            {members.map(m => (
              <div key={m.id} className="rounded-2xl p-3 flex items-center gap-3" style={{ background:'#fff', border:'1px solid #E5E7EB' }}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white text-sm flex-shrink-0" style={{ background:'linear-gradient(135deg,#0097A7,#1565C0)' }}>
                  {(m.name || m.phone || '?').slice(0,2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-gray-800 truncate">{m.name || m.phone}</p>
                  <p className="text-xs text-gray-500 truncate">{m.relation || '—'} · {m.phone}</p>
                </div>
                <button onClick={() => { setSwitchTarget(m); setShortCode(''); setErr('') }}
                  className="h-8 px-3 rounded-lg text-xs font-bold"
                  style={{ background:'linear-gradient(135deg,#0097A7,#1565C0)', color:'#fff' }}>
                  Войти
                </button>
                <button onClick={() => remove(m.id)} className="text-gray-300 text-lg leading-none" title="Удалить">×</button>
              </div>
            ))}
          </div>
        )}

        {/* Add form */}
        {showAdd ? (
          <div className="rounded-2xl p-3 space-y-2 mb-3" style={{ background:'#F8FAFC', border:'1px solid #E2E8F0' }}>
            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+7..."
              className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm" />
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Имя"
              className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm" />
            <input value={relation} onChange={e => setRelation(e.target.value)} placeholder="Кто (Супруг, Ребёнок, ...)"
              className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm" />
            {err && <p className="text-xs text-red-500">{err}</p>}
            {/* Кнопки формы добавления — дизайн-система */}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => setShowAdd(false)} disabled={busy}>Отмена</Button>
              <Button onClick={add} disabled={busy}>{busy ? '...' : 'Добавить'}</Button>
            </div>
          </div>
        ) : (
          <Button variant="secondary" onClick={() => setShowAdd(true)} className="w-full mb-3">
            + Добавить члена семьи
          </Button>
        )}

        {/* Switch confirm — нужен short_code (proof of access) */}
        {switchTarget && (
          <div className="rounded-2xl p-3 space-y-2" style={{ background:'#FFFBEB', border:'1px solid #FDE68A' }}>
            <p className="text-xs font-bold text-amber-800">Войти в профиль: {switchTarget.name || switchTarget.phone}</p>
            <p className="text-xs text-amber-700 leading-relaxed">
              Это защитная проверка — введите <b>5-значный код любого направления</b> этого пациента
              (можно посмотреть на бумажном направлении, в QR-карточке клиники, или в его собственном кабинете).
              Подойдёт даже код от уже завершённого визита.
            </p>
            <input value={shortCode} onChange={e => setShortCode(e.target.value.replace(/\D/g,''))} placeholder="Код"
              maxLength={5} inputMode="numeric"
              className="w-full h-10 px-3 rounded-xl border border-amber-300 text-base font-bold tracking-widest text-center" />
            {err && <p className="text-xs text-red-500">{err}</p>}
            {/* Кнопки подтверждения переключения профиля — дизайн-система */}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => setSwitchTarget(null)} disabled={busy}>Отмена</Button>
              <Button onClick={doSwitch} disabled={busy || !shortCode}>{busy ? '...' : 'Войти'}</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
