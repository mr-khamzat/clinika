/**
 * Кабинет рекрутера v2 — стиль КлиникСеть
 * Прямая регистрация врачей, % настройки, QR
 */
import { useState, useEffect, useCallback } from 'react'
import { API_BASE } from '../config'

const PRIMARY = '#0097A7'
const DARK    = '#004D5F'
const BG      = '#F0F5F6'

function apiFetch(token, path, opts = {}) {
  return fetch(API_BASE + path, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  })
}

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
      <div style={{ width: 28, height: 28, border: `3px solid ${PRIMARY}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

function StatCard({ label, value, icon, color = PRIMARY }) {
  return (
    <div style={{ background: '#fff', borderRadius: 14, padding: '14px 16px', border: '1px solid #e0eaec', flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 18, color, fontVariationSettings: "'FILL' 1" }}>{icon}</span>
        <span style={{ fontSize: 11, color: '#607d8b', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: DARK, lineHeight: 1 }}>{value ?? '—'}</div>
    </div>
  )
}

// ── QR Popup ─────────────────────────────────────────────────────────────────
function QRPopup({ data, onClose }) {
  const [copied, setCopied] = useState('')
  const copy = (text, key) => { navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(''), 2000) }

  const printQR = () => {
    const w = window.open('', '_blank', 'width=500,height=700')
    if (!w) return
    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>QR — ${data.doctor.full_name}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;margin:0;padding:24px;background:#fff;color:#1a2332;text-align:center}
.logo{color:#0097A7;font-size:18px;font-weight:800;margin-bottom:4px}
.name{font-size:20px;font-weight:700;color:#004D5F;margin:16px 0 4px}
.spec{font-size:13px;color:#607d8b;margin-bottom:16px}
img{width:200px;height:200px;border-radius:12px;border:2px solid #e0eaec}
.cred{background:#f0f9fa;border:1px solid #b2dfdb;border-radius:10px;padding:14px;margin:16px 0;text-align:left}
.cred-row{display:flex;justify-content:space-between;margin:6px 0;font-size:13px}
.cred-label{color:#607d8b}.cred-val{font-weight:700;color:#004D5F}
.hint{font-size:11px;color:#90a4ae;margin-top:12px}
@media print{body{background:white;-webkit-print-color-adjust:exact}}
</style></head><body>
<div class="logo">КлиникСеть</div>
<div class="name">${data.doctor.full_name}</div>
<div class="spec">${data.doctor.specialization || ''}</div>
<img src="data:image/png;base64,${data.qr_code}" alt="QR">
<div style="font-size:12px;color:#607d8b;margin-top:8px">Отсканируй QR для перехода на страницу входа</div>
<div class="cred">
  <div class="cred-row"><span class="cred-label">Логин:</span><span class="cred-val">${data.credentials.username}</span></div>
  <div class="cred-row"><span class="cred-label">Пароль:</span><span class="cred-val">${data.credentials.password}</span></div>
  <div class="cred-row"><span class="cred-label">Сайт:</span><span class="cred-val">${data.credentials.login_url}</span></div>
</div>
<div class="hint">⚠️ Логин и пароль меняются только через администратора</div>
</body></html>`)
    w.document.close()
    setTimeout(() => w.print(), 400)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,77,95,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 20, padding: '20px', maxWidth: 400, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: DARK }}>✅ Врач зарегистрирован</div>
            <div style={{ fontSize: 12, color: '#607d8b' }}>{data.doctor.full_name}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: '#90a4ae', cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ textAlign: 'center', marginBottom: 14 }}>
          <img src={`data:image/png;base64,${data.qr_code}`} alt="QR"
            style={{ width: 170, height: 170, borderRadius: 12, border: '2px solid #e0eaec' }} />
          <div style={{ fontSize: 11, color: '#607d8b', marginTop: 6 }}>Врач сканирует QR → страница входа</div>
        </div>
        <div style={{ background: '#f0f9fa', border: '1px solid #b2dfdb', borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#607d8b', textTransform: 'uppercase', marginBottom: 8 }}>Данные для входа</div>
          {[
            { label: 'Логин', value: data.credentials.username, key: 'login' },
            { label: 'Пароль', value: data.credentials.password, key: 'pass' },
            { label: 'Ссылка', value: data.credentials.login_url, key: 'url' },
          ].map(row => (
            <div key={row.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div>
                <div style={{ fontSize: 10, color: '#90a4ae' }}>{row.label}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: DARK, wordBreak: 'break-all' }}>{row.value}</div>
              </div>
              <button onClick={() => copy(row.value, row.key)} style={{ background: copied === row.key ? '#e0f7fa' : '#fff', border: '1px solid #b2dfdb', borderRadius: 7, padding: '3px 8px', fontSize: 12, color: PRIMARY, cursor: 'pointer', marginLeft: 8 }}>
                {copied === row.key ? '✓' : '📋'}
              </button>
            </div>
          ))}
        </div>
        <div style={{ background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 8, padding: '8px 12px', fontSize: 11, color: '#795548', marginBottom: 12 }}>
          ⚠️ Логин и пароль можно изменить только через панель администратора
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={printQR} style={{ flex: 1, background: PRIMARY, color: '#fff', border: 'none', borderRadius: 10, padding: '10px 0', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            🖨 Распечатать QR
          </button>
          <button onClick={onClose} style={{ flex: 1, background: '#f0f5f6', color: DARK, border: '1px solid #e0eaec', borderRadius: 10, padding: '10px 0', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Главная ───────────────────────────────────────────────────────────────────
function DashboardTab({ stats, onNavigate }) {
  if (!stats) return (
    <div style={{ textAlign: 'center', padding: '40px 16px', color: '#90a4ae' }}>
      <div style={{ width: 28, height: 28, border: `3px solid ${PRIMARY}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite', margin: '0 auto 12px' }} />
      <div style={{ fontSize: 13 }}>Загрузка данных...</div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  const isEmpty = !stats.doctors_count && !stats.total_bonuses

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
        <StatCard label="Привлечено врачей" value={stats.doctors_count ?? 0} icon="groups" color={PRIMARY} />
        <StatCard label="Мой %" value={(stats.my_percent ?? 0) + '%'} icon="percent" color="#43a047" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
        <StatCard label="Всего бонусов" value={Number(stats.total_bonuses || 0).toLocaleString('ru') + ' ₽'} icon="payments" color="#f59e0b" />
        <StatCard label="К выплате" value={Number(stats.pending_bonuses || 0).toLocaleString('ru') + ' ₽'} icon="account_balance_wallet" color="#ef5350" />
      </div>

      {isEmpty && (
        <div style={{ background: '#e0f7fa', borderRadius: 12, padding: '14px 16px', marginBottom: 16, fontSize: 13, color: DARK }}>
          👋 Добро пожаловать! Зарегистрируйте первого врача во вкладке «Регистрация»
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <button onClick={() => onNavigate('register')} style={{
          background: `linear-gradient(135deg, ${PRIMARY}, ${DARK})`, color: '#fff',
          border: 'none', borderRadius: 14, padding: '16px 8px', cursor: 'pointer', fontWeight: 700, fontSize: 13,
        }}>
          <span className="material-symbols-outlined" style={{ display: 'block', fontSize: 26, marginBottom: 6, fontVariationSettings: "'FILL' 1" }}>person_add</span>
          Зарегистрировать врача
        </button>
        <button onClick={() => onNavigate('doctors')} style={{
          background: '#fff', color: DARK, border: '1px solid #e0eaec',
          borderRadius: 14, padding: '16px 8px', cursor: 'pointer', fontWeight: 600, fontSize: 13,
        }}>
          <span className="material-symbols-outlined" style={{ display: 'block', fontSize: 26, marginBottom: 6, color: PRIMARY, fontVariationSettings: "'FILL' 1" }}>group</span>
          Мои врачи
        </button>
      </div>
    </div>
  )
}

// ── Регистрация врача ─────────────────────────────────────────────────────────
function RegisterTab({ token }) {
  const [clinics, setClinics] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [form, setForm] = useState({ full_name: '', email: '', phone_number: '', address: '', specialization: '', username: '', password: '', clinic_ids: [] })

  useEffect(() => {
    apiFetch(token, '/clinics/').then(r => r.json()).then(d => setClinics(Array.isArray(d) ? d : [])).catch(() => {})
  }, [token])

  const f = key => e => setForm(p => ({ ...p, [key]: e.target.value }))
  const toggleClinic = id => setForm(p => ({ ...p, clinic_ids: p.clinic_ids.includes(id) ? p.clinic_ids.filter(c => c !== id) : [...p.clinic_ids, id] }))

  const submit = async e => {
    e.preventDefault()
    if (!form.full_name.trim()) { setError('Введите ФИО врача'); return }
    if (!form.username.trim()) { setError('Введите логин'); return }
    if (!form.password.trim() || form.password.length < 4) { setError('Пароль минимум 4 символа'); return }
    setLoading(true); setError('')
    try {
      const r = await apiFetch(token, '/recruiter/register_doctor', { method: 'POST', body: JSON.stringify(form) })
      const data = await r.json()
      if (!r.ok) throw new Error(data.detail || 'Ошибка регистрации')
      setResult(data)
      setForm({ full_name: '', email: '', phone_number: '', address: '', specialization: '', username: '', password: '', clinic_ids: [] })
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  const inp = { width: '100%', border: '1.5px solid #cdd8da', borderRadius: 10, padding: '10px 12px', fontSize: 14, outline: 'none', background: '#fff', boxSizing: 'border-box', color: '#1a2332' }
  const lbl = { display: 'block', fontSize: 11, fontWeight: 700, color: '#546e7a', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.04em' }
  const section = { background: '#fff', borderRadius: 14, border: '1px solid #e0eaec', padding: '16px', marginBottom: 10 }
  const sectionTitle = { fontSize: 13, fontWeight: 700, color: DARK, marginBottom: 12, borderBottom: '1px solid #f0f5f6', paddingBottom: 8 }

  return (
    <div>
      {result && <QRPopup data={result} onClose={() => setResult(null)} />}
      {error && (
        <div style={{ background: '#ffeaea', border: '1px solid #ffcdd2', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#c62828', display: 'flex', justifyContent: 'space-between' }}>
          {error}
          <button onClick={() => setError('')} style={{ background: 'none', border: 'none', color: '#c62828', cursor: 'pointer', fontWeight: 700, padding: 0 }}>✕</button>
        </div>
      )}
      <form onSubmit={submit}>
        <div style={section}>
          <div style={sectionTitle}>👤 Данные врача</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div><label style={lbl}>ФИО *</label><input value={form.full_name} onChange={f('full_name')} required placeholder="Иванов Иван Иванович" style={inp} /></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div><label style={lbl}>Email</label><input type="email" value={form.email} onChange={f('email')} placeholder="doctor@mail.ru" style={inp} /></div>
              <div><label style={lbl}>Телефон</label><input value={form.phone_number} onChange={f('phone_number')} placeholder="+7..." style={inp} /></div>
            </div>
            <div><label style={lbl}>Специализация</label><input value={form.specialization} onChange={f('specialization')} placeholder="Терапевт, хирург..." style={inp} /></div>
            <div><label style={lbl}>Адрес работы</label><input value={form.address} onChange={f('address')} placeholder="г. Грозный, ул. Примерная, д. 1" style={inp} /></div>
          </div>
        </div>

        <div style={section}>
          <div style={sectionTitle}>🔑 Данные для входа</div>
          <div style={{ background: '#fff8e1', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#795548' }}>
            Передайте эти данные врачу лично. Изменить можно только через панель администратора.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div><label style={lbl}>Логин *</label><input value={form.username} onChange={f('username')} required placeholder="dr_ivanov" style={inp} /></div>
            <div><label style={lbl}>Пароль *</label><input value={form.password} onChange={f('password')} required placeholder="минимум 4 символа" style={inp} /></div>
          </div>
        </div>

        {clinics.length > 0 && (
          <div style={section}>
            <div style={sectionTitle}>🏥 Доступ к клиникам</div>
            {clinics.map(c => (
              <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '8px 10px', borderRadius: 8, marginBottom: 6, background: form.clinic_ids.includes(c.id) ? '#e0f7fa' : '#fafbfc', border: `1px solid ${form.clinic_ids.includes(c.id) ? PRIMARY : '#e0eaec'}` }}>
                <input type="checkbox" checked={form.clinic_ids.includes(c.id)} onChange={() => toggleClinic(c.id)} style={{ accentColor: PRIMARY, width: 16, height: 16 }} />
                <span style={{ fontSize: 14, color: '#1a2332', fontWeight: form.clinic_ids.includes(c.id) ? 600 : 400 }}>{c.name}</span>
              </label>
            ))}
          </div>
        )}

        <button type="submit" disabled={loading} style={{
          width: '100%', background: loading ? '#b2dfdb' : `linear-gradient(135deg, ${PRIMARY}, ${DARK})`,
          color: '#fff', border: 'none', borderRadius: 12, padding: '13px 0',
          fontSize: 14, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
        }}>
          {loading ? 'Регистрируем...' : '✓ Зарегистрировать и получить QR'}
        </button>
      </form>
    </div>
  )
}

// ── Мои врачи ─────────────────────────────────────────────────────────────────
function DoctorsTab({ token }) {
  const [doctors, setDoctors] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    apiFetch(token, '/recruiter/doctors').then(r => r.json())
      .then(d => { setDoctors(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => { setError('Ошибка загрузки'); setLoading(false) })
  }, [token])

  if (loading) return <Spinner />
  if (error) return <div style={{ textAlign: 'center', padding: 20, color: '#c62828', fontSize: 13 }}>{error}</div>
  if (!doctors.length) return (
    <div style={{ textAlign: 'center', padding: '40px 16px', color: '#90a4ae' }}>
      <span className="material-symbols-outlined" style={{ fontSize: 44, display: 'block', marginBottom: 10, fontVariationSettings: "'FILL' 1" }}>group</span>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Нет зарегистрированных врачей</div>
      <div style={{ fontSize: 13 }}>Перейдите во вкладку «Регистрация»</div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {doctors.map(d => (
        <div key={d.id} style={{ background: '#fff', borderRadius: 14, border: '1px solid #e0eaec', padding: '14px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: DARK }}>{d.full_name}</div>
              {d.specialization && <div style={{ fontSize: 12, color: PRIMARY, fontWeight: 500, marginTop: 2 }}>{d.specialization}</div>}
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 20, background: d.is_active ? '#e0f7fa' : '#ffeaea', color: d.is_active ? PRIMARY : '#c62828' }}>
              {d.is_active ? 'Активен' : 'Неактивен'}
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            {d.phone_number && <span style={{ fontSize: 12, color: '#607d8b' }}>📞 {d.phone_number}</span>}
            {d.email && <span style={{ fontSize: 12, color: '#607d8b' }}>✉️ {d.email}</span>}
            {d.address && <span style={{ fontSize: 12, color: '#607d8b' }}>📍 {d.address}</span>}
          </div>
          {d.clinics?.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {d.clinics.map(c => (
                <span key={c.id} style={{ fontSize: 11, background: '#e0f7fa', color: DARK, padding: '2px 10px', borderRadius: 20, fontWeight: 600 }}>{c.name}</span>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#90a4ae', paddingTop: 8, borderTop: '1px solid #f0f5f6' }}>
            <span style={{ color: DARK }}>Логин: <strong>{d.username || '—'}</strong></span>
            <span style={{ color: '#43a047', fontWeight: 600 }}>{Number(d.bonuses_earned).toLocaleString('ru')} ₽</span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Бонусы ────────────────────────────────────────────────────────────────────
function BonusesTab({ token }) {
  const [bonuses, setBonuses] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch(token, '/recruiter/bonuses').then(r => r.json())
      .then(d => { setBonuses(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [token])

  if (loading) return <Spinner />
  if (!bonuses.length) return (
    <div style={{ textAlign: 'center', padding: '40px 16px', color: '#90a4ae' }}>
      <span className="material-symbols-outlined" style={{ fontSize: 44, display: 'block', marginBottom: 10, fontVariationSettings: "'FILL' 1" }}>payments</span>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Бонусов пока нет</div>
      <div style={{ fontSize: 13 }}>Они появятся когда врачи начнут создавать направления</div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {bonuses.map(b => (
        <div key={b.id} style={{ background: '#fff', borderRadius: 12, border: '1px solid #e0eaec', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: DARK }}>{Number(b.amount).toLocaleString('ru')} ₽</div>
            <div style={{ fontSize: 12, color: '#607d8b', marginTop: 2 }}>{b.doctor_name} · {b.percent_applied}%</div>
            <div style={{ fontSize: 11, color: '#b0bec5', marginTop: 2 }}>{new Date(b.created_at).toLocaleDateString('ru')}</div>
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 20, background: b.status === 'paid' ? '#e8f5e9' : '#fff8e1', color: b.status === 'paid' ? '#2e7d32' : '#f57f17' }}>
            {b.status === 'paid' ? '✓ Выплачен' : '⏳ Начислен'}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── % Настройки ───────────────────────────────────────────────────────────────
function PercentTab({ stats }) {
  const myPercent = stats?.my_percent ?? 0

  return (
    <div>
      <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e0eaec', padding: '16px', marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: DARK, marginBottom: 12, borderBottom: '1px solid #f0f5f6', paddingBottom: 8 }}>
          📊 Мой процент вознаграждения
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
          <div style={{ width: 80, height: 80, borderRadius: '50%', background: `conic-gradient(${PRIMARY} ${myPercent * 3.6}deg, #e0eaec 0deg)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <div style={{ width: 60, height: 60, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 18, color: DARK }}>
              {myPercent}%
            </div>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: DARK }}>Ваш процент: {myPercent}%</div>
            <div style={{ fontSize: 12, color: '#607d8b', marginTop: 4, lineHeight: 1.5 }}>
              С каждого подтверждённого направления, созданного привлечёнными вами врачами, вы получаете {myPercent}% от суммы бонуса врача.
            </div>
          </div>
        </div>

        <div style={{ background: '#f0f9fa', borderRadius: 10, padding: '12px 14px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: DARK, marginBottom: 8 }}>Как начисляется вознаграждение:</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { step: '1', text: 'Врач создаёт направление на услугу' },
              { step: '2', text: 'Клиника подтверждает визит пациента' },
              { step: '3', text: 'Врач получает бонус за направление' },
              { step: '4', text: `Вы получаете ${myPercent}% от бонуса врача` },
            ].map(s => (
              <div key={s.step} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ width: 22, height: 22, borderRadius: '50%', background: PRIMARY, color: '#fff', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{s.step}</div>
                <div style={{ fontSize: 13, color: '#1a2332', paddingTop: 2 }}>{s.text}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 12, padding: '12px 16px', fontSize: 13, color: '#795548' }}>
        💡 Для изменения процента обратитесь к менеджеру франшизы.
      </div>

      {myPercent === 0 && (
        <div style={{ background: '#ffeaea', border: '1px solid #ffcdd2', borderRadius: 12, padding: '12px 16px', fontSize: 13, color: '#c62828', marginTop: 10 }}>
          ⚠️ Ваш процент не установлен. Обратитесь к менеджеру для настройки.
        </div>
      )}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function RecruiterCabinet({ adminToken, user, onLogout }) {
  const [tab, setTab] = useState('dashboard')
  const [stats, setStats] = useState(null)
  const [statsError, setStatsError] = useState(false)

  const loadStats = useCallback(() => {
    setStatsError(false)
    apiFetch(adminToken, '/recruiter/stats')
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => setStats(d))
      .catch(() => { setStats({ doctors_count: 0, total_bonuses: 0, pending_bonuses: 0, paid_bonuses: 0, my_percent: 0 }); setStatsError(true) })
  }, [adminToken])

  useEffect(() => { loadStats() }, [loadStats])

  const TABS = [
    { key: 'dashboard', label: 'Главная',     icon: 'home' },
    { key: 'register',  label: 'Регистрация', icon: 'person_add' },
    { key: 'doctors',   label: 'Врачи',       icon: 'group' },
    { key: 'bonuses',   label: 'Бонусы',      icon: 'payments' },
    { key: 'percent',   label: 'Мой %',       icon: 'percent' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: BG, fontFamily: "'Inter', sans-serif" }}>
      <style>{`* { box-sizing: border-box; } input:focus { border-color: ${PRIMARY} !important; box-shadow: 0 0 0 3px rgba(0,151,167,0.1); } @keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* Header */}
      <div style={{ background: DARK, padding: '12px 16px', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ maxWidth: 560, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: PRIMARY, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#fff', fontVariationSettings: "'FILL' 1" }}>person</span>
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>{user?.full_name || 'Рекрутер'}</div>
              <div style={{ fontSize: 11, color: '#80cfd6' }}>Кабинет рекрутера</div>
            </div>
          </div>
          <button onClick={onLogout} style={{ background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: 8, padding: '6px 12px', color: '#fff', fontSize: 12, cursor: 'pointer' }}>
            Выйти
          </button>
        </div>
      </div>

      {/* Nav */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e0eaec', position: 'sticky', top: 60, zIndex: 99 }}>
        <div style={{ maxWidth: 560, margin: '0 auto', display: 'flex', overflowX: 'auto', scrollbarWidth: 'none' }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              flex: '1 0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              padding: '9px 10px 7px', border: 'none', background: 'none', cursor: 'pointer',
              borderBottom: tab === t.key ? `2.5px solid ${PRIMARY}` : '2.5px solid transparent',
              color: tab === t.key ? PRIMARY : '#90a4ae',
              fontWeight: tab === t.key ? 700 : 400, fontSize: 10, whiteSpace: 'nowrap',
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: 19, fontVariationSettings: "'FILL' 1" }}>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '14px 14px 40px' }}>
        {statsError && (
          <div style={{ background: '#fff3f3', borderRadius: 10, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#c62828', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            Не удалось загрузить статистику
            <button onClick={loadStats} style={{ background: 'none', border: 'none', color: PRIMARY, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Повторить</button>
          </div>
        )}
        {tab === 'dashboard' && <DashboardTab stats={stats} onNavigate={setTab} />}
        {tab === 'register'  && <RegisterTab token={adminToken} />}
        {tab === 'doctors'   && <DoctorsTab token={adminToken} />}
        {tab === 'bonuses'   && <BonusesTab token={adminToken} />}
        {tab === 'percent'   && <PercentTab stats={stats} />}
      </div>
    </div>
  )
}
