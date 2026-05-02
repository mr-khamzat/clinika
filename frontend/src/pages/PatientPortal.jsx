/**
 * Patient Portal v2 — личный кабинет пациента.
 * Вход: телефон → OTP → кабинет (история + запись + профиль).
 * Маршрут: /{slug}/portal
 */
import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import { API_BASE, SLUG } from '../config'

const API = API_BASE
const STORAGE_KEY = 'clinika_portal_token'
const MONTHS_RU = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек']

const C = {
  teal:   '#0097A7',
  navy:   '#0A2342',
  blue:   '#1565C0',
  light:  '#E0F7FA',
  bg:     '#F5F8FF',
  card:   '#FFFFFF',
  gray:   '#9CA3AF',
  text:   '#1A2B3C',
  muted:  '#6B7280',
  red:    '#EF4444',
  green:  '#10B981',
}

// ── Утилиты ────────────────────────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.getDate()} ${MONTHS_RU[d.getMonth()]} ${d.getFullYear()}`
}
function fmtPhone(raw) {
  const d = (raw || '').replace(/\D/g, '')
  if (d.length === 11) return `+${d[0]} (${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7,9)}-${d.slice(9)}`
  if (d.length === 10) return `+7 (${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6,8)}-${d.slice(8)}`
  return raw
}
function isoDate(d) {
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), dd = String(d.getDate()).padStart(2,'0')
  return `${y}-${m}-${dd}`
}

const STATUS_LABEL = {
  scheduled:  { label: 'Запланировано', color: C.blue },
  confirmed:  { label: 'Подтверждено',  color: C.green },
  completed:  { label: 'Завершено',     color: C.teal },
  cancelled:  { label: 'Отменено',      color: C.red },
  no_show:    { label: 'Неявка',        color: C.gray },
  created:    { label: 'Активно',       color: C.blue },
  expired:    { label: 'Истекло',       color: C.gray },
}

function Spinner() {
  return <div style={{display:'flex',justifyContent:'center',padding:'40px 0'}}>
    <div style={{width:32,height:32,border:`3px solid ${C.light}`,borderTopColor:C.teal,borderRadius:'50%',animation:'spin .8s linear infinite'}}/>
  </div>
}

// ── Компонент: Вход ────────────────────────────────────────────────────────────
function LoginView({ onLogin }) {
  const [step, setStep] = useState('phone')  // phone | otp
  const [phone, setPhone] = useState('')
  const [code, setCode]   = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState('')
  const [devCode, setDevCode] = useState(null)
  const [timer, setTimer]   = useState(0)

  useEffect(() => {
    if (timer > 0) {
      const t = setTimeout(() => setTimer(v => v - 1), 1000)
      return () => clearTimeout(t)
    }
  }, [timer])

  async function sendOtp() {
    setError(''); setLoading(true)
    try {
      const r = await axios.post(`${API}/portal/otp/send`, { phone })
      setDevCode(r.data.dev_code)
      setStep('otp')
      setTimer(60)
    } catch(e) {
      setError(e.response?.data?.detail || 'Ошибка отправки кода')
    } finally { setLoading(false) }
  }

  async function verifyOtp() {
    setError(''); setLoading(true)
    try {
      const r = await axios.post(`${API}/portal/otp/verify`, { phone, code })
      localStorage.setItem(STORAGE_KEY, r.data.access_token)
      onLogin(r.data)
    } catch(e) {
      setError(e.response?.data?.detail || 'Неверный код')
    } finally { setLoading(false) }
  }

  return (
    <div style={{minHeight:'100vh',background:C.bg,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
      <div style={{background:C.card,borderRadius:20,padding:'40px 32px',maxWidth:380,width:'100%',boxShadow:'0 8px 40px rgba(0,0,0,.1)'}}>
        {/* Логотип */}
        <div style={{textAlign:'center',marginBottom:32}}>
          <div style={{width:60,height:60,background:`linear-gradient(135deg,${C.teal},${C.blue})`,borderRadius:16,display:'inline-flex',alignItems:'center',justifyContent:'center',marginBottom:12}}>
            <span style={{fontSize:28}}>🏥</span>
          </div>
          <h1 style={{margin:0,fontSize:22,fontWeight:700,color:C.navy}}>Личный кабинет</h1>
          <p style={{margin:'6px 0 0',fontSize:14,color:C.muted}}>Войдите по номеру телефона</p>
        </div>

        {step === 'phone' ? (
          <>
            <label style={{display:'block',fontSize:13,fontWeight:600,color:C.text,marginBottom:6}}>Номер телефона</label>
            <input
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="+7 (___) ___-__-__"
              style={{width:'100%',padding:'12px 14px',border:`1.5px solid #D1D5DB`,borderRadius:10,fontSize:15,outline:'none',boxSizing:'border-box'}}
              onKeyDown={e => e.key === 'Enter' && sendOtp()}
            />
            {error && <p style={{color:C.red,fontSize:13,margin:'8px 0 0'}}>{error}</p>}
            <button
              onClick={sendOtp}
              disabled={loading || !phone}
              style={{width:'100%',marginTop:16,padding:'13px',background:`linear-gradient(135deg,${C.teal},${C.blue})`,color:'#fff',border:'none',borderRadius:10,fontSize:15,fontWeight:600,cursor:'pointer',opacity:(loading||!phone)?0.6:1}}
            >
              {loading ? 'Отправка...' : 'Получить код'}
            </button>
          </>
        ) : (
          <>
            <p style={{fontSize:14,color:C.muted,marginBottom:16}}>
              Код отправлен на <b style={{color:C.text}}>{fmtPhone(phone)}</b>
            </p>
            {devCode && (
              <div style={{background:'#FEF3C7',border:'1px solid #F59E0B',borderRadius:8,padding:'8px 12px',marginBottom:12,fontSize:13,color:'#92400E'}}>
                Тестовый режим: код <b>{devCode}</b>
              </div>
            )}
            <label style={{display:'block',fontSize:13,fontWeight:600,color:C.text,marginBottom:6}}>Код подтверждения</label>
            <input
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g,'').slice(0,4))}
              placeholder="_ _ _ _"
              maxLength={4}
              style={{width:'100%',padding:'12px 14px',border:`1.5px solid #D1D5DB`,borderRadius:10,fontSize:22,letterSpacing:8,textAlign:'center',outline:'none',boxSizing:'border-box'}}
              onKeyDown={e => e.key === 'Enter' && verifyOtp()}
              autoFocus
            />
            {error && <p style={{color:C.red,fontSize:13,margin:'8px 0 0'}}>{error}</p>}
            <button
              onClick={verifyOtp}
              disabled={loading || code.length < 4}
              style={{width:'100%',marginTop:16,padding:'13px',background:`linear-gradient(135deg,${C.teal},${C.blue})`,color:'#fff',border:'none',borderRadius:10,fontSize:15,fontWeight:600,cursor:'pointer',opacity:(loading||code.length<4)?0.6:1}}
            >
              {loading ? 'Проверка...' : 'Войти'}
            </button>
            <div style={{textAlign:'center',marginTop:12}}>
              {timer > 0
                ? <span style={{fontSize:13,color:C.muted}}>Повторить через {timer} с</span>
                : <button onClick={()=>{setStep('phone');setCode('');setError('')}} style={{background:'none',border:'none',color:C.teal,fontSize:13,cursor:'pointer',fontWeight:600}}>← Изменить номер</button>
              }
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Компонент: Карточка записи ─────────────────────────────────────────────────
function AptCard({ item }) {
  const st = STATUS_LABEL[item.status] || { label: item.status, color: C.gray }
  const [open, setOpen] = useState(false)

  return (
    <div style={{background:C.card,borderRadius:14,padding:16,marginBottom:12,boxShadow:'0 2px 8px rgba(0,0,0,.06)',border:`1px solid #E5E7EB`}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
        <div>
          <div style={{fontWeight:600,fontSize:15,color:C.navy}}>{item.doctor_name || '—'}</div>
          <div style={{fontSize:13,color:C.muted,marginTop:2}}>{item.specialty}</div>
          <div style={{fontSize:13,color:C.text,marginTop:6}}>
            {item.type === 'appointment'
              ? `${fmtDate(item.appointment_date)}, ${item.start_time}–${item.end_time}`
              : fmtDate(item.created_at)
            }
          </div>
          <div style={{fontSize:12,color:C.muted}}>{item.clinic_name}</div>
        </div>
        <div>
          <span style={{fontSize:12,fontWeight:600,color:st.color,background:st.color+'18',padding:'3px 10px',borderRadius:20}}>{st.label}</span>
          {item.qr_code && (
            <button onClick={()=>setOpen(v=>!v)} style={{display:'block',marginTop:8,background:'none',border:`1px solid ${C.teal}`,color:C.teal,fontSize:11,borderRadius:8,padding:'3px 10px',cursor:'pointer'}}>
              {open ? 'Скрыть QR' : 'QR код'}
            </button>
          )}
        </div>
      </div>
      {open && item.qr_code && (
        <div style={{textAlign:'center',marginTop:12}}>
          <img src={item.qr_code} alt="QR" style={{width:140,height:140,borderRadius:8,border:`1px solid #E5E7EB`}}/>
          {item.short_code && <div style={{fontSize:13,color:C.muted,marginTop:4}}>Код: <b>{item.short_code}</b></div>}
        </div>
      )}
    </div>
  )
}

// ── Компонент: История ─────────────────────────────────────────────────────────
function HistoryTab({ token }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    axios.get(`${API}/portal/history`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [token])

  if (loading) return <Spinner />

  const all = [
    ...(data?.appointments || []),
    ...(data?.referrals || []),
  ].sort((a, b) => {
    const da = a.appointment_date || a.created_at || ''
    const db2 = b.appointment_date || b.created_at || ''
    return db2.localeCompare(da)
  })

  const upcoming = all.filter(i => {
    const s = i.status
    return s === 'scheduled' || s === 'confirmed' || s === 'created'
  })
  const past = all.filter(i => {
    const s = i.status
    return s !== 'scheduled' && s !== 'confirmed' && s !== 'created'
  })

  const shown = filter === 'upcoming' ? upcoming : filter === 'past' ? past : all

  return (
    <div>
      {/* Фильтр */}
      <div style={{display:'flex',gap:8,marginBottom:16}}>
        {[['all','Все'],['upcoming','Предстоящие'],['past','Прошедшие']].map(([k,l]) => (
          <button key={k} onClick={()=>setFilter(k)}
            style={{padding:'6px 14px',borderRadius:20,border:`1.5px solid ${filter===k?C.teal:'#E5E7EB'}`,background:filter===k?C.light:'transparent',color:filter===k?C.teal:C.muted,fontSize:13,fontWeight:filter===k?600:400,cursor:'pointer'}}>
            {l}
          </button>
        ))}
      </div>

      {shown.length === 0
        ? <div style={{textAlign:'center',padding:'40px 0',color:C.muted,fontSize:14}}>Записей нет</div>
        : shown.map(item => <AptCard key={item.id} item={item} />)
      }
    </div>
  )
}

// ── Компонент: Онлайн-запись ───────────────────────────────────────────────────
const DAYS_RU = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб']

function BookTab({ token, patientName, onBooked }) {
  const [step, setStep] = useState('doctors')
  const [doctors, setDoctors] = useState([])
  const [loading, setLoading] = useState(true)
  const [selDoc, setSelDoc] = useState(null)
  const [selDate, setSelDate] = useState(null)
  const [slots, setSlots] = useState([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [selSlot, setSelSlot] = useState(null)
  const [name, setName]     = useState(patientName || '')
  const [booking, setBooking] = useState(false)
  const [result, setResult]   = useState(null)
  const [error, setError]     = useState('')

  useEffect(() => {
    axios.get(`${API}/public/${SLUG}/doctors`)
      .then(r => setDoctors(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const dates = Array.from({length:14},(_,i)=>{ const d=new Date(); d.setDate(d.getDate()+i); return d })

  async function loadSlots(doc, date) {
    setSelDoc(doc); setSelDate(date); setSelSlot(null); setSlots([]); setSlotsLoading(true); setStep('slots')
    try {
      const r = await axios.get(`${API}/public/${SLUG}/doctors/${doc.id}/slots`, { params: { date: isoDate(date) } })
      setSlots(r.data)
    } catch { setSlots([]) }
    finally { setSlotsLoading(false) }
  }

  async function confirmBook() {
    setBooking(true); setError('')
    try {
      const r = await axios.post(`${API}/portal/book`, {
        slug: SLUG,
        doctor_id: selDoc.id,
        appointment_date: isoDate(selDate),
        start_time: selSlot,
        name,
      }, { headers: { Authorization: `Bearer ${token}` } })
      setResult(r.data)
      setStep('done')
      onBooked && onBooked()
    } catch(e) {
      setError(e.response?.data?.detail || 'Ошибка записи')
    } finally { setBooking(false) }
  }

  if (loading) return <Spinner />

  // Шаг 1: выбор врача
  if (step === 'doctors') return (
    <div>
      <h3 style={{margin:'0 0 16px',fontSize:16,color:C.navy}}>Выберите врача</h3>
      {doctors.length === 0
        ? <div style={{textAlign:'center',padding:'32px 0',color:C.muted}}>Нет доступных врачей</div>
        : doctors.map(doc => (
          <div key={doc.id} onClick={()=>{ setSelDoc(doc); setStep('date') }}
            style={{background:C.card,borderRadius:14,padding:16,marginBottom:10,cursor:'pointer',border:`1.5px solid #E5E7EB`,display:'flex',gap:14,alignItems:'center',transition:'border-color .2s'}}
            onMouseEnter={e=>e.currentTarget.style.borderColor=C.teal}
            onMouseLeave={e=>e.currentTarget.style.borderColor='#E5E7EB'}
          >
            <div style={{width:44,height:44,borderRadius:12,background:`linear-gradient(135deg,${C.teal},${C.blue})`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
              <span style={{color:'#fff',fontWeight:700,fontSize:16}}>{(doc.full_name||'?')[0]}</span>
            </div>
            <div>
              <div style={{fontWeight:600,color:C.navy,fontSize:14}}>{doc.full_name}</div>
              <div style={{fontSize:12,color:C.muted}}>{doc.specialty} · {doc.clinic_name}</div>
            </div>
          </div>
        ))
      }
    </div>
  )

  // Шаг 2: выбор даты
  if (step === 'date') return (
    <div>
      <button onClick={()=>setStep('doctors')} style={{background:'none',border:'none',color:C.teal,fontWeight:600,fontSize:13,cursor:'pointer',marginBottom:12,padding:0}}>← Назад</button>
      <h3 style={{margin:'0 0 4px',fontSize:16,color:C.navy}}>{selDoc?.full_name}</h3>
      <p style={{margin:'0 0 16px',fontSize:13,color:C.muted}}>Выберите дату</p>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8}}>
        {dates.map(d => (
          <button key={d.toISOString()} onClick={()=>loadSlots(selDoc, d)}
            style={{padding:'10px 4px',borderRadius:10,border:`1.5px solid #E5E7EB`,background:C.card,cursor:'pointer',textAlign:'center',fontSize:12,color:C.text}}>
            <div style={{fontWeight:600,color:C.navy}}>{d.getDate()} {MONTHS_RU[d.getMonth()]}</div>
            <div style={{color:C.muted,fontSize:11}}>{DAYS_RU[d.getDay()]}</div>
          </button>
        ))}
      </div>
    </div>
  )

  // Шаг 3: слоты
  if (step === 'slots') return (
    <div>
      <button onClick={()=>setStep('date')} style={{background:'none',border:'none',color:C.teal,fontWeight:600,fontSize:13,cursor:'pointer',marginBottom:12,padding:0}}>← Назад</button>
      <h3 style={{margin:'0 0 4px',fontSize:16,color:C.navy}}>{selDoc?.full_name}</h3>
      <p style={{margin:'0 0 16px',fontSize:13,color:C.muted}}>{selDate && `${fmtDate(selDate)}`}</p>
      {slotsLoading ? <Spinner /> : slots.length === 0
        ? <div style={{textAlign:'center',padding:'32px 0',color:C.muted}}>Нет свободных слотов</div>
        : (
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginBottom:20}}>
            {slots.map(s => (
              <button key={s.start_time} onClick={()=>setSelSlot(s.start_time)}
                style={{padding:'10px',borderRadius:10,border:`1.5px solid ${selSlot===s.start_time?C.teal:'#E5E7EB'}`,background:selSlot===s.start_time?C.light:C.card,color:selSlot===s.start_time?C.teal:C.text,fontWeight:selSlot===s.start_time?700:400,cursor:'pointer',fontSize:14}}>
                {s.start_time}
              </button>
            ))}
          </div>
        )
      }
      {selSlot && (
        <>
          <div style={{marginBottom:12}}>
            <label style={{fontSize:13,fontWeight:600,color:C.text,display:'block',marginBottom:4}}>Ваше имя</label>
            <input value={name} onChange={e=>setName(e.target.value)}
              placeholder="Иванов Иван"
              style={{width:'100%',padding:'11px 14px',border:`1.5px solid #D1D5DB`,borderRadius:10,fontSize:14,outline:'none',boxSizing:'border-box'}}/>
          </div>
          {error && <p style={{color:C.red,fontSize:13,marginBottom:8}}>{error}</p>}
          <button onClick={confirmBook} disabled={booking}
            style={{width:'100%',padding:'13px',background:`linear-gradient(135deg,${C.teal},${C.blue})`,color:'#fff',border:'none',borderRadius:10,fontSize:15,fontWeight:600,cursor:'pointer',opacity:booking?0.7:1}}>
            {booking ? 'Запись...' : `Записаться на ${selSlot}`}
          </button>
        </>
      )}
    </div>
  )

  // Шаг 4: успех
  if (step === 'done' && result) return (
    <div style={{textAlign:'center',padding:'24px 0'}}>
      <div style={{fontSize:48,marginBottom:12}}>✅</div>
      <h3 style={{margin:'0 0 8px',color:C.navy}}>Запись создана!</h3>
      <p style={{color:C.muted,fontSize:14,marginBottom:20}}>
        {result.doctor_name} · {fmtDate(result.appointment_date)}, {result.start_time}<br/>
        {result.clinic_name}
      </p>
      {result.qr_code && <img src={result.qr_code} alt="QR" style={{width:160,height:160,borderRadius:12,border:`1px solid #E5E7EB`,marginBottom:12}}/>}
      {result.short_code && <div style={{fontSize:14,color:C.muted,marginBottom:20}}>Код записи: <b style={{fontSize:18,color:C.navy}}>{result.short_code}</b></div>}
      <button onClick={()=>{ setStep('doctors'); setResult(null); setSelDoc(null); setSelDate(null); setSelSlot(null) }}
        style={{padding:'11px 24px',background:`linear-gradient(135deg,${C.teal},${C.blue})`,color:'#fff',border:'none',borderRadius:10,fontSize:14,fontWeight:600,cursor:'pointer'}}>
        Записаться ещё
      </button>
    </div>
  )

  return null
}

// ── Компонент: Профиль ─────────────────────────────────────────────────────────
function ProfileTab({ token, profile, onUpdate }) {
  const [name, setName]   = useState(profile.name || '')
  const [email, setEmail] = useState(profile.email || '')
  const [birth, setBirth] = useState(profile.birth_date || '')
  const [saving, setSaving] = useState(false)
  const [ok, setOk]       = useState(false)
  const [error, setError] = useState('')

  async function save() {
    setSaving(true); setOk(false); setError('')
    try {
      await axios.patch(`${API}/portal/me`,
        { name: name || null, email: email || null, birth_date: birth || null },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      setOk(true)
      onUpdate && onUpdate({ name, email, birth_date: birth })
    } catch(e) {
      setError(e.response?.data?.detail || 'Ошибка сохранения')
    } finally { setSaving(false) }
  }

  return (
    <div style={{maxWidth:400}}>
      <h3 style={{margin:'0 0 20px',fontSize:16,color:C.navy}}>Мой профиль</h3>
      <div style={{background:C.card,borderRadius:14,padding:20,boxShadow:'0 2px 8px rgba(0,0,0,.06)'}}>
        <div style={{marginBottom:4,fontSize:12,color:C.muted,fontWeight:600}}>ТЕЛЕФОН</div>
        <div style={{fontSize:15,color:C.text,marginBottom:16}}>{fmtPhone(profile.phone)}</div>

        {[['Имя','text',name,setName,'Иванов Иван'],['Email','email',email,setEmail,'ivan@example.com'],['Дата рождения','date',birth,setBirth,'']].map(([label,type,val,setter,ph]) => (
          <div key={label} style={{marginBottom:14}}>
            <label style={{display:'block',fontSize:13,fontWeight:600,color:C.text,marginBottom:5}}>{label}</label>
            <input type={type} value={val} onChange={e=>setter(e.target.value)} placeholder={ph}
              style={{width:'100%',padding:'10px 14px',border:`1.5px solid #D1D5DB`,borderRadius:10,fontSize:14,outline:'none',boxSizing:'border-box'}}/>
          </div>
        ))}

        {ok && <p style={{color:C.green,fontSize:13,margin:'0 0 10px'}}>✓ Сохранено</p>}
        {error && <p style={{color:C.red,fontSize:13,margin:'0 0 10px'}}>{error}</p>}
        <button onClick={save} disabled={saving}
          style={{width:'100%',padding:'12px',background:`linear-gradient(135deg,${C.teal},${C.blue})`,color:'#fff',border:'none',borderRadius:10,fontSize:14,fontWeight:600,cursor:'pointer',opacity:saving?0.7:1}}>
          {saving ? 'Сохранение...' : 'Сохранить'}
        </button>
      </div>

      <div style={{marginTop:20,textAlign:'center'}}>
        <button onClick={()=>{ localStorage.removeItem(STORAGE_KEY); window.location.reload() }}
          style={{background:'none',border:'none',color:C.gray,fontSize:13,cursor:'pointer',textDecoration:'underline'}}>
          Выйти из кабинета
        </button>
      </div>
    </div>
  )
}

// ── Главный компонент ──────────────────────────────────────────────────────────
export default function PatientPortal() {
  const [token, setToken]     = useState(() => localStorage.getItem(STORAGE_KEY))
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(!!localStorage.getItem(STORAGE_KEY))
  const [tab, setTab]         = useState('history')
  const [histKey, setHistKey] = useState(0)

  useEffect(() => {
    const style = document.createElement('style')
    style.textContent = `@keyframes spin{to{transform:rotate(360deg)}}`
    document.head.appendChild(style)
    return () => document.head.removeChild(style)
  }, [])

  useEffect(() => {
    if (!token) { setLoading(false); return }
    axios.get(`${API}/portal/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setProfile(r.data))
      .catch(() => { localStorage.removeItem(STORAGE_KEY); setToken(null) })
      .finally(() => setLoading(false))
  }, [token])

  function handleLogin(data) {
    setToken(data.access_token)
    setProfile({ phone: data.phone, name: data.name, email: data.email })
    setLoading(false)
  }

  if (!token || (!profile && !loading)) return <LoginView onLogin={handleLogin} />
  if (loading) return (
    <div style={{minHeight:'100vh',background:C.bg,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <Spinner />
    </div>
  )

  const TABS = [
    { id:'history', label:'Мои записи', icon:'📋' },
    { id:'book',    label:'Записаться', icon:'📅' },
    { id:'profile', label:'Профиль',    icon:'👤' },
  ]

  return (
    <div style={{minHeight:'100vh',background:C.bg,display:'flex',flexDirection:'column'}}>
      {/* Шапка */}
      <div style={{background:`linear-gradient(135deg,${C.navy},${C.blue})`,padding:'20px 20px 0',color:'#fff'}}>
        <div style={{maxWidth:500,margin:'0 auto'}}>
          <div style={{fontSize:13,opacity:.7,marginBottom:4}}>Личный кабинет пациента</div>
          <div style={{fontSize:18,fontWeight:700,marginBottom:20}}>
            {profile.name ? `Привет, ${profile.name.split(' ')[0]}!` : fmtPhone(profile.phone)}
          </div>
          {/* Табы */}
          <div style={{display:'flex',gap:0}}>
            {TABS.map(t => (
              <button key={t.id} onClick={()=>setTab(t.id)}
                style={{flex:1,padding:'10px 4px',background:'none',border:'none',borderBottom:`3px solid ${tab===t.id?'#fff':'transparent'}`,color:tab===t.id?'#fff':'rgba(255,255,255,.5)',fontSize:12,fontWeight:tab===t.id?600:400,cursor:'pointer',transition:'all .2s'}}>
                <span style={{display:'block',fontSize:18,marginBottom:2}}>{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Контент */}
      <div style={{flex:1,padding:16,maxWidth:500,margin:'0 auto',width:'100%',boxSizing:'border-box'}}>
        {tab === 'history' && <HistoryTab key={histKey} token={token} />}
        {tab === 'book' && <BookTab token={token} patientName={profile?.name} onBooked={()=>setHistKey(v=>v+1)} />}
        {tab === 'profile' && <ProfileTab token={token} profile={profile} onUpdate={p=>setProfile(prev=>({...prev,...p}))} />}
      </div>
    </div>
  )
}
