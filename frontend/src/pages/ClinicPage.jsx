/**
 * Публичная страница клиники — рейтинг врачей.
 * Маршрут: /{slug}/clinic
 */
import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import { API_BASE, SLUG } from '../config'

const API = API_BASE
const MONTHS = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек']
const DAYS = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб']

function fmt(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function Stars({ rating, size = 14, color = '#F59E0B' }) {
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
    <div style={{ display:'flex', gap:4, cursor:'pointer' }}>
      {[1,2,3,4,5].map(i => (
        <span key={i}
          onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(0)}
          onClick={() => onChange(i)}
          style={{ fontSize:32, color: i <= (hover||value) ? '#F59E0B' : '#D1D5DB', transition:'color .15s' }}>
          ★
        </span>
      ))}
    </div>
  )
}

function Avatar({ name, photo, size=56, primary='#0097A7' }) {
  if (photo) return <img src={photo} alt={name} style={{ width:size, height:size, borderRadius:'50%', objectFit:'cover', flexShrink:0 }} />
  const initials = (name||'').split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase() || '?'
  return (
    <div style={{ width:size, height:size, borderRadius:'50%', background:`linear-gradient(135deg,${primary},#1565C0)`, display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontWeight:700, fontSize:size*0.35, flexShrink:0 }}>
      {initials}
    </div>
  )
}

function RatingBar({ star, count, total, primary }) {
  const pct = total > 0 ? Math.round(count/total*100) : 0
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:5 }}>
      <span style={{ fontSize:12, color:'#6B7280', width:12, textAlign:'right' }}>{star}</span>
      <span style={{ fontSize:11, color:'#F59E0B' }}>★</span>
      <div style={{ flex:1, height:6, background:'#E5E7EB', borderRadius:3, overflow:'hidden' }}>
        <div style={{ width:`${pct}%`, height:'100%', background:primary, borderRadius:3 }} />
      </div>
      <span style={{ fontSize:12, color:'#6B7280', width:22 }}>{count}</span>
    </div>
  )
}

function Modal({ open, onClose, title, children }) {
  if (!open) return null
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.55)', zIndex:1000, display:'flex', alignItems:'flex-end', justifyContent:'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:'#fff', borderRadius:'20px 20px 0 0', padding:'20px 20px 32px', width:'100%', maxWidth:500, maxHeight:'92vh', overflowY:'auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <h3 style={{ margin:0, fontSize:16, color:'#1A2B3C' }}>{title}</h3>
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
        comment: comment.trim() || null,
        patient_name: anon ? null : (name.trim() || 'Пациент'),
        is_anonymous: anon,
      })
      setOk(true)
      setTimeout(() => { onDone && onDone() }, 1500)
    } catch(e) {
      setErr(e.response?.data?.detail || 'Ошибка отправки')
    } finally { setSaving(false) }
  }

  if (ok) return (
    <div style={{ textAlign:'center', padding:'24px 0' }}>
      <div style={{ fontSize:48 }}>🙏</div>
      <p style={{ fontWeight:700, color:'#1A2B3C', marginTop:8 }}>Спасибо за отзыв!</p>
      <p style={{ fontSize:13, color:'#6B7280' }}>После проверки отзыв появится на странице</p>
    </div>
  )

  return (
    <div>
      <div style={{ marginBottom:16 }}>
        <p style={{ fontSize:13, color:'#6B7280', marginBottom:8 }}>Ваша оценка:</p>
        <StarSelect value={rating} onChange={setRating} />
      </div>
      <textarea value={comment} onChange={e => setComment(e.target.value)}
        placeholder="Расскажите о своём визите..." rows={4}
        style={{ width:'100%', padding:'12px', border:'1.5px solid #E5E7EB', borderRadius:12, fontSize:14, outline:'none', resize:'vertical', fontFamily:'inherit', boxSizing:'border-box' }} />
      <div style={{ display:'flex', gap:10, marginTop:10, alignItems:'center' }}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Ваше имя" disabled={anon}
          style={{ flex:1, padding:'11px 12px', border:'1.5px solid #E5E7EB', borderRadius:10, fontSize:14, outline:'none', opacity:anon?0.4:1 }} />
        <label style={{ display:'flex', gap:6, alignItems:'center', fontSize:13, color:'#6B7280', cursor:'pointer', whiteSpace:'nowrap' }}>
          <input type="checkbox" checked={anon} onChange={e => setAnon(e.target.checked)} />
          Анонимно
        </label>
      </div>
      {err && <p style={{ color:'#EF4444', fontSize:13, marginTop:8 }}>{err}</p>}
      <div style={{ display:'flex', gap:8, marginTop:14 }}>
        <button onClick={submit} disabled={saving||!rating}
          style={{ flex:1, padding:'12px', background:`linear-gradient(135deg,${primary},#1565C0)`, color:'#fff', border:'none', borderRadius:12, fontSize:14, fontWeight:600, cursor:'pointer', opacity:(saving||!rating)?0.6:1 }}>
          {saving ? 'Отправка...' : 'Отправить'}
        </button>
        <button onClick={onClose}
          style={{ padding:'12px 16px', background:'none', border:'1.5px solid #E5E7EB', borderRadius:12, fontSize:14, color:'#6B7280', cursor:'pointer' }}>
          Отмена
        </button>
      </div>
    </div>
  )
}

function QuickBook({ doctor, slug, primary, onClose }) {
  const dates = Array.from({length:14}, (_, i) => { const d = new Date(); d.setDate(d.getDate()+i); return d })
  const [selDate, setSelDate] = useState(null)
  const [slots, setSlots] = useState([])
  const [slotsLoading, setSL] = useState(false)
  const [selSlot, setSlot] = useState(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [booking, setBooking] = useState(false)
  const [done, setDone] = useState(null)
  const [err, setErr] = useState('')

  async function pickDate(d) {
    setSelDate(d); setSlot(null); setSlots([]); setSL(true)
    try {
      const r = await axios.get(`${API}/public/${slug}/doctors/${doctor.id}/slots`, { params:{ date: isoDate(d) } })
      setSlots(r.data)
    } catch { setSlots([]) }
    finally { setSL(false) }
  }

  async function book() {
    if (!name||!phone||!selSlot) { setErr('Заполните все поля'); return }
    setBooking(true); setErr('')
    try {
      const r = await axios.post(`${API}/public/${slug}/book`, {
        doctor_id: doctor.id, appointment_date: isoDate(selDate),
        start_time: selSlot, patient_name: name, patient_phone: phone,
      })
      setDone(r.data)
    } catch(e) { setErr(e.response?.data?.detail||'Ошибка записи') }
    finally { setBooking(false) }
  }

  if (done) return (
    <div style={{ textAlign:'center', padding:'16px 0' }}>
      <div style={{ fontSize:48, marginBottom:8 }}>✅</div>
      <h4 style={{ margin:'0 0 6px', color:'#1A2B3C' }}>Запись создана!</h4>
      <p style={{ fontSize:13, color:'#6B7280', marginBottom:16 }}>{fmt(done.appointment_date)}, {done.start_time} · {done.clinic_name}</p>
      {done.qr_code && <img src={done.qr_code} alt="QR" style={{ width:150, height:150, borderRadius:12, border:'1px solid #E5E7EB', marginBottom:8 }} />}
      {done.short_code && <p style={{ fontSize:14, color:'#6B7280' }}>Код: <b style={{ fontSize:20, color:'#1A2B3C' }}>{done.short_code}</b></p>}
      <button onClick={onClose}
        style={{ marginTop:12, padding:'11px 28px', background:`linear-gradient(135deg,${primary},#1565C0)`, color:'#fff', border:'none', borderRadius:12, fontSize:14, fontWeight:600, cursor:'pointer' }}>
        Готово
      </button>
    </div>
  )

  return (
    <div>
      <div style={{ display:'flex', gap:12, alignItems:'center', marginBottom:16, padding:'12px', background:'#F8FAFF', borderRadius:12 }}>
        <Avatar name={doctor.full_name} photo={doctor.photo_url} size={44} primary={primary} />
        <div>
          <div style={{ fontWeight:600, fontSize:14, color:'#1A2B3C' }}>{doctor.full_name}</div>
          <div style={{ fontSize:12, color:'#6B7280' }}>{doctor.specialty}</div>
        </div>
      </div>
      <p style={{ fontSize:13, fontWeight:600, color:'#1A2B3C', marginBottom:10 }}>Выберите дату:</p>
      <div style={{ display:'flex', gap:6, overflowX:'auto', paddingBottom:6, marginBottom:14 }}>
        {dates.map(d => (
          <button key={d.toISOString()} onClick={() => pickDate(d)}
            style={{ flexShrink:0, minWidth:54, padding:'8px 6px', borderRadius:10, border:`1.5px solid ${selDate&&isoDate(d)===isoDate(selDate)?primary:'#E5E7EB'}`, background:selDate&&isoDate(d)===isoDate(selDate)?primary+'18':'#fff', cursor:'pointer', textAlign:'center' }}>
            <div style={{ fontWeight:600, fontSize:12, color:selDate&&isoDate(d)===isoDate(selDate)?primary:'#1A2B3C' }}>{d.getDate()} {MONTHS[d.getMonth()]}</div>
            <div style={{ fontSize:10, color:'#9CA3AF' }}>{DAYS[d.getDay()]}</div>
          </button>
        ))}
      </div>
      {selDate && (slotsLoading
        ? <p style={{ textAlign:'center', color:'#9CA3AF', fontSize:13 }}>Загрузка...</p>
        : slots.length === 0
          ? <p style={{ textAlign:'center', color:'#9CA3AF', fontSize:13 }}>Нет свободных слотов на эту дату</p>
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
          {[['Ваше имя', 'text', name, setName, 'Иванов Иван'], ['Телефон', 'tel', phone, setPhone, '+7 (999) 000-00-00']].map(([label, type, val, setter, ph]) => (
            <div key={label} style={{ marginBottom:10 }}>
              <label style={{ display:'block', fontSize:12, fontWeight:600, color:'#6B7280', marginBottom:4 }}>{label}</label>
              <input type={type} value={val} onChange={e => setter(e.target.value)} placeholder={ph}
                style={{ width:'100%', padding:'11px 12px', border:'1.5px solid #E5E7EB', borderRadius:10, fontSize:14, outline:'none', boxSizing:'border-box' }} />
            </div>
          ))}
          {err && <p style={{ color:'#EF4444', fontSize:13, marginBottom:8 }}>{err}</p>}
          <button onClick={book} disabled={booking}
            style={{ width:'100%', padding:'13px', background:`linear-gradient(135deg,${primary},#1565C0)`, color:'#fff', border:'none', borderRadius:12, fontSize:14, fontWeight:600, cursor:'pointer', opacity:booking?0.7:1 }}>
            {booking ? 'Запись...' : `Записаться на ${selSlot}`}
          </button>
        </div>
      )}
    </div>
  )
}

function DoctorCard({ doc, tenantId, primary, slug, onReviewAdded }) {
  const [bookOpen, setBookOpen] = useState(false)
  const [revOpen, setRevOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [profile, setProfile] = useState(null)
  const [profLoading, setPL] = useState(false)

  async function expand() {
    setExpanded(v => !v)
    if (profile || profLoading) return
    setPL(true)
    try {
      const r = await axios.get(`${API}/public/${slug}/doctors/${doc.id}/profile`)
      setProfile(r.data)
    } catch {}
    finally { setPL(false) }
  }

  return (
    <div style={{ background:'#fff', borderRadius:18, border:'1px solid #EAECF0', overflow:'hidden', marginBottom:12, boxShadow:'0 1px 6px rgba(0,0,0,.05)' }}>
      <div style={{ padding:'18px 16px' }}>
        <div style={{ display:'flex', gap:14, alignItems:'flex-start' }}>
          <Avatar name={doc.full_name} photo={doc.photo_url} size={64} primary={primary} />
          <div style={{ flex:1, minWidth:0 }}>
            <h3 style={{ margin:'0 0 2px', fontSize:15, color:'#1A2B3C', fontWeight:700, lineHeight:1.3 }}>{doc.full_name}</h3>
            <p style={{ margin:'0 0 3px', fontSize:13, color:primary, fontWeight:600 }}>{doc.specialty || 'Врач'}</p>
            {doc.experience_years && (
              <p style={{ margin:'0 0 4px', fontSize:12, color:'#6B7280' }}>Стаж {doc.experience_years} {doc.experience_years===1?'год':doc.experience_years<5?'года':'лет'}</p>
            )}
            {doc.avg_rating ? (
              <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                <Stars rating={doc.avg_rating} size={13} />
                <b style={{ fontSize:13, color:'#1A2B3C' }}>{doc.avg_rating}</b>
                <span style={{ fontSize:12, color:'#9CA3AF' }}>({doc.review_count})</span>
              </div>
            ) : (
              <span style={{ fontSize:12, color:'#C4C9D4' }}>Нет отзывов</span>
            )}
          </div>
        </div>

        <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:10 }}>
          <span style={{ fontSize:13 }}>📍</span>
          <span style={{ fontSize:12, color:'#6B7280' }}>{doc.clinic_name}{doc.clinic_address ? ` · ${doc.clinic_address}` : ''}</span>
        </div>
        {doc.education && (
          <div style={{ display:'flex', gap:6, marginTop:6 }}>
            <span style={{ fontSize:13 }}>🎓</span>
            <span style={{ fontSize:12, color:'#6B7280', lineHeight:1.5 }}>{doc.education}</span>
          </div>
        )}
        {doc.bio && (
          <p style={{ margin:'10px 0 0', fontSize:13, color:'#374151', lineHeight:1.6, display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>
            {doc.bio}
          </p>
        )}
      </div>

      <div style={{ display:'flex', borderTop:'1px solid #F3F4F6' }}>
        {doc.has_schedule && (
          <button onClick={() => setBookOpen(true)}
            style={{ flex:1, padding:'12px', background:`linear-gradient(135deg,${primary},#1565C0)`, color:'#fff', border:'none', fontSize:13, fontWeight:600, cursor:'pointer' }}>
            Записаться
          </button>
        )}
        <button onClick={() => setRevOpen(true)}
          style={{ flex:doc.has_schedule?0:1, padding:'12px 14px', background:'none', border:'none', borderLeft:doc.has_schedule?'1px solid rgba(255,255,255,.2)':'none', color:doc.has_schedule?'rgba(255,255,255,.9)':primary, fontSize:13, cursor:'pointer', background:doc.has_schedule?'transparent':'#F8FAFF' }}>
          ✍️ Отзыв
        </button>
        {doc.review_count > 0 && (
          <button onClick={expand}
            style={{ padding:'12px 14px', background:'none', border:'none', borderLeft:'1px solid #F3F4F6', color:'#6B7280', fontSize:12, cursor:'pointer' }}>
            {expanded ? '▲' : `▼ ${doc.review_count}`}
          </button>
        )}
      </div>

      {expanded && (
        <div style={{ padding:'16px', borderTop:'1px solid #F3F4F6', background:'#FAFBFF' }}>
          {profLoading && <p style={{ textAlign:'center', color:'#9CA3AF', fontSize:13 }}>Загрузка...</p>}
          {profile && (
            <>
              <div style={{ display:'flex', gap:16, marginBottom:14 }}>
                <div style={{ textAlign:'center' }}>
                  <div style={{ fontSize:36, fontWeight:800, color:'#1A2B3C', lineHeight:1 }}>{profile.avg_rating || '—'}</div>
                  <Stars rating={profile.avg_rating} size={14} />
                  <div style={{ fontSize:11, color:'#9CA3AF', marginTop:2 }}>{profile.total_reviews} отзывов</div>
                </div>
                <div style={{ flex:1 }}>
                  {[5,4,3,2,1].map(s => (
                    <RatingBar key={s} star={s} count={profile.rating_breakdown?.[s]||0} total={profile.total_reviews} primary={primary} />
                  ))}
                </div>
              </div>
              {profile.reviews.map(r => (
                <div key={r.id} style={{ padding:'12px 0', borderTop:'1px solid #F0F1F5' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                    <span style={{ fontWeight:600, fontSize:13, color:'#1A2B3C' }}>{r.is_anonymous ? 'Анонимно' : (r.patient_name || 'Пациент')}</span>
                    <span style={{ fontSize:11, color:'#9CA3AF' }}>{fmt(r.created_at)}</span>
                  </div>
                  <Stars rating={r.rating} size={12} />
                  {r.comment && <p style={{ margin:'6px 0 0', fontSize:13, color:'#374151', lineHeight:1.5 }}>{r.comment}</p>}
                </div>
              ))}
            </>
          )}
        </div>
      )}

      <Modal open={bookOpen} onClose={() => setBookOpen(false)} title="Запись к врачу">
        <QuickBook doctor={doc} slug={slug} primary={primary} onClose={() => setBookOpen(false)} />
      </Modal>
      <Modal open={revOpen} onClose={() => setRevOpen(false)} title="Оставить отзыв">
        <ReviewForm doctorId={doc.id} tenantId={tenantId} primary={primary}
          onClose={() => setRevOpen(false)} onDone={() => { setRevOpen(false); onReviewAdded && onReviewAdded() }} />
      </Modal>
    </div>
  )
}

export default function ClinicPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [specFilter, setSpec] = useState('')
  const [tab, setTab] = useState('doctors')
  const [reviewKey, setRK] = useState(0)

  useEffect(() => {
    axios.get(`${API}/public/${SLUG}/clinic`)
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [reviewKey])

  if (loading) return (
    <div style={{ minHeight:'100vh', background:'#F5F8FF', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ width:36, height:36, border:'3px solid #E0F7FA', borderTopColor:'#0097A7', borderRadius:'50%', animation:'spin .8s linear infinite' }}/>
    </div>
  )
  if (!data) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:8 }}>
      <span style={{ fontSize:40 }}>🏥</span>
      <p style={{ color:'#6B7280' }}>Клиника не найдена</p>
    </div>
  )

  const { tenant, branding, clinics, specialties, doctors, recent_reviews } = data
  const primary = branding.primary_color || '#0097A7'
  const clinicName = branding.brand_name || tenant.name
  const filtered = specFilter ? doctors.filter(d => d.specialty === specFilter) : doctors
  const sorted = [...filtered.filter(d => d.has_schedule), ...filtered.filter(d => !d.has_schedule)]

  return (
    <div style={{ minHeight:'100vh', background:'#F5F8FF', fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', maxWidth:600, margin:'0 auto' }}>
      <div style={{ background:`linear-gradient(150deg,#0A2342 0%,${primary} 100%)`, color:'#fff', padding:'28px 16px 0' }}>
        <div style={{ display:'flex', gap:14, alignItems:'flex-start', marginBottom:20 }}>
          {branding.logo_url
            ? <img src={branding.logo_url} alt={clinicName} style={{ width:56, height:56, borderRadius:14, objectFit:'contain', background:'rgba(255,255,255,.95)', padding:4, flexShrink:0 }} />
            : <div style={{ width:56, height:56, borderRadius:14, background:'rgba(255,255,255,.15)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:26, flexShrink:0 }}>🏥</div>
          }
          <div>
            <h1 style={{ margin:'0 0 3px', fontSize:20, fontWeight:800, lineHeight:1.25 }}>{clinicName}</h1>
            {clinics[0]?.city && <p style={{ margin:'0 0 6px', fontSize:12, opacity:.7 }}>📍 {clinics[0].city}</p>}
            {tenant.avg_rating && (
              <div style={{ display:'inline-flex', alignItems:'center', gap:6, background:'rgba(255,255,255,.15)', borderRadius:20, padding:'4px 10px' }}>
                <Stars rating={tenant.avg_rating} size={12} color='#FCD34D' />
                <b style={{ fontSize:13 }}>{tenant.avg_rating}</b>
                <span style={{ fontSize:11, opacity:.8 }}>· {tenant.total_reviews} отзывов</span>
              </div>
            )}
          </div>
        </div>
        <div style={{ display:'flex' }}>
          {[['doctors',`Врачи`],['reviews',`Отзывы`]].map(([k,l]) => (
            <button key={k} onClick={() => setTab(k)}
              style={{ flex:1, padding:'11px', background:'none', border:'none', borderBottom:`3px solid ${tab===k?'#fff':'transparent'}`, color:tab===k?'#fff':'rgba(255,255,255,.5)', fontWeight:tab===k?700:400, fontSize:14, cursor:'pointer' }}>
              {l} {k==='doctors'?`(${doctors.length})`:`(${tenant.total_reviews})`}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding:'14px 12px 80px' }}>
        {tab === 'doctors' && (
          <>
            {specialties.length > 1 && (
              <div style={{ display:'flex', gap:6, overflowX:'auto', paddingBottom:4, marginBottom:14, scrollbarWidth:'none' }}>
                {['', ...specialties].map(s => (
                  <button key={s||'all'} onClick={() => setSpec(s)}
                    style={{ flexShrink:0, padding:'6px 14px', borderRadius:20, border:`1.5px solid ${specFilter===s?primary:'#E5E7EB'}`, background:specFilter===s?primary+'18':'#fff', color:specFilter===s?primary:'#6B7280', fontSize:13, fontWeight:specFilter===s?600:400, cursor:'pointer', whiteSpace:'nowrap' }}>
                    {s || 'Все'}
                  </button>
                ))}
              </div>
            )}
            {sorted.map(doc => (
              <DoctorCard key={doc.id} doc={doc} tenantId={tenant.id} primary={primary} slug={SLUG} onReviewAdded={() => setRK(v => v+1)} />
            ))}
          </>
        )}
        {tab === 'reviews' && (
          <>
            {tenant.avg_rating && (
              <div style={{ background:'#fff', borderRadius:16, border:'1px solid #EAECF0', padding:18, marginBottom:14, display:'flex', gap:20, alignItems:'center' }}>
                <div style={{ textAlign:'center' }}>
                  <div style={{ fontSize:44, fontWeight:800, color:'#1A2B3C', lineHeight:1 }}>{tenant.avg_rating}</div>
                  <Stars rating={tenant.avg_rating} size={16} />
                  <div style={{ fontSize:11, color:'#9CA3AF', marginTop:4 }}>{tenant.total_reviews} отзывов</div>
                </div>
                <div style={{ flex:1 }}>
                  {[5,4,3,2,1].map(s => <RatingBar key={s} star={s} count={tenant.rating_breakdown?.[s]||0} total={tenant.total_reviews} primary={primary} />)}
                </div>
              </div>
            )}
            {recent_reviews.map(r => (
              <div key={r.id} style={{ background:'#fff', borderRadius:14, border:'1px solid #EAECF0', padding:16, marginBottom:10 }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                  <span style={{ fontWeight:600, fontSize:13, color:'#1A2B3C' }}>{r.is_anonymous?'Анонимно':(r.patient_name||'Пациент')}</span>
                  <span style={{ fontSize:11, color:'#9CA3AF' }}>{fmt(r.created_at)}</span>
                </div>
                {r.doctor_name && <p style={{ margin:'0 0 4px', fontSize:12, color:primary }}>{r.doctor_name}</p>}
                <Stars rating={r.rating} size={13} />
                {r.comment && <p style={{ margin:'8px 0 0', fontSize:13, color:'#374151', lineHeight:1.6 }}>{r.comment}</p>}
              </div>
            ))}
            {recent_reviews.length === 0 && <p style={{ textAlign:'center', color:'#9CA3AF', padding:'40px 0' }}>Пока нет отзывов</p>}
          </>
        )}
      </div>

      <div style={{ position:'fixed', bottom:20, right:16, zIndex:100 }}>
        <a href={`/${SLUG}/book`} style={{ display:'block', padding:'13px 20px', background:`linear-gradient(135deg,${primary},#1565C0)`, color:'#fff', textDecoration:'none', borderRadius:50, fontSize:14, fontWeight:700, boxShadow:'0 6px 24px rgba(0,0,0,.25)' }}>
          Записаться →
        </a>
      </div>
    </div>
  )
}
