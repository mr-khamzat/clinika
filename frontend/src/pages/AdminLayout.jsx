import { useEffect, useState, useCallback, useMemo, lazy, Suspense } from 'react'

// ── Лениво загружаемые секции (каждая в своём файле) ──────────────────────
// Добавляй новые секции здесь, не трогая существующий код
const PlatformSection = lazy(() => import('../sections/PlatformSection'))
const WebhooksSection = lazy(() => import('../sections/WebhooksSection'))
const AdsSection = lazy(() => import('../sections/AdsSection'))
const AISection = lazy(() => import('../sections/AISection'))
const BillingLedgerSection = lazy(() => import('../sections/BillingLedgerSection'))
import axios from 'axios'
import HelpModal from '../components/HelpModal'
import AdminSupportPanel from '../components/AdminSupportPanel'
import { API_BASE, BASE_PATH, SLUG } from '../config'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` }
}

function apiFetch(method, url, token, data) {
  return axios({ method, url: `${API_BASE}${url}`, headers: authHeaders(token), data })
}

function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function ErrorBox({ msg }) {
  if (!msg) return null
  return (
    <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-xl p-3 mb-4">
      <p className="text-red-600 dark:text-red-400 text-sm">{msg}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// NAV items
// ---------------------------------------------------------------------------
function SupportAdminWrapper({ token }) {
  return (
    <div className="p-4 md:p-6">
      <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
        <span className="material-symbols-outlined" style={{fontVariationSettings: "'FILL' 1"}}>support_agent</span>
        Чат поддержки
      </h2>
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden">
        <AdminSupportPanel tokenProp={token} />
      </div>
    </div>
  )
}


// Fallback для Suspense — показывается пока секция грузится
function SectionLoader() {
  return (
    <div className="flex items-center justify-center h-48">
      <div className="w-8 h-8 border-4 border-[#0097A7] border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

const NAV = [
  { key: 'home',           label: 'Обзор',        icon: 'dashboard' },
  { key: 'super_admin',    label: 'Франшизы',     icon: 'store' },
  { key: 'billing',        label: 'Биллинг',      icon: 'receipt_long' },
  { key: 'billing_ledger', label: 'Фин. реестр',  icon: 'account_balance_wallet' },
  { key: 'analytics',      label: 'Аналитика',    icon: 'bar_chart' },
  { key: 'ai_analytics',   label: 'AI-анализ',    icon: 'auto_awesome' },
  { key: 'audit',          label: 'Аудит',        icon: 'manage_search' },
  { key: 'monitoring',     label: 'Мониторинг',   icon: 'monitor_heart' },
  { key: 'ads',            label: 'Реклама',      icon: 'campaign' },
  { key: 'webhooks',       label: 'Вебхуки',      icon: 'webhook' },
  { key: 'plugins',        label: 'Плагины',      icon: 'extension' },
  { key: 'mis_sync',       label: 'МИС Sync',     icon: 'sync_alt' },
  { key: 'calls_cfg',      label: 'Звонки/SMS',   icon: 'settings_phone' },
  { key: 'push_notify',    label: 'Push',         icon: 'notifications' },
  { key: 'settings',       label: 'Настройки',    icon: 'settings' },
]

// ---------------------------------------------------------------------------
// Staff section
// ---------------------------------------------------------------------------

const EMPTY_STAFF_FORM = {
  full_name: '',
  telegram_id: '',
  username: '',
  password: '',
  phone_number: '+7',
  date_of_birth: '',
  clinic_id: '',
  role: 'admin',
  category: '',
}

function formatPhone(val) {
  if (!val.startsWith('+7')) return '+7'
  const digits = val.slice(2).replace(/\D/g, '')
  let out = '+7'
  if (digits.length > 0) out += ' (' + digits.slice(0, 3)
  if (digits.length >= 3) out += ') ' + digits.slice(3, 6)
  if (digits.length >= 6) out += '-' + digits.slice(6, 8)
  if (digits.length >= 8) out += '-' + digits.slice(8, 10)
  return out
}

function StaffModal({ token, clinics, existing, onClose, onDone }) {
  const isEdit = !!existing
  const [form, setForm] = useState(
    isEdit
      ? {
          full_name: existing.full_name || '',
          telegram_id: existing.telegram_id ? String(existing.telegram_id) : '',
          username: existing.username || '',
          password: '',
          phone_number: existing.phone_number ? formatPhone(existing.phone_number) : '+7',
          date_of_birth: existing.date_of_birth ? existing.date_of_birth.slice(0, 10) : '',
          clinic_id: existing.clinic_id ? String(existing.clinic_id) : '',
          role: existing.role || 'admin',
          category: existing.category || '',
        }
      : { ...EMPTY_STAFF_FORM }
  )
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.full_name.trim()) { setError('Введите ФИО'); return }
    setLoading(true)
    setError('')
    try {
      const payload = { full_name: form.full_name.trim(), role: form.role }
      if (form.telegram_id.trim()) payload.telegram_id = form.telegram_id.trim()
      if (form.username.trim()) payload.username = form.username.trim()
      if (form.password.trim()) payload.password = form.password.trim()
      payload.phone_number = (form.phone_number && form.phone_number !== '+7') ? form.phone_number : null
      if (form.date_of_birth) payload.date_of_birth = form.date_of_birth
      payload.clinic_id = form.clinic_id || null
      if (!form.clinic_id) payload.unset_clinic = true
      payload.category = form.category || null

      if (isEdit) {
        await apiFetch('patch', `/manager/admins/${existing.id}`, token, payload)
      } else {
        await apiFetch('post', '/manager/admins/', token, payload)
      }
      onDone()
    } catch (err) {
      const _det = err?.response?.data?.detail; const msg = _det?.message || (typeof _det === 'string' ? _det : null) || err?.message || 'Ошибка при сохранении'
      setError(typeof msg === 'string' ? msg : JSON.stringify(msg))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl p-6 w-full sm:max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold text-gray-800 dark:text-white mb-5">
          {isEdit ? 'Редактировать сотрудника' : 'Новый сотрудник'}
        </h2>

        <ErrorBox msg={error} />

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              ФИО <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.full_name}
              onChange={e => set('full_name', e.target.value)}
              placeholder="Иванов Иван Иванович"
              className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-800 dark:text-white bg-white dark:bg-gray-900 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Telegram ID</label>
              <input
                type="text"
                value={form.telegram_id}
                onChange={e => set('telegram_id', e.target.value)}
                placeholder="293633093"
                className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-800 dark:text-white bg-white dark:bg-gray-900 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Логин</label>
              <input
                type="text"
                value={form.username}
                onChange={e => set('username', e.target.value)}
                placeholder="login"
                className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-800 dark:text-white bg-white dark:bg-gray-900 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              Пароль{isEdit ? ' (оставьте пустым, чтобы не менять)' : ''}
            </label>
            <input
              type="password"
              value={form.password}
              onChange={e => set('password', e.target.value)}
              placeholder="••••••••"
              className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-800 dark:text-white bg-white dark:bg-gray-900 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Телефон</label>
              <input
                type="tel"
                value={form.phone_number}
                onChange={e => set('phone_number', formatPhone(e.target.value))}
                onFocus={e => { if (e.target.value === '+7') setTimeout(() => e.target.setSelectionRange(e.target.value.length, e.target.value.length), 0) }}
                placeholder="+7 (900) 000-00-00"
                className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-800 dark:text-white bg-white dark:bg-gray-900 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Дата рождения</label>
              <input
                type="date"
                value={form.date_of_birth}
                onChange={e => set('date_of_birth', e.target.value)}
                className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-800 dark:text-white bg-white dark:bg-gray-900 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Клиника</label>
              <select
                value={form.clinic_id}
                onChange={e => set('clinic_id', e.target.value)}
                className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-800 dark:text-white bg-white dark:bg-gray-900 focus:outline-none focus:border-blue-500"
              >
                <option value="">Без клиники</option>
                {clinics.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Роль</label>
              <select
                value={form.role}
                onChange={e => set('role', e.target.value)}
                className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-800 dark:text-white bg-white dark:bg-gray-900 focus:outline-none focus:border-blue-500"
              >
                <option value="admin">Администратор</option>
                <option value="manager">Руководитель</option>
                <option value="doctor">Врач (кабинет врача)</option>
                <option value="nurse">Медсестра</option>
                <option value="recruiter">Менеджер (рекрутер)</option>
                <option value="supervisor">Владелец франшизы</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Должность</label>
              <select
                value={form.category}
                onChange={e => set('category', e.target.value)}
                className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-800 dark:text-white bg-white dark:bg-gray-900 focus:outline-none focus:border-blue-500"
              >
                <option value="">Не указана</option>
                <option value="doctor">Врач</option>
                <option value="nurse">Медсестра</option>
              </select>
            </div>
          </div>

          {isEdit && (
            <div className="flex items-center justify-between py-3 border-t border-gray-100 dark:border-gray-700">
              <div>
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Статус клиники</p>
                <p className="text-xs text-gray-400">Неактивная клиника скрыта во всех кабинетах</p>
              </div>
              <button type="button" onClick={() => set('is_active', !form.is_active)}
                className={`relative w-12 h-6 rounded-full transition-colors ${form.is_active ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.is_active ? 'translate-x-6' : ''}`} />
              </button>
            </div>
          )}
          {isEdit && (
            <div className="flex items-center justify-between py-3 border-t border-gray-100 dark:border-gray-700">
              <div>
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Статус клиники</p>
                <p className="text-xs text-gray-400">Неактивная клиника скрыта во всех кабинетах</p>
              </div>
              <button type="button" onClick={() => set('is_active', !form.is_active)}
                className={`relative w-12 h-6 rounded-full transition-colors ${form.is_active ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.is_active ? 'translate-x-6' : ''}`} />
              </button>
            </div>
          )}
          <div className="flex gap-3 mt-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-xl py-2.5 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-blue-600 text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-50 hover:bg-blue-700 transition"
            >
              {loading ? 'Сохранение...' : isEdit ? 'Сохранить' : 'Создать'}
            </button>
          </div>
        </form>

        {isEdit && (
          <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
            <button type="button" onClick={() => setConfirmDelete(true)}
              className="w-full border border-red-200 text-red-500 rounded-xl py-2.5 text-sm font-medium hover:bg-red-50 transition">
              Удалить сотрудника
            </button>
          </div>
        )}
      </div>

      {/* Delete confirmation overlay — rendered on top of the modal */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="text-lg font-bold text-gray-800 dark:text-white mb-2 text-center">Удалить сотрудника?</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center mb-5">
              Аккаунт будет удалён безвозвратно. Направления останутся в системе.
            </p>
            <div className="flex gap-3">
              <button type="button" onClick={() => setConfirmDelete(false)}
                className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-xl py-2.5 text-sm font-medium">
                Отмена
              </button>
              <button type="button" disabled={deleting}
                onClick={async () => {
                  setDeleting(true)
                  try {
                    await apiFetch('delete', `/manager/admins/${existing.id}?hard=true`, token)
                    onDone()
                  } catch (e) {
                    alert(e?.response?.data?.detail || 'Ошибка удаления')
                    setConfirmDelete(false)
                  } finally { setDeleting(false) }
                }}
                className="flex-1 bg-red-500 text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-50">
                {deleting ? 'Удаление...' : 'Удалить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// HomeDashboard — главная панель системного администратора
// ---------------------------------------------------------------------------

function PushSection({ token }) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [phone, setPhone] = useState('')
  const [sendAll, setSendAll] = useState(false)
  const [loading, setLoading] = useState(false)
  const [stats, setStats] = useState(null)
  const [result, setResult] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    apiFetch('get', '/manager/push/stats', token)
      .then(r => setStats(r.data))
      .catch(() => {})
  }, [token])

  const handleSend = async (e) => {
    e.preventDefault()
    if (!title || !body) { setErr('Заполните заголовок и текст'); return }
    if (!sendAll && !phone) { setErr('Укажите телефон или выберите Всем'); return }
    setLoading(true); setErr(''); setResult(null)
    try {
      const payload = { title, body, ...(sendAll ? {} : { phone }) }
      const r = await apiFetch('post', '/manager/push/send', token, payload)
      setResult({ sent: r.data.sent })
      setTitle(''); setBody(''); setPhone('')
    } catch (e) {
      setErr(e.response?.data?.detail || 'Ошибка отправки')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-4">Push-уведомления</h2>
      <div className="grid md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm text-center">
          <p className="text-3xl font-extrabold text-blue-600">{stats?.total_subscriptions ?? '—'}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Активных подписок</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm text-center">
          <div className="flex items-center justify-center gap-1.5 mb-1">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            <p className="text-sm font-medium text-emerald-600">Web Push активен</p>
          </div>
          <p className="text-xs text-gray-400">VAPID протокол</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm flex items-center">
          <p className="text-xs text-gray-500 dark:text-gray-400">Push рассылка в реальном времени. Уведомления доходят даже когда браузер закрыт.</p>
        </div>
      </div>
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm max-w-lg">
        <h3 className="text-base font-semibold text-gray-700 dark:text-gray-200 mb-4">Отправить уведомление</h3>
        <form onSubmit={handleSend} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Заголовок</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Напр. Напоминание о приёме"
              className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-800 dark:text-white bg-white dark:bg-gray-900 focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Текст уведомления</label>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={3} placeholder="Текст сообщения..."
              className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-800 dark:text-white bg-white dark:bg-gray-900 focus:outline-none focus:border-blue-500 resize-none" />
          </div>
          <div className="flex items-center gap-2 py-1">
            <button type="button" onClick={() => setSendAll(!sendAll)}
              className={"relative w-10 h-5 rounded-full transition-colors " + (sendAll ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600')}>
              <span className={"absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform " + (sendAll ? 'translate-x-5' : '')} />
            </button>
            <span className="text-sm text-gray-600 dark:text-gray-300">Отправить всем пациентам</span>
          </div>
          {!sendAll && (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Телефон пациента</label>
              <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+7 900 000-00-00" type="tel"
                className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-800 dark:text-white bg-white dark:bg-gray-900 focus:outline-none focus:border-blue-500" />
            </div>
          )}
          {err && <p className="text-red-500 text-sm">{err}</p>}
          {result && (
            <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 rounded-xl p-3">
              <p className="text-emerald-700 dark:text-emerald-300 text-sm font-medium">
                Отправлено: {result.sent} устройств{result.sent === 0 ? ' — нет активных подписок' : ''}
              </p>
            </div>
          )}
          <button type="submit" disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-2.5 text-sm font-semibold transition disabled:opacity-50 flex items-center justify-center gap-2">
            <span className="material-symbols-outlined text-base">send</span>
            {loading ? 'Отправка...' : sendAll ? 'Отправить всем' : 'Отправить'}
          </button>
        </form>
      </div>
    </div>
  )
}

function HomeDashboard({ token, onNavigate }) {
  const [metrics, setMetrics] = useState(null)
  const [ledger, setLedger] = useState(null)
  const [health, setHealth] = useState(null)
  const [apiMetrics, setApiMetrics] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.allSettled([
      apiFetch("get", "/admin/metrics", token),
      apiFetch("get", "/admin/billing/ledger?days=30", token),
      apiFetch("get", "/monitoring/health", token),
      apiFetch("get", "/monitoring/metrics?window=5", token),
    ]).then(([mR, lR, hR, aR]) => {
      if (mR.status === "fulfilled") setMetrics(mR.value.data)
      if (lR.status === "fulfilled") setLedger(lR.value.data)
      if (hR.status === "fulfilled") setHealth(hR.value.data)
      if (aR.status === "fulfilled") setApiMetrics(aR.value.data)
      setLoading(false)
    })
  }, [token])

  const fmt = (n) => n != null ? Number(n).toLocaleString("ru-RU") : "—"
  const fmtRub = (n) => n != null ? Number(n).toLocaleString("ru-RU") + " ₽" : "—"

  const kpis = [
    { icon: "store",         label: "Активных франшиз",  value: fmt(metrics?.tenants_active),   color: "#006173", bg: "rgba(0,97,115,0.08)",   nav: "super_admin" },
    { icon: "group",         label: "Пользователей",      value: fmt(metrics?.users_total),      color: "#7c3aed", bg: "rgba(124,58,237,0.08)", nav: null },
    { icon: "local_hospital",label: "Клиник",             value: fmt(metrics?.clinics_total),    color: "#0369a1", bg: "rgba(3,105,161,0.08)",  nav: null },
    { icon: "moving",        label: "Направлений всего",  value: fmt(metrics?.referrals_total),  color: "#166534", bg: "rgba(22,163,74,0.08)",  nav: null },
  ]

  const subStatus = metrics?.subscriptions_by_status || {}
  const subTotal = Object.values(subStatus).reduce((s, v) => s + v, 0)
  const SUB_LABELS = { trial: "Пробный", active: "Активные", past_due: "Просрочено", cancelled: "Отменено", trial_expired: "Trial истёк" }
  const SUB_COLORS = { trial: "#d97706", active: "#166534", past_due: "#dc2626", cancelled: "#6b7280", trial_expired: "#dc2626" }
  const planColors = { basic: "#0369a1", professional: "#7c3aed", enterprise: "#d97706" }
  const planLabels = { basic: "Basic", professional: "Professional", enterprise: "Enterprise" }

  const sysCards = [
    { label: "API",        icon: "api",      ok: true,                     val: apiMetrics?.p50 ? apiMetrics.p50.toFixed(0) + " ms" : "онлайн", sub: "Время ответа" },
    { label: "PostgreSQL", icon: "database", ok: health?.db === "ok",      val: health?.db === "ok" ? "онлайн" : "ошибка",     sub: "База данных" },
    { label: "Redis",      icon: "memory",   ok: health?.redis === "ok",   val: health?.redis === "ok" ? "онлайн" : "ошибка",  sub: "Кэш" },
    { label: "МИС",        icon: "cloud",    ok: health?.mis !== "error",  val: health?.mis !== "error" ? "онлайн" : "недоступна", sub: "Интеграция" },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-headline font-extrabold text-ms-on-surface dark:text-white tracking-tight">Обзор платформы</h2>
        <p className="text-sm text-ms-on-surface-variant dark:text-gray-400 mt-1">КлиникСеть — панель платформовладельца</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpis.map(k => (
          <div key={k.label}
            onClick={() => k.nav && onNavigate?.(k.nav)}
            className={"bg-white dark:bg-gray-800 rounded-2xl p-4 transition-all duration-200" + (k.nav ? " cursor-pointer hover:scale-[1.02]" : "")}
            style={{ boxShadow: "0 4px 20px rgba(25,28,30,0.06)" }}>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-3" style={{ background: k.bg }}>
              <span className="material-symbols-outlined text-lg" style={{ color: k.color, fontVariationSettings: "FILL 1" }}>{k.icon}</span>
            </div>
            <p className="text-2xl font-extrabold font-headline dark:text-white" style={{ color: k.color }}>
              {loading ? "…" : k.value}
            </p>
            <p className="text-xs text-ms-on-surface-variant dark:text-gray-400 mt-0.5">{k.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-5" style={{ boxShadow: "0 4px 20px rgba(25,28,30,0.06)" }}>
          <p className="font-headline font-bold text-ms-on-surface dark:text-white text-sm mb-4">Финансы платформы (30 дней)</p>
          {loading ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-8 bg-gray-100 dark:bg-gray-700 rounded-lg animate-pulse" />)}</div>
          ) : (
            <div className="space-y-3">
              <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-700">
                <span className="text-sm text-gray-500">Доход платформы</span>
                <span className="text-sm font-bold text-emerald-600">{fmtRub(ledger?.platform_income)}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-700">
                <span className="text-sm text-gray-500">Суммарный оборот</span>
                <span className="text-sm font-bold text-gray-800 dark:text-white">{fmtRub(ledger?.total_credit)}</span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-sm text-gray-500">Записей в реестре</span>
                <span className="text-sm font-bold text-gray-800 dark:text-white">
                  {fmt(Object.values(ledger?.breakdown || {}).reduce((s, v) => s + (v.count || 0), 0))}
                </span>
              </div>
              <button onClick={() => onNavigate?.("billing_ledger")}
                className="w-full mt-2 py-2 rounded-xl text-xs font-semibold text-teal-600 dark:text-teal-400 border border-teal-200 dark:border-teal-800 hover:bg-teal-50 dark:hover:bg-teal-900/20 transition">
                Открыть Фин. реестр →
              </button>
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl p-5" style={{ boxShadow: "0 4px 20px rgba(25,28,30,0.06)" }}>
          <p className="font-headline font-bold text-ms-on-surface dark:text-white text-sm mb-4">{"Подписки (" + subTotal + " всего)"}</p>
          {loading ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-8 bg-gray-100 dark:bg-gray-700 rounded-lg animate-pulse" />)}</div>
          ) : (
            <div className="space-y-2">
              {Object.entries(subStatus).map(([status, count]) => (
                <div key={status} className="flex items-center justify-between py-1.5">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ background: SUB_COLORS[status] || "#6b7280" }} />
                    <span className="text-sm text-gray-600 dark:text-gray-300">{SUB_LABELS[status] || status}</span>
                  </div>
                  <span className="text-sm font-bold" style={{ color: SUB_COLORS[status] || "#6b7280" }}>{count}</span>
                </div>
              ))}
              {Object.keys(metrics?.tenants_by_plan || {}).length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
                  <p className="text-xs text-gray-400 mb-2">По тарифам</p>
                  <div className="flex gap-2 flex-wrap">
                    {Object.entries(metrics.tenants_by_plan).map(([plan, cnt]) => (
                      <span key={plan} className="px-2 py-0.5 rounded-full text-xs font-semibold text-white"
                        style={{ background: planColors[plan] || "#6b7280" }}>
                        {(planLabels[plan] || plan) + ": " + cnt}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <button onClick={() => onNavigate?.("billing")}
                className="w-full mt-2 py-2 rounded-xl text-xs font-semibold text-teal-600 dark:text-teal-400 border border-teal-200 dark:border-teal-800 hover:bg-teal-50 dark:hover:bg-teal-900/20 transition">
                Управление биллингом →
              </button>
            </div>
          )}
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Состояние системы</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {sysCards.map(s => (
            <button key={s.label} onClick={() => onNavigate?.("monitoring")}
              className="bg-white dark:bg-gray-800 rounded-2xl p-4 text-left hover:scale-[1.02] transition-all duration-200 w-full"
              style={{ boxShadow: "0 4px 20px rgba(25,28,30,0.06)" }}>
              <div className="flex items-center justify-between mb-2">
                <div className={"w-8 h-8 rounded-xl flex items-center justify-center " + (s.ok ? "bg-emerald-50" : "bg-red-50")}>
                  <span className="material-symbols-outlined text-base" style={{ color: s.ok ? "#166534" : "#ba1a1a", fontVariationSettings: "FILL 1" }}>{s.icon}</span>
                </div>
                <span className={"text-[10px] font-bold px-2 py-0.5 rounded-full " + (s.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")}>
                  {s.ok ? "● OK" : "● ERR"}
                </span>
              </div>
              <p className="text-base font-extrabold font-headline dark:text-white" style={{ color: s.ok ? "#166534" : "#ba1a1a" }}>{loading ? "…" : s.val}</p>
              <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-300 mt-0.5">{s.label}</p>
              <p className="text-[10px] text-gray-400 dark:text-gray-500">{s.sub}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}


function StaffSection({ token }) {
  const [admins, setAdmins] = useState([])
  const [clinics, setClinics] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [managerByClinic, setManagerByClinic] = useState({}) // clinic_id -> manager|null
  const [createManagerFor, setCreateManagerFor] = useState(null) // clinic object
  const [credentials, setCredentials] = useState(null)
  const [deactivating, setDeactivating] = useState(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [ar, cr] = await Promise.all([
        apiFetch('get', '/admins/', token),
        apiFetch('get', '/manager/clinics/', token),
      ])
      setAdmins(Array.isArray(ar.data) ? ar.data : [])
      setClinics(Array.isArray(cr.data) ? cr.data : [])
    } catch {
      setError('Не удалось загрузить данные')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { fetchData() }, [fetchData])

  const handleDeactivate = async (admin) => {
    if (!window.confirm(`Деактивировать ${admin.full_name}?`)) return
    setDeactivating(admin.id)
    try {
      await apiFetch('delete', `/manager/admins/${admin.id}`, token)
      fetchData()
    } catch (err) {
      alert(err?.response?.data?.detail || 'Ошибка при деактивации')
    } finally {
      setDeactivating(null)
    }
  }

  const clinicName = (id) => clinics.find(c => c.id === id)?.name || '—'

  const filtered = admins.filter(a => {
    if (roleFilter === 'manager' && a.role !== 'manager') return false
    if (roleFilter === 'admin' && (a.role !== 'admin' || a.category)) return false
    if (roleFilter === 'doctor' && a.category !== 'doctor') return false
    if (roleFilter === 'nurse' && a.category !== 'nurse') return false
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      (a.full_name || '').toLowerCase().includes(q) ||
      (a.phone_number || '').toLowerCase().includes(q) ||
      (a.username || '').toLowerCase().includes(q)
    )
  })

  // Группировка по клинике
  const grouped = useMemo(() => {
    const map = {}
    filtered.forEach(a => {
      const key = a.clinic_id || '__none__'
      if (!map[key]) map[key] = []
      map[key].push(a)
    })
    return Object.entries(map).sort(([ak], [bk]) => {
      if (ak === '__none__') return 1
      if (bk === '__none__') return -1
      return clinicName(ak).localeCompare(clinicName(bk), 'ru')
    })
  }, [filtered, clinics])

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-bold text-gray-800 dark:text-white">Сотрудники</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-4 py-2 text-sm font-medium transition"
        >
          + Добавить сотрудника
        </button>
      </div>

      <div className="mb-4 space-y-2">
        {/* Фильтр по роли */}
        <div className="flex gap-1.5 flex-wrap">
          {[
            { key: 'all', label: 'Все' },
            { key: 'manager', label: 'Руководители' },
            { key: 'admin', label: 'Администраторы' },
            { key: 'doctor', label: 'Врачи' },
            { key: 'nurse', label: 'Медсёстры' },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setRoleFilter(f.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                roleFilter === f.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {/* Поиск */}
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Поиск по имени, телефону, логину..."
          className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-2.5 text-sm text-gray-800 dark:text-white bg-white dark:bg-gray-800 focus:outline-none focus:border-blue-500"
        />
      </div>

      <ErrorBox msg={error} />

      {loading ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-10 text-center text-gray-400 dark:text-gray-500 text-sm shadow-sm">
          {search.trim() ? 'Ничего не найдено' : 'Сотрудников нет'}
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map(([clinicKey, members]) => (
            <div key={clinicKey} className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden">
              {/* Заголовок клиники */}
              <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-700">
                <span className="text-sm">🏥</span>
                <span className="text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
                  {clinicKey === '__none__' ? 'Без клиники' : clinicName(clinicKey)}
                </span>
                <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">{members.length} чел.</span>
              </div>

              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-gray-700">
                      <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-2.5">ФИО</th>
                      <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-2.5">Логин / TG</th>
                      <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-2.5">Роль / Должность</th>
                      <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-2.5">Телефон</th>
                      <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-2.5">Статус</th>
                      <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-2.5">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((a, i) => (
                      <tr key={a.id} className={`border-b border-gray-50 dark:border-gray-700 ${i % 2 === 0 ? '' : 'bg-gray-50/50 dark:bg-gray-900/30'}`}>
                        <td className="px-4 py-3 font-medium text-gray-800 dark:text-white">{a.full_name || '—'}</td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                          {a.username && <div className="text-xs">{a.username}</div>}
                          {a.telegram_id && <div className="text-xs text-blue-500">TG: {a.telegram_id}</div>}
                          {!a.username && !a.telegram_id && '—'}
                        </td>
                        <td className="px-4 py-3">
                          {a.role === 'manager' ? (
                            <span className="inline-block bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 text-xs font-semibold px-2 py-0.5 rounded-full">Руководитель</span>
                          ) : (
                            <span className="inline-block bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs font-semibold px-2 py-0.5 rounded-full">Администратор</span>
                          )}
                          {a.category && (
                            <div className="mt-0.5">
                              <span className="inline-block bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs px-2 py-0.5 rounded-full">
                                {a.category === 'doctor' ? 'Врач' : a.category === 'nurse' ? 'Медсестра' : a.category}
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{a.phone_number || '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${a.is_active !== false ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'}`}>
                            {a.is_active !== false ? 'Активен' : 'Заблокирован'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <button onClick={() => setEditTarget(a)}
                              className="text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg px-2.5 py-1.5 font-medium transition">
                              Изменить
                            </button>
                            {a.is_active !== false && (
                              <button onClick={() => handleDeactivate(a)} disabled={deactivating === a.id}
                                className="text-xs bg-red-50 dark:bg-red-900/20 hover:bg-red-100 text-red-600 dark:text-red-400 rounded-lg px-2.5 py-1.5 font-medium transition disabled:opacity-50">
                                {deactivating === a.id ? '...' : 'Деактивировать'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden divide-y divide-gray-100 dark:divide-gray-700">
                {members.map(a => (
                  <div key={a.id} className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-semibold text-gray-800 dark:text-white">{a.full_name}</p>
                        {a.phone_number && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{a.phone_number}</p>}
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${a.role === 'manager' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}>
                          {a.role === "manager" ? "Руководитель" : a.role === "doctor" ? "Врач" : a.role === "nurse" ? "Медсестра" : a.role === "recruiter" ? "Менеджер" : "Администратор"}
                        </span>
                        {a.category && (
                          <span className="text-xs bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full">
                            {a.category === 'doctor' ? 'Врач' : 'Медсестра'}
                          </span>
                        )}
                      </div>
                    </div>
                    {a.telegram_id && <p className="text-xs text-blue-500 mb-2">TG: {a.telegram_id}</p>}
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${a.is_active !== false ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'}`}>
                        {a.is_active !== false ? 'Активен' : 'Заблокирован'}
                      </span>
                      <div className="flex gap-2">
                        <button onClick={() => setEditTarget(a)}
                          className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg px-3 py-1.5 font-medium">
                          Изменить
                        </button>
                        {a.is_active !== false && (
                          <button onClick={() => handleDeactivate(a)} disabled={deactivating === a.id}
                            className="text-xs bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg px-3 py-1.5 font-medium disabled:opacity-50">
                            {deactivating === a.id ? '...' : 'Деактивировать'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <StaffModal
          token={token}
          clinics={clinics}
          existing={null}
          onClose={() => setShowCreate(false)}
          onDone={() => { setShowCreate(false); fetchData() }}
        />
      )}
      {editTarget && (
        <StaffModal
          token={token}
          clinics={clinics}
          existing={editTarget}
          onClose={() => setEditTarget(null)}
          onDone={() => { setEditTarget(null); fetchData() }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Clinics section
// ---------------------------------------------------------------------------

const EMPTY_CLINIC_FORM = { name: '', address: '', phone: '' }

function ClinicModal({ token, existing, onClose, onDone }) {
  const isEdit = !!existing
  const [form, setForm] = useState(
    isEdit
      ? { name: existing.name || '', address: existing.address || '', phone: existing.phone || '', is_active: existing.is_active !== false }
      : { ...EMPTY_CLINIC_FORM, is_active: true }
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) { setError('Введите название клиники'); return }
    setLoading(true)
    setError('')
    try {
      const payload = { name: form.name.trim(), is_active: form.is_active }
      if (form.address.trim()) payload.address = form.address.trim()
      if (form.phone.trim()) payload.phone = form.phone.trim()

      if (isEdit) {
        await apiFetch('patch', `/manager/clinics/${existing.id}`, token, payload)
      } else {
        await apiFetch('post', '/manager/clinics/', token, payload)
      }
      onDone()
    } catch (err) {
      const _det = err?.response?.data?.detail; const msg = _det?.message || (typeof _det === 'string' ? _det : null) || err?.message || 'Ошибка при сохранении'
      setError(typeof msg === 'string' ? msg : JSON.stringify(msg))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl p-6 w-full sm:max-w-md shadow-2xl">
        <h2 className="text-lg font-bold text-gray-800 dark:text-white mb-5">
          {isEdit ? 'Редактировать клинику' : 'Новая клиника'}
        </h2>

        <ErrorBox msg={error} />

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              Название <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="Клиника Здоровье"
              className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-800 dark:text-white bg-white dark:bg-gray-900 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Адрес</label>
            <input
              type="text"
              value={form.address}
              onChange={e => set('address', e.target.value)}
              placeholder="ул. Примерная, д. 1"
              className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-800 dark:text-white bg-white dark:bg-gray-900 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Телефон</label>
            <input
              type="tel"
              value={form.phone}
              onChange={e => set('phone', e.target.value)}
              placeholder="+7 900 000-00-00"
              className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-800 dark:text-white bg-white dark:bg-gray-900 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex gap-3 mt-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-xl py-2.5 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-blue-600 text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-50 hover:bg-blue-700 transition"
            >
              {loading ? 'Сохранение...' : isEdit ? 'Сохранить' : 'Создать'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}


function CreateClinicManagerModal({ token, clinic, onClose, onCreated }) {
  const [form, setForm] = React.useState({ full_name: '', phone_number: '' })
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')

  const handleSubmit = async () => {
    if (!form.full_name.trim()) { setError('Введите ФИО'); return }
    setLoading(true); setError('')
    try {
      const res = await apiFetch('post', '/manager/clinics/' + clinic.id + '/onboard-manager', token, form)
      onCreated(res.data)
    } catch (e) {
      setError((e && e.response && e.response.data && e.response.data.detail) || 'Ошибка создания')
    } finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Назначить управляющего</h3>
            <p className="text-xs text-gray-500 mt-0.5">{clinic.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="px-6 py-4 space-y-4">
          {error && <div className="bg-red-50 text-red-600 text-sm rounded-xl px-4 py-3">{error}</div>}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">ФИО</label>
            <input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
              placeholder="Иванов Иван Иванович"
              className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Телефон</label>
            <input value={form.phone_number} onChange={e => setForm(f => ({ ...f, phone_number: e.target.value }))}
              placeholder="+7 999 000 00 00"
              className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none" />
          </div>
          <p className="text-xs text-gray-400">Логин и пароль сгенерируются автоматически.</p>
        </div>
        <div className="flex gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-700">
          <button onClick={onClose} className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-xl py-2.5 text-sm font-medium hover:bg-gray-50 transition">Отмена</button>
          <button onClick={handleSubmit} disabled={loading} className="flex-1 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-xl py-2.5 text-sm font-bold transition">{loading ? 'Создание...' : 'Создать'}</button>
        </div>
      </div>
    </div>
  )
}

function ClinicCredentialsModal({ credentials, onClose }) {
  const [copied, setCopied] = React.useState(false)
  const copyAll = () => {
    const t = 'Клиника: ' + credentials.clinic_name + '\n' + 'Логин: ' + credentials.username + '\n' + 'Пароль: ' + credentials.password
    navigator.clipboard.writeText(t).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md">
        <div className="px-6 pt-6 pb-2 text-center">
          <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <span className="material-symbols-outlined text-3xl text-green-600" style={{ fontVariationSettings: "'FILL' 1" }}>key</span>
          </div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">Управляющий создан</h3>
          <p className="text-xs text-gray-400 mt-1">Сохраните данные — пароль больше не будет показан</p>
        </div>
        <div className="px-6 py-4">
          <div className="bg-gray-50 dark:bg-gray-700/60 rounded-xl p-4 space-y-2.5 font-mono text-sm">
            <div className="flex justify-between"><span className="text-gray-400 text-xs">Клиника</span><span className="font-semibold text-gray-800 dark:text-white">{credentials.clinic_name}</span></div>
            <div className="flex justify-between"><span className="text-gray-400 text-xs">ФИО</span><span className="font-semibold text-gray-800 dark:text-white">{credentials.full_name}</span></div>
            <div className="border-t border-gray-200 pt-2.5 flex justify-between"><span className="text-gray-400 text-xs">Логин</span><span className="font-bold text-blue-600">{credentials.username}</span></div>
            <div className="flex justify-between"><span className="text-gray-400 text-xs">Пароль</span><span className="font-bold text-purple-600 tracking-widest">{credentials.password}</span></div>
          </div>
          <button onClick={copyAll} className="mt-3 w-full bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl py-2.5 text-sm font-medium transition flex items-center justify-center gap-2">
            <span className="material-symbols-outlined text-base">{copied ? 'check' : 'content_copy'}</span>
            {copied ? 'Скопировано!' : 'Скопировать всё'}
          </button>
        </div>
        <div className="px-6 pb-6">
          <button onClick={onClose} className="w-full bg-green-600 hover:bg-green-700 text-white rounded-xl py-2.5 text-sm font-bold transition">Готово, сохранил</button>
        </div>
      </div>
    </div>
  )
}

function ClinicsSection({ token, isClinicManager }) {
  const [clinics, setClinics] = useState([])
  const [staffByClinic, setStaffByClinic] = useState({}) // clinic_id -> [staff]
  const [expanded, setExpanded] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadingStaff, setLoadingStaff] = useState(null)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [managerByClinic, setManagerByClinic] = useState({})
  const [createManagerFor, setCreateManagerFor] = useState(null)
  const [credentials, setCredentials] = useState(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch('get', '/manager/clinics/', token)
      setClinics(Array.isArray(res.data) ? res.data : [])
    } catch {
      setError('Не удалось загрузить клиники')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { fetchData() }, [fetchData])

  const toggleClinic = async (clinic) => {
    if (expanded === clinic.id) {
      setExpanded(null)
      return
    }
    setExpanded(clinic.id)
    if (staffByClinic[clinic.id]) return // already loaded
    setLoadingStaff(clinic.id)
    try {
      const [staffRes, mgrRes] = await Promise.all([
        apiFetch('get', '/admins/', token),
        apiFetch('get', `/manager/clinics/${clinic.id}/manager`, token),
      ])
      const all = Array.isArray(staffRes.data) ? staffRes.data : []
      const byClinic = {}
      all.forEach(a => {
        const cid = a.clinic_id || 'none'
        if (!byClinic[cid]) byClinic[cid] = []
        byClinic[cid].push(a)
      })
      setStaffByClinic(byClinic)
      setManagerByClinic(prev => ({ ...prev, [clinic.id]: mgrRes.data?.manager || null }))
    } catch {
      // ignore
    } finally {
      setLoadingStaff(null)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-bold text-gray-800 dark:text-white">Клиники</h2>
        {!isClinicManager && (
          <button onClick={() => setShowCreate(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-4 py-2 text-sm font-medium transition">
            + Добавить клинику
          </button>
        )}
      </div>

      <ErrorBox msg={error} />

      {loading ? <Spinner /> : (
        <div className="space-y-3">
          {clinics.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-2xl p-8 text-center text-gray-400 text-sm shadow-sm">Клиник нет</div>
          ) : clinics.map(c => {
            const isOpen = expanded === c.id
            const staff = staffByClinic[c.id] || []
            const isLoadingThis = loadingStaff === c.id
            return (
              <div key={c.id} className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden">
                {/* Clinic header */}
                <button onClick={() => toggleClinic(c)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${c.is_active !== false ? 'bg-blue-100 dark:bg-blue-900/30' : 'bg-gray-100 dark:bg-gray-700'}`}>
                      <span className="text-lg">{c.is_active !== false ? '🏥' : '🔒'}</span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className={`font-semibold ${c.is_active !== false ? 'text-gray-800 dark:text-white' : 'text-gray-400 dark:text-gray-500 line-through'}`}>{c.name}</p>
                        {c.is_active === false && (
                          <span className="text-[10px] font-bold bg-red-50 text-red-600 px-1.5 py-0.5 rounded">ОТКЛ</span>
                        )}
                      </div>
                      {c.address && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{c.address}</p>}
                      {c.phone && <p className="text-xs text-gray-400 dark:text-gray-500">{c.phone}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 dark:text-gray-500 hidden sm:inline">
                      {staffByClinic[c.id] ? `${staffByClinic[c.id].length} сотр.` : ''}
                    </span>
                    <button onClick={e => { e.stopPropagation(); setEditTarget(c) }}
                      className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg px-2.5 py-1 font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition">
                      Изменить
                    </button>
                    <svg className={`w-5 h-5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </div>
                </button>

                {/* Expanded staff list */}
                {isOpen && (
                  <div className="border-t border-gray-100 dark:border-gray-700 px-5 py-3">
                    {!isClinicManager && (
                      <div className="mb-4 bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3">
                        <p className="text-xs font-semibold text-gray-500 mb-2">УПРАВЛЯЮЩИЙ</p>
                        {isLoadingThis ? null : managerByClinic[c.id] ? (
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-purple-500 flex items-center justify-center flex-shrink-0">
                              <span className="text-white text-xs font-bold">{(managerByClinic[c.id].full_name||'?').charAt(0).toUpperCase()}</span>
                            </div>
                            <div><p className="text-sm font-medium text-gray-800 dark:text-white">{managerByClinic[c.id].full_name}</p><p className="text-xs text-gray-400">@{managerByClinic[c.id].username}</p></div>
                          </div>
                        ) : (
                          <button onClick={() => setCreateManagerFor(c)} className="w-full text-sm text-purple-600 border border-dashed border-purple-300 rounded-xl py-2 hover:bg-purple-50 transition">+ Назначить управляющего</button>
                        )}
                      </div>
                    )}
                    {isLoadingThis ? (
                      <p className="text-sm text-gray-400 py-3 text-center">Загрузка...</p>
                    ) : staff.length === 0 ? (
                      <p className="text-sm text-gray-400 py-3 text-center">Нет сотрудников</p>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">СОТРУДНИКИ ({staff.length})</p>
                        {staff.map(a => (
                          <div key={a.id} className="flex items-center justify-between py-2 border-b border-gray-50 dark:border-gray-700/50 last:border-0">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
                                <span className="text-white text-xs font-bold">{(a.full_name || '?').charAt(0).toUpperCase()}</span>
                              </div>
                              <div>
                                <p className="text-sm font-medium text-gray-800 dark:text-white">{a.full_name}</p>
                                {a.phone_number && <p className="text-xs text-gray-400">{a.phone_number}</p>}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {a.category && (
                                <span className="text-xs bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full">
                                  {a.category === 'doctor' ? 'Врач' : 'Медсестра'}
                                </span>
                              )}
                              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                                a.role === 'manager' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                              }`}>
                                {a.role === "manager" ? "Руководитель" : a.role === "doctor" ? "Врач" : a.role === "nurse" ? "Медсестра" : a.role === "recruiter" ? "Менеджер" : "Администратор"}
                              </span>
                              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${a.is_active !== false ? 'bg-green-500' : 'bg-red-400'}`} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showCreate && (
        <ClinicModal token={token} existing={null}
          onClose={() => setShowCreate(false)}
          onDone={() => { setShowCreate(false); fetchData() }} />
      )}
      {editTarget && (
        <ClinicModal token={token} existing={editTarget}
          onClose={() => setEditTarget(null)}
          onDone={() => { setEditTarget(null); setStaffByClinic({}); fetchData() }} />
      )}
      {createManagerFor && !createManagerFor._edit && (
        <CreateClinicManagerModal
          token={token}
          clinic={createManagerFor}
          onClose={() => setCreateManagerFor(null)}
          onCreated={(creds) => {
            setManagerByClinic(prev => ({ ...prev, [createManagerFor.id]: { full_name: creds.full_name, username: creds.username, phone_number: creds.phone_number || '' } }))
            setCreateManagerFor(null)
            setCredentials(creds)
          }}
        />
      )}
      {credentials && (
        <ClinicCredentialsModal
          credentials={credentials}
          onClose={() => setCredentials(null)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Reports section
// ---------------------------------------------------------------------------

function StatCard({ label, value, color }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm text-center">
      <p className={`text-2xl font-bold ${color || 'text-gray-800 dark:text-white'}`}>{value ?? '—'}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{label}</p>
    </div>
  )
}

function ReportsSection({ token }) {
  const [tab, setTab] = useState('overview')
  const [summary, setSummary] = useState(null)
  const [admins, setAdmins] = useState([])
  const [clinics, setClinics] = useState([])
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [loadingSummary, setLoadingSummary] = useState(false)
  const [loadingAdmins, setLoadingAdmins] = useState(false)
  const [loadingClinics, setLoadingClinics] = useState(false)
  const [exportLoading, setExportLoading] = useState(false)
  const [error, setError] = useState('')

  const fetchAll = useCallback((params = {}) => {
    setLoadingSummary(true)
    apiFetch('get', `/manager/reports/summary?${new URLSearchParams(params)}`, token)
      .then(r => setSummary(r.data))
      .catch(() => setSummary(null))
      .finally(() => setLoadingSummary(false))

    setLoadingAdmins(true)
    apiFetch('get', `/manager/reports/admins?${new URLSearchParams(params)}`, token)
      .then(r => setAdmins(Array.isArray(r.data) ? r.data : []))
      .catch(() => setAdmins([]))
      .finally(() => setLoadingAdmins(false))

    setLoadingClinics(true)
    apiFetch('get', '/manager/reports/clinics', token)
      .then(r => setClinics(Array.isArray(r.data) ? r.data : []))
      .catch(() => setClinics([]))
      .finally(() => setLoadingClinics(false))
  }, [token])

  useEffect(() => { fetchAll() }, [fetchAll])

  const handleApply = (e) => {
    e.preventDefault()
    const p = {}
    if (dateFrom) p.date_from = dateFrom
    if (dateTo) p.date_to = dateTo
    fetchAll(p)
  }

  const handleExport = async () => {
    setExportLoading(true)
    try {
      const res = await axios({
        method: 'get',
        url: API_BASE + '/manager/reports/export',
        headers: authHeaders(token),
        responseType: 'blob',
      })
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = 'report.csv'
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    } catch {
      setError('Ошибка экспорта CSV')
    } finally {
      setExportLoading(false)
    }
  }

  const REPORT_TABS = [
    { key: 'overview', label: 'Обзор' },
    { key: 'staff', label: 'Сотрудники' },
    { key: 'clinics', label: 'Клиники' },
    { key: 'export', label: 'Экспорт' },
  ]

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-4">Отчёты</h2>
      <ErrorBox msg={error} />

      {/* Вкладки */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 mb-5">
        {REPORT_TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
              tab === t.key
                ? 'bg-white dark:bg-gray-700 text-gray-800 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Всего направлений" value={loadingSummary ? '...' : summary?.total_referrals ?? 0} />
          <StatCard label="Подтверждено" value={loadingSummary ? '...' : summary?.confirmed_referrals ?? 0} color="text-green-600" />
          <StatCard label="Бонусы в ожидании" value={loadingSummary ? '...' : summary?.total_pending_bonuses != null ? `${summary.total_pending_bonuses} Б` : '0 Б'} color="text-amber-500" />
          <StatCard label="Выплачено бонусов" value={loadingSummary ? '...' : summary?.total_paid_bonuses != null ? `${summary.total_paid_bonuses} Б` : '0 Б'} color="text-blue-600" />
        </div>
      )}

      {tab === 'staff' && (
        <div>
          <form onSubmit={handleApply} className="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm mb-4 flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[140px]">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">С даты</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-800 dark:text-white bg-white dark:bg-gray-900 focus:outline-none focus:border-blue-500" />
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">По дату</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-800 dark:text-white bg-white dark:bg-gray-900 focus:outline-none focus:border-blue-500" />
            </div>
            <button type="submit" className="bg-blue-600 text-white rounded-xl px-4 py-2.5 text-sm font-medium hover:bg-blue-700 transition">Применить</button>
          </form>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-x-auto">
            {loadingAdmins ? <div className="p-6 text-center text-gray-400 text-sm">Загрузка...</div>
            : admins.length === 0 ? <div className="p-6 text-center text-gray-400 text-sm">Нет данных</div>
            : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                    <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3">Сотрудник</th>
                    <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3">Клиника</th>
                    <th className="text-right text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3">Направлений</th>
                    <th className="text-right text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3">Подтверждено</th>
                    <th className="text-right text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3">Бонусы</th>
                  </tr>
                </thead>
                <tbody>
                  {admins.map((row, i) => (
                    <tr key={row.admin_id ?? i} className={i % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50 dark:bg-gray-900/50'}>
                      <td className="px-4 py-3 text-gray-800 dark:text-white font-medium">{row.full_name || row.admin_name || '—'}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{row.clinic_name || row.clinic || '—'}</td>
                      <td className="px-4 py-3 text-right">{row.referral_count ?? row.total_referrals ?? 0}</td>
                      <td className="px-4 py-3 text-right text-green-600 font-medium">{row.confirmed_count ?? row.confirmed_referrals ?? 0}</td>
                      <td className="px-4 py-3 text-right text-blue-600 font-medium">
                        {row.pending_bonuses != null ? `${row.pending_bonuses} Б` : (row.bonus_total != null ? `${row.bonus_total} Б` : '—')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === 'clinics' && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-x-auto">
          {loadingClinics ? <div className="p-6 text-center text-gray-400 text-sm">Загрузка...</div>
          : clinics.length === 0 ? <div className="p-6 text-center text-gray-400 text-sm">Нет данных о потоке</div>
          : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                  <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3">Откуда</th>
                  <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3">Куда</th>
                  <th className="text-right text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3">Направлений</th>
                  <th className="text-right text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3">Подтверждено</th>
                </tr>
              </thead>
              <tbody>
                {clinics.map((row, i) => (
                  <tr key={`${row.from_clinic_id}-${row.to_clinic_id}-${i}`}
                    className={i % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50 dark:bg-gray-900/50'}>
                    <td className="px-4 py-3 text-gray-800 dark:text-white">{row.from_clinic_name || row.from_clinic || '—'}</td>
                    <td className="px-4 py-3 text-gray-800 dark:text-white">{row.to_clinic_name || row.to_clinic || '—'}</td>
                    <td className="px-4 py-3 text-right">{row.total ?? row.referral_count ?? 0}</td>
                    <td className="px-4 py-3 text-right text-green-600 font-medium">{row.confirmed ?? row.confirmed_count ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'export' && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm max-w-md">
          <h3 className="text-base font-semibold text-gray-700 dark:text-gray-200 mb-4">Экспорт в CSV</h3>
          <div className="space-y-3 mb-5">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">С даты</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-800 dark:text-white bg-white dark:bg-gray-900 focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">По дату</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-800 dark:text-white bg-white dark:bg-gray-900 focus:outline-none focus:border-blue-500" />
            </div>
          </div>
          <button onClick={handleExport} disabled={exportLoading}
            className="w-full bg-green-600 hover:bg-green-700 text-white rounded-xl py-3 text-sm font-semibold transition disabled:opacity-50">
            {exportLoading ? '⏳ Экспорт...' : '⬇️ Скачать CSV'}
          </button>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-3 text-center">
            Все направления за выбранный период с данными о бонусах и сотрудниках
          </p>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Bonuses section
// ---------------------------------------------------------------------------

function BonusesSection({ token }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch('get', '/manager/reports/admins', token)
      setRows(Array.isArray(res.data) ? res.data : [])
    } catch {
      setError('Не удалось загрузить данные бонусов')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { fetchData() }, [fetchData])

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-bold text-gray-800 dark:text-white">Бонусы</h2>
        <button
          onClick={fetchData}
          className="text-sm text-blue-600 hover:text-blue-700 font-medium transition"
        >
          Обновить
        </button>
      </div>

      <ErrorBox msg={error} />

      {loading ? (
        <Spinner />
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3">ФИО сотрудника</th>
                <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3">Клиника</th>
                <th className="text-right text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3">Начислено</th>
                <th className="text-right text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3">Выплачено</th>
                <th className="text-right text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3">К выплате</th>
                <th className="text-right text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3">Действие</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-gray-400 dark:text-gray-500 text-sm">
                    Нет данных
                  </td>
                </tr>
              ) : (
                rows.map((row, i) => {
                  const accrued = row.bonus_total ?? 0
                  const paid = row.bonus_paid ?? 0
                  const pending = row.bonus_pending ?? (accrued - paid)
                  return (
                    <tr key={row.admin_id ?? i} className={i % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50 dark:bg-gray-900/50'}>
                      <td className="px-4 py-3 font-medium text-gray-800 dark:text-white">{row.full_name || row.admin_name || '—'}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{row.clinic_name || row.clinic || '—'}</td>
                      <td className="px-4 py-3 text-right text-gray-800 dark:text-white">{accrued} Б</td>
                      <td className="px-4 py-3 text-right text-green-600 font-medium">{paid} Б</td>
                      <td className="px-4 py-3 text-right font-semibold text-amber-600">{pending} Б</td>
                      <td className="px-4 py-3 text-right">
                        {pending > 0 && (
                          <button
                            onClick={async () => {
                              if (!window.confirm(`Выплатить ${pending} Б сотруднику ${row.full_name}?`)) return
                              try {
                                await apiFetch('post', `/manager/bonuses/mark-paid-all/${row.admin_id}`, token)
                                fetchData()
                              } catch {
                                alert('Ошибка при выплате')
                              }
                            }}
                            className="text-xs bg-green-500 hover:bg-green-600 text-white rounded-lg px-2.5 py-1.5 font-medium transition"
                          >
                            Выплатить
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Services section — управление услугами по категориям (МИС интеграция)
// ---------------------------------------------------------------------------

const EMPTY_SVC_FORM = { name: '', code: '', clinic_id: '', bonus_amount: '' }

function ServiceModal({ token, clinics, existing, onClose, onDone }) {
  const isEdit = !!existing
  const [form, setForm] = useState(
    isEdit
      ? {
          name: existing.name || '',
          code: existing.code || '',
          clinic_id: existing.clinic_id ? String(existing.clinic_id) : '',
          bonus_amount: existing.bonus_amount != null ? String(existing.bonus_amount) : '',
          is_active: existing.is_active !== false,
        }
      : { ...EMPTY_SVC_FORM }
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) { setError('Введите название услуги'); return }
    if (!form.code.trim()) { setError('Введите код услуги'); return }
    if (!isEdit && !form.clinic_id) { setError('Выберите клинику'); return }
    setLoading(true)
    setError('')
    try {
      const payload = {
        name: form.name.trim(),
        code: form.code.trim().toUpperCase(),
        clinic_id: form.clinic_id || null,
        bonus_amount: parseFloat(form.bonus_amount) || 0,
      }
      if (isEdit) {
        await apiFetch('patch', `/manager/services/${existing.id}`, token, payload)
      } else {
        await apiFetch('post', '/manager/services/', token, payload)
      }
      onDone()
    } catch (err) {
      const _det = err?.response?.data?.detail; const msg = _det?.message || (typeof _det === 'string' ? _det : null) || err?.message || 'Ошибка при сохранении'
      setError(typeof msg === 'string' ? msg : JSON.stringify(msg))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl p-6 w-full sm:max-w-md shadow-2xl">
        <h2 className="text-lg font-bold text-gray-800 dark:text-white mb-5">
          {isEdit ? 'Редактировать услугу' : 'Новая услуга'}
        </h2>
        <ErrorBox msg={error} />
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Название <span className="text-red-500">*</span></label>
            <input type="text" value={form.name} onChange={e => set('name', e.target.value)}
              placeholder="МРТ головного мозга"
              className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-800 dark:text-white bg-white dark:bg-gray-900 focus:outline-none focus:border-blue-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Код <span className="text-red-500">*</span></label>
              <input type="text" value={form.code} onChange={e => set('code', e.target.value.toUpperCase())}
                placeholder="MRI"
                className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-800 dark:text-white bg-white dark:bg-gray-900 focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Комиссия (Б)</label>
              <input type="number" min="0" step="0.01" value={form.bonus_amount} onChange={e => set('bonus_amount', e.target.value)}
                placeholder="500"
                className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-800 dark:text-white bg-white dark:bg-gray-900 focus:outline-none focus:border-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Клиника <span className="text-red-500">*</span></label>
            <select value={form.clinic_id} onChange={e => set('clinic_id', e.target.value)}
              className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-800 dark:text-white bg-white dark:bg-gray-900 focus:outline-none focus:border-blue-500">
              <option value="">— Выберите клинику —</option>
              {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {isEdit && (
            <div className="flex items-center gap-2">
              <input type="checkbox" id="svc-active" checked={form.is_active !== false}
                onChange={e => set('is_active', e.target.checked)}
                className="w-4 h-4 accent-blue-600" />
              <label htmlFor="svc-active" className="text-sm text-gray-700 dark:text-gray-200">Активна</label>
            </div>
          )}
          <div className="flex gap-3 mt-3">
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-xl py-2.5 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition">
              Отмена
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 bg-blue-600 text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-50 hover:bg-blue-700 transition">
              {loading ? 'Сохранение...' : isEdit ? 'Сохранить' : 'Создать'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Компонент: Строка редактирования услуги внутри категории
// ---------------------------------------------------------------------------
function ServiceRow({ svc, token, onUpdated }) {
  const [bonus, setBonus] = useState(String(svc.bonus_amount))
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    const amount = parseFloat(bonus)
    if (isNaN(amount) || amount < 0) return
    setSaving(true)
    try {
      await apiFetch('patch', `/manager/services/${svc.id}`, token, { bonus_amount: amount })
      onUpdated(svc.id, amount)
    } catch { /* тихо */ } finally { setSaving(false) }
  }

  const handleDeactivate = async () => {
    if (!window.confirm(`Отключить услугу "${svc.name}"?`)) return
    await apiFetch('patch', `/manager/services/${svc.id}`, token, { bonus_amount: 0 })
    onUpdated(svc.id, 0)
  }

  const changed = parseFloat(bonus) !== svc.bonus_amount

  return (
    <tr className="border-b border-gray-50 dark:border-gray-700 hover:bg-gray-50/50 dark:hover:bg-gray-700/30">
      <td className="px-4 py-2.5 text-sm text-gray-800 dark:text-white max-w-[220px]">
        <div className="truncate">{svc.name}</div>
        {svc.code && <span className="text-xs text-gray-400 font-mono">{svc.code}</span>}
      </td>
      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
        {svc.original_price ? `${svc.original_price.toLocaleString('ru')} Б` : '—'}
      </td>
      <td className="px-4 py-2.5">
        {/* Инлайн-редактирование бонуса */}
        <div className="flex items-center gap-1.5">
          <input
            type="number" min="0" step="50"
            value={bonus}
            onChange={e => setBonus(e.target.value)}
            onBlur={() => changed && handleSave()}
            onKeyDown={e => e.key === 'Enter' && changed && handleSave()}
            className={`w-20 border rounded-lg px-2 py-1 text-sm text-right font-semibold focus:outline-none focus:ring-1 transition
              ${parseFloat(bonus) > 0
                ? 'border-blue-300 dark:border-blue-600 text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 focus:ring-blue-400'
                : 'border-gray-200 dark:border-gray-600 text-gray-400 bg-white dark:bg-gray-800 focus:ring-gray-400'}`}
          />
          <span className="text-xs text-gray-400">Б</span>
          {saving && <span className="text-xs text-gray-400">⏳</span>}
          {changed && !saving && (
            <button onClick={handleSave}
              className="text-xs bg-blue-600 text-white rounded px-1.5 py-0.5 hover:bg-blue-700 transition">✓</button>
          )}
        </div>
      </td>
      <td className="px-4 py-2.5">
        {parseFloat(bonus) > 0 && (
          <button onClick={handleDeactivate}
            className="text-xs text-red-400 hover:text-red-600 transition">Убрать</button>
        )}
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Компонент: Карточка категории (аккордеон)
// ---------------------------------------------------------------------------
function CategoryCard({ cat, clinicId, token, onBonusSet, autoExpand = false }) {
  const [expanded, setExpanded] = useState(autoExpand)
  const [services, setServices] = useState(null)   // null = не загружено
  const [loadingServices, setLoadingServices] = useState(false)
  const [setBonusOpen, setSetBonusOpen] = useState(false)
  const [bonusInput, setBonusInput] = useState('')
  const [applying, setApplying] = useState(false)

  // Внутренняя функция загрузки услуг
  const loadServices = useCallback(async () => {
    if (services !== null || loadingServices) return
    setLoadingServices(true)
    try {
      const res = await apiFetch('get', `/manager/services/?clinic_id=${clinicId}&category=${encodeURIComponent(cat.category)}`, token)
      setServices(Array.isArray(res.data) ? res.data : [])
    } catch { setServices([]) }
    finally { setLoadingServices(false) }
  }, [clinicId, cat.category, token, services, loadingServices])

  // Авто-загрузка если autoExpand=true
  useEffect(() => {
    if (autoExpand) loadServices()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Загрузка услуг при раскрытии
  const handleExpand = async () => {
    setExpanded(v => !v)
    await loadServices()
  }

  // Обновление бонуса в локальном кеше строки
  const handleRowUpdated = (svcId, newBonus) => {
    setServices(prev => prev?.map(s => s.id === svcId ? { ...s, bonus_amount: newBonus } : s))
    onBonusSet()
  }

  // Установить бонус для всей категории
  const handleSetAll = async () => {
    const amount = parseFloat(bonusInput)
    if (isNaN(amount) || amount < 0) return
    setApplying(true)
    try {
      await apiFetch('post', '/manager/services/set-category-bonus', token, {
        category: cat.category, bonus_amount: amount, clinic_id: clinicId
      })
      // Обновляем локальный список услуг если уже загружен
      if (services) {
        setServices(prev => prev?.map(s => ({ ...s, bonus_amount: amount })))
      }
      setSetBonusOpen(false)
      setBonusInput('')
      onBonusSet()
    } catch (err) {
      alert(err?.response?.data?.detail || 'Ошибка')
    } finally { setApplying(false) }
  }

  const hasBonus = cat.bonus_count > 0

  return (
    <div className={`border rounded-xl overflow-hidden transition-colors
      ${hasBonus
        ? 'border-blue-200 dark:border-blue-800 bg-white dark:bg-gray-800'
        : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900'}`}>

      {/* Заголовок категории */}
      <div className="flex items-center gap-2 px-3 py-3">
        <button onClick={handleExpand}
          className="flex items-center gap-2 flex-1 min-w-0 text-left">
          <span className="text-gray-400 text-xs flex-shrink-0">{expanded ? '▼' : '▶'}</span>
          <span className={`font-semibold text-sm truncate ${hasBonus ? 'text-gray-800 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>
            {cat.category}
          </span>
          <span className="text-xs text-gray-400 flex-shrink-0 hidden sm:inline">{cat.total}</span>
          {hasBonus && (
            <span className="inline-block flex-shrink-0 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs font-semibold px-2 py-0.5 rounded-full">
              ✓ {cat.bonus_count}
            </span>
          )}
        </button>
        {/* Кнопка установки бонуса для всей категории */}
        <button onClick={() => setSetBonusOpen(v => !v)}
          className="flex-shrink-0 text-xs border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-lg px-2 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 transition">
          <span className="hidden sm:inline">Установить бонус</span>
          <span className="sm:hidden">Бонус</span>
        </button>
      </div>

      {/* Панель быстрой установки бонуса для категории */}
      {setSetBonusOpen && (
        <div className="px-3 py-2.5 flex flex-wrap items-center gap-2 bg-amber-50 dark:bg-amber-900/10 border-t border-amber-100 dark:border-amber-900">
          <span className="text-xs text-amber-700 dark:text-amber-400 font-medium">Бонус для {cat.total} услуг:</span>
          <div className="flex items-center gap-1.5">
            <input type="number" min="0" step="50" placeholder="0"
              value={bonusInput} onChange={e => setBonusInput(e.target.value)}
              className="w-20 border border-amber-300 dark:border-amber-700 rounded-lg px-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-amber-400 bg-white dark:bg-gray-800 dark:text-white" />
            <span className="text-xs text-gray-500 dark:text-gray-400">Б</span>
          </div>
          <button onClick={handleSetAll} disabled={applying || !bonusInput}
            className="text-xs bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-lg px-3 py-1.5 font-medium transition">
            {applying ? '⏳' : 'Применить'}
          </button>
          <button onClick={() => setSetBonusOpen(false)}
            className="text-xs text-gray-400 hover:text-gray-600">✕</button>
        </div>
      )}

      {/* Список услуг категории */}
      {expanded && (
        <div className="border-t border-gray-100 dark:border-gray-700 overflow-x-auto">
          {loadingServices ? (
            <div className="px-4 py-3 text-sm text-gray-400">Загрузка...</div>
          ) : (
            <table className="w-full text-sm min-w-[500px]">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900 text-xs text-gray-500 dark:text-gray-400">
                  <th className="text-left px-4 py-2 font-medium">Название</th>
                  <th className="text-right px-4 py-2 font-medium whitespace-nowrap">Цена МИС</th>
                  <th className="text-left px-4 py-2 font-medium">Бонус</th>
                  <th className="px-4 py-2 w-14"></th>
                </tr>
              </thead>
              <tbody>
                {(services || []).length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-4 text-center text-gray-400 text-xs">Нет услуг</td></tr>
                ) : (services || []).map(svc => (
                  <ServiceRow key={svc.id} svc={svc} token={token} onUpdated={handleRowUpdated} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

// ─── КОНФИГУРАЦИЯ: Популярные категории для быстрого доступа ───
const POPULAR_CAT_DEFS = [
  { match: 'консультац', label: 'Консультации',      icon: '🩺' },
  { match: 'узи',        label: 'УЗИ',               icon: '🔊' },
  { match: 'хирург',     label: 'Хирургия',          icon: '⚕️'  },
  { match: 'лаборатор',  label: 'Лабораторная',      icon: '🧪'  },
  { match: 'физиотерап', label: 'Физиотерапия',      icon: '💆'  },
  { match: 'отоларинг',  label: 'ЛОР',               icon: '👂'  },
]

// ---------------------------------------------------------------------------
// Компонент: Раздел Услуги — 3-блочная структура
// ---------------------------------------------------------------------------
function ServicesSection({ token }) {
  const [clinics, setClinics] = useState([])
  const [selectedClinicId, setSelectedClinicId] = useState('')
  const [categories, setCategories] = useState([])
  const [loadingCats, setLoadingCats] = useState(false)
  const [expandedPopular, setExpandedPopular] = useState(null)  // match-ключ открытой популярной
  const [showRest, setShowRest] = useState(false)
  const [restSearch, setRestSearch] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [catKey, setCatKey] = useState(0)   // сброс аккордеонов при смене клиники

  // ─ Загрузка клиник ─
  useEffect(() => {
    apiFetch('get', '/manager/clinics/', token)
      .then(r => {
        const list = Array.isArray(r.data) ? r.data : []
        setClinics(list)
        if (list.length > 0) setSelectedClinicId(String(list[0].id))
      })
      .catch(() => {})
  }, [token])

  // ─ Загрузка категорий ─
  const loadCategories = useCallback(async () => {
    if (!selectedClinicId) return
    setLoadingCats(true)
    try {
      const res = await apiFetch('get', `/manager/services/categories?clinic_id=${selectedClinicId}`, token)
      setCategories(Array.isArray(res.data) ? res.data : [])
    } catch { setCategories([]) }
    finally { setLoadingCats(false) }
  }, [selectedClinicId, token])

  useEffect(() => {
    if (selectedClinicId) { loadCategories(); setCatKey(k => k + 1); setExpandedPopular(null) }
  }, [selectedClinicId])

  // ─ Вычисление 3 групп ─

  // Блок 1: Популярные — совпадают с POPULAR_CAT_DEFS по частичному вхождению
  const popularCats = useMemo(() =>
    POPULAR_CAT_DEFS
      .map(def => ({ ...def, cat: categories.find(c => c.category.toLowerCase().includes(def.match)) }))
      .filter(p => p.cat),
    [categories]
  )
  const popularCatNames = useMemo(() => new Set(popularCats.map(p => p.cat.category)), [popularCats])

  // Блок 2: Настроенные вами — bonus_count > 0, не в популярных
  const configuredCats = useMemo(() =>
    categories.filter(c => c.bonus_count > 0 && !popularCatNames.has(c.category)),
    [categories, popularCatNames]
  )

  // Блок 3: Все остальные — bonus_count == 0, не в популярных
  const restCatsAll = useMemo(() =>
    categories.filter(c => c.bonus_count === 0 && !popularCatNames.has(c.category)),
    [categories, popularCatNames]
  )
  const restCatsFiltered = useMemo(() =>
    restSearch
      ? restCatsAll.filter(c => c.category.toLowerCase().includes(restSearch.toLowerCase()))
      : restCatsAll,
    [restCatsAll, restSearch]
  )

  // ─ Синхронизация из МИС ─
  const handleSyncMis = async () => {
    if (!window.confirm('Синхронизировать все услуги из МИС?\nСуществующие бонусы сохранятся.')) return
    setSyncing(true)
    setSyncResult(null)
    try {
      const res = await apiFetch('post', '/manager/mis/sync-services', token)
      setSyncResult({ ok: true, ...res.data })
      loadCategories()
    } catch (err) {
      setSyncResult({ ok: false, error: err?.response?.data?.detail || 'Ошибка' })
    } finally { setSyncing(false) }
  }

  const totalConfigured = categories.reduce((s, c) => s + c.bonus_count, 0)

  return (
    <div>
      {/* ─── Заголовок и действия ─── */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-xl font-bold text-gray-800 dark:text-white">Услуги</h2>
          {!loadingCats && totalConfigured > 0 && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{totalConfigured} услуг с бонусом</p>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={handleSyncMis} disabled={syncing}
            className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl px-3 py-2 text-sm font-medium transition">
            {syncing ? '⏳ Синхронизация...' : '🔄 Из МИС'}
          </button>
          <button onClick={() => setShowCreate(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-3 py-2 text-sm font-medium transition">
            + Добавить
          </button>
        </div>
      </div>

      {/* ─── Результат синхронизации ─── */}
      {syncResult && (
        <div className={`mb-4 p-3 rounded-xl text-sm ${syncResult.ok
          ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200'
          : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200'}`}>
          {syncResult.ok
            ? `✅ Добавлено ${syncResult.added}, обновлено ${syncResult.updated} услуг в ${syncResult.clinics} клиниках`
            : `❌ ${syncResult.error}`}
          {syncResult.ok && syncResult.details?.map(d => (
            <div key={d.clinic} className="mt-1 text-xs opacity-75">{d.clinic}: +{d.added} / ~{d.updated}</div>
          ))}
          <button onClick={() => setSyncResult(null)} className="float-right text-xs opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* ─── Выбор клиники ─── */}
      <div className="mb-6">
        <select value={selectedClinicId} onChange={e => setSelectedClinicId(e.target.value)}
          className="border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-none focus:border-blue-400">
          {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {loadingCats ? <Spinner /> : categories.length === 0 ? (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">
          Нет категорий — нажмите «🔄 Из МИС» для синхронизации
        </div>
      ) : (
        <>
          {/* ══════ Блок 1: Популярные категории ══════ */}
          {popularCats.length > 0 && (
            <section className="mb-7">
              <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">
                Популярные
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {popularCats.map(p => {
                  const isActive = expandedPopular === p.match
                  const hasBonus = p.cat.bonus_count > 0
                  return (
                    <button key={p.match}
                      onClick={() => setExpandedPopular(isActive ? null : p.match)}
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition
                        ${isActive
                          ? 'border-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/20 shadow-sm'
                          : hasBonus
                            ? 'border-blue-200 dark:border-blue-800/70 bg-white dark:bg-gray-800 hover:border-blue-300 dark:hover:border-blue-700'
                            : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'}`}>
                      <span className="text-xl flex-shrink-0 leading-none">{p.icon}</span>
                      <div className="min-w-0">
                        <div className={`text-sm font-semibold truncate leading-tight
                          ${isActive ? 'text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-200'}`}>
                          {p.label}
                        </div>
                        <div className="text-xs mt-0.5 text-gray-400 dark:text-gray-500">
                          {hasBonus
                            ? <span className="text-blue-500 dark:text-blue-400">✓ {p.cat.bonus_count} с бонусом</span>
                            : `${p.cat.total} услуг`}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
              {/* Инлайн-аккордеон выбранной популярной категории */}
              {expandedPopular && (() => {
                const p = popularCats.find(x => x.match === expandedPopular)
                if (!p?.cat) return null
                return (
                  <div className="mt-3">
                    <CategoryCard
                      key={`${catKey}-pop-${p.cat.category}`}
                      cat={p.cat}
                      clinicId={selectedClinicId}
                      token={token}
                      onBonusSet={loadCategories}
                      autoExpand
                    />
                  </div>
                )
              })()}
            </section>
          )}

          {/* ══════ Блок 2: Настроенные вами ══════ */}
          {configuredCats.length > 0 && (
            <section className="mb-7">
              <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">
                Настроены вами — {configuredCats.length} {configuredCats.length === 1 ? 'категория' : 'категории'}
              </p>
              <div className="flex flex-col gap-2">
                {configuredCats.map(cat => (
                  <CategoryCard
                    key={`${catKey}-cfg-${cat.category}`}
                    cat={cat}
                    clinicId={selectedClinicId}
                    token={token}
                    onBonusSet={loadCategories}
                  />
                ))}
              </div>
            </section>
          )}

          {/* ══════ Блок 3: Все остальные (свёрнуто) ══════ */}
          {restCatsAll.length > 0 && (
            <section>
              <button
                onClick={() => { setShowRest(v => !v); setRestSearch('') }}
                className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-dashed
                  border-gray-300 dark:border-gray-600 text-sm
                  text-gray-500 dark:text-gray-400
                  hover:bg-gray-50 dark:hover:bg-gray-800/60 hover:border-gray-400 dark:hover:border-gray-500
                  transition">
                <span className="font-medium">
                  {showRest ? '▲ Скрыть' : '▼ Все остальные категории'}
                </span>
                <span className="bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs rounded-full px-2 py-0.5 font-medium">
                  {restCatsAll.length}
                </span>
              </button>

              {showRest && (
                <div className="mt-3">
                  <input
                    type="text"
                    placeholder="Поиск по категории..."
                    value={restSearch}
                    onChange={e => setRestSearch(e.target.value)}
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm
                      bg-white dark:bg-gray-800 text-gray-800 dark:text-white
                      focus:outline-none focus:border-blue-400 mb-3"
                  />
                  {restCatsFiltered.length === 0 ? (
                    <p className="text-center text-sm text-gray-400 py-4">Ничего не найдено</p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {restCatsFiltered.map(cat => (
                        <CategoryCard
                          key={`${catKey}-rest-${cat.category}`}
                          cat={cat}
                          clinicId={selectedClinicId}
                          token={token}
                          onBonusSet={loadCategories}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
        </>
      )}

      {/* ─── Модал создания услуги вручную ─── */}
      {showCreate && (
        <ServiceModal token={token} clinics={clinics} existing={null}
          onClose={() => setShowCreate(false)}
          onDone={() => { setShowCreate(false); loadCategories() }} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Commission section
// ---------------------------------------------------------------------------

function CommissionSection({ token }) {
  const [settings, setSettings] = useState(null)
  const [managers, setManagers] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [sr, mr] = await Promise.all([
        apiFetch('get', '/manager/settings/commission', token),
        apiFetch('get', '/manager/managers/', token),
      ])
      setSettings(sr.data)
      setManagers(Array.isArray(mr.data) ? mr.data : [])
    } catch {
      setError('Не удалось загрузить настройки')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { fetchData() }, [fetchData])

  const handleToggle = async () => {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const res = await apiFetch('patch', '/manager/settings/commission', token, {
        commission_enabled: !settings.commission_enabled,
      })
      setSettings(res.data)
      setSuccess(res.data.commission_enabled ? 'Комиссия включена' : 'Комиссия отключена')
    } catch (err) {
      setError(err?.response?.data?.detail || 'Ошибка')
    } finally {
      setSaving(false)
    }
  }

  const handleRateChange = async (rate) => {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const res = await apiFetch('patch', '/manager/settings/commission', token, {
        commission_rate: parseFloat(rate),
      })
      setSettings(res.data)
      setSuccess('Ставка обновлена')
    } catch (err) {
      setError(err?.response?.data?.detail || 'Ошибка')
    } finally {
      setSaving(false)
    }
  }

  const handleReceiverChange = async (id) => {
    if (!id) return
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const res = await apiFetch('patch', '/manager/settings/commission', token, {
        commission_receiver_id: id,
      })
      setSettings(res.data)
      setSuccess('Получатель комиссии обновлён')
    } catch (err) {
      setError(err?.response?.data?.detail || 'Ошибка')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Spinner />

  return (
    <div>
      <h3 className="text-base font-semibold text-gray-700 dark:text-gray-200 mb-4">💰 Комиссия с бонусов</h3>

      {error && <ErrorBox msg={error} />}
      {success && (
        <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 rounded-xl p-3 mb-4">
          <p className="text-green-700 dark:text-green-400 text-sm">{success}</p>
        </div>
      )}

      {/* Commission block */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-6 mb-5">
        <h3 className="text-base font-semibold text-gray-800 dark:text-white mb-1">Комиссия с бонусов</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
          Если включено, при каждом подтверждённом направлении из бонуса администратора
          вычитается процент и начисляется выбранному руководителю.
        </p>

        {/* Toggle */}
        <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-900 rounded-xl mb-4">
          <div>
            <div className="text-sm font-medium text-gray-800 dark:text-white">
              {settings?.commission_enabled ? 'Комиссия включена' : 'Комиссия отключена'}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {settings?.commission_enabled
                ? `${settings.commission_rate}% от каждого бонуса уходит руководителю`
                : 'Администраторы получают полный бонус'}
            </div>
          </div>
          <button
            onClick={handleToggle}
            disabled={saving}
            className={`relative w-12 h-6 rounded-full transition-colors disabled:opacity-50 ${
              settings?.commission_enabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
            }`}
          >
            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
              settings?.commission_enabled ? 'translate-x-6' : 'translate-x-0.5'
            }`} />
          </button>
        </div>

        {/* Rate */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Ставка комиссии (%)</label>
            <div className="flex gap-2">
              <input
                type="number"
                min="0.1"
                max="100"
                step="0.1"
                defaultValue={settings?.commission_rate ?? 10}
                onBlur={e => handleRateChange(e.target.value)}
                className="flex-1 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-800 dark:text-white bg-white dark:bg-gray-900 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Получатель комиссии</label>
            <select
              value={settings?.commission_receiver_id || ''}
              onChange={e => handleReceiverChange(e.target.value)}
              disabled={saving}
              className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-800 dark:text-white bg-white dark:bg-gray-900 focus:outline-none focus:border-blue-500 disabled:opacity-50"
            >
              <option value="">— Не выбран —</option>
              {managers.map(m => (
                <option key={m.id} value={m.id}>
                  {m.full_name || m.username}
                </option>
              ))}
            </select>
          </div>
        </div>

        {settings?.commission_receiver_name && (
          <div className="mt-3 text-sm text-gray-600 dark:text-gray-300">
            Текущий получатель: <span className="font-medium text-blue-700 dark:text-blue-400">{settings.commission_receiver_name}</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Settings section — Stitch redesign
// ---------------------------------------------------------------------------

function SettingsSection({ token }) {
  const [form, setForm] = useState({ mis_api_url: '', mis_api_key: '', telegram_bot_token: '', telegram_admin_id: '', support_bot_token: '', support_admin_chat_id: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [misLiveStatus, setMisLiveStatus] = useState(null)
  const [error, setError] = useState('')
  const [versionInfo, setVersionInfo] = useState({ current: null })
  const [showApiKey, setShowApiKey] = useState(false)
  const [showBotToken, setShowBotToken] = useState(false)

  useEffect(() => {
    apiFetch('get', '/manager/settings/general', token)
      .then(r => {
        const d = r.data || {}
        setForm({
          mis_api_url: d.mis_api_url || '',
          mis_api_key: d.mis_api_key || '',
          telegram_bot_token: d.telegram_bot_token || '',
          telegram_admin_id: d.telegram_admin_id || d.telegram_chat_id || '',
          support_bot_token: d.support_bot_token || '',
          support_admin_chat_id: d.support_admin_chat_id || '',
        })
      })
      .catch(() => {})
      .finally(() => setLoading(false))
    apiFetch('get', '/system/version', token)
      .then(r => setVersionInfo({ current: r.data?.version }))
      .catch(() => {})
    // Load live MIS status
    apiFetch('get', '/manager/mis/status', token)
      .then(r => setMisLiveStatus(r.data))
      .catch(() => {})
  }, [token])

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true); setError(''); setSaved(false)
    try {
      await apiFetch('patch', '/manager/settings/general', token, form)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err?.response?.data?.detail || 'Ошибка сохранения')
    } finally { setSaving(false) }
  }

  const handleTestMis = async () => {
    setTesting(true); setTestResult(null)
    try {
      const res = await apiFetch('post', '/manager/settings/test-mis', token, { mis_api_url: form.mis_api_url, mis_api_key: form.mis_api_key })
      setTestResult({ ok: true, msg: res.data?.message || 'Соединение успешно' })
    } catch (err) {
      setTestResult({ ok: false, msg: err?.response?.data?.detail || 'Ошибка соединения' })
    } finally { setTesting(false) }
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  if (loading) return <Spinner />

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xl font-extrabold font-headline text-[#191c1e] dark:text-white tracking-tight">Настройки</h2>
        {versionInfo.current && (
          <span className="text-xs px-3 py-1 rounded-full bg-[#dae5ff] text-[#1565c0] font-bold">v{versionInfo.current}</span>
        )}
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-100 rounded-2xl p-4 flex items-center gap-3">
          <span className="material-symbols-outlined text-[#ba1a1a] flex-shrink-0" style={{fontVariationSettings:"'FILL' 1"}}>error</span>
          <p className="text-sm text-[#ba1a1a]">{error}</p>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-4">
        {/* МИС Интеграция */}
        <div className="bg-white dark:bg-gray-800 rounded-3xl p-5" style={{boxShadow:'0 4px 20px rgba(25,28,30,0.06)'}}>
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-[#dae5ff] flex items-center justify-center">
                <span className="material-symbols-outlined text-[#1565c0] text-xl" style={{fontVariationSettings:"'FILL' 1"}}>local_hospital</span>
              </div>
              <h3 className="font-bold text-[#191c1e] dark:text-white font-headline">Интеграция МИС</h3>
            </div>
            {misLiveStatus && (
              <span className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full ${misLiveStatus.online ? 'bg-[#dcfce7] text-[#166534]' : 'bg-red-100 text-[#ba1a1a]'}`}>
                <span className="w-1.5 h-1.5 rounded-full inline-block" style={{background: misLiveStatus.online ? '#166534' : '#ba1a1a'}} />
                {misLiveStatus.online ? 'Онлайн' : 'Недоступна'}
              </span>
            )}
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-[#727783] mb-1.5 uppercase tracking-wider">URL МИС</label>
              <input type="text" value={form.mis_api_url} onChange={e => set('mis_api_url', e.target.value)}
                placeholder="https://mis.example.com:3010"
                className="w-full bg-[#f2f4f6] dark:bg-gray-700 dark:text-white rounded-2xl px-4 py-3 text-sm border-2 border-transparent focus:border-[#1565c0]/30 focus:bg-white dark:focus:bg-gray-600 outline-none transition-all" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#727783] mb-1.5 uppercase tracking-wider">API Ключ</label>
              <div className="relative">
                <input type={showApiKey ? 'text' : 'password'} value={form.mis_api_key} onChange={e => set('mis_api_key', e.target.value)}
                  placeholder="••••••••••••••••••••••"
                  className="w-full bg-[#f2f4f6] dark:bg-gray-700 dark:text-white rounded-2xl px-4 py-3 pr-12 text-sm border-2 border-transparent focus:border-[#1565c0]/30 focus:bg-white dark:focus:bg-gray-600 outline-none transition-all" />
                <button type="button" onClick={() => setShowApiKey(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#727783] hover:text-[#1565c0] transition">
                  <span className="material-symbols-outlined text-xl">{showApiKey ? 'visibility_off' : 'visibility'}</span>
                </button>
              </div>
            </div>
            {testResult && (
              <div className={`p-3 rounded-2xl text-sm flex items-center gap-2 ${testResult.ok ? 'bg-[#dcfce7] text-[#166534]' : 'bg-red-50 text-[#ba1a1a]'}`}>
                <span className="material-symbols-outlined text-base" style={{fontVariationSettings:"'FILL' 1"}}>{testResult.ok ? 'check_circle' : 'error'}</span>
                {testResult.msg}
              </div>
            )}
            <button type="button" onClick={handleTestMis} disabled={testing || !form.mis_url}
              className="w-full bg-[#f2f4f6] hover:bg-[#eceef0] dark:bg-gray-700 text-[#1565c0] rounded-2xl py-2.5 text-sm font-semibold disabled:opacity-40 transition flex items-center justify-center gap-2">
              <span className="material-symbols-outlined text-base">{testing ? 'sync' : 'wifi_tethering'}</span>
              {testing ? 'Проверка...' : 'Проверить соединение'}
            </button>
          </div>
        </div>

        {/* Telegram Bot */}
        <div className="bg-white dark:bg-gray-800 rounded-3xl p-5" style={{boxShadow:'0 4px 20px rgba(25,28,30,0.06)'}}>
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-2xl bg-[#dae5ff] flex items-center justify-center">
              <span className="material-symbols-outlined text-[#1565c0] text-xl" style={{fontVariationSettings:"'FILL' 1"}}>send</span>
            </div>
            <h3 className="font-bold text-[#191c1e] dark:text-white font-headline">Telegram Bot</h3>
          </div>
          <div className="space-y-3">
            <p className="text-xs text-[#727783]">Бот для уведомлений об отменах, крупных бонусах, ежедневного отчёта.</p>
            <div>
              <label className="block text-xs font-semibold text-[#727783] mb-1.5 uppercase tracking-wider">Bot Token (уведомления)</label>
              <div className="relative">
                <input type={showBotToken ? 'text' : 'password'} value={form.telegram_bot_token} onChange={e => set('telegram_bot_token', e.target.value)}
                  placeholder="123456789:AABBccdd..."
                  className="w-full bg-[#f2f4f6] dark:bg-gray-700 dark:text-white rounded-2xl px-4 py-3 pr-12 text-sm border-2 border-transparent focus:border-[#1565c0]/30 focus:bg-white dark:focus:bg-gray-600 outline-none transition-all" />
                <button type="button" onClick={() => setShowBotToken(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#727783] hover:text-[#1565c0] transition">
                  <span className="material-symbols-outlined text-xl">{showBotToken ? 'visibility_off' : 'visibility'}</span>
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#727783] mb-1.5 uppercase tracking-wider">Admin Telegram ID (для уведомлений)</label>
              <input type="text" value={form.telegram_admin_id} onChange={e => set('telegram_admin_id', e.target.value)}
                placeholder="293633093"
                className="w-full bg-[#f2f4f6] dark:bg-gray-700 dark:text-white rounded-2xl px-4 py-3 text-sm border-2 border-transparent focus:border-[#1565c0]/30 focus:bg-white dark:focus:bg-gray-600 outline-none transition-all" />
            </div>
          </div>
        </div>

        {/* Чат Поддержки (свой Telegram бот) */}
        <div className="bg-white dark:bg-gray-800 rounded-3xl p-5" style={{boxShadow:'0 4px 20px rgba(25,28,30,0.06)'}}>
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-2xl bg-[#f0fdf4] flex items-center justify-center">
              <span className="material-symbols-outlined text-[#166534] text-xl" style={{fontVariationSettings:"'FILL' 1"}}>support_agent</span>
            </div>
            <div>
              <h3 className="font-bold text-[#191c1e] dark:text-white font-headline">Чат поддержки</h3>
              <p className="text-xs text-[#727783]">Ваш Telegram бот, куда будут приходить сообщения из чата поддержки</p>
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-[#727783] mb-1.5 uppercase tracking-wider">Bot Token (поддержка)</label>
              <input type="password" value={form.support_bot_token} onChange={e => set('support_bot_token', e.target.value)}
                placeholder="123456789:AABBccdd... (токен бота поддержки)"
                className="w-full bg-[#f2f4f6] dark:bg-gray-700 dark:text-white rounded-2xl px-4 py-3 text-sm border-2 border-transparent focus:border-[#166534]/30 focus:bg-white dark:focus:bg-gray-600 outline-none transition-all" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#727783] mb-1.5 uppercase tracking-wider">Chat ID оператора</label>
              <input type="text" value={form.support_admin_chat_id} onChange={e => set('support_admin_chat_id', e.target.value)}
                placeholder="Ваш Telegram ID (куда придут сообщения)"
                className="w-full bg-[#f2f4f6] dark:bg-gray-700 dark:text-white rounded-2xl px-4 py-3 text-sm border-2 border-transparent focus:border-[#166534]/30 focus:bg-white dark:focus:bg-gray-600 outline-none transition-all" />
              <p className="text-[11px] text-[#a0a5b0] mt-1">Узнать свой ID: откройте @userinfobot в Telegram и отправьте /start</p>
            </div>
          </div>
        </div>

        {saved && (
          <div className="bg-[#dcfce7] rounded-2xl p-4 flex items-center gap-2">
            <span className="material-symbols-outlined text-[#166534]" style={{fontVariationSettings:"'FILL' 1"}}>check_circle</span>
            <p className="text-[#166534] text-sm font-semibold">Настройки сохранены</p>
          </div>
        )}

        <button type="submit" disabled={saving}
          className="w-full py-3.5 rounded-2xl text-white text-sm font-bold disabled:opacity-50 transition active:scale-[0.99] flex items-center justify-center gap-2"
          style={{background:'linear-gradient(135deg, #1565c0, #1e6fe8)', boxShadow:'0 8px 20px rgba(21,101,192,0.25)'}}>
          <span className="material-symbols-outlined text-base" style={{fontVariationSettings:"'FILL' 1"}}>{saving ? 'sync' : 'save'}</span>
          {saving ? 'Сохранение...' : 'Сохранить настройки'}
        </button>
      </form>

      {/* Commission settings */}
      <div className="pt-2">
        <CommissionSection token={token} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// MyPlanSection — тариф и подписка тенанта
// ---------------------------------------------------------------------------

const PLAN_LABELS = { basic: 'Базовый', professional: 'Профессиональный', enterprise: 'Корпоративный' }
const PLAN_COLORS = { basic: '#64748b', professional: '#0097A7', enterprise: '#7c3aed' }
const PLAN_DESCRIPTIONS = {
  basic: 'Базовый функционал для небольших клиник',
  professional: 'Полный функционал для растущей сети',
  enterprise: 'Максимальные возможности и интеграции',
}

function MyPlanSection({ token }) {
  const [plan, setPlan] = useState(null)
  const [loading, setLoading] = useState(true)
  const [upgradeModal, setUpgradeModal] = useState(false)
  const [upgradePlan, setUpgradePlan] = useState('')
  const [upgradeComment, setUpgradeComment] = useState('')
  const [upgradeLoading, setUpgradeLoading] = useState(false)
  const [upgradeOk, setUpgradeOk] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const r = await apiFetch('get', '/billing/trial-status', token)
      setPlan(r.data)
    } catch {}
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [token])

  const handleUpgradeRequest = async () => {
    if (!upgradePlan) return
    setUpgradeLoading(true)
    try {
      const res = await apiFetch('post', '/billing/upgrade-request', token, { plan: upgradePlan, comment: upgradeComment })
      const msg = res?.data?.message || 'Запрос отправлен'
      setUpgradeOk(msg)
      setTimeout(() => { setUpgradeModal(false); setUpgradeOk(false) }, 4000)
    } catch {}
    finally { setUpgradeLoading(false) }
  }

  if (loading) return <Spinner />

  const planKey = plan?.plan || 'professional'
  const planLabel = plan?.plan_label || PLAN_LABELS[planKey] || planKey
  const planColor = plan?.plan_color || PLAN_COLORS[planKey] || '#0097A7'
  const planGradient = plan?.plan_gradient || 'from-[#0097A7] to-[#004D5F]'
  const status = plan?.status || 'active'
  const daysLeft = plan?.days_remaining

  const statusConfig = {
    trial: { label: 'Пробный период', color: '#d97706', bg: 'bg-amber-50', icon: 'hourglass_top' },
    active: { label: 'Активна', color: '#166534', bg: 'bg-emerald-50', icon: 'check_circle' },
    trial_expired: { label: 'Пробный истёк', color: '#ba1a1a', bg: 'bg-red-50', icon: 'error' },
    past_due: { label: 'Просрочена', color: '#ba1a1a', bg: 'bg-red-50', icon: 'error' },
    cancelled: { label: 'Отменена', color: '#727783', bg: 'bg-gray-50', icon: 'cancel' },
  }
  const sc = statusConfig[status] || statusConfig.active

  return (
    <div className="max-w-xl space-y-4">
      <h2 className="text-xl font-extrabold font-headline text-[#191c1e] dark:text-white tracking-tight">Мой тариф</h2>

      {/* Основная карточка */}
      <div className="rounded-3xl overflow-hidden" style={{boxShadow:'0 4px 24px rgba(25,28,30,0.10)'}}>
        <div className={`bg-gradient-to-br ${planGradient} p-6 text-white relative`}>
          <p className="text-xs font-bold uppercase tracking-widest opacity-75 mb-1">{plan?.plan_subtitle || PLAN_DESCRIPTIONS[planKey] || ''}</p>
          <h3 className="text-3xl font-extrabold font-headline">{planLabel}</h3>
          <div className={`inline-flex items-center gap-1.5 mt-3 px-3 py-1 rounded-full text-xs font-bold ${sc.bg}`} style={{color: sc.color}}>
            <span className="material-symbols-outlined text-sm" style={{fontVariationSettings:"'FILL' 1"}}>{sc.icon}</span>
            {sc.label}
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 p-5 space-y-3">
          {/* Дней до конца */}
          {daysLeft !== null && daysLeft !== undefined && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-[#727783]">Осталось дней</span>
              <span className={`text-lg font-extrabold font-headline ${daysLeft <= 7 ? 'text-red-600' : daysLeft <= 14 ? 'text-amber-600' : 'text-[#191c1e] dark:text-white'}`}>
                {daysLeft} {daysLeft === 1 ? 'день' : daysLeft < 5 ? 'дня' : 'дней'}
              </span>
            </div>
          )}
          {plan?.trial_ends_at && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-[#727783]">Действует до</span>
              <span className="font-semibold text-[#191c1e] dark:text-white">
                {new Date(plan.trial_ends_at).toLocaleDateString('ru-RU', {day:'numeric', month:'long', year:'numeric'})}
              </span>
            </div>
          )}
          {plan?.max_clinics && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-[#727783]">Клиник</span>
              <span className="font-semibold text-[#191c1e] dark:text-white">до {plan.max_clinics}</span>
            </div>
          )}
          {plan?.max_users && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-[#727783]">Пользователей</span>
              <span className="font-semibold text-[#191c1e] dark:text-white">до {plan.max_users}</span>
            </div>
          )}

          {/* Предупреждение */}
          {daysLeft !== null && daysLeft <= 7 && (
            <div className="bg-red-50 dark:bg-red-900/20 rounded-2xl p-3 flex items-start gap-2">
              <span className="material-symbols-outlined text-red-600 text-base flex-shrink-0 mt-0.5" style={{fontVariationSettings:"'FILL' 1"}}>warning</span>
              <p className="text-xs text-red-700 dark:text-red-400">
                {daysLeft === 0 ? 'Подписка истекла! Функции могут быть ограничены.' : `Осталось ${daysLeft} дн. — продлите подписку.`}
              </p>
            </div>
          )}

          {/* Кнопка запроса */}
          <button onClick={() => setUpgradeModal(true)}
            className="w-full py-3 rounded-2xl text-white text-sm font-bold mt-2 transition active:scale-[0.99]"
            style={{background:'linear-gradient(135deg, #0097A7, #004D5F)', boxShadow:'0 4px 16px rgba(0,151,167,0.25)'}}>
            Запросить смену тарифа
          </button>
        </div>
      </div>

      {/* Функции тарифа */}
      {plan?.features_list && plan.features_list.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-3xl p-5" style={{boxShadow:'0 4px 20px rgba(25,28,30,0.06)'}}>
          <h4 className="font-bold text-[#191c1e] dark:text-white mb-3">Включено в тариф</h4>
          <ul className="space-y-2">
            {plan.features_list.map((f, i) => (
              <li key={i} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <span className="material-symbols-outlined text-emerald-500 text-base flex-shrink-0" style={{fontVariationSettings:"'FILL' 1"}}>check_circle</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Информация */}
      <div className="bg-white dark:bg-gray-800 rounded-3xl p-5" style={{boxShadow:'0 4px 20px rgba(25,28,30,0.06)'}}>
        <h4 className="font-bold text-[#191c1e] dark:text-white mb-3">Условия оплаты</h4>
        <div className="space-y-2 text-sm text-[#727783]">
          <div className="flex items-start gap-2">
            <span className="material-symbols-outlined text-[#0097A7] text-base flex-shrink-0" style={{fontVariationSettings:"'FILL' 1"}}>calendar_today</span>
            <span>Оплата ежемесячно — 30 календарных дней с даты оплаты</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="material-symbols-outlined text-[#0097A7] text-base flex-shrink-0" style={{fontVariationSettings:"'FILL' 1"}}>support</span>
            <span>По вопросам тарифа и оплаты — напишите в чат поддержки</span>
          </div>
        </div>
      </div>

      {/* Модал запроса смены */}
      {upgradeModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-3xl p-6 w-full max-w-sm space-y-4">
            <h3 className="text-lg font-bold text-[#191c1e] dark:text-white">Запрос на смену тарифа</h3>
            {upgradeOk ? (
              <div className="bg-emerald-50 rounded-2xl p-4 text-center">
                <span className="material-symbols-outlined text-4xl text-emerald-600" style={{fontVariationSettings:"'FILL' 1"}}>check_circle</span>
                <p className="text-emerald-700 font-semibold mt-2">Запрос отправлен!</p>
                <p className="text-sm text-[#727783] mt-1">{typeof upgradeOk === "string" ? upgradeOk : "Мы свяжемся с вами в ближайшее время"}</p>
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#727783] mb-1.5 uppercase tracking-wider">Желаемый тариф</label>
                    <div className="space-y-2">
                      {['basic','professional','enterprise'].map(p => (
                        <button key={p} type="button" onClick={() => setUpgradePlan(p)}
                          className={`w-full text-left px-4 py-3 rounded-2xl text-sm font-semibold border-2 transition ${upgradePlan === p ? 'border-[#0097A7] bg-[#e0f7fa]' : 'border-transparent bg-[#f2f4f6] dark:bg-gray-800'}`}
                          style={{color: upgradePlan === p ? '#00838f' : undefined}}>
                          {PLAN_LABELS[p]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#727783] mb-1.5 uppercase tracking-wider">Комментарий (необязательно)</label>
                    <textarea value={upgradeComment} onChange={e => setUpgradeComment(e.target.value)}
                      rows={3} placeholder="Расскажите о ваших потребностях..."
                      className="w-full bg-[#f2f4f6] dark:bg-gray-700 rounded-2xl px-4 py-3 text-sm outline-none resize-none" />
                  </div>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setUpgradeModal(false)}
                    className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-2xl py-2.5 text-sm font-medium hover:bg-gray-50 transition">
                    Отмена
                  </button>
                  <button onClick={handleUpgradeRequest} disabled={!upgradePlan || upgradeLoading}
                    className="flex-1 bg-[#0097A7] text-white rounded-2xl py-2.5 text-sm font-bold disabled:opacity-50 transition">
                    {upgradeLoading ? 'Отправка...' : 'Отправить'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Monitoring section
// ---------------------------------------------------------------------------

function MonitoringSection({ token }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [activeTab, setActiveTab] = useState('system')
  const [logs, setLogs] = useState(null)
  const [logsContainer, setLogsContainer] = useState('clinika-backend')
  const [logsLoading, setLogsLoading] = useState(false)
  const [dbAnalysis, setDbAnalysis] = useState(null)
  const [dbLoading, setDbLoading] = useState(false)
  const [logsFilter, setLogsFilter] = useState('all')  // all | errors | warnings

  const load = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    try {
      const res = await apiFetch('get', '/monitoring/system', token)
      setData(res.data)
      setLastUpdated(new Date())
    } catch {}
    finally { setLoading(false); setRefreshing(false) }
  }

  useEffect(() => {
    load()
    const id = setInterval(() => load(true), 30000)
    return () => clearInterval(id)
  }, [token])

  const loadLogs = async (container = logsContainer) => {
    setLogsLoading(true)
    try {
      const res = await apiFetch('get', `/monitoring/logs?container=${container}&lines=150`, token)
      setLogs(res.data)
    } catch {} finally { setLogsLoading(false) }
  }

  const loadDbAnalysis = async () => {
    setDbLoading(true)
    try {
      const res = await apiFetch('get', '/monitoring/db-analysis', token)
      setDbAnalysis(res.data)
    } catch {} finally { setDbLoading(false) }
  }

  useEffect(() => {
    if (activeTab === 'logs' && !logs) loadLogs()
    if (activeTab === 'db' && !dbAnalysis) loadDbAnalysis()
  }, [activeTab])

  if (loading) return <Spinner />

  const srv = data?.server || {}
  const db = data?.database || {}
  const redis = data?.redis || {}
  const mis = data?.mis_integration || {}
  const containers = Array.isArray(data?.containers) ? data.containers : []
  const tasks = data?.background_tasks || {}

  function GaugeBar({ value, max = 100, color, warnAt = 70, critAt = 85 }) {
    const pct = Math.min(100, Math.round((value / max) * 100))
    const barColor = pct >= critAt ? '#ba1a1a' : pct >= warnAt ? '#c2410c' : color
    return (
      <div className="w-full bg-[#f2f4f6] dark:bg-gray-700 rounded-full h-2 mt-2">
        <div className="h-2 rounded-full transition-all duration-500" style={{width: `${pct}%`, background: barColor}} />
      </div>
    )
  }

  function StatCard({ icon, iconBg, iconColor, title, value, sub, gauge, gaugeMax, warnAt, critAt }) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-3xl p-5" style={{boxShadow:'0 4px 20px rgba(25,28,30,0.06)'}}>
        <div className="flex items-center gap-3 mb-3">
          <div className={`w-9 h-9 rounded-2xl flex items-center justify-center ${iconBg}`}>
            <span className="material-symbols-outlined text-lg" style={{color: iconColor, fontVariationSettings:"'FILL' 1"}}>{icon}</span>
          </div>
          <p className="text-xs font-semibold text-[#727783] uppercase tracking-wider">{title}</p>
        </div>
        <p className="text-2xl font-extrabold font-headline text-[#191c1e] dark:text-white">{value ?? '—'}</p>
        {sub && <p className="text-xs text-[#727783] mt-0.5">{sub}</p>}
        {gauge != null && <GaugeBar value={gauge} max={gaugeMax} color={iconColor} warnAt={warnAt} critAt={critAt} />}
      </div>
    )
  }

  const containerClinika = containers.filter(c => c.name?.startsWith('clinika'))
  const containerOther = containers.filter(c => !c.name?.startsWith('clinika'))

  const allContainers = [...containerClinika, ...containerOther]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold font-headline text-[#191c1e] dark:text-white tracking-tight">Мониторинг системы</h2>
          {lastUpdated && <p className="text-xs text-[#727783] mt-0.5">Обновлено: {lastUpdated.toLocaleTimeString('ru-RU')}</p>}
        </div>
        <button onClick={() => load(true)} disabled={refreshing}
          className="w-10 h-10 rounded-2xl bg-white dark:bg-gray-800 flex items-center justify-center text-[#727783] hover:text-[#1565c0] transition border border-[#eceef0]"
          style={{boxShadow:'0 4px 16px rgba(25,28,30,0.05)'}}>
          <span className={`material-symbols-outlined text-xl ${refreshing ? 'animate-spin' : ''}`}>refresh</span>
        </button>
      </div>

      {/* Табы */}
      <div className="flex gap-1 bg-white dark:bg-gray-800 rounded-2xl p-1" style={{boxShadow:'0 4px 16px rgba(25,28,30,0.05)'}}>
        {[
          {key:'system', label:'Система', icon:'monitor_heart'},
          {key:'logs',   label:'Логи',    icon:'receipt_long'},
          {key:'db',     label:'База данных', icon:'database'},
        ].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
              activeTab === tab.key ? 'bg-[#1565c0] text-white' : 'text-[#727783] hover:text-[#424752]'
            }`}
            style={activeTab === tab.key ? {boxShadow:'0 4px 12px rgba(21,101,192,0.2)'} : {}}>
            <span className="material-symbols-outlined text-base">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'logs' && (
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            {['clinika-backend','clinika-frontend','clinika-db','clinika-redis'].map(c => (
              <button key={c} onClick={() => { setLogsContainer(c); setLogs(null); loadLogs(c) }}
                className={`text-xs px-3 py-1.5 rounded-xl font-semibold transition ${logsContainer === c ? 'bg-[#1565c0] text-white' : 'bg-white text-[#727783] border border-[#eceef0]'}`}
                style={logsContainer === c ? {boxShadow:'0 4px 12px rgba(21,101,192,0.2)'} : {}}>
                {c}
              </button>
            ))}
            <div className="ml-auto flex gap-2">
              {['all','errors','warnings'].map(f => (
                <button key={f} onClick={() => setLogsFilter(f)}
                  className={"text-xs px-2.5 py-1.5 rounded-xl font-semibold transition " + (logsFilter === f ? 'bg-[#1565c0] text-white' : 'bg-[#f2f4f6] text-[#424752] hover:bg-[#eceef0]')}>
                  {f === 'all' ? 'Все' : f === 'errors' ? '🔴 Ошибки' : '🟡 Варнинги'}
                </button>
              ))}
              <button onClick={() => loadLogs(logsContainer)} disabled={logsLoading}
                className="text-xs px-3 py-1.5 rounded-xl font-semibold bg-[#f2f4f6] text-[#424752] hover:bg-[#eceef0] transition flex items-center gap-1">
                <span className={"material-symbols-outlined text-sm " + (logsLoading ? 'animate-spin' : '')}>refresh</span>
                Обновить
              </button>
              {logs && (
                <button onClick={() => {
                  const text = logs.lines.join('\n')
                  const blob = new Blob([text], {type: 'text/plain'})
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url; a.download = logsContainer + '-logs.txt'
                  document.body.appendChild(a); a.click(); a.remove()
                  URL.revokeObjectURL(url)
                }}
                  className="text-xs px-3 py-1.5 rounded-xl font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition flex items-center gap-1">
                  <span className="material-symbols-outlined text-sm">download</span>
                  Скачать
                </button>
              )}
            </div>
          </div>
          {logsLoading ? (
            <div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-[#1565c0] border-t-transparent rounded-full animate-spin" /></div>
          ) : logs ? (
            <div className="bg-[#191c1e] rounded-3xl p-5 overflow-x-auto" style={{boxShadow:'0 4px 20px rgba(25,28,30,0.06)'}}>
              <div className="space-y-0.5 font-mono text-xs">
                {logs.lines.slice().reverse()
                  .filter(line => {
                    if (logsFilter === 'errors') return /error|exception|traceback|critical|fatal/i.test(line)
                    if (logsFilter === 'warnings') return /warn|warning/i.test(line)
                    return true
                  })
                  .map((line, i) => {
                    const isErr = /error|exception|traceback|critical|fatal/i.test(line)
                    const isWarn = /warn|warning/i.test(line)
                    return (
                      <div key={i} className={`leading-relaxed ${isErr ? 'text-red-400' : isWarn ? 'text-yellow-400' : 'text-[#c2c6d4]'}`}>
                        {line || ' '}
                      </div>
                    )
                  })}
              </div>
            </div>
          ) : (
            <p className="text-sm text-[#727783] text-center py-8">Нажмите на контейнер для загрузки логов</p>
          )}
        </div>
      )}

      {activeTab === 'db' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={loadDbAnalysis} disabled={dbLoading}
              className="text-xs px-3 py-1.5 rounded-xl font-semibold bg-white text-[#727783] border border-[#eceef0] hover:text-[#1565c0] transition flex items-center gap-1"
              style={{boxShadow:'0 4px 16px rgba(25,28,30,0.05)'}}>
              <span className={`material-symbols-outlined text-sm ${dbLoading ? 'animate-spin' : ''}`}>refresh</span>
              Обновить
            </button>
          </div>
          {dbLoading ? (
            <div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-[#1565c0] border-t-transparent rounded-full animate-spin" /></div>
          ) : dbAnalysis?.tables ? (
            <div className="bg-white dark:bg-gray-800 rounded-3xl overflow-hidden" style={{boxShadow:'0 4px 20px rgba(25,28,30,0.06)'}}>
              <div className="px-5 py-3.5 border-b border-[#f2f4f6] dark:border-gray-700 grid grid-cols-4 gap-2 text-[10px] font-bold text-[#727783] uppercase tracking-wider">
                <span>Таблица</span><span className="text-right">Строки</span><span className="text-right">Удалённые</span><span className="text-right">Размер</span>
              </div>
              {dbAnalysis.tables.map((t, i) => (
                <div key={t.name} className={`px-5 py-3 grid grid-cols-4 gap-2 ${i < dbAnalysis.tables.length-1 ? 'border-b border-[#f2f4f6] dark:border-gray-700' : ''}`}>
                  <span className="text-sm font-semibold text-[#191c1e] dark:text-white font-mono truncate">{t.name}</span>
                  <span className="text-sm text-right text-[#424752] dark:text-gray-300">{t.rows?.toLocaleString()}</span>
                  <span className={`text-sm text-right font-semibold ${t.dead_rows > 100 ? 'text-[#c2410c]' : 'text-[#727783]'}`}>{t.dead_rows?.toLocaleString()}</span>
                  <span className="text-sm text-right text-[#727783]">{t.size}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[#727783] text-center py-8">Нет данных</p>
          )}
        </div>
      )}

      {activeTab !== 'system' && null}

      {activeTab === 'system' && <>

      {/* Сервер — 4 метрики */}
      {!srv.error && (
        <div>
          <p className="text-xs font-bold text-[#727783] uppercase tracking-widest mb-3">Сервер</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard icon="memory" iconBg="bg-[#dae5ff]" iconColor="#1565c0" title="CPU"
              value={`${srv.cpu_percent ?? '—'}%`}
              sub={srv.load_avg ? `Нагрузка: ${srv.load_avg[0]}` : undefined}
              gauge={srv.cpu_percent} warnAt={70} critAt={90} />
            <StatCard icon="storage" iconBg="bg-[#dae5ff]" iconColor="#1565c0" title="RAM"
              value={`${srv.ram_percent ?? '—'}%`}
              sub={srv.ram_used_mb ? `${Math.round(srv.ram_used_mb/1024*10)/10} / ${Math.round(srv.ram_total_mb/1024*10)/10} ГБ` : undefined}
              gauge={srv.ram_percent} warnAt={75} critAt={90} />
            <StatCard icon="hard_drive" iconBg="bg-[#dae5ff]" iconColor="#1565c0" title="Диск"
              value={`${srv.disk_percent ?? '—'}%`}
              sub={srv.disk_used_gb ? `${srv.disk_used_gb} / ${srv.disk_total_gb} ГБ` : undefined}
              gauge={srv.disk_percent} warnAt={75} critAt={90} />
            <StatCard icon="schedule" iconBg="bg-[#dae5ff]" iconColor="#1565c0" title="Аптайм"
              value={srv.uptime_hours != null ? (srv.uptime_hours >= 24 ? `${Math.round(srv.uptime_hours/24)}д` : `${srv.uptime_hours}ч`) : '—'}
              sub="Время работы сервера" />
          </div>
        </div>
      )}

      {/* БД + Redis + МИС */}
      <div>
        <p className="text-xs font-bold text-[#727783] uppercase tracking-widest mb-3">Сервисы</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* PostgreSQL */}
          <div className="bg-white dark:bg-gray-800 rounded-3xl p-5" style={{boxShadow:'0 4px 20px rgba(25,28,30,0.06)'}}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-2xl bg-[#dcfce7] flex items-center justify-center">
                <span className="material-symbols-outlined text-lg text-[#166534]" style={{fontVariationSettings:"'FILL' 1"}}>database</span>
              </div>
              <div>
                <p className="text-xs font-semibold text-[#727783] uppercase tracking-wider">PostgreSQL</p>
                <span className={`text-[11px] font-bold ${db.status === 'ok' ? 'text-[#166534]' : 'text-[#ba1a1a]'}`}>
                  {db.status === 'ok' ? '● Работает' : '● Ошибка'}
                </span>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-[#727783]">Размер БД</span>
                <span className="font-bold text-[#191c1e] dark:text-white">{db.size_mb != null ? `${db.size_mb} МБ` : '—'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#727783]">Соединений</span>
                <span className="font-bold text-[#191c1e] dark:text-white">{db.connections ?? '—'}</span>
              </div>
            </div>
          </div>

          {/* Redis */}
          <div className="bg-white dark:bg-gray-800 rounded-3xl p-5" style={{boxShadow:'0 4px 20px rgba(25,28,30,0.06)'}}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-2xl bg-orange-100 flex items-center justify-center">
                <span className="material-symbols-outlined text-lg text-orange-600" style={{fontVariationSettings:"'FILL' 1"}}>speed</span>
              </div>
              <div>
                <p className="text-xs font-semibold text-[#727783] uppercase tracking-wider">Redis</p>
                <span className={`text-[11px] font-bold ${redis.status === 'ok' ? 'text-[#166534]' : 'text-[#ba1a1a]'}`}>
                  {redis.status === 'ok' ? '● Работает' : '● Ошибка'}
                </span>
              </div>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-[#727783]">Память</span>
              <span className="font-bold text-[#191c1e] dark:text-white">{redis.used_memory_mb != null ? `${redis.used_memory_mb} МБ` : '—'}</span>
            </div>
          </div>

          {/* МИС */}
          <div className="bg-white dark:bg-gray-800 rounded-3xl p-5" style={{boxShadow:'0 4px 20px rgba(25,28,30,0.06)'}}>
            <div className="flex items-center gap-3 mb-4">
              <div className={`w-9 h-9 rounded-2xl flex items-center justify-center ${mis.status === 'ok' ? 'bg-[#dcfce7]' : 'bg-red-100'}`}>
                <span className={`material-symbols-outlined text-lg ${mis.status === 'ok' ? 'text-[#166534]' : 'text-[#ba1a1a]'}`} style={{fontVariationSettings:"'FILL' 1"}}>medical_services</span>
              </div>
              <div>
                <p className="text-xs font-semibold text-[#727783] uppercase tracking-wider">МИС</p>
                <span className={`text-[11px] font-bold ${mis.status === 'ok' ? 'text-[#166534]' : 'text-[#ba1a1a]'}`}>
                  {mis.status === 'ok' ? '● Онлайн' : '● Недоступна'}
                </span>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-[#727783]">Задержка</span>
                <span className="font-bold text-[#191c1e] dark:text-white">{mis.response_time_ms != null ? `${mis.response_time_ms} мс` : '—'}</span>
              </div>
              {mis.error && <p className="text-xs text-[#ba1a1a] truncate">{mis.error}</p>}
            </div>
          </div>
        </div>
      </div>

      {/* Docker контейнеры */}
      {allContainers.length > 0 && (
        <div>
          <p className="text-xs font-bold text-[#727783] uppercase tracking-widest mb-3">Контейнеры</p>
          <div className="bg-white dark:bg-gray-800 rounded-3xl overflow-hidden" style={{boxShadow:'0 4px 20px rgba(25,28,30,0.06)'}}>
            {allContainers.map((c, i) => (
              <div key={c.name || i} className={`flex items-center justify-between px-5 py-3.5 ${i < allContainers.length-1 ? 'border-b border-[#f2f4f6] dark:border-gray-700' : ''}`}>
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    c.health === 'healthy' || (c.status === 'running' && c.health === 'ok') ? 'bg-[#166534]' :
                    c.health === 'unhealthy' ? 'bg-[#ba1a1a]' :
                    c.status === 'running' ? 'bg-[#166534]' : 'bg-[#727783]'
                  }`} />
                  <span className="text-sm font-semibold text-[#191c1e] dark:text-white font-mono">{c.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-bold ${
                    c.status === 'running' ? 'bg-[#dcfce7] text-[#166534]' : 'bg-red-100 text-[#ba1a1a]'
                  }`}>{c.status}</span>
                  {c.health !== 'ok' && c.health !== 'healthy' && (
                    <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-bold ${
                      c.health === 'unhealthy' ? 'bg-red-100 text-[#ba1a1a]' : 'bg-orange-100 text-orange-700'
                    }`}>{c.health}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Фоновые задачи */}
      <div>
        <p className="text-xs font-bold text-[#727783] uppercase tracking-widest mb-3">Фоновые задачи</p>
        <div className="grid grid-cols-3 gap-3">
          {[
            { key: 'auto_confirm', label: 'Авто-подтверждение', icon: 'check_circle' },
            { key: 'expire_referrals', label: 'Истечение направлений', icon: 'schedule' },
            { key: 'heartbeat', label: 'Heartbeat', icon: 'favorite' },
          ].map(t => (
            <div key={t.key} className="bg-white dark:bg-gray-800 rounded-3xl p-4 text-center" style={{boxShadow:'0 4px 20px rgba(25,28,30,0.06)'}}>
              <span className={`material-symbols-outlined text-2xl mb-2 block ${tasks[t.key] === 'running' ? 'text-[#166534]' : 'text-[#727783]'}`}
                style={{fontVariationSettings:"'FILL' 1"}}>{t.icon}</span>
              <p className="text-[10px] font-semibold text-[#727783] leading-tight">{t.label}</p>
              <p className={`text-xs font-bold mt-1 ${tasks[t.key] === 'running' ? 'text-[#166534]' : 'text-[#727783]'}`}>
                {tasks[t.key] === 'running' ? 'Активна' : tasks[t.key] ?? '—'}
              </p>
            </div>
          ))}
        </div>
      </div>
      </>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Partners section

// ---------------------------------------------------------------------------
// Partners section
// ---------------------------------------------------------------------------

const EMPTY_PARTNER_FORM = {
  full_name: '',
  username: '',
  password: '',
  phone_number: '+7',
  telegram_id: '',
}

function PartnerModal({ token, existing, onClose, onDone }) {
  const isEdit = !!existing
  const [form, setForm] = useState(
    isEdit
      ? {
          full_name: existing.full_name || '',
          username: existing.username || '',
          password: '',
          phone_number: existing.phone_number ? formatPhone(existing.phone_number) : '+7',
          telegram_id: existing.telegram_id ? String(existing.telegram_id) : '',
        }
      : { ...EMPTY_PARTNER_FORM }
  )
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.full_name.trim()) { setError('Введите ФИО'); return }
    if (!isEdit && !form.username.trim()) { setError('Введите логин'); return }
    if (!isEdit && !form.password.trim()) { setError('Введите пароль'); return }
    setLoading(true)
    setError('')
    try {
      const payload = { full_name: form.full_name.trim(), role: 'partner' }
      if (form.username.trim()) payload.username = form.username.trim()
      if (form.password.trim()) payload.password = form.password.trim()
      payload.phone_number = (form.phone_number && form.phone_number !== '+7') ? form.phone_number : null
      if (form.telegram_id.trim()) payload.telegram_id = form.telegram_id.trim()

      if (isEdit) {
        await apiFetch('patch', `/manager/partners/${existing.id}`, token, payload)
      } else {
        await apiFetch('post', '/manager/partners/', token, payload)
      }
      onDone()
    } catch (err) {
      const _det = err?.response?.data?.detail; const msg = _det?.message || (typeof _det === 'string' ? _det : null) || err?.message || 'Ошибка при сохранении'
      setError(typeof msg === 'string' ? msg : JSON.stringify(msg))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl p-6 w-full sm:max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold text-gray-800 dark:text-white mb-5">
          {isEdit ? 'Редактировать партнёра' : 'Новый партнёр'}
        </h2>

        <ErrorBox msg={error} />

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              ФИО <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.full_name}
              onChange={e => set('full_name', e.target.value)}
              placeholder="Иванов Иван Иванович"
              className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-800 dark:text-white bg-white dark:bg-gray-900 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                Логин{!isEdit && <span className="text-red-500"> *</span>}
              </label>
              <input
                type="text"
                value={form.username}
                onChange={e => set('username', e.target.value)}
                placeholder="partner_login"
                className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-800 dark:text-white bg-white dark:bg-gray-900 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                Пароль{!isEdit && <span className="text-red-500"> *</span>}
                {isEdit && <span className="text-gray-400"> (не менять — оставьте пустым)</span>}
              </label>
              <input
                type="password"
                value={form.password}
                onChange={e => set('password', e.target.value)}
                placeholder="••••••••"
                className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-800 dark:text-white bg-white dark:bg-gray-900 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Телефон</label>
              <input
                type="tel"
                value={form.phone_number}
                onChange={e => set('phone_number', formatPhone(e.target.value))}
                onFocus={e => { if (e.target.value === '+7') setTimeout(() => e.target.setSelectionRange(e.target.value.length, e.target.value.length), 0) }}
                placeholder="+7 (900) 000-00-00"
                className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-800 dark:text-white bg-white dark:bg-gray-900 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Telegram ID</label>
              <input
                type="text"
                value={form.telegram_id}
                onChange={e => set('telegram_id', e.target.value)}
                placeholder="293633093"
                className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-800 dark:text-white bg-white dark:bg-gray-900 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div className="flex gap-3 mt-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-xl py-2.5 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-blue-600 text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-50 hover:bg-blue-700 transition"
            >
              {loading ? 'Сохранение...' : isEdit ? 'Сохранить' : 'Создать'}
            </button>
          </div>
        </form>

        {isEdit && (
          <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700 space-y-2">
            {existing.is_active !== false ? (
              <button type="button"
                onClick={async () => {
                  if (!window.confirm(`Деактивировать ${existing.full_name}?`)) return
                  try {
                    await apiFetch('delete', `/manager/partners/${existing.id}`, token)
                    onDone()
                  } catch (e) {
                    alert(e?.response?.data?.detail || 'Ошибка')
                  }
                }}
                className="w-full border border-orange-200 text-orange-500 rounded-xl py-2.5 text-sm font-medium hover:bg-orange-50 transition">
                Деактивировать партнёра
              </button>
            ) : null}
            <button type="button" onClick={() => setConfirmDelete(true)}
              className="w-full border border-red-200 text-red-500 rounded-xl py-2.5 text-sm font-medium hover:bg-red-50 transition">
              Удалить партнёра
            </button>
          </div>
        )}
      </div>

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="text-lg font-bold text-gray-800 dark:text-white mb-2 text-center">Удалить партнёра?</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center mb-5">
              Аккаунт будет удалён безвозвратно. Направления останутся в системе.
            </p>
            <div className="flex gap-3">
              <button type="button" onClick={() => setConfirmDelete(false)}
                className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-xl py-2.5 text-sm font-medium">
                Отмена
              </button>
              <button type="button" disabled={deleting}
                onClick={async () => {
                  setDeleting(true)
                  try {
                    await apiFetch('delete', `/manager/partners/${existing.id}?hard=true`, token)
                    onDone()
                  } catch (e) {
                    alert(e?.response?.data?.detail || 'Ошибка удаления')
                    setConfirmDelete(false)
                  } finally { setDeleting(false) }
                }}
                className="flex-1 bg-red-500 text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-50">
                {deleting ? 'Удаление...' : 'Удалить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PartnersSection({ token }) {
  // ─── Таб: 'list' (список) | 'invites' (инвайты) ───
  const [tab, setTab] = useState('list')
  const [partners, setPartners] = useState([])
  const [invites, setInvites] = useState([])
  const [clinics, setClinics] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [copied, setCopied] = useState(null)
  const [creatingInvite, setCreatingInvite] = useState(false)
  const [inviteClinic, setInviteClinic] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [pRes, iRes, cRes] = await Promise.all([
        apiFetch('get', '/manager/partners/', token),
        apiFetch('get', '/manager/invitations/', token),
        apiFetch('get', '/manager/clinics/', token),
      ])
      setPartners(Array.isArray(pRes.data) ? pRes.data : [])
      setInvites(Array.isArray(iRes.data) ? iRes.data : [])
      setClinics(Array.isArray(cRes.data) ? cRes.data : [])
    } catch {
      setError('Не удалось загрузить данные')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { fetchData() }, [fetchData])

  // ─── Создание инвайта ───
  const handleCreateInvite = async () => {
    setCreatingInvite(true)
    try {
      await apiFetch('post', '/manager/invitations/', token, {
        clinic_id: inviteClinic || null,
        max_uses: 100,
      })
      await fetchData()
    } catch (e) {
      setError(e?.response?.data?.detail || 'Ошибка создания инвайта')
    } finally {
      setCreatingInvite(false)
    }
  }

  // ─── Копирование инвайт-ссылки ───
  const handleCopyInvite = (code) => {
    const url = `${window.location.origin}${BASE_PATH}/invite/${code}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(code)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  // ─── Удаление инвайта ───
  const handleDeleteInvite = async (id) => {
    try {
      await apiFetch('delete', `/manager/invitations/${id}`, token)
      setInvites(inv => inv.filter(i => i.id !== id))
    } catch {
      setError('Ошибка удаления инвайта')
    }
  }

  const filtered = partners.filter(p => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      (p.full_name || '').toLowerCase().includes(q) ||
      (p.username || '').toLowerCase().includes(q) ||
      (p.phone_number || '').toLowerCase().includes(q)
    )
  })

  return (
    <div>
      {/* ─── Заголовок ─── */}
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-bold text-gray-800 dark:text-white">Партнёры и суб-агенты</h2>
        {tab === 'list' && (
          <button onClick={() => setShowCreate(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-4 py-2 text-sm font-medium transition">
            + Добавить партнёра
          </button>
        )}
      </div>

      {/* ─── Переключатель табов ─── */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 mb-5">
        <button onClick={() => setTab('list')}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'list' ? 'bg-white dark:bg-gray-700 text-blue-600 shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}>
          👥 Список ({partners.length})
        </button>
        <button onClick={() => setTab('invites')}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'invites' ? 'bg-white dark:bg-gray-700 text-blue-600 shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}>
          🔗 Инвайты ({invites.filter(i => i.is_valid).length})
        </button>
      </div>

      <ErrorBox msg={error} />

      {/* ─── Таб: Инвайт-ссылки ─── */}
      {tab === 'invites' && (
        <div>
          {/* Создание нового инвайта */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm mb-4">
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Новая инвайт-ссылка</p>
            <div className="flex gap-2">
              <select
                value={inviteClinic}
                onChange={e => setInviteClinic(e.target.value)}
                className="flex-1 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-800 dark:text-white focus:outline-none focus:border-blue-500"
              >
                <option value="">Все клиники / без привязки</option>
                {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button
                onClick={handleCreateInvite}
                disabled={creatingInvite}
                className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-50 transition whitespace-nowrap"
              >
                {creatingInvite ? '...' : '+ Создать'}
              </button>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
              Партнёр откроет ссылку, зарегистрируется и сразу получит доступ к системе.
            </p>
          </div>

          {/* Список инвайтов */}
          {invites.length === 0 ? (
            <div className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm">Нет созданных инвайтов</div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden">
              {invites.map((inv, i) => {
                const url = `${window.location.origin}${BASE_PATH}/invite/${inv.code}`
                return (
                  <div key={inv.id}
                    className={`flex items-center gap-3 p-4 ${i < invites.length - 1 ? 'border-b border-gray-100 dark:border-gray-700' : ''}`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${inv.is_valid ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-500'}`}>
                          {inv.is_valid ? 'Активна' : 'Исчерпана'}
                        </span>
                        {inv.clinic_name && (
                          <span className="text-xs text-blue-600 dark:text-blue-400">{inv.clinic_name}</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{url}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                        Использований: {inv.uses_count}/{inv.max_uses}
                        {inv.expires_at && ` · до ${new Date(inv.expires_at).toLocaleDateString('ru-RU')}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button onClick={() => handleCopyInvite(inv.code)}
                        className={`text-xs px-3 py-1.5 rounded-lg font-medium transition ${copied === inv.code ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'}`}>
                        {copied === inv.code ? '✓ Скопировано' : 'Копировать'}
                      </button>
                      <button onClick={() => handleDeleteInvite(inv.id)}
                        className="text-gray-300 dark:text-gray-600 hover:text-red-400 dark:hover:text-red-500 transition p-1">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── Таб: Список партнёров ─── */}
      {tab === 'list' && <>
      <div className="mb-4">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Поиск по имени, логину, телефону..."
          className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-2.5 text-sm text-gray-800 dark:text-white bg-white dark:bg-gray-800 focus:outline-none focus:border-blue-500"
        />
      </div>

      {loading ? (
        <Spinner />
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm">
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                  <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3">ФИО</th>
                  <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3">Логин / TG</th>
                  <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3">Телефон</th>
                  <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3">Направлений</th>
                  <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3">Статус</th>
                  <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3">Действия</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-gray-400 dark:text-gray-500 text-sm">
                      {search.trim() ? 'Ничего не найдено' : 'Партнёров нет'}
                    </td>
                  </tr>
                ) : (
                  filtered.map((p, i) => (
                    <tr
                      key={p.id}
                      className={`border-b border-gray-50 dark:border-gray-700 ${i % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50/50 dark:bg-gray-900/50'}`}
                    >
                      <td className="px-4 py-3 font-medium text-gray-800 dark:text-white">{p.full_name || '—'}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                        {p.username && <div className="text-xs">{p.username}</div>}
                        {p.telegram_id && <div className="text-xs text-blue-500">TG: {p.telegram_id}</div>}
                        {!p.username && !p.telegram_id && '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{p.phone_number || '—'}</td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                        <span className="inline-block bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-xs font-semibold px-2 py-0.5 rounded-full">
                          {p.referrals_count ?? 0}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {p.is_active !== false ? (
                          <span className="inline-block bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs font-semibold px-2 py-0.5 rounded-full">
                            Активен
                          </span>
                        ) : (
                          <span className="inline-block bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 text-xs font-semibold px-2 py-0.5 rounded-full">
                            Неактивен
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setEditTarget(p)}
                          className="text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg px-2.5 py-1.5 font-medium transition"
                        >
                          Изменить
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden divide-y divide-gray-100 dark:divide-gray-700">
            {filtered.length === 0 ? (
              <div className="px-4 py-10 text-center text-gray-400 dark:text-gray-500 text-sm">
                {search.trim() ? 'Ничего не найдено' : 'Партнёров нет'}
              </div>
            ) : filtered.map(p => (
              <div key={p.id} className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-semibold text-gray-800 dark:text-white">{p.full_name}</p>
                    {p.username && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{p.username}</p>}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${p.is_active !== false ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`}>
                      {p.is_active !== false ? 'Активен' : 'Неактивен'}
                    </span>
                    <span className="text-xs bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full">
                      {p.referrals_count ?? 0} напр.
                    </span>
                  </div>
                </div>
                {p.phone_number && <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{p.phone_number}</p>}
                {p.telegram_id && <p className="text-xs text-blue-500 mb-2">TG: {p.telegram_id}</p>}
                <div className="flex justify-end">
                  <button onClick={() => setEditTarget(p)}
                    className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg px-3 py-1.5 font-medium">
                    Изменить
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Закрываем таб списка партнёров */}
      </>}

      {/* Модалы (вне табов — рендерятся поверх) */}
      {showCreate && (
        <PartnerModal
          token={token}
          existing={null}
          onClose={() => setShowCreate(false)}
          onDone={() => { setShowCreate(false); fetchData() }}
        />
      )}
      {editTarget && (
        <PartnerModal
          token={token}
          existing={editTarget}
          onClose={() => setEditTarget(null)}
          onDone={() => { setEditTarget(null); fetchData() }}
        />
      )}
    </div>
  )
}

// ===========================================================================
// БЛОК: Скидки (DiscountsSection)
// ===========================================================================
// Управление скидками на услуги. НЕ влияют на бонусы партнёров/сотрудников.
// Инфраструктура готова — привязка к пациентам/направлениям добавляется позже.
//
// Расширение: добавить промо-коды, автоприменение, привязку к дате/времени
// ===========================================================================

const DISCOUNT_TYPE_LABELS = { percent: '%', fixed: 'Б' }
const APPLIES_TO_LABELS = { all: 'Все услуги', service: 'Конкретная услуга', clinic: 'Клиника' }

const EMPTY_DISCOUNT = {
  name: '',
  description: '',
  discount_type: 'percent',
  discount_value: '',
  applies_to: 'all',
  service_id: '',
  clinic_id: '',
  is_active: true,
  valid_from: '',
  valid_until: '',
}

function DiscountModal({ token, existing, services, clinics, onClose, onDone }) {
  const isEdit = !!existing
  const [form, setForm] = useState(isEdit ? {
    name: existing.name || '',
    description: existing.description || '',
    discount_type: existing.discount_type || 'percent',
    discount_value: String(existing.discount_value ?? ''),
    applies_to: existing.applies_to || 'all',
    service_id: existing.service_id || '',
    clinic_id: existing.clinic_id || '',
    is_active: existing.is_active !== false,
    valid_from: existing.valid_from ? existing.valid_from.slice(0, 10) : '',
    valid_until: existing.valid_until ? existing.valid_until.slice(0, 10) : '',
  } : { ...EMPTY_DISCOUNT })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) { setError('Введите название скидки'); return }
    if (!form.discount_value || isNaN(Number(form.discount_value))) { setError('Введите корректное значение скидки'); return }
    setLoading(true)
    setError('')
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description || null,
        discount_type: form.discount_type,
        discount_value: Number(form.discount_value),
        applies_to: form.applies_to,
        service_id: form.service_id || null,
        clinic_id: form.clinic_id || null,
        is_active: form.is_active,
        valid_from: form.valid_from || null,
        valid_until: form.valid_until || null,
      }
      if (isEdit) {
        await apiFetch('patch', `/manager/discounts/${existing.id}`, token, payload)
      } else {
        await apiFetch('post', '/manager/discounts/', token, payload)
      }
      onDone()
    } catch (err) {
      const _det = err?.response?.data?.detail; const msg = _det?.message || (typeof _det === 'string' ? _det : null) || err?.message || 'Ошибка при сохранении'
      setError(typeof msg === 'string' ? msg : JSON.stringify(msg))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl p-6 w-full sm:max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold text-gray-800 dark:text-white mb-5">
          {isEdit ? 'Редактировать скидку' : 'Новая скидка'}
        </h2>
        <ErrorBox msg={error} />
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">

          {/* Название */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Название *</label>
            <input type="text" value={form.name} onChange={e => set('name', e.target.value)}
              placeholder="Скидка для пенсионеров"
              className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-800 dark:text-white bg-white dark:bg-gray-900 focus:outline-none focus:border-blue-500" />
          </div>

          {/* Тип и значение */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Тип скидки</label>
              <select value={form.discount_type} onChange={e => set('discount_type', e.target.value)}
                className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-900 text-gray-800 dark:text-white focus:outline-none focus:border-blue-500">
                <option value="percent">Процент (%)</option>
                <option value="fixed">Сумма (Б)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                Значение {form.discount_type === 'percent' ? '(1–100)' : '(Б)'}
              </label>
              <input type="number" min="1" max={form.discount_type === 'percent' ? 100 : undefined}
                value={form.discount_value} onChange={e => set('discount_value', e.target.value)}
                placeholder={form.discount_type === 'percent' ? '10' : '500'}
                className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-800 dark:text-white bg-white dark:bg-gray-900 focus:outline-none focus:border-blue-500" />
            </div>
          </div>

          {/* Применяется к */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Применяется к</label>
            <select value={form.applies_to} onChange={e => set('applies_to', e.target.value)}
              className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-900 text-gray-800 dark:text-white focus:outline-none focus:border-blue-500">
              <option value="all">Все услуги</option>
              <option value="service">Конкретная услуга</option>
              <option value="clinic">Клиника</option>
            </select>
          </div>

          {/* Конкретная услуга */}
          {form.applies_to === 'service' && (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Услуга</label>
              <select value={form.service_id} onChange={e => set('service_id', e.target.value)}
                className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-900 text-gray-800 dark:text-white focus:outline-none focus:border-blue-500">
                <option value="">Выберите услугу</option>
                {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}

          {/* Клиника */}
          {form.applies_to === 'clinic' && (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Клиника</label>
              <select value={form.clinic_id} onChange={e => set('clinic_id', e.target.value)}
                className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-900 text-gray-800 dark:text-white focus:outline-none focus:border-blue-500">
                <option value="">Выберите клинику</option>
                {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}

          {/* Срок действия */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Действует с</label>
              <input type="date" value={form.valid_from} onChange={e => set('valid_from', e.target.value)}
                className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-800 dark:text-white bg-white dark:bg-gray-900 focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Действует по</label>
              <input type="date" value={form.valid_until} onChange={e => set('valid_until', e.target.value)}
                className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-800 dark:text-white bg-white dark:bg-gray-900 focus:outline-none focus:border-blue-500" />
            </div>
          </div>

          {/* Описание */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Описание (необязательно)</label>
            <textarea value={form.description} onChange={e => set('description', e.target.value)}
              placeholder="Дополнительная информация о скидке..."
              rows={2}
              className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-800 dark:text-white bg-white dark:bg-gray-900 focus:outline-none focus:border-blue-500 resize-none" />
          </div>

          {/* Активность */}
          <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900 rounded-xl">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {form.is_active ? 'Скидка активна' : 'Скидка отключена'}
            </span>
            <button type="button" onClick={() => set('is_active', !form.is_active)}
              className={`relative inline-flex w-12 h-6 rounded-full transition-colors ${form.is_active ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`}>
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.is_active ? 'translate-x-6' : 'translate-x-0.5'}`} />
            </button>
          </div>

          {/* Кнопки */}
          <div className="flex gap-3 mt-2">
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-xl py-2.5 text-sm font-medium">
              Отмена
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-50">
              {loading ? 'Сохранение...' : (isEdit ? 'Сохранить' : 'Создать скидку')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function DiscountsSection({ token }) {
  const [discounts, setDiscounts] = useState([])
  const [services, setServices] = useState([])
  const [clinics, setClinics] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [filter, setFilter] = useState('all')  // 'all' | 'active' | 'inactive'

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [dRes, sRes, cRes] = await Promise.all([
        apiFetch('get', '/manager/discounts/', token),
        apiFetch('get', '/manager/services/', token),
        apiFetch('get', '/manager/clinics/', token),
      ])
      setDiscounts(Array.isArray(dRes.data) ? dRes.data : [])
      setServices(Array.isArray(sRes.data) ? sRes.data : [])
      setClinics(Array.isArray(cRes.data) ? cRes.data : [])
    } catch {
      setError('Не удалось загрузить скидки')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { fetchData() }, [fetchData])

  const handleToggleActive = async (d) => {
    try {
      await apiFetch('patch', `/manager/discounts/${d.id}`, token, { is_active: !d.is_active })
      setDiscounts(prev => prev.map(x => x.id === d.id ? { ...x, is_active: !x.is_active } : x))
    } catch {
      setError('Ошибка обновления скидки')
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('Удалить скидку?')) return
    try {
      await apiFetch('delete', `/manager/discounts/${id}`, token)
      setDiscounts(prev => prev.filter(x => x.id !== id))
    } catch {
      setError('Ошибка удаления скидки')
    }
  }

  const filtered = discounts.filter(d => {
    if (filter === 'active') return d.is_active
    if (filter === 'inactive') return !d.is_active
    return true
  })

  const formatDiscount = (d) =>
    d.discount_type === 'percent' ? `${d.discount_value}%` : `${d.discount_value} Б`

  const formatAppliesTo = (d) => {
    if (d.applies_to === 'service' && d.service_name) return `Услуга: ${d.service_name}`
    if (d.applies_to === 'clinic' && d.clinic_name) return `Клиника: ${d.clinic_name}`
    return APPLIES_TO_LABELS[d.applies_to] || d.applies_to
  }

  return (
    <div>
      {/* ─── Заголовок ─── */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-xl font-bold text-gray-800 dark:text-white">Скидки</h2>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
            Скидки на стоимость услуг. Бонусы партнёров не затрагиваются.
          </p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-4 py-2 text-sm font-medium transition">
          + Добавить скидку
        </button>
      </div>

      {/* ─── Инфо-баннер (пока нет привязки) ─── */}
      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-3 mb-4">
        <p className="text-amber-800 dark:text-amber-300 text-xs font-medium">
          ⚙️ Инфраструктура готова. Привязка скидок к направлениям и пациентам добавляется в следующем этапе.
        </p>
      </div>

      {/* ─── Фильтр ─── */}
      <div className="flex gap-2 mb-4">
        {[['all', 'Все'], ['active', 'Активные'], ['inactive', 'Отключённые']].map(([val, label]) => (
          <button key={val} onClick={() => setFilter(val)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filter === val ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}>
            {label}
          </button>
        ))}
      </div>

      <ErrorBox msg={error} />

      {loading ? <Spinner /> : (
        <>
          {filtered.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-10 text-center">
              <div className="text-4xl mb-3">🏷️</div>
              <p className="text-gray-500 dark:text-gray-400 text-sm">
                {discounts.length === 0 ? 'Скидок пока нет. Создайте первую.' : 'Ничего не найдено'}
              </p>
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden">
              {/* Desktop */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                      <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3">Название</th>
                      <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3">Скидка</th>
                      <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3">Применение</th>
                      <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3">Срок</th>
                      <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3">Статус</th>
                      <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((d, i) => (
                      <tr key={d.id}
                        className={`border-b border-gray-50 dark:border-gray-700 ${i % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50/50 dark:bg-gray-900/50'}`}>
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-800 dark:text-white">{d.name}</p>
                          {d.description && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate max-w-xs">{d.description}</p>}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-block bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 text-sm font-bold px-2.5 py-1 rounded-lg">
                            −{formatDiscount(d)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">{formatAppliesTo(d)}</td>
                        <td className="px-4 py-3 text-gray-400 dark:text-gray-500 text-xs">
                          {d.valid_from || d.valid_until ? (
                            <span>
                              {d.valid_from ? new Date(d.valid_from).toLocaleDateString('ru-RU') : '∞'}
                              {' — '}
                              {d.valid_until ? new Date(d.valid_until).toLocaleDateString('ru-RU') : '∞'}
                            </span>
                          ) : 'Бессрочно'}
                        </td>
                        <td className="px-4 py-3">
                          <button onClick={() => handleToggleActive(d)}
                            className={`relative inline-flex w-10 h-5 rounded-full transition-colors ${d.is_active ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`}>
                            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${d.is_active ? 'translate-x-5' : 'translate-x-0.5'}`} />
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <button onClick={() => setEditTarget(d)}
                              className="text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg px-2.5 py-1.5 font-medium transition">
                              Изменить
                            </button>
                            <button onClick={() => handleDelete(d.id)}
                              className="text-xs bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-500 dark:text-red-400 rounded-lg px-2.5 py-1.5 font-medium transition">
                              Удалить
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile */}
              <div className="md:hidden divide-y divide-gray-100 dark:divide-gray-700">
                {filtered.map(d => (
                  <div key={d.id} className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-800 dark:text-white">{d.name}</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{formatAppliesTo(d)}</p>
                      </div>
                      <span className="ml-2 bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 text-sm font-bold px-2 py-0.5 rounded-lg flex-shrink-0">
                        −{formatDiscount(d)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <button onClick={() => handleToggleActive(d)}
                        className={`relative inline-flex w-10 h-5 rounded-full transition-colors ${d.is_active ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`}>
                        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${d.is_active ? 'translate-x-5' : 'translate-x-0.5'}`} />
                      </button>
                      <div className="flex gap-2">
                        <button onClick={() => setEditTarget(d)}
                          className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg px-3 py-1.5 font-medium">
                          Изменить
                        </button>
                        <button onClick={() => handleDelete(d.id)}
                          className="text-xs bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400 rounded-lg px-3 py-1.5 font-medium">
                          Удалить
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Модалы */}
      {showCreate && (
        <DiscountModal token={token} existing={null} services={services} clinics={clinics}
          onClose={() => setShowCreate(false)}
          onDone={() => { setShowCreate(false); fetchData() }} />
      )}
      {editTarget && (
        <DiscountModal token={token} existing={editTarget} services={services} clinics={clinics}
          onClose={() => setEditTarget(null)}
          onDone={() => { setEditTarget(null); fetchData() }} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// LedgerSection — финансовый реестр
// ---------------------------------------------------------------------------
function LedgerSection({ token }) {
  const [balance, setBalance] = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const LIMIT = 30
  const [showAdj, setShowAdj] = useState(false)
  const [adjForm, setAdjForm] = useState({ user_id: '', amount: '', operation_type: 'manual_credit', description: '' })
  const [adjErr, setAdjErr] = useState('')
  const [adjOk, setAdjOk] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const [bRes, hRes] = await Promise.all([
        apiFetch('get', '/ledger/balance', token),
        apiFetch('get', `/ledger/history?limit=${LIMIT}&offset=${page * LIMIT}`, token),
      ])
      setBalance(bRes.data)
      setHistory(hRes.data)
    } catch {}
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [token, page])

  const submitAdj = async () => {
    setAdjErr(''); setAdjOk('')
    try {
      await apiFetch('post', '/ledger/adjust', token, {
        user_id: parseInt(adjForm.user_id),
        amount: parseFloat(adjForm.amount),
        operation_type: adjForm.operation_type,
        description: adjForm.description || null,
      })
      setAdjOk('Операция выполнена')
      setShowAdj(false)
      setAdjForm({ user_id: '', amount: '', operation_type: 'manual_credit', description: '' })
      load()
    } catch (e) { setAdjErr(e?.response?.data?.detail || 'Ошибка') }
  }

  const OP_LABELS = {
    bonus_accrued: { label: 'Начислено', color: 'text-green-600' },
    bonus_paid: { label: 'Выплачено', color: 'text-blue-600' },
    bonus_cancelled: { label: 'Отменено', color: 'text-red-500' },
    manual_credit: { label: 'Ручное пополнение', color: 'text-emerald-600' },
    manual_debit: { label: 'Ручное списание', color: 'text-orange-500' },
  }

  if (loading) return <Spinner />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-extrabold font-headline text-gray-900 dark:text-white">Финансовый реестр</h2>
          <p className="text-sm text-gray-500 mt-0.5">Append-only журнал всех операций с бонусами</p>
        </div>
        <button onClick={() => setShowAdj(true)}
          className="flex items-center gap-2 px-4 py-2 bg-[#0097A7] text-white rounded-xl text-sm font-semibold hover:bg-[#00838f] transition">
          <span className="material-symbols-outlined text-lg">tune</span>
          Корректировка
        </button>
      </div>

      {/* Баланс-карточки */}
      {balance && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Текущий баланс', value: balance.balance, icon: 'account_balance_wallet', color: '#0097A7', bg: 'bg-[#e0f7fa]' },
            { label: 'Ожидает выплаты', value: balance.pending_balance, icon: 'hourglass_empty', color: '#F59E0B', bg: 'bg-amber-50' },
            { label: 'Всего начислено', value: balance.total_accrued, icon: 'trending_up', color: '#10B981', bg: 'bg-emerald-50' },
            { label: 'Всего выплачено', value: balance.total_paid, icon: 'payments', color: '#3B82F6', bg: 'bg-blue-50' },
          ].map(c => (
            <div key={c.label} className="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm">
              <div className={`w-9 h-9 rounded-xl ${c.bg} flex items-center justify-center mb-3`}>
                <span className="material-symbols-outlined text-lg" style={{ color: c.color, fontVariationSettings: "'FILL' 1" }}>{c.icon}</span>
              </div>
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{c.label}</p>
              <p className="text-xl font-extrabold text-gray-900 dark:text-white mt-1">
                {(c.value ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Модал корректировки */}
      {showAdj && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-white">Ручная корректировка</h3>
            <ErrorBox msg={adjErr} />
            {adjOk && <p className="text-green-600 text-sm mb-3">{adjOk}</p>}
            <div className="space-y-3">
              <input type="number" placeholder="ID сотрудника" value={adjForm.user_id}
                onChange={e => setAdjForm(f => ({ ...f, user_id: e.target.value }))}
                className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm dark:bg-gray-700 dark:text-white" />
              <input type="number" placeholder="Сумма (₽)" value={adjForm.amount}
                onChange={e => setAdjForm(f => ({ ...f, amount: e.target.value }))}
                className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm dark:bg-gray-700 dark:text-white" />
              <select value={adjForm.operation_type}
                onChange={e => setAdjForm(f => ({ ...f, operation_type: e.target.value }))}
                className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm dark:bg-gray-700 dark:text-white">
                <option value="manual_credit">Пополнение</option>
                <option value="manual_debit">Списание</option>
              </select>
              <input type="text" placeholder="Описание (необязательно)" value={adjForm.description}
                onChange={e => setAdjForm(f => ({ ...f, description: e.target.value }))}
                className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm dark:bg-gray-700 dark:text-white" />
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={submitAdj}
                className="flex-1 py-2 bg-[#0097A7] text-white rounded-xl text-sm font-semibold hover:bg-[#00838f] transition">
                Применить
              </button>
              <button onClick={() => setShowAdj(false)}
                className="flex-1 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {/* История операций */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="font-semibold text-gray-900 dark:text-white">История операций</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900/50 text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-3 text-left">Дата</th>
                <th className="px-4 py-3 text-left">Тип</th>
                <th className="px-4 py-3 text-right">Сумма</th>
                <th className="px-4 py-3 text-left">Описание</th>
                <th className="px-4 py-3 text-left">Создал</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {history.length === 0 && (
                <tr><td colSpan={5} className="text-center py-8 text-gray-400">Нет операций</td></tr>
              )}
              {history.map(e => {
                const op = OP_LABELS[e.operation_type] || { label: e.operation_type, color: 'text-gray-600' }
                const isDebit = e.operation_type === 'manual_debit' || e.operation_type === 'bonus_cancelled'
                return (
                  <tr key={e.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition">
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                      {new Date(e.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className={`px-4 py-3 font-medium ${op.color}`}>{op.label}</td>
                    <td className={`px-4 py-3 text-right font-bold ${isDebit ? 'text-red-500' : 'text-emerald-600'}`}>
                      {isDebit ? '-' : '+'}{e.amount.toLocaleString('ru-RU')} ₽
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400 text-xs">{e.description || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">ID {e.created_by_id || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 dark:border-gray-700">
          <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
            className="text-sm text-[#0097A7] disabled:text-gray-300 font-medium">← Назад</button>
          <span className="text-xs text-gray-400">Страница {page + 1}</span>
          <button disabled={history.length < LIMIT} onClick={() => setPage(p => p + 1)}
            className="text-sm text-[#0097A7] disabled:text-gray-300 font-medium">Вперёд →</button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// AnalyticsDrillSection — аналитика drill-down
// ---------------------------------------------------------------------------
function AnalyticsDrillSection({ token }) {
  const [days, setDays] = useState(30)
  const [overview, setOverview] = useState(null)
  const [funnel, setFunnel] = useState(null)
  const [topServices, setTopServices] = useState([])
  const [topStaff, setTopStaff] = useState([])
  const [clinicsData, setClinicsData] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')

  const load = async () => {
    setLoading(true)
    try {
      const [ov, fn, ts, tst, cl] = await Promise.all([
        apiFetch('get', `/analytics/overview?days=${days}`, token),
        apiFetch('get', `/analytics/funnel?days=${days}`, token),
        apiFetch('get', `/analytics/top-services?days=${days}&limit=10`, token),
        apiFetch('get', `/analytics/top-staff?days=${days}&limit=10`, token),
        apiFetch('get', `/analytics/clinics?days=${days}`, token),
      ])
      setOverview(ov.data)
      setFunnel(fn.data)
      setTopServices(ts.data?.services || [])
      setTopStaff(tst.data?.staff || [])
      setClinicsData(cl.data?.clinics || [])
    } catch {}
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [days])

  const TABS = [
    { key: 'overview', label: 'Обзор', icon: 'bar_chart' },
    { key: 'funnel', label: 'Воронка', icon: 'filter_alt' },
    { key: 'services', label: 'Услуги', icon: 'medical_services' },
    { key: 'staff', label: 'Сотрудники', icon: 'group' },
    { key: 'clinics', label: 'Клиники', icon: 'local_hospital' },
  ]

  const fmtN = v => (v ?? 0).toLocaleString('ru-RU')
  const fmtP = v => `${((v ?? 0) * 100).toFixed(1)}%`
  const deltaColor = d => d > 0 ? 'text-emerald-600' : d < 0 ? 'text-red-500' : 'text-gray-400'
  const deltaSign = d => d > 0 ? '+' : ''

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold font-headline text-gray-900 dark:text-white">Аналитика</h2>
          <p className="text-sm text-gray-500 mt-0.5">Детальные срезы по всем метрикам платформы</p>
        </div>
        <div className="flex gap-2">
          {[7, 14, 30, 90].map(d => (
            <button key={d} onClick={() => setDays(d)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${days === d ? 'bg-[#0097A7] text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:border-[#0097A7]'}`}>
              {d}д
            </button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl w-fit flex-wrap">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition ${activeTab === t.key ? 'bg-white dark:bg-gray-700 text-[#0097A7] shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
            <span className="material-symbols-outlined text-base">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? <Spinner /> : (
        <>
          {/* Overview */}
          {activeTab === 'overview' && overview && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: 'Направлений', val: overview.referrals, delta: overview.referrals_delta, icon: 'share', color: '#0097A7', bg: 'bg-[#e0f7fa]' },
                  { label: 'Подтверждено', val: overview.confirmed, delta: overview.confirmed_delta, icon: 'check_circle', color: '#10B981', bg: 'bg-emerald-50' },
                  { label: 'Бонусов начислено', val: overview.bonuses_accrued, delta: overview.bonuses_accrued_delta, icon: 'savings', color: '#F59E0B', bg: 'bg-amber-50', rub: true },
                  { label: 'Выплачено', val: overview.bonuses_paid, delta: overview.bonuses_paid_delta, icon: 'payments', color: '#3B82F6', bg: 'bg-blue-50', rub: true },
                ].map(c => (
                  <div key={c.label} className="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm">
                    <div className={`w-9 h-9 rounded-xl ${c.bg} flex items-center justify-center mb-3`}>
                      <span className="material-symbols-outlined text-lg" style={{ color: c.color, fontVariationSettings: "'FILL' 1" }}>{c.icon}</span>
                    </div>
                    <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{c.label}</p>
                    <p className="text-xl font-extrabold text-gray-900 dark:text-white mt-1">
                      {fmtN(c.val)}{c.rub ? ' ₽' : ''}
                    </p>
                    {c.delta != null && (
                      <p className={`text-xs font-semibold ${deltaColor(c.delta)}`}>
                        {deltaSign(c.delta)}{c.delta}% к прошлому периоду
                      </p>
                    )}
                  </div>
                ))}
              </div>
              {overview.conversion_rate != null && (
                <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm">
                  <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Общая конверсия</p>
                  <div className="flex items-center gap-4">
                    <p className="text-3xl font-extrabold text-[#0097A7]">{fmtP(overview.conversion_rate)}</p>
                    <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-3">
                      <div className="h-3 rounded-full bg-[#0097A7] transition-all" style={{ width: `${Math.min(100, (overview.conversion_rate ?? 0) * 100)}%` }} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Funnel */}
          {activeTab === 'funnel' && funnel && (
            <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-5">Воронка конверсии</h3>
              <div className="space-y-3">
                {(funnel.steps || []).map((step, i) => {
                  const maxVal = funnel.steps[0]?.count || 1
                  const pct = Math.round((step.count / maxVal) * 100)
                  const colors = ['bg-[#0097A7]', 'bg-blue-500', 'bg-amber-500', 'bg-emerald-500']
                  return (
                    <div key={i}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-medium text-gray-700 dark:text-gray-300">{step.label}</span>
                        <span className="text-gray-500">{fmtN(step.count)} {step.rate != null ? `(${fmtP(step.rate)})` : ''}</span>
                      </div>
                      <div className="bg-gray-100 dark:bg-gray-700 rounded-full h-5 overflow-hidden">
                        <div className={`h-5 rounded-full ${colors[i % colors.length]} transition-all duration-500`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Top Services */}
          {activeTab === 'services' && (
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
                <h3 className="font-semibold text-gray-900 dark:text-white">Топ услуг</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-900/50 text-xs text-gray-500 uppercase tracking-wider">
                      <th className="px-4 py-3 text-left">#</th>
                      <th className="px-4 py-3 text-left">Услуга</th>
                      <th className="px-4 py-3 text-right">Направлений</th>
                      <th className="px-4 py-3 text-right">Конверсия</th>
                      <th className="px-4 py-3 text-right">Ср. бонус</th>
                      <th className="px-4 py-3 text-right">Выплачено</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {topServices.map((s, i) => (
                      <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition">
                        <td className="px-4 py-3 text-gray-400 font-bold">{i + 1}</td>
                        <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-200">{s.service_name}</td>
                        <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-400">{fmtN(s.referral_count)}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={`font-semibold ${s.conversion_rate > 0.5 ? 'text-emerald-600' : 'text-amber-500'}`}>{fmtP(s.conversion_rate)}</span>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-400">{fmtN(s.avg_bonus)} ₽</td>
                        <td className="px-4 py-3 text-right font-semibold text-blue-600">{fmtN(s.bonus_paid)} ₽</td>
                      </tr>
                    ))}
                    {topServices.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-gray-400">Нет данных</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Top Staff */}
          {activeTab === 'staff' && (
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
                <h3 className="font-semibold text-gray-900 dark:text-white">Рейтинг сотрудников</h3>
              </div>
              <div className="divide-y divide-gray-100 dark:divide-gray-700">
                {topStaff.map((s, i) => (
                  <div key={i} className="flex items-center gap-4 px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition">
                    <span className="text-lg font-extrabold text-gray-300 w-7 text-center">{i + 1}</span>
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#006173] to-[#0097A7] flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                      {(s.full_name || 'U')[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-800 dark:text-gray-200 truncate">{s.full_name || `ID ${s.user_id}`}</p>
                      <p className="text-xs text-gray-400">{s.clinic_name || 'Клиника'}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-[#0097A7]">{fmtN(s.confirmed)} подтв.</p>
                      <p className="text-xs text-emerald-600">{fmtN(s.earned)} ₽</p>
                    </div>
                  </div>
                ))}
                {topStaff.length === 0 && <p className="text-center py-8 text-gray-400">Нет данных</p>}
              </div>
            </div>
          )}

          {/* Clinics */}
          {activeTab === 'clinics' && (
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
                <h3 className="font-semibold text-gray-900 dark:text-white">Сравнение клиник</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-900/50 text-xs text-gray-500 uppercase tracking-wider">
                      <th className="px-4 py-3 text-left">Клиника</th>
                      <th className="px-4 py-3 text-right">Направлений</th>
                      <th className="px-4 py-3 text-right">Подтверждено</th>
                      <th className="px-4 py-3 text-right">Конверсия</th>
                      <th className="px-4 py-3 text-right">Начислено</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {clinicsData.map((c, i) => (
                      <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition">
                        <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-200">{c.clinic_name}</td>
                        <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-400">{fmtN(c.referrals)}</td>
                        <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-400">{fmtN(c.confirmed)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-[#0097A7]">{fmtP(c.conversion_rate)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-emerald-600">{fmtN(c.bonuses_accrued)} ₽</td>
                      </tr>
                    ))}
                    {clinicsData.length === 0 && <tr><td colSpan={5} className="text-center py-8 text-gray-400">Нет данных</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// AuditSection — журнал аудита
// ---------------------------------------------------------------------------
function AuditSection({ token }) {
  const [log, setLog] = useState([])
  const [loading, setLoading] = useState(true)
  const [actions, setActions] = useState([])
  const [filter, setFilter] = useState({ action: '', entity_type: '', days: 30 })
  const [page, setPage] = useState(0)
  const LIMIT = 30

  const load = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('days', filter.days || 30)
      params.set('limit', LIMIT)
      // /audit/feed — объединённый журнал (audit_log + activity_log)
      const feedRes = await apiFetch('get', `/audit/feed?${params}`, token)
      let items = feedRes.data?.items || []
      // фильтрация на клиенте если нужно
      if (filter.action) items = items.filter(e => e.action?.includes(filter.action))
      if (filter.entity_type) items = items.filter(e => e.entity_type === filter.entity_type)
      setLog(items)
    } catch(e) {
      // fallback to audit/log
      try {
        const params2 = new URLSearchParams({ days: filter.days || 30, limit: LIMIT })
        const r = await apiFetch('get', `/audit/log?${params2}`, token)
        setLog(r.data?.items || r.data?.log || [])
      } catch {}
    }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [filter, page])

  const ENTITY_TYPES = ['user', 'bonus', 'ledger', 'settings', 'referral']

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-extrabold font-headline text-gray-900 dark:text-white">Журнал аудита</h2>
        <p className="text-sm text-gray-500 mt-0.5">Полная история действий в системе с до/после изменений</p>
      </div>

      {/* Фильтры */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm flex flex-wrap gap-3">
        <select value={filter.action} onChange={e => { setFilter(f => ({ ...f, action: e.target.value })); setPage(0) }}
          className="border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm dark:bg-gray-700 dark:text-white">
          <option value="">Все действия</option>
          {actions.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={filter.entity_type} onChange={e => { setFilter(f => ({ ...f, entity_type: e.target.value })); setPage(0) }}
          className="border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm dark:bg-gray-700 dark:text-white">
          <option value="">Все сущности</option>
          {ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={filter.days} onChange={e => { setFilter(f => ({ ...f, days: e.target.value })); setPage(0) }}
          className="border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm dark:bg-gray-700 dark:text-white">
          <option value={7}>7 дней</option>
          <option value={30}>30 дней</option>
          <option value={90}>90 дней</option>
          <option value={365}>1 год</option>
        </select>
      </div>

      {loading ? <Spinner /> : (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900/50 text-xs text-gray-500 uppercase tracking-wider">
                  <th className="px-4 py-3 text-left">Дата</th>
                  <th className="px-4 py-3 text-left">Действие</th>
                  <th className="px-4 py-3 text-left">Сущность</th>
                  <th className="px-4 py-3 text-left">Актор</th>
                  <th className="px-4 py-3 text-left">IP</th>
                  <th className="px-4 py-3 text-left">Изменения</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {log.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-8 text-gray-400">Нет записей</td></tr>
                )}
                {log.map(e => (
                  <tr key={e.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition align-top">
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                      {new Date(e.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <span className="inline-flex items-center px-2 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-lg text-xs font-medium">
                          {e.action}
                        </span>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded w-fit ${e.source === 'audit' ? 'bg-violet-50 text-violet-600' : 'bg-gray-100 text-gray-500'}`}>
                          {e.source === 'audit' ? '📋 аудит' : '📝 активность'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400 text-xs">
                      <span className="font-medium">{e.entity_type}</span>
                      {e.entity_id && <span className="text-gray-400"> #{e.entity_id}</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300 text-xs">{e.actor_name || `ID ${e.actor_id}`}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs font-mono">{e.ip_address || e.ip || '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-500 max-w-xs">
                      {e.after && <pre className="bg-gray-50 dark:bg-gray-900 rounded p-1 text-xs overflow-x-auto max-h-20 max-w-xs">{JSON.stringify(e.after, null, 1)}</pre>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 dark:border-gray-700">
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
              className="text-sm text-[#0097A7] disabled:text-gray-300 font-medium">← Назад</button>
            <span className="text-xs text-gray-400">Страница {page + 1}</span>
            <button disabled={log.length < LIMIT} onClick={() => setPage(p => p + 1)}
              className="text-sm text-[#0097A7] disabled:text-gray-300 font-medium">Вперёд →</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// BillingSection — биллинг и подписки
// ---------------------------------------------------------------------------
function BillingSection({ token }) {
  const [summary, setSummary] = useState(null)
  const [plans, setPlans] = useState([])
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('summary')
  const [changingPlan, setChangingPlan] = useState(false)
  const [genInvoiceModal, setGenInvoiceModal] = useState(false)
  const [invoiceMonths, setInvoiceMonths] = useState(1)
  const [payModal, setPayModal] = useState(null)
  const [payAmount, setPayAmount] = useState('')
  const [actionErr, setActionErr] = useState('')
  const [billingCycle, setBillingCycle] = useState('monthly')

  const load = async () => {
    setLoading(true)
    try {
      const [smRes, plRes, invRes] = await Promise.all([
        apiFetch('get', '/billing/summary', token),
        apiFetch('get', '/billing/plans', token),
        apiFetch('get', '/billing/invoices?limit=20', token),
      ])
      setSummary(smRes.data)
      setPlans(Array.isArray(plRes.data) ? plRes.data : (plRes.data?.plans || []))
      setInvoices(invRes.data?.invoices || [])
    } catch {}
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [token])

  const changePlan = async (planName) => {
    setActionErr('')
    try {
      await apiFetch('post', '/billing/change-plan', token, { plan_name: planName })
      setChangingPlan(false)
      load()
    } catch (e) { setActionErr(e?.response?.data?.detail || 'Ошибка') }
  }

  const generateInvoice = async () => {
    setActionErr('')
    try {
      await apiFetch('post', '/billing/generate', token, { months: invoiceMonths })
      setGenInvoiceModal(false)
      load()
    } catch (e) { setActionErr(e?.response?.data?.detail || 'Ошибка') }
  }

  const payInvoice = async (invoiceId) => {
    setActionErr('')
    try {
      await apiFetch('post', '/billing/pay', token, { invoice_id: invoiceId, amount: parseFloat(payAmount), payment_method: 'manual' })
      setPayModal(null)
      setPayAmount('')
      load()
    } catch (e) { setActionErr(e?.response?.data?.detail || 'Ошибка') }
  }

  const STATUS_COLORS = {
    trial: 'bg-amber-50 text-amber-700',
    active: 'bg-emerald-50 text-emerald-700',
    past_due: 'bg-red-50 text-red-700',
    cancelled: 'bg-gray-100 text-gray-600',
    paused: 'bg-blue-50 text-blue-700',
  }

  const INV_COLORS = {
    draft: 'bg-gray-100 text-gray-600',
    sent: 'bg-blue-50 text-blue-700',
    paid: 'bg-emerald-50 text-emerald-700',
    overdue: 'bg-red-50 text-red-700',
    void: 'bg-gray-100 text-gray-400',
  }

  const PLAN_COLORS = { basic: '#64748b', professional: '#0097A7', enterprise: '#7C3AED' }

  const sub = summary?.subscription
  const [ledgerSummary, setLedgerSummary] = useState(null)
  const [ledgerDays, setLedgerDays] = useState(30)

  const loadLedger = async (days) => {
    try {
      const r = await apiFetch('get', '/billing/ledger/summary?days=' + days, token)
      if (r.ok !== false) setLedgerSummary(r.data)
    } catch {}
  }

  useEffect(() => {
    if (activeTab === 'ledger' && !ledgerSummary) loadLedger(ledgerDays)
  }, [activeTab])

  const TABS = [
    { key: 'summary', label: 'Подписка', icon: 'card_membership' },
    { key: 'invoices', label: 'Счета', icon: 'receipt_long' },
    { key: 'plans', label: 'Тарифы', icon: 'workspace_premium' },
    { key: 'ledger', label: 'Финансы', icon: 'account_balance_wallet' },
  ]

  if (loading) return <Spinner />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold font-headline text-gray-900 dark:text-white">Биллинг</h2>
          <p className="text-sm text-gray-500 mt-0.5">Управление подпиской и счетами</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setGenInvoiceModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 border border-[#0097A7] text-[#0097A7] rounded-xl text-sm font-semibold hover:bg-[#e0f7fa] transition">
            <span className="material-symbols-outlined text-lg">add</span>
            Выставить счёт
          </button>
        </div>
      </div>

      {actionErr && <ErrorBox msg={actionErr} />}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl w-fit">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition ${activeTab === t.key ? 'bg-white dark:bg-gray-700 text-[#0097A7] shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
            <span className="material-symbols-outlined text-base">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* Summary */}
      {activeTab === 'summary' && (
        <div className="space-y-4">
          {sub && (
            <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Текущий тариф</p>
                  <h3 className="text-2xl font-extrabold font-headline" style={{ color: PLAN_COLORS[sub.plan_name] || '#0097A7' }}>
                    {sub.plan_name?.charAt(0).toUpperCase() + sub.plan_name?.slice(1)}
                  </h3>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-3 py-1 rounded-full text-sm font-semibold ${STATUS_COLORS[sub.status] || 'bg-gray-100 text-gray-600'}`}>
                    {sub.status}
                  </span>
                  <button onClick={() => setChangingPlan(true)}
                    className="px-4 py-2 bg-[#0097A7] text-white rounded-xl text-sm font-semibold hover:bg-[#00838f] transition">
                    Сменить тариф
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                {[
                  { label: 'Начало', val: sub.start_date ? new Date(sub.start_date).toLocaleDateString('ru-RU') : '—' },
                  { label: 'Следующий платёж', val: sub.next_billing_date ? new Date(sub.next_billing_date).toLocaleDateString('ru-RU') : '—' },
                  { label: 'Оплачено', val: `${(summary.total_paid || 0).toLocaleString('ru-RU')} ₽` },
                  { label: 'К оплате', val: `${(summary.total_due || 0).toLocaleString('ru-RU')} ₽`, highlight: summary.total_due > 0 },
                ].map(c => (
                  <div key={c.label}>
                    <p className="text-xs text-gray-400">{c.label}</p>
                    <p className={`font-bold ${c.highlight ? 'text-red-600' : 'text-gray-800 dark:text-gray-200'}`}>{c.val}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {!sub && (
            <div className="bg-amber-50 dark:bg-amber-900/30 rounded-2xl p-6 text-center">
              <p className="text-amber-700 dark:text-amber-300 font-medium">Подписка не активна. Выберите тариф.</p>
            </div>
          )}
        </div>
      )}

      {/* Invoices */}
      {activeTab === 'invoices' && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900/50 text-xs text-gray-500 uppercase tracking-wider">
                  <th className="px-4 py-3 text-left">Номер</th>
                  <th className="px-4 py-3 text-left">Период</th>
                  <th className="px-4 py-3 text-right">Сумма</th>
                  <th className="px-4 py-3 text-left">Статус</th>
                  <th className="px-4 py-3 text-left">Срок</th>
                  <th className="px-4 py-3 text-right">Действие</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {invoices.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-gray-400">Нет счетов</td></tr>}
                {invoices.map(inv => (
                  <tr key={inv.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition">
                    <td className="px-4 py-3 font-mono text-xs text-gray-700 dark:text-gray-300">{inv.invoice_number}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {new Date(inv.period_start).toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' })} — {new Date(inv.period_end).toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' })}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-gray-800 dark:text-gray-200">{(inv.amount).toLocaleString('ru-RU')} ₽</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${INV_COLORS[inv.status] || 'bg-gray-100 text-gray-600'}`}>{inv.status}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">{inv.due_date ? new Date(inv.due_date).toLocaleDateString('ru-RU') : '—'}</td>
                    <td className="px-4 py-3 text-right">
                      {(inv.status === 'sent' || inv.status === 'overdue') && (
                        <button onClick={() => { setPayModal(inv); setPayAmount(inv.amount) }}
                          className="text-xs px-3 py-1 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition">
                          Оплатить
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Plans */}
      {activeTab === 'plans' && (() => {
        const price = (p) => billingCycle === 'annual' ? Math.round(p.price_annual / 12) : Math.round(p.price_monthly)
        const isCurrent = (p) => sub?.plan_name === p.plan
        return (
          <div className="space-y-5">
            {/* Переключатель цикла */}
            <div className="flex items-center justify-center gap-3">
              <span className={`text-sm font-semibold transition ${billingCycle === 'monthly' ? 'text-[#191c1e] dark:text-white' : 'text-[#727783]'}`}>Ежемесячно</span>
              <button onClick={() => setBillingCycle(c => c === 'monthly' ? 'annual' : 'monthly')}
                className={`relative w-12 h-6 rounded-full transition-colors ${billingCycle === 'annual' ? 'bg-[#0097A7]' : 'bg-gray-300 dark:bg-gray-600'}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${billingCycle === 'annual' ? 'translate-x-6' : ''}`} />
              </button>
              <span className={`text-sm font-semibold transition ${billingCycle === 'annual' ? 'text-[#191c1e] dark:text-white' : 'text-[#727783]'}`}>Годовой</span>
              {billingCycle === 'annual' && <span className="text-xs font-bold bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full">Скидка ~{plans[0]?.discount_annual_pct || 17}%</span>}
            </div>
            {/* Карточки */}
            <div className="grid md:grid-cols-3 gap-5">
              {plans.map(p => {
                const current = isCurrent(p)
                const monthly = price(p)
                const gradient = p.gradient || 'from-gray-500 to-gray-700'
                return (
                  <div key={p.plan} className={`relative bg-white dark:bg-gray-800 rounded-3xl overflow-hidden flex flex-col transition-all duration-300 ${current ? 'ring-2 ring-[#0097A7] scale-[1.02]' : 'hover:scale-[1.01]'}`}
                    style={{boxShadow: current ? '0 8px 32px rgba(0,151,167,0.18)' : '0 4px 24px rgba(25,28,30,0.08)'}}>
                    {/* Шапка с градиентом */}
                    <div className={`bg-gradient-to-br ${gradient} p-6 text-white relative`}>
                      {p.badge && (
                        <span className="absolute top-3 right-3 text-[10px] font-bold bg-white/20 backdrop-blur-sm px-2.5 py-1 rounded-full">
                          {p.badge}
                        </span>
                      )}
                      <p className="text-xs font-bold uppercase tracking-widest opacity-80 mb-1">{p.name || p.plan}</p>
                      <div className="flex items-end gap-1">
                        <span className="text-4xl font-extrabold font-headline">{monthly.toLocaleString('ru-RU')}</span>
                        <span className="text-sm opacity-70 mb-1">₽/мес</span>
                      </div>
                      {billingCycle === 'annual' && (
                        <p className="text-[11px] opacity-60 mt-0.5">{p.price_annual?.toLocaleString('ru-RU')} ₽/год · скидка {p.discount_annual_pct}%</p>
                      )}
                      <p className="text-xs opacity-70 mt-2">{p.subtitle || ''}</p>
                    </div>
                    {/* Функционал — буллеты */}
                    <div className="p-5 flex-1 flex flex-col">
                      <ul className="space-y-2 flex-1">
                        {(p.bullets || p.features || []).map((item, i) => {
                          const label = typeof item === 'string' ? item : (item.label || item.key)
                          return (
                            <li key={i} className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
                              <span className="material-symbols-outlined text-emerald-500 text-base flex-shrink-0 mt-0.5" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                              <span>{label}</span>
                            </li>
                          )
                        })}
                      </ul>
                      <div className="mt-5">
                        {current ? (
                          <div className="w-full py-2.5 rounded-2xl text-sm font-bold text-center border-2 border-[#0097A7] text-[#0097A7] flex items-center justify-center gap-1.5">
                            <span className="material-symbols-outlined text-base" style={{fontVariationSettings:"'FILL' 1"}}>verified</span>
                            Текущий тариф
                          </div>
                        ) : (
                          <button onClick={() => changePlan(p.plan)}
                            className={`w-full py-2.5 rounded-2xl text-sm font-bold bg-gradient-to-br ${gradient} text-white hover:opacity-90 transition`}>
                            Перейти на {p.name || p.plan}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* Модал смены тарифа */}
      {changingPlan && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-white">Сменить тариф</h3>
            <div className="space-y-3">
              {plans.map(p => (
                <button key={p.plan} onClick={() => changePlan(p.plan)}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-sm font-medium transition ${sub?.plan_name === p.plan ? 'border-[#0097A7] bg-[#e0f7fa] text-[#0097A7]' : 'border-gray-200 dark:border-gray-600 hover:border-[#0097A7] text-gray-700 dark:text-gray-200'}`}>
                  <span>{p.plan?.charAt(0).toUpperCase() + p.plan?.slice(1)}</span>
                  <span className="text-gray-500">{(p.price_monthly).toLocaleString('ru-RU')} ₽/мес</span>
                </button>
              ))}
            </div>
            <button onClick={() => setChangingPlan(false)}
              className="mt-4 w-full py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition">
              Отмена
            </button>
          </div>
        </div>
      )}

      {/* Модал выставления счёта */}
      {genInvoiceModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-white">Выставить счёт</h3>
            <div className="space-y-3">
              <label className="text-sm text-gray-600 dark:text-gray-400">Количество месяцев</label>
              <div className="flex gap-2">
                {[1, 3, 6, 12].map(m => (
                  <button key={m} onClick={() => setInvoiceMonths(m)}
                    className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition ${invoiceMonths === m ? 'bg-[#0097A7] text-white border-[#0097A7]' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-[#0097A7]'}`}>
                    {m}м
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={generateInvoice}
                className="flex-1 py-2 bg-[#0097A7] text-white rounded-xl text-sm font-semibold hover:bg-[#00838f] transition">
                Создать
              </button>
              <button onClick={() => setGenInvoiceModal(false)}
                className="flex-1 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модал оплаты счёта */}

          {activeTab === 'ledger' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-gray-800 dark:text-white">Финансовый журнал (Billing v2)</h3>
                <div className="flex gap-2">
                  {[7, 30, 90].map(d => (
                    <button key={d}
                      onClick={() => { setLedgerDays(d); loadLedger(d) }}
                      className={"px-3 py-1 text-xs rounded-full border font-semibold transition " + (ledgerDays === d ? 'bg-teal-600 text-white border-teal-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50')}>
                      {d}д
                    </button>
                  ))}
                  <button onClick={() => loadLedger(ledgerDays)}
                    className="px-3 py-1 text-xs rounded-full border border-teal-200 text-teal-700 hover:bg-teal-50 font-semibold">
                    Обновить
                  </button>
                </div>
              </div>
              {!ledgerSummary ? (
                <div className="text-center py-12 text-gray-400">
                  <span className="material-symbols-outlined text-5xl block mb-3">account_balance_wallet</span>
                  <p className="text-sm mb-3">Данные финансового журнала Billing v2</p>
                  <button onClick={() => loadLedger(ledgerDays)}
                    className="px-4 py-2 bg-teal-600 text-white text-sm rounded-lg font-semibold hover:bg-teal-700">
                    Загрузить
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      { label: 'Доходы', value: ledgerSummary.total_credit || 0, icon: 'trending_up', cls: 'text-green-600 bg-green-50' },
                      { label: 'Расходы', value: ledgerSummary.total_debit || 0, icon: 'trending_down', cls: 'text-red-600 bg-red-50' },
                      { label: 'Платформа', value: ledgerSummary.platform_income || 0, icon: 'corporate_fare', cls: 'text-violet-600 bg-violet-50' },
                      { label: 'Записей', value: Object.values(ledgerSummary.breakdown || {}).reduce((s, v) => s + (v.count || 0), 0), icon: 'format_list_bulleted', cls: 'text-blue-600 bg-blue-50', noFormat: true },
                    ].map(s => (
                      <div key={s.label} className={"rounded-xl p-4 flex items-center gap-3 " + s.cls.split(' ')[1]}>
                        <span className={"material-symbols-outlined text-2xl " + s.cls.split(' ')[0]}>{s.icon}</span>
                        <div>
                          <div className={"text-xl font-bold " + s.cls.split(' ')[0]}>
                            {s.noFormat ? s.value : (Number(s.value) || 0).toLocaleString('ru-RU', {maximumFractionDigits: 0}) + ' ₽'}
                          </div>
                          <div className="text-xs text-gray-500">{s.label}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {ledgerSummary.breakdown && Object.keys(ledgerSummary.breakdown).length > 0 && (
                    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 overflow-hidden">
                      <div className="px-4 py-3 border-b border-gray-100 font-semibold text-sm text-gray-700">По типу операций</div>
                      <div className="divide-y divide-gray-50">
                        {Object.entries(ledgerSummary.breakdown).map(([type, data]) => (
                          <div key={type} className="px-4 py-3 flex justify-between items-center text-sm">
                            <span className="text-gray-500">{type.replace(/_/g, ' ')}</span>
                            <span className="font-semibold">{(data.amount || data || 0).toLocaleString('ru-RU', {maximumFractionDigits:0})} ₽</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="text-xs text-gray-400 text-right">За {ledgerDays} дней · append-only ledger v2</div>
                </div>
              )}
            </div>
          )}

      {payModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="text-lg font-bold mb-2 text-gray-900 dark:text-white">Оплата счёта</h3>
            <p className="text-sm text-gray-500 mb-4">{payModal.invoice_number}</p>
            <input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)}
              placeholder="Сумма оплаты"
              className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm dark:bg-gray-700 dark:text-white mb-4" />
            <div className="flex gap-3">
              <button onClick={() => payInvoice(payModal.id)}
                className="flex-1 py-2 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700 transition">
                Подтвердить оплату
              </button>
              <button onClick={() => setPayModal(null)}
                className="flex-1 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


// ---------------------------------------------------------------------------
// SchedulingSection — управление расписанием врачей и записями
// ---------------------------------------------------------------------------
function SchedulingSection({ token }) {
  const [activeTab, setActiveTab] = useState('doctors')
  const [doctors, setDoctors] = useState([])
  const [clinics, setClinics] = useState([])
  const [appointments, setAppointments] = useState([])
  const [loading, setLoading] = useState(true)
  const [apptFilter, setApptFilter] = useState('all')

  // Календарь
  const [calDoctor, setCalDoctor] = useState(null)
  const [weekOffset, setWeekOffset] = useState(0)
  const [slotsCache, setSlotsCache] = useState({}) // date → slots[]
  const [calLoading, setCalLoading] = useState(false)

  // Модалы
  const [doctorModal, setDoctorModal] = useState(null)  // null | 'new' | doctorObj
  const [scheduleModal, setScheduleModal] = useState(null) // null | doctorObj
  const [bookModal, setBookModal] = useState(null) // null | {doctor, date, start_time}
  const [scheduleData, setScheduleData] = useState([])
  const [actionErr, setActionErr] = useState('')

  // Форма врача
  const EMPTY_DOC = { clinic_id: '', full_name: '', specialty: '', bio: '', slot_duration: 30 }
  const [docForm, setDocForm] = useState(EMPTY_DOC)

  // Форма записи
  const EMPTY_BOOK = { patient_name: '', patient_phone: '', notes: '' }
  const [bookForm, setBookForm] = useState(EMPTY_BOOK)

  // Загрузка базовых данных
  const loadBase = async () => {
    setLoading(true)
    try {
      const [dRes, cRes, aRes] = await Promise.all([
        apiFetch('get', '/doctors', token),
        apiFetch('get', '/clinics', token),
        apiFetch('get', '/appointments', token),
      ])
      setDoctors(Array.isArray(dRes.data) ? dRes.data : [])
      setClinics(Array.isArray(cRes.data) ? cRes.data : [])
      setAppointments(Array.isArray(aRes.data) ? aRes.data : [])
    } catch {}
    finally { setLoading(false) }
  }

  useEffect(() => { loadBase() }, [token])

  // Получение дат недели
  const getWeekDates = () => {
    const now = new Date()
    const day = now.getDay()
    const monday = new Date(now)
    monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1) + weekOffset * 7)
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday)
      d.setDate(monday.getDate() + i)
      return d
    })
  }

  const fmtDate = d => {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${dd}`
  }

  const DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
  const weekDates = getWeekDates()

  // Загрузка слотов для недели
  const loadWeekSlots = async (doctor) => {
    if (!doctor) return
    setCalLoading(true)
    const newCache = { ...slotsCache }
    await Promise.all(
      weekDates.map(async d => {
        const key = `${doctor.id}_${fmtDate(d)}`
        if (!newCache[key]) {
          try {
            const res = await apiFetch('get', `/doctors/${doctor.id}/slots?target_date=${fmtDate(d)}`, token)
            newCache[key] = res.data || []
          } catch { newCache[key] = [] }
        }
      })
    )
    setSlotsCache(newCache)
    setCalLoading(false)
  }

  useEffect(() => {
    if (activeTab === 'calendar' && calDoctor) loadWeekSlots(calDoctor)
  }, [activeTab, calDoctor, weekOffset])

  // Загрузка расписания врача для редактора
  const loadSchedule = async (doctor) => {
    try {
      const res = await apiFetch('get', `/doctors/${doctor.id}/schedule`, token)
      const days = Array.from({ length: 7 }, (_, i) => {
        const existing = (res.data || []).find(d => d.day_of_week === i)
        return existing || { day_of_week: i, start_time: '09:00', end_time: '18:00', is_active: false }
      })
      setScheduleData(days)
    } catch {}
  }

  const saveSchedule = async () => {
    setActionErr('')
    try {
      await apiFetch('put', `/doctors/${scheduleModal.id}/schedule`, token, scheduleData)
      setScheduleModal(null)
      if (calDoctor?.id === scheduleModal.id) {
        setSlotsCache({})
        loadWeekSlots(scheduleModal)
      }
    } catch (e) { setActionErr(e?.response?.data?.detail || 'Ошибка') }
  }

  const saveDoctor = async () => {
    setActionErr('')
    try {
      if (doctorModal === 'new') {
        await apiFetch('post', '/doctors', token, { ...docForm, slot_duration: parseInt(docForm.slot_duration) })
      } else {
        await apiFetch('patch', `/doctors/${doctorModal.id}`, token, { ...docForm, slot_duration: parseInt(docForm.slot_duration) })
      }
      setDoctorModal(null)
      loadBase()
    } catch (e) { setActionErr(e?.response?.data?.detail || 'Ошибка') }
  }

  const bookAppointment = async () => {
    setActionErr('')
    try {
      await apiFetch('post', '/appointments', token, {
        doctor_id: bookModal.doctor.id,
        appointment_date: bookModal.date,
        start_time: bookModal.start_time,
        patient_phone: bookForm.patient_phone,
        patient_name: bookForm.patient_name || null,
        notes: bookForm.notes || null,
      })
      setBookModal(null)
      setBookForm(EMPTY_BOOK)
      setSlotsCache({})
      loadWeekSlots(calDoctor)
      loadBase()
    } catch (e) { setActionErr(e?.response?.data?.detail || 'Ошибка') }
  }

  const updateApptStatus = async (id, status) => {
    try {
      await apiFetch('patch', `/appointments/${id}/status`, token, { status })
      setAppointments(a => a.map(x => x.id === id ? { ...x, status } : x))
    } catch {}
  }

  const APPT_STATUS_COLORS = {
    pending: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    confirmed: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    cancelled: 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-300',
    completed: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    no_show: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
  }
  const APPT_STATUS_LABELS = {
    pending: 'Ожидает', confirmed: 'Подтверждено', cancelled: 'Отменено',
    completed: 'Завершено', no_show: 'Не явился',
  }

  const filteredAppts = appointments.filter(a => apptFilter === 'all' || a.status === apptFilter)

  const TABS = [
    { key: 'doctors', label: 'Врачи', icon: 'person_search' },
    { key: 'calendar', label: 'Календарь', icon: 'calendar_month' },
    { key: 'appointments', label: 'Записи', icon: 'event_note' },
  ]

  if (loading) return <Spinner />

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold font-headline text-gray-900 dark:text-white">Расписание</h2>
          <p className="text-sm text-gray-500 mt-0.5">Управление врачами, расписанием и записями пациентов</p>
        </div>
        {activeTab === 'doctors' && (
          <button onClick={() => { setDocForm(EMPTY_DOC); setDoctorModal('new') }}
            className="flex items-center gap-2 px-4 py-2 bg-[#0097A7] text-white rounded-xl text-sm font-semibold hover:bg-[#00838f] transition">
            <span className="material-symbols-outlined text-lg">add</span>
            Добавить врача
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl w-fit flex-wrap">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition ${activeTab === t.key ? 'bg-white dark:bg-gray-700 text-[#0097A7] shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
            <span className="material-symbols-outlined text-base">{t.icon}</span>
            {t.label}
            {t.key === 'appointments' && appointments.filter(a => a.status === 'pending').length > 0 && (
              <span className="ml-1 bg-amber-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">
                {appointments.filter(a => a.status === 'pending').length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ─── TAB: Врачи ─── */}
      {activeTab === 'doctors' && (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {doctors.length === 0 && (
            <div className="col-span-3 text-center py-12 text-gray-400">
              <span className="material-symbols-outlined text-4xl mb-2 block">person_search</span>
              <p>Нет врачей. Добавьте первого.</p>
            </div>
          )}
          {doctors.map(doc => {
            const clinic = clinics.find(c => c.id === doc.clinic_id)
            return (
              <div key={doc.id} className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm">
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#006173] to-[#0097A7] flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
                    {doc.full_name[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-800 dark:text-gray-200 truncate">{doc.full_name}</p>
                    <p className="text-xs text-gray-400">{doc.specialty || 'Специальность не указана'}</p>
                    {clinic && <p className="text-xs text-[#0097A7] mt-0.5">{clinic.name}</p>}
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${doc.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                    {doc.is_active ? 'Активен' : 'Неактивен'}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-400 mb-4">
                  <span className="material-symbols-outlined text-sm">schedule</span>
                  <span>Слот: {doc.slot_duration} мин</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setCalDoctor(doc); setSlotsCache({}); setActiveTab('calendar') }}
                    className="flex-1 py-1.5 text-xs font-medium text-[#0097A7] border border-[#0097A7] rounded-lg hover:bg-[#e0f7fa] transition">
                    Календарь
                  </button>
                  <button
                    onClick={() => { setScheduleModal(doc); loadSchedule(doc) }}
                    className="flex-1 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                    Расписание
                  </button>
                  <button
                    onClick={() => { setDocForm({ clinic_id: doc.clinic_id, full_name: doc.full_name, specialty: doc.specialty || '', bio: doc.bio || '', slot_duration: doc.slot_duration }); setDoctorModal(doc) }}
                    className="p-1.5 text-gray-400 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                    <span className="material-symbols-outlined text-sm">edit</span>
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ─── TAB: Календарь ─── */}
      {activeTab === 'calendar' && (
        <div className="space-y-4">
          {/* Выбор врача */}
          <div className="flex flex-wrap gap-3 items-center">
            <select value={calDoctor?.id || ''} onChange={e => {
              const d = doctors.find(x => x.id === e.target.value)
              setCalDoctor(d || null)
              setSlotsCache({})
            }}
              className="border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm dark:bg-gray-700 dark:text-white min-w-[220px]">
              <option value="">— Выберите врача —</option>
              {doctors.filter(d => d.is_active).map(d => (
                <option key={d.id} value={d.id}>{d.full_name} · {d.specialty}</option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              <button onClick={() => setWeekOffset(w => w - 1)}
                className="p-2 rounded-xl border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                <span className="material-symbols-outlined text-lg text-gray-600 dark:text-gray-300">chevron_left</span>
              </button>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
                {weekDates[0].toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} — {weekDates[6].toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
              <button onClick={() => setWeekOffset(w => w + 1)}
                className="p-2 rounded-xl border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                <span className="material-symbols-outlined text-lg text-gray-600 dark:text-gray-300">chevron_right</span>
              </button>
              {weekOffset !== 0 && (
                <button onClick={() => setWeekOffset(0)}
                  className="text-sm text-[#0097A7] font-medium hover:underline">
                  Сегодня
                </button>
              )}
            </div>
          </div>

          {!calDoctor ? (
            <div className="bg-white dark:bg-gray-800 rounded-2xl p-12 text-center text-gray-400 shadow-sm">
              <span className="material-symbols-outlined text-5xl mb-3 block">calendar_month</span>
              <p>Выберите врача для просмотра расписания</p>
            </div>
          ) : calLoading ? <Spinner /> : (
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden">
              {/* Заголовки дней */}
              <div className="grid grid-cols-7 border-b border-gray-100 dark:border-gray-700">
                {weekDates.map((d, i) => {
                  const isToday = fmtDate(d) === fmtDate(new Date())
                  return (
                    <div key={i} className={`p-3 text-center border-r last:border-r-0 border-gray-100 dark:border-gray-700 ${isToday ? 'bg-[#e0f7fa] dark:bg-[#004D5F]/40' : ''}`}>
                      <p className={`text-xs font-medium ${isToday ? 'text-[#0097A7]' : 'text-gray-400'}`}>{DAY_NAMES[i]}</p>
                      <p className={`text-lg font-bold ${isToday ? 'text-[#0097A7]' : 'text-gray-700 dark:text-gray-300'}`}>{d.getDate()}</p>
                    </div>
                  )
                })}
              </div>

              {/* Слоты */}
              <div className="grid grid-cols-7 min-h-[300px]">
                {weekDates.map((d, i) => {
                  const dateStr = fmtDate(d)
                  const daySlots = slotsCache[`${calDoctor.id}_${dateStr}`] || []
                  const isToday = dateStr === fmtDate(new Date())
                  const isPast = d < new Date(new Date().setHours(0,0,0,0))

                  return (
                    <div key={i} className={`border-r last:border-r-0 border-gray-100 dark:border-gray-700 p-2 ${isToday ? 'bg-[#f0fbfc] dark:bg-[#004D5F]/20' : ''}`}>
                      {daySlots.length === 0 && (
                        <p className="text-xs text-gray-300 dark:text-gray-600 text-center pt-4">—</p>
                      )}
                      <div className="space-y-1">
                        {daySlots.map((slot, si) => {
                          const isBooked = !slot.available
                          const slotTime = slot.start_time
                          return (
                            <button
                              key={si}
                              disabled={isBooked || isPast}
                              onClick={() => { if (!isBooked && !isPast) { setBookModal({ doctor: calDoctor, date: dateStr, start_time: slotTime }); setBookForm(EMPTY_BOOK); setActionErr('') } }}
                              className={`w-full text-xs px-1.5 py-1 rounded-lg font-medium transition text-center ${
                                isBooked
                                  ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300 cursor-default'
                                  : isPast
                                    ? 'bg-gray-50 text-gray-300 dark:bg-gray-800 dark:text-gray-600 cursor-default'
                                    : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 hover:bg-emerald-100 cursor-pointer'
                              }`}>
                              {slotTime}
                              {isBooked && <span className="block text-[10px] opacity-70">занят</span>}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Легенда */}
              <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-700 flex gap-4 text-xs text-gray-500">
                <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-100 dark:bg-emerald-900/40 inline-block"/><span>Свободно</span></div>
                <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-blue-100 dark:bg-blue-900/40 inline-block"/><span>Занято</span></div>
                <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-gray-50 dark:bg-gray-700 inline-block"/><span>Прошедшее</span></div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── TAB: Записи ─── */}
      {activeTab === 'appointments' && (
        <div className="space-y-4">
          {/* Фильтр по статусу */}
          <div className="flex gap-2 flex-wrap">
            {[['all', 'Все'], ['pending', 'Ожидают'], ['confirmed', 'Подтверждено'], ['completed', 'Завершено'], ['cancelled', 'Отменено']].map(([val, label]) => (
              <button key={val} onClick={() => setApptFilter(val)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${apptFilter === val ? 'bg-[#0097A7] text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 hover:border-[#0097A7]'}`}>
                {label}
                {val !== 'all' && appointments.filter(a => a.status === val).length > 0 && (
                  <span className="ml-1 text-xs">({appointments.filter(a => a.status === val).length})</span>
                )}
              </button>
            ))}
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-900/50 text-xs text-gray-500 uppercase tracking-wider">
                    <th className="px-4 py-3 text-left">Пациент</th>
                    <th className="px-4 py-3 text-left">Врач</th>
                    <th className="px-4 py-3 text-left">Дата и время</th>
                    <th className="px-4 py-3 text-left">Статус</th>
                    <th className="px-4 py-3 text-right">Действие</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {filteredAppts.length === 0 && (
                    <tr><td colSpan={5} className="text-center py-8 text-gray-400">Нет записей</td></tr>
                  )}
                  {filteredAppts.map(a => {
                    const doc = doctors.find(d => d.id === a.doctor_id)
                    return (
                      <tr key={a.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition">
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-800 dark:text-gray-200">{a.patient_name || 'Имя не указано'}</p>
                          <p className="text-xs text-gray-400">{a.patient_phone}</p>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                          {doc?.full_name || 'Врач'}
                          {doc?.specialty && <span className="text-xs text-gray-400 block">{doc.specialty}</span>}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
                          <span>{a.appointment_date}</span>
                          <span className="ml-2 font-medium text-gray-800 dark:text-gray-200">{a.start_time}</span>
                          {a.end_time && <span className="text-xs text-gray-400"> – {a.end_time}</span>}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${APPT_STATUS_COLORS[a.status] || ''}`}>
                            {APPT_STATUS_LABELS[a.status] || a.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex gap-1 justify-end">
                            {a.status === 'pending' && (
                              <>
                                <button onClick={() => updateApptStatus(a.id, 'confirmed')}
                                  className="text-xs px-2 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
                                  Подтвердить
                                </button>
                                <button onClick={() => updateApptStatus(a.id, 'cancelled')}
                                  className="text-xs px-2 py-1 bg-red-500 text-white rounded-lg hover:bg-red-600 transition">
                                  Отменить
                                </button>
                              </>
                            )}
                            {a.status === 'confirmed' && (
                              <button onClick={() => updateApptStatus(a.id, 'completed')}
                                className="text-xs px-2 py-1 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition">
                                Завершить
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ─── МОДАЛ: Добавить/редактировать врача ─── */}
      {doctorModal !== null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-white">
              {doctorModal === 'new' ? 'Добавить врача' : 'Редактировать врача'}
            </h3>
            <ErrorBox msg={actionErr} />
            <div className="space-y-3">
              <input type="text" placeholder="ФИО врача" value={docForm.full_name}
                onChange={e => setDocForm(f => ({ ...f, full_name: e.target.value }))}
                className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm dark:bg-gray-700 dark:text-white" />
              <input type="text" placeholder="Специальность" value={docForm.specialty}
                onChange={e => setDocForm(f => ({ ...f, specialty: e.target.value }))}
                className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm dark:bg-gray-700 dark:text-white" />
              <select value={docForm.clinic_id}
                onChange={e => setDocForm(f => ({ ...f, clinic_id: e.target.value }))}
                className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm dark:bg-gray-700 dark:text-white">
                <option value="">— Выберите клинику —</option>
                {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-600 dark:text-gray-400 flex-shrink-0">Длина слота (мин):</label>
                <select value={docForm.slot_duration}
                  onChange={e => setDocForm(f => ({ ...f, slot_duration: e.target.value }))}
                  className="border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm dark:bg-gray-700 dark:text-white">
                  {[15, 20, 30, 45, 60].map(v => <option key={v} value={v}>{v} мин</option>)}
                </select>
              </div>
              <textarea placeholder="О враче (необязательно)" value={docForm.bio}
                onChange={e => setDocForm(f => ({ ...f, bio: e.target.value }))} rows={3}
                className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm dark:bg-gray-700 dark:text-white resize-none" />
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={saveDoctor}
                className="flex-1 py-2 bg-[#0097A7] text-white rounded-xl text-sm font-semibold hover:bg-[#00838f] transition">
                Сохранить
              </button>
              <button onClick={() => { setDoctorModal(null); setActionErr('') }}
                className="flex-1 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── МОДАЛ: Редактор расписания ─── */}
      {scheduleModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-lg shadow-2xl">
            <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-white">
              Расписание — {scheduleModal.full_name}
            </h3>
            <ErrorBox msg={actionErr} />
            <div className="space-y-2">
              {scheduleData.map((day, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-8 text-center">
                    <button
                      onClick={() => setScheduleData(d => d.map((x, j) => j === i ? { ...x, is_active: !x.is_active } : x))}
                      className={`w-8 h-8 rounded-lg text-xs font-bold transition ${day.is_active ? 'bg-[#0097A7] text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-400'}`}>
                      {DAY_NAMES[i]}
                    </button>
                  </div>
                  <div className={`flex-1 flex gap-2 transition ${!day.is_active ? 'opacity-30' : ''}`}>
                    <input type="time" value={day.start_time} disabled={!day.is_active}
                      onChange={e => setScheduleData(d => d.map((x, j) => j === i ? { ...x, start_time: e.target.value } : x))}
                      className="flex-1 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm dark:bg-gray-700 dark:text-white" />
                    <span className="text-gray-400 self-center">—</span>
                    <input type="time" value={day.end_time} disabled={!day.is_active}
                      onChange={e => setScheduleData(d => d.map((x, j) => j === i ? { ...x, end_time: e.target.value } : x))}
                      className="flex-1 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm dark:bg-gray-700 dark:text-white" />
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-3">Нажмите на день недели чтобы включить/выключить</p>
            <div className="flex gap-3 mt-5">
              <button onClick={saveSchedule}
                className="flex-1 py-2 bg-[#0097A7] text-white rounded-xl text-sm font-semibold hover:bg-[#00838f] transition">
                Сохранить расписание
              </button>
              <button onClick={() => { setScheduleModal(null); setActionErr('') }}
                className="flex-1 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── МОДАЛ: Записать пациента ─── */}
      {bookModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="text-lg font-bold mb-1 text-gray-900 dark:text-white">Записать пациента</h3>
            <p className="text-sm text-gray-400 mb-4">
              {bookModal.doctor.full_name} · {bookModal.date} · <strong>{bookModal.start_time}</strong>
            </p>
            <ErrorBox msg={actionErr} />
            <div className="space-y-3">
              <input type="text" placeholder="Имя пациента" value={bookForm.patient_name}
                onChange={e => setBookForm(f => ({ ...f, patient_name: e.target.value }))}
                className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm dark:bg-gray-700 dark:text-white" />
              <input type="tel" placeholder="Телефон (+7...)" value={bookForm.patient_phone}
                onChange={e => setBookForm(f => ({ ...f, patient_phone: e.target.value }))}
                className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm dark:bg-gray-700 dark:text-white" />
              <textarea placeholder="Примечание (необязательно)" value={bookForm.notes}
                onChange={e => setBookForm(f => ({ ...f, notes: e.target.value }))} rows={2}
                className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm dark:bg-gray-700 dark:text-white resize-none" />
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={bookAppointment}
                className="flex-1 py-2 bg-[#0097A7] text-white rounded-xl text-sm font-semibold hover:bg-[#00838f] transition">
                Записать
              </button>
              <button onClick={() => { setBookModal(null); setActionErr('') }}
                className="flex-1 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// SuperAdminSection — Панель владельца платформы (role=super_admin)
// ---------------------------------------------------------------------------

function SuperAdminSection({ token }) {
  const [tab, setTab] = useState('metrics')
  const [metrics, setMetrics] = useState(null)
  const [tenants, setTenants] = useState([])
  const [billing, setBilling] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({
    name: '', slug: '', plan: 'basic', admin_name: '', admin_username: '', admin_password: '',
    primary_color: '#0097A7', sidebar_color: '#004D5F', city: ''
  })
  const [createResult, setCreateResult] = useState(null)
  const [creating, setCreating] = useState(false)
  const [createErr, setCreateErr] = useState('')
  const [selectedTenant, setSelectedTenant] = useState(null)
  const [modules, setModules] = useState([])
  const [manageBilling, setManageBilling] = useState(null)
  const [billingForm, setBillingForm] = useState({ plan: 'professional', billing_cycle: 'monthly', trial_days: 14 })
  const [billingMsg, setBillingMsg] = useState('')

  const ALL_MODULES = [
    'referrals','bonuses','clinics','qr_scan','analytics','support','invitations',
    'discounts','kpi','mis_sync','partner_portal','custom_branding','sms_notify',
    'scheduling','billing','audit_log','multi_tenant','api_access','financial_ledger'
  ]

  const load = () => {
    setLoading(true)
    Promise.all([
      apiFetch('get', '/admin/metrics', token),
      apiFetch('get', '/admin/tenants', token),
      apiFetch('get', '/admin/billing', token),
    ]).then(([m, t, b]) => {
      setMetrics(m.data)
      setTenants(t.data || [])
      setBilling(b.data)
      setLoading(false)
    }).catch(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const loadTenantModules = async (t) => {
    setSelectedTenant(t)
    const r = await apiFetch('get', `/admin/tenants/${t.id}`, token)
    setModules(r.data.modules || [])
  }

  const toggleModule = async (module, enabled) => {
    await apiFetch('put', `/admin/tenants/${selectedTenant.id}/modules`, token, { module, enabled })
    setModules(prev => {
      const existing = prev.find(m => m.module === module)
      if (existing) return prev.map(m => m.module === module ? { ...m, enabled } : m)
      return [...prev, { module, enabled }]
    })
  }

  const getModuleState = (module) => {
    const m = modules.find(x => x.module === module)
    return m ? m.enabled : null // null = наследует план
  }

  const handleCreate = async () => {
    setCreating(true)
    setCreateErr('')
    setCreateResult(null)
    try {
      const r = await apiFetch('post', '/tenant/create', token, createForm)
      setCreateResult(r.data)
      load()
    } catch (e) {
      setCreateErr(e.response?.data?.detail || 'Ошибка создания')
    }
    setCreating(false)
  }

  const toggleTenant = async (t) => {
    await apiFetch('patch', `/admin/tenants/${t.id}/toggle`, token, { is_active: !t.is_active })
    setTenants(prev => prev.map(x => x.id === t.id ? { ...x, is_active: !x.is_active } : x))
  }

  const statusColors = { trial:'bg-blue-100 text-blue-700', active:'bg-green-100 text-green-700', past_due:'bg-yellow-100 text-yellow-700', cancelled:'bg-red-100 text-red-700', paused:'bg-gray-100 text-gray-600' }
  const planColors = { basic:'bg-slate-100 text-slate-600', professional:'bg-purple-100 text-purple-700', enterprise:'bg-amber-100 text-amber-700' }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Платформа КлиникСеть</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Управление тенантами и подписками</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition">
          <span className="material-symbols-outlined text-[18px]">add</span>
          Новый тенант
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 bg-white dark:bg-gray-900 rounded-xl p-1 shadow-sm border border-gray-100 dark:border-gray-800 w-fit">
        {[['metrics','Метрики','monitoring'],['tenants','Тенанты','business'],['billing','Биллинг','receipt_long']].map(([key, label, icon]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition ${tab === key ? 'bg-blue-600 text-white shadow' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400'}`}>
            <span className="material-symbols-outlined text-[16px]">{icon}</span>
            {label}
          </button>
        ))}
      </div>

      {loading && <div className="text-center py-16 text-gray-400">Загрузка...</div>}

      {/* Tab: Метрики */}
      {!loading && tab === 'metrics' && metrics && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Тенантов всего', val: metrics.tenants_total, sub: `${metrics.tenants_active} активных`, icon: 'business', color: 'blue' },
              { label: 'Пользователей', val: metrics.users_total, sub: 'активных', icon: 'group', color: 'green' },
              { label: 'Клиник', val: metrics.clinics_total, sub: 'всего', icon: 'local_hospital', color: 'purple' },
              { label: 'Направлений', val: metrics.referrals_total, sub: 'всего', icon: 'send', color: 'orange' },
            ].map((c, i) => (
              <div key={i} className="bg-white dark:bg-gray-900 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-800">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{c.label}</p>
                  <span className={`material-symbols-outlined text-${c.color}-500 text-[22px]`}>{c.icon}</span>
                </div>
                <p className="text-3xl font-bold text-gray-900 dark:text-white">{c.val}</p>
                <p className="text-xs text-gray-400 mt-1">{c.sub}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Подписки по статусу */}
            <div className="bg-white dark:bg-gray-900 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-800">
              <h3 className="font-semibold text-gray-800 dark:text-white mb-4">Подписки по статусу</h3>
              {Object.entries(metrics.subscriptions_by_status || {}).map(([s, c]) => (
                <div key={s} className="flex items-center justify-between py-2 border-b border-gray-50 dark:border-gray-800 last:border-0">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[s] || 'bg-gray-100 text-gray-600'}`}>{s}</span>
                  <span className="font-bold text-gray-900 dark:text-white">{c}</span>
                </div>
              ))}
            </div>
            {/* По планам */}
            <div className="bg-white dark:bg-gray-900 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-800">
              <h3 className="font-semibold text-gray-800 dark:text-white mb-4">Тенанты по планам</h3>
              {Object.entries(metrics.tenants_by_plan || {}).map(([p, c]) => (
                <div key={p} className="flex items-center justify-between py-2 border-b border-gray-50 dark:border-gray-800 last:border-0">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${planColors[p] || 'bg-gray-100 text-gray-600'}`}>{p}</span>
                  <span className="font-bold text-gray-900 dark:text-white">{c}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tab: Тенанты */}
      {!loading && tab === 'tenants' && (
        <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100 dark:divide-gray-800">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  {['Тенант','Slug','План','Подписка','Клиники','Польз.','Статус','Действия'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                {tenants.map(t => (
                  <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white text-sm">{t.name}</td>
                    <td className="px-4 py-3 text-xs text-gray-500 font-mono">{t.slug}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${planColors[t.plan] || 'bg-gray-100'}`}>{t.plan || '—'}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[t.subscription_status] || 'bg-gray-100'}`}>{t.subscription_status || '—'}</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 text-center">{t.clinics_count}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 text-center">{t.users_count}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${t.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {t.is_active ? 'Активен' : 'Откл.'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button onClick={() => loadTenantModules(t)}
                          className="text-xs text-blue-600 hover:underline font-medium">Модули</button>
                        <button onClick={() => setManageBilling(t)}
                          className="text-xs text-violet-600 hover:underline font-medium">Подписка</button>
                        <button onClick={() => toggleTenant(t)}
                          className={`text-xs font-medium ${t.is_active ? 'text-red-500 hover:underline' : 'text-green-600 hover:underline'}`}>
                          {t.is_active ? 'Откл.' : 'Вкл.'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}


      {/* Модал управления подпиской тенанта */}
      {manageBilling && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-bold text-gray-900 dark:text-white text-lg">Подписка тенанта</h3>
                <p className="text-sm text-gray-500">{manageBilling.name}</p>
              </div>
              <button onClick={() => { setManageBilling(null); setBillingMsg('') }}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-gray-800">
                <span className="material-symbols-outlined text-gray-400">close</span>
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-1">Тарифный план</label>
                <select value={billingForm.plan} onChange={e => setBillingForm(f => ({...f, plan: e.target.value}))}
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm dark:bg-gray-800 dark:text-white">
                  <option value="basic">Basic — 4 990 ₽/мес</option>
                  <option value="professional">Professional — 9 990 ₽/мес</option>
                  <option value="enterprise">Enterprise — 24 990 ₽/мес</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-1">Цикл оплаты</label>
                <div className="flex gap-2">
                  {[{v:'monthly',l:'Ежемесячно'},{v:'annual',l:'Годовой (-17%)'}].map(c => (
                    <button key={c.v} onClick={() => setBillingForm(f => ({...f, billing_cycle: c.v}))}
                      className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition ${billingForm.billing_cycle === c.v ? 'bg-[#0097A7] text-white border-[#0097A7]' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300'}`}>
                      {c.l}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-1">Пробный период (дней, 0 = без trial)</label>
                <div className="flex gap-2">
                  {[0, 7, 14, 30].map(d => (
                    <button key={d} onClick={() => setBillingForm(f => ({...f, trial_days: d}))}
                      className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition ${billingForm.trial_days === d ? 'bg-[#0097A7] text-white border-[#0097A7]' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300'}`}>
                      {d === 0 ? 'Нет' : `${d}д`}
                    </button>
                  ))}
                </div>
              </div>
              {billingMsg && (
                <div className={`rounded-xl p-3 text-sm font-medium ${billingMsg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                  {billingMsg.text || billingMsg}
                </div>
              )}
              <button
                onClick={async () => {
                  setBillingMsg('')
                  try {
                    await apiFetch('post', `/admin/tenants/${manageBilling.id}/subscription`, token, billingForm)
                    setBillingMsg({ ok: true, text: 'Подписка активирована!' })
                    load()
                  } catch(e) {
                    setBillingMsg({ ok: false, text: e.response?.data?.detail || 'Ошибка' })
                  }
                }}
                className="w-full py-3 bg-[#0097A7] text-white rounded-xl text-sm font-bold hover:bg-[#00838f] transition">
                Активировать / Обновить подписку
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Биллинг */}
      {!loading && tab === 'billing' && billing && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-800">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">MRR (Monthly Recurring Revenue)</p>
            <p className="text-4xl font-bold text-green-600">{billing.mrr.toLocaleString('ru-RU')} ₽</p>
            <p className="text-xs text-gray-400 mt-1">{billing.subscriptions_count} подписок</p>
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100 dark:divide-gray-800">
                <thead className="bg-gray-50 dark:bg-gray-800">
                  <tr>
                    {['Тенант','План','Статус','Сумма/период','Конец периода','Trial до','Создан'].map(h => (
                      <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {billing.subscriptions.map(s => (
                    <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="px-3 py-3 font-medium text-gray-900 dark:text-white text-sm">{s.tenant_name}</td>
                      <td className="px-3 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${planColors[s.plan] || ''}`}>{s.plan}</span></td>
                      <td className="px-3 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[s.status] || ''}`}>{s.status}</span></td>
                      <td className="px-3 py-3 text-sm font-mono">{s.amount_per_period.toLocaleString('ru-RU')} ₽</td>
                      <td className="px-3 py-3 text-sm text-gray-500">{s.current_period_end}</td>
                      <td className="px-3 py-3 text-sm text-gray-500">{s.trial_ends_at ? s.trial_ends_at.slice(0,10) : '—'}</td>
                      <td className="px-3 py-3 text-xs text-gray-400">{s.created_at.slice(0,10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Управление модулями тенанта */}
      {selectedTenant && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-800">
              <div>
                <h3 className="font-bold text-gray-900 dark:text-white">Модули: {selectedTenant.name}</h3>
                <p className="text-xs text-gray-400 mt-0.5">Plan: {selectedTenant.plan} | Переопределяет план тенанта</p>
              </div>
              <button onClick={() => setSelectedTenant(null)} className="text-gray-400 hover:text-gray-700 dark:hover:text-white">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="p-5 space-y-2">
              {ALL_MODULES.map(mod => {
                const state = getModuleState(mod)
                return (
                  <div key={mod} className="flex items-center justify-between py-2 border-b border-gray-50 dark:border-gray-800 last:border-0">
                    <div>
                      <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{mod}</span>
                      {state === null && <span className="ml-2 text-xs text-gray-400">(из плана)</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => toggleModule(mod, true)}
                        className={`px-2 py-1 rounded text-xs font-medium transition ${state === true ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-green-100'}`}>ВКЛ</button>
                      <button onClick={() => toggleModule(mod, false)}
                        className={`px-2 py-1 rounded text-xs font-medium transition ${state === false ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-red-100'}`}>ВЫКЛ</button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Создание тенанта */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-800">
              <h3 className="font-bold text-gray-900 dark:text-white">Новый тенант</h3>
              <button onClick={() => { setShowCreate(false); setCreateResult(null); setCreateErr('') }}
                className="text-gray-400 hover:text-gray-700"><span className="material-symbols-outlined">close</span></button>
            </div>

            {createResult ? (
              <div className="p-5 space-y-4">
                <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                  <p className="text-green-800 font-bold text-sm mb-3">Тенант создан!</p>
                  {[
                    ['URL', createResult.url],
                    ['Логин', createResult.admin_username],
                    ['Пароль', createResult.admin_password],
                    ['Trial до', createResult.trial_until],
                    ['План', createResult.plan],
                  ].map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between py-1.5 border-b border-green-100 last:border-0">
                      <span className="text-xs text-green-600">{k}</span>
                      <span className="text-sm font-mono font-semibold text-green-800">{v}</span>
                    </div>
                  ))}
                </div>
                <button onClick={() => { setShowCreate(false); setCreateResult(null) }}
                  className="w-full bg-blue-600 text-white rounded-xl py-2.5 font-medium hover:bg-blue-700 transition">Закрыть</button>
              </div>
            ) : (
              <div className="p-5 space-y-3">
                {[
                  ['Название организации', 'name', 'text', 'ООО Клиника Грозный'],
                  ['Slug (URL)', 'slug', 'text', 'grozny'],
                  ['Город', 'city', 'text', 'Грозный'],
                  ['ФИО администратора', 'admin_name', 'text', 'Иван Иванов'],
                  ['Логин администратора', 'admin_username', 'text', 'grozny_admin'],
                  ['Пароль (авто если пусто)', 'admin_password', 'password', ''],
                ].map(([label, key, type, ph]) => (
                  <div key={key}>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{label}</label>
                    <input type={type} placeholder={ph} value={createForm[key]}
                      onChange={e => setCreateForm(f => ({ ...f, [key]: e.target.value }))}
                      className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none" />
                  </div>
                ))}
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Тарифный план</label>
                  <select value={createForm.plan} onChange={e => setCreateForm(f => ({ ...f, plan: e.target.value }))}
                    className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
                    <option value="basic">Basic — 4990₽/мес</option>
                    <option value="professional">Professional — 9990₽/мес</option>
                    <option value="enterprise">Enterprise — 24990₽/мес</option>
                  </select>
                </div>
                {createErr && <p className="text-red-500 text-xs bg-red-50 px-3 py-2 rounded-lg">{createErr}</p>}
                <button onClick={handleCreate} disabled={creating || !createForm.name || !createForm.slug || !createForm.admin_name || !createForm.admin_username}
                  className="w-full bg-blue-600 text-white rounded-xl py-2.5 font-medium hover:bg-blue-700 disabled:opacity-50 transition">
                  {creating ? 'Создание...' : 'Создать тенант'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}




// ---------------------------------------------------------------------------
// MisSyncSection — синхронизация с МИС Renovatio
// ---------------------------------------------------------------------------
function MisSyncSection({ token }) {
  const [misClinics, setMisClinics] = useState(null)
  const [misDoctors, setMisDoctors] = useState(null)
  const [misServices, setMisServices] = useState(null)
  const [ourClinics, setOurClinics] = useState([])
  const [tab, setTab] = useState('clinics')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [selectedClinics, setSelectedClinics] = useState([])
  const [selectedDoctors, setSelectedDoctors] = useState([])
  const [doctorAccounts, setDoctorAccounts] = useState(null)
  const [createAccForm, setCreateAccForm] = useState(null) // {doctor_id, full_name, username, password}
  const [createAccLoading, setCreateAccLoading] = useState(false)
  const [sourceClinicId, setSourceClinicId] = useState(1)
  const [targetClinicIds, setTargetClinicIds] = useState([])
  const [selectedCategories, setSelectedCategories] = useState([])
  const [selectedServices, setSelectedServices] = useState([])

  const showMsg = (t) => { setMsg(t); setTimeout(() => setMsg(''), 4000) }

  const loadMisClinics = async () => {
    try {
      const r = await apiFetch('get', '/mis/clinics', token)
      setMisClinics(r.data.clinics || [])
    } catch {}
  }

  const loadMisDoctors = async () => {
    try {
      const r = await apiFetch('get', '/mis/doctors', token)
      setMisDoctors(r.data.doctors || [])
    } catch {}
  }

  const loadMisServices = async () => {
    try {
      const r = await apiFetch('get', `/mis/services?clinic_mis_id=${sourceClinicId}`, token)
      setMisServices(r.data || null)
    } catch {}
  }

  const loadOurClinics = async () => {
    try {
      const r = await apiFetch('get', '/clinics', token)
      setOurClinics(Array.isArray(r.data) ? r.data : (Array.isArray(r.data?.clinics) ? r.data.clinics : []))
    } catch {}
  }

  useEffect(() => {
    loadOurClinics()
    if (tab === 'clinics' && !misClinics) loadMisClinics()
    if (tab === 'doctors' && !misDoctors) loadMisDoctors()
    if (tab === 'doctors' && !doctorAccounts) loadDoctorAccounts()
    if (tab === 'services' && !misServices) loadMisServices()
  }, [tab])

  const syncClinics = async () => {
    if (!selectedClinics.length) return showMsg('Выберите клиники для импорта')
    setLoading(true)
    try {
      const r = await apiFetch('post', '/mis/clinics/sync', token, { mis_ids: selectedClinics })
      showMsg(`Готово: создано ${r.data.created}, обновлено ${r.data.updated}`)
      loadOurClinics()
    } catch (e) { showMsg('Ошибка: ' + (e.response?.data?.detail || e.message)) }
    setLoading(false)
  }

  const loadDoctorAccounts = async () => {
    try {
      const r = await apiFetch('get', '/mis/doctors/accounts', token)
      setDoctorAccounts(Array.isArray(r.data) ? r.data : [])
    } catch {}
  }

  const createDoctorAccount = async () => {
    if (!createAccForm) return
    setCreateAccLoading(true)
    try {
      await apiFetch('post', '/mis/doctors/create-account', token, {
        doctor_id: createAccForm.doctor_id,
        username: createAccForm.username,
        password: createAccForm.password,
        full_name: createAccForm.full_name,
      })
      showMsg('Кабинет врача создан: @' + createAccForm.username)
      setCreateAccForm(null)
      setDoctorAccounts(null) // refresh
      loadDoctorAccounts()
    } catch (e) { showMsg('Ошибка: ' + (e.response?.data?.detail || e.message)) }
    setCreateAccLoading(false)
  }

  const syncDoctors = async () => {
    setLoading(true)
    try {
      const r = await apiFetch('post', '/mis/doctors/sync', token, {
        mis_ids: selectedDoctors.length ? selectedDoctors : null
      })
      showMsg(`Готово: создано ${r.data.created}, обновлено ${r.data.updated}, пропущено ${r.data.skipped}`)
    } catch (e) { showMsg('Ошибка: ' + (e.response?.data?.detail || e.message)) }
    setLoading(false)
  }

  const syncServices = async () => {
    if (!targetClinicIds.length) return showMsg('Выберите клиники назначения')
    setLoading(true)
    try {
      const r = await apiFetch('post', '/mis/services/sync', token, {
        source_clinic_mis_id: sourceClinicId,
        target_clinic_ids: targetClinicIds,
        category_filter: selectedCategories.length ? selectedCategories : null,
        service_mis_ids: selectedServices.length ? selectedServices : null,
      })
      showMsg(`Готово: создано ${r.data.created}, обновлено ${r.data.updated} из ${r.data.total_source} услуг`)
    } catch (e) { showMsg('Ошибка: ' + (e.response?.data?.detail || e.message)) }
    setLoading(false)
  }

  const pollReferrals = async () => {
    setLoading(true)
    try {
      const r = await apiFetch('post', '/mis/poll-referrals', token, {})
      showMsg(`Поллинг завершён: подтверждено ${r.data.confirmed} направлений, ошибок ${r.data.errors}`)
    } catch {}
    setLoading(false)
  }

  const TABS = [
    { key: 'clinics', label: 'Клиники', icon: 'local_hospital' },
    { key: 'doctors', label: 'Врачи', icon: 'person' },
    { key: 'services', label: 'Услуги', icon: 'medical_services' },
    { key: 'tools', label: 'Инструменты', icon: 'build' },
  ]

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">МИС Renovatio</h1>
          <p className="text-sm text-gray-500 mt-0.5">Синхронизация данных из МИС в систему</p>
        </div>
        {msg && <div className="bg-blue-600 text-white text-sm px-4 py-2 rounded-xl shadow">{msg}</div>}
      </div>

      <div className="flex gap-1 bg-white dark:bg-gray-900 rounded-xl p-1 shadow-sm border border-gray-100 dark:border-gray-800 w-fit">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all
              ${tab === t.key ? 'bg-[#0097A7] text-white shadow' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400'}`}>
            <span className="material-symbols-outlined text-[16px]">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* КЛИНИКИ */}
      {tab === 'clinics' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-5 border border-gray-100 dark:border-gray-800 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-900 dark:text-white">Клиники в МИС ({misClinics?.length || 0})</h3>
              <div className="flex gap-2">
                <button onClick={() => { setSelectedClinics(misClinics?.map(c => c.mis_id) || []) }}
                  className="text-xs text-[#0097A7] hover:underline">Выбрать все</button>
                <button onClick={syncClinics} disabled={loading || !selectedClinics.length}
                  className="bg-[#0097A7] text-white text-sm px-4 py-2 rounded-xl hover:bg-[#00838f] transition disabled:opacity-50">
                  {loading ? '...' : `Импорт (${selectedClinics.length})`}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              {(misClinics || []).map(c => {
                const isSelected = selectedClinics.includes(c.mis_id)
                const inOur = ourClinics.some(oc => oc.mis_id === c.mis_id)
                return (
                  <div key={c.mis_id} onClick={() => setSelectedClinics(s => isSelected ? s.filter(x => x !== c.mis_id) : [...s, c.mis_id])}
                    className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition
                      ${isSelected ? 'border-[#0097A7] bg-[#0097A7]/5' : 'border-gray-100 dark:border-gray-700 hover:border-gray-300'}`}>
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition
                      ${isSelected ? 'border-[#0097A7] bg-[#0097A7]' : 'border-gray-300'}`}>
                      {isSelected && <span className="material-symbols-outlined text-white text-[12px]">check</span>}
                    </div>
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: c.color || '#999' }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{c.name}</p>
                      <p className="text-xs text-gray-400">{c.city} · {c.address?.substring(0,50)}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {inOur && <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">В системе</span>}
                      <span className="text-xs text-gray-400">mis_id={c.mis_id}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          {/* Наши клиники */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-5 border border-gray-100 dark:border-gray-800 shadow-sm">
            <h3 className="font-bold text-gray-900 dark:text-white mb-3">В нашей системе ({ourClinics.length})</h3>
            <div className="divide-y divide-gray-50 dark:divide-gray-800">
              {(Array.isArray(ourClinics) ? ourClinics : []).map(c => (
                <div key={c.id} className="flex items-center gap-3 py-2">
                  <span className="material-symbols-outlined text-[#0097A7] text-[18px]" style={{fontVariationSettings:"'FILL' 1"}}>local_hospital</span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{c.name}</p>
                    <p className="text-xs text-gray-400">{c.address || '—'}</p>
                  </div>
                  {c.mis_id && <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">mis={c.mis_id}</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ВРАЧИ */}
      {tab === 'doctors' && (
        <div className="space-y-4">
          {/* Синхронизация из МИС */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-5 border border-gray-100 dark:border-gray-800 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-900 dark:text-white">Врачи в МИС ({misDoctors?.length || 0})</h3>
              <div className="flex gap-2">
                <button onClick={() => setSelectedDoctors([])} className="text-xs text-gray-400 hover:underline">Сброс</button>
                <button onClick={syncDoctors} disabled={loading}
                  className="bg-[#0097A7] text-white text-sm px-4 py-2 rounded-xl hover:bg-[#00838f] transition disabled:opacity-50">
                  {loading ? '...' : `Синхронизировать${selectedDoctors.length ? ` (${selectedDoctors.length})` : ' всех'}`}
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-400">Врачи импортируются из МИС в нашу базу. Клиника должна быть импортирована сначала.</p>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {(misDoctors || []).map(d => {
                const isSelected = selectedDoctors.includes(d.mis_id)
                return (
                  <div key={d.mis_id} onClick={() => setSelectedDoctors(s => isSelected ? s.filter(x => x !== d.mis_id) : [...s, d.mis_id])}
                    className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition
                      ${isSelected ? 'border-[#0097A7] bg-[#0097A7]/5' : 'border-gray-100 dark:border-gray-700 hover:border-gray-200'}`}>
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition flex-shrink-0
                      ${isSelected ? 'border-[#0097A7] bg-[#0097A7]' : 'border-gray-300'}`}>
                      {isSelected && <span className="material-symbols-outlined text-white text-[12px]">check</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{d.name}</p>
                      <p className="text-xs text-gray-400">{d.specialty || '—'} · {d.clinic_name}</p>
                    </div>
                    <span className="text-xs text-gray-400">mis={d.mis_id}</span>
                  </div>
                )
              })}
              {misDoctors === null && <p className="text-xs text-gray-400 py-2 text-center">Загрузка...</p>}
              {misDoctors?.length === 0 && <p className="text-xs text-gray-400 py-2 text-center">Нет врачей в МИС</p>}
            </div>
          </div>

          {/* Личные кабинеты врачей */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-5 border border-gray-100 dark:border-gray-800 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-gray-900 dark:text-white">Личные кабинеты врачей</h3>
                <p className="text-xs text-gray-400 mt-0.5">Врачи с кабинетами могут входить в систему</p>
              </div>
              <button onClick={loadDoctorAccounts} className="text-xs text-[#0097A7] border border-[#0097A7] px-3 py-1.5 rounded-xl hover:bg-[#0097A7]/5 transition">
                Обновить
              </button>
            </div>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {(Array.isArray(doctorAccounts) ? doctorAccounts : []).map(d => (
                <div key={d.doctor_id} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 dark:border-gray-700">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${d.has_account ? 'bg-emerald-50' : 'bg-gray-100 dark:bg-gray-700'}`}>
                    <span className="material-symbols-outlined text-sm" style={{ color: d.has_account ? '#166534' : '#9ca3af', fontVariationSettings: "'FILL' 1" }}>
                      {d.has_account ? 'verified_user' : 'person_off'}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{d.full_name}</p>
                    <p className="text-xs text-gray-400">{d.specialty || '—'}</p>
                    {d.has_account && <p className="text-xs text-emerald-600 font-medium">@{d.username} · {d.is_active ? 'активен' : 'деактивирован'}</p>}
                  </div>
                  {!d.has_account && (
                    <button
                      onClick={() => setCreateAccForm({ doctor_id: d.doctor_id, full_name: d.full_name, username: '', password: '' })}
                      className="text-xs bg-[#0097A7] text-white px-3 py-1.5 rounded-xl hover:bg-[#00838f] transition flex-shrink-0">
                      Создать кабинет
                    </button>
                  )}
                  {d.has_account && (
                    <span className="text-xs bg-emerald-50 text-emerald-700 px-2 py-1 rounded-xl flex-shrink-0 font-semibold">Есть</span>
                  )}
                </div>
              ))}
              {doctorAccounts === null && <p className="text-xs text-gray-400 py-2 text-center">Загрузка...</p>}
              {doctorAccounts?.length === 0 && <p className="text-xs text-gray-400 py-2 text-center">Нет синхронизированных врачей</p>}
            </div>
          </div>

          {/* Модальная форма создания кабинета */}
          {createAccForm && (
            <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && setCreateAccForm(null)}>
              <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
                <h3 className="font-bold text-gray-900 dark:text-white mb-1">Создать кабинет врача</h3>
                <p className="text-sm text-gray-500 mb-4">{createAccForm.full_name}</p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Логин</label>
                    <input value={createAccForm.username}
                      onChange={e => setCreateAccForm(f => ({...f, username: e.target.value}))}
                      placeholder="doctor_ivanov"
                      className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0097A7]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Пароль</label>
                    <input type="password" value={createAccForm.password}
                      onChange={e => setCreateAccForm(f => ({...f, password: e.target.value}))}
                      placeholder="Минимум 6 символов"
                      className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0097A7]" />
                  </div>
                </div>
                <div className="flex gap-3 mt-5">
                  <button onClick={() => setCreateAccForm(null)}
                    className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-xl py-2.5 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                    Отмена
                  </button>
                  <button onClick={createDoctorAccount} disabled={createAccLoading || !createAccForm.username || !createAccForm.password}
                    className="flex-1 bg-[#0097A7] text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-50 hover:bg-[#00838f] transition">
                    {createAccLoading ? 'Создание...' : 'Создать'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* УСЛУГИ */}
      {tab === 'services' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-5 border border-gray-100 dark:border-gray-800 shadow-sm">
            <h3 className="font-bold text-gray-900 dark:text-white mb-4">Источник и назначение</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Клиника МИС (источник)</label>
                <select value={sourceClinicId} onChange={e => { setSourceClinicId(+e.target.value); setMisServices(null) }}
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm dark:bg-gray-800 dark:text-white">
                  {(misClinics || [{mis_id:1,name:'КС-1'},{mis_id:4,name:'КС-4'},{mis_id:3,name:'КС-3'},{mis_id:24,name:'КС-24'},{mis_id:26,name:'КС-26'}]).map(c => (
                    <option key={c.mis_id} value={c.mis_id}>{c.name} (id={c.mis_id})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Наши клиники (назначение)</label>
                <div className="space-y-1 max-h-32 overflow-y-auto border border-gray-200 dark:border-gray-600 rounded-xl p-2">
                  {ourClinics.map(c => (
                    <label key={c.id} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                      <input type="checkbox" checked={targetClinicIds.includes(c.id)}
                        onChange={e => setTargetClinicIds(s => e.target.checked ? [...s, c.id] : s.filter(x => x !== c.id))}
                        className="rounded" />
                      {c.name}
                    </label>
                  ))}
                  {!ourClinics.length && <p className="text-xs text-gray-400">Сначала импортируйте клиники</p>}
                </div>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={loadMisServices} className="text-sm text-[#0097A7] border border-[#0097A7] px-4 py-2 rounded-xl hover:bg-[#0097A7]/5 transition">
                Загрузить услуги
              </button>
              <button onClick={syncServices} disabled={loading || !targetClinicIds.length}
                className="bg-[#0097A7] text-white text-sm px-4 py-2 rounded-xl hover:bg-[#00838f] transition disabled:opacity-50">
                {loading ? '...' : `Импортировать${selectedCategories.length ? ` (${selectedCategories.length} кат.)` : ' все'}`}
              </button>
            </div>
          </div>

          {misServices && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl p-5 border border-gray-100 dark:border-gray-800 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-gray-900 dark:text-white">Категории услуг ({misServices.categories?.length || 0})</h3>
                <span className="text-xs text-gray-400">{misServices.total} услуг</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {(misServices.categories || []).slice(0, 30).map(cat => {
                  const isSelected = selectedCategories.includes(cat.name)
                  return (
                    <button key={cat.name}
                      onClick={() => setSelectedCategories(s => isSelected ? s.filter(x => x !== cat.name) : [...s, cat.name])}
                      className={`text-xs px-3 py-1.5 rounded-full border transition
                        ${isSelected ? 'bg-[#0097A7] text-white border-[#0097A7]' : 'bg-white dark:bg-gray-800 text-gray-600 border-gray-200 hover:border-[#0097A7]'}`}>
                      {cat.name} ({cat.count})
                    </button>
                  )
                })}
              </div>
              <p className="text-xs text-gray-400 mt-3">Выберите категории для импорта или оставьте пустым для всех</p>
            </div>
          )}
        </div>
      )}

      {/* ИНСТРУМЕНТЫ */}
      {tab === 'tools' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-5 border border-gray-100 dark:border-gray-800 shadow-sm">
            <h3 className="font-bold text-gray-900 dark:text-white mb-1">Авто-подтверждение направлений</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Поллинг МИС: ищем приёмы со статусом "выполнено" за последние 2 часа и автоматически подтверждаем совпадающие направления.
            </p>
            <button onClick={pollReferrals} disabled={loading}
              className="bg-[#0097A7] text-white text-sm px-5 py-2.5 rounded-xl hover:bg-[#00838f] transition disabled:opacity-50">
              {loading ? 'Обработка...' : 'Запустить поллинг МИС'}
            </button>
          </div>
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 text-xs text-blue-700 dark:text-blue-300">
            <p className="font-semibold mb-1">Доступные методы МИС:</p>
            <p>✅ getClinics, getServices, getAppointments, getPatient, getUsers</p>
            <p>✅ createAppointment — создание записи в МИС</p>
            <p>❌ getSchedule, getPatientResults — нет доступа (запросить у МИС)</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// CallsConfigSection — настройки звонков, уведомлений, SMS/Telegram
// ---------------------------------------------------------------------------
function CallsConfigSection({ token }) {
  const [tab, setTab] = useState('calls')
  const [permissions, setPermissions] = useState([])
  const [notifSettings, setNotifSettings] = useState([])
  const [availableEvents, setAvailableEvents] = useState({})
  const [myStatus, setMyStatus] = useState('offline')
  const [statusText, setStatusText] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const showMsg = (t, ok=true) => { setMsg({text:t, ok}); setTimeout(() => setMsg(''), 3000) }

  const ROLES = ['admin', 'manager', 'partner', 'doctor']
  const ROLE_LABELS = { admin: 'Администратор', manager: 'Руководитель', supervisor: 'Владелец франшизы', partner: 'Партнёр', doctor: 'Врач', nurse: 'Медсестра', recruiter: 'Менеджер' }
  const ROLE_ICONS  = { admin: 'manage_accounts', manager: 'supervisor_account', partner: 'handshake', doctor: 'medical_services' }

  const loadPermissions = async () => {
    try {
      const r = await apiFetch('get', '/presence/call-permissions', token)
      setPermissions(r.data.permissions || [])
    } catch {}
  }
  const loadNotifSettings = async () => {
    try {
      const r = await apiFetch('get', '/presence/notification-settings', token)
      setNotifSettings(r.data.settings || [])
      setAvailableEvents(r.data.available_events || {})
    } catch {}
  }
  const loadMyStatus = async () => {
    try {
      const r = await apiFetch('get', '/presence/status', token)
      setMyStatus(r.data.status || 'offline')
      setStatusText(r.data.status_text || '')
    } catch {}
  }

  useEffect(() => {
    loadMyStatus()
    if (tab === 'calls') loadPermissions()
    if (tab === 'notifications') loadNotifSettings()
  }, [tab])

  const getPerm = (fromRole, toRole) =>
    permissions.find(p => p.from_role === fromRole && p.to_role === toRole) || { can_call: false, can_video: false, same_clinic_only: false }

  const togglePerm = async (fromRole, toRole, field) => {
    const ex = getPerm(fromRole, toRole)
    const updated = { ...ex, from_role: fromRole, to_role: toRole, [field]: !ex[field] }
    try {
      await apiFetch('post', '/presence/call-permissions', token, updated)
      loadPermissions()
    } catch(e) { showMsg('Ошибка сохранения', false) }
  }

  const updateStatus = async (status) => {
    setSaving(true)
    setMyStatus(status)
    try {
      await apiFetch('put', '/presence/status', token, { status, status_text: statusText })
      showMsg('Статус обновлён')
    } catch { showMsg('Ошибка', false) }
    setSaving(false)
  }

  const updateStatusText = async () => {
    try {
      await apiFetch('put', '/presence/status', token, { status: myStatus, status_text: statusText })
      showMsg('Статус-текст сохранён')
    } catch { showMsg('Ошибка', false) }
  }

  const STATUS_OPTIONS = [
    { value: 'online', label: 'На месте',     color: '#22c55e', bg: 'bg-emerald-50 border-emerald-200', icon: 'circle' },
    { value: 'away',   label: 'Не на месте',  color: '#f59e0b', bg: 'bg-amber-50 border-amber-200',    icon: 'schedule' },
    { value: 'busy',   label: 'Занят',        color: '#ef4444', bg: 'bg-red-50 border-red-200',         icon: 'do_not_disturb_on' },
    { value: 'offline',label: 'Не в системе', color: '#94a3b8', bg: 'bg-gray-50 border-gray-200',       icon: 'radio_button_unchecked' },
  ]

  const TABS = [
    { key: 'calls',         label: 'Разрешения звонков',  icon: 'call' },
    { key: 'presence',      label: 'Мой статус',          icon: 'online_prediction' },
    { key: 'notifications', label: 'Уведомления',          icon: 'notifications' },
  ]

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Звонки и уведомления</h1>
          <p className="text-sm text-gray-500 mt-0.5">P2P звонки по ролям, статусы присутствия, SMS и Telegram уведомления</p>
        </div>
        {msg && (
          <div className={`px-4 py-2 rounded-xl text-sm font-semibold shadow ${msg.ok !== false ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
            {msg.text}
          </div>
        )}
      </div>

      <div className="bg-[#e0f7fa] dark:bg-blue-900/20 border border-[#b2ebf2] dark:border-blue-700/30 rounded-2xl p-4 text-sm text-[#00696f] dark:text-blue-300">
        <div className="flex gap-2 mb-2">
          <span className="material-symbols-outlined text-base">info</span>
          <strong>Как работают звонки:</strong>
        </div>
        <ul className="list-disc ml-6 space-y-1 text-xs">
          <li>Каждый пользователь подключается к WebSocket при открытии системы</li>
          <li>В колонке сотрудников видны индикаторы онлайн (зелёный кружок)</li>
          <li>Кнопка 📞 появляется рядом с именем если у вас есть разрешение звонить этой роли</li>
          <li>Статус "Занят" автоматически выставляется на время активного звонка</li>
          <li>Статус "Не на месте" блокирует входящие — звонящий получает сигнал занято</li>
        </ul>
      </div>

      <div className="flex gap-1 bg-white dark:bg-gray-900 rounded-xl p-1 shadow-sm border border-gray-100 dark:border-gray-800 w-fit">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all
              ${tab === t.key ? 'bg-[#0097A7] text-white shadow' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400'}`}>
            <span className="material-symbols-outlined text-[16px]">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* ─── Разрешения звонков ─── */}
      {tab === 'calls' && (
        <div className="space-y-4">
          <p className="text-xs text-gray-500 font-medium">
            Матрица показывает: кто (строки) кому (столбцы) может звонить.
            Чекбокс «Звонок» = разрешить аудио, «Видео» = разрешить видео, «Своя клиника» = только в пределах одной клиники.
          </p>
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800/50">
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wide">Кто звонит ↓ / Кому →</th>
                  {ROLES.map(r => (
                    <th key={r} className="px-3 py-3 text-center text-xs font-bold text-gray-500 uppercase tracking-wide">
                      <div className="flex flex-col items-center gap-1">
                        <span className="material-symbols-outlined text-base text-[#0097A7]">{ROLE_ICONS[r]}</span>
                        {ROLE_LABELS[r]}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                {ROLES.map(fromRole => (
                  <tr key={fromRole} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-base text-[#0097A7]">{ROLE_ICONS[fromRole]}</span>
                        <span className="font-semibold text-gray-800 dark:text-gray-200">{ROLE_LABELS[fromRole]}</span>
                      </div>
                    </td>
                    {ROLES.map(toRole => {
                      const perm = getPerm(fromRole, toRole)
                      return (
                        <td key={toRole} className="px-3 py-3">
                          <div className="flex flex-col gap-2 items-center">
                            <label className="flex items-center gap-1 cursor-pointer text-xs text-gray-600 dark:text-gray-400">
                              <input type="checkbox" checked={!!perm.can_call}
                                onChange={() => togglePerm(fromRole, toRole, 'can_call')}
                                className="w-3.5 h-3.5 rounded accent-emerald-500 cursor-pointer" />
                              <span>Звонок</span>
                            </label>
                            <label className="flex items-center gap-1 cursor-pointer text-xs text-gray-600 dark:text-gray-400">
                              <input type="checkbox" checked={!!perm.can_video}
                                onChange={() => togglePerm(fromRole, toRole, 'can_video')}
                                className="w-3.5 h-3.5 rounded accent-blue-500 cursor-pointer"
                                disabled={!perm.can_call} />
                              <span>Видео</span>
                            </label>
                            <label className="flex items-center gap-1 cursor-pointer text-xs text-gray-600 dark:text-gray-400">
                              <input type="checkbox" checked={!!perm.same_clinic_only}
                                onChange={() => togglePerm(fromRole, toRole, 'same_clinic_only')}
                                className="w-3.5 h-3.5 rounded accent-amber-500 cursor-pointer"
                                disabled={!perm.can_call} />
                              <span>Своя</span>
                            </label>
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-gray-50 dark:bg-gray-800 rounded-2xl p-4 text-xs text-gray-500 space-y-1">
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-emerald-500 flex-shrink-0"/><span><strong>Звонок</strong> — разрешить аудио звонок от этой роли к другой</span></div>
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-blue-500 flex-shrink-0"/><span><strong>Видео</strong> — разрешить видео звонок (требует аудио)</span></div>
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-amber-500 flex-shrink-0"/><span><strong>Своя клиника</strong> — звонить можно только сотрудникам одной клиники</span></div>
          </div>
        </div>
      )}

      {/* ─── Мой статус ─── */}
      {tab === 'presence' && (
        <div className="space-y-4 max-w-md">
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-800 space-y-4">
            <h3 className="font-bold text-gray-900 dark:text-white">Статус присутствия</h3>
            <p className="text-xs text-gray-500">Видят все сотрудники вашего тенанта. Влияет на доступность для звонков.</p>
            <div className="grid grid-cols-2 gap-2">
              {STATUS_OPTIONS.map(s => (
                <button key={s.value} onClick={() => updateStatus(s.value)}
                  className={`flex items-center gap-2 px-3 py-3 rounded-xl border-2 text-sm font-semibold transition-all ${
                    myStatus === s.value ? `${s.bg} border-current` : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:border-gray-300'
                  }`} style={myStatus === s.value ? {color: s.color} : {}}>
                  <span className="material-symbols-outlined text-base" style={{color: s.color, fontVariationSettings:"'FILL' 1"}}>{s.icon}</span>
                  {s.label}
                </button>
              ))}
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1 block">
                Текст статуса <span className="text-gray-400 font-normal">(необязательно, видит коллеги)</span>
              </label>
              <div className="flex gap-2">
                <input value={statusText} onChange={e => setStatusText(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && updateStatusText()}
                  placeholder="Например: На обеде, вернусь в 14:00"
                  maxLength={100}
                  className="flex-1 border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm dark:bg-gray-800 dark:text-white focus:ring-2 focus:ring-[#0097A7] outline-none" />
                <button onClick={updateStatusText} disabled={saving}
                  className="px-4 py-2 bg-[#0097A7] text-white rounded-xl text-sm font-semibold hover:bg-[#00838f] transition disabled:opacity-50">
                  Сохранить
                </button>
              </div>
            </div>
          </div>

          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/30 rounded-2xl p-4 text-xs text-amber-800 dark:text-amber-300">
            <strong>Автоматические переходы:</strong>
            <ul className="list-disc ml-4 mt-1 space-y-0.5">
              <li>Принял звонок → <strong>Занят</strong> на время разговора</li>
              <li>Статус "Не на месте" или "Занят" → входящие звонки отклоняются автоматически</li>
              <li>Нет активности 30 мин → переход в <strong>Не в системе</strong></li>
            </ul>
          </div>
        </div>
      )}

      {/* ─── Уведомления ─── */}
      {tab === 'notifications' && (
        <div className="space-y-4">
          <p className="text-xs text-gray-500 font-medium">Настройте какие события и по каким каналам получает каждая роль.</p>
          {['admin', 'manager', 'partner'].map(role => {
            const setting = notifSettings.find(s => s.role === role) || { events: {}, channels: {} }
            const events = setting.events || {}
            const channels = setting.channels || {}
            const EVENT_LIST = Object.entries(availableEvents)

            const saveEvents = async (newEvents, newChannels) => {
              try {
                await apiFetch('post', '/presence/notification-settings', token, {
                  role, events: newEvents, channels: newChannels
                })
                loadNotifSettings()
                showMsg('Сохранено')
              } catch { showMsg('Ошибка', false) }
            }

            return (
              <div key={role} className="bg-white dark:bg-gray-900 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-800">
                <div className="flex items-center gap-2 mb-4">
                  <span className="material-symbols-outlined text-base text-[#0097A7]">{ROLE_ICONS[role]}</span>
                  <h3 className="font-bold text-gray-900 dark:text-white">{ROLE_LABELS[role]}</h3>
                </div>
                {/* Каналы */}
                <div className="mb-4">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Каналы доставки</p>
                  <div className="flex gap-3 flex-wrap">
                    {[
                      { key: 'sms', label: 'SMS', icon: 'sms' },
                      { key: 'telegram', label: 'Telegram', icon: 'telegram' },
                      { key: 'push', label: 'Push', icon: 'notifications' },
                      { key: 'email', label: 'Email', icon: 'email' },
                    ].map(ch => (
                      <label key={ch.key} className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700">
                        <input type="checkbox" checked={!!channels[ch.key]}
                          onChange={e => saveEvents(events, { ...channels, [ch.key]: e.target.checked })}
                          className="w-4 h-4 rounded accent-[#0097A7]" />
                        <span className="material-symbols-outlined text-base text-[#0097A7]">{ch.icon}</span>
                        {ch.label}
                      </label>
                    ))}
                  </div>
                </div>
                {/* События */}
                {EVENT_LIST.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Уведомлять о событиях</p>
                    <div className="grid grid-cols-2 gap-2">
                      {EVENT_LIST.map(([key, label]) => (
                        <label key={key} className="flex items-center gap-2 cursor-pointer text-xs text-gray-600 dark:text-gray-400">
                          <input type="checkbox" checked={!!events[key]}
                            onChange={e => saveEvents({ ...events, [key]: e.target.checked }, channels)}
                            className="w-3.5 h-3.5 rounded accent-[#0097A7]" />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function PluginsSection({ token }) {
  const [tab, setTab] = useState('manage')
  const [plugins, setPlugins] = useState([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState('')
  const [pluginBilling, setPluginBilling] = useState({})
  const [billingEvents, setBillingEvents] = useState([])
  const [integrations, setIntegrations] = useState(null)
  const [p2pSettings, setP2pSettings] = useState(null)
  const [visibility, setVisibility] = useState(null)
  const [savingP2p, setSavingP2p] = useState(false)
  const [savingVis, setSavingVis] = useState(false)
  const [msg, setMsg] = useState('')

  const showMsg = (text) => { setMsg(text); setTimeout(() => setMsg(''), 3000) }

  const loadPlugins = () => {
    setLoading(true)
    apiFetch('get', '/plugins', token)
      .then(r => { setPlugins(r.data || []); setLoading(false) })
      .catch(() => setLoading(false))
  }

  const loadBilling = () => apiFetch('get', '/plugins/billing-events', token).then(r => setBillingEvents(r.data || []))
  const loadPluginBilling = () => apiFetch('get', '/plugins/billing/summary', token).then(r => {
    const map = {}; (r.data || []).forEach(p => { map[p.plugin] = p }); setPluginBilling(map)
  }).catch(() => {})
  const loadIntegrations = () => apiFetch('get', '/plugins/integrations', token).then(r => setIntegrations(r.data))
  const loadP2p = () => apiFetch('get', '/plugins/p2p/settings', token).then(r => setP2pSettings(r.data))
  const loadVisibility = () => apiFetch('get', '/plugins/visibility', token).then(r => setVisibility(r.data))

  useEffect(() => {
    loadPlugins()
    loadBilling()
    loadPluginBilling()
  }, [])

  useEffect(() => {
    if (tab === 'integrations' && !integrations) loadIntegrations()
    if (tab === 'p2p' && !p2pSettings) loadP2p()
    if (tab === 'visibility' && !visibility) loadVisibility()
  }, [tab])

  const enableFeature = async (key, trial = false) => {
    setActionLoading(key)
    try {
      await apiFetch('post', '/plugins/features/enable', token, { feature_key: key, trial_days: trial ? 14 : null })
      showMsg(trial ? `Пробный период 14 дней активирован: ${key}` : `Фича включена: ${key}`)
      loadPlugins()
      loadBilling()
    } catch (e) {
      showMsg(`Ошибка: ${e.response?.data?.detail || e.message}`)
    }
    setActionLoading('')
  }

  const disableFeature = async (key) => {
    setActionLoading(key)
    try {
      await apiFetch('post', '/plugins/features/disable', token, { feature_key: key })
      showMsg(`Фича отключена: ${key}`)
      loadPlugins()
    } catch (e) {
      showMsg(`Ошибка: ${e.response?.data?.detail || e.message}`)
    }
    setActionLoading('')
  }

  const saveP2p = async () => {
    setSavingP2p(true)
    try {
      await apiFetch('post', '/plugins/p2p/settings', token, p2pSettings)
      showMsg('P2P настройки сохранены')
    } catch {}
    setSavingP2p(false)
  }

  const updateVisibility = async (fromId, toId, role, val) => {
    const existing = visibility.matrix.find(m => m.from_clinic_id === fromId && m.to_clinic_id === toId) || {}
    const upd = {
      from_clinic_id: fromId, to_clinic_id: toId,
      allow_admin: existing.allow_admin || false,
      allow_doctor: existing.allow_doctor || false,
      allow_manager: existing.allow_manager || false,
      [role]: val,
    }
    try {
      await apiFetch('post', '/plugins/visibility', token, upd)
      setVisibility(v => ({
        ...v,
        matrix: v.matrix.some(m => m.from_clinic_id === fromId && m.to_clinic_id === toId)
          ? v.matrix.map(m => m.from_clinic_id === fromId && m.to_clinic_id === toId ? { ...m, [role]: val } : m)
          : [...v.matrix, upd]
      }))
    } catch {}
  }

  const statusBadge = (status) => {
    const m = { active: 'bg-emerald-100 text-emerald-700', trial: 'bg-blue-100 text-blue-700', inactive: 'bg-gray-100 text-gray-500' }
    const l = { active: 'Активно', trial: 'Trial', inactive: 'Не активно' }
    return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${m[status] || m.inactive}`}>{l[status] || status}</span>
  }

  const TABS = [
    { key: 'manage', label: 'Управление', icon: 'tune' },
    { key: 'integrations', label: 'Интеграции', icon: 'integration_instructions' },
    { key: 'p2p', label: 'P2P звонки', icon: 'call' },
    { key: 'visibility', label: 'Видимость клиник', icon: 'visibility' },
  ]

  const PLUGIN_ICONS = { calls: 'call', video: 'videocam', sms: 'sms', mis: 'local_hospital', telegram: 'send', general: 'extension' }

  return (
    <div className="space-y-5">
      {/* Заголовок */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Плагины</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Управление модулями, интеграциями и доступами</p>
        </div>
        {msg && (
          <div className="bg-blue-600 text-white text-sm px-4 py-2 rounded-xl shadow">{msg}</div>
        )}
      </div>

      {/* Вкладки */}
      <div className="flex gap-1 bg-white dark:bg-gray-900 rounded-xl p-1 shadow-sm border border-gray-100 dark:border-gray-800 w-fit">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all
              ${tab === t.key ? 'bg-[#0097A7] text-white shadow' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white'}`}>
            <span className="material-symbols-outlined text-[16px]">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════════
          TAB: УПРАВЛЕНИЕ
      ═══════════════════════════════════════════════════════════ */}
      {tab === 'manage' && (
        <div className="space-y-6">
          {loading ? (
            <div className="text-center py-16 text-gray-400">Загрузка плагинов...</div>
          ) : plugins.map(plugin => (
            <div key={plugin.key} className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 overflow-hidden">
              {/* Заголовок плагина */}
              <div className="flex items-center gap-4 p-5 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                <div className="w-12 h-12 rounded-xl bg-[#0097A7]/10 flex items-center justify-center flex-shrink-0">
                  <span className="material-symbols-outlined text-[#0097A7] text-[24px]"
                    style={{ fontVariationSettings: "'FILL' 1" }}>
                    {PLUGIN_ICONS[plugin.key] || 'extension'}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-gray-900 dark:text-white text-base">{plugin.name}</h3>
                  {plugin.description && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{plugin.description}</p>}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {pluginBilling[plugin.key]?.status === 'trial' && (
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-lg font-medium">
                      Trial · {pluginBilling[plugin.key].days_left}д
                    </span>
                  )}
                  {pluginBilling[plugin.key]?.status === 'paid' && (
                    <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded-lg font-medium">Оплачен</span>
                  )}
                  {!pluginBilling[plugin.key] && (
                    <button
                      onClick={() => apiFetch('post', `/plugins/${plugin.key}/trial`, token, { trial_days: 14 })
                        .then(() => { showMsg('Триал 14 дней активирован: ' + plugin.name); loadPluginBilling() })
                        .catch(() => showMsg('Ошибка активации триала'))}
                      className="text-xs border border-blue-200 text-blue-600 px-3 py-1 rounded-lg hover:bg-blue-50 transition">
                      14 дней бесплатно
                    </button>
                  )}
                  {(plugin.features || []).filter(f => f.status === 'active').length > 0 && (
                    <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded-lg font-medium">
                      {(plugin.features || []).filter(f => f.status === 'active').length} активно
                    </span>
                  )}
                </div>
              </div>

              {/* Фичи плагина */}
              <div className="divide-y divide-gray-50 dark:divide-gray-800">
                {(plugin.features || []).map(feat => (
                  <div key={feat.key} className="flex items-center gap-4 px-5 py-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-gray-900 dark:text-white">{feat.name}</span>
                        {statusBadge(feat.status)}
                        {feat.is_paid && (
                          <span className="text-xs text-amber-600 font-semibold bg-amber-50 px-2 py-0.5 rounded-full">
                            {feat.price_monthly.toLocaleString('ru-RU')} ₽/мес
                          </span>
                        )}
                        {!feat.is_paid && (
                          <span className="text-xs text-emerald-600 font-semibold bg-emerald-50 px-2 py-0.5 rounded-full">Бесплатно</span>
                        )}
                      </div>
                      {feat.description && (
                        <p className="text-xs text-gray-400 mt-1">{feat.description}</p>
                      )}
                      {feat.trial_ends_at && feat.status === 'trial' && (
                        <p className="text-xs text-blue-500 mt-1">
                          Trial до {new Date(feat.trial_ends_at).toLocaleDateString('ru-RU')}
                        </p>
                      )}
                    </div>
                    {/* Кнопки действий */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {feat.is_paid && feat.status === 'inactive' && (
                        <>
                          <button
                            onClick={() => enableFeature(feat.key, true)}
                            disabled={actionLoading === feat.key}
                            className="text-xs px-3 py-1.5 border border-blue-200 text-blue-600 rounded-lg hover:bg-blue-50 transition disabled:opacity-50">
                            14 дней бесплатно
                          </button>
                          <button
                            onClick={() => enableFeature(feat.key)}
                            disabled={actionLoading === feat.key}
                            className="text-xs px-3 py-1.5 bg-[#0097A7] text-white rounded-lg hover:bg-[#00838f] transition disabled:opacity-50">
                            {actionLoading === feat.key ? '...' : 'Подключить'}
                          </button>
                        </>
                      )}
                      {feat.is_paid && feat.status !== 'inactive' && (
                        <button
                          onClick={() => disableFeature(feat.key)}
                          disabled={actionLoading === feat.key}
                          className="text-xs px-3 py-1.5 border border-red-200 text-red-500 rounded-lg hover:bg-red-50 transition disabled:opacity-50">
                          {actionLoading === feat.key ? '...' : 'Отключить'}
                        </button>
                      )}
                      {!feat.is_paid && (
                        <span className="text-xs text-gray-400 italic">Всегда включено</span>
                      )}
                    </div>
                  </div>
                ))}
                {(!plugin.features || plugin.features.length === 0) && (
                  <div className="px-5 py-4 text-sm text-gray-400">Нет доступных фич</div>
                )}
              </div>
            </div>
          ))}

          {/* История биллинга */}
          {billingEvents.length > 0 && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800">
              <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
                <h3 className="font-bold text-gray-900 dark:text-white text-sm">История событий</h3>
              </div>
              <div className="divide-y divide-gray-50 dark:divide-gray-800 max-h-64 overflow-y-auto">
                {billingEvents.slice(0, 10).map(ev => {
                  const evColors = { enabled: 'text-emerald-600', disabled: 'text-red-500', trial_started: 'text-blue-600', charge: 'text-amber-600' }
                  const evLabels = { enabled: 'Включено', disabled: 'Отключено', trial_started: 'Trial', charge: 'Списание' }
                  return (
                    <div key={ev.id} className="flex items-center gap-3 px-5 py-3">
                      <span className={`text-xs font-semibold ${evColors[ev.event_type] || 'text-gray-500'}`}>
                        {evLabels[ev.event_type] || ev.event_type}
                      </span>
                      <span className="text-xs text-gray-600 dark:text-gray-400 flex-1">{ev.feature_key}</span>
                      {ev.amount > 0 && <span className="text-xs font-mono text-gray-500">{ev.amount.toLocaleString('ru-RU')} ₽</span>}
                      <span className="text-xs text-gray-400">{new Date(ev.created_at).toLocaleDateString('ru-RU')}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          TAB: ИНТЕГРАЦИИ
      ═══════════════════════════════════════════════════════════ */}
      {tab === 'integrations' && (
        <div className="space-y-4">
          {!integrations ? (
            <div className="text-center py-16 text-gray-400">Загрузка...</div>
          ) : (
            <>
              {/* Статус плагинов */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {Object.entries(integrations.plugins || {}).map(([key, info]) => (
                  <div key={key} className="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-100 dark:border-gray-800 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-[#0097A7] text-[20px]"
                          style={{ fontVariationSettings: "'FILL' 1" }}>
                          {PLUGIN_ICONS[key] || 'extension'}
                        </span>
                        <span className="font-semibold text-sm text-gray-800 dark:text-white">{info.name}</span>
                      </div>
                      <span className={`w-2.5 h-2.5 rounded-full ${info.enabled ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                    </div>
                    <div className={`text-xs font-medium ${info.enabled ? 'text-emerald-600' : 'text-gray-400'}`}>
                      {info.enabled ? 'Активна' : 'Не настроена'}
                    </div>
                    <button className="mt-3 text-xs text-blue-600 hover:underline">Настроить →</button>
                  </div>
                ))}
              </div>

              {/* Клиники */}
              <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
                  <h3 className="font-bold text-gray-900 dark:text-white text-sm">Интеграции по клиникам</h3>
                </div>
                <div className="divide-y divide-gray-50 dark:divide-gray-800">
                  {(integrations.clinics || []).map(clinic => (
                    <div key={clinic.id} className="flex items-center gap-4 px-5 py-4">
                      <div className="w-8 h-8 rounded-lg bg-[#0097A7]/10 flex items-center justify-center flex-shrink-0">
                        <span className="material-symbols-outlined text-[#0097A7] text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>local_hospital</span>
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{clinic.name}</p>
                        {clinic.address && <p className="text-xs text-gray-400">{clinic.address}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        {['MIS', 'SMS', 'Telegram'].map(int_name => (
                          <span key={int_name} className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-800 text-gray-500 rounded-lg">{int_name}</span>
                        ))}
                        <button className="text-xs text-blue-600 hover:underline ml-2">Настроить</button>
                      </div>
                    </div>
                  ))}
                  {(!integrations.clinics || integrations.clinics.length === 0) && (
                    <div className="px-5 py-8 text-center text-gray-400 text-sm">Нет клиник</div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          TAB: P2P ЗВОНКИ
      ═══════════════════════════════════════════════════════════ */}
      {tab === 'p2p' && (
        <div className="space-y-4">
          {!p2pSettings ? (
            <div className="text-center py-16 text-gray-400">Загрузка...</div>
          ) : (
            <>
              {/* Глобальный переключатель */}
              <div className="bg-white dark:bg-gray-900 rounded-2xl p-5 border border-gray-100 dark:border-gray-800 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-gray-900 dark:text-white">Звонки между сотрудниками</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Аудио звонки внутри клиники — бесплатно</p>
                  </div>
                  <button
                    onClick={() => setP2pSettings(s => ({ ...s, internal_calls_enabled: !s.internal_calls_enabled }))}
                    className={`relative w-12 h-6 rounded-full transition-colors ${p2pSettings.internal_calls_enabled ? 'bg-[#0097A7]' : 'bg-gray-300 dark:bg-gray-600'}`}>
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${p2pSettings.internal_calls_enabled ? 'translate-x-6' : ''}`} />
                  </button>
                </div>

                {/* Звонки между клиниками */}
                <div className={`mt-4 pt-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between ${!p2pSettings.internal_calls_enabled ? 'opacity-40 pointer-events-none' : ''}`}>
                  <div>
                    <p className="font-medium text-sm text-gray-800 dark:text-white">Звонки между клиниками</p>
                    <p className="text-xs text-gray-400 mt-0.5">990 ₽/мес · {p2pSettings.cross_clinic_enabled ? 'Активно' : 'Требует подключения'}</p>
                  </div>
                  {!p2pSettings.cross_clinic_enabled ? (
                    <button onClick={() => enableFeature('cross_clinic_calls', true)}
                      className="text-xs px-3 py-1.5 bg-[#0097A7] text-white rounded-lg hover:bg-[#00838f] transition">
                      Подключить
                    </button>
                  ) : (
                    <span className="text-xs bg-emerald-100 text-emerald-700 px-3 py-1.5 rounded-lg font-medium">Включено</span>
                  )}
                </div>
              </div>

              {/* Сохранить */}
              <button onClick={saveP2p} disabled={savingP2p}
                className="w-full bg-[#0097A7] hover:bg-[#00838f] text-white rounded-xl py-3 font-medium text-sm transition disabled:opacity-50">
                {savingP2p ? 'Сохранение...' : 'Сохранить настройки'}
              </button>
            </>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          TAB: ВИДИМОСТЬ КЛИНИК
      ═══════════════════════════════════════════════════════════ */}
      {tab === 'visibility' && (
        <div className="space-y-4">
          {!visibility ? (
            <div className="text-center py-16 text-gray-400">Загрузка...</div>
          ) : (
            <>
              {visibility.clinics.length < 2 ? (
                <div className="bg-white dark:bg-gray-900 rounded-2xl p-8 border border-gray-100 dark:border-gray-800 text-center">
                  <span className="material-symbols-outlined text-gray-300 text-[48px]">local_hospital</span>
                  <p className="text-gray-500 text-sm mt-3">Для матрицы видимости нужно минимум 2 клиники</p>
                </div>
              ) : (
                <>
                  {/* Матрица */}
                  <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
                    <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
                      <h3 className="font-bold text-gray-900 dark:text-white text-sm">Матрица доступа</h3>
                      <p className="text-xs text-gray-400 mt-0.5">Строки: FROM (откуда доступ) · Колонки: TO (к чему доступ)</p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full">
                        <thead>
                          <tr className="bg-gray-50 dark:bg-gray-800">
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-40">FROM → TO</th>
                            {visibility.clinics.map(c => (
                              <th key={c.id} className="px-3 py-3 text-center text-xs font-semibold text-gray-500 min-w-[120px]">
                                <div className="truncate max-w-[110px]">{c.name}</div>
                                <div className="flex justify-center gap-1 mt-1.5">
                                  {['А','В','Р'].map(r => (
                                    <span key={r} className="text-[9px] text-gray-400">{r}</span>
                                  ))}
                                </div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                          {visibility.clinics.map(fromClinic => (
                            <tr key={fromClinic.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                              <td className="px-4 py-3 text-xs font-medium text-gray-700 dark:text-gray-300 truncate max-w-[140px]">
                                {fromClinic.name}
                              </td>
                              {visibility.clinics.map(toClinic => {
                                const isSame = fromClinic.id === toClinic.id
                                const cell = visibility.matrix.find(m => m.from_clinic_id === fromClinic.id && m.to_clinic_id === toClinic.id) || {}
                                return (
                                  <td key={toClinic.id} className="px-3 py-3 text-center">
                                    {isSame ? (
                                      <div className="flex justify-center gap-1">
                                        {['allow_admin','allow_doctor','allow_manager'].map(r => (
                                          <span key={r} className="w-5 h-5 rounded bg-emerald-100 flex items-center justify-center">
                                            <span className="material-symbols-outlined text-emerald-600 text-[12px]">check</span>
                                          </span>
                                        ))}
                                      </div>
                                    ) : (
                                      <div className="flex justify-center gap-1">
                                        {['allow_admin','allow_doctor','allow_manager'].map(role => (
                                          <button key={role}
                                            onClick={() => updateVisibility(fromClinic.id, toClinic.id, role, !cell[role])}
                                            className={`w-5 h-5 rounded border transition ${cell[role] ? 'bg-[#0097A7] border-[#0097A7]' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-[#0097A7]'}`}>
                                            {cell[role] && <span className="material-symbols-outlined text-white text-[11px]">check</span>}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </td>
                                )
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Легенда */}
                  <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 text-xs text-blue-700 dark:text-blue-300">
                    <p className="font-semibold mb-2">Как читать матрицу:</p>
                    <p>А = Администратор · В = Врач · Р = Руководитель</p>
                    <p className="mt-1"><strong>FROM</strong> — клиника, сотрудники которой получают доступ</p>
                    <p><strong>TO</strong> — клиника, к данным которой открывают доступ</p>
                    <p className="mt-1">Своя клиника — доступ всегда разрешён</p>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}


// Main AdminLayout
// ---------------------------------------------------------------------------

export default function AdminLayout({ adminToken, user, onLogout }) {
  const [activeSection, setActiveSection] = useState('home')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [dark, setDark] = useState(() => localStorage.getItem('adminTheme') === 'dark')
  const [helpOpen, setHelpOpen] = useState(false)
  const [branding, setBranding] = useState(null)

  // Загружаем брендинг и применяем CSS-переменные
  useEffect(() => {
    apiFetch('get', '/tenant/branding', adminToken).then(r => {
      const b = r.data
      setBranding(b)
      if (b.primary_color) document.documentElement.style.setProperty('--color-primary', b.primary_color)
      if (b.sidebar_color) document.documentElement.style.setProperty('--color-sidebar', b.sidebar_color)
      if (b.bg_color) document.documentElement.style.setProperty('--color-bg', b.bg_color)
      if (b.font_family) document.documentElement.style.setProperty('--font-main', b.font_family)
    }).catch(() => {})
    // Загружаем статус trial/подписки для баннера
  }, [adminToken])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('adminTheme', dark ? 'dark' : 'light')
  }, [dark])


  // Бейдж-конфиг: раздел → значение счётчика
  const navBadge = {}

  const isSuperAdmin = user?.is_superadmin || user?.role === "super_admin"
  const isTenantAdmin = isSuperAdmin || isSupervisor  // полный доступ к тенанту
  const renderSection = () => {

    switch (activeSection) {
      case 'home':     return <HomeDashboard token={adminToken} onNavigate={setActiveSection} />
      case 'settings':  return <SettingsSection token={adminToken} />
      case 'analytics': return <AnalyticsDrillSection token={adminToken} />
      case 'audit':     return <AuditSection token={adminToken} />
      case 'billing':   return <BillingSection token={adminToken} />
      case 'billing_ledger': return (
        <Suspense fallback={<SectionLoader />}>
          <BillingLedgerSection token={adminToken} />
        </Suspense>
      )
      case 'monitoring': return <MonitoringSection token={adminToken} />
      case 'plugins':   return <PluginsSection token={adminToken} />
      case 'mis_sync':  return <MisSyncSection token={adminToken} />
      case 'calls_cfg': return <CallsConfigSection token={adminToken} />
      case 'push_notify': return <PushSection token={adminToken} />
      case 'webhooks': return (
        <Suspense fallback={<SectionLoader />}>
          <WebhooksSection token={adminToken} />
        </Suspense>
      )
      case 'ads': return (
        <Suspense fallback={<div style={{padding:40,textAlign:'center',color:'#64748b'}}>Загрузка...</div>}>
          <AdsSection token={adminToken} />
        </Suspense>
      )
      case 'ai_analytics': return (
        <Suspense fallback={<div style={{padding:40,textAlign:'center',color:'#64748b'}}>Загрузка...</div>}>
          <AISection token={adminToken} isSuperAdmin={isSuperAdmin} />
        </Suspense>
      )
      case 'super_admin': return (
        <Suspense fallback={<SectionLoader />}>
          <PlatformSection token={adminToken} />
        </Suspense>
      )
      default:          return null
    }
  }

  const handleNav = (key) => {
    setActiveSection(key)
    setSidebarOpen(false)
  }

  return (
    <div className="flex min-h-screen bg-[#f7f9fb] dark:bg-gray-950 font-sans">
      {/* Sidebar overlay (мобильный) */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-20 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ─── Sidebar (Stitch "Clinika Slate & Cobalt" style) ─── */}
      <aside className={`
        fixed top-0 left-0 h-full w-64 bg-[#1a2232] text-white z-30 flex flex-col
        transition-transform duration-200 shadow-2xl
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        md:translate-x-0 md:static md:flex
      `}>
        {/* Логотип */}
        <div className="px-6 py-6 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-white text-xl"
              style={{ fontVariationSettings: "'FILL' 1" }}>health_and_safety</span>
          </div>
          <div>
            <div className="text-lg font-bold leading-tight font-headline tracking-tight">{branding?.brand_name || "КлиникСеть"}</div>
            <div className="text-[10px] text-slate-400 uppercase tracking-widest mt-0.5">Medical Fintech</div>
          </div>
        </div>

        {/* Навигация */}
        <nav className="flex-1 px-2 flex flex-col gap-0.5 overflow-y-auto">
          {NAV.map(item => {
            const badge = navBadge[item.key] || 0
            const isActive = activeSection === item.key
            return (
              <button
                key={item.key}
                onClick={() => handleNav(item.key)}
                className={`
                  w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm text-left transition-all duration-150 mx-0
                  ${isActive
                    ? 'bg-[#1565c0]/20 text-white font-bold border-l-4 border-[#1565c0]'
                    : 'text-slate-400 hover:text-white hover:bg-white/5 font-medium'}
                `}
              >
                <span className="material-symbols-outlined text-[20px] flex-shrink-0"
                  style={isActive ? { fontVariationSettings: "'FILL' 1" } : {}}>
                  {item.icon}
                </span>
                <span className="flex-1 leading-none">{item.label}</span>
                {badge > 0 && (
                  <span className="bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </button>
            )
          })}
        </nav>

        {/* Пользователь + выход */}
        <div className="px-2 py-4 mt-auto border-t border-[#ffffff10]">
          <div className="flex items-center gap-2.5 px-4 py-3 mb-1">
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-sm font-bold flex-shrink-0 text-white">
              {(user?.full_name || user?.username || 'A')[0].toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-white truncate leading-tight">
                {user?.full_name || user?.username || 'Администратор'}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">{user?.role === "super_admin" ? "Владелец платформы" : user?.role === "supervisor" ? "Владелец франшизы" : user?.role === "manager" ? "Руководитель" : user?.role === "partner" ? "Партнёр" : "Администратор"}</div>
            </div>
          </div>
          <button onClick={() => setHelpOpen(true)}
            className="w-full text-slate-400 hover:text-white hover:bg-white/5 rounded-lg px-4 py-2.5 text-sm transition flex items-center gap-3">
            <span className="material-symbols-outlined text-[18px]">help</span>
            Справка
          </button>
          <button onClick={onLogout}
            className="w-full text-slate-400 hover:text-white hover:bg-white/5 rounded-lg px-4 py-2.5 text-sm transition flex items-center gap-3">
            <span className="material-symbols-outlined text-[18px]">logout</span>
            Выйти
          </button>
          <div className="px-4 py-2 flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[14px] text-slate-600">info</span>
            <span className="text-xs text-slate-600">v1.0.0</span>
          </div>
        </div>
      </aside>

      {/* ─── Основной контент ─── */}
      <div className="flex-1 flex flex-col min-w-0 md:ml-0">
        {/* Шапка мобильная */}
        <header className="md:hidden bg-[#1a2232] text-white flex items-center gap-3 px-4 py-3 sticky top-0 z-10">
          <button onClick={() => setSidebarOpen(true)} className="text-slate-400 hover:text-white transition" aria-label="Меню">
            <span className="material-symbols-outlined">menu</span>
          </button>
          <span className="font-headline font-bold text-sm tracking-tight">КлиникСеть</span>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setDark(d => !d)} className="text-slate-400 hover:text-white transition">
              <span className="material-symbols-outlined text-lg">{dark ? 'light_mode' : 'dark_mode'}</span>
            </button>
            <button onClick={() => setHelpOpen(true)} className="text-slate-400 hover:text-white transition" title="Справка">
              <span className="material-symbols-outlined text-lg">help</span>
            </button>
            <button onClick={onLogout} className="text-slate-400 hover:text-white transition" title="Выйти">
              <span className="material-symbols-outlined text-lg">logout</span>
            </button>
          </div>
        </header>

        {/* Шапка десктоп — frosted glass */}
        <header className="hidden md:flex items-center justify-between px-8 py-0 h-16
          bg-white dark:bg-gray-900 border-b border-[#eceef0] dark:border-gray-800 sticky top-0 z-10">
          <div className="flex items-center gap-2 text-ms-on-surface dark:text-white">
            <span className="material-symbols-outlined text-ms-primary text-lg"
              style={{ fontVariationSettings: "'FILL' 1" }}>
              {NAV.find(n => n.key === activeSection)?.icon || 'dashboard'}
            </span>
            <h1 className="font-headline font-bold text-base tracking-tight">
              {NAV.find(n => n.key === activeSection)?.label || 'Панель управления'}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setDark(d => !d)}
              className="p-2 rounded-full text-ms-on-surface-variant dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
              title={dark ? 'Светлая тема' : 'Тёмная тема'}>
              <span className="material-symbols-outlined text-xl">{dark ? 'light_mode' : 'dark_mode'}</span>
            </button>
            <div className="h-6 w-px bg-ms-outline-variant/50" />
            <div className="flex items-center gap-2.5">
              <div className="text-right hidden lg:block">
                <div className="text-sm font-semibold text-ms-on-surface dark:text-white leading-tight">
                  {user?.full_name || user?.username || 'Администратор'}
                </div>
                <div className="text-[10px] text-ms-on-surface-variant dark:text-gray-400 uppercase tracking-wider">{user?.role === "super_admin" ? "Администратор платформы" : user?.role === "supervisor" ? "Владелец франшизы" : user?.role === "manager" ? "Руководитель клиники" : "Сотрудник"}</div>
              </div>
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                style={{ background: 'linear-gradient(135deg, #006173 0%, #007c92 100%)' }}>
                {(user?.full_name || user?.username || 'A')[0].toUpperCase()}
              </div>
            </div>
            <div className="h-6 w-px bg-ms-outline-variant/50" />
            <button onClick={() => setHelpOpen(true)}
              className="p-2 rounded-full text-ms-on-surface-variant dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
              title="Справка">
              <span className="material-symbols-outlined text-xl">help</span>
            </button>
            <button onClick={onLogout}
              className="p-2 rounded-full text-ms-on-surface-variant dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
              title="Выйти">
              <span className="material-symbols-outlined text-xl">logout</span>
            </button>
          </div>
        </header>


        {/* Контент страницы */}
        <main className="flex-1 p-5 lg:p-8 max-w-6xl w-full mx-auto">
          {renderSection()}
        </main>
      </div>

      {/* Модал справки */}
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} role="manager" />}
    </div>
  )
}
