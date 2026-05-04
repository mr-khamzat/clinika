/**
 * Универсальный вход пациента — /portal
 * Телефон → поиск клиник → OTP → редирект на /{slug}/portal?token=...
 */
import { useState, useEffect } from 'react'
import axios from 'axios'

const API = '/api'
const primary = '#0097A7'

function fmtPhone(raw) {
  const d = (raw || '').replace(/\D/g, '')
  if (d.length === 11) return `+${d[0]} (${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7,9)}-${d.slice(9)}`
  if (d.length === 10) return `+7 (${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6,8)}-${d.slice(8)}`
  return raw
}

export default function UniversalPatientPortal() {
  const [step, setStep] = useState('phone') // phone | clinic | otp
  const [phone, setPhone] = useState('')
  const [clinics, setClinics] = useState([])
  const [slug, setSlug] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [devCode, setDevCode] = useState(null)
  const [timer, setTimer] = useState(0)

  useEffect(() => {
    if (timer > 0) {
      const t = setTimeout(() => setTimer(v => v - 1), 1000)
      return () => clearTimeout(t)
    }
  }, [timer])

  async function findClinics() {
    setErr(''); setLoading(true)
    try {
      const r = await axios.post(`${API}/portal/universal/find`, { phone })
      setDevCode(r.data.dev_code)
      setClinics(r.data.clinics)
      setTimer(60)
      if (r.data.clinics.length === 1) {
        setSlug(r.data.clinics[0].slug)
        setStep('otp')
      } else {
        setStep('clinic')
      }
    } catch (e) { setErr(e.response?.data?.detail || 'Ошибка. Проверьте номер телефона.') }
    finally { setLoading(false) }
  }

  async function verify() {
    setErr(''); setLoading(true)
    try {
      const r = await axios.post(`${API}/portal/universal/verify`, { phone, code, slug })
      window.location.href = `/${slug}/portal?token=${r.data.access_token}`
    } catch (e) { setErr(e.response?.data?.detail || 'Неверный код') }
    finally { setLoading(false) }
  }

  return (
    <div style={{ minHeight:'100vh', background:'#F5F8FF', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:16, fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif' }}>
      <div style={{ width:'100%', maxWidth:360 }}>
        <div style={{ textAlign:'center', marginBottom:32 }}>
          <div style={{ width:68, height:68, borderRadius:20, background:`linear-gradient(135deg,${primary},#1565C0)`, display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:36, marginBottom:12 }}>🏥</div>
          <h2 style={{ margin:'0 0 4px', fontSize:22, fontWeight:800, color:'#1A2B3C' }}>Личный кабинет</h2>
          <p style={{ margin:0, fontSize:14, color:'#9CA3AF' }}>Введите номер телефона для входа</p>
        </div>

        <div style={{ background:'#fff', borderRadius:20, padding:'28px 24px', boxShadow:'0 8px 40px rgba(0,0,0,.08)' }}>

          {step === 'phone' && (
            <>
              <label style={{ display:'block', fontSize:12, fontWeight:700, color:'#6B7280', textTransform:'uppercase', letterSpacing:.5, marginBottom:8 }}>Номер телефона</label>
              <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+7 (999) 000-00-00" autoFocus
                onKeyDown={e => e.key === 'Enter' && phone && findClinics()}
                style={{ width:'100%', padding:'14px', border:'1.5px solid #E5E7EB', borderRadius:12, fontSize:16, outline:'none', boxSizing:'border-box', color:'#1A2B3C' }} />
              {err && <p style={{ color:'#EF4444', fontSize:13, marginTop:8 }}>{err}</p>}
              <button onClick={findClinics} disabled={loading || !phone}
                style={{ width:'100%', marginTop:14, padding:'14px', background:`linear-gradient(135deg,${primary},#1565C0)`, color:'#fff', border:'none', borderRadius:12, fontSize:15, fontWeight:700, cursor:'pointer', opacity:(loading || !phone) ? 0.6 : 1 }}>
                {loading ? 'Поиск...' : 'Продолжить'}
              </button>
            </>
          )}

          {step === 'clinic' && (
            <>
              {clinics.length > 0 ? (
                <>
                  <p style={{ fontSize:14, color:'#6B7280', marginBottom:14, fontWeight:600 }}>Выберите клинику:</p>
                  {clinics.map(c => (
                    <button key={c.slug} onClick={() => { setSlug(c.slug); setStep('otp') }}
                      style={{ width:'100%', marginBottom:8, padding:'14px 16px', background:'#F9FAFB', border:'1.5px solid #E5E7EB', borderRadius:12, fontSize:14, fontWeight:600, color:'#1A2B3C', cursor:'pointer', textAlign:'left', display:'flex', alignItems:'center', gap:10 }}>
                      <span style={{ fontSize:22 }}>🏥</span>
                      <span>{c.name}</span>
                    </button>
                  ))}
                  {devCode && (
                    <div style={{ background:'#FEF3C7', border:'1px solid #F59E0B', borderRadius:10, padding:'8px 12px', marginTop:10, fontSize:13, color:'#92400E' }}>
                      Тестовый режим: код <b style={{ fontSize:16 }}>{devCode}</b>
                    </div>
                  )}
                </>
              ) : (
                <div style={{ textAlign:'center', padding:'16px 0' }}>
                  <div style={{ fontSize:44, marginBottom:10 }}>🤔</div>
                  <p style={{ fontWeight:700, color:'#1A2B3C', marginBottom:6, fontSize:16 }}>Клиника не найдена</p>
                  <p style={{ fontSize:13, color:'#6B7280', lineHeight:1.6 }}>
                    Номер телефона не связан ни с одной клиникой.<br/>Обратитесь в регистратуру вашей клиники.
                  </p>
                </div>
              )}
              <button onClick={() => { setStep('phone'); setErr(''); setCode(''); setDevCode(null) }}
                style={{ width:'100%', marginTop:14, padding:'11px', background:'none', border:'1.5px solid #EAECF0', borderRadius:12, fontSize:14, color:'#9CA3AF', cursor:'pointer' }}>
                ← Изменить номер
              </button>
            </>
          )}

          {step === 'otp' && (
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
              <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g,'').slice(0,4))} placeholder="• • • •" maxLength={4} autoFocus
                onKeyDown={e => e.key === 'Enter' && code.length === 4 && verify()}
                style={{ width:'100%', padding:'14px', border:'1.5px solid #E5E7EB', borderRadius:12, fontSize:26, letterSpacing:10, textAlign:'center', outline:'none', boxSizing:'border-box', color:'#1A2B3C' }} />
              {err && <p style={{ color:'#EF4444', fontSize:13, marginTop:8 }}>{err}</p>}
              <button onClick={verify} disabled={loading || code.length < 4}
                style={{ width:'100%', marginTop:14, padding:'14px', background:`linear-gradient(135deg,${primary},#1565C0)`, color:'#fff', border:'none', borderRadius:12, fontSize:15, fontWeight:700, cursor:'pointer', opacity:(loading || code.length < 4) ? 0.6 : 1 }}>
                {loading ? 'Проверка...' : 'Войти'}
              </button>
              <div style={{ textAlign:'center', marginTop:12 }}>
                {timer > 0
                  ? <span style={{ fontSize:13, color:'#9CA3AF' }}>Повторить через {timer} с</span>
                  : <button onClick={() => { setStep('phone'); setCode(''); setErr(''); setDevCode(null) }} style={{ background:'none', border:'none', color:primary, fontSize:13, cursor:'pointer', fontWeight:600 }}>← Изменить номер</button>
                }
              </div>
            </>
          )}
        </div>

        <p style={{ textAlign:'center', fontSize:12, color:'#C4C9D4', marginTop:20 }}>
          КлиникСеть — единый вход для пациентов всех клиник
        </p>
      </div>
    </div>
  )
}
