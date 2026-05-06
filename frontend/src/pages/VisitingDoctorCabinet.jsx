/**
 * Кабинет приезжего врача (VISITING_DOCTOR)
 * Принять пациента — через QR-сканирование или ввод кода.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import axios from 'axios'
import { API_BASE, SLUG } from '../config'

const P  = '#0097A7'
const D  = '#004D5F'

const NAV = [
  { key:'queue',   label:'Очередь',  icon:'queue'    },
  { key:'history', label:'История',  icon:'history'  },
  { key:'income',  label:'Доход',    icon:'payments' },
]

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('ru-RU', { day:'2-digit', month:'long', year:'numeric' })
}

// ─── Push ──────────────────────────────────────────────────────
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
    const sub = (await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey: await urlBase64ToUint8Array(public_key) })).toJSON()
    await fetch(API_BASE + '/push/subscribe-user', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` },
      body: JSON.stringify({ endpoint:sub.endpoint, p256dh:sub.keys.p256dh, auth:sub.keys.auth }),
    })
    return true
  } catch { return false }
}

// ─── Done Modal ────────────────────────────────────────────────
function DoneModal({ result, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-5 bg-black/70">
      <div className="bg-white rounded-3xl p-8 text-center max-w-xs w-full" style={{ boxShadow:'0 24px 80px rgba(0,0,0,0.3)' }}>
        <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
          <span className="material-symbols-outlined text-green-700 text-5xl" style={{ fontVariationSettings:"'FILL' 1" }}>check_circle</span>
        </div>
        <p className="font-black text-2xl mb-2" style={{ color:D }}>Приём принят!</p>
        {result.doctor_share != null
          ? <p className="text-5xl font-black text-green-600 my-4" style={{ letterSpacing:-1 }}>+{Number(result.doctor_share).toLocaleString('ru')} ₽</p>
          : <p className="text-gray-400 text-sm my-4">Приём записан в историю</p>
        }
        <button onClick={onClose}
          className="w-full py-4 rounded-2xl text-white font-black text-lg" style={{ background:P }}>
          Готово
        </button>
      </div>
    </div>
  )
}

// ─── QR Scanner ────────────────────────────────────────────────
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
      try { const mod = await import('jsqr'); jsQR = mod.default || mod } catch { jsQR = null }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:'environment', width:{ ideal:1280 }, height:{ ideal:720 } } })
        streamRef.current = stream
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play() }

        const barcodeDetector = ('BarcodeDetector' in window) ? new window.BarcodeDetector({ formats:['qr_code'] }) : null

        const tick = () => {
          if (detectedRef.current) return
          const video = videoRef.current; const canvas = canvasRef.current
          if (!video || !canvas || video.readyState < 2) { rafRef.current = requestAnimationFrame(tick); return }

          if (barcodeDetector) {
            barcodeDetector.detect(video)
              .then(codes => {
                if (codes.length > 0 && !detectedRef.current) { detectedRef.current = true; setScanning(true); setTimeout(() => onDetect(codes[0].rawValue), 300) }
                else { rafRef.current = requestAnimationFrame(tick) }
              })
              .catch(() => { rafRef.current = requestAnimationFrame(tick) })
            return
          }

          if (jsQR) {
            const ctx = canvas.getContext('2d')
            canvas.width = video.videoWidth || 640; canvas.height = video.videoHeight || 480
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
            try {
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
              const code = jsQR(img.data, img.width, img.height, { inversionAttempts:'attemptBoth' })
              if (code && code.data && !detectedRef.current) { detectedRef.current = true; setScanning(true); setTimeout(() => onDetect(code.data), 300); return }
            } catch {}
          } else {
            setCamErr('Сканер недоступен. Введите код вручную.')
            return
          }
          rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)
      } catch { setCamErr('Нет доступа к камере. Введите код вручную.') }
    })()
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop())
    }
  }, [])

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-4 flex-shrink-0" style={{ background:D }}>
        <button onClick={onClose}
          className="px-4 py-2 rounded-xl font-semibold text-sm text-white" style={{ background:'rgba(255,255,255,0.12)' }}>
          ← Назад
        </button>
        <div className="text-white font-bold flex-1">Сканировать QR пациента</div>
        {scanning && <div className="text-sm font-bold" style={{ color:'#80cfd6' }}>✓ QR найден</div>}
      </div>

      {/* Camera */}
      <div className="flex-1 relative overflow-hidden">
        <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
        <canvas ref={canvasRef} className="hidden" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative w-60 h-60">
            <div className="absolute inset-0 rounded-2xl" style={{ boxShadow:`0 0 0 9999px rgba(0,0,0,${scanning?0.2:0.5})`, transition:'box-shadow 0.3s' }} />
            {[[{top:0,left:0},{borderRight:'none',borderBottom:'none',borderTopLeftRadius:8}],
              [{top:0,right:0},{borderLeft:'none',borderBottom:'none',borderTopRightRadius:8}],
              [{bottom:0,left:0},{borderRight:'none',borderTop:'none',borderBottomLeftRadius:8}],
              [{bottom:0,right:0},{borderLeft:'none',borderTop:'none',borderBottomRightRadius:8}],
            ].map(([pos, extra], i) => (
              <div key={i} className="absolute w-9 h-9" style={{ border:`4px solid ${scanning?'#4caf50':P}`, ...pos, ...extra, transition:'border-color 0.3s' }} />
            ))}
          </div>
        </div>
        {!scanning && !camErr && (
          <div className="absolute bottom-24 left-0 right-0 text-center">
            <span className="bg-black/50 text-white text-xs px-4 py-2 rounded-full">Наведите камеру на QR-код пациента</span>
          </div>
        )}
        {camErr && (
          <div className="absolute bottom-24 left-4 right-4 bg-black/70 rounded-2xl p-3 text-center text-red-300 text-sm">{camErr}</div>
        )}
      </div>

      {/* Manual input */}
      <div className="bg-[#111] px-4 py-4 flex-shrink-0" style={{ paddingBottom:'max(1rem, env(safe-area-inset-bottom))' }}>
        <p className="text-xs text-gray-500 uppercase font-semibold tracking-wider mb-2">Или введите код вручную</p>
        <div className="flex gap-2">
          <input value={manual} onChange={e => setManual(e.target.value.replace(/\D/,'').slice(0,4))}
            placeholder="Код (4 цифры)" maxLength={4} inputMode="numeric"
            className="flex-1 bg-[#1e1e1e] border border-gray-700 rounded-xl px-4 py-3 text-white text-xl font-bold tracking-widest outline-none"
            style={{ letterSpacing:6 }}
            onKeyDown={e => e.key === 'Enter' && manual.trim() && onDetect(manual.trim())} />
          {manual.length === 4 && (
            <button onClick={() => onDetect(manual.trim())}
              className="px-5 rounded-xl text-white font-black text-lg" style={{ background:P }}>ОК</button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Queue Card ────────────────────────────────────────────────
function QueueCard({ apt }) {
  return (
    <div className="bg-white rounded-2xl p-4" style={{ boxShadow:'0 2px 12px rgba(0,77,95,0.08)', border:'1px solid #e8f0f2' }}>
      <div className="flex items-start gap-3">
        <div className="rounded-2xl p-3 text-center flex-shrink-0" style={{ background:'linear-gradient(135deg,#e0f7fa,#b2ebf2)' }}>
          <p className="font-black text-2xl leading-none" style={{ color:D }}>{apt.start_time?.slice(0,5)}</p>
          <p className="text-xs font-semibold mt-0.5" style={{ color:'#607d8b' }}>—{apt.end_time?.slice(0,5)}</p>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-base" style={{ color:D }}>{apt.patient_name || 'Пациент'}</p>
          <p className="text-sm text-gray-500">{apt.patient_phone}</p>
          {apt.doctor_share > 0 && (
            <div className="mt-2 bg-green-50 rounded-xl px-3 py-1.5 inline-flex items-center gap-1.5">
              <span className="material-symbols-outlined text-green-700 text-base" style={{ fontVariationSettings:"'FILL' 1" }}>payments</span>
              <span className="font-black text-green-700 text-sm">+{Number(apt.doctor_share).toLocaleString('ru')} ₽</span>
            </div>
          )}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 bg-teal-50 rounded-xl px-3 py-2">
        <span className="material-symbols-outlined text-teal-600 text-lg" style={{ fontVariationSettings:"'FILL' 1" }}>qr_code_scanner</span>
        <span className="text-xs text-teal-700 font-medium">Нажмите QR-кнопку внизу чтобы принять пациента</span>
      </div>
    </div>
  )
}

// ─── Main ──────────────────────────────────────────────────────
export default function VisitingDoctorCabinet({ adminToken, user, onLogout }) {
  const hdr = useCallback(() => ({ headers:{ Authorization:`Bearer ${adminToken}` } }), [adminToken])

  const [tab,      setTab]      = useState('queue')
  const [queue,    setQueue]    = useState([])
  const [history,  setHistory]  = useState([])
  const [income,   setIncome]   = useState({ total:0, entries:[] })
  const [loading,  setLoading]  = useState(false)
  const [accepting,setAccepting]= useState(null)
  const [accepted, setAccepted] = useState(null)
  const [scanner,  setScanner]  = useState(false)
  const [manualCode, setManualCode] = useState('')
  const [pushOn,   setPushOn]   = useState(false)
  const [pushLoading, setPushLoading] = useState(false)
  const [completedToday, setCompletedToday] = useState(0)

  const loadQueue = async () => {
    setLoading(true)
    try {
      const [qRes, hRes] = await Promise.all([
        axios.get(API_BASE + '/visiting/my-queue', hdr()),
        axios.get(API_BASE + '/visiting/my-visits', hdr()),
      ])
      setQueue(Array.isArray(qRes.data) ? qRes.data : [])
      const today = new Date().toISOString().slice(0,10)
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
      setIncome({ total:r.data.total || 0, entries:Array.isArray(r.data.entries) ? r.data.entries : [] })
    } catch {}
  }
  useEffect(() => {
    if (tab === 'queue')   loadQueue()
    if (tab === 'history') loadHistory()
    if (tab === 'income')  loadIncome()
  }, [tab])

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/' + SLUG + '/sw.js', { scope:'/' + SLUG + '/' }).catch(() => {})
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
      if (ok) { setPushOn(true); new Notification('КлиникСеть', { body:'Уведомления включены!' }) }
    } catch {}
    setPushLoading(false)
  }

  const acceptAppointment = async (apt) => {
    setAccepting(apt.id)
    try {
      const r = await axios.post(API_BASE + '/visiting/admin/complete-visit', { appointment_id:apt.id }, hdr())
      setAccepted(r.data); loadQueue()
    } catch(e) { alert('Ошибка: ' + (e.response?.data?.detail || e.message)) }
    setAccepting(null)
  }

  const handleQRScan = async (value) => {
    setScanner(false)
    const v = value.trim()
    let extractedId = null
    const urlMatch = v.match(/\/p\/(?:apt\/)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)
    if (urlMatch) extractedId = urlMatch[1]
    const aptId = extractedId || (v.startsWith('APT:') ? v.slice(4) : null)

    let found = aptId ? queue.find(a => a.id === aptId) : queue.find(a => a.id === v || String(a.short_code) === v || a.patient_phone === v)
    if (found) { await acceptAppointment(found); return }

    setAccepting('qr_scan')
    try {
      let body
      if (aptId) body = { qr_value:'APT:' + aptId }
      else if (/^\d{4}$/.test(v)) body = { short_code:parseInt(v) }
      else body = { qr_value:v }
      const r = await axios.post(API_BASE + '/visiting/admin/complete-visit', body, hdr())
      setAccepted(r.data); loadQueue()
    } catch(e) { alert('Запись не найдена: ' + (e.response?.data?.detail || v)) }
    setAccepting(null)
  }

  return (
    <div className="min-h-screen bg-[#f7f9fb]" style={{ fontFamily:"'Inter',sans-serif" }}>
      {accepted && <DoneModal result={accepted} onClose={() => setAccepted(null)} />}
      {scanner   && <QRScanner onDetect={handleQRScan} onClose={() => setScanner(false)} />}

      {/* Gradient Header */}
      <div className="relative overflow-hidden px-4 pt-12 pb-5"
        style={{ background:`linear-gradient(135deg,${D} 0%,#006070 100%)` }}>
        <div className="absolute -top-6 -right-6 w-32 h-32 rounded-full bg-white/5 pointer-events-none" />
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{ background:'rgba(255,255,255,0.18)', backdropFilter:'blur(10px)' }}>
            <span className="material-symbols-outlined text-white text-xl" style={{ fontVariationSettings:"'FILL' 1" }}>medical_services</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-sm truncate">{user?.full_name}</p>
            <p className="text-white/70 text-xs">Приезжий врач</p>
          </div>
          <div className="flex items-center gap-2">
            {'Notification' in window && !pushOn && (
              <button onClick={enablePush} disabled={pushLoading}
                className="w-11 h-11 flex items-center justify-center rounded-xl flex-shrink-0" style={{ background:'rgba(255,255,255,0.12)' }}>
                <span className="material-symbols-outlined text-white/80 text-base">notifications</span>
              </button>
            )}
            {pushOn && <span className="material-symbols-outlined text-white/60 text-base" style={{ fontVariationSettings:"'FILL' 1" }}>notifications_active</span>}
            <button onClick={onLogout} className="w-11 h-11 flex items-center justify-center rounded-xl flex-shrink-0" style={{ background:'rgba(255,255,255,0.12)' }}>
              <span className="material-symbols-outlined text-white/80 text-base">logout</span>
            </button>
          </div>
        </div>
        {/* Quick stats */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-xl p-2.5" style={{ background:'rgba(255,255,255,0.12)' }}>
            <p className="text-white font-black text-xl leading-none">{loading ? '—' : queue.length}</p>
            <p className="text-white/60 text-xs mt-0.5">Ожидают приёма</p>
          </div>
          <div className="rounded-xl p-2.5" style={{ background:'rgba(255,255,255,0.12)' }}>
            <p className="text-green-300 font-black text-xl leading-none">{completedToday}</p>
            <p className="text-white/60 text-xs mt-0.5">Принято сегодня</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-4 pb-32">

        {/* Queue */}
        {tab === 'queue' && (
          <div className="space-y-4">
            {/* Manual code input */}
            <div className="bg-white rounded-2xl p-4 flex items-center gap-3" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
              <span className="material-symbols-outlined text-gray-400 text-xl">pin</span>
              <input
                value={manualCode}
                onChange={e => setManualCode(e.target.value.replace(/\D/,'').slice(0,4))}
                placeholder="Код пациента (4 цифры)"
                maxLength={4} inputMode="numeric"
                className="flex-1 outline-none text-2xl font-black text-gray-800 bg-transparent"
                style={{ letterSpacing:8 }}
                onKeyDown={async e => { if (e.key === 'Enter' && manualCode.length === 4) { await handleQRScan(manualCode); setManualCode('') } }}
              />
              {manualCode.length === 4 && (
                <button onClick={async () => { await handleQRScan(manualCode); setManualCode('') }}
                  className="px-4 py-2 rounded-xl text-white font-bold text-sm" style={{ background:P }}>ОК</button>
              )}
            </div>

            {loading ? (
              <div className="flex justify-center py-10">
                <div className="w-10 h-10 border-3 border-teal-500 border-t-transparent rounded-full animate-spin" style={{ borderWidth:3 }} />
              </div>
            ) : queue.length === 0 ? (
              <div className="bg-white rounded-2xl p-10 text-center" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
                <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background:'#e0f7fa' }}>
                  <span className="material-symbols-outlined text-4xl" style={{ color:P }}>event_available</span>
                </div>
                <p className="font-bold text-gray-800 mb-1">Очередь пуста</p>
                <p className="text-gray-400 text-sm">Записи появятся здесь автоматически</p>
              </div>
            ) : (
              <div className="space-y-3">
                {queue.map(apt => <QueueCard key={apt.id} apt={apt} />)}
              </div>
            )}
          </div>
        )}

        {/* History */}
        {tab === 'history' && (
          <div className="space-y-3">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">Завершённые приёмы</p>
            {history.length === 0 ? (
              <div className="bg-white rounded-2xl p-10 text-center" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
                <span className="material-symbols-outlined text-5xl text-gray-300 block mb-3">history</span>
                <p className="text-gray-400 text-sm">Завершённых приёмов нет</p>
              </div>
            ) : (
              history.map(v => (
                <div key={v.id} className="bg-white rounded-2xl p-4 flex items-center gap-3" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background:'#e8f5e9' }}>
                    <span className="material-symbols-outlined text-green-700 text-xl" style={{ fontVariationSettings:"'FILL' 1" }}>check_circle</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-800 text-sm">{v.patient_name || v.patient_phone}</p>
                    <p className="text-xs text-gray-400">{v.appointment_date} · {v.start_time?.slice(0,5)}</p>
                  </div>
                  {v.doctor_share > 0 && (
                    <p className="font-black text-green-600 text-sm flex-shrink-0">+{Number(v.doctor_share).toLocaleString('ru')} ₽</p>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* Income */}
        {tab === 'income' && (
          <div className="space-y-3">
            <div className="bg-white rounded-2xl p-5" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
              <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-1">Всего заработано</p>
              <p className="text-4xl font-black" style={{ color:D }}>{Number(income.total).toLocaleString('ru')} ₽</p>
            </div>
            {income.entries.length === 0 ? (
              <div className="bg-white rounded-2xl p-10 text-center" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
                <span className="material-symbols-outlined text-5xl text-gray-300 block mb-3" style={{ fontVariationSettings:"'FILL' 1" }}>payments</span>
                <p className="text-gray-400 text-sm">Нет начислений</p>
              </div>
            ) : (
              income.entries.map((e, i) => (
                <div key={i} className="bg-white rounded-2xl p-4 flex items-center gap-3" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background:'#e8f5e9' }}>
                    <span className="material-symbols-outlined text-green-700 text-xl" style={{ fontVariationSettings:"'FILL' 1" }}>payments</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-800 text-sm">{e.patient_name || 'Приём'}</p>
                    <p className="text-xs text-gray-400">{fmtDate(e.created_at)}</p>
                  </div>
                  <p className="font-black text-green-600 text-base flex-shrink-0">+{Number(e.amount).toLocaleString('ru')} ₽</p>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* QR Scan FAB */}
      <button
        onClick={() => setScanner(true)}
        disabled={accepting !== null}
        className="fixed z-40 disabled:opacity-50 active:scale-95 transition-transform"
        style={{
          bottom:'calc(5rem + env(safe-area-inset-bottom))',
          left:'50%', transform:'translateX(-50%)',
          background:'linear-gradient(135deg,#0097A7,#004D5F)',
          color:'#fff', borderRadius:20, padding:'14px 28px',
          display:'flex', alignItems:'center', gap:10,
          fontWeight:800, fontSize:16, boxShadow:'0 8px 32px rgba(0,77,95,0.4)',
          border:'none', cursor:'pointer', whiteSpace:'nowrap',
        }}>
        {accepting ? (
          <><div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Принимаем...</>
        ) : (
          <><span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings:"'FILL' 1" }}>qr_code_scanner</span>Сканировать QR</>
        )}
      </button>

      {/* Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 z-50"
        style={{ paddingBottom:'env(safe-area-inset-bottom)', background:'rgba(255,255,255,0.95)', backdropFilter:'blur(20px)', borderTop:'1px solid rgba(0,0,0,0.06)' }}>
        <div className="flex">
          {NAV.map(item => (
            <button key={item.key} onClick={() => setTab(item.key)}
              className="flex-1 flex flex-col items-center justify-center pt-2 pb-1 min-h-[56px] gap-0.5 relative">
              {tab === item.key && <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full" style={{ background:P }} />}
              <span className="material-symbols-outlined text-2xl" style={{ color:tab === item.key ? P : '#9ca3af', fontVariationSettings:tab === item.key ? "'FILL' 1" : "'FILL' 0" }}>{item.icon}</span>
              <span className="text-xs font-semibold" style={{ color:tab === item.key ? P : '#9ca3af' }}>{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
