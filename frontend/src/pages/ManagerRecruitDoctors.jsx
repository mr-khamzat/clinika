/**
 * ========================================
 * БЛОК: ManagerRecruitDoctors (premium редизайн + design-system Modal)
 * ========================================
 * Управление приезжими врачами: добавление, выдача QR/credentials,
 * переключение активности, смена данных. Бизнес-логика не изменена.
 *
 * История миграций:
 *   - 191a31b — premium-редизайн (Card/Chip/Button/Avatar/EmptyState)
 *   - Этап 5 ROADMAP — заменён собственный ModalShell на <Modal> из дизайн-системы
 * ========================================
 */
import { useState, useEffect } from 'react'
import useAuthStore from '../store/auth'
import { API_BASE } from '../config'
import { Card, Chip, Button, Avatar, EmptyState, Modal } from '../design'
import ManagerShell from './_ManagerShell'

function apiFetch(token, path, opts = {}) {
  return fetch(API_BASE + path, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  })
}

// ─── Поле формы ───
function Field({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <div className="mb-3">
      <label
        className="block mb-1.5"
        style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}
      >
        {label}
      </label>
      <input
        type={type} value={value} onChange={onChange} placeholder={placeholder}
        className="w-full text-sm outline-none"
        style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 12px', color: 'var(--fg)' }}
      />
    </div>
  )
}

// ─── QR-попап (на base дизайн-системы Modal) ───
function QRPopup({ data, onClose }) {
  const [copied, setCopied] = useState('')
  const copy = (v, k) => { navigator.clipboard.writeText(v); setCopied(k); setTimeout(() => setCopied(''), 2000) }
  return (
    <Modal
      open={!!data}
      onClose={onClose}
      size="sm"
      title={data?.message || 'Готово'}
      actions={
        <Button variant="primary" size="md" onClick={onClose}>
          Закрыть
        </Button>
      }
    >
      <div className="text-center mb-4">
        <img
          src={`data:image/png;base64,${data.qr_code}`} alt="QR"
          style={{ width: 168, height: 168, borderRadius: 12, border: '2px solid var(--border)', display: 'inline-block' }}
        />
        <div className="text-xs mt-2" style={{ color: 'var(--fg-3)' }}>QR для входа в кабинет</div>
      </div>
      <div
        className="p-3"
        style={{ background: 'var(--bg-1)', borderRadius: 12, border: '1px solid var(--border)' }}
      >
        {[
          { label: 'Логин',  value: data.credentials?.username,  k: 'u' },
          { label: 'Пароль', value: data.credentials?.password,  k: 'p' },
          { label: 'Ссылка', value: data.credentials?.login_url, k: 'l' },
        ].map(r => r.value ? (
          <div key={r.k} className="flex justify-between items-center mb-2 last:mb-0 gap-2">
            <div className="min-w-0 flex-1">
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{r.label}</div>
              <div className="text-xs font-semibold break-all" style={{ color: 'var(--fg)' }}>{r.value}</div>
            </div>
            <button
              onClick={() => copy(r.value, r.k)}
              className="flex-shrink-0 transition-colors"
              style={{
                background: copied === r.k ? 'var(--accent-soft)' : 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 8, padding: '5px 10px', fontSize: 12, color: 'var(--accent)',
              }}
            >
              {copied === r.k ? '✓' : '📋'}
            </button>
          </div>
        ) : null)}
      </div>
    </Modal>
  )
}

// ─── Смена данных входа (на base дизайн-системы Modal) ───
function ResetModal({ doctor, token, onClose, onDone }) {
  const [form, setForm] = useState({ username: doctor.username || '', password: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!form.username.trim() && !form.password.trim()) { setError('Заполните логин или пароль'); return }
    setLoading(true); setError('')
    try {
      const r = await apiFetch(token, `/manager/recruiter-doctors/${doctor.id}/reset-credentials`, {
        method: 'POST', body: JSON.stringify({ username: form.username || null, password: form.password || null }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.detail || 'Ошибка')
      onDone(data)
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  return (
    <Modal
      open={!!doctor}
      onClose={onClose}
      size="sm"
      title="Сменить данные входа"
      actions={
        <>
          <Button variant="secondary" size="md" onClick={onClose}>Отмена</Button>
          <Button variant="primary" size="md" onClick={submit} disabled={loading}>
            {loading ? '…' : 'Сохранить'}
          </Button>
        </>
      }
    >
      <div className="text-xs mb-4" style={{ color: 'var(--fg-3)' }}>{doctor.full_name}</div>
      {error && (
        <div
          className="rounded-lg p-2.5 mb-3 text-sm"
          style={{ background: 'var(--bad-soft)', border: '1px solid var(--bad-soft)', color: 'var(--bad)' }}
        >
          {error}
        </div>
      )}
      <Field label="Новый логин" value={form.username} onChange={e => setForm(p => ({ ...p, username: e.target.value }))} placeholder={doctor.username || ''} />
      <Field label="Новый пароль" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} placeholder="Оставьте пустым, чтобы не менять" />
    </Modal>
  )
}

// ─── Форма добавления врача (на base дизайн-системы Modal) ───
function AddModal({ open, token, clinics, onClose, onDone }) {
  const [form, setForm] = useState({
    full_name: '', phone_number: '', email: '', specialization: '', address: '',
    username: '', password: '', clinic_ids: [],
    price_per_visit: '', doctor_percent: '70',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const toggle = id => set('clinic_ids', form.clinic_ids.includes(id) ? form.clinic_ids.filter(x => x !== id) : [...form.clinic_ids, id])

  const submit = async () => {
    if (!form.full_name.trim()) { setError('Введите ФИО'); return }
    if (!form.username.trim())  { setError('Введите логин'); return }
    if (!form.password.trim())  { setError('Введите пароль'); return }
    setLoading(true); setError('')
    try {
      const r = await apiFetch(token, '/manager/register-external-doctor', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          doctor_type: 'visiting',
          price_per_visit: form.price_per_visit ? parseFloat(form.price_per_visit) : null,
          doctor_percent:  form.doctor_percent  ? parseFloat(form.doctor_percent)  : 70,
        }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.detail || 'Ошибка')
      onDone(data)
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title="Добавить приезжего врача"
      actions={
        <>
          <Button variant="secondary" size="md" onClick={onClose}>Отмена</Button>
          <Button variant="primary" size="md" onClick={submit} disabled={loading}>
            {loading ? '…' : 'Зарегистрировать'}
          </Button>
        </>
      }
    >
      {error && (
        <div
          className="rounded-lg p-2.5 mb-3 text-sm"
          style={{ background: 'var(--bad-soft)', border: '1px solid var(--bad-soft)', color: 'var(--bad)' }}
        >
          {error}
        </div>
      )}
      <Field label="ФИО *"            value={form.full_name}      onChange={e => set('full_name', e.target.value)}      placeholder="Иванов Иван Иванович" />
      <Field label="Телефон"           value={form.phone_number}   onChange={e => set('phone_number', e.target.value)}   placeholder="+7 900 000 00 00" />
      <Field label="Email"             value={form.email}          onChange={e => set('email', e.target.value)}          placeholder="doctor@mail.ru" />
      <Field label="Специализация"     value={form.specialization} onChange={e => set('specialization', e.target.value)} placeholder="Хирург, терапевт..." />
      <Field label="Адрес/Организация" value={form.address}        onChange={e => set('address', e.target.value)}        placeholder="Место работы" />
      <Field label="Логин *"           value={form.username}       onChange={e => set('username', e.target.value)}       placeholder="doc_login" />
      <Field label="Пароль *"          value={form.password}       onChange={e => set('password', e.target.value)}       placeholder="Минимум 4 символа" />

      {/* ─── Условия работы ─── */}
      <div
        className="p-3 mb-3"
        style={{ background: 'var(--accent-soft)', borderRadius: 12, border: '1px solid var(--accent-line)' }}
      >
        <div className="font-semibold mb-2" style={{ fontSize: 12, color: 'var(--accent)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          Условия работы
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Цена за приём ₽" type="number" value={form.price_per_visit} onChange={e => set('price_per_visit', e.target.value)} placeholder="3000" />
          <Field label="Доля врача %"    type="number" value={form.doctor_percent}  onChange={e => set('doctor_percent', e.target.value)}  placeholder="70" />
        </div>
        {form.price_per_visit && form.doctor_percent && (
          <div className="text-sm font-semibold mt-1" style={{ color: 'var(--good)' }}>
            Врач получит: {Math.round(parseFloat(form.price_per_visit) * parseFloat(form.doctor_percent) / 100).toLocaleString('ru-RU')} ₽ за приём
          </div>
        )}
      </div>

      {/* ─── Клиники доступа ─── */}
      {clinics.length > 0 && (
        <div className="mb-2">
          <label className="block mb-2" style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Клиники доступа
          </label>
          <div className="flex flex-wrap gap-2">
            {clinics.map(c => {
              const on = form.clinic_ids.includes(c.id)
              return (
                <button
                  key={c.id} onClick={() => toggle(c.id)}
                  className="text-xs font-semibold transition-colors"
                  style={{
                    padding: '6px 12px', borderRadius: 999,
                    background: on ? 'var(--accent-soft)' : 'var(--surface)',
                    color: on ? 'var(--accent)' : 'var(--fg-3)',
                    border: `1px solid ${on ? 'var(--accent-line)' : 'var(--border)'}`,
                  }}
                >
                  {c.name}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </Modal>
  )
}

// ─── Главный компонент ───
export default function ManagerRecruitDoctors() {
  const { token } = useAuthStore()
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
    apiFetch(token, '/manager/all-external-doctors').then(r => r.json())
      .then(d => { setDoctors(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }

  useEffect(() => {
    load()
    apiFetch(token, '/manager/clinics/').then(r => r.json()).then(d => setClinics(Array.isArray(d) ? d : [])).catch(() => {})
  }, [token])

  const toggleActive = async (doc) => {
    setToggling(doc.id)
    await apiFetch(token, `/manager/recruiter-doctors/${doc.id}/toggle-active`, { method: 'PATCH' })
    load()
    setToggling(null)
  }

  const filtered = doctors.filter(d => {
    if (!search) return true
    const q = search.toLowerCase()
    return [d.full_name, d.username, d.specialization, d.phone_number].some(v => v && v.toLowerCase().includes(q))
  })

  return (
    <ManagerShell
      active="recruit"
      title="Приезжие врачи"
      subtitle={`${doctors.length} врачей зарегистрировано`}
      icon="groups"
      topbarRight={
        <Button variant="primary" size="sm" onClick={() => setShowAdd(true)}>
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>person_add</span>
          Добавить
        </Button>
      }
    >
      {resetDoc && <ResetModal doctor={resetDoc} token={token} onClose={() => setResetDoc(null)} onDone={d => { setQrResult(d); setResetDoc(null); load() }} />}
      {qrResult && <QRPopup    data={qrResult}   onClose={() => setQrResult(null)} />}
      <AddModal   open={showAdd} token={token} clinics={clinics} onClose={() => setShowAdd(false)} onDone={d => { setQrResult(d); setShowAdd(false); load() }} />

      {/* ─── Mobile add button ─── */}
      <div className="mb-4 sm:hidden">
        <Button variant="primary" size="md" className="w-full" onClick={() => setShowAdd(true)}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>person_add</span>
          Добавить врача
        </Button>
      </div>

      {/* ─── Поиск ─── */}
      <div
        className="flex items-center gap-2 mb-4"
        style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', padding: '10px 14px',
        }}
      >
        <span className="material-symbols-outlined" style={{ color: 'var(--fg-3)', fontSize: 18 }}>search</span>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Поиск по имени, логину, специализации…"
          className="flex-1 text-sm outline-none bg-transparent"
          style={{ color: 'var(--fg)' }}
        />
        {search && (
          <button onClick={() => setSearch('')} style={{ background: 'transparent', color: 'var(--fg-3)', fontSize: 16 }}>✕</button>
        )}
      </div>

      {loading ? (
        <Card>
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 rounded-full animate-spin" style={{ border: '3px solid var(--accent-soft)', borderTopColor: 'var(--accent)' }} />
          </div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<span className="material-symbols-outlined" style={{ fontSize: 28, fontVariationSettings: "'FILL' 1" }}>group_off</span>}
            title={search ? 'Ничего не найдено' : 'Нет приезжих врачей'}
            message={search ? 'Попробуйте изменить запрос.' : 'Добавьте первого врача, чтобы начать работу.'}
            action={!search ? (
              <Button variant="primary" size="md" onClick={() => setShowAdd(true)}>
                Добавить первого врача
              </Button>
            ) : null}
          />
        </Card>
      ) : (
        <div className="grid gap-3">
          {filtered.map(doc => (
            <Card
              key={doc.id}
              style={{
                opacity: doc.is_active ? 1 : 0.78,
                borderColor: doc.is_active ? 'var(--border)' : 'var(--bad-soft)',
              }}
            >
              <div className="flex justify-between items-start gap-3 mb-3 flex-wrap">
                <div className="flex items-start gap-3 min-w-0">
                  <Avatar name={doc.full_name} size="md" />
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate" style={{ color: 'var(--fg)' }}>{doc.full_name}</div>
                    {doc.specialization && (
                      <div className="text-xs font-medium mt-0.5" style={{ color: 'var(--accent)' }}>
                        {doc.specialization}
                      </div>
                    )}
                  </div>
                </div>
                <Chip variant={doc.is_active ? 'good' : 'bad'} dot>
                  {doc.is_active ? 'Активен' : 'Заблокирован'}
                </Chip>
              </div>

              {/* ─── Контакты ─── */}
              <div className="grid gap-2 mb-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
                {[
                  { label: 'Логин',   value: doc.username,     mono: true },
                  { label: 'Телефон', value: doc.phone_number },
                  { label: 'Email',   value: doc.email },
                  { label: 'Адрес',   value: doc.address },
                ].filter(f => f.value).map(f => (
                  <div
                    key={f.label}
                    style={{ background: 'var(--bg-1)', borderRadius: 9, padding: '7px 10px' }}
                  >
                    <div style={{ fontSize: 10, color: 'var(--fg-4)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                      {f.label}
                    </div>
                    <div
                      className="text-xs break-all"
                      style={{
                        color: 'var(--fg)',
                        fontFamily: f.mono ? 'SF Mono, Consolas, monospace' : 'inherit',
                        fontWeight: f.mono ? 600 : 500,
                      }}
                    >
                      {f.value}
                    </div>
                  </div>
                ))}
              </div>

              {/* ─── Клиники ─── */}
              {doc.clinics?.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {doc.clinics.map(c => (
                    <Chip key={c.id} variant="accent">{c.name}</Chip>
                  ))}
                </div>
              )}

              {/* ─── Действия ─── */}
              <div className="flex flex-wrap gap-2 items-center pt-3" style={{ borderTop: '1px solid var(--line)' }}>
                <Button variant="secondary" size="sm" onClick={() => setResetDoc(doc)}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>vpn_key</span>
                  Сменить данные
                </Button>
                <Button
                  variant={doc.is_active ? 'secondary' : 'primary'} size="sm"
                  onClick={() => toggleActive(doc)} disabled={toggling === doc.id}
                >
                  {toggling === doc.id ? '…' : (doc.is_active ? 'Заблокировать' : 'Активировать')}
                </Button>
                <span className="ml-auto text-[11px]" style={{ color: 'var(--fg-4)' }}>
                  {new Date(doc.created_at).toLocaleDateString('ru-RU')}
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </ManagerShell>
  )
}
