/**
 * PatientCardModal.jsx — модал-карточка пациента ЛК (5 tabs):
 *   1. Профиль (+теги/+заметки)
 *   2. Настройки коммуникаций (comm_prefs)
 *   3. История ЛК (recent_logins timeline)
 *   4. Записи и платежи (appointments)
 *   5. Push-история (suggestions данного пациента)
 */
import { useEffect, useState, useCallback } from 'react'
import { API_BASE } from '../../config'

function apiFetch(token, path, opts = {}) {
  return fetch(API_BASE + path, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  })
}

function fmtDate(s) {
  if (!s) return '—'
  try { return new Date(s).toLocaleDateString('ru', { day: '2-digit', month: '2-digit', year: 'numeric' }) }
  catch { return s }
}
function fmtDateTime(s) {
  if (!s) return '—'
  try { return new Date(s).toLocaleString('ru', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  catch { return s }
}

const TABS = [
  { id: 'profile',   label: 'Профиль',     icon: 'account_circle' },
  { id: 'prefs',     label: 'Коммуникации', icon: 'tune' },
  { id: 'logins',    label: 'История ЛК',   icon: 'history' },
  { id: 'apps',      label: 'Записи и платежи', icon: 'event' },
  { id: 'pushes',    label: 'Push-история', icon: 'notifications' },
]

export default function PatientCardModal({ token, patientId, onClose }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('profile')

  const reload = useCallback(() => {
    setLoading(true)
    apiFetch(token, `/api/engagement/patients/${patientId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [token, patientId])

  useEffect(() => { reload() }, [reload])

  if (!patientId) return null

  const profile = data?.profile || {}
  const tags = data?.tags || []
  const notes = data?.notes || []
  const prefs = data?.comm_prefs || {}
  const recentLogins = data?.recent_logins || []
  const appointments = data?.appointments || []
  const suggestions = data?.suggestions || []

  return (
    <div className="fixed inset-0 bg-black/50 z-[1000] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[94vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-cyan-500 to-teal-600 flex items-center justify-center text-white font-bold text-lg shadow-sm">
            {(profile.name || '?').slice(0, 1).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-gray-900 dark:text-white text-lg truncate">{profile.name || 'Без имени'}</h2>
            <div className="text-xs text-gray-500 dark:text-gray-400 flex gap-3 mt-0.5">
              <span><b className="text-gray-700 dark:text-gray-300">{profile.phone || '—'}</b></span>
              <span>{profile.email || ''}</span>
              {profile.login_count != null && <span>Логинов: <b>{profile.login_count}</b></span>}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl">✕</button>
        </div>

        {/* Tabs */}
        <div className="px-6 pt-3 border-b border-gray-100 dark:border-gray-700 flex gap-1 overflow-x-auto">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-3 py-2 text-sm font-semibold flex items-center gap-1.5 whitespace-nowrap border-b-2 transition ${
                tab === t.id
                  ? 'border-cyan-500 text-cyan-600 dark:text-cyan-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}>
              <span className="material-symbols-outlined text-base">{t.icon}</span>{t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading && <div className="text-center py-10 text-gray-400">Загрузка…</div>}

          {!loading && tab === 'profile' && (
            <ProfileTab token={token} patientId={patientId} profile={profile} tags={tags} notes={notes} onChange={reload} />
          )}
          {!loading && tab === 'prefs' && (
            <PrefsTab token={token} patientId={patientId} prefs={prefs} onChange={reload} />
          )}
          {!loading && tab === 'logins' && (
            <LoginsTab logins={recentLogins} />
          )}
          {!loading && tab === 'apps' && (
            <AppointmentsTab appointments={appointments} />
          )}
          {!loading && tab === 'pushes' && (
            <PushHistoryTab suggestions={suggestions} />
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Tab 1: Профиль ────────────────────────────────────────────────────────
function ProfileTab({ token, patientId, profile, tags, notes, onChange }) {
  const [newTag, setNewTag] = useState('')
  const [newNote, setNewNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function addTag() {
    if (!newTag.trim()) return
    setBusy(true)
    try {
      await apiFetch(token, `/api/engagement/patients/${patientId}/tags`, {
        method: 'POST', body: JSON.stringify({ name: newTag.trim() })
      })
      setNewTag(''); onChange()
    } finally { setBusy(false) }
  }
  async function removeTag(tagId) {
    setBusy(true)
    try {
      await apiFetch(token, `/api/engagement/patients/${patientId}/tags/${tagId}`, { method: 'DELETE' })
      onChange()
    } finally { setBusy(false) }
  }
  async function addNote() {
    if (!newNote.trim()) return
    setBusy(true)
    try {
      await apiFetch(token, `/api/engagement/patients/${patientId}/notes`, {
        method: 'POST', body: JSON.stringify({ text: newNote.trim() })
      })
      setNewNote(''); onChange()
    } finally { setBusy(false) }
  }
  async function toggleNotePin(n) {
    setBusy(true)
    try {
      await apiFetch(token, `/api/engagement/patients/${patientId}/notes/${n.id}`, {
        method: 'PATCH', body: JSON.stringify({ pinned: !n.pinned })
      })
      onChange()
    } finally { setBusy(false) }
  }
  async function deleteNote(n) {
    if (!confirm('Удалить заметку?')) return
    setBusy(true)
    try {
      await apiFetch(token, `/api/engagement/patients/${patientId}/notes/${n.id}`, { method: 'DELETE' })
      onChange()
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      {/* Профильные поля */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Телефон" value={profile.phone} />
        <Field label="Имя" value={profile.name} />
        <Field label="Email" value={profile.email} />
        <Field label="Дата рождения" value={fmtDate(profile.birth_date)} />
        <Field label="Логинов" value={profile.login_count ?? '—'} />
        <Field label="Last seen" value={fmtDateTime(profile.last_seen_at)} />
        <Field label="Зарегистрирован" value={fmtDateTime(profile.created_at)} />
        <Field label="Marketing opt-in" value={profile.marketing_opt_in ? 'Да' : 'Нет'} />
      </div>

      {/* Tags */}
      <div>
        <h4 className="text-sm font-bold text-gray-700 dark:text-gray-200 mb-2 flex items-center gap-1">
          <span className="material-symbols-outlined text-base text-cyan-500">sell</span>Тэги
        </h4>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {tags.length === 0 && <span className="text-xs text-gray-400">Нет тэгов</span>}
          {tags.map(t => (
            <span key={t.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300">
              {t.name}
              <button onClick={() => removeTag(t.id)} className="text-cyan-700/60 hover:text-cyan-900" disabled={busy}>×</button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={newTag} onChange={e => setNewTag(e.target.value)} onKeyDown={e => e.key === 'Enter' && addTag()}
            placeholder="Новый тэг…"
            className="flex-1 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm" />
          <button onClick={addTag} disabled={busy || !newTag.trim()}
            className="px-3 py-1.5 rounded-lg bg-cyan-600 text-white text-sm hover:bg-cyan-700 disabled:opacity-50">+ Добавить</button>
        </div>
      </div>

      {/* Notes */}
      <div>
        <h4 className="text-sm font-bold text-gray-700 dark:text-gray-200 mb-2 flex items-center gap-1">
          <span className="material-symbols-outlined text-base text-amber-500">sticky_note_2</span>Заметки менеджера
        </h4>
        <div className="space-y-2 mb-2">
          {notes.length === 0 && <div className="text-xs text-gray-400">Нет заметок</div>}
          {notes.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned)).map(n => (
            <div key={n.id} className={`p-3 rounded-lg border ${n.pinned ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800' : 'bg-gray-50 dark:bg-gray-900/40 border-gray-200 dark:border-gray-700'}`}>
              <div className="flex items-start gap-2">
                <div className="flex-1 text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{n.text}</div>
                <button onClick={() => toggleNotePin(n)} title={n.pinned ? 'Открепить' : 'Закрепить'}
                  className={`material-symbols-outlined text-base ${n.pinned ? 'text-amber-500' : 'text-gray-400 hover:text-amber-500'}`}>
                  push_pin
                </button>
                <button onClick={() => deleteNote(n)} title="Удалить"
                  className="material-symbols-outlined text-base text-gray-400 hover:text-red-500">delete</button>
              </div>
              <div className="text-[10px] text-gray-400 mt-1">{fmtDateTime(n.created_at)}</div>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <textarea rows={2} value={newNote} onChange={e => setNewNote(e.target.value)}
            placeholder="Новая заметка…"
            className="flex-1 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm" />
          <button onClick={addNote} disabled={busy || !newNote.trim()}
            className="px-3 self-stretch rounded-lg bg-amber-500 text-white text-sm hover:bg-amber-600 disabled:opacity-50">+</button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value }) {
  return (
    <div className="bg-gray-50 dark:bg-gray-900/40 rounded-lg px-3 py-2">
      <div className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase">{label}</div>
      <div className="text-sm text-gray-900 dark:text-white mt-0.5 break-words">{value || '—'}</div>
    </div>
  )
}

// ─── Tab 2: comm_prefs ─────────────────────────────────────────────────────
function PrefsTab({ token, patientId, prefs, onChange }) {
  const [draft, setDraft] = useState(() => ({
    promo: prefs.promo !== false,
    reminders: prefs.reminders !== false,
    loyalty: prefs.loyalty !== false,
    news: prefs.news !== false,
    quiet_hours_from: prefs.quiet_hours_from ?? 22,
    quiet_hours_to:   prefs.quiet_hours_to ?? 9,
  }))
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setDraft({
      promo: prefs.promo !== false,
      reminders: prefs.reminders !== false,
      loyalty: prefs.loyalty !== false,
      news: prefs.news !== false,
      quiet_hours_from: prefs.quiet_hours_from ?? 22,
      quiet_hours_to:   prefs.quiet_hours_to ?? 9,
    })
  }, [prefs])

  async function save() {
    setBusy(true); setSaved(false)
    try {
      const r = await apiFetch(token, `/api/engagement/patients/${patientId}/comm-prefs`, {
        method: 'PATCH', body: JSON.stringify(draft)
      })
      if (r.ok) { setSaved(true); setTimeout(() => setSaved(false), 1800); onChange() }
    } finally { setBusy(false) }
  }

  const TOGGLES = [
    { key: 'promo',     label: 'Промо-акции',          icon: 'local_fire_department' },
    { key: 'reminders', label: 'Напоминания о визитах', icon: 'event' },
    { key: 'loyalty',   label: 'Программа лояльности',  icon: 'stars' },
    { key: 'news',      label: 'Новости клиники',       icon: 'newspaper' },
  ]

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Эти настройки управляют, какие push-уведомления получает пациент. Пациент может изменить их сам в ЛК.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {TOGGLES.map(t => (
          <label key={t.key} className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-900/30 cursor-pointer">
            <span className="material-symbols-outlined text-2xl text-cyan-500">{t.icon}</span>
            <div className="flex-1">
              <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">{t.label}</div>
            </div>
            <input type="checkbox" checked={!!draft[t.key]} onChange={e => setDraft(d => ({ ...d, [t.key]: e.target.checked }))}
              className="h-5 w-5 rounded text-cyan-600" />
          </label>
        ))}
      </div>

      <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-700">
        <div className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2 flex items-center gap-1">
          <span className="material-symbols-outlined text-base text-violet-500">bedtime</span>Тихие часы — не беспокоить
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-500">с</span>
          <select value={draft.quiet_hours_from} onChange={e => setDraft(d => ({ ...d, quiet_hours_from: Number(e.target.value) }))}
            className="px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
            {Array.from({ length: 24 }).map((_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
          </select>
          <span className="text-gray-500">до</span>
          <select value={draft.quiet_hours_to} onChange={e => setDraft(d => ({ ...d, quiet_hours_to: Number(e.target.value) }))}
            className="px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
            {Array.from({ length: 24 }).map((_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={busy}
          className="px-4 py-2 rounded-lg bg-cyan-600 text-white text-sm font-semibold hover:bg-cyan-700 disabled:opacity-50">
          {busy ? 'Сохраняем…' : 'Сохранить'}
        </button>
        {saved && <span className="text-sm text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
          <span className="material-symbols-outlined text-base">check_circle</span>Сохранено
        </span>}
      </div>
    </div>
  )
}

// ─── Tab 3: Logins timeline ────────────────────────────────────────────────
function LoginsTab({ logins }) {
  if (!logins.length) return <div className="text-center py-10 text-gray-400">Нет данных по входам</div>
  return (
    <div className="relative pl-6">
      <div className="absolute left-2 top-0 bottom-0 w-px bg-gradient-to-b from-cyan-300 to-transparent" />
      {logins.map((l, i) => (
        <div key={i} className="relative mb-3">
          <div className="absolute -left-[18px] top-1.5 w-3 h-3 rounded-full bg-cyan-500 ring-2 ring-white dark:ring-gray-800" />
          <div className="bg-gray-50 dark:bg-gray-900/40 rounded-lg p-2.5 border border-gray-100 dark:border-gray-700">
            <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">{fmtDateTime(l.created_at || l.at)}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 flex flex-wrap gap-3 mt-0.5">
              {l.ip && <span><b>IP:</b> {l.ip}</span>}
              {l.user_agent && <span className="truncate max-w-[300px]" title={l.user_agent}><b>UA:</b> {l.user_agent}</span>}
              {l.device && <span><b>Устройство:</b> {l.device}</span>}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Tab 4: Appointments ───────────────────────────────────────────────────
function AppointmentsTab({ appointments }) {
  if (!appointments.length) return <div className="text-center py-10 text-gray-400">Нет записей в этой клинике</div>
  return (
    <div className="space-y-2">
      {appointments.map(a => (
        <div key={a.id} className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/40">
          <span className="material-symbols-outlined text-2xl text-cyan-500">event</span>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm text-gray-900 dark:text-white">
              {a.service_name || a.service || 'Приём'}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {fmtDateTime(a.started_at || a.start_at || a.date)} · {a.doctor_name || ''}
            </div>
          </div>
          {a.amount != null && (
            <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
              {Number(a.amount).toLocaleString('ru')} ₽
            </div>
          )}
          {a.status && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
              {a.status}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Tab 5: Push history ───────────────────────────────────────────────────
function PushHistoryTab({ suggestions }) {
  const [filter, setFilter] = useState('all')
  const filtered = suggestions.filter(s => filter === 'all' || s.status === filter)

  return (
    <div className="space-y-2">
      <div className="flex gap-1 text-xs">
        {['all', 'pending', 'sent', 'dismissed', 'postponed'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-2 py-1 rounded-lg font-semibold ${filter === f
              ? 'bg-cyan-600 text-white'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200'}`}>
            {f === 'all' ? 'Все' : f}
          </button>
        ))}
      </div>
      {filtered.length === 0 && <div className="text-center py-10 text-gray-400">Нет push для этого пациента</div>}
      {filtered.map(s => (
        <div key={s.id} className="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/40">
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700">
              {s.kind}
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
              {s.status}
            </span>
            <span className="ml-auto text-[10px] text-gray-400">{fmtDateTime(s.created_at)}</span>
          </div>
          {s.meta?.text && <div className="text-sm text-gray-700 dark:text-gray-300">{s.meta.text}</div>}
        </div>
      ))}
    </div>
  )
}
