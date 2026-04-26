/**
 * Приезжие врачи — управление из панели менеджера
 * /manager/recruit-doctors
 */
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import useAuthStore from '../store/auth'
import { API_BASE } from '../config'

const P  = '#0097A7'
const D  = '#004D5F'
const BG = '#F0F5F6'

function apiFetch(token, path, opts = {}) {
  return fetch(API_BASE + path, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  })
}

// ─── QR-попап ────────────────────────────────────────────────
function QRPopup({ data, onClose }) {
  const [copied, setCopied] = useState('')
  const copy = (v, k) => { navigator.clipboard.writeText(v); setCopied(k); setTimeout(() => setCopied(''), 2000) }
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div style={{ background:'#fff', borderRadius:20, padding:24, maxWidth:380, width:'100%' }}>
        <div style={{ fontWeight:700, fontSize:16, color:D, marginBottom:4 }}>✅ {data.message}</div>
        <div style={{ textAlign:'center', margin:'16px 0' }}>
          <img src={`data:image/png;base64,${data.qr_code}`} alt="QR"
            style={{ width:160, height:160, borderRadius:10, border:`2px solid #e0eaec` }} />
          <div style={{ fontSize:12, color:'#607d8b', marginTop:6 }}>QR для входа в кабинет</div>
        </div>
        <div style={{ background:'#f0f9fa', borderRadius:10, padding:'12px 14px', marginBottom:14 }}>
          {[
            { label:'Логин',  value: data.credentials?.username, k:'u' },
            { label:'Пароль', value: data.credentials?.password,  k:'p' },
            { label:'Ссылка', value: data.credentials?.login_url, k:'l' },
          ].map(r => r.value ? (
            <div key={r.k} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
              <div>
                <div style={{ fontSize:10, color:'#90a4ae', textTransform:'uppercase', fontWeight:600 }}>{r.label}</div>
                <div style={{ fontSize:13, fontWeight:600, color:D, wordBreak:'break-all' }}>{r.value}</div>
              </div>
              <button onClick={() => copy(r.value, r.k)}
                style={{ background: copied===r.k?'#e0f7fa':'#fff', border:'1px solid #b2dfdb', borderRadius:8, padding:'3px 8px', fontSize:12, color:P, cursor:'pointer', marginLeft:8 }}>
                {copied===r.k ? '✓' : '📋'}
              </button>
            </div>
          ) : null)}
        </div>
        <button onClick={onClose} style={{ width:'100%', background:P, color:'#fff', border:'none', borderRadius:10, padding:'10px 0', fontWeight:700, cursor:'pointer' }}>
          Закрыть
        </button>
      </div>
    </div>
  )
}

// ─── Смена данных ─────────────────────────────────────────────
function ResetModal({ doctor, token, onClose, onDone }) {
  const [form, setForm] = useState({ username: doctor.username||'', password:'' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const submit = async () => {
    if (!form.username.trim() && !form.password.trim()) { setError('Заполните логин или пароль'); return }
    setLoading(true); setError('')
    try {
      const r = await apiFetch(token, `/manager/recruiter-doctors/${doctor.id}/reset-credentials`, {
        method:'POST', body: JSON.stringify({ username: form.username||null, password: form.password||null }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.detail||'Ошибка')
      onDone(data)
    } catch(e) { setError(e.message) }
    setLoading(false)
  }
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div style={{ background:'#fff', borderRadius:20, padding:24, maxWidth:380, width:'100%' }}>
        <div style={{ fontWeight:700, fontSize:16, color:D, marginBottom:4 }}>🔑 Сменить данные входа</div>
        <div style={{ fontSize:13, color:'#607d8b', marginBottom:16 }}>{doctor.full_name}</div>
        {error && <div style={{ background:'#ffeaea', border:'1px solid #ffcdd2', borderRadius:8, padding:'8px 12px', fontSize:13, color:'#c62828', marginBottom:12 }}>{error}</div>}
        {[
          { label:'Новый логин',  key:'username', placeholder: doctor.username||'' },
          { label:'Новый пароль', key:'password', placeholder:'Оставьте пустым, чтобы не менять' },
        ].map(f => (
          <div key={f.key} style={{ marginBottom:12 }}>
            <label style={{ display:'block', fontSize:11, fontWeight:600, color:'#607d8b', marginBottom:6, textTransform:'uppercase' }}>{f.label}</label>
            <input value={form[f.key]} onChange={e => setForm(p=>({...p,[f.key]:e.target.value}))} placeholder={f.placeholder}
              style={{ width:'100%', border:'1.5px solid #cdd8da', borderRadius:8, padding:'9px 12px', fontSize:14, outline:'none', boxSizing:'border-box' }} />
          </div>
        ))}
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={submit} disabled={loading}
            style={{ flex:1, background: loading?'#b2dfdb':P, color:'#fff', border:'none', borderRadius:10, padding:'10px 0', fontWeight:700, cursor: loading?'not-allowed':'pointer' }}>
            {loading?'...':'Сохранить'}
          </button>
          <button onClick={onClose}
            style={{ flex:1, background:'#f0f5f6', color:D, border:'1px solid #e0eaec', borderRadius:10, padding:'10px 0', fontWeight:600, cursor:'pointer' }}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Форма добавления ─────────────────────────────────────────
function AddModal({ token, clinics, onClose, onDone }) {
  const [form, setForm] = useState({
    full_name:'', phone_number:'', email:'', specialization:'', address:'',
    username:'', password:'', clinic_ids:[],
    price_per_visit:'', doctor_percent:'70',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const set = (k,v) => setForm(p=>({...p,[k]:v}))
  const toggle = id => set('clinic_ids', form.clinic_ids.includes(id) ? form.clinic_ids.filter(x=>x!==id) : [...form.clinic_ids,id])

  const submit = async () => {
    if (!form.full_name.trim())   { setError('Введите ФИО'); return }
    if (!form.username.trim())    { setError('Введите логин'); return }
    if (!form.password.trim())    { setError('Введите пароль'); return }
    setLoading(true); setError('')
    try {
      const r = await apiFetch(token, '/manager/register-external-doctor', {
        method:'POST', body: JSON.stringify({
          ...form,
          doctor_type: 'visiting',
          price_per_visit: form.price_per_visit ? parseFloat(form.price_per_visit) : null,
          doctor_percent:  form.doctor_percent  ? parseFloat(form.doctor_percent)  : 70,
        }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.detail||'Ошибка')
      onDone(data)
    } catch(e) { setError(e.message) }
    setLoading(false)
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16, overflowY:'auto' }}>
      <div style={{ background:'#fff', borderRadius:20, padding:24, maxWidth:440, width:'100%', maxHeight:'90vh', overflowY:'auto' }}>
        <div style={{ fontWeight:700, fontSize:17, color:D, marginBottom:16 }}>Добавить приезжего врача</div>
        {error && <div style={{ background:'#ffeaea', border:'1px solid #ffcdd2', borderRadius:8, padding:'8px 12px', fontSize:13, color:'#c62828', marginBottom:12 }}>{error}</div>}

        {[
          { label:'ФИО *',           key:'full_name',      ph:'Иванов Иван Иванович' },
          { label:'Телефон',          key:'phone_number',   ph:'+7 900 000 00 00' },
          { label:'Email',            key:'email',          ph:'doctor@mail.ru' },
          { label:'Специализация',    key:'specialization', ph:'Хирург, терапевт...' },
          { label:'Адрес/Организация',key:'address',        ph:'Место работы' },
          { label:'Логин *',          key:'username',       ph:'doc_login' },
          { label:'Пароль *',         key:'password',       ph:'Минимум 4 символа' },
        ].map(f => (
          <div key={f.key} style={{ marginBottom:12 }}>
            <label style={{ display:'block', fontSize:11, fontWeight:600, color:'#607d8b', marginBottom:5, textTransform:'uppercase' }}>{f.label}</label>
            <input value={form[f.key]} onChange={e => set(f.key, e.target.value)} placeholder={f.ph}
              style={{ width:'100%', border:'1.5px solid #cdd8da', borderRadius:8, padding:'9px 12px', fontSize:14, outline:'none', boxSizing:'border-box' }} />
          </div>
        ))}

        {/* Условия работы */}
        <div style={{ background:'#f0f9fa', borderRadius:10, padding:'12px 14px', marginBottom:12 }}>
          <div style={{ fontSize:12, fontWeight:700, color:D, marginBottom:10 }}>Условия работы</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            {[
              { label:'Цена за приём ₽', key:'price_per_visit', ph:'3000' },
              { label:'Доля врача %',    key:'doctor_percent',  ph:'70' },
            ].map(f => (
              <div key={f.key}>
                <label style={{ display:'block', fontSize:11, fontWeight:600, color:'#607d8b', marginBottom:5, textTransform:'uppercase' }}>{f.label}</label>
                <input type="number" value={form[f.key]} onChange={e => set(f.key, e.target.value)} placeholder={f.ph}
                  style={{ width:'100%', border:'1.5px solid #cdd8da', borderRadius:8, padding:'9px 10px', fontSize:14, outline:'none', boxSizing:'border-box' }} />
              </div>
            ))}
          </div>
          {form.price_per_visit && form.doctor_percent && (
            <div style={{ marginTop:8, fontSize:13, color:'#2e7d32', fontWeight:600 }}>
              Врач получит: {Math.round(parseFloat(form.price_per_visit)*parseFloat(form.doctor_percent)/100).toLocaleString('ru')} ₽ за приём
            </div>
          )}
        </div>

        {/* Клиники */}
        {clinics.length > 0 && (
          <div style={{ marginBottom:16 }}>
            <label style={{ display:'block', fontSize:11, fontWeight:700, color:'#607d8b', marginBottom:8, textTransform:'uppercase' }}>Клиники доступа</label>
            <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
              {clinics.map(c => (
                <button key={c.id} onClick={() => toggle(c.id)}
                  style={{ padding:'5px 12px', borderRadius:20, border:`1.5px solid ${form.clinic_ids.includes(c.id)?P:'#e0eaec'}`, background: form.clinic_ids.includes(c.id)?'#e0f7fa':'#fff', color: form.clinic_ids.includes(c.id)?D:'#607d8b', fontSize:12, fontWeight:600, cursor:'pointer' }}>
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ display:'flex', gap:8 }}>
          <button onClick={submit} disabled={loading}
            style={{ flex:1, background: loading?'#b2dfdb':P, color:'#fff', border:'none', borderRadius:10, padding:'11px 0', fontWeight:700, fontSize:14, cursor: loading?'not-allowed':'pointer' }}>
            {loading ? '...' : 'Зарегистрировать'}
          </button>
          <button onClick={onClose}
            style={{ flex:1, background:'#f0f5f6', color:D, border:'1px solid #e0eaec', borderRadius:10, padding:'11px 0', fontWeight:600, fontSize:14, cursor:'pointer' }}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Главный компонент ────────────────────────────────────────
export default function ManagerRecruitDoctors() {
  const { token } = useAuthStore()
  const nav = useNavigate()
  const [doctors, setDoctors]   = useState([])
  const [clinics, setClinics]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [showAdd, setShowAdd]   = useState(false)
  const [resetDoc, setResetDoc] = useState(null)
  const [qrResult, setQrResult] = useState(null)
  const [toggling, setToggling] = useState(null)

  const load = () => {
    setLoading(true)
    apiFetch(token, '/manager/all-external-doctors').then(r=>r.json())
      .then(d => { setDoctors(Array.isArray(d)?d:[]); setLoading(false) })
      .catch(() => setLoading(false))
  }

  useEffect(() => {
    load()
    apiFetch(token, '/manager/clinics/').then(r=>r.json()).then(d => setClinics(Array.isArray(d)?d:[])).catch(()=>{})
  }, [token])

  const toggleActive = async (doc) => {
    setToggling(doc.id)
    await apiFetch(token, `/manager/recruiter-doctors/${doc.id}/toggle-active`, { method:'PATCH' })
    load()
    setToggling(null)
  }

  const filtered = doctors.filter(d => {
    if (!search) return true
    const q = search.toLowerCase()
    return [d.full_name, d.username, d.specialization, d.phone_number].some(v => v && v.toLowerCase().includes(q))
  })

  return (
    <div style={{ minHeight:'100vh', background:BG, fontFamily:"'Inter',sans-serif" }}>
      {resetDoc  && <ResetModal  doctor={resetDoc} token={token} onClose={()=>setResetDoc(null)}  onDone={d=>{setQrResult(d);setResetDoc(null);load()}} />}
      {qrResult  && <QRPopup    data={qrResult}   onClose={()=>setQrResult(null)} />}
      {showAdd   && <AddModal   token={token} clinics={clinics} onClose={()=>setShowAdd(false)} onDone={d=>{setQrResult(d);setShowAdd(false);load()}} />}

      {/* Шапка */}
      <div style={{ background:D, padding:'14px 16px', position:'sticky', top:0, zIndex:50 }}>
        <div style={{ maxWidth:860, margin:'0 auto', display:'flex', alignItems:'center', gap:12 }}>
          <button onClick={()=>nav('/manager')} style={{ background:'rgba(255,255,255,0.12)', border:'none', borderRadius:8, padding:'6px 10px', color:'#fff', cursor:'pointer', fontSize:13 }}>
            ← Назад
          </button>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:15, fontWeight:700, color:'#fff' }}>Приезжие врачи</div>
            <div style={{ fontSize:11, color:'#80cfd6' }}>{doctors.length} врачей зарегистрировано</div>
          </div>
          <button onClick={()=>setShowAdd(true)}
            style={{ background:P, border:'none', borderRadius:10, padding:'8px 14px', color:'#fff', fontWeight:700, fontSize:13, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
            <span className="material-symbols-outlined" style={{ fontSize:16 }}>person_add</span>
            Добавить
          </button>
        </div>
      </div>

      <div style={{ maxWidth:860, margin:'0 auto', padding:'16px' }}>
        {/* Поиск */}
        <div style={{ background:'#fff', borderRadius:12, border:'1px solid #e0eaec', padding:'10px 14px', marginBottom:14, display:'flex', gap:8, alignItems:'center' }}>
          <span className="material-symbols-outlined" style={{ color:'#90a4ae', fontSize:18 }}>search</span>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Поиск по имени, логину, специализации..."
            style={{ flex:1, border:'none', outline:'none', fontSize:14, color:'#1a2332', background:'transparent' }} />
          {search && <button onClick={()=>setSearch('')} style={{ background:'none', border:'none', color:'#90a4ae', cursor:'pointer', fontSize:18 }}>✕</button>}
        </div>

        {loading ? (
          <div style={{ display:'flex', justifyContent:'center', padding:48 }}>
            <div style={{ width:32, height:32, border:`3px solid ${P}`, borderTopColor:'transparent', borderRadius:'50%', animation:'spin .7s linear infinite' }} />
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign:'center', padding:'48px 16px', color:'#90a4ae' }}>
            <span className="material-symbols-outlined" style={{ fontSize:48, display:'block', marginBottom:12 }}>group_off</span>
            <div style={{ fontSize:15, fontWeight:600 }}>{search ? 'Ничего не найдено' : 'Нет приезжих врачей'}</div>
            {!search && (
              <button onClick={()=>setShowAdd(true)} style={{ marginTop:16, background:P, color:'#fff', border:'none', borderRadius:10, padding:'10px 20px', fontWeight:700, cursor:'pointer' }}>
                Добавить первого врача
              </button>
            )}
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {filtered.map(doc => (
              <div key={doc.id} style={{ background:'#fff', borderRadius:14, border:`1px solid ${doc.is_active?'#e0eaec':'#ffd7d7'}`, padding:'14px 16px', opacity: doc.is_active?1:0.75 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:8, marginBottom:10 }}>
                  <div>
                    <div style={{ fontWeight:700, fontSize:15, color:D }}>{doc.full_name}</div>
                    {doc.specialization && <div style={{ fontSize:12, color:P, marginTop:2, fontWeight:500 }}>{doc.specialization}</div>}
                  </div>
                  <span style={{ fontSize:11, fontWeight:700, padding:'3px 10px', borderRadius:20, background: doc.is_active?'#e0f7fa':'#ffeaea', color: doc.is_active?P:'#c62828' }}>
                    {doc.is_active ? 'Активен' : 'Заблокирован'}
                  </span>
                </div>

                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(170px, 1fr))', gap:6, marginBottom:10 }}>
                  {[
                    { label:'Логин',   value: doc.username,     mono:true },
                    { label:'Телефон', value: doc.phone_number },
                    { label:'Email',   value: doc.email },
                    { label:'Адрес',   value: doc.address },
                  ].filter(f=>f.value).map(f => (
                    <div key={f.label} style={{ background:'#f0f9fa', borderRadius:8, padding:'6px 10px' }}>
                      <div style={{ fontSize:10, color:'#90a4ae', textTransform:'uppercase', fontWeight:600 }}>{f.label}</div>
                      <div style={{ fontSize:13, color: f.mono?D:'#1a2332', fontFamily: f.mono?'monospace':'inherit', fontWeight: f.mono?600:400, wordBreak:'break-all' }}>{f.value}</div>
                    </div>
                  ))}
                </div>

                {doc.clinics?.length > 0 && (
                  <div style={{ display:'flex', flexWrap:'wrap', gap:5, marginBottom:10 }}>
                    {doc.clinics.map(c => (
                      <span key={c.id} style={{ fontSize:11, background:'#e0f7fa', color:D, padding:'2px 10px', borderRadius:20, fontWeight:600 }}>{c.name}</span>
                    ))}
                  </div>
                )}

                <div style={{ display:'flex', gap:8, flexWrap:'wrap', paddingTop:10, borderTop:'1px solid #f0f5f6', alignItems:'center' }}>
                  <button onClick={()=>setResetDoc(doc)}
                    style={{ background:'#f0f9fa', border:'1px solid #b2dfdb', borderRadius:8, padding:'6px 12px', fontSize:12, fontWeight:600, color:P, cursor:'pointer' }}>
                    🔑 Сменить данные
                  </button>
                  <button onClick={()=>toggleActive(doc)} disabled={toggling===doc.id}
                    style={{ background: doc.is_active?'#fff3f3':'#f0f9fa', border:`1px solid ${doc.is_active?'#ffcdd2':'#b2dfdb'}`, borderRadius:8, padding:'6px 12px', fontSize:12, fontWeight:600, color: doc.is_active?'#c62828':P, cursor: toggling===doc.id?'not-allowed':'pointer' }}>
                    {toggling===doc.id ? '...' : doc.is_active ? '🚫 Заблокировать' : '✓ Активировать'}
                  </button>
                  <div style={{ marginLeft:'auto', fontSize:11, color:'#b0bec5' }}>{new Date(doc.created_at).toLocaleDateString('ru')}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
