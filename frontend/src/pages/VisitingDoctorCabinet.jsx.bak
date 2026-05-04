/**
 * Кабинет приезжего врача (VISITING_DOCTOR)
 * Принять пациента — только через QR-сканирование.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import axios from 'axios'
import { API_BASE, SLUG } from '../config'

const P  = '#0097A7'
const D  = '#004D5F'
const BG = '#F0F5F6'

const NAV = [
  { key: 'queue',   label: 'Очередь',  icon: 'queue'    },
  { key: 'history', label: 'История',  icon: 'history'  },
  { key: 'income',  label: 'Доход',    icon: 'payments' },
]

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })
}

// ─── Push ─────────────────────────────────────────────────────
async function urlBase64ToUint8Array(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return new Uint8Array([...raw].map(c => c.charCodeAt(0)))
}
async function registerPush(token) {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false
    const reg = await navigator.serviceWorker.ready
    const { public_key } = await (await fetch(API_BASE + '/push/vapid-key')).json()
    const sub = (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: await urlBase64ToUint8Array(public_key) })).toJSON()
    await fetch(API_BASE + '/push/subscribe-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth }),
    })
    return true
  } catch { return false }
}

// ─── Результат сканирования ───────────────────────────────────
function DoneModal({ result, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 32, padding: '36px 28px', textAlign: 'center', maxWidth: 320, width: '100%', boxShadow: '0 24px 80px rgba(0,0,0,0.3)' }}>
        <div style={{ width: 80, height: 80, borderRadius: '50%', background: '#e8f5e9', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: 44, color: '#2e7d32', fontVariationSettings: "'FILL' 1" }}>check_circle</span>
        </div>
        <div style={{ fontWeight: 800, fontSize: 22, color: D, marginBottom: 8 }}>Приём принят!</div>
        {result.doctor_share != null
          ? <div style={{ fontSize: 42, fontWeight: 900, color: '#2e7d32', margin: '16px 0 28px', letterSpacing: -1 }}>
              +{Number(result.doctor_share).toLocaleString('ru')} ₽
            </div>
          : <div style={{ fontSize: 15, color: '#90a4ae', margin: '16px 0 28px' }}>Приём записан в историю</div>
        }
        <button onClick={onClose}
          style={{ width: '100%', background: P, color: '#fff', border: 'none', borderRadius: 16, padding: '15px 0', fontWeight: 800, fontSize: 17, cursor: 'pointer', letterSpacing: 0.3 }}>
          Готово
        </button>
      </div>
    </div>
  )
}

// ─── QR-сканер ────────────────────────────────────────────────
function QRScanner({ onDetect, onClose }) {
  const videoRef   = useRef(null)
  const canvasRef  = useRef(null)
  const rafRef     = useRef(null)
  const streamRef  = useRef(null)
  const detectedRef = useRef(false)
  const [camErr, setCamErr] = useState('')
  const [manual, setManual] = useState('')
  const [scanning, setScanning] = useState(false)

  useEffect(() => {
    let jsQR = null
    ;(async () => {
      try {
        // Загружаем jsQR динамически
        const mod = await import('jsqr')
        jsQR = mod.default || mod
      } catch { jsQR = null }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } })
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }

        // BarcodeDetector создаётся один раз
        const barcodeDetector = ('BarcodeDetector' in window)
          ? new window.BarcodeDetector({ formats: ['qr_code'] })
          : null

        const tick = () => {
          if (detectedRef.current) return
          const video = videoRef.current
          const canvas = canvasRef.current
          if (!video || !canvas || video.readyState < 2) { rafRef.current = requestAnimationFrame(tick); return }

          if (barcodeDetector) {
            // BarcodeDetector: Chrome/Edge/Android
            barcodeDetector.detect(video)
              .then(codes => {
                if (codes.length > 0 && !detectedRef.current) {
                  detectedRef.current = true
                  setScanning(true)
                  setTimeout(() => onDetect(codes[0].rawValue), 300)
                } else {
                  rafRef.current = requestAnimationFrame(tick)
                }
              })
              .catch(() => { rafRef.current = requestAnimationFrame(tick) })
            return
          }

          // jsQR fallback: Safari/Firefox
          if (jsQR) {
            const ctx = canvas.getContext('2d')
            canvas.width  = video.videoWidth  || 640
            canvas.height = video.videoHeight || 480
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
            try {
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
              const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })
              if (code && code.data && !detectedRef.current) {
                detectedRef.current = true
                setScanning(true)
                setTimeout(() => onDetect(code.data), 300)
                return
              }
            } catch {}
          } else {
            // jsQR не загружен и BarcodeDetector недоступен
            setCamErr('Сканер недоступен. Введите код вручную.')
            return
          }
          rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)
      } catch { setCamErr('Нет доступа к камере. Введите ID вручную.') }
    })()

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop())
    }
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 150, display: 'flex', flexDirection: 'column' }}>
      {/* Заголовок */}
      <div style={{ background: D, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <button onClick={onClose}
          style={{ background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: 10, padding: '8px 14px', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
          ← Назад
        </button>
        <div style={{ color: '#fff', fontWeight: 700, fontSize: 16, flex: 1 }}>Сканировать QR пациента</div>
        {scanning && <div style={{ fontSize: 13, color: '#80cfd6', fontWeight: 600 }}>✓ QR найден</div>}
      </div>

      {/* Камера */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted playsInline />
        <canvas ref={canvasRef} style={{ display: 'none' }} />
        {/* Оверлей */}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'relative', width: 240, height: 240 }}>
            <div style={{ position: 'absolute', inset: 0, boxShadow: `0 0 0 9999px rgba(0,0,0,${scanning ? 0.2 : 0.5})`, borderRadius: 20, transition: 'box-shadow 0.3s' }} />
            {[[{top:0,left:0},{borderRight:'none',borderBottom:'none',borderRadius:'8px 0 0 0'}],
              [{top:0,right:0},{borderLeft:'none',borderBottom:'none',borderRadius:'0 8px 0 0'}],
              [{bottom:0,left:0},{borderRight:'none',borderTop:'none',borderRadius:'0 0 0 8px'}],
              [{bottom:0,right:0},{borderLeft:'none',borderTop:'none',borderRadius:'0 0 8px 0'}],
            ].map(([pos, extra], i) => (
              <div key={i} style={{ position: 'absolute', width: 36, height: 36, border: `4px solid ${scanning ? '#4caf50' : P}`, ...pos, ...extra, transition: 'border-color 0.3s' }} />
            ))}
          </div>
        </div>
        {!scanning && !camErr && (
          <div style={{ position: 'absolute', bottom: 100, left: 0, right: 0, textAlign: 'center' }}>
            <span style={{ background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: 13, padding: '6px 16px', borderRadius: 20 }}>Наведите камеру на QR-код пациента</span>
          </div>
        )}
        {camErr && (
          <div style={{ position: 'absolute', bottom: 90, left: 16, right: 16, background: 'rgba(0,0,0,0.7)', borderRadius: 14, padding: '12px 16px', textAlign: 'center', color: '#ff8a80', fontSize: 13 }}>{camErr}</div>
        )}
      </div>

      {/* Ручной ввод */}
      <div style={{ background: '#111', padding: '16px 16px', flexShrink: 0, paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
        <div style={{ fontSize: 11, color: '#607d8b', marginBottom: 8, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>Или введите ID записи</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={manual} onChange={e => setManual(e.target.value)}
            placeholder="ID записи..."
            style={{ flex: 1, background: '#1e1e1e', border: '1px solid #333', borderRadius: 12, padding: '12px 14px', color: '#fff', fontSize: 14, outline: 'none' }}
            onKeyDown={e => e.key === 'Enter' && manual.trim() && onDetect(manual.trim())} />
          <button onClick={() => manual.trim() && onDetect(manual.trim())}
            style={{ background: P, border: 'none', borderRadius: 12, padding: '0 20px', color: '#fff', fontWeight: 800, cursor: 'pointer', fontSize: 16 }}>
            ОК
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Карточка в очереди ───────────────────────────────────────
function QueueCard({ apt }) {
  return (
    <div style={{ background: '#fff', borderRadius: 20, padding: '18px 16px', border: '1px solid #e8f0f2', boxShadow: '0 2px 12px rgba(0,77,95,0.07)' }}>
      {/* Верхняя строка: пациент + время */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: apt.price > 0 ? 14 : 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 16, color: D, marginBottom: 3 }}>{apt.patient_name || 'Пациент'}</div>
          <div style={{ fontSize: 13, color: '#607d8b' }}>{apt.patient_phone}</div>
        </div>
        <div style={{ background: 'linear-gradient(135deg, #e0f7fa 0%, #b2ebf2 100%)', borderRadius: 14, padding: '8px 14px', textAlign: 'center', minWidth: 68, flexShrink: 0 }}>
          <div style={{ fontWeight: 900, fontSize: 22, color: D, lineHeight: 1 }}>{apt.start_time?.slice(0, 5)}</div>
          <div style={{ fontSize: 11, color: '#607d8b', marginTop: 2 }}>—{apt.end_time?.slice(0, 5)}</div>
        </div>
      </div>

      {/* Заработок врача */}
      {apt.doctor_share > 0 && (
        <div style={{ background: '#e8f5e9', borderRadius: 12, padding: '8px 14px', marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#2e7d32', fontWeight: 600 }}>Ваш заработок</span>
          <span style={{ fontSize: 17, fontWeight: 900, color: '#2e7d32' }}>+{Number(apt.doctor_share).toLocaleString('ru')} ₽</span>
        </div>
      )}

      {/* Подсказка */}
      <div style={{ background: '#f0f9fa', borderRadius: 12, padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 18, color: P, fontVariationSettings: "'FILL' 1" }}>qr_code_scanner</span>
        <span style={{ fontSize: 12, color: '#607d8b', fontWeight: 500 }}>Нажмите кнопку QR чтобы отсканировать пациента</span>
      </div>
    </div>
  )
}

// ─── Главный компонент ────────────────────────────────────────
export default function VisitingDoctorCabinet({ adminToken, user, onLogout }) {
  const hdr = useCallback(() => ({ headers: { Authorization: `Bearer ${adminToken}` } }), [adminToken])

  const [tab,    setTab]    = useState('queue')
  const [queue,  setQueue]  = useState([])
  const [history, setHistory] = useState([])
  const [income,  setIncome]  = useState({ total: 0, entries: [] })
  const [loading, setLoading] = useState(false)
  const [accepting, setAccepting] = useState(null)
  const [accepted,  setAccepted]  = useState(null)
  const [scanner,   setScanner]   = useState(false)
  const [manualCode, setManualCode] = useState('')
  const [manualErr,  setManualErr]  = useState('')
  const [pushOn,    setPushOn]    = useState(false)
  const [pushLoading, setPushLoading] = useState(false)
  const [completedToday, setCompletedToday] = useState(0)

  // ── Загрузка ──
  const loadQueue = async () => {
    setLoading(true)
    try {
      const [qRes, hRes] = await Promise.all([
        axios.get(API_BASE + '/visiting/my-queue', hdr()),
        axios.get(API_BASE + '/visiting/my-visits', hdr()),
      ])
      setQueue(Array.isArray(qRes.data) ? qRes.data : [])
      const today = new Date().toISOString().slice(0, 10)
      setCompletedToday(Array.isArray(hRes.data) ? hRes.data.filter(v => v.appointment_date === today && v.status === 'completed').length : 0)
    } catch {}
    setLoading(false)
  }
  const loadHistory = async () => {
    try {
      const r = await axios.get(API_BASE + '/visiting/my-visits', hdr())
      setHistory(Array.isArray(r.data) ? r.data.filter(v => v.status === 'completed') : [])
    } catch {}
  }
  const loadIncome = async () => {
    try {
      const r = await axios.get(API_BASE + '/visiting/my-income', hdr())
      setIncome({ total: r.data.total || 0, entries: Array.isArray(r.data.entries) ? r.data.entries : [] })
    } catch {}
  }
  useEffect(() => {
    if (tab === 'queue')   loadQueue()
    if (tab === 'history') loadHistory()
    if (tab === 'income')  loadIncome()
  }, [tab])

  // ── Push ──
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/' + SLUG + '/sw.js', { scope: '/' + SLUG + '/' }).catch(() => {})
    navigator.serviceWorker.ready.then(async reg => {
      const sub = await reg.pushManager.getSubscription()
      if (sub) setPushOn(true)
    }).catch(() => {})
  }, [])

  const enablePush = async () => {
    setPushLoading(true)
    try {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') { alert('Разрешение на уведомления не выдано'); return }
      const ok = await registerPush(adminToken)
      if (ok) {
        setPushOn(true)
        new Notification('КлиникСеть', { body: 'Уведомления включены!', icon: '/' + SLUG + '/icon-192.png' })
      }
    } catch {}
    setPushLoading(false)
  }

  // ── Принять через QR ──
  const acceptAppointment = async (apt) => {
    setAccepting(apt.id)
    try {
      const r = await axios.post(API_BASE + '/visiting/admin/complete-visit', { appointment_id: apt.id }, hdr())
      setAccepted(r.data)
      loadQueue()
    } catch (e) {
      alert('Ошибка: ' + (e.response?.data?.detail || e.message))
    }
    setAccepting(null)
  }

  const handleQRScan = async (value) => {
    setScanner(false)
    const v = value.trim()

    // Извлечь apt_id из URL /p/{uuid}?t=... или /p/apt/{uuid}
    let extractedId = null
    const urlMatch = v.match(/\/p\/(?:apt\/)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)
    if (urlMatch) extractedId = urlMatch[1]

    const aptId = extractedId || (v.startsWith('APT:') ? v.slice(4) : null)

    // Сначала ищем в очереди
    let found = null
    if (aptId) {
      found = queue.find(a => a.id === aptId)
    } else {
      found = queue.find(a => a.id === v || String(a.short_code) === v || a.patient_phone === v)
    }

    if (found) {
      await acceptAppointment(found)
      return
    }

    // Отправляем на сервер напрямую
    setAccepting('qr_scan')
    try {
      let body
      if (aptId) body = { qr_value: 'APT:' + aptId }
      else if (/^\d{4}$/.test(v)) body = { short_code: parseInt(v) }
      else body = { qr_value: v }
      const r = await axios.post(API_BASE + '/visiting/admin/complete-visit', body, hdr())
      setAccepted(r.data)
      loadQueue()
    } catch (e) {
      alert('Запись не найдена: ' + (e.response?.data?.detail || v))
    }
    setAccepting(null)
  }

  // ── Шапка текущей вкладки ──
  const tabLabel = NAV.find(n => n.key === tab)?.label

  return (
    <div style={{ minHeight: '100vh', background: BG, display: 'flex', flexDirection: 'column', fontFamily: "'Inter', sans-serif" }}>
      {/* Модалки */}
      {accepted && <DoneModal result={accepted} onClose={() => setAccepted(null)} />}
      {scanner   && <QRScanner onDetect={handleQRScan} onClose={() => setScanner(false)} />}

      {/* ── ЗАГОЛОВОК ── */}
      <div style={{ background: D, padding: '0 16px', height: 60, display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', top: 0, zIndex: 20, boxShadow: '0 2px 12px rgba(0,0,0,0.15)' }}>
        {/* Аватар */}
        <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(0,151,167,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <span className="material-symbols-outlined" style={{ color: '#fff', fontSize: 20, fontVariationSettings: "'FILL' 1" }}>medical_services</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.full_name}</div>
          <div style={{ fontSize: 11, color: '#80cfd6' }}>Приезжий врач</div>
        </div>
        {/* Push */}
        {'Notification' in window && !pushOn && (
          <button onClick={enablePush} disabled={pushLoading}
            style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 10, padding: '7px 10px', color: '#80cfd6', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>notifications</span>
            {pushLoading ? '...' : 'Уведом.'}
          </button>
        )}
        {pushOn && (
          <span className="material-symbols-outlined" style={{ color: '#80cfd6', fontSize: 18, fontVariationSettings: "'FILL' 1" }}>notifications_active</span>
        )}
        <button onClick={onLogout} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
          <span className="material-symbols-outlined" style={{ color: 'rgba(255,255,255,0.5)', fontSize: 20 }}>logout</span>
        </button>
      </div>

      {/* ── КОНТЕНТ ── */}
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 80 }}>

        {/* ─ ОЧЕРЕДЬ ─ */}
        {tab === 'queue' && (
          <div style={{ maxWidth: 520, margin: '0 auto', padding: '16px 16px 0' }}>

            {/* Статистика */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 16 }}>
              {/* Ожидает */}
              <div style={{ background: '#fff', borderRadius: 18, padding: '14px 10px', border: '1px solid #e0eaec', textAlign: 'center', boxShadow: '0 2px 8px rgba(0,77,95,0.05)' }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: '#e0f7fa', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 8px' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 20, color: P, fontVariationSettings: "'FILL' 1" }}>schedule</span>
                </div>
                <div style={{ fontSize: 28, fontWeight: 900, color: P, lineHeight: 1, marginBottom: 4 }}>{loading ? '—' : queue.length}</div>
                <div style={{ fontSize: 10, color: '#90a4ae', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Ждут</div>
              </div>
              {/* Принято */}
              <div style={{ background: '#fff', borderRadius: 18, padding: '14px 10px', border: '1px solid #e0eaec', textAlign: 'center', boxShadow: '0 2px 8px rgba(0,77,95,0.05)' }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: '#e8f5e9', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 8px' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#2e7d32', fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                </div>
                <div style={{ fontSize: 28, fontWeight: 900, color: '#2e7d32', lineHeight: 1, marginBottom: 4 }}>{completedToday}</div>
                <div style={{ fontSize: 10, color: '#90a4ae', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Сегодня</div>
              </div>
              {/* Дата */}
              <div style={{ background: `linear-gradient(135deg, ${D} 0%, #006070 100%)`, borderRadius: 18, padding: '14px 10px', textAlign: 'center', boxShadow: '0 4px 16px rgba(0,77,95,0.2)' }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 8px' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#fff', fontVariationSettings: "'FILL' 1" }}>calendar_today</span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#fff', lineHeight: 1.2, marginBottom: 2 }}>
                  {new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                </div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {new Date().toLocaleDateString('ru-RU', { weekday: 'short' })}
                </div>
              </div>
            </div>

            {/* Ввод кода вручную */}
            <div style={{ background:'#fff', borderRadius:16, padding:'12px 14px', marginBottom:16, border:'1px solid #e0eaec', display:'flex', gap:8, alignItems:'center' }}>
              <span className="material-symbols-outlined" style={{ fontSize:20, color:'#90a4ae' }}>pin</span>
              <input
                value={manualCode}
                onChange={e => { setManualCode(e.target.value.replace(/\D/,'').slice(0,4)); setManualErr('') }}
                placeholder="Код пациента (4 цифры)"
                maxLength={4}
                inputMode="numeric"
                style={{ flex:1, border:'none', outline:'none', fontSize:18, fontWeight:700, letterSpacing:4, color: '#004D5F', background:'transparent' }}
                onKeyDown={async e => {
                  if (e.key === 'Enter' && manualCode.length === 4) {
                    await handleQRScan(manualCode)
                    setManualCode('')
                  }
                }}
              />
              {manualErr && <span style={{ fontSize:11, color:'#c62828' }}>{manualErr}</span>}
              {manualCode.length === 4 && (
                <button onClick={async () => { await handleQRScan(manualCode); setManualCode('') }}
                  style={{ background:'#0097A7', color:'#fff', border:'none', borderRadius:10, padding:'7px 14px', fontWeight:700, cursor:'pointer', fontSize:13 }}>
                  ОК
                </button>
              )}
            </div>

            {loading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
                <div style={{ width: 40, height: 40, border: `3px solid ${P}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
                <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
              </div>
            ) : queue.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#e0f7fa', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 36, color: P }}>event_available</span>
                </div>
                <div style={{ fontWeight: 800, fontSize: 18, color: D, marginBottom: 6 }}>Очередь пуста</div>
                <div style={{ fontSize: 14, color: '#90a4ae' }}>Когда администратор добавит запись — она появится здесь</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {queue.map(apt => <QueueCard key={apt.id} apt={apt} />)}
              </div>
            )}
          </div>
        )}

        {/* ─ ИСТОРИЯ ─ */}
        {tab === 'history' && (
          <div style={{ maxWidth: 520, margin: '0 auto', padding: '16px' }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: D, marginBottom: 14 }}>Завершённые приёмы</div>
            {history.length === 0
              ? (
                <div style={{ textAlign: 'center', padding: '60px 0', color: '#90a4ae' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 48, display: 'block', marginBottom: 10 }}>history</span>
                  Завершённых приёмов нет
                </div>
              )
              : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {history.map(v => (
                    <div key={v.id} style={{ background: '#fff', borderRadius: 16, padding: '14px 16px', border: '1px solid #e0eaec', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: D }}>{v.patient_name || 'Пациент'}</div>
                        <div style={{ fontSize: 12, color: '#90a4ae', marginTop: 2 }}>{v.patient_phone} · {fmtDate(v.appointment_date)}</div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 12 }}>
                        <div style={{ fontSize: 11, color: '#2e7d32', fontWeight: 700 }}>✓ Принят</div>
                      </div>
                    </div>
                  ))}
                </div>
              )
            }
          </div>
        )}

        {/* ─ ДОХОД ─ */}
        {tab === 'income' && (
          <div style={{ maxWidth: 520, margin: '0 auto', padding: '16px' }}>
            {/* Итого */}
            <div style={{ background: `linear-gradient(135deg, ${D} 0%, #006070 100%)`, borderRadius: 24, padding: '24px', marginBottom: 16, textAlign: 'center', boxShadow: '0 8px 32px rgba(0,77,95,0.25)' }}>
              <div style={{ fontSize: 11, color: '#80cfd6', textTransform: 'uppercase', fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>Всего начислено</div>
              <div style={{ fontSize: 44, fontWeight: 900, color: '#fff', letterSpacing: -2 }}>{Math.round(income.total).toLocaleString('ru')} ₽</div>
            </div>
            {income.entries.length === 0
              ? <div style={{ textAlign: 'center', padding: '32px 0', color: '#90a4ae', fontSize: 14 }}>Начислений пока нет</div>
              : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {income.entries.map(e => (
                    <div key={e.id} style={{ background: '#fff', borderRadius: 14, padding: '12px 16px', border: '1px solid #e0eaec', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: 13, color: D, fontWeight: 600 }}>{e.description || e.operation_type}</div>
                        <div style={{ fontSize: 11, color: '#90a4ae', marginTop: 2 }}>{fmtDate(e.created_at)}</div>
                      </div>
                      <div style={{ fontWeight: 800, fontSize: 16, color: '#2e7d32' }}>+{Number(e.amount).toLocaleString('ru')} ₽</div>
                    </div>
                  ))}
                </div>
              )
            }
          </div>
        )}

      </div>

      {/* ── ПЛАВАЮЩАЯ КНОПКА QR (только на вкладке очереди) ── */}
      {tab === 'queue' && (
        <button
          onClick={() => setScanner(true)}
          disabled={!!accepting}
          style={{
            position: 'fixed',
            bottom: 'calc(72px + env(safe-area-inset-bottom, 0px) + 16px)',
            right: 20,
            width: 64,
            height: 64,
            borderRadius: '50%',
            background: accepting ? '#b2dfdb' : `linear-gradient(135deg, ${P} 0%, #006070 100%)`,
            color: '#fff',
            border: 'none',
            cursor: accepting ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 6px 24px rgba(0,151,167,0.45)',
            zIndex: 30,
            transition: 'all 0.2s',
          }}
        >
          {accepting
            ? <div style={{ width: 24, height: 24, border: '3px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
            : <span className="material-symbols-outlined" style={{ fontSize: 28, fontVariationSettings: "'FILL' 1" }}>qr_code_scanner</span>
          }
        </button>
      )}

      {/* ── НИЖНЯЯ НАВИГАЦИЯ ── */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: '#fff',
        borderTop: '1px solid #e8f0f2',
        display: 'flex',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        zIndex: 25,
        boxShadow: '0 -4px 20px rgba(0,0,0,0.06)',
      }}>
        {NAV.map(n => (
          <button key={n.key} onClick={() => setTab(n.key)}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '10px 0', background: 'none', border: 'none', cursor: 'pointer', color: tab === n.key ? P : '#90a4ae', transition: 'color 0.15s' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 24, fontVariationSettings: tab === n.key ? "'FILL' 1" : "'FILL' 0" }}>{n.icon}</span>
            <span style={{ fontSize: 10, fontWeight: tab === n.key ? 700 : 400, letterSpacing: 0.2 }}>{n.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
