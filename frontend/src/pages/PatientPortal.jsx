/**
 * Patient Portal v2 — личный кабинет пациента.
 * Вход: телефон → OTP → кабинет (история | врачи+запись | профиль).
 * Маршрут: /{slug}/portal
 */
import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import { API_BASE, SLUG } from '../config'

const API = API_BASE

// ── Push helpers ─────────────────────────────────────────────────────────────
function arrayBufferToBase64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
}

async function subscribePush(phone, apiBase) {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    const reg = await navigator.serviceWorker.register('/sw.js')
    await navigator.serviceWorker.ready
    const vapidRes = await axios.get(`${apiBase}/push/vapid-key`)
    const vapidKey = vapidRes.data.public_key
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidKey,
    })
    const k = sub.getKey('p256dh')
    const a = sub.getKey('auth')
    await axios.post(`${apiBase}/push/subscribe`, {
      endpoint: sub.endpoint,
      p256dh: arrayBufferToBase64(k),
      auth: arrayBufferToBase64(a),
      patient_phone: phone,
    })
  } catch(e) {
    // Push недоступен или запрещён — не ломаем приложение
  }
}
const STORAGE_KEY = 'clinika_portal_token'
const MONTHS = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек']
const DAYS = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб']

function fmt(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function fmtPhone(raw) {
  const d = (raw||'').replace(/\D/g,'')
  if (d.length===11) return `+${d[0]} (${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7,9)}-${d.slice(9)}`
  if (d.length===10) return `+7 (${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6,8)}-${d.slice(8)}`
  return raw
}

// ── Stars ────────────────────────────────────────────────────────────────────
function Stars({ rating, size=14, color='#F59E0B' }) {
  const r = rating || 0
  return (
    <span style={{ display:'inline-flex', gap:1 }}>
      {[1,2,3,4,5].map(i => {
        const fill = Math.min(1, Math.max(0, r - i + 1))
        return (
          <span key={i} style={{ position:'relative', fontSize:size, lineHeight:1 }}>
            <span style={{ color:'#E5E7EB' }}>★</span>
            <span style={{ position:'absolute', left:0, top:0, overflow:'hidden', width:`${fill*100}%`, color: color }}>★</span>
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

function Avatar({ name, photo, size=52, primary='#0097A7' }) {
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

// ── Модал ────────────────────────────────────────────────────────────────────
function Modal({ open, onClose, title, children }) {
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

// ── Форма отзыва ─────────────────────────────────────────────────────────────
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

// ── Мини-запись ──────────────────────────────────────────────────────────────
function QuickBook({ doctor, token, primary, onClose, onBooked }) {
  const dates = Array.from({length:14},(_,i)=>{ const d=new Date(); d.setDate(d.getDate()+i); return d })
  const [selDate, setSelDate] = useState(null)
  const [slots, setSlots] = useState([])
  const [slotsLoading, setSL] = useState(false)
  const [selSlot, setSlot] = useState(null)
  const [name, setName] = useState('')
  const [booking, setBooking] = useState(false)
  const [done, setDone] = useState(null)
  const [err, setErr] = useState('')

  async function pickDate(d) {
    setSelDate(d); setSlot(null); setSlots([]); setSL(true)
    try {
      const r = await axios.get(`${API}/public/${SLUG}/doctors/${doctor.id}/slots`, { params:{ date: isoDate(d) } })
      setSlots(r.data)
    } catch { setSlots([]) }
    finally { setSL(false) }
  }

  async function book() {
    if (!selSlot) { setErr('Выберите время'); return }
    setBooking(true); setErr('')
    try {
      const r = token
        ? await axios.post(`${API}/portal/book`, { slug:SLUG, doctor_id:doctor.id, appointment_date:isoDate(selDate), start_time:selSlot, name }, { headers:{ Authorization:`Bearer ${token}` } })
        : await axios.post(`${API}/public/${SLUG}/book`, { doctor_id:doctor.id, appointment_date:isoDate(selDate), start_time:selSlot, patient_name:name, patient_phone:'' })
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
      {done.qr_code && <img src={done.qr_code} alt="QR" style={{ width:150, height:150, borderRadius:12, border:'1px solid #E5E7EB', marginBottom:10 }} />}
      {done.short_code && <p style={{ fontSize:14, color:'#6B7280' }}>Код: <b style={{ fontSize:22, color:'#1A2B3C' }}>{done.short_code}</b></p>}
      <button onClick={onClose}
        style={{ marginTop:14, padding:'12px 28px', background:`linear-gradient(135deg,${primary},#1565C0)`, color:'#fff', border:'none', borderRadius:12, fontSize:14, fontWeight:600, cursor:'pointer' }}>
        Готово
      </button>
    </div>
  )

  return (
    <div>
      <div style={{ display:'flex', gap:12, alignItems:'center', marginBottom:16, padding:'12px', background:'#F8FAFF', borderRadius:12 }}>
        <Avatar name={doctor.full_name} photo={doctor.photo_url} size={44} primary={primary} />
        <div>
          <div style={{ fontWeight:700, fontSize:14, color:'#1A2B3C' }}>{doctor.full_name}</div>
          <div style={{ fontSize:12, color:'#6B7280' }}>{doctor.specialty}</div>
        </div>
      </div>
      <p style={{ fontSize:13, fontWeight:600, color:'#1A2B3C', marginBottom:10 }}>Выберите дату:</p>
      <div style={{ display:'flex', gap:6, overflowX:'auto', paddingBottom:6, marginBottom:14, scrollbarWidth:'none' }}>
        {dates.map(d => (
          <button key={d.toISOString()} onClick={() => pickDate(d)}
            style={{ flexShrink:0, minWidth:54, padding:'8px 6px', borderRadius:10, border:`1.5px solid ${selDate&&isoDate(d)===isoDate(selDate)?primary:'#E5E7EB'}`, background:selDate&&isoDate(d)===isoDate(selDate)?primary+'18':'#fff', cursor:'pointer', textAlign:'center' }}>
            <div style={{ fontWeight:600, fontSize:12, color:selDate&&isoDate(d)===isoDate(selDate)?primary:'#1A2B3C' }}>{d.getDate()} {MONTHS[d.getMonth()]}</div>
            <div style={{ fontSize:10, color:'#9CA3AF' }}>{DAYS[d.getDay()]}</div>
          </button>
        ))}
      </div>
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
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="Ваше имя (необязательно)"
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

// ── Карточка врача ───────────────────────────────────────────────────────────
function DoctorCard({ doc, tenantId, primary, token, onRefreshHistory }) {
  const [bookOpen, setBookOpen] = useState(false)
  const [revOpen, setRevOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [profile, setProfile] = useState(null)
  const [profLoading, setPL] = useState(false)

  async function expandReviews() {
    setExpanded(v=>!v)
    if (profile||profLoading) return
    setPL(true)
    try {
      const r = await axios.get(`${API}/public/${SLUG}/doctors/${doc.id}/profile`)
      setProfile(r.data)
    } catch {}
    finally { setPL(false) }
  }

  return (
    <div style={{ background:'#fff', borderRadius:18, border:'1px solid #EAECF0', overflow:'hidden', marginBottom:12, boxShadow:'0 2px 10px rgba(0,0,0,.05)' }}>
      <div style={{ padding:'18px 16px 14px' }}>
        <div style={{ display:'flex', gap:14, alignItems:'flex-start' }}>
          <Avatar name={doc.full_name} photo={doc.photo_url} size={60} primary={primary} />
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
        </div>
        {doc.bio && (
          <p style={{ margin:'12px 0 0', fontSize:13, color:'#6B7280', lineHeight:1.6, display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>
            {doc.bio}
          </p>
        )}
      </div>

      <div style={{ display:'flex', borderTop:'1px solid #F3F4F6' }}>
        {doc.has_schedule && (
          <button onClick={() => setBookOpen(true)}
            style={{ flex:2, padding:'13px', background:`linear-gradient(135deg,${primary},#1565C0)`, color:'#fff', border:'none', fontSize:13, fontWeight:700, cursor:'pointer', letterSpacing:.3 }}>
            Записаться
          </button>
        )}
        <button onClick={() => setRevOpen(true)}
          style={{ flex:1, padding:'13px', background:'none', border:'none', borderLeft:`1px solid ${doc.has_schedule?'rgba(255,255,255,.15)':'#F3F4F6'}`, color:doc.has_schedule?'rgba(255,255,255,.85)':'#6B7280', fontSize:12, cursor:'pointer', background:doc.has_schedule?'transparent':'#FAFBFF' }}>
          ✍️ Отзыв
        </button>
        {doc.review_count>0 && (
          <button onClick={expandReviews}
            style={{ padding:'13px 14px', background:'none', border:'none', borderLeft:'1px solid #F3F4F6', color:'#9CA3AF', fontSize:12, cursor:'pointer' }}>
            {expanded?'▲':`▼ ${doc.review_count}`}
          </button>
        )}
      </div>

      {expanded && (
        <div style={{ padding:'14px 16px', background:'#FAFBFF', borderTop:'1px solid #F3F4F6' }}>
          {profLoading && <p style={{ textAlign:'center', color:'#9CA3AF', fontSize:13 }}>Загрузка...</p>}
          {profile && (
            <>
              <div style={{ display:'flex', gap:16, marginBottom:14, alignItems:'center' }}>
                <div style={{ textAlign:'center', flexShrink:0 }}>
                  <div style={{ fontSize:38, fontWeight:800, color:'#1A2B3C', lineHeight:1 }}>{profile.avg_rating||'—'}</div>
                  <Stars rating={profile.avg_rating} size={14} />
                  <div style={{ fontSize:11, color:'#9CA3AF', marginTop:3 }}>{profile.total_reviews} отзывов</div>
                </div>
                <div style={{ flex:1 }}>
                  {[5,4,3,2,1].map(s => <RatingBar key={s} star={s} count={profile.rating_breakdown?.[s]||0} total={profile.total_reviews} primary={primary} />)}
                </div>
              </div>
              {profile.reviews.map(r => (
                <div key={r.id} style={{ padding:'10px 0', borderTop:'1px solid #F0F1F5' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                    <span style={{ fontWeight:600, fontSize:13, color:'#1A2B3C' }}>{r.is_anonymous?'Анонимно':(r.patient_name||'Пациент')}</span>
                    <span style={{ fontSize:11, color:'#9CA3AF' }}>{fmt(r.created_at)}</span>
                  </div>
                  <Stars rating={r.rating} size={12} />
                  {r.comment && <p style={{ margin:'6px 0 0', fontSize:13, color:'#374151', lineHeight:1.5 }}>{r.comment}</p>}
                </div>
              ))}
              {profile.total_reviews===0 && <p style={{ textAlign:'center', color:'#9CA3AF', fontSize:13 }}>Нет отзывов</p>}
            </>
          )}
        </div>
      )}

      <Modal open={bookOpen} onClose={() => setBookOpen(false)} title="Запись к врачу">
        <QuickBook doctor={doc} token={token} primary={primary} onClose={() => setBookOpen(false)} onBooked={onRefreshHistory} />
      </Modal>
      <Modal open={revOpen} onClose={() => setRevOpen(false)} title="Оставить отзыв">
        <ReviewForm doctorId={doc.id} tenantId={tenantId} primary={primary}
          onClose={() => setRevOpen(false)} onDone={() => setRevOpen(false)} />
      </Modal>
    </div>
  )
}

// ── Вкладка: История ─────────────────────────────────────────────────────────
function HistoryTab({ token, primary }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    axios.get(`${API}/portal/history`, { headers:{ Authorization:`Bearer ${token}` } })
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [token])

  if (loading) return <div style={{ display:'flex', justifyContent:'center', padding:'40px 0' }}><div style={{ width:32, height:32, border:`3px solid #E0F7FA`, borderTopColor:primary, borderRadius:'50%', animation:'spin .8s linear infinite' }}/></div>

  const all = [
    ...(data?.appointments||[]),
    ...(data?.referrals||[]),
  ].sort((a,b) => {
    const da = a.appointment_date||a.created_at||''
    const db = b.appointment_date||b.created_at||''
    return db.localeCompare(da)
  })

  const upcoming = all.filter(i => ['scheduled','confirmed','created'].includes(i.status))
  const past = all.filter(i => !['scheduled','confirmed','created'].includes(i.status))
  const shown = filter==='upcoming'?upcoming : filter==='past'?past : all

  const STATUS = {
    scheduled:  { l:'Запланировано', c:'#3B82F6', bg:'#EFF6FF' },
    confirmed:  { l:'Подтверждено',  c:'#10B981', bg:'#ECFDF5' },
    completed:  { l:'Завершено',     c:'#6B7280', bg:'#F9FAFB' },
    cancelled:  { l:'Отменено',      c:'#EF4444', bg:'#FEF2F2' },
    no_show:    { l:'Неявка',        c:'#9CA3AF', bg:'#F9FAFB' },
    created:    { l:'Активно',       c:'#3B82F6', bg:'#EFF6FF' },
    expired:    { l:'Истекло',       c:'#9CA3AF', bg:'#F9FAFB' },
  }

  return (
    <div>
      <div style={{ display:'flex', gap:6, marginBottom:16 }}>
        {[['all','Все'],['upcoming','Предстоящие'],['past','Прошедшие']].map(([k,l]) => (
          <button key={k} onClick={() => setFilter(k)}
            style={{ flex:1, padding:'8px 4px', borderRadius:20, border:`1.5px solid ${filter===k?primary:'#E5E7EB'}`, background:filter===k?primary+'14':'#fff', color:filter===k?primary:'#9CA3AF', fontSize:12, fontWeight:filter===k?700:400, cursor:'pointer' }}>
            {l}
          </button>
        ))}
      </div>
      {shown.length===0
        ? <div style={{ textAlign:'center', padding:'48px 0' }}>
            <div style={{ fontSize:44, marginBottom:8 }}>📋</div>
            <p style={{ color:'#9CA3AF', fontSize:14 }}>Записей нет</p>
          </div>
        : shown.map(item => {
            const st = STATUS[item.status] || { l:item.status, c:'#9CA3AF', bg:'#F9FAFB' }
            const [showQR, setShowQR] = useState(false)
            return (
              <div key={item.id} style={{ background:'#fff', borderRadius:16, border:'1px solid #EAECF0', padding:16, marginBottom:10, boxShadow:'0 1px 4px rgba(0,0,0,.04)' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8 }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ margin:'0 0 2px', fontWeight:700, fontSize:14, color:'#1A2B3C' }}>{item.doctor_name||'—'}</p>
                    {item.specialty && <p style={{ margin:'0 0 4px', fontSize:12, color:primary, fontWeight:600 }}>{item.specialty}</p>}
                    <p style={{ margin:0, fontSize:12, color:'#6B7280' }}>
                      {item.type==='appointment'
                        ? `${fmt(item.appointment_date)}, ${item.start_time}–${item.end_time}`
                        : fmt(item.created_at)
                      }
                    </p>
                    {item.clinic_name && <p style={{ margin:'2px 0 0', fontSize:11, color:'#9CA3AF' }}>{item.clinic_name}</p>}
                  </div>
                  <span style={{ fontSize:11, fontWeight:600, color:st.c, background:st.bg, padding:'3px 10px', borderRadius:20, flexShrink:0, marginLeft:8 }}>{st.l}</span>
                </div>
                {item.short_code && (
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', background:'#F8FAFF', borderRadius:10, padding:'8px 12px' }}>
                    <span style={{ fontSize:12, color:'#6B7280' }}>Код: <b style={{ color:'#1A2B3C', fontSize:14 }}>{item.short_code}</b></span>
                    {item.qr_code && (
                      <button onClick={() => setShowQR(v=>!v)} style={{ background:'none', border:'none', color:primary, fontSize:12, cursor:'pointer', fontWeight:600 }}>
                        {showQR?'Скрыть':'QR'}
                      </button>
                    )}
                  </div>
                )}
                {showQR && item.qr_code && (
                  <div style={{ textAlign:'center', marginTop:10 }}>
                    <img src={item.qr_code} alt="QR" style={{ width:130, height:130, borderRadius:10, border:'1px solid #E5E7EB' }} />
                  </div>
                )}
              </div>
            )
          })
      }
    </div>
  )
}

// ── Вкладка: Врачи (рейтинг + запись) ───────────────────────────────────────
function DoctorsTab({ token, primary, tenantId, onRefreshHistory }) {
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

  const { specialties, doctors } = data
  const filtered = specFilter ? doctors.filter(d => d.specialty===specFilter) : doctors
  const sorted = [...filtered.filter(d=>d.has_schedule), ...filtered.filter(d=>!d.has_schedule)]

  return (
    <div>
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
          <DoctorCard key={doc.id} doc={doc} tenantId={tenantId||data.tenant.id} primary={primary} token={token} onRefreshHistory={onRefreshHistory} />
        ))
      }
    </div>
  )
}

// ── Секция уведомлений ───────────────────────────────────────────────────────
function PushSection({ token, primary, phone, apiBase }) {
  const [status, setStatus] = useState(
    'Notification' in window ? Notification.permission : 'unsupported'
  )
  const [loading, setLoading] = useState(false)

  async function enable() {
    setLoading(true)
    try {
      const perm = await Notification.requestPermission()
      setStatus(perm)
      if (perm === 'granted') {
        await subscribePush(phone, apiBase)
      }
    } catch {}
    finally { setLoading(false) }
  }

  if (status === 'unsupported') return null

  return (
    <div style={{ background:'#fff', borderRadius:18, border:'1px solid #EAECF0', overflow:'hidden', marginBottom:14 }}>
      <div style={{ padding:'16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div>
          <p style={{ margin:0, fontWeight:700, fontSize:14, color:'#1A2B3C' }}>🔔 Уведомления</p>
          <p style={{ margin:'3px 0 0', fontSize:12, color: status==='granted' ? '#10B981' : '#9CA3AF' }}>
            {status==='granted' ? 'Включены' : status==='denied' ? 'Заблокированы в браузере' : 'Выключены'}
          </p>
        </div>
        {status !== 'granted' && status !== 'denied' && (
          <button onClick={enable} disabled={loading}
            style={{ padding:'8px 16px', background:`${primary}14`, border:`1.5px solid ${primary}`, borderRadius:10, fontSize:13, fontWeight:600, color:primary, cursor:'pointer', opacity:loading?0.6:1 }}>
            {loading ? '...' : 'Включить'}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Секция смены пароля ─────────────────────────────────────────────────────
function PasswordSection({ token, primary, hasPassword, onUpdate }) {
  const [open, setOpen] = useState(false)
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [saving, setSaving] = useState(false)
  const [ok, setOk] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    setSaving(true); setOk(false); setErr('')
    try {
      if (hasPassword) {
        await axios.post(, { old_password: oldPw, new_password: newPw }, { headers: { Authorization:  } })
      } else {
        await axios.post(, { password: newPw }, { headers: { Authorization:  } })
      }
      setOk(true); setOldPw(''); setNewPw(''); setOpen(false)
      onUpdate && onUpdate({ has_password: true })
    } catch(e) { setErr(e.response?.data?.detail || 'Ошибка') }
    finally { setSaving(false) }
  }

  return (
    <div style={{ background:'#fff', borderRadius:18, border:'1px solid #EAECF0', overflow:'hidden', marginBottom:14 }}>
      <div style={{ padding:'16px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <p style={{ margin:0, fontWeight:700, fontSize:14, color:'#1A2B3C' }}>🔒 Пароль</p>
            <p style={{ margin:'3px 0 0', fontSize:12, color: hasPassword ? '#10B981' : '#9CA3AF' }}>
              {hasPassword ? 'Установлен — можно входить без SMS' : 'Не установлен'}
            </p>
          </div>
          <button onClick={() => { setOpen(v=>!v); setErr(''); setOk(false) }}
            style={{ padding:'8px 16px', background: open ? '#F3F4F6' : , border:, borderRadius:10, fontSize:13, fontWeight:600, color: open ? '#9CA3AF' : primary, cursor:'pointer' }}>
            {open ? 'Отмена' : hasPassword ? 'Сменить' : 'Установить'}
          </button>
        </div>

        {open && (
          <div style={{ marginTop:14 }}>
            {hasPassword && (
              <div style={{ marginBottom:10 }}>
                <label style={{ display:'block', fontSize:12, fontWeight:600, color:'#9CA3AF', marginBottom:5, textTransform:'uppercase', letterSpacing:.5 }}>Текущий пароль</label>
                <input type='password' value={oldPw} onChange={e=>setOldPw(e.target.value)} placeholder='Текущий пароль'
                  style={{ width:'100%', padding:'12px 14px', border:'1.5px solid #E5E7EB', borderRadius:12, fontSize:14, outline:'none', boxSizing:'border-box', color:'#1A2B3C' }} />
              </div>
            )}
            <div style={{ marginBottom:10 }}>
              <label style={{ display:'block', fontSize:12, fontWeight:600, color:'#9CA3AF', marginBottom:5, textTransform:'uppercase', letterSpacing:.5 }}>Новый пароль</label>
              <input type='password' value={newPw} onChange={e=>setNewPw(e.target.value)} placeholder='Мин. 8 символов, буквы и цифры'
                style={{ width:'100%', padding:'12px 14px', border:'1.5px solid #E5E7EB', borderRadius:12, fontSize:14, outline:'none', boxSizing:'border-box', color:'#1A2B3C' }} />
              <p style={{ margin:'5px 0 0', fontSize:11, color:'#C4C9D4' }}>Минимум 8 символов, буквы и цифры</p>
            </div>
            {ok && <p style={{ color:'#10B981', fontSize:13, marginBottom:8, fontWeight:600 }}>✓ {hasPassword ? 'Пароль изменён' : 'Пароль установлен'}</p>}
            {err && <p style={{ color:'#EF4444', fontSize:13, marginBottom:8 }}>{err}</p>}
            <button onClick={save} disabled={saving || !newPw || (hasPassword && !oldPw)}
              style={{ width:'100%', padding:'12px', background:, color:'#fff', border:'none', borderRadius:12, fontSize:14, fontWeight:700, cursor:'pointer', opacity:(saving || !newPw || (hasPassword && !oldPw)) ? 0.6 : 1 }}>
              {saving ? 'Сохранение...' : hasPassword ? 'Сменить пароль' : 'Установить пароль'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Вкладка: Профиль ─────────────────────────────────────────────────────────
function ProfileTab({ token, primary, profile, onUpdate }) {
  const [name, setName] = useState(profile.name||'')
  const [email, setEmail] = useState(profile.email||'')
  const [birth, setBirth] = useState(profile.birth_date||'')
  const [saving, setSaving] = useState(false)
  const [ok, setOk] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    setSaving(true); setOk(false); setErr('')
    try {
      await axios.patch(`${API}/portal/me`, { name:name||null, email:email||null, birth_date:birth||null }, { headers:{ Authorization:`Bearer ${token}` } })
      setOk(true)
      onUpdate && onUpdate({ name, email, birth_date:birth })
    } catch(e) { setErr(e.response?.data?.detail||'Ошибка') }
    finally { setSaving(false) }
  }

  return (
    <div>
      <div style={{ background:'#fff', borderRadius:18, border:'1px solid #EAECF0', overflow:'hidden', marginBottom:14 }}>
        <div style={{ padding:'20px 16px 16px' }}>
          <div style={{ display:'flex', gap:14, alignItems:'center', marginBottom:16 }}>
            <div style={{ width:56, height:56, borderRadius:'50%', background:`linear-gradient(135deg,${primary},#1565C0)`, display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontWeight:700, fontSize:20 }}>
              {(profile.name||profile.phone||'?')[0].toUpperCase()}
            </div>
            <div>
              <p style={{ margin:0, fontWeight:700, fontSize:16, color:'#1A2B3C' }}>{profile.name||'Мой профиль'}</p>
              <p style={{ margin:'2px 0 0', fontSize:13, color:'#9CA3AF' }}>{fmtPhone(profile.phone)}</p>
            </div>
          </div>

          {[['Имя','text',name,setName,'Иванов Иван'],['Email','email',email,setEmail,'ivan@example.com'],['Дата рождения','date',birth,setBirth,'']].map(([label,type,val,setter,ph]) => (
            <div key={label} style={{ marginBottom:12 }}>
              <label style={{ display:'block', fontSize:12, fontWeight:600, color:'#9CA3AF', marginBottom:5, textTransform:'uppercase', letterSpacing:.5 }}>{label}</label>
              <input type={type} value={val} onChange={e=>setter(e.target.value)} placeholder={ph}
                style={{ width:'100%', padding:'12px 14px', border:'1.5px solid #E5E7EB', borderRadius:12, fontSize:14, outline:'none', boxSizing:'border-box', color:'#1A2B3C' }} />
            </div>
          ))}

          {ok && <p style={{ color:'#10B981', fontSize:13, margin:'4px 0 10px', fontWeight:600 }}>✓ Сохранено</p>}
          {err && <p style={{ color:'#EF4444', fontSize:13, margin:'4px 0 10px' }}>{err}</p>}
          <button onClick={save} disabled={saving}
            style={{ width:'100%', padding:'13px', background:`linear-gradient(135deg,${primary},#1565C0)`, color:'#fff', border:'none', borderRadius:12, fontSize:14, fontWeight:700, cursor:'pointer', opacity:saving?0.7:1 }}>
            {saving?'Сохранение...':'Сохранить'}
          </button>
        </div>
      </div>

      <PushSection token={token} primary={primary} phone={profile.phone} apiBase={API} />
      <PasswordSection token={token} primary={primary} hasPassword={profile.has_password} onUpdate={onUpdate} />

      <button onClick={() => { localStorage.removeItem(STORAGE_KEY); window.location.reload() }}
        style={{ width:'100%', padding:'13px', background:'none', border:'1.5px solid #EAECF0', borderRadius:12, fontSize:14, color:'#9CA3AF', cursor:'pointer' }}>
        Выйти из кабинета
      </button>
    </div>
  )
}

// ── Экран входа ──────────────────────────────────────────────────────────────
function LoginView({ primary, logo, clinicName, onLogin }) {
  const [mode, setMode] = useState('otp')
  const [step, setStep] = useState('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [devCode, setDevCode] = useState(null)
  const [timer, setTimer] = useState(0)

  useEffect(() => {
    if (timer>0) { const t=setTimeout(()=>setTimer(v=>v-1),1000); return ()=>clearTimeout(t) }
  }, [timer])

  async function sendOtp() {
    setErr(''); setLoading(true)
    try {
      const r = await axios.post(`${API}/portal/otp/send`, { phone })
      setDevCode(r.data.dev_code); setStep('otp'); setTimer(60)
    } catch(e) { setErr(e.response?.data?.detail||'Ошибка') }
    finally { setLoading(false) }
  }

  async function verifyOtp() {
    setErr(''); setLoading(true)
    try {
      const r = await axios.post(`${API}/portal/otp/verify`, { phone, code })
      localStorage.setItem(STORAGE_KEY, r.data.access_token)
      onLogin(r.data)
    } catch(e) { setErr(e.response?.data?.detail||'Неверный код') }
    finally { setLoading(false) }
  }

  async function loginWithPassword() {
    setErr(''); setLoading(true)
    try {
      const r = await axios.post(`${API}/portal/auth/password`, { phone, password })
      localStorage.setItem(STORAGE_KEY, r.data.access_token)
      onLogin(r.data)
    } catch(e) { setErr(e.response?.data?.detail||'Неверный пароль') }
    finally { setLoading(false) }
  }

  return (
    <div style={{ minHeight:'100vh', background:'#F5F8FF', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div style={{ width:'100%', maxWidth:360 }}>
        <div style={{ textAlign:'center', marginBottom:32 }}>
          {logo
            ? <img src={logo} alt={clinicName} style={{ width:64, height:64, borderRadius:16, objectFit:'contain', marginBottom:12 }} />
            : <div style={{ width:68, height:68, borderRadius:20, background:`linear-gradient(135deg,${primary},#1565C0)`, display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:32, marginBottom:12 }}>🏥</div>
          }
          <h2 style={{ margin:'0 0 4px', fontSize:22, fontWeight:800, color:'#1A2B3C' }}>{clinicName||'Личный кабинет'}</h2>
          <p style={{ margin:0, fontSize:14, color:'#9CA3AF' }}>Войдите по номеру телефона</p>
        </div>

        <div style={{ background:'#fff', borderRadius:20, padding:'28px 24px', boxShadow:'0 8px 40px rgba(0,0,0,.08)' }}>
          {step === 'phone' && (
            <div style={{ display:'flex', background:'#F3F4F6', borderRadius:12, padding:3, marginBottom:18 }}>
              {[['otp','SMS-код'],['password','Пароль']].map(([m,l]) => (
                <button key={m} onClick={() => { setMode(m); setErr('') }}
                  style={{ flex:1, padding:'8px', borderRadius:9, border:'none', background:mode===m?'#fff':'transparent', color:mode===m?'#1A2B3C':'#9CA3AF', fontWeight:mode===m?700:400, fontSize:13, cursor:'pointer', boxShadow:mode===m?'0 1px 4px rgba(0,0,0,.08)':undefined, transition:'all .15s' }}>
                  {l}
                </button>
              ))}
            </div>
          )}

          {mode === 'otp' && (
            step==='phone' ? (
              <>
                <label style={{ display:'block', fontSize:12, fontWeight:700, color:'#6B7280', textTransform:'uppercase', letterSpacing:.5, marginBottom:8 }}>Номер телефона</label>
                <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+7 (999) 000-00-00" autoFocus
                  onKeyDown={e=>e.key==='Enter'&&sendOtp()}
                  style={{ width:'100%', padding:'14px', border:'1.5px solid #E5E7EB', borderRadius:12, fontSize:16, outline:'none', boxSizing:'border-box', color:'#1A2B3C' }} />
                {err && <p style={{ color:'#EF4444', fontSize:13, marginTop:8 }}>{err}</p>}
                <button onClick={sendOtp} disabled={loading||!phone}
                  style={{ width:'100%', marginTop:14, padding:'14px', background:`linear-gradient(135deg,${primary},#1565C0)`, color:'#fff', border:'none', borderRadius:12, fontSize:15, fontWeight:700, cursor:'pointer', opacity:(loading||!phone)?0.6:1 }}>
                  {loading?'Отправка...':'Получить код'}
                </button>
              </>
            ) : (
              <>
                <p style={{ fontSize:13, color:'#6B7280', marginBottom:14 }}>
                  Код отправлен на <b style={{ color:'#1A2B3C' }}>{fmtPhone(phone)}</b>
                </p>
                {devCode && (
                  <div style={{ background:'#FEF3C7', border:'1px solid #F59E0B', borderRadius:10, padding:'8px 12px', marginBottom:12, fontSize:13, color:'#92400E' }}>
                    Тестовый режим: код <b style={{ fontSize:16 }}>{devCode}</b>
                  </div>
                )}
                <label style={{ display:'block', fontSize:12, fontWeight:700, color:'#6B7280', textTransform:'uppercase', letterSpacing:.5, marginBottom:8 }}>Код подтверждения</label>
                <input value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,4))} placeholder="• • • •" maxLength={4} autoFocus
                  onKeyDown={e=>e.key==='Enter'&&verifyOtp()}
                  style={{ width:'100%', padding:'14px', border:'1.5px solid #E5E7EB', borderRadius:12, fontSize:26, letterSpacing:10, textAlign:'center', outline:'none', boxSizing:'border-box', color:'#1A2B3C' }} />
                {err && <p style={{ color:'#EF4444', fontSize:13, marginTop:8 }}>{err}</p>}
                <button onClick={verifyOtp} disabled={loading||code.length<4}
                  style={{ width:'100%', marginTop:14, padding:'14px', background:`linear-gradient(135deg,${primary},#1565C0)`, color:'#fff', border:'none', borderRadius:12, fontSize:15, fontWeight:700, cursor:'pointer', opacity:(loading||code.length<4)?0.6:1 }}>
                  {loading?'Проверка...':'Войти'}
                </button>
                <div style={{ textAlign:'center', marginTop:12 }}>
                  {timer>0
                    ? <span style={{ fontSize:13, color:'#9CA3AF' }}>Повторить через {timer} с</span>
                    : <button onClick={()=>{setStep('phone');setCode('');setErr('')}} style={{ background:'none', border:'none', color:primary, fontSize:13, cursor:'pointer', fontWeight:600 }}>← Изменить номер</button>
                  }
                </div>
              </>
            )
          )}

          {mode === 'password' && (
            <>
              <label style={{ display:'block', fontSize:12, fontWeight:700, color:'#6B7280', textTransform:'uppercase', letterSpacing:.5, marginBottom:8 }}>Номер телефона</label>
              <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+7 (999) 000-00-00" autoFocus
                style={{ width:'100%', padding:'14px', border:'1.5px solid #E5E7EB', borderRadius:12, fontSize:16, outline:'none', boxSizing:'border-box', color:'#1A2B3C', marginBottom:10 }} />
              <label style={{ display:'block', fontSize:12, fontWeight:700, color:'#6B7280', textTransform:'uppercase', letterSpacing:.5, marginBottom:8 }}>Пароль</label>
              <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Ваш пароль"
                onKeyDown={e=>e.key==='Enter'&&loginWithPassword()}
                style={{ width:'100%', padding:'14px', border:'1.5px solid #E5E7EB', borderRadius:12, fontSize:16, outline:'none', boxSizing:'border-box', color:'#1A2B3C' }} />
              {err && <p style={{ color:'#EF4444', fontSize:13, marginTop:8 }}>{err}</p>}
              <button onClick={loginWithPassword} disabled={loading||!phone||!password}
                style={{ width:'100%', marginTop:14, padding:'14px', background:`linear-gradient(135deg,${primary},#1565C0)`, color:'#fff', border:'none', borderRadius:12, fontSize:15, fontWeight:700, cursor:'pointer', opacity:(loading||!phone||!password)?0.6:1 }}>
                {loading?'Вход...':'Войти'}
              </button>
              <p style={{ textAlign:'center', fontSize:12, color:'#C4C9D4', marginTop:12 }}>
                Пароль устанавливается в разделе Профиль после первого входа по SMS
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Главный компонент ────────────────────────────────────────────────────────
export default function PatientPortal() {
  const [token, setToken] = useState(() => localStorage.getItem(STORAGE_KEY))
  const [profile, setProfile] = useState(null)
  const [branding, setBranding] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('history')
  const [histKey, setHistKey] = useState(0)

  useEffect(() => {
    const style = document.createElement('style')
    style.textContent = `@keyframes spin{to{transform:rotate(360deg)}} *{box-sizing:border-box} body{margin:0}`
    document.head.appendChild(style)
    return () => document.head.removeChild(style)
  }, [])

  useEffect(() => {
    // Загружаем брендинг всегда (для экрана входа тоже)
    axios.get(`${API}/public/${SLUG}/clinic`)
      .then(r => setBranding(r.data))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!token) { setLoading(false); return }
    axios.get(`${API}/portal/me`, { headers:{ Authorization:`Bearer ${token}` } })
      .then(r => setProfile(r.data))
      .catch(() => { localStorage.removeItem(STORAGE_KEY); setToken(null) })
      .finally(() => setLoading(false))
  }, [token])

  const primary = branding?.branding?.primary_color || '#0097A7'
  const clinicName = branding?.branding?.brand_name || branding?.tenant?.name || 'Личный кабинет'
  const logo = branding?.branding?.logo_url

  // Считываем ?token=... из URL (редирект из универсального входа)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const urlToken = params.get('token')
    if (urlToken && !token) {
      localStorage.setItem(STORAGE_KEY, urlToken)
      window.history.replaceState({}, '', window.location.pathname)
      setToken(urlToken)
    }
  }, []) // eslint-disable-line

  // PWA manifest + iOS meta-теги
  useEffect(() => {
    let link = document.querySelector('link[rel="manifest"]')
    if (!link) {
      link = document.createElement('link')
      link.rel = 'manifest'
      document.head.appendChild(link)
    }
    link.href = `${API}/portal/manifest.json?slug=${SLUG}`
    const setMeta = (name, content) => {
      let m = document.querySelector(`meta[name="${name}"]`)
      if (!m) { m = document.createElement('meta'); m.setAttribute('name', name); document.head.appendChild(m) }
      m.setAttribute('content', content)
    }
    setMeta('apple-mobile-web-app-capable', 'yes')
    setMeta('apple-mobile-web-app-status-bar-style', 'default')
    setMeta('apple-mobile-web-app-title', clinicName)
    setMeta('theme-color', primary)
  }, [clinicName, primary])

  // Подписка на push-уведомления после входа
  useEffect(() => {
    if (!token || !profile?.phone) return
    if (Notification.permission === 'denied') return
    subscribePush(profile.phone, API)
  }, [token, profile?.phone])

  if (!token || (!profile && !loading)) {
    return <LoginView primary={primary} logo={logo} clinicName={clinicName} onLogin={d => { setToken(d.access_token); setProfile({ phone:d.phone, name:d.name, email:d.email, has_password: d.has_password }) }} />
  }

  if (loading) return (
    <div style={{ minHeight:'100vh', background:'#F5F8FF', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ width:36, height:36, border:`3px solid #E0F7FA`, borderTopColor:primary, borderRadius:'50%', animation:'spin .8s linear infinite' }}/>
    </div>
  )

  const TABS = [
    { id:'history', icon:'📋', label:'Мои записи' },
    { id:'doctors', icon:'🔍', label:'Врачи' },
    { id:'profile', icon:'👤', label:'Профиль' },
  ]

  return (
    <div style={{ minHeight:'100vh', background:'#F5F8FF', fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', maxWidth:560, margin:'0 auto', display:'flex', flexDirection:'column' }}>
      {/* Шапка */}
      <div style={{ background:`linear-gradient(150deg,#0A2342 0%,${primary} 100%)`, color:'#fff', padding:'20px 16px 0', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:18 }}>
          {logo && <img src={logo} alt="" style={{ width:36, height:36, borderRadius:10, objectFit:'contain', background:'rgba(255,255,255,.9)', padding:3, flexShrink:0 }} />}
          <div>
            <p style={{ margin:0, fontSize:11, opacity:.65, letterSpacing:.3 }}>ЛИЧНЫЙ КАБИНЕТ ПАЦИЕНТА</p>
            <p style={{ margin:'2px 0 0', fontWeight:700, fontSize:15, lineHeight:1.2 }}>
              {profile?.name ? `Привет, ${profile.name.split(' ')[0]}!` : fmtPhone(profile?.phone)}
            </p>
          </div>
        </div>
        <div style={{ display:'flex' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ flex:1, padding:'10px 4px', background:'none', border:'none', borderBottom:`3px solid ${tab===t.id?'#fff':'transparent'}`, color:tab===t.id?'#fff':'rgba(255,255,255,.45)', cursor:'pointer', transition:'all .2s' }}>
              <span style={{ display:'block', fontSize:17, marginBottom:2 }}>{t.icon}</span>
              <span style={{ fontSize:11, fontWeight:tab===t.id?700:400 }}>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Контент */}
      <div style={{ flex:1, padding:'14px 12px 32px', overflowY:'auto' }}>
        {tab==='history' && <HistoryTab key={histKey} token={token} primary={primary} />}
        {tab==='doctors' && <DoctorsTab token={token} primary={primary} tenantId={branding?.tenant?.id} onRefreshHistory={() => { setHistKey(v=>v+1); setTab('history') }} />}
        {tab==='profile' && <ProfileTab token={token} primary={primary} profile={profile} onUpdate={p => setProfile(prev => ({...prev,...p}))} />}
      </div>
    </div>
  )
}
