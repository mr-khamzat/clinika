/**
 * ========================================
 * БЛОК: Preview-версия кабинета пациента (премиум тёмная тема)
 * ========================================
 * URL: /{slug}/p-new — параллельный кабинету /p (тестовая версия).
 *
 * Использует ТУ ЖЕ логику авторизации, что и PatientCabinet.jsx:
 *   - LS keys: clinika_patient_token, clinika_patient_ref, clinika_patient_session, clinika_patient_slug
 *   - Bootstrap: ?t= (QR) → loadData + ensureSession; ?s= или LS session → restoreFromSession;
 *     иначе LoginScreen
 *   - PWA-манифест динамический через /portal/manifest.json
 *
 * Дизайн: OKLCH-палитра, шрифты Golos Text + Inter, 4 темы (teal/violet/emerald/amber).
 * Все стили изолированы в cabinet-dark.css под селектором `.cabinet-preview`.
 *
 * Реализованные экраны (полно):
 *   - Home (Dashboard): greeting, KPI, ближайший приём, quick-actions, последние анализы
 *   - Booking: 4 шага (специалист → дата+время → подтверждение → готово)
 *
 * Заглушки:
 *   - Appointments / History / Chat / Profile — упрощённый layout в новом стиле
 *
 * Feature-flags: см. константы FEATURE_* ниже.
 * ========================================
 */
import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import axios from 'axios'
import { API_BASE, SLUG } from '../config'
import '../styles/cabinet-dark.css'
import { useToast, useConfirm } from '../design'

const API = API_BASE

// ── Общие LS-ключи с основным кабинетом — чтобы автологин работал в обе стороны ──
const TOKEN_KEY   = 'clinika_patient_token'
const REF_KEY     = 'clinika_patient_ref'
const SESSION_KEY = 'clinika_patient_session'
const SLUG_KEY    = 'clinika_patient_slug'

// ── Feature-flags ─────────────────────────────────────────────────────────────
const FEATURE_LOYALTY_ENABLED = false        // TODO: backend модель LoyaltyAccount
const FEATURE_VITALS_ENABLED = false         // TODO: PatientVital + Apple Health sync
const FEATURE_AI_BOT_ENABLED = false         // TODO: /patient/ai endpoint
const FEATURE_PRESCRIPTIONS_ENABLED = false  // TODO: МИС getPatientPrescriptions
const FEATURE_MEDCARD_ENABLED = false        // TODO: backend диагнозы/аллергии/прививки
const FEATURE_DOCUMENTS_ENABLED = false      // TODO: PatientDocument
const FEATURE_GLOBAL_SEARCH_ENABLED = false
const FEATURE_2FA_ENABLED = false
const FEATURE_BILLING_ENABLED = false
const FEATURE_ANALYSES_ENABLED = true        // backend get_patient_analyses есть
const FEATURE_NOTIFY_RAIL_ENABLED = true

// ── Сохраняем slug при заходе ────────────────────────────────────────────────
if (typeof window !== 'undefined' && SLUG) {
  try { localStorage.setItem(SLUG_KEY, SLUG) } catch {}
}

// ── PWA-манифест (динамический, как в основном кабинете) ─────────────────────
if (typeof document !== 'undefined' && SLUG) {
  try {
    const old = document.querySelector('link[rel="manifest"]')
    if (old) old.parentNode.removeChild(old)
    const params = new URLSearchParams({ slug: SLUG })
    const urlT = new URLSearchParams(window.location.search).get('t')
    const urlS = new URLSearchParams(window.location.search).get('s')
    const lsS = (() => { try { return localStorage.getItem(SESSION_KEY) } catch { return null } })()
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
    const m3 = document.createElement('meta'); m3.name = 'theme-color'; m3.content = '#161a1f'; document.head.appendChild(m3)
  }
}

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
    params.set('v', String(Date.now()))
    link.href = `${API_BASE}/portal/manifest.json?${params.toString()}`
  } catch {}
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const MONTHS_R   = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек']
const MONTHS_FULL = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря']
const DAYS_SHORT = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб']
const DAYS_FULL  = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота']

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
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
function fmtMisDate(str) {
  if (!str) return '—'
  const [dp, tp] = str.split(' ')
  if (!dp) return str
  const [d, mo, y] = dp.split('.')
  return tp ? `${+d} ${MONTHS_R[+mo-1]} ${y}, ${tp}` : `${+d} ${MONTHS_R[+mo-1]} ${y}`
}
function getInitials(name) {
  if (!name) return 'П'
  return String(name).split(/\s+/).map(w=>w[0]).filter(Boolean).slice(0,2).join('').toUpperCase()
}
function getGreetingByHour() {
  const h = new Date().getHours()
  if (h < 6) return 'Доброй ночи'
  if (h < 12) return 'Доброе утро'
  if (h < 18) return 'Добрый день'
  return 'Добрый вечер'
}

// .ics файл для добавления в календарь
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

// Sparkline svg (для последних анализов)
function Sparkline({ vals, width = 110, height = 28, color = 'currentColor' }) {
  if (!vals || vals.length < 2) return null
  const max = Math.max(...vals), min = Math.min(...vals)
  const span = max - min || 1
  const dx = width / (vals.length - 1)
  const pts = vals.map((v, i) => `${i*dx},${height - ((v - min) / span) * height}`).join(' ')
  const last = vals[vals.length-1], lastY = height - ((last - min) / span) * height
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={width} cy={lastY} r="2.5" fill={color} />
    </svg>
  )
}

// ── PWA / Push ───────────────────────────────────────────────────────────────
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

// ── LoginScreen ──────────────────────────────────────────────────────────────
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
    <div style={{
      minHeight: '100vh',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: 20,
      background: 'radial-gradient(ellipse 80% 60% at 50% 20%, oklch(0.30 0.05 200), oklch(0.16 0.012 215))',
    }}>
      <div style={{ marginBottom: 36, textAlign: 'center' }}>
        <div style={{
          width: 84, height: 84, borderRadius: 22,
          background: 'linear-gradient(140deg, var(--accent), var(--accent-2))',
          display: 'grid', placeItems: 'center',
          margin: '0 auto 18px',
          color: 'var(--accent-fg)', fontSize: 38, fontWeight: 700,
          boxShadow: '0 12px 40px oklch(0.78 0.14 200 / 0.35)',
        }}>⚕</div>
        <h1 style={{ fontSize: 30, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--fg)' }}>КлиникСеть</h1>
        <p style={{ color: 'var(--fg-3)', marginTop: 6, fontSize: 14 }}>Личный кабинет пациента</p>
      </div>

      <div className="card" style={{ width: '100%', maxWidth: 380, padding: 24 }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>Войти в кабинет</h2>
        <p style={{ fontSize: 13, color: 'var(--fg-3)', marginBottom: 18 }}>Введите код из направления и ваш телефон</p>
        <form onSubmit={submit} style={{ display: 'grid', gap: 10 }}>
          <input
            type="number" inputMode="numeric" placeholder="Код направления"
            value={code} onChange={e => setCode(e.target.value)}
            className="cp-input"
          />
          <input
            type="tel" placeholder="+7 900 000-00-00"
            value={phone} onChange={e => setPhone(e.target.value)}
            className="cp-input"
          />
          {err && (
            <div style={{
              background: 'var(--bad-soft)', color: 'var(--bad)',
              padding: '10px 12px', borderRadius: 10, fontSize: 12.5,
              border: '1px solid var(--bad-soft)',
            }}>{err}</div>
          )}
          <button type="submit" disabled={loading}
            className="btn btn-primary btn-lg"
            style={{ width: '100%', opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Поиск...' : 'Найти направление'}
          </button>
        </form>
      </div>
      <p style={{ color: 'var(--fg-4)', fontSize: 11, marginTop: 20 }}>preview · новый дизайн</p>
    </div>
  )
}

// ── Fullscreen QR ────────────────────────────────────────────────────────────
function QrFullscreen({ qr, onClose }) {
  return (
    <div className="qr-fullscreen" onClick={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: 'rgba(255,255,255,.15)',
          display: 'grid', placeItems: 'center', fontSize: 22,
        }}>⚕</div>
        <span style={{ fontSize: 22, fontWeight: 700, color: '#fff', letterSpacing: '-0.02em' }}>КлиникСеть</span>
      </div>
      <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, marginBottom: 20, textAlign: 'center' }}>
        Покажите этот QR-код врачу или администратору
      </p>
      <div className="qr-card">
        <img src={`data:image/png;base64,${qr}`} alt="QR" />
      </div>
      <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, marginTop: 22 }}>Нажмите в любом месте, чтобы закрыть</p>
    </div>
  )
}

// ── Reschedule Modal ─────────────────────────────────────────────────────────
function RescheduleModal({ apt, onClose, onDone }) {
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
    if (!apt.patient_token) { setErr('Токен записи отсутствует'); return }
    setBusy(true); setErr('')
    try {
      const r = await axios.post(
        `${API}/patient/appointment/${apt.id}/reschedule`,
        { appointment_date: isoDate(selDate), start_time: selSlot },
        { params: { t: apt.patient_token } }
      )
      onDone && onDone(r.data); onClose && onClose()
    } catch (e) {
      const code = e.response?.status
      setErr(e.response?.data?.detail || (code === 409 ? 'Слот уже занят' : 'Не удалось перенести'))
    } finally { setBusy(false) }
  }

  return (
    <div className="cp-modal-overlay" onClick={onClose}>
      <div className="cp-modal" onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <h3>Перенос записи</h3>
          <button onClick={onClose} className="bot-x" style={{ width: 28, height: 28, fontSize: 18 }}>×</button>
        </div>
        <p style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 14 }}>{apt.doctor_name} · {apt.clinic_name}</p>

        <div className="filter-label" style={{ marginBottom: 8 }}>Новая дата</div>
        {availLoading ? (
          <p style={{ textAlign: 'center', color: 'var(--fg-3)', fontSize: 13, padding: '12px 0' }}>Загрузка расписания...</p>
        ) : (
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 6, marginBottom: 14 }}>
            {dates.map(d => {
              const key = isoDate(d)
              const info = availMap?.[key]
              const free = info?.free_slots || 0
              const enabled = free > 0
              const isSel = selDate && isoDate(selDate) === key
              return (
                <button key={d.toISOString()} onClick={() => pickDate(d)} disabled={!enabled}
                  style={{
                    flexShrink: 0, minWidth: 64, padding: '10px 6px', borderRadius: 10,
                    border: `1px solid ${isSel ? 'var(--accent)' : 'var(--border)'}`,
                    background: isSel ? 'var(--accent-soft)' : 'var(--bg-2)',
                    color: isSel ? 'var(--accent)' : (enabled ? 'var(--fg)' : 'var(--fg-4)'),
                    cursor: enabled ? 'pointer' : 'not-allowed',
                    opacity: enabled ? 1 : 0.4,
                  }}>
                  <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>{DAYS_SHORT[d.getDay()]}</div>
                  <div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>{d.getDate()}</div>
                  <div style={{ fontSize: 10, color: 'var(--fg-4)' }}>{MONTHS_R[d.getMonth()]}</div>
                </button>
              )
            })}
          </div>
        )}

        {selDate && (
          slotsLoading
            ? <p style={{ textAlign: 'center', color: 'var(--fg-3)', fontSize: 13, padding: '12px 0' }}>Загрузка слотов...</p>
            : slots.length === 0
              ? <p style={{ textAlign: 'center', color: 'var(--fg-3)', fontSize: 13, padding: '12px 0' }}>Нет свободных слотов</p>
              : <div className="slot-grid" style={{ marginBottom: 14 }}>
                  {slots.map(s => (
                    <button key={s.start_time} className={`slot ${selSlot === s.start_time ? 'selected' : ''}`}
                      onClick={() => setSlot(s.start_time)}>
                      {s.start_time}
                    </button>
                  ))}
                </div>
        )}

        {err && <div className="chip chip-bad" style={{ display: 'block', padding: '8px 12px', marginBottom: 10 }}>{err}</div>}
        <button onClick={submit} disabled={!selSlot || busy}
          className="btn btn-primary btn-lg"
          style={{ width: '100%', opacity: (!selSlot || busy) ? 0.5 : 1 }}>
          {busy ? 'Переносим...' : (selSlot ? `Перенести на ${selSlot}` : 'Выберите время')}
        </button>
      </div>
    </div>
  )
}

// ── Family Modal ─────────────────────────────────────────────────────────────
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
    if (!phone || phone.length < 7) { setErr('Введите телефон'); return }
    setBusy(true)
    try {
      const session = localStorage.getItem(SESSION_KEY)
      await axios.post(`${API}/patient/family/add`, { phone, name, relation }, { params: { t: session } })
      setShowAdd(false); setPhone('+7'); setName(''); setRelation('')
      onChanged && onChanged()
    } catch (e) {
      setErr(e.response?.data?.detail || 'Не удалось добавить')
    } finally { setBusy(false) }
  }

  async function remove(id) {
    if (!(await confirm('Удалить из списка?', { danger: true, okText: 'Удалить' }))) return
    try {
      const session = localStorage.getItem(SESSION_KEY)
      await axios.delete(`${API}/patient/family/${id}`, { params: { t: session } })
      onChanged && onChanged()
    } catch {}
  }

  async function doSwitch() {
    const code = parseInt(shortCode, 10)
    if (!code) { setErr('Введите код'); return }
    setBusy(true); setErr('')
    try { await onSwitch(switchTarget.phone, code) }
    catch (e) { setErr('Не удалось переключиться') }
    finally { setBusy(false) }
  }

  return (
    <div className="cp-modal-overlay" onClick={onClose}>
      <ConfirmHost />
      <div className="cp-modal" onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3>Семейный доступ</h3>
          <button onClick={onClose} className="bot-x" style={{ width: 28, height: 28, fontSize: 18 }}>×</button>
        </div>

        <div className="card" style={{ marginBottom: 14, padding: 14 }}>
          <div className="filter-label" style={{ marginBottom: 4 }}>Текущий профиль</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{ownerName || ownerPhone}</div>
          <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>{ownerPhone}</div>
        </div>

        {members.length === 0 ? (
          <p style={{ color: 'var(--fg-3)', fontSize: 13, textAlign: 'center', padding: '14px 0' }}>Семейный список пуст</p>
        ) : (
          <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
            {members.map(m => (
              <div key={m.id} className="card" style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 12 }}>
                <div className="appt-doc-avatar" style={{ width: 36, height: 36, fontSize: 12 }}>
                  {(m.name || m.phone || '?').slice(0, 2).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{m.name || m.phone}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>{m.relation || '—'} · {m.phone}</div>
                </div>
                <button onClick={() => { setSwitchTarget(m); setShortCode(''); setErr('') }}
                  className="btn btn-secondary btn-sm">Войти</button>
                <button onClick={() => remove(m.id)} className="bot-x" style={{ width: 26, height: 26 }}>×</button>
              </div>
            ))}
          </div>
        )}

        {showAdd ? (
          <div className="card" style={{ display: 'grid', gap: 8, padding: 14, marginBottom: 14 }}>
            <input className="cp-input" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+7..." />
            <input className="cp-input" value={name} onChange={e => setName(e.target.value)} placeholder="Имя" />
            <input className="cp-input" value={relation} onChange={e => setRelation(e.target.value)} placeholder="Кто (Супруг, Ребёнок...)" />
            {err && <div className="chip chip-bad" style={{ padding: '6px 10px' }}>{err}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <button onClick={() => setShowAdd(false)} disabled={busy} className="btn btn-secondary btn-sm">Отмена</button>
              <button onClick={add} disabled={busy} className="btn btn-primary btn-sm">{busy ? '...' : 'Добавить'}</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowAdd(true)} className="btn btn-secondary"
            style={{ width: '100%', borderStyle: 'dashed', marginBottom: 14 }}>
            + Добавить члена семьи
          </button>
        )}

        {switchTarget && (
          <div className="card" style={{ background: 'var(--warn-soft)', border: '1px solid var(--warn-soft)', padding: 14, display: 'grid', gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--warn)' }}>
              Переключение на: {switchTarget.name || switchTarget.phone}
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-2)' }}>
              Введите 5-значный код активного направления или записи этого пациента (с бумажного направления или из SMS).
            </div>
            <input className="cp-input" value={shortCode} maxLength={5} inputMode="numeric"
              onChange={e => setShortCode(e.target.value.replace(/\D/g, ''))}
              placeholder="Код" style={{ textAlign: 'center', letterSpacing: 6, fontWeight: 600 }} />
            {err && <div className="chip chip-bad" style={{ padding: '6px 10px' }}>{err}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <button onClick={() => setSwitchTarget(null)} disabled={busy} className="btn btn-secondary btn-sm">Отмена</button>
              <button onClick={doSwitch} disabled={busy || !shortCode} className="btn btn-primary btn-sm">{busy ? '...' : 'Войти'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── ChatTab (используем ту же логику что в основном кабинете, новый стиль) ───
function ChatTab({ sessionToken }) {
  const [chat, setChat] = useState(null)
  const [msgs, setMsgs] = useState([])
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const bottomRef = useRef(null)

  const loadList = useCallback(async () => {
    if (!sessionToken) { setLoading(false); return }
    try {
      const r = await axios.get(`${API}/patient/chat`, { params: { t: sessionToken } })
      const list = Array.isArray(r.data?.chats) ? r.data.chats : []
      if (list.length === 0) { setChat(null); setMsgs([]); setLoading(false); return }
      const latest = list[0]
      const r2 = await axios.get(`${API}/patient/chat/${latest.id}/messages`, { params: { t: sessionToken } })
      setChat(r2.data?.chat || latest)
      setMsgs(Array.isArray(r2.data?.messages) ? r2.data.messages : [])
    } catch (e) {
      setError(e?.response?.data?.detail || 'Не удалось загрузить чат')
    } finally { setLoading(false) }
  }, [sessionToken])

  useEffect(() => {
    loadList()
    const id = setInterval(loadList, 5000)
    return () => clearInterval(id)
  }, [loadList])
  useEffect(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }, [msgs])

  const send = async (e) => {
    e?.preventDefault?.()
    const t = (text || '').trim()
    if (!t || sending || !sessionToken) return
    setText(''); setSending(true); setError('')
    const opt = { id: 'tmp-'+Date.now(), sender: 'patient', text: t, created_at: new Date().toISOString(), _pending: true }
    setMsgs(prev => [...prev, opt])
    try {
      const body = { text: t }
      if (chat?.id) body.chat_id = chat.id
      const r = await axios.post(`${API}/patient/chat/send`, body, { params: { t: sessionToken } })
      const newOnes = Array.isArray(r.data?.new_messages) ? r.data.new_messages : []
      setMsgs(prev => [...prev.filter(m => m.id !== opt.id), ...newOnes])
      if (r.data?.chat) setChat(r.data.chat)
    } catch (err) {
      setMsgs(prev => prev.filter(m => m.id !== opt.id))
      setText(t)
      setError(err?.response?.data?.detail || 'Не удалось отправить')
    } finally { setSending(false) }
  }

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
  const fmtTime = (iso) => {
    if (!iso) return ''
    try {
      const d = new Date(iso)
      return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
    } catch { return '' }
  }

  if (!sessionToken) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 40 }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>💬</div>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Чат недоступен</div>
        <p style={{ fontSize: 13, color: 'var(--fg-3)' }}>
          Для работы с чатом нужна активная сессия. Войдите по коду направления или отсканируйте QR.
        </p>
      </div>
    )
  }

  return (
    <div className="card" style={{ padding: 0, display: 'flex', flexDirection: 'column', minHeight: 480, height: 'calc(100vh - 220px)' }}>
      <div className="bot-hd" style={{ padding: '14px 18px' }}>
        <div className="bot-hd-avatar">{isManual ? '◑' : 'AI'}</div>
        <div className="bot-hd-info">
          <div className="bot-hd-info-name">{isManual ? 'Поддержка клиники' : 'AI-ассистент'}</div>
          <div className="bot-hd-info-status">{isManual ? 'Отвечает администратор' : 'Онлайн 24/7'}</div>
        </div>
      </div>

      {isManual && (
        <div style={{ padding: '8px 18px', fontSize: 12, color: 'var(--warn)', background: 'var(--warn-soft)', borderBottom: '1px solid var(--border)' }}>
          Ваш вопрос ждёт ответа администратора. Обычно отвечаем за несколько минут.
        </div>
      )}
      {error && (
        <div style={{ padding: '8px 18px', fontSize: 12, color: 'var(--bad)', background: 'var(--bad-soft)', borderBottom: '1px solid var(--border)' }}>
          {error}
        </div>
      )}

      <div className="bot-msgs" style={{ flex: 1 }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><div className="cp-spinner"/></div>
        ) : msgs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--fg-3)', fontSize: 13 }}>
            Начните диалог с клиникой. AI-ассистент ответит мгновенно.
          </div>
        ) : msgs.map((m, i) => {
          const isPatient = m.sender === 'patient'
          const isAdmin = m.sender === 'admin'
          const cls = isPatient ? 'bot-msg-me' : (isAdmin ? 'bot-msg-admin' : 'bot-msg-bot')
          return (
            <div key={m.id || i} className={`bot-msg ${cls}`} style={{ opacity: m._pending ? 0.65 : 1 }}>
              {m.text}
              <div style={{ fontSize: 10, opacity: 0.6, marginTop: 4, textAlign: isPatient ? 'right' : 'left' }}>
                {isAdmin && '👤 Администратор · '}
                {!isAdmin && !isPatient && '🤖 Авто-ответ · '}
                {fmtTime(m.created_at)}
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {!isManual && !loading && chat?.id && (
        <div style={{ padding: '8px 14px 0' }}>
          <button onClick={requestManual} type="button" className="btn btn-secondary btn-sm" style={{ width: '100%' }}>
            Нужен живой ответ от администратора?
          </button>
        </div>
      )}

      <form onSubmit={send} className="bot-input">
        <input value={text} onChange={e => setText(e.target.value)}
          placeholder={isManual ? 'Сообщение администратору...' : 'Спросите про услуги, врачей...'}
          disabled={sending} />
        <button type="submit" disabled={!text.trim() || sending} className="bot-send">
          {sending ? '…' : '→'}
        </button>
      </form>
    </div>
  )
}

// ── Sidebar ──────────────────────────────────────────────────────────────────
function Sidebar({ route, setRoute, onLogout, badges }) {
  const NAV = [
    { id: 'home', label: 'Главная', ico: '⌂' },
    { id: 'booking', label: 'Запись к врачу', ico: '＋' },
    { id: 'doctors', label: 'Врачи', ico: '✦' },
    { id: 'appointments', label: 'Мои приёмы', ico: '☰', badge: badges.appointments },
    { id: 'history', label: 'История', ico: '⚯' },
    { id: 'chat', label: 'Чат', ico: '◯', badge: badges.chat },
    { id: 'profile', label: 'Профиль', ico: '☉' },
  ]
  return (
    <aside className="side">
      <div className="side-brand">
        <div className="side-brand-mark">⚕</div>
        <div className="side-brand-name">КлиникСеть<span>личный кабинет</span></div>
      </div>
      <div className="side-section">Основное</div>
      {NAV.map(n => (
        <button key={n.id} className="nav-item" data-active={route === n.id} onClick={() => setRoute(n.id)}>
          <div className="nav-item-icon">{n.ico}</div>
          {n.label}
          {n.badge ? <div className="nav-item-badge">{n.badge}</div> : null}
        </button>
      ))}
      <div className="side-foot">
        <div style={{ fontSize: 11, color: 'var(--fg-4)', marginBottom: 8 }}>preview · 152-ФЗ</div>
        <button onClick={onLogout} className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'flex-start' }}>↗ Выход</button>
      </div>
    </aside>
  )
}

// ── HomePage (Dashboard) ─────────────────────────────────────────────────────
function HomePage({ data, patientName, patientPhone, onGo, onQr, onReschedule, onCancelled }) {
  // Toast для info-уведомления "нет QR"
  const { toast } = useToast()
  const isApt = data?.type === 'appointment'
  const allRefs = isApt ? [] : [data?.current, ...(data?.other_referrals || [])].filter(Boolean)
  const activeRefs = allRefs.filter(r => r.status === 'created' || r.status === 'confirmed')
  const misVisits = isApt ? [] : (data?.mis_visits || [])
  const appointments = isApt ? [] : (data?.appointments || [])
  const misAnalyses = isApt ? [] : (data?.mis_analyses || [])

  const nextApt = appointments[0]

  // Контекстная фраза в greeting
  const greetingTail = useMemo(() => {
    if (nextApt) {
      const dt = new Date(nextApt.appointment_date + 'T00:00')
      if (!isNaN(dt.getTime())) {
        const today = new Date(); today.setHours(0,0,0,0)
        const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate()+1)
        if (+dt === +today) return `Сегодня в ${(nextApt.start_time||'').slice(0,5)} — приём у врача ${nextApt.doctor_name || ''}.`
        if (+dt === +tomorrow) return `Завтра в ${(nextApt.start_time||'').slice(0,5)} — приём у врача ${nextApt.doctor_name || ''}.`
        return `Ближайший приём: ${dt.getDate()} ${MONTHS_R[dt.getMonth()]}, ${(nextApt.start_time||'').slice(0,5)} — ${nextApt.doctor_name || ''}.`
      }
    }
    if (activeRefs.length > 0) return `У вас ${activeRefs.length} ${activeRefs.length === 1 ? 'активное направление' : 'активных направлений'}.`
    if (misVisits.length > 0) return `В вашей карте ${misVisits.length} ${misVisits.length === 1 ? 'визит' : 'визитов'}.`
    return 'Здесь появятся ваши приёмы и направления.'
  }, [nextApt, activeRefs.length, misVisits.length])

  return (
    <>
      <div className="greeting">
        <div>
          <h2>{getGreetingByHour()}{patientName ? `, ${patientName.split(' ')[1] || patientName.split(' ')[0]}` : ''}</h2>
          <p>{greetingTail}</p>
        </div>
        <div className="greeting-actions">
          <button className="btn btn-secondary" onClick={() => onGo('chat')}>Чат с клиникой</button>
          <button className="btn btn-primary" onClick={() => onGo('booking')}>Записаться →</button>
        </div>
      </div>

      <div className="kpi-row">
        <div className="kpi">
          <div className="kpi-label">Активных направлений</div>
          <div className="kpi-value">{activeRefs.length}</div>
          <div className="kpi-delta muted">всего: {allRefs.length}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Визитов в карте</div>
          <div className="kpi-value">{misVisits.length}</div>
          <div className="kpi-delta muted">по данным МИС</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Активных записей</div>
          <div className="kpi-value">{appointments.length}</div>
          <div className="kpi-delta muted">{appointments.length > 0 ? 'управление в кабинете' : '—'}</div>
        </div>
        <div className="kpi" style={{ opacity: FEATURE_LOYALTY_ENABLED ? 1 : 0.5 }}>
          <div className="kpi-label">Бонусов</div>
          <div className="kpi-value">{FEATURE_LOYALTY_ENABLED ? '0 ₽' : '—'}</div>
          <div className="kpi-delta muted">{FEATURE_LOYALTY_ENABLED ? '' : 'скоро'}</div>
        </div>
      </div>

      {/* Ближайший приём */}
      {nextApt && (
        <div className="dash-grid" style={{ gridTemplateColumns: '1fr' }}>
          <NextApptCard apt={nextApt} onQr={onQr} onReschedule={onReschedule} onCancelled={onCancelled} />
        </div>
      )}

      {/* Активные направления — компактно */}
      {activeRefs.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-hd">
            <div>
              <div className="card-title">Активные направления</div>
              <div className="card-sub">{activeRefs.length} {activeRefs.length === 1 ? 'направление' : 'направлений'}</div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => onGo('appointments')}>Все →</button>
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {activeRefs.slice(0, 3).map(r => (
              <div key={r.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 14px', background: 'var(--bg-2)', borderRadius: 10, border: '1px solid var(--border)' }}>
                <div style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'grid', placeItems: 'center', fontSize: 16 }}>⛨</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{r.to_clinic_name || 'Клиника'}</div>
                  <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>{r.service_name || '—'}</div>
                </div>
                {r.short_code && <span className="chip chip-accent" style={{ fontFamily: 'SF Mono, Consolas, monospace', letterSpacing: 1 }}>{r.short_code}</span>}
                {r.qr_code && (
                  <button onClick={() => onQr(r.qr_code)} className="btn btn-secondary btn-sm">QR</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div className="quick-actions" style={{ marginBottom: 16 }}>
        <button className="qa" onClick={() => onGo('booking')}>
          <div className="qa-icon">＋</div>
          <div><div className="qa-label">Записаться к врачу</div><div className="qa-sub">подобрать специалиста</div></div>
        </button>
        <button className="qa" onClick={() => onGo('history')}>
          <div className="qa-icon">⚯</div>
          <div><div className="qa-label">История визитов</div><div className="qa-sub">{misVisits.length} в карте</div></div>
        </button>
        <button className="qa" onClick={() => onGo('chat')}>
          <div className="qa-icon">◯</div>
          <div><div className="qa-label">Чат с клиникой</div><div className="qa-sub">AI + админ</div></div>
        </button>
        <button className="qa" onClick={() => {
          const q = (data?.current?.qr_code) || nextApt?.qr_code
          if (q) onQr(q)
          else toast('У вас сейчас нет активного QR-кода', 'info')
        }}>
          <div className="qa-icon">⊞</div>
          <div><div className="qa-label">Мой QR</div><div className="qa-sub">для регистратуры</div></div>
        </button>
      </div>

      {/* Виталы — за флагом */}
      {FEATURE_VITALS_ENABLED && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-hd">
            <div>
              <div className="card-title">Здоровье · последние данные</div>
              <div className="card-sub">синхронизация с Apple Health</div>
            </div>
            <button className="btn btn-ghost btn-sm">Все →</button>
          </div>
          <div className="vitals">
            <div style={{ color: 'var(--fg-3)', textAlign: 'center', padding: 12 }}>Скоро · подключение Apple Health</div>
          </div>
        </div>
      )}

      {/* Анализы — реальные из МИС */}
      {FEATURE_ANALYSES_ENABLED && Array.isArray(misAnalyses) && misAnalyses.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-hd">
            <div>
              <div className="card-title">Последние анализы</div>
              <div className="card-sub">по данным МИС</div>
            </div>
          </div>
          <div className="vitals">
            {misAnalyses.slice(0, 5).map((a, i) => {
              const vals = Array.isArray(a.history) ? a.history.map(h => parseFloat(h.value)).filter(v => !isNaN(v)) : []
              const status = a.status || 'norm'
              const cl = status === 'norm' ? 'good' : 'warn'
              return (
                <div className="vital-row" key={a.code || a.name || i}>
                  <div className="vital-label">{a.title || a.name || '—'}<small>{a.ref_range ? `норма ${a.ref_range}` : ''} {a.unit || ''}</small></div>
                  {vals.length >= 2 && (
                    <Sparkline vals={vals} color={status === 'norm' ? 'oklch(0.82 0.16 150)' : 'oklch(0.85 0.14 75)'} />
                  )}
                  <span className={`chip chip-${cl}`}>{status === 'norm' ? 'норма' : 'внимание'}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!nextApt && activeRefs.length === 0 && misVisits.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>👋</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Добро пожаловать в кабинет</div>
          <p style={{ fontSize: 13, color: 'var(--fg-3)' }}>Здесь появятся ваши направления, записи и история визитов.</p>
        </div>
      )}
    </>
  )
}

// ── Карточка ближайшего приёма ───────────────────────────────────────────────
function NextApptCard({ apt, onQr, onReschedule, onCancelled }) {
  // Toast вместо alert
  const { toast } = useToast()
  const dt = apt.appointment_date ? new Date(apt.appointment_date + 'T00:00') : null
  const day = dt ? dt.getDate() : '—'
  const mon = dt ? MONTHS_R[dt.getMonth()] : ''
  const dow = dt ? DAYS_FULL[dt.getDay()] : ''
  const startHHMM = (apt.start_time || '').slice(0, 5)
  const endHHMM = (apt.end_time || '').slice(0, 5)
  const tooLate = hoursUntil(apt.appointment_date, apt.start_time) < 6
  const status = String(apt.status || '').toLowerCase()
  const statusChip = status === 'confirmed' ? 'chip-good' : 'chip-warn'
  const statusLabel = status === 'confirmed' ? 'Подтверждена' : 'Ожидает'
  const [confirming, setConfirming] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  async function doCancel() {
    if (!apt.patient_token) { toast('Токен записи отсутствует', 'warn'); return }
    setCancelling(true)
    try {
      await axios.post(`${API}/patient/appointment/${apt.id}/cancel`, { reason: 'Отменено пациентом' }, { params: { t: apt.patient_token } })
      setConfirming(false)
      onCancelled && onCancelled(apt.id)
    } catch (e) {
      toast(e.response?.data?.detail || 'Не удалось отменить', 'error')
    } finally { setCancelling(false) }
  }

  return (
    <>
      <div className="appt-card" style={{ marginBottom: 16 }}>
        <div className="appt-date">
          <div className="appt-date-day">{day}</div>
          <div className="appt-date-mon">{mon}</div>
          {dow && <div className="appt-date-dow">{dow}</div>}
          <div className="appt-date-time">{startHHMM}{endHHMM ? ` – ${endHHMM}` : ''}</div>
        </div>
        <div className="appt-info">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span className={`chip ${statusChip}`}><span className="chip-dot"></span>{statusLabel} · {dow}</span>
            {apt.short_code && <span className="chip" style={{ fontFamily: 'SF Mono, Consolas, monospace', letterSpacing: 2 }}>код {apt.short_code}</span>}
          </div>
          <h4>{apt.specialty || apt.doctor_name || 'Приём'}</h4>
          <div className="appt-meta">{apt.clinic_name || '—'}{apt.cabinet ? ` · каб. ${apt.cabinet}` : ''}</div>
          {apt.clinic_address && <div className="appt-meta">{apt.clinic_address}</div>}
          <div className="appt-doc">
            <div className="appt-doc-avatar">{getInitials(apt.doctor_name)}</div>
            <span>{apt.doctor_name || 'Врач'}</span>
          </div>
          <div className="appt-actions">
            {apt.qr_code && <button className="btn btn-primary btn-sm" onClick={() => onQr(apt.qr_code)}>Открыть QR</button>}
            {(apt.clinic_address || apt.clinic_latitude) && (
              <a href={buildMapUrl(apt.clinic_address, apt.clinic_latitude, apt.clinic_longitude)} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">Маршрут</a>
            )}
            <button className="btn btn-secondary btn-sm" onClick={() => downloadIcs(apt)}>В календарь</button>
            <button className="btn btn-ghost btn-sm" disabled={tooLate} onClick={() => !tooLate && onReschedule(apt)}>Перенести</button>
            <button className="btn btn-ghost btn-sm" disabled={tooLate}
              style={{ color: tooLate ? 'var(--fg-4)' : 'var(--bad)' }}
              onClick={() => !tooLate && setConfirming(true)}>Отменить</button>
          </div>
        </div>
      </div>

      {confirming && (
        <div className="cp-modal-overlay" onClick={() => !cancelling && setConfirming(false)}>
          <div className="cp-modal" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <h3>Отменить запись?</h3>
            <p style={{ fontSize: 13, color: 'var(--fg-3)', marginBottom: 16 }}>
              {apt.doctor_name} · {day} {mon}{startHHMM ? `, ${startHHMM}` : ''}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button onClick={() => setConfirming(false)} disabled={cancelling} className="btn btn-secondary">Передумал</button>
              <button onClick={doCancel} disabled={cancelling} className="btn btn-primary" style={{ background: 'var(--bad)' }}>
                {cancelling ? 'Отмена...' : 'Да, отменить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── BookingPage (4 шага) ─────────────────────────────────────────────────────
// ── Stars ────────────────────────────────────────────────────────────────────
function StarsRating({ rating, size=14 }) {
  const r = rating || 0
  return (
    <span style={{ display:'inline-flex', gap:1 }}>
      {[1,2,3,4,5].map(i => {
        const fill = Math.min(1, Math.max(0, r - i + 1))
        return (
          <span key={i} style={{ position:'relative', fontSize:size, lineHeight:1 }}>
            <span style={{ color:'var(--bg-3)' }}>★</span>
            <span style={{ position:'absolute', left:0, top:0, overflow:'hidden', width:`${fill*100}%`, color:'var(--gold)' }}>★</span>
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
          style={{ fontSize:32, color: i<=(hover||value)?'var(--gold)':'var(--bg-3)', cursor:'pointer', transition:'color .15s' }}>
          ★
        </span>
      ))}
    </div>
  )
}

function ReviewFormModal({ doctorId, tenantId, onClose, onDone }) {
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

  return (
    <div className="cp-modal-overlay" onClick={onClose}>
      <div className="cp-modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <h3>Оставить отзыв</h3>
        {ok ? (
          <div style={{ textAlign:'center', padding:'20px 0' }}>
            <div style={{ fontSize:42, marginBottom:8 }}>🙏</div>
            <p style={{ fontWeight:600, marginBottom:4 }}>Спасибо за отзыв!</p>
            <p style={{ fontSize:13, color:'var(--fg-3)' }}>Появится после проверки</p>
          </div>
        ) : (
          <>
            <div style={{ marginBottom:14 }}>
              <p style={{ fontSize:13, color:'var(--fg-3)', marginBottom:10 }}>Ваша оценка:</p>
              <StarSelect value={rating} onChange={setRating} />
            </div>
            <textarea value={comment} onChange={e=>setComment(e.target.value)} rows={4} placeholder="Расскажите о визите..."
              style={{ width:'100%', padding:'12px', background:'var(--bg-1)', color:'var(--fg)', border:'1px solid var(--border)', borderRadius:10, fontSize:14, fontFamily:'inherit', resize:'vertical', boxSizing:'border-box' }} />
            <div style={{ display:'flex', gap:10, marginTop:10, alignItems:'center' }}>
              <input value={name} onChange={e=>setName(e.target.value)} placeholder="Ваше имя" disabled={anon}
                style={{ flex:1, padding:'10px 12px', background:'var(--bg-1)', color:'var(--fg)', border:'1px solid var(--border)', borderRadius:10, fontSize:13, opacity:anon?0.4:1 }} />
              <label style={{ display:'flex', gap:6, alignItems:'center', fontSize:12, color:'var(--fg-3)', cursor:'pointer', whiteSpace:'nowrap' }}>
                <input type="checkbox" checked={anon} onChange={e=>setAnon(e.target.checked)} />
                Анонимно
              </label>
            </div>
            {err && <p style={{ color:'var(--bad)', fontSize:13, marginTop:8 }}>{err}</p>}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginTop:14 }}>
              <button onClick={onClose} className="btn btn-secondary">Отмена</button>
              <button onClick={submit} disabled={saving||!rating} className="btn btn-primary">
                {saving?'Отправка...':'Отправить'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function DoctorProfileModal({ doc, tenantId, onClose, onBookFrom }) {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [reviewOpen, setReviewOpen] = useState(false)

  useEffect(() => {
    axios.get(`${API}/public/${SLUG}/doctors/${doc.id}/profile`)
      .then(r => setProfile(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [doc.id])

  return (
    <div className="cp-modal-overlay" onClick={onClose}>
      <div className="cp-modal" style={{ maxWidth: 640, width: '95%', maxHeight: '92vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <button onClick={onClose} style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', color: 'var(--fg-3)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>✕</button>

        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', marginBottom: 20 }}>
          {doc.photo_url ? (
            <img src={doc.photo_url} alt={doc.full_name} style={{ width: 88, height: 88, borderRadius: 16, objectFit: 'cover', border: '1px solid var(--border)' }} />
          ) : (
            <div style={{ width: 88, height: 88, borderRadius: 16, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, fontWeight: 600 }}>
              {getInitials(doc.full_name)}
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ marginBottom: 4 }}>{doc.full_name}</h3>
            <p style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600, marginBottom: 6 }}>{doc.specialty || 'Врач'}</p>
            <p style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 8 }}>
              {doc.experience_years ? `Стаж ${doc.experience_years} лет · ` : ''}{doc.clinic_name || ''}
            </p>
            {doc.avg_rating > 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <StarsRating rating={doc.avg_rating} size={14} />
                <b style={{ fontSize: 14 }}>{doc.avg_rating}</b>
                <span style={{ fontSize: 12, color: 'var(--fg-4)' }}>({doc.review_count || 0})</span>
              </div>
            ) : <span style={{ fontSize: 12, color: 'var(--fg-4)' }}>Нет оценок</span>}
          </div>
        </div>

        {doc.bio && (
          <div style={{ marginBottom: 18, padding: '14px 16px', background: 'var(--bg-1)', borderRadius: 10, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Биография</div>
            <p style={{ fontSize: 13, color: 'var(--fg-2)', lineHeight: 1.6 }}>{doc.bio}</p>
          </div>
        )}

        {loading && <div style={{ textAlign: 'center', padding: 20, color: 'var(--fg-3)' }}>Загрузка отзывов...</div>}

        {!loading && profile && (
          <>
            <div style={{ display: 'flex', gap: 16, marginBottom: 16, alignItems: 'center', padding: '14px 16px', background: 'var(--bg-1)', borderRadius: 10, border: '1px solid var(--border)' }}>
              <div style={{ textAlign: 'center', flexShrink: 0 }}>
                <div style={{ fontSize: 36, fontWeight: 700, color: 'var(--gold)', lineHeight: 1 }}>{profile.avg_rating || '—'}</div>
                <StarsRating rating={profile.avg_rating} size={13} />
                <div style={{ fontSize: 11, color: 'var(--fg-4)', marginTop: 4 }}>{profile.total_reviews || 0} отзывов</div>
              </div>
              <div style={{ flex: 1 }}>
                {[5,4,3,2,1].map(s => {
                  const cnt = profile.rating_breakdown?.[s] || 0
                  const total = profile.total_reviews || 0
                  const pct = total > 0 ? Math.round(cnt / total * 100) : 0
                  return (
                    <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      <span style={{ fontSize: 11, color: 'var(--fg-4)', width: 8, textAlign: 'right' }}>{s}</span>
                      <span style={{ fontSize: 10, color: 'var(--gold)' }}>★</span>
                      <div style={{ flex: 1, height: 5, background: 'var(--bg-3)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--gold)', borderRadius: 3 }} />
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--fg-4)', width: 22 }}>{cnt}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            <div style={{ display: 'grid', gap: 10, marginBottom: 18 }}>
              {(profile.reviews || []).map(r => (
                <div key={r.id} style={{ padding: '12px 14px', background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{r.is_anonymous ? 'Анонимно' : (r.patient_name || 'Пациент')}</span>
                    <span style={{ fontSize: 11, color: 'var(--fg-4)' }}>{r.created_at ? new Date(r.created_at).toLocaleDateString('ru-RU') : ''}</span>
                  </div>
                  <StarsRating rating={r.rating} size={12} />
                  {r.comment && <p style={{ marginTop: 6, fontSize: 13, color: 'var(--fg-2)', lineHeight: 1.5 }}>{r.comment}</p>}
                </div>
              ))}
              {(!profile.reviews || profile.reviews.length === 0) && (
                <p style={{ textAlign: 'center', color: 'var(--fg-4)', fontSize: 13, padding: 12 }}>Пока нет отзывов</p>
              )}
            </div>
          </>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: doc.has_schedule ? '1fr 1fr' : '1fr', gap: 8, position: 'sticky', bottom: 0, paddingTop: 12, background: 'var(--surface)' }}>
          <button onClick={() => setReviewOpen(true)} className="btn btn-secondary">Оставить отзыв</button>
          {doc.has_schedule && (
            <button onClick={() => { onClose(); onBookFrom && onBookFrom(doc) }} className="btn btn-primary">Записаться</button>
          )}
        </div>

        {reviewOpen && (
          <ReviewFormModal doctorId={doc.id} tenantId={tenantId} onClose={() => setReviewOpen(false)} onDone={() => setReviewOpen(false)} />
        )}
      </div>
    </div>
  )
}

function DoctorsPage({ onGo }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [specFilter, setSpec] = useState('')
  const [profileDoc, setProfileDoc] = useState(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    axios.get(`${API}/public/${SLUG}/clinic`)
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <>
      <div className="page-head"><div><div className="page-title">Врачи</div></div></div>
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><div className="cp-spinner" /></div>
    </>
  )
  if (!data) return (
    <>
      <div className="page-head"><div><div className="page-title">Врачи</div></div></div>
      <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--fg-3)' }}>Не удалось загрузить список</div>
    </>
  )

  const { specialties = [], doctors = [] } = data
  let filtered = specFilter ? doctors.filter(d => d.specialty === specFilter) : doctors
  if (search) {
    const q = search.toLowerCase()
    filtered = filtered.filter(d => (d.full_name || '').toLowerCase().includes(q) || (d.specialty || '').toLowerCase().includes(q))
  }
  const sorted = [...filtered].sort((a, b) => {
    if (a.has_schedule !== b.has_schedule) return b.has_schedule ? 1 : -1
    return (b.avg_rating || 0) - (a.avg_rating || 0)
  })
  const tenantId = data.tenant?.id

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Врачи</div>
          <div className="page-sub">{doctors.length} специалистов · нажмите на врача для деталей</div>
        </div>
      </div>

      <input type="text" placeholder="Поиск по имени или специальности..." value={search} onChange={e => setSearch(e.target.value)}
        style={{ width: '100%', marginBottom: 14, padding: '12px 16px', background: 'var(--bg-2)', color: 'var(--fg)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 14, boxSizing: 'border-box' }} />

      {specialties.length > 1 && (
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8, marginBottom: 14 }}>
          {['', ...specialties].map(s => (
            <button key={s || 'all'} onClick={() => setSpec(s)}
              className={`chip${specFilter === s ? ' chip-accent' : ''}`}
              style={{ flexShrink: 0, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {s || 'Все специальности'}
            </button>
          ))}
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--fg-3)' }}>Врачей не найдено</div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {sorted.map(doc => (
            <button key={doc.id} onClick={() => setProfileDoc(doc)}
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, cursor: 'pointer', textAlign: 'left', transition: 'all .15s', display: 'flex', gap: 14, alignItems: 'flex-start' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-hi)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}>
              {doc.photo_url ? (
                <img src={doc.photo_url} alt={doc.full_name} style={{ width: 56, height: 56, borderRadius: 12, objectFit: 'cover', flexShrink: 0 }} />
              ) : (
                <div style={{ width: 56, height: 56, borderRadius: 12, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 600, flexShrink: 0 }}>
                  {getInitials(doc.full_name)}
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg)', marginBottom: 2 }}>{doc.full_name}</div>
                <div style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 500, marginBottom: 4 }}>{doc.specialty || 'Врач'}</div>
                <div style={{ fontSize: 11.5, color: 'var(--fg-4)', marginBottom: 6 }}>
                  {doc.experience_years ? `Стаж ${doc.experience_years} лет · ` : ''}{doc.clinic_name || ''}
                </div>
                {doc.avg_rating > 0 ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <StarsRating rating={doc.avg_rating} size={13} />
                    <b style={{ fontSize: 12.5 }}>{doc.avg_rating}</b>
                    <span style={{ fontSize: 11, color: 'var(--fg-4)' }}>· {doc.review_count || 0}</span>
                  </div>
                ) : <span style={{ fontSize: 11, color: 'var(--fg-4)' }}>Нет оценок</span>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                {doc.has_schedule ? (
                  <span className="chip chip-good" style={{ fontSize: 10 }}>Принимает</span>
                ) : (
                  <span className="chip" style={{ fontSize: 10 }}>Нет расписания</span>
                )}
                <span style={{ fontSize: 18, color: 'var(--fg-4)' }}>›</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {profileDoc && (
        <DoctorProfileModal doc={profileDoc} tenantId={tenantId} onClose={() => setProfileDoc(null)}
          onBookFrom={() => onGo && onGo('booking')} />
      )}
    </>
  )
}

function BookingPage({ patientName, patientPhone, onGo }) {
  const [step, setStep] = useState(0)
  const [doctors, setDoctors] = useState([])
  const [docsLoading, setDocsLoading] = useState(true)
  const [tenantInfo, setTenantInfo] = useState(null)
  const [specFilter, setSpecFilter] = useState('Все')
  const [clinicFilter, setClinicFilter] = useState('Все')
  const [priceFilter, setPriceFilter] = useState(null) // null | 'low'(<3k) | 'mid'(3-5k) | 'high'(>5k)
  const [doc, setDoc] = useState(null)
  const [availMap, setAvailMap] = useState(null)
  const [availLoading, setAvLoad] = useState(false)
  const [selDate, setSelDate] = useState(null)
  const [slots, setSlots] = useState([])
  const [slotsLoading, setSlLoading] = useState(false)
  const [selSlot, setSelSlot] = useState(null)
  const [name, setName] = useState(patientName || '')
  const [phone, setPhone] = useState(patientPhone || '')
  const [booking, setBooking] = useState(false)
  const [bookErr, setBookErr] = useState('')
  const [done, setDone] = useState(null)

  // Загрузка врачей
  useEffect(() => {
    let alive = true
    setDocsLoading(true)
    axios.get(`${API}/public/${SLUG}/clinic`)
      .then(r => {
        if (!alive) return
        setDoctors(Array.isArray(r.data?.doctors) ? r.data.doctors : [])
        setTenantInfo(r.data?.tenant || null)
      })
      .catch(() => {})
      .finally(() => { if (alive) setDocsLoading(false) })
    return () => { alive = false }
  }, [])

  const specialties = useMemo(() => {
    const s = new Set()
    doctors.forEach(d => { if (d.specialty) s.add(d.specialty) })
    return ['Все', ...Array.from(s)]
  }, [doctors])

  const clinics = useMemo(() => {
    const s = new Set()
    doctors.forEach(d => { if (d.clinic_name) s.add(d.clinic_name) })
    return ['Все', ...Array.from(s)]
  }, [doctors])

  const filtered = useMemo(() => {
    let list = doctors
    if (specFilter !== 'Все') list = list.filter(d => d.specialty === specFilter)
    if (clinicFilter !== 'Все') list = list.filter(d => d.clinic_name === clinicFilter)
    if (priceFilter) {
      list = list.filter(d => {
        const p = d.price || 0
        if (priceFilter === 'low') return p > 0 && p < 3000
        if (priceFilter === 'mid') return p >= 3000 && p <= 5000
        if (priceFilter === 'high') return p > 5000
        return true
      })
    }
    return list.sort((a, b) => (b.avg_rating || 0) - (a.avg_rating || 0))
  }, [doctors, specFilter, clinicFilter, priceFilter])

  // Когда выбран врач — загружаем availability
  useEffect(() => {
    if (!doc) return
    let alive = true
    setAvLoad(true); setSelDate(null); setSelSlot(null); setSlots([])
    ;(async () => {
      try {
        const today = new Date()
        const to = new Date(); to.setDate(to.getDate() + 13)
        const r = await axios.get(`${API}/public/${SLUG}/doctors/${doc.id}/availability`, {
          params: { from: isoDate(today), to: isoDate(to) },
        })
        if (!alive) return
        const map = {}
        ;(r.data?.days || []).forEach(d => { map[d.date] = d })
        setAvailMap(map)
      } catch { if (alive) setAvailMap({}) }
      finally { if (alive) setAvLoad(false) }
    })()
    return () => { alive = false }
  }, [doc])

  async function pickDate(d) {
    const key = isoDate(d)
    if (availMap && (!availMap[key] || !availMap[key].free_slots)) return
    setSelDate(d); setSelSlot(null); setSlots([]); setSlLoading(true)
    try {
      const r = await axios.get(`${API}/public/${SLUG}/doctors/${doc.id}/slots`, { params: { date: key } })
      const list = Array.isArray(r.data) ? r.data.filter(s => s.available !== false) : []
      setSlots(list)
    } catch { setSlots([]) }
    finally { setSlLoading(false) }
  }

  async function book() {
    if (!doc || !selDate || !selSlot) { setBookErr('Заполните все поля'); return }
    setBooking(true); setBookErr('')
    try {
      const r = await axios.post(`${API}/public/${SLUG}/book`, {
        doctor_id: doc.id,
        appointment_date: isoDate(selDate),
        start_time: selSlot,
        patient_name: name || patientName || 'Пациент',
        patient_phone: phone || patientPhone || '',
      })
      setDone(r.data)
      setStep(3)
    } catch (e) {
      setBookErr(e.response?.data?.detail || 'Ошибка записи')
    } finally { setBooking(false) }
  }

  const days = useMemo(() => {
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() + i)
      return d
    })
  }, [])

  const steps = ['Специалист', 'Дата и время', 'Подтверждение', 'Готово']

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Запись к врачу</div>
          <div className="page-sub">Выберите специалиста и удобное время · подтверждение мгновенно</div>
        </div>
        <button className="btn btn-ghost" onClick={() => onGo('home')}>← На главную</button>
      </div>

      <div className="booking-stage">
        <div className="booking-steps">
          {steps.map((s, i) => (
            <div key={s} className={`booking-step ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`}>
              <div className="booking-step-num">{i < step ? '✓' : i + 1}</div>{s}
            </div>
          ))}
        </div>

        <div className="booking-body">
          {/* STEP 0: специалист */}
          {step === 0 && (
            <div className="booking-grid">
              <div className="filter-card">
                {specialties.length > 1 && (
                  <div className="filter-group">
                    <div className="filter-label">Специальность</div>
                    <div className="chip-group">
                      {specialties.map(s => (
                        <button key={s} className="chip-toggle" data-active={specFilter === s} onClick={() => setSpecFilter(s)}>{s}</button>
                      ))}
                    </div>
                  </div>
                )}
                {clinics.length > 2 && (
                  <div className="filter-group">
                    <div className="filter-label">Клиника</div>
                    <div className="chip-group">
                      {clinics.map(s => (
                        <button key={s} className="chip-toggle" data-active={clinicFilter === s} onClick={() => setClinicFilter(s)}>{s}</button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="filter-group">
                  <div className="filter-label">Цена</div>
                  <div className="chip-group">
                    <button className="chip-toggle" data-active={priceFilter === null} onClick={() => setPriceFilter(null)}>Любая</button>
                    <button className="chip-toggle" data-active={priceFilter === 'low'} onClick={() => setPriceFilter('low')}>до 3 000 ₽</button>
                    <button className="chip-toggle" data-active={priceFilter === 'mid'} onClick={() => setPriceFilter('mid')}>3–5 000 ₽</button>
                    <button className="chip-toggle" data-active={priceFilter === 'high'} onClick={() => setPriceFilter('high')}>5 000+</button>
                  </div>
                </div>
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, fontSize: 13, color: 'var(--fg-3)' }}>
                  <span>Найдено: <b style={{ color: 'var(--fg)' }}>{filtered.length}</b> · сортировка: рейтинг</span>
                </div>
                {docsLoading ? (
                  <div style={{ textAlign: 'center', padding: 40 }}><div className="cp-spinner" style={{ margin: '0 auto' }} /></div>
                ) : filtered.length === 0 ? (
                  <div className="card" style={{ textAlign: 'center', color: 'var(--fg-3)', padding: 28 }}>
                    Нет врачей по выбранным фильтрам
                  </div>
                ) : (
                  <div className="doc-list">
                    {filtered.map((dd, i) => {
                      const photoCls = ['', 'p2', 'p3', 'p4'][i % 4]
                      return (
                        <button key={dd.id} className={`doc-card ${doc?.id === dd.id ? 'selected' : ''}`}
                          onClick={() => setDoc(dd)}>
                          {dd.photo_url ? (
                            <div className="doc-photo"><img src={dd.photo_url} alt={dd.full_name} /></div>
                          ) : (
                            <div className={`doc-photo ${photoCls}`}>{getInitials(dd.full_name)}</div>
                          )}
                          <div className="doc-info">
                            <div className="doc-name">{dd.full_name}</div>
                            <div className="doc-spec">{dd.specialty || 'Врач'}</div>
                            <div className="doc-meta">
                              {dd.avg_rating > 0 && <span className="gold">★ <b>{dd.avg_rating}</b></span>}
                              {dd.review_count > 0 && <span>{dd.review_count} отзывов</span>}
                              {dd.experience_years && <span>стаж {dd.experience_years} лет</span>}
                              {dd.clinic_name && <span>· {dd.clinic_name}</span>}
                            </div>
                          </div>
                          {dd.price > 0 && (
                            <div className="doc-price">
                              <div className="doc-price-amount">{dd.price.toLocaleString('ru')} ₽</div>
                              <div className="doc-price-from">первичный</div>
                            </div>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
                  <button className="btn btn-primary btn-lg"
                    disabled={!doc} style={{ opacity: doc ? 1 : 0.4 }}
                    onClick={() => doc && setStep(1)}>Выбрать дату →</button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 1: дата + время */}
          {step === 1 && doc && (
            <div className="booking-grid">
              <div className="filter-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                  {doc.photo_url ? (
                    <div className="doc-photo" style={{ width: 48, height: 48 }}><img src={doc.photo_url} alt={doc.full_name} /></div>
                  ) : (
                    <div className="doc-photo" style={{ width: 48, height: 48, fontSize: 14 }}>{getInitials(doc.full_name)}</div>
                  )}
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{doc.full_name}</div>
                    <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>{doc.specialty}</div>
                  </div>
                </div>
                {doc.clinic_name && (
                  <div className="filter-group">
                    <div className="filter-label">Клиника</div>
                    <div style={{ background: 'var(--bg-2)', padding: 10, borderRadius: 9, border: '1px solid var(--border)', fontSize: 12.5 }}>
                      <div style={{ fontWeight: 600, marginBottom: 2 }}>{doc.clinic_name}</div>
                      {doc.clinic_address && <div style={{ color: 'var(--fg-3)' }}>{doc.clinic_address}</div>}
                    </div>
                  </div>
                )}
                {doc.price > 0 && (
                  <div className="filter-group">
                    <div className="filter-label">Стоимость</div>
                    <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>{doc.price.toLocaleString('ru')} ₽</div>
                  </div>
                )}
              </div>

              <div className="cal-card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>Ближайшие 14 дней</div>
                </div>
                {availLoading ? (
                  <div style={{ textAlign: 'center', padding: 24 }}><div className="cp-spinner" style={{ margin: '0 auto' }} /></div>
                ) : (
                  <>
                    <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8, marginBottom: 14 }}>
                      {days.map((d, i) => {
                        const key = isoDate(d)
                        const info = availMap?.[key]
                        const free = info?.free_slots || 0
                        const enabled = free > 0
                        const isSel = selDate && isoDate(selDate) === key
                        return (
                          <button key={d.toISOString()} disabled={!enabled} onClick={() => pickDate(d)}
                            className={`cal-day ${!enabled ? 'disabled' : ''} ${isSel ? 'selected' : ''}`}
                            style={{ minWidth: 64, flexShrink: 0 }}>
                            <div className="cal-day-dow">{DAYS_SHORT[d.getDay()]}</div>
                            <div className="cal-day-num">{d.getDate()}</div>
                            <div style={{ fontSize: 9.5, color: isSel ? 'var(--accent-fg)' : 'var(--fg-3)', marginTop: 2 }}>
                              {enabled ? `${free} ${free === 1 ? 'слот' : (free < 5 ? 'слота' : 'слотов')}` : '—'}
                            </div>
                          </button>
                        )
                      })}
                    </div>

                    {selDate && (
                      <>
                        <div className="slots-label">Свободно на {DAYS_SHORT[selDate.getDay()]}, {selDate.getDate()} {MONTHS_R[selDate.getMonth()]} · {slots.length} {slots.length === 1 ? 'слот' : (slots.length < 5 ? 'слота' : 'слотов')}</div>
                        {slotsLoading ? (
                          <div style={{ textAlign: 'center', padding: 20 }}><div className="cp-spinner" style={{ margin: '0 auto' }} /></div>
                        ) : slots.length === 0 ? (
                          <div style={{ color: 'var(--fg-3)', textAlign: 'center', padding: 16 }}>Нет свободных слотов</div>
                        ) : (
                          <div className="slot-grid">
                            {slots.map(s => (
                              <button key={s.start_time}
                                className={`slot ${selSlot === s.start_time ? 'selected' : ''}`}
                                onClick={() => setSelSlot(s.start_time)}>
                                {s.start_time}
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 18 }}>
                  <button className="btn btn-secondary" onClick={() => setStep(0)}>← Назад</button>
                  <button className="btn btn-primary btn-lg" disabled={!selSlot}
                    style={{ opacity: selSlot ? 1 : 0.4 }}
                    onClick={() => selSlot && setStep(2)}>Подтвердить →</button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: подтверждение */}
          {step === 2 && doc && selDate && selSlot && (
            <div className="confirm-grid">
              <div className="confirm-panel">
                <h3>Проверьте детали приёма</h3>
                <div className="confirm-row"><span>Специалист</span><span>{doc.full_name}</span></div>
                <div className="confirm-row"><span>Специальность</span><span>{doc.specialty || '—'}</span></div>
                <div className="confirm-row"><span>Дата</span><span>{selDate.getDate()} {MONTHS_FULL[selDate.getMonth()]} {selDate.getFullYear()}</span></div>
                <div className="confirm-row"><span>Время</span><span>{selSlot}</span></div>
                {doc.clinic_name && <div className="confirm-row"><span>Клиника</span><span>{doc.clinic_name}</span></div>}

                <div style={{ marginTop: 22, fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Контактные данные</div>
                <div style={{ display: 'grid', gap: 8 }}>
                  <input className="cp-input" value={name} onChange={e => setName(e.target.value)} placeholder="ФИО" />
                  <input className="cp-input" value={phone} onChange={e => setPhone(e.target.value)} placeholder="Телефон (+7...)" />
                </div>
                {bookErr && <div className="chip chip-bad" style={{ display: 'block', padding: '8px 12px', marginTop: 12 }}>{bookErr}</div>}
              </div>
              <div className="confirm-summary">
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-3)' }}>К оплате</div>
                <div className="confirm-pricing">
                  <div className="row"><span>Приём ({(doc.specialty || '').split(' ·')[0]})</span><span>{(doc.price || 0).toLocaleString('ru')} ₽</span></div>
                  <div className="row total"><span>Итого</span><span>{(doc.price || 0).toLocaleString('ru')} ₽</span></div>
                </div>
                <button className="btn btn-primary btn-lg" style={{ width: '100%', marginBottom: 8 }}
                  onClick={book} disabled={booking}>
                  {booking ? 'Записываем...' : 'Подтвердить запись'}
                </button>
                <button className="btn btn-ghost btn-sm" style={{ width: '100%' }} onClick={() => setStep(1)}>← Изменить время</button>
              </div>
            </div>
          )}

          {/* STEP 3: success */}
          {step === 3 && done && (
            <div className="success-stage">
              <div className="success-icon">✓</div>
              <h3>Запись подтверждена</h3>
              <p>Ждём вас {selDate ? `${selDate.getDate()} ${MONTHS_FULL[selDate.getMonth()]}` : ''} в {selSlot || ''}. Мы пришлём напоминание за сутки и за час до приёма.</p>
              {done.qr_code && (
                <div className="qr-box">
                  <img src={done.qr_code.startsWith('data:') ? done.qr_code : `data:image/png;base64,${done.qr_code}`} alt="QR" />
                  <div className="qr-box-label">Покажите на регистратуре</div>
                </div>
              )}
              {done.short_code && (
                <div style={{ marginTop: 18, fontSize: 13, color: 'var(--fg-3)' }}>
                  Код визита: <b style={{ fontSize: 18, color: 'var(--fg)', letterSpacing: 4 }}>{done.short_code}</b>
                </div>
              )}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 26, flexWrap: 'wrap' }}>
                <button className="btn btn-secondary" onClick={() => downloadIcs({
                  id: done.id, appointment_date: done.appointment_date,
                  start_time: done.start_time, end_time: done.end_time,
                  doctor_name: doc?.full_name, clinic_name: doc?.clinic_name,
                  clinic_address: doc?.clinic_address, short_code: done.short_code,
                })}>В календарь (.ics)</button>
                {doc?.clinic_address && (
                  <a href={buildMapUrl(doc.clinic_address)} target="_blank" rel="noreferrer" className="btn btn-secondary">Маршрут</a>
                )}
                <button className="btn btn-primary" onClick={() => onGo('appointments')}>Мои приёмы →</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ── AppointmentsPage (заглушка-таймлайн в новом стиле) ───────────────────────
function AppointmentsPage({ data, onQr, onReschedule, onCancelled }) {
  const [tab, setTab] = useState('upcoming')
  const isApt = data?.type === 'appointment'
  const appointments = isApt ? [] : (data?.appointments || [])
  const allRefs = isApt ? [] : [data?.current, ...(data?.other_referrals || [])].filter(Boolean)
  const cancelled = allRefs.filter(r => r.status === 'cancelled' || r.status === 'cancel_requested')
  const upcoming = appointments
  const history = isApt ? [] : (data?.mis_visits || [])

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Мои приёмы</div>
          <div className="page-sub">Предстоящие и история визитов</div>
        </div>
      </div>

      <div className="tabs">
        <button className="tab" data-active={tab === 'upcoming'} onClick={() => setTab('upcoming')}>
          Предстоящие · {upcoming.length}
        </button>
        <button className="tab" data-active={tab === 'history'} onClick={() => setTab('history')}>
          История · {history.length}
        </button>
        <button className="tab" data-active={tab === 'cancelled'} onClick={() => setTab('cancelled')}>
          Отменённые · {cancelled.length}
        </button>
      </div>

      {tab === 'upcoming' && (
        upcoming.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', color: 'var(--fg-3)', padding: 40 }}>
            Нет предстоящих приёмов
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {upcoming.map(a => <NextApptCard key={a.id} apt={a} onQr={onQr} onReschedule={onReschedule} onCancelled={onCancelled} />)}
          </div>
        )
      )}

      {tab === 'history' && (
        history.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', color: 'var(--fg-3)', padding: 40 }}>
            История визитов пуста
          </div>
        ) : (
          <div className="timeline">
            {history.map((v, i) => <VisitTlItem key={i} v={v} />)}
          </div>
        )
      )}

      {tab === 'cancelled' && (
        cancelled.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', color: 'var(--fg-3)', padding: 40 }}>
            Нет отменённых направлений
          </div>
        ) : (
          <div className="timeline">
            {cancelled.map(r => (
              <div key={r.id} className="tl-item">
                <div className="tl-date">
                  <b>{r.created_at ? new Date(r.created_at).getDate() : '—'}</b>
                  <span>{r.created_at ? MONTHS_R[new Date(r.created_at).getMonth()] : ''}</span>
                </div>
                <div>
                  <div className="tl-title">{r.to_clinic_name}</div>
                  <div className="tl-meta">{r.service_name}</div>
                </div>
                <span className="chip chip-bad">Отменено</span>
              </div>
            ))}
          </div>
        )
      )}
    </>
  )
}

// ── HistoryPage (timeline-стиль для МИС-визитов) ─────────────────────────────
function VisitTlItem({ v }) {
  const [open, setOpen] = useState(false)
  const dp = (v.time_start || '').split(' ')[0] || ''
  const tp = (v.time_start || '').split(' ')[1] || ''
  const [d, mo, y] = dp.split('.')
  const services = Array.isArray(v.services) ? v.services : []
  const first = services[0]?.title || '—'
  const status = v.status || ''
  const cl = status === 'completed' ? 'chip-good' : (status === 'refused' ? 'chip-bad' : 'chip-accent')
  const lbl = status === 'completed' ? 'Завершён' : (status === 'refused' ? 'Отменён' : 'Активен')
  const expandable = services.length > 0

  return (
    <div className="tl-item" style={{ cursor: expandable ? 'pointer' : 'default' }} onClick={() => expandable && setOpen(o => !o)}>
      <div className="tl-date">
        <b>{d || '—'}.{mo || ''}</b>
        <span>{y || ''}</span>
        {tp && <span style={{ display: 'block', fontSize: 11, color: 'var(--fg-4)', marginTop: 4 }}>{tp}</span>}
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="tl-title">{first}</div>
        <div className="tl-meta">{v.doctor || '—'}{v.clinic ? ` · ${v.clinic}` : ''}</div>
        {v.sum_value > 0 && (
          <div style={{ marginTop: 6, fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>
            {v.sum_value.toLocaleString('ru-RU')} ₽
          </div>
        )}
        {expandable && (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--fg-3)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>{open ? '▴ скрыть услуги' : `▾ показать ${services.length} ${services.length === 1 ? 'услугу' : 'услуг'}`}</span>
          </div>
        )}
        {open && services.length > 0 && (
          <div onClick={e => e.stopPropagation()} style={{ marginTop: 12, padding: '12px 14px', borderRadius: 10, background: 'var(--bg-1)', border: '1px solid var(--border)', display: 'grid', gap: 8 }}>
            {services.map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, paddingBottom: 8, borderBottom: i < services.length - 1 ? '1px solid var(--line)' : 'none' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--fg)', lineHeight: 1.4 }}>{s.title || '—'}</div>
                  {s.profession_title && <div style={{ fontSize: 11, color: 'var(--fg-4)', marginTop: 2 }}>{s.profession_title}</div>}
                  {s.code && <div style={{ fontSize: 10, color: 'var(--fg-4)', marginTop: 2, fontFamily: 'SF Mono, Consolas, monospace' }}>{s.code}</div>}
                </div>
                {(s.value || s.price) && (
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', whiteSpace: 'nowrap' }}>
                    {parseInt(s.value || s.price || 0).toLocaleString('ru-RU')} ₽
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
        <span className={`chip ${cl}`}>{lbl}</span>
        {v.is_first && <span className="chip chip-accent">1-й визит</span>}
      </div>
    </div>
  )
}

function HistoryPage({ data }) {
  const isApt = data?.type === 'appointment'
  const visits = isApt ? [] : (data?.mis_visits || [])

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">История визитов</div>
          <div className="page-sub">{visits.length} {visits.length === 1 ? 'запись' : 'записей'} · по данным МИС</div>
        </div>
      </div>

      {visits.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 60 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>⚯</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>История пуста</div>
          <p style={{ fontSize: 13, color: 'var(--fg-3)' }}>После первого визита здесь появится ваша медкарта</p>
        </div>
      ) : (
        <div className="timeline">
          {visits.map((v, i) => <VisitTlItem key={i} v={v} />)}
        </div>
      )}
    </>
  )
}

// ── ProfilePage ──────────────────────────────────────────────────────────────
function ProfilePage({ data, patientName, patientPhone, onOpenFamily, onPushToggle, pushEnabled, pushLoading }) {
  const misInfo = data?.mis_info || null
  const cardNum = misInfo?.card_number || '—'
  const initials = getInitials(patientName)

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">Профиль</div>
          <div className="page-sub">Личные данные, уведомления и семья</div>
        </div>
      </div>

      <div className="profile-hd">
        <div className="profile-photo">{initials}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>{patientName || patientPhone || '—'}</div>
          <div style={{ fontSize: 13, color: 'var(--fg-3)', marginTop: 4 }}>
            {misInfo?.card_number ? `Карта № ${cardNum}` : 'Карта МИС не привязана'}
            {misInfo?.age ? ` · ${misInfo.age} лет` : ''}
            {misInfo?.birth_date ? ` · родился ${misInfo.birth_date}` : ''}
          </div>
        </div>
      </div>

      <div className="med-grid">
        <div className="card">
          <div className="card-hd"><div className="card-title">Контакты</div></div>
          <div style={{ display: 'grid', gap: 4 }}>
            <div className="list-row">
              <div style={{ flex: 1, fontSize: 12.5, color: 'var(--fg-3)' }}>Телефон</div>
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>{patientPhone || '—'}</div>
            </div>
            {misInfo?.email && (
              <div className="list-row">
                <div style={{ flex: 1, fontSize: 12.5, color: 'var(--fg-3)' }}>E-mail</div>
                <div style={{ fontSize: 13.5, fontWeight: 500 }}>{misInfo.email}</div>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-hd"><div className="card-title">Уведомления</div></div>
          <div style={{ display: 'grid', gap: 8 }}>
            <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: 'var(--bg-2)', borderRadius: 9, border: '1px solid var(--border)', fontSize: 13, cursor: 'pointer' }}>
              <span>Push-уведомления</span>
              <button type="button" disabled={pushEnabled || pushLoading}
                onClick={onPushToggle}
                style={{
                  width: 36, height: 20, borderRadius: 999,
                  background: pushEnabled ? 'var(--good)' : 'var(--bg-3)',
                  position: 'relative', cursor: pushEnabled ? 'default' : 'pointer',
                }}>
                <span style={{
                  position: 'absolute', top: 2, left: pushEnabled ? 18 : 2,
                  width: 16, height: 16, borderRadius: '50%', background: '#fff',
                  transition: 'left .15s',
                }} />
              </button>
            </label>
            {misInfo?.send_sms !== undefined && (
              <div className="list-row">
                <div style={{ flex: 1, fontSize: 12.5, color: 'var(--fg-3)' }}>SMS-напоминания</div>
                <span className={`chip ${misInfo.send_sms ? 'chip-good' : ''}`}>{misInfo.send_sms ? 'включены' : 'отключены'}</span>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-hd"><div className="card-title">Семейный доступ</div></div>
          <p style={{ fontSize: 12.5, color: 'var(--fg-3)', marginBottom: 12 }}>
            Управляйте записями родственников из одного аккаунта.
          </p>
          <button onClick={onOpenFamily} className="btn btn-secondary" style={{ width: '100%' }}>Открыть семью</button>
        </div>

        {FEATURE_2FA_ENABLED && (
          <div className="card">
            <div className="card-hd"><div className="card-title">Безопасность</div></div>
            <p style={{ color: 'var(--fg-3)', fontSize: 12.5 }}>2FA / биометрия — скоро.</p>
          </div>
        )}
      </div>
    </>
  )
}

// ── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function PatientCabinetPreview() {
  // Toast вместо alert
  const { toast } = useToast()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showLogin, setShowLogin] = useState(false)
  const [route, setRoute] = useState('home')
  const [theme, setTheme] = useState('teal')
  const [fullscreenQr, setFullscreenQr] = useState(null)
  const [reschedAptId, setReschedAptId] = useState(null)
  const [familyOpen, setFamilyOpen] = useState(false)
  const [familyList, setFamilyList] = useState([])
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushLoading, setPushLoading] = useState(false)

  // Bootstrap auth — повторяем логику основного кабинета
  useEffect(() => {
    registerSW()
    const urlPath = window.location.pathname
    const urlSearch = window.location.search
    // /{slug}/p-new/{ref-id}?t=...
    const urlMatch = urlPath.match(/\/p-new\/([0-9a-f-]{36})/)
    const urlToken = new URLSearchParams(urlSearch).get('t')
    const urlSession = new URLSearchParams(urlSearch).get('s')

    if (urlMatch && urlToken) {
      const urlId = urlMatch[1]
      localStorage.setItem(TOKEN_KEY, urlToken)
      localStorage.setItem(REF_KEY, urlId)
      loadData(urlId, urlToken)
      return
    }
    if (urlSession) {
      localStorage.setItem(SESSION_KEY, urlSession)
      restoreFromSession(urlSession); return
    }
    const session = localStorage.getItem(SESSION_KEY)
    if (session) { restoreFromSession(session); return }

    const token = localStorage.getItem(TOKEN_KEY)
    const refId = localStorage.getItem(REF_KEY)
    if (token && refId) { loadData(refId, token); return }

    setLoading(false); setShowLogin(true)
  }, [])

  const ensureSession = async (token) => {
    if (localStorage.getItem(SESSION_KEY)) {
      updateManifestStartUrl(localStorage.getItem(SESSION_KEY))
      try { window.history.replaceState(null, '', `/${SLUG}/p-new?s=${encodeURIComponent(localStorage.getItem(SESSION_KEY))}`) } catch {}
      return
    }
    try {
      const r = await axios.post(`${API}/patient/session/from-token`, { patient_token: token })
      const s = r.data.session_token
      if (s) {
        localStorage.setItem(SESSION_KEY, s)
        updateManifestStartUrl(s)
        try { window.history.replaceState(null, '', `/${SLUG}/p-new?s=${encodeURIComponent(s)}`) } catch {}
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
      const msg = e.response?.data?.detail || 'Ошибка загрузки'
      setError(msg)
      if (e.response?.status === 403) {
        localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(REF_KEY)
        const s = localStorage.getItem(SESSION_KEY)
        if (s) { restoreFromSession(s); return }
        setShowLogin(true)
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
      try { window.history.replaceState(null, '', `/${SLUG}/p-new?s=${encodeURIComponent(sessionToken)}`) } catch {}
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

  const reloadCabinet = useCallback(async () => {
    const session = localStorage.getItem(SESSION_KEY)
    if (session) { await restoreFromSession(session); return }
    const refId = localStorage.getItem(REF_KEY)
    const tk = localStorage.getItem(TOKEN_KEY)
    if (refId && tk) await loadData(refId, tk)
  }, [])

  // Family
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
    if (!session) { toast('Только из session-режима', 'warn'); return }
    try {
      const r = await axios.post(`${API}/patient/session/switch`, { phone: memberPhone, short_code: shortCode }, { params: { t: session } })
      const newSession = r.data.session_token
      if (newSession) {
        localStorage.setItem(SESSION_KEY, newSession)
        localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(REF_KEY)
        setFamilyOpen(false)
        await restoreFromSession(newSession)
      }
    } catch (e) { toast(e.response?.data?.detail || 'Не удалось переключиться', 'error') }
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

  const handleLogout = async () => {
    const session = localStorage.getItem(SESSION_KEY)
    if (session) { try { await axios.post(`${API}/patient/session/logout`, { session_token: session }) } catch {} }
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(REF_KEY)
    localStorage.removeItem(SESSION_KEY)
    localStorage.removeItem(SLUG_KEY)
    setData(null); setShowLogin(true); setRoute('home')
  }

  // Применяем accent цвет из tenant_branding
  useEffect(() => {
    if (!data) return
    const primary = data.tenant_branding?.primary_color
    if (primary && /^#[0-9a-fA-F]{6}$/.test(primary)) {
      // Бэкенд может вернуть HEX — конвертируем минимально (CSS-переменную)
      const root = document.querySelector('.cabinet-preview')
      if (root) {
        root.style.setProperty('--accent', primary)
      }
    }
  }, [data])

  // ── States ──
  if (loading) {
    return (
      <div className="cabinet-preview" data-theme={theme}>
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <div className="cp-spinner" />
          <p style={{ color: 'var(--fg-3)', fontSize: 13 }}>Загрузка кабинета...</p>
        </div>
      </div>
    )
  }
  if (showLogin) {
    return (
      <div className="cabinet-preview" data-theme={theme}>
        <LoginScreen onLogin={handleLogin} errorMsg={error} />
      </div>
    )
  }
  if (!data) return null

  if (fullscreenQr) {
    return (
      <div className="cabinet-preview" data-theme={theme}>
        <QrFullscreen qr={fullscreenQr} onClose={() => setFullscreenQr(null)} />
      </div>
    )
  }

  const isApt = data?.type === 'appointment'
  const patient_name  = isApt ? data.patient_name  : (data.patient_name)
  const patient_phone = isApt ? data.patient_phone : (data.patient_phone)
  const initials = getInitials(patient_name || patient_phone || 'П')
  const sessionToken = localStorage.getItem(SESSION_KEY)

  // Badges для sidebar
  const badges = {
    appointments: (data?.appointments?.length || 0) || null,
    chat: null, // TODO: считать непрочитанные из chat-API
  }

  // Mobile bottom-tabbar (≤760px)
  const MOBILE_TABS = [
    { id: 'home', label: 'Главная', ico: '⌂' },
    { id: 'booking', label: 'Запись', ico: '＋' },
    { id: 'doctors', label: 'Врачи', ico: '✦' },
    { id: 'chat', label: 'Чат', ico: '◯' },
    { id: 'profile', label: 'Я', ico: '☉' },
  ]

  return (
    <div className="cabinet-preview" data-theme={theme}>
      <div className="app">
        <Sidebar route={route} setRoute={setRoute} onLogout={handleLogout} badges={badges} />

        <main className="main">
          <div className="topbar">
            {FEATURE_GLOBAL_SEARCH_ENABLED ? (
              <div className="topbar-search">
                <span>⌕</span>
                <input placeholder="Найти врача, услугу, анализ..." />
              </div>
            ) : (
              <div style={{ flex: 1 }} />
            )}
            {sessionToken && (
              <button className="topbar-icon-btn" onClick={() => setFamilyOpen(true)} title="Семья">
                ⚭
                {familyList.length > 0 && <span className="pip" style={{ background: 'var(--good)' }} />}
              </button>
            )}
            {/* Theme switcher (компактно) */}
            <select value={theme} onChange={e => setTheme(e.target.value)}
              className="topbar-icon-btn"
              style={{ width: 'auto', padding: '0 12px', fontSize: 12 }}>
              <option value="teal">teal</option>
              <option value="violet">violet</option>
              <option value="emerald">emerald</option>
              <option value="amber">amber</option>
            </select>
            <div className="topbar-avatar">
              <div className="topbar-avatar-img">{initials}</div>
              <div className="topbar-avatar-name">{(patient_name || patient_phone || 'Я').split(' ')[0]}</div>
            </div>
          </div>

          <div className="content">
            {route === 'home' && (
              <HomePage
                data={data}
                patientName={patient_name}
                patientPhone={patient_phone}
                onGo={setRoute}
                onQr={setFullscreenQr}
                onReschedule={(apt) => setReschedAptId(apt)}
                onCancelled={reloadCabinet}
              />
            )}
            {route === 'booking' && (
              <BookingPage
                patientName={patient_name}
                patientPhone={patient_phone}
                onGo={setRoute}
              />
            )}
            {route === 'appointments' && (
              <AppointmentsPage
                data={data}
                onQr={setFullscreenQr}
                onReschedule={(apt) => setReschedAptId(apt)}
                onCancelled={reloadCabinet}
              />
            )}
            {route === 'history' && <HistoryPage data={data} />}
            {route === 'chat' && (
              <>
                <div className="page-head">
                  <div>
                    <div className="page-title">Чат с клиникой</div>
                    <div className="page-sub">Защищённая переписка по протоколу 152-ФЗ</div>
                  </div>
                </div>
                <ChatTab sessionToken={sessionToken} />
              </>
            )}
            {route === 'profile' && (
              <ProfilePage
                data={data}
                patientName={patient_name}
                patientPhone={patient_phone}
                onOpenFamily={() => setFamilyOpen(true)}
                onPushToggle={handlePushToggle}
                pushEnabled={pushEnabled}
                pushLoading={pushLoading}
              />
            )}
          </div>
        </main>

        {/* Notify-rail на ≥1024px */}
        {FEATURE_NOTIFY_RAIL_ENABLED && (
          <aside className="notify-rail">
            <div className="notify-hd">
              <h3>Лента</h3>
            </div>
            {/* Реальные уведомления — пока заглушка из data */}
            {(data?.appointments || []).slice(0, 1).map(a => {
              const dt = a.appointment_date ? new Date(a.appointment_date + 'T00:00') : null
              return (
                <div key={a.id} className="notif unread">
                  <div className="notif-icon">◔</div>
                  <div className="notif-body">
                    <div className="notif-title">Напоминание о приёме</div>
                    <div className="notif-text">
                      {dt ? `${dt.getDate()} ${MONTHS_R[dt.getMonth()]}` : ''} в {(a.start_time || '').slice(0, 5)} — {a.doctor_name || 'врач'}, {a.clinic_name || ''}.
                    </div>
                    <div className="notif-time">скоро</div>
                  </div>
                </div>
              )
            })}
            {(!data?.appointments || data.appointments.length === 0) && (
              <div className="card" style={{ textAlign: 'center', color: 'var(--fg-3)', fontSize: 13, padding: 18 }}>
                Уведомлений нет
              </div>
            )}
            {/* QR пациента в notify-rail */}
            {(data?.current?.qr_code || data?.qr_code) && (
              <div className="card" style={{ background: 'var(--bg-1)', textAlign: 'center', padding: 18 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>QR для регистратуры</div>
                <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginBottom: 12 }}>Покажите на стойке вместо паспорта</div>
                <button onClick={() => setFullscreenQr(data?.current?.qr_code || data?.qr_code)}
                  className="btn btn-primary btn-sm" style={{ width: '100%' }}>
                  Открыть QR на весь экран
                </button>
              </div>
            )}
          </aside>
        )}
      </div>

      {/* Mobile bottom-tabbar */}
      <div className="mobile-tabbar">
        {MOBILE_TABS.map(t => (
          <button key={t.id} className="mobile-tab" data-active={route === t.id} onClick={() => setRoute(t.id)}>
            <div className="mobile-tab-icon">{t.ico}</div>
            {t.label}
          </button>
        ))}
      </div>

      {/* Modals */}
      {reschedAptId && (
        <RescheduleModal apt={reschedAptId}
          onClose={() => setReschedAptId(null)}
          onDone={() => { setReschedAptId(null); reloadCabinet() }} />
      )}

      {familyOpen && (
        <FamilyModal
          ownerName={patient_name} ownerPhone={patient_phone}
          members={familyList}
          onClose={() => setFamilyOpen(false)}
          onChanged={loadFamily}
          onSwitch={switchProfile} />
      )}

      {/* AI bot — за флагом */}
      {FEATURE_AI_BOT_ENABLED && (
        <button className="bot-fab" title="AI-помощник">✦</button>
      )}
    </div>
  )
}
