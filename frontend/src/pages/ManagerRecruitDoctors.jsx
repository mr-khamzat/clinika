/**
 * ========================================
 * БЛОК: ManagerRecruitDoctors — управление сотрудниками
 * ========================================
 * - Добавление сотрудников всех ролей
 * - Полное редактирование профиля (карточка)
 * - Группировка списка по ролям (свернуть/развернуть)
 * - Бейдж должности в карточке
 * - Действия: Calls (звонок через наш сервис) + StaffChat (наш чат)
 * - WhatsApp оставлен в меню как fallback
 * ========================================
 */
import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api'
import { Card, Chip, Button, Avatar, EmptyState, Modal } from '../design'
import QuickActions from '../components/QuickActions'
import ManagerShell from './_ManagerShell'
import { SLUG } from '../config'
import { callPhone, whatsappPhone } from '../lib/phoneActions'

// ─── apiFetch (совместимость со старыми вызовами в этом файле) ──────────────
function apiFetch(_token, path, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase()
  const config = {
    method, url: path,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    data: opts.body !== undefined ? (typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body) : undefined,
    validateStatus: () => true,
  }
  return api.request(config).then(res => ({
    ok: res.status >= 200 && res.status < 300,
    status: res.status,
    json: async () => res.data,
  }))
}

// ─── Метаданные ролей: лейбл, иконка, цвет бейджа, порядок групп ────────────
const ROLE_META = {
  manager:         { label: 'Руководитель',     icon: 'admin_panel_settings', color: '#1d4ed8', bg: 'rgba(37, 99, 235, 0.10)',  order: 1 },
  deputy_director: { label: 'Зам руководителя',  icon: 'supervisor_account',    color: '#0f766e', bg: 'rgba(13, 148, 136, 0.10)', order: 1.5 },
  doctor:          { label: 'Штатный врач',     icon: 'stethoscope',           color: '#047857', bg: 'rgba(5, 150, 105, 0.10)',  order: 2 },
  partner_doctor:  { label: 'Врач-партнёр',     icon: 'handshake',             color: '#7c3aed', bg: 'rgba(124, 58, 237, 0.10)', order: 3 },
  visiting_doctor: { label: 'Приезжий врач',    icon: 'flight_takeoff',        color: '#c2410c', bg: 'rgba(234, 88, 12, 0.10)',  order: 4 },
  reg:             { label: 'Регистратор',      icon: 'badge',                 color: '#b45309', bg: 'rgba(217, 119, 6, 0.10)',  order: 5 },
  nurse:           { label: 'Медсестра',        icon: 'medical_services',      color: '#0e7490', bg: 'rgba(14, 116, 144, 0.10)', order: 6 },
  recruiter:       { label: 'Рекрутер',         icon: 'person_search',         color: '#6d28d9', bg: 'rgba(109, 40, 217, 0.10)', order: 7 },
}
const DEFAULT_ROLE_META = { label: 'Сотрудник', icon: 'person', color: '#4b5563', bg: 'rgba(75, 85, 99, 0.10)', order: 99 }

// ─── Поле формы ─────────────────────────────────────────────────────────────
function Field({ label, value, onChange, placeholder, type = 'text', readOnly = false }) {
  return (
    <div className="mb-3">
      <label
        className="block mb-1.5"
        style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}
      >
        {label}
      </label>
      <input
        type={type} value={value || ''} onChange={onChange} placeholder={placeholder} readOnly={readOnly}
        className="w-full text-sm outline-none"
        style={{
          background: readOnly ? 'var(--bg-2)' : 'var(--bg-1)',
          border: '1px solid var(--border)', borderRadius: 9, padding: '9px 12px',
          color: 'var(--fg)',
          cursor: readOnly ? 'not-allowed' : 'text',
        }}
      />
    </div>
  )
}

// ─── QR-попап (для credentials reset) ───────────────────────────────────────
function QRPopup({ data, onClose }) {
  const [copied, setCopied] = useState('')
  const copy = (v, k) => { navigator.clipboard.writeText(v); setCopied(k); setTimeout(() => setCopied(''), 2000) }
  return (
    <Modal
      open={!!data} onClose={onClose} size="sm"
      title={data?.message || 'Готово'}
      actions={<Button variant="primary" size="md" onClick={onClose}>Закрыть</Button>}
    >
      <div className="text-center mb-4">
        <img
          src={`data:image/png;base64,${data.qr_code}`} alt="QR"
          style={{ width: 168, height: 168, borderRadius: 12, border: '2px solid var(--border)', display: 'inline-block' }}
        />
        <div className="text-xs mt-2" style={{ color: 'var(--fg-3)' }}>QR для входа в кабинет</div>
      </div>
      <div className="p-3" style={{ background: 'var(--bg-1)', borderRadius: 12, border: '1px solid var(--border)' }}>
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
            >{copied === r.k ? '✓' : '📋'}</button>
          </div>
        ) : null)}
      </div>
    </Modal>
  )
}

// ─── EditModal — полная карточка сотрудника ─────────────────────────────────
// Две вкладки: Профиль и Доступ. Каждая шлёт свой PATCH/POST.
// Роли, которые менеджер может выставить в EditModal. Должно совпадать с
// ROLE_CHANGE_ALLOWED в backend/app/routers/manager/recruiter_doctors.py.
const ROLE_EDIT_OPTIONS = [
  'doctor', 'visiting_doctor', 'partner_doctor',
  'recruiter', 'manager', 'reg', 'nurse',
]

function EditModal({ doctor, onClose, onProfileSaved, onCredentialsReset }) {
  const [tab, setTab] = useState('profile')
  const [profile, setProfile] = useState({
    full_name:      doctor.full_name      || '',
    phone_number:   doctor.phone_number   || '',
    email:          doctor.email          || '',
    specialization: doctor.specialization || '',
    address:        doctor.address        || '',
    date_of_birth:  doctor.date_of_birth  || '',
    category:       doctor.category       || '',
    role:           doctor.role           || '',
  })
  const [creds, setCreds] = useState({ username: doctor.username || '', password: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const setP = (k, v) => setProfile(p => ({ ...p, [k]: v }))
  const setC = (k, v) => setCreds(p => ({ ...p, [k]: v }))

  const saveProfile = async () => {
    if (!profile.full_name?.trim() || profile.full_name.trim().length < 2) { setError('Введите ФИО'); return }
    setLoading(true); setError('')
    try {
      const r = await apiFetch(null, `/manager/recruiter-doctors/${doctor.id}/profile`, {
        method: 'PATCH', body: JSON.stringify(profile),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.detail || 'Ошибка')
      onProfileSaved?.(data)
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  const saveCreds = async () => {
    if (!creds.username?.trim() && !creds.password?.trim()) { setError('Заполните логин или пароль'); return }
    setLoading(true); setError('')
    try {
      const r = await apiFetch(null, `/manager/recruiter-doctors/${doctor.id}/reset-credentials`, {
        method: 'POST', body: JSON.stringify({ username: creds.username || null, password: creds.password || null }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.detail || 'Ошибка')
      onCredentialsReset?.(data)
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  const meta = ROLE_META[doctor.role] || DEFAULT_ROLE_META

  return (
    <Modal
      open={!!doctor} onClose={onClose} size="md"
      title="Карточка сотрудника"
      actions={
        <>
          <Button variant="secondary" size="md" onClick={onClose}>Закрыть</Button>
          {tab === 'profile' && (
            <Button variant="primary" size="md" onClick={saveProfile} disabled={loading}>
              {loading ? '…' : 'Сохранить'}
            </Button>
          )}
          {tab === 'access' && (
            <Button variant="primary" size="md" onClick={saveCreds} disabled={loading}>
              {loading ? '…' : 'Применить'}
            </Button>
          )}
        </>
      }
    >
      {/* Header c должностью */}
      <div className="flex items-center gap-3 mb-4" style={{ paddingBottom: 12, borderBottom: '1px solid var(--line)' }}>
        <Avatar name={doctor.full_name} size="md" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm truncate" style={{ color: 'var(--fg)' }}>{doctor.full_name}</div>
          <div
            className="inline-flex items-center gap-1 mt-1"
            style={{
              fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
              background: meta.bg, color: meta.color,
              textTransform: 'uppercase', letterSpacing: '0.04em',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 13 }}>{meta.icon}</span>
            {meta.label}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4" style={{ background: 'var(--bg-1)', padding: 3, borderRadius: 10, border: '1px solid var(--border)' }}>
        {[
          { k: 'profile', label: 'Профиль', icon: 'badge' },
          { k: 'access',  label: 'Доступ',  icon: 'vpn_key' },
        ].map(t => {
          const on = tab === t.k
          return (
            <button
              key={t.k}
              onClick={() => { setTab(t.k); setError('') }}
              className="flex-1 flex items-center justify-center gap-1.5 transition-colors"
              style={{
                padding: '7px 12px', borderRadius: 8,
                background: on ? 'var(--surface)' : 'transparent',
                border: 0, cursor: 'pointer',
                color: on ? 'var(--fg)' : 'var(--fg-3)',
                fontSize: 13, fontWeight: 600,
                boxShadow: on ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{t.icon}</span>
              {t.label}
            </button>
          )
        })}
      </div>

      {error && (
        <div className="rounded-lg p-2.5 mb-3 text-sm"
             style={{ background: 'var(--bad-soft)', border: '1px solid var(--bad-soft)', color: 'var(--bad)' }}>
          {error}
        </div>
      )}

      {tab === 'profile' && (
        <>
          <Field label="ФИО *"        value={profile.full_name}      onChange={e => setP('full_name', e.target.value)} placeholder="Иванов Иван Иванович" />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Телефон"    value={profile.phone_number}   onChange={e => setP('phone_number', e.target.value)} placeholder="+7 900 000 00 00" />
            <Field label="Email"      value={profile.email}          onChange={e => setP('email', e.target.value)}         placeholder="user@mail.ru" />
          </div>

          {/* Роль — менеджер может переводить, например, штатного во внешнего.
              Если попытаться изменить роль самому себе — backend вернёт 400. */}
          {ROLE_EDIT_OPTIONS.includes(doctor.role) && (
            <div className="mb-3">
              <label className="block mb-1.5" style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Роль
              </label>
              <select
                value={profile.role}
                onChange={e => setP('role', e.target.value)}
                className="w-full"
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--fg)',
                  fontSize: 14,
                }}
              >
                {STAFF_ROLES.filter(r => ROLE_EDIT_OPTIONS.includes(r.value)).map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
              {profile.role !== doctor.role && (
                <div className="text-xs mt-1" style={{ color: 'var(--warn, #b45309)' }}>
                  Роль будет изменена с «{ROLE_META[doctor.role]?.label || doctor.role}» на «{ROLE_META[profile.role]?.label || profile.role}»
                </div>
              )}
            </div>
          )}

          <Field label="Специализация" value={profile.specialization} onChange={e => setP('specialization', e.target.value)} placeholder="Хирург, терапевт..." />
          <Field label="Адрес"        value={profile.address}        onChange={e => setP('address', e.target.value)}        placeholder="Адрес/Организация" />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Дата рождения" type="date" value={profile.date_of_birth} onChange={e => setP('date_of_birth', e.target.value)} />
            <Field label="Категория"     value={profile.category}    onChange={e => setP('category', e.target.value)} placeholder="высшая, первая…" />
          </div>
        </>
      )}

      {tab === 'access' && (
        <>
          <div className="text-xs mb-3" style={{ color: 'var(--fg-3)' }}>
            Смена логина и пароля. Оставьте поле пустым, если менять не нужно.
          </div>
          <Field label="Логин"  value={creds.username} onChange={e => setC('username', e.target.value)} placeholder={doctor.username || 'login'} />
          <Field label="Пароль" type="password" value={creds.password} onChange={e => setC('password', e.target.value)} placeholder="Новый пароль (мин. 4 символа)" />
        </>
      )}
    </Modal>
  )
}

// ─── Перечень доступных ролей при создании сотрудника ───────────────────────
const STAFF_ROLES = [
  { value: 'visiting_doctor', label: 'Приезжий врач',     icon: 'flight_takeoff',         hint: 'Внешний приглашённый специалист с оплатой за приём' },
  { value: 'partner_doctor',  label: 'Партнёр (внешний врач)', icon: 'handshake',          hint: 'Внешний врач-партнёр (направляет пациентов)' },
  { value: 'doctor',          label: 'Штатный врач',      icon: 'stethoscope',            hint: 'Врач клиники, ведёт приёмы в кабинете врача' },
  { value: 'recruiter',       label: 'Рекрутер',          icon: 'person_search',          hint: 'Привлекает врачей-партнёров и получает % бонуса' },
  { value: 'manager',         label: 'Руководитель',      icon: 'admin_panel_settings',   hint: 'Менеджер франшизы (управляет тенантом)' },
  { value: 'deputy_director', label: 'Зам руководителя',  icon: 'supervisor_account',      hint: 'Read-only кабинет руководителя сети (P&L, KPI, склад, маркетинг)' },
  { value: 'reg',             label: 'Регистратор',       icon: 'badge',                  hint: 'Регистратор клиники (приём пациентов)' },
  { value: 'nurse',           label: 'Медсестра',         icon: 'medical_services',       hint: 'Медсестра, ассистирует врачу' },
]
const ROLE_NEEDS = {
  visiting_doctor: { specialization: true, address: true,  clinics: true,  terms: true,  primaryClinic: false, bonusPercent: false },
  partner_doctor:  { specialization: true, address: true,  clinics: true,  terms: false, primaryClinic: false, bonusPercent: false },
  doctor:          { specialization: true, address: false, clinics: true,  terms: false, primaryClinic: false, bonusPercent: false },
  recruiter:       { specialization: false,address: false, clinics: false, terms: false, primaryClinic: false, bonusPercent: true  },
  manager:         { specialization: false,address: false, clinics: false, terms: false, primaryClinic: true,  bonusPercent: false },
  deputy_director: { specialization: false,address: false, clinics: false, terms: false, primaryClinic: false, bonusPercent: false },
  reg:             { specialization: false,address: false, clinics: false, terms: false, primaryClinic: true,  bonusPercent: false },
  nurse:           { specialization: false,address: false, clinics: false, terms: false, primaryClinic: true,  bonusPercent: false },
}

// ─── Форма добавления сотрудника ────────────────────────────────────────────
const EMPTY_ADD_FORM = {
  role: 'visiting_doctor',
  full_name: '', phone_number: '', email: '', specialization: '', address: '',
  username: '', password: '', clinic_ids: [], clinic_id: '',
  price_per_visit: '', doctor_percent: '70',
  bonus_percent: '10',
}

function AddModal({ open, clinics, onClose, onDone }) {
  const [form, setForm] = useState(EMPTY_ADD_FORM)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // AddModal остаётся смонтированным между открытиями (Modal-обёртка лишь
  // прячет узел в DOM). Без сброса при повторном open форма сохраняла
  // данные предыдущего сотрудника.
  useEffect(() => {
    if (open) {
      setForm(EMPTY_ADD_FORM)
      setError('')
      setLoading(false)
    }
  }, [open])
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const toggle = id => set('clinic_ids', form.clinic_ids.includes(id) ? form.clinic_ids.filter(x => x !== id) : [...form.clinic_ids, id])

  const needs = ROLE_NEEDS[form.role] || ROLE_NEEDS.visiting_doctor
  const roleMeta = STAFF_ROLES.find(r => r.value === form.role)

  const submit = async () => {
    if (!form.full_name.trim()) { setError('Введите ФИО'); return }
    if (!form.username.trim())  { setError('Введите логин'); return }
    if (!form.password.trim())  { setError('Введите пароль'); return }
    setLoading(true); setError('')
    try {
      const payload = {
        role: form.role,
        full_name: form.full_name,
        username: form.username,
        password: form.password,
        phone_number: form.phone_number || null,
        email: form.email || null,
      }
      if (needs.specialization) payload.specialization = form.specialization || null
      if (needs.address)        payload.address        = form.address        || null
      if (needs.clinics)        payload.clinic_ids     = form.clinic_ids
      if (needs.primaryClinic && form.clinic_id) payload.clinic_id = form.clinic_id
      if (needs.terms) {
        payload.price_per_visit = form.price_per_visit ? parseFloat(form.price_per_visit) : null
        payload.doctor_percent  = form.doctor_percent  ? parseFloat(form.doctor_percent)  : 70
      }
      if (needs.bonusPercent && form.bonus_percent) payload.bonus_percent = parseFloat(form.bonus_percent)

      const r = await apiFetch(null, '/manager/users/create-staff', {
        method: 'POST', body: JSON.stringify(payload),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.detail || 'Ошибка')
      onDone(data)
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  return (
    <Modal
      open={open} onClose={onClose} size="md"
      title="Добавить сотрудника"
      actions={
        <>
          <Button variant="secondary" size="md" onClick={onClose}>Отмена</Button>
          <Button variant="primary" size="md" onClick={submit} disabled={loading}>
            {loading ? '…' : 'Создать'}
          </Button>
        </>
      }
    >
      {error && (
        <div className="rounded-lg p-2.5 mb-3 text-sm"
             style={{ background: 'var(--bad-soft)', border: '1px solid var(--bad-soft)', color: 'var(--bad)' }}>
          {error}
        </div>
      )}

      <div className="mb-4">
        <label className="block mb-2" style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Роль сотрудника *
        </label>
        <div className="grid grid-cols-2 gap-2">
          {STAFF_ROLES.map(r => {
            const on = form.role === r.value
            return (
              <button
                key={r.value} type="button" onClick={() => set('role', r.value)}
                className="text-left transition-colors"
                style={{
                  padding: '10px 12px', borderRadius: 10,
                  background: on ? 'var(--accent-soft)' : 'var(--surface)',
                  border: `1px solid ${on ? 'var(--accent-line)' : 'var(--border)'}`,
                  color: on ? 'var(--accent)' : 'var(--fg)',
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{r.icon}</span>
                  <span className="text-sm font-semibold">{r.label}</span>
                </div>
              </button>
            )
          })}
        </div>
        {roleMeta?.hint && (
          <div className="text-xs mt-2" style={{ color: 'var(--fg-3)' }}>{roleMeta.hint}</div>
        )}
      </div>

      <Field label="ФИО *"   value={form.full_name}    onChange={e => set('full_name', e.target.value)}    placeholder="Иванов Иван Иванович" />
      <Field label="Телефон" value={form.phone_number} onChange={e => set('phone_number', e.target.value)} placeholder="+7 900 000 00 00" />
      <Field label="Email"   value={form.email}        onChange={e => set('email', e.target.value)}        placeholder="user@mail.ru" />

      {needs.specialization && (<Field label="Специализация" value={form.specialization} onChange={e => set('specialization', e.target.value)} placeholder="Хирург, терапевт..." />)}
      {needs.address && (<Field label="Адрес/Организация" value={form.address} onChange={e => set('address', e.target.value)} placeholder="Место работы" />)}

      <Field label="Логин *"  value={form.username} onChange={e => set('username', e.target.value)} placeholder="login" />
      <Field label="Пароль *" value={form.password} onChange={e => set('password', e.target.value)} placeholder="Минимум 4 символа" />

      {needs.bonusPercent && (
        <div className="p-3 mb-3" style={{ background: 'var(--accent-soft)', borderRadius: 12, border: '1px solid var(--accent-line)' }}>
          <div className="font-semibold mb-2" style={{ fontSize: 12, color: 'var(--accent)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            Бонус рекрутера
          </div>
          <Field label="% от приёмов привлечённых врачей" type="number" value={form.bonus_percent} onChange={e => set('bonus_percent', e.target.value)} placeholder="10" />
        </div>
      )}

      {needs.terms && (
        <div className="p-3 mb-3" style={{ background: 'var(--accent-soft)', borderRadius: 12, border: '1px solid var(--accent-line)' }}>
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
      )}

      {needs.primaryClinic && clinics.length > 0 && (
        <div className="mb-3">
          <label className="block mb-2" style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Клиника
          </label>
          <select
            value={form.clinic_id} onChange={e => set('clinic_id', e.target.value)}
            className="w-full text-sm outline-none"
            style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 12px', color: 'var(--fg)' }}
          >
            <option value="">Без клиники</option>
            {clinics.map(c => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </select>
        </div>
      )}

      {needs.clinics && clinics.length > 0 && (
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
                >{c.name}</button>
              )
            })}
          </div>
        </div>
      )}
    </Modal>
  )
}

// ─── Модалка удаления сотрудника ────────────────────────────────────────────
// Два режима:
//   • block — soft-delete (is_active=false, is_suspended=true), DELETE /manager/users/{id}
//   • hard  — полное удаление строки, требует пароль руководителя
//             DELETE /manager/users/{id}/hard  body: { password }
// Если у сотрудника есть FK-связи (направления, история), backend вернёт 409
// и предложит блокировку вместо удаления.
function DeleteStaffModal({ doctor, onClose, onDone }) {
  const [mode, setMode] = useState('block')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    setError('')
    if (mode === 'hard' && !password.trim()) {
      setError('Введите пароль руководителя')
      return
    }
    setLoading(true)
    try {
      const path = mode === 'hard'
        ? `/manager/users/${doctor.id}/hard`
        : `/manager/users/${doctor.id}`
      const opts = { method: 'DELETE' }
      if (mode === 'hard') opts.body = JSON.stringify({ password })
      const r = await apiFetch(null, path, opts)
      if (!r.ok && r.status !== 204) {
        const d = await r.json().catch(() => ({}))
        throw new Error(d.detail || 'Не удалось выполнить операцию')
      }
      onDone()
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open={!!doctor} onClose={loading ? undefined : onClose} size="sm"
      title={mode === 'hard' ? '⚠️ Полное удаление' : 'Удаление сотрудника'}
      actions={
        <>
          <Button variant="secondary" size="md" onClick={onClose} disabled={loading}>Отмена</Button>
          <Button
            variant={mode === 'hard' ? 'danger' : 'primary'}
            size="md"
            onClick={submit}
            disabled={loading}
          >
            {loading ? '…' : (mode === 'hard' ? 'Удалить навсегда' : 'Заблокировать')}
          </Button>
        </>
      }
    >
      <div className="mb-3 text-sm" style={{ color: 'var(--fg-2)' }}>
        Что сделать с сотрудником <b>«{doctor.full_name}»</b>?
      </div>

      {/* Радио: режим */}
      <div className="space-y-2 mb-3">
        <label
          className="flex items-start gap-3 cursor-pointer"
          style={{
            padding: 12,
            borderRadius: 10,
            border: `1px solid ${mode === 'block' ? 'var(--accent, #0097A7)' : 'var(--border)'}`,
            background: mode === 'block' ? 'var(--accent-soft, rgba(0, 151, 167, 0.06))' : 'transparent',
          }}
        >
          <input
            type="radio" checked={mode === 'block'} onChange={() => setMode('block')}
            style={{ marginTop: 3 }}
          />
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-sm" style={{ color: 'var(--fg)' }}>
              Заблокировать вход <span style={{ color: 'var(--good)', fontSize: 11, fontWeight: 600 }}>(рекомендуется)</span>
            </div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--fg-3)' }}>
              Вход отключён, история записей и аудит сохраняются. Сотрудника можно вернуть.
            </div>
          </div>
        </label>

        <label
          className="flex items-start gap-3 cursor-pointer"
          style={{
            padding: 12,
            borderRadius: 10,
            border: `1px solid ${mode === 'hard' ? 'var(--bad, #dc2626)' : 'var(--border)'}`,
            background: mode === 'hard' ? 'var(--bad-soft, rgba(220, 38, 38, 0.06))' : 'transparent',
          }}
        >
          <input
            type="radio" checked={mode === 'hard'} onChange={() => setMode('hard')}
            style={{ marginTop: 3 }}
          />
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-sm" style={{ color: 'var(--fg)' }}>
              Удалить навсегда <span style={{ color: 'var(--bad)', fontSize: 11, fontWeight: 600 }}>(необратимо)</span>
            </div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--fg-3)' }}>
              Строка пользователя полностью удаляется. Возможно только если за сотрудником
              нет связанных записей (направлений, истории). Иначе используйте блокировку.
            </div>
          </div>
        </label>
      </div>

      {mode === 'hard' && (
        <div className="mb-3">
          <label className="block mb-1.5" style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Подтвердите паролем руководителя
          </label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Ваш пароль"
            autoFocus
            disabled={loading}
            className="w-full"
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--fg)',
              fontSize: 14,
            }}
          />
        </div>
      )}

      {error && (
        <div className="rounded-lg p-2.5 mb-1 text-sm"
             style={{ background: 'var(--bad-soft)', border: '1px solid var(--bad-soft)', color: 'var(--bad)' }}>
          {error}
        </div>
      )}
    </Modal>
  )
}

// ─── Карточка сотрудника ────────────────────────────────────────────────────
function StaffCard({ doc, onEdit, onToggle, onDelete, onChat, onCall, onWhatsapp, toggling, deleting }) {
  const meta = ROLE_META[doc.role] || DEFAULT_ROLE_META
  const phone = doc.phone_number

  return (
    <Card style={{ opacity: doc.is_active ? 1 : 0.78, borderColor: doc.is_active ? 'var(--border)' : 'var(--bad-soft)' }}>
      <div className="flex justify-between items-start gap-3 mb-3 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <Avatar name={doc.full_name} size="md" />
          <div className="min-w-0">
            <div className="font-semibold text-sm truncate" style={{ color: 'var(--fg)' }}>{doc.full_name}</div>
            {/* Бейдж должности */}
            <div
              className="inline-flex items-center gap-1 mt-0.5"
              style={{
                fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999,
                background: meta.bg, color: meta.color,
                textTransform: 'uppercase', letterSpacing: '0.04em',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 12 }}>{meta.icon}</span>
              {meta.label}
            </div>
            {doc.specialization && (
              <div className="text-xs font-medium mt-1" style={{ color: 'var(--accent)' }}>{doc.specialization}</div>
            )}
          </div>
        </div>
        <Chip variant={doc.is_active ? 'good' : 'bad'} dot>
          {doc.is_active ? 'Активен' : 'Заблокирован'}
        </Chip>
      </div>

      {/* Контакты */}
      <div className="grid gap-2 mb-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
        {[
          { label: 'Логин',   value: doc.username,     mono: true },
          { label: 'Телефон', value: doc.phone_number },
          { label: 'Email',   value: doc.email },
          { label: 'Адрес',   value: doc.address },
        ].filter(f => f.value).map(f => (
          <div key={f.label} style={{ background: 'var(--bg-1)', borderRadius: 9, padding: '7px 10px' }}>
            <div style={{ fontSize: 10, color: 'var(--fg-4)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>{f.label}</div>
            <div className="text-xs break-all"
                 style={{ color: 'var(--fg)', fontFamily: f.mono ? 'SF Mono, Consolas, monospace' : 'inherit', fontWeight: f.mono ? 600 : 500 }}>
              {f.value}
            </div>
          </div>
        ))}
      </div>

      {/* Клиники */}
      {doc.clinics?.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {doc.clinics.map(c => (<Chip key={c.id} variant="accent">{c.name}</Chip>))}
        </div>
      )}

      {/* Действия */}
      <div className="flex flex-wrap gap-2 items-center pt-3" style={{ borderTop: '1px solid var(--line)' }}>
        {/* Наш чат */}
        <Button variant="secondary" size="sm" onClick={() => onChat(doc)} title="Открыть чат КлиникСеть">
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>forum</span>
          Чат
        </Button>
        {/* Наш звонок (Calls Electron deep-link или tel:) */}
        {phone && (
          <Button variant="secondary" size="sm" onClick={() => onCall(phone)} title="Позвонить через Calls">
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>call</span>
            Звонок
          </Button>
        )}
        {/* WhatsApp оставлен как fallback */}
        {phone && (
          <Button variant="secondary" size="sm" onClick={() => onWhatsapp(phone)} title="WhatsApp">
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>chat</span>
            WhatsApp
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={() => onEdit(doc)}>
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>edit</span>
          Карточка
        </Button>
        <Button variant={doc.is_active ? 'secondary' : 'primary'} size="sm" onClick={() => onToggle(doc)} disabled={toggling === doc.id}>
          {toggling === doc.id ? '…' : (doc.is_active ? 'Заблокировать' : 'Активировать')}
        </Button>
        <Button variant="danger" size="sm" onClick={() => onDelete(doc)} disabled={deleting === doc.id} title="Удалить">
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span>
          {deleting === doc.id ? '…' : 'Удалить'}
        </Button>
        <span className="ml-auto text-[11px]" style={{ color: 'var(--fg-4)' }}>
          {new Date(doc.created_at).toLocaleDateString('ru-RU')}
        </span>
      </div>
    </Card>
  )
}

// ─── Заголовок группы (сворачивается) ───────────────────────────────────────
function GroupHeader({ role, count, collapsed, onToggle }) {
  const meta = ROLE_META[role] || DEFAULT_ROLE_META
  return (
    <button
      type="button" onClick={onToggle}
      className="w-full flex items-center gap-2 transition-colors"
      style={{
        padding: '10px 14px', marginBottom: collapsed ? 0 : 8,
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
        cursor: 'pointer',
      }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 20, color: meta.color }}>{meta.icon}</span>
      <span className="font-semibold text-sm" style={{ color: 'var(--fg)' }}>{meta.label}</span>
      <span
        className="font-semibold text-xs"
        style={{ background: meta.bg, color: meta.color, padding: '2px 8px', borderRadius: 999 }}
      >{count}</span>
      <span className="material-symbols-outlined ml-auto" style={{ fontSize: 18, color: 'var(--fg-3)', transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 150ms' }}>
        expand_more
      </span>
    </button>
  )
}

// ─── Главный компонент ─────────────────────────────────────────────────────
export default function ManagerRecruitDoctors() {
  const navigate = useNavigate()
  const [doctors, setDoctors]   = useState([])
  const [clinics, setClinics]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [showAdd, setShowAdd]   = useState(false)
  const [editDoc, setEditDoc]   = useState(null)
  const [qrResult, setQrResult] = useState(null)
  const [toggling, setToggling] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [collapsed, setCollapsed] = useState({})  // { role: true|false }

  const load = () => {
    setLoading(true)
    apiFetch(null, '/manager/all-external-doctors').then(r => r.json())
      .then(d => { setDoctors(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }

  useEffect(() => {
    load()
    apiFetch(null, '/manager/clinics/').then(r => r.json()).then(d => setClinics(Array.isArray(d) ? d : [])).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleActive = async (doc) => {
    setToggling(doc.id)
    await apiFetch(null, `/manager/recruiter-doctors/${doc.id}/toggle-active`, { method: 'PATCH' })
    load(); setToggling(null)
  }

  // Открыть модалку удаления (выбор: блокировка vs полное удаление с паролем).
  const requestDelete = (doc) => setDeleteTarget(doc)

  // ─ Открыть чат КлиникСеть в DM с этим сотрудником ─
  const openChat = (doc) => {
    // /staff-chat — отдельный route без slug, его SLUG=, токены там ищутся
    // под ключами clinika_(admin_)?token_ (без slug). Пробрасываем актуальные
    // токены через hash — StaffChat при монтировании их подберёт и сохранит,
    // тот же паттерн используется Calls Electron.
    const at = localStorage.getItem('clinika_admin_token_' + SLUG) || localStorage.getItem('clinika_token_' + SLUG) || ''
    const rt = localStorage.getItem('clinika_admin_refresh_token_' + SLUG) || localStorage.getItem('clinika_refresh_token_' + SLUG) || ''
    let hash = ''
    if (at) {
      hash = '#access_token=' + encodeURIComponent(at)
      if (rt) hash += '&refresh_token=' + encodeURIComponent(rt)
    }
    window.open(`/staff-chat?dm=${doc.id}${hash}`, '_blank', 'noopener')
  }

  // ─ Группировка по ролям с фильтром и поиском ─
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return doctors.filter(d => {
      if (roleFilter !== 'all' && d.role !== roleFilter) return false
      if (!q) return true
      return [d.full_name, d.username, d.specialization, d.phone_number, d.email]
        .some(v => v && String(v).toLowerCase().includes(q))
    })
  }, [doctors, search, roleFilter])

  const grouped = useMemo(() => {
    const acc = {}
    for (const d of filtered) {
      const role = d.role || 'other'
      if (!acc[role]) acc[role] = []
      acc[role].push(d)
    }
    return Object.entries(acc).sort(([a], [b]) => {
      return (ROLE_META[a]?.order || 99) - (ROLE_META[b]?.order || 99)
    })
  }, [filtered])

  // ─ Подсчёт всех ролей для чипов фильтра ─
  const roleCounts = useMemo(() => {
    const acc = { all: doctors.length }
    for (const d of doctors) acc[d.role] = (acc[d.role] || 0) + 1
    return acc
  }, [doctors])

  const presentRoles = useMemo(() => {
    return Object.keys(roleCounts)
      .filter(r => r !== 'all' && roleCounts[r] > 0)
      .sort((a, b) => (ROLE_META[a]?.order || 99) - (ROLE_META[b]?.order || 99))
  }, [roleCounts])

  return (
    <ManagerShell
      active="recruit"
      title="Сотрудники"
      subtitle={`${doctors.length} сотрудников · добавление сотрудников всех ролей`}
      icon="groups"
      topbarRight={
        <Button variant="primary" size="sm" onClick={() => setShowAdd(true)}>
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>person_add</span>
          Добавить
        </Button>
      }
    >
      {editDoc && (
        <EditModal
          doctor={editDoc}
          onClose={() => setEditDoc(null)}
          onProfileSaved={() => { setEditDoc(null); load() }}
          onCredentialsReset={(d) => { setQrResult(d); setEditDoc(null); load() }}
        />
      )}
      {qrResult && <QRPopup data={qrResult} onClose={() => setQrResult(null)} />}
      <AddModal open={showAdd} clinics={clinics} onClose={() => setShowAdd(false)} onDone={d => { setQrResult(d); setShowAdd(false); load() }} />
      {deleteTarget && (
        <DeleteStaffModal
          doctor={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDone={() => { setDeleteTarget(null); load() }}
        />
      )}

      {/* Mobile add */}
      <div className="mb-4 sm:hidden">
        <Button variant="primary" size="md" className="w-full" onClick={() => setShowAdd(true)}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>person_add</span>
          Добавить сотрудника
        </Button>
      </div>

      {/* Поиск */}
      <div className="flex items-center gap-2 mb-3"
           style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '10px 14px' }}>
        <span className="material-symbols-outlined" style={{ color: 'var(--fg-3)', fontSize: 18 }}>search</span>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Поиск по имени, логину, специализации, телефону, email…"
          className="flex-1 text-sm outline-none bg-transparent"
          style={{ color: 'var(--fg)' }}
        />
        {search && (
          <button onClick={() => setSearch('')} style={{ background: 'transparent', color: 'var(--fg-3)', fontSize: 16 }}>✕</button>
        )}
      </div>

      {/* Фильтр-чипы по ролям */}
      {!loading && doctors.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          <button
            onClick={() => setRoleFilter('all')}
            className="text-xs font-semibold transition-colors"
            style={{
              padding: '6px 12px', borderRadius: 999,
              background: roleFilter === 'all' ? 'var(--accent-soft)' : 'var(--surface)',
              color: roleFilter === 'all' ? 'var(--accent)' : 'var(--fg-3)',
              border: `1px solid ${roleFilter === 'all' ? 'var(--accent-line)' : 'var(--border)'}`,
            }}
          >Все · {doctors.length}</button>
          {presentRoles.map(role => {
            const m = ROLE_META[role] || DEFAULT_ROLE_META
            const on = roleFilter === role
            return (
              <button
                key={role}
                onClick={() => setRoleFilter(role)}
                className="text-xs font-semibold transition-colors inline-flex items-center gap-1.5"
                style={{
                  padding: '6px 12px', borderRadius: 999,
                  background: on ? m.bg : 'var(--surface)',
                  color: on ? m.color : 'var(--fg-3)',
                  border: `1px solid ${on ? m.color : 'var(--border)'}`,
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{m.icon}</span>
                {m.label} · {roleCounts[role]}
              </button>
            )
          })}
        </div>
      )}

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
            title={search || roleFilter !== 'all' ? 'Ничего не найдено' : 'Список сотрудников пуст'}
            message={search || roleFilter !== 'all' ? 'Попробуйте изменить запрос или фильтр.' : 'Используйте кнопку «Добавить» — можно создать сотрудника любой роли.'}
            action={!search && roleFilter === 'all' ? (
              <Button variant="primary" size="md" onClick={() => setShowAdd(true)}>Добавить сотрудника</Button>
            ) : null}
          />
        </Card>
      ) : (
        <div className="grid gap-3">
          {grouped.map(([role, list]) => {
            const isCollapsed = !!collapsed[role]
            return (
              <div key={role}>
                <GroupHeader
                  role={role}
                  count={list.length}
                  collapsed={isCollapsed}
                  onToggle={() => setCollapsed(p => ({ ...p, [role]: !p[role] }))}
                />
                {!isCollapsed && (
                  <div className="grid gap-3">
                    {list.map(doc => (
                      <StaffCard
                        key={doc.id} doc={doc}
                        onEdit={setEditDoc}
                        onToggle={toggleActive}
                        onDelete={requestDelete}
                        onChat={openChat}
                        onCall={callPhone}
                        onWhatsapp={whatsappPhone}
                        toggling={toggling}
                        deleting={deleteTarget?.id === doc.id ? doc.id : null}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </ManagerShell>
  )
}
