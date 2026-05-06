import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  listAdmins, listManagerClinics, assignClinic,
  listPartners, updatePartner, deletePartner,
  listInvitations, createInvitation, deleteInvitation,
} from '../api'
import api from '../api'
import { API_BASE, BASE_PATH, SLUG } from '../config'

function getInitials(name) {
  if (!name) return '?'
  return name.trim().charAt(0).toUpperCase()
}

function RoleBadge({ role }) {
  if (role === 'manager') {
    return (
      <span className="inline-block bg-blue-100 text-blue-700 text-xs font-semibold px-2 py-0.5 rounded-full">
        manager
      </span>
    )
  }
  return (
    <span className="inline-block bg-gray-100 text-gray-600 text-xs font-semibold px-2 py-0.5 rounded-full">
      admin
    </span>
  )
}

function StatusDot({ isActive }) {
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${
        isActive ? 'bg-green-500' : 'bg-red-400'
      }`}
    />
  )
}

const EMPTY_FORM = {
  full_name: '',
  telegram_id: '',
  phone_number: '+7',
  date_of_birth: '',
  clinic_id: '',
  role: 'reg',
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

function AdminFormFields({ form, onChange, clinics }) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">
          ФИО <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          required
          value={form.full_name}
          onChange={e => onChange('full_name', e.target.value)}
          placeholder="Иванов Иван Иванович"
          className="w-full border border-gray-200 rounded-xl p-2.5 text-gray-800 text-sm focus:outline-none focus:border-primary"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">
          Telegram ID <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          required
          value={form.telegram_id}
          onChange={e => onChange('telegram_id', e.target.value)}
          placeholder="293633093"
          className="w-full border border-gray-200 rounded-xl p-2.5 text-gray-800 text-sm focus:outline-none focus:border-primary"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Телефон</label>
        <input
          type="tel"
          value={form.phone_number}
          onChange={e => onChange('phone_number', formatPhone(e.target.value))}
          onFocus={e => { if (e.target.value === '+7') { setTimeout(() => e.target.setSelectionRange(e.target.value.length, e.target.value.length), 0) } }}
          placeholder="+7 (900) 000-00-00"
          className="w-full border border-gray-200 rounded-xl p-2.5 text-gray-800 text-sm focus:outline-none focus:border-primary"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Дата рождения</label>
        <input
          type="date"
          value={form.date_of_birth}
          onChange={e => onChange('date_of_birth', e.target.value)}
          className="w-full border border-gray-200 rounded-xl p-2.5 text-gray-800 text-sm focus:outline-none focus:border-primary"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Клиника</label>
        <select
          value={form.clinic_id}
          onChange={e => onChange('clinic_id', e.target.value)}
          className="w-full border border-gray-200 rounded-xl p-2.5 text-gray-800 text-sm focus:outline-none focus:border-primary bg-white"
        >
          <option value="">Без клиники</option>
          {clinics.map(c => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Роль</label>
        <select
          value={form.role}
          onChange={e => onChange('role', e.target.value)}
          className="w-full border border-gray-200 rounded-xl p-2.5 text-gray-800 text-sm focus:outline-none focus:border-primary bg-white"
        >
          <option value="admin">Администратор</option>
          <option value="manager">Менеджер</option>
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Должность</label>
        <select
          value={form.category}
          onChange={e => onChange('category', e.target.value)}
          className="w-full border border-gray-200 rounded-xl p-2.5 text-gray-800 text-sm focus:outline-none focus:border-primary bg-white"
        >
          <option value="">Не указана</option>
          <option value="doctor">Врач</option>
          <option value="nurse">Медсестра</option>
        </select>
      </div>
    </div>
  )
}

function CreateModal({ clinics, onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleChange = (key, val) => setForm(f => ({ ...f, [key]: val }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.full_name.trim() || !form.telegram_id.trim()) {
      setError('Заполните обязательные поля')
      return
    }
    setLoading(true)
    setError('')
    try {
      const payload = {
        full_name: form.full_name.trim(),
        telegram_id: form.telegram_id.trim(),
        role: form.role,
      }
      if (form.phone_number && form.phone_number !== '+7') payload.phone_number = form.phone_number
      if (form.date_of_birth) payload.date_of_birth = form.date_of_birth
      if (form.clinic_id) payload.clinic_id = form.clinic_id
      if (form.category) payload.category = form.category
      await createAdmin(payload)
      onCreated()
    } catch (err) {
      const msg = err?.response?.data?.detail || 'Ошибка при создании'
      setError(typeof msg === 'string' ? msg : JSON.stringify(msg))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold text-gray-800 mb-4">Новый администратор</h2>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-3">
            <p className="text-red-600 text-sm">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <AdminFormFields form={form} onChange={handleChange} clinics={clinics} />

          <div className="flex gap-3 mt-5">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm font-medium"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-primary text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-50"
            >
              {loading ? 'Создание...' : 'Создать'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function EditModal({ admin, clinics, onClose, onSaved, onDeactivated }) {
  const [form, setForm] = useState({
    full_name: admin.full_name || '',
    telegram_id: String(admin.telegram_id || ''),
    phone_number: admin.phone_number ? formatPhone(admin.phone_number) : '+7',
    date_of_birth: admin.date_of_birth ? admin.date_of_birth.slice(0, 10) : '',
    clinic_id: admin.clinic_id ? String(admin.clinic_id) : '',
    role: admin.role || 'reg',
    category: admin.category || '',
  })
  const [isActive, setIsActive] = useState(admin.is_active !== false)
  const [loading, setLoading] = useState(false)
  const [deactivating, setDeactivating] = useState(false)
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)
  const [error, setError] = useState('')

  const handleChange = (key, val) => setForm(f => ({ ...f, [key]: val }))

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.full_name.trim() || !form.telegram_id.trim()) {
      setError('Заполните обязательные поля')
      return
    }
    setLoading(true)
    setError('')
    try {
      const payload = {
        full_name: form.full_name.trim(),
        telegram_id: form.telegram_id.trim(),
        role: form.role,
        is_active: isActive,
      }
      if (form.phone_number && form.phone_number !== '+7') payload.phone_number = form.phone_number
      else payload.phone_number = null
      if (form.date_of_birth) payload.date_of_birth = form.date_of_birth
      payload.clinic_id = form.clinic_id ? form.clinic_id : null
      if (!form.clinic_id) payload.unset_clinic = true
      if (form.category) payload.category = form.category
      else payload.category = null
      await updateAdmin(admin.id, payload)
      onSaved()
    } catch (err) {
      const msg = err?.response?.data?.detail || 'Ошибка при сохранении'
      setError(typeof msg === 'string' ? msg : JSON.stringify(msg))
    } finally {
      setLoading(false)
    }
  }

  const handleDeactivate = async () => {
    setDeactivating(true)
    setError('')
    try {
      await deactivateAdmin(admin.id)
      onDeactivated()
    } catch (err) {
      const msg = err?.response?.data?.detail || 'Ошибка при деактивации'
      setError(typeof msg === 'string' ? msg : JSON.stringify(msg))
      setConfirmDeactivate(false)
    } finally {
      setDeactivating(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold text-gray-800 mb-4">Редактировать</h2>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-3">
            <p className="text-red-600 text-sm">{error}</p>
          </div>
        )}

        <form onSubmit={handleSave}>
          <AdminFormFields form={form} onChange={handleChange} clinics={clinics} />

          {/* Active toggle */}
          <div className="flex items-center justify-between mt-4 p-3 bg-gray-50 rounded-xl">
            <span className="text-sm font-medium text-gray-700">
              {isActive ? 'Активен' : 'Заблокирован'}
            </span>
            <button
              type="button"
              onClick={() => setIsActive(v => !v)}
              className={`relative inline-flex w-12 h-6 rounded-full transition-colors focus:outline-none ${
                isActive ? 'bg-green-500' : 'bg-gray-300'
              }`}
            >
              <span
                className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  isActive ? 'translate-x-6' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          <div className="flex gap-3 mt-5">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm font-medium"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-primary text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-50"
            >
              {loading ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        </form>

        {/* Деактивировать / Удалить */}
        <div className="mt-3 space-y-2">
          {admin.is_active !== false && (
            !confirmDeactivate ? (
              <button type="button" onClick={() => setConfirmDeactivate('deactivate')}
                className="w-full border border-orange-200 text-orange-500 rounded-xl py-2.5 text-sm font-medium">
                Заблокировать аккаунт
              </button>
            ) : confirmDeactivate === 'deactivate' ? (
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-3">
                <p className="text-sm text-orange-700 mb-3 text-center">Заблокировать? Сотрудник не сможет войти.</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setConfirmDeactivate(false)}
                    className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2 text-sm font-medium">Нет</button>
                  <button type="button" onClick={handleDeactivate} disabled={deactivating}
                    className="flex-1 bg-orange-500 text-white rounded-xl py-2 text-sm font-medium disabled:opacity-50">
                    {deactivating ? '...' : 'Заблокировать'}
                  </button>
                </div>
              </div>
            ) : null
          )}

          {confirmDeactivate !== 'delete' ? (
            <button type="button" onClick={() => setConfirmDeactivate('delete')}
              className="w-full border border-red-200 text-red-500 rounded-xl py-2.5 text-sm font-medium">
              Удалить сотрудника
            </button>
          ) : (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3">
              <p className="text-sm text-red-700 mb-1 text-center font-semibold">Удалить полностью?</p>
              <p className="text-xs text-red-500 mb-3 text-center">Все направления и данные сотрудника останутся, но аккаунт будет удалён.</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setConfirmDeactivate(false)}
                  className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2 text-sm font-medium">Нет</button>
                <button type="button" disabled={deactivating}
                  onClick={async () => {
                    setDeactivating(true)
                    try {
                      await api.delete(`/manager/admins/${admin.id}?hard=true`)
                      onDeactivated()
                    } catch (e) {
                      setError(e.response?.data?.detail || 'Ошибка удаления')
                      setConfirmDeactivate(false)
                    } finally { setDeactivating(false) }
                  }}
                  className="flex-1 bg-red-500 text-white rounded-xl py-2 text-sm font-medium disabled:opacity-50">
                  {deactivating ? '...' : 'Удалить'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function AdminCard({ admin, clinics, onClick, bulkMode, selected, onToggle }) {
  const clinicName = clinics.find(c => c.id === admin.clinic_id)?.name || null

  return (
    <div className="relative">
      {bulkMode && (
        <button
          type="button"
          onClick={() => onToggle(admin.id)}
          className={`absolute left-3 top-1/2 -translate-y-1/2 z-10 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
            selected ? 'bg-primary border-primary' : 'bg-white border-gray-300'
          }`}
        >
          {selected && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
        </button>
      )}
      <button
        type="button"
        onClick={() => bulkMode ? onToggle(admin.id) : onClick(admin)}
        className={`w-full bg-white rounded-2xl shadow-sm p-4 flex items-center gap-3 text-left active:scale-[0.99] transition-transform ${bulkMode ? 'pl-10' : ''}`}
      >
        <div className="w-11 h-11 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
          <span className="text-white text-lg font-bold">{getInitials(admin.full_name)}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-800 truncate">{admin.full_name || '—'}</span>
            <RoleBadge role={admin.role} />
          </div>
          <p className={`text-xs mt-0.5 truncate ${clinicName ? 'text-gray-500' : 'text-gray-400 italic'}`}>
            {clinicName || 'Без клиники'}
          </p>
          {admin.category && (
            <p className="text-xs text-primary font-medium mt-0.5">
              {admin.category === 'doctor' ? 'Врач' : admin.category === 'nurse' ? 'Медсестра' : admin.category}
            </p>
          )}
          {admin.phone_number && <p className="text-xs text-gray-400 mt-0.5">{admin.phone_number}</p>}
        </div>
        <StatusDot isActive={admin.is_active !== false} />
      </button>
    </div>
  )
}

// CSV Import Modal
function CsvImportModal({ clinics, onClose, onDone }) {
  const [rows, setRows] = useState([])
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [phase, setPhase] = useState('upload') // 'upload' | 'preview' | 'done'

  const handleFile = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target.result
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
      const parsed = lines.slice(1).map(line => {
        const cols = line.split(',')
        return {
          full_name: (cols[0] || '').trim(),
          username: (cols[1] || '').trim(),
          password: (cols[2] || '').trim(),
          clinic_name: (cols[3] || '').trim(),
          role: (cols[4] || 'reg').trim(),
        }
      }).filter(r => r.full_name)
      setRows(parsed)
      setPhase('preview')
    }
    reader.readAsText(file, 'utf-8')
  }

  const handleCreateAll = async () => {
    setLoading(true)
    const res = []
    for (const row of rows) {
      const clinic = clinics.find(c => c.name.toLowerCase() === row.clinic_name.toLowerCase())
      try {
        await createAdmin({
          full_name: row.full_name,
          username: row.username || undefined,
          password: row.password || undefined,
          clinic_id: clinic?.id || undefined,
          role: row.role === 'manager' ? 'manager' : 'reg',
        })
        res.push({ ...row, ok: true })
      } catch (e) {
        res.push({ ...row, ok: false, error: e.response?.data?.detail || 'Ошибка' })
      }
    }
    setResults(res)
    setPhase('done')
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-5 w-full max-w-sm shadow-xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-800">Импорт CSV</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {phase === 'upload' && (
          <>
            <p className="text-xs text-gray-500 mb-3">Формат CSV: <code className="bg-gray-50 px-1 rounded">full_name,username,password,clinic_name,role</code></p>
            <label className="block w-full border-2 border-dashed border-gray-200 rounded-xl p-6 text-center cursor-pointer hover:border-primary transition-colors">
              <input type="file" accept=".csv,text/csv" onChange={handleFile} className="hidden" />
              <p className="text-sm text-gray-500">Нажмите для выбора CSV файла</p>
            </label>
          </>
        )}

        {phase === 'preview' && (
          <>
            <p className="text-sm text-gray-600 mb-3">Найдено строк: <strong>{rows.length}</strong></p>
            <div className="border border-gray-100 rounded-xl overflow-hidden mb-4">
              <table className="w-full text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-3 py-2 text-gray-500">ФИО</th>
                    <th className="text-left px-3 py-2 text-gray-500">Клиника</th>
                    <th className="text-left px-3 py-2 text-gray-500">Роль</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                      <td className="px-3 py-2 text-gray-700">{r.full_name}</td>
                      <td className="px-3 py-2 text-gray-500">{r.clinic_name || '—'}</td>
                      <td className="px-3 py-2 text-gray-500">{r.role}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setPhase('upload')} className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm font-medium">Назад</button>
              <button onClick={handleCreateAll} disabled={loading} className="flex-1 bg-primary text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-50">
                {loading ? 'Создание...' : `Создать ${rows.length} записей`}
              </button>
            </div>
          </>
        )}

        {phase === 'done' && (
          <>
            <p className="text-sm font-semibold text-gray-700 mb-3">
              Результат: {results.filter(r => r.ok).length} создано, {results.filter(r => !r.ok).length} ошибок
            </p>
            <div className="space-y-1 mb-4">
              {results.map((r, i) => (
                <div key={i} className={`flex items-center gap-2 text-xs p-2 rounded-lg ${r.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                  <span>{r.ok ? '✓' : '✗'}</span>
                  <span className="flex-1 truncate">{r.full_name}</span>
                  {!r.ok && <span className="text-red-500 truncate max-w-[120px]">{r.error}</span>}
                </div>
              ))}
            </div>
            <button onClick={() => { onDone(); onClose() }} className="w-full bg-primary text-white rounded-xl py-2.5 text-sm font-medium">
              Готово
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ===========================================================================
// БЛОК: Таб управления партнёрами и инвайтами
// ===========================================================================
// Показывает список партнёров клиники и активные инвайт-ссылки.
// Расширение: добавить редактирование партнёра, статистику, фильтры
// ===========================================================================

function PartnersTab() {
  const [partners, setPartners] = useState([])
  const [invites, setInvites] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(null)
  const [creatingInvite, setCreatingInvite] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null) // partner id

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [pRes, iRes] = await Promise.all([listPartners(), listInvitations()])
      setPartners(Array.isArray(pRes.data) ? pRes.data : [])
      setInvites(Array.isArray(iRes.data) ? iRes.data : [])
    } catch {
      setError('Не удалось загрузить данные')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // ─── Генерация инвайт-ссылки ───
  const handleCreateInvite = async () => {
    setCreatingInvite(true)
    try {
      await createInvitation({ max_uses: 100 })
      await fetchAll()
    } catch (e) {
      setError(e?.response?.data?.detail || 'Ошибка создания инвайта')
    } finally {
      setCreatingInvite(false)
    }
  }

  // ─── Копирование ссылки ───
  const handleCopy = (code) => {
    const url = `${window.location.origin}${BASE_PATH}/invite/${code}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(code)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  // ─── Удаление инвайта ───
  const handleDeleteInvite = async (id) => {
    try {
      await deleteInvitation(id)
      setInvites(inv => inv.filter(i => i.id !== id))
    } catch {
      setError('Ошибка удаления инвайта')
    }
  }

  // ─── Деактивация партнёра ───
  const handleDeactivatePartner = async (id) => {
    try {
      await deletePartner(id, false)
      await fetchAll()
      setConfirmDelete(null)
    } catch {
      setError('Ошибка деактивации партнёра')
    }
  }

  const activeInvites = invites.filter(i => i.is_valid)

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div>
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4">
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      )}

      {/* ─── Инвайт-ссылки ─── */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700">Ссылки для регистрации</h2>
          <button
            onClick={handleCreateInvite}
            disabled={creatingInvite}
            className="bg-primary text-white rounded-xl px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            {creatingInvite ? '...' : '+ Создать ссылку'}
          </button>
        </div>

        {activeInvites.length === 0 ? (
          <div className="bg-gray-50 rounded-xl p-4 text-center">
            <p className="text-xs text-gray-400">Нет активных ссылок. Создайте новую.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {activeInvites.map(inv => {
              const url = `${window.location.origin}${BASE_PATH}/invite/${inv.code}`
              return (
                <div key={inv.id} className="bg-white border border-gray-100 rounded-xl p-3 flex items-center gap-2 shadow-sm">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-400 truncate">{url}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Использований: {inv.uses_count}/{inv.max_uses}
                      {inv.expires_at && ` · до ${new Date(inv.expires_at).toLocaleDateString('ru-RU')}`}
                    </p>
                  </div>
                  <button
                    onClick={() => handleCopy(inv.code)}
                    className={`flex-shrink-0 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      copied === inv.code
                        ? 'bg-green-100 text-green-700'
                        : 'bg-blue-50 text-primary'
                    }`}
                  >
                    {copied === inv.code ? '✓ Скопировано' : 'Копировать'}
                  </button>
                  <button
                    onClick={() => handleDeleteInvite(inv.id)}
                    className="flex-shrink-0 p-1.5 text-gray-300 hover:text-red-400 transition-colors"
                    title="Удалить ссылку"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ─── Список партнёров ─── */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">
          Партнёры ({partners.length})
        </h2>

        {partners.length === 0 ? (
          <div className="bg-gray-50 rounded-xl p-6 text-center">
            <div className="text-3xl mb-2">🤝</div>
            <p className="text-sm text-gray-500">Партнёров пока нет</p>
            <p className="text-xs text-gray-400 mt-1">Создайте инвайт-ссылку и поделитесь ею</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {partners.map(p => (
              <div key={p.id} className={`bg-white rounded-2xl shadow-sm p-4 flex items-center gap-3 ${!p.is_active ? 'opacity-50' : ''}`}>
                {/* Аватар */}
                <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-base font-bold">
                    {(p.full_name || '?').charAt(0).toUpperCase()}
                  </span>
                </div>

                {/* Данные */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 truncate">{p.full_name}</p>
                  <p className="text-xs text-gray-400 truncate">
                    {p.phone_number || p.username || '—'} · {p.referrals_count} направлений
                  </p>
                </div>

                {/* Статус и кнопка */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`w-2.5 h-2.5 rounded-full ${p.is_active ? 'bg-green-500' : 'bg-red-400'}`} />
                  {p.is_active && (
                    confirmDelete === p.id ? (
                      <div className="flex gap-1">
                        <button onClick={() => setConfirmDelete(null)}
                          className="text-xs text-gray-400 px-2 py-1 border border-gray-200 rounded-lg">
                          Нет
                        </button>
                        <button onClick={() => handleDeactivatePartner(p.id)}
                          className="text-xs text-red-500 px-2 py-1 border border-red-200 rounded-lg">
                          Да
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDelete(p.id)}
                        className="text-xs text-gray-400 hover:text-red-500 px-2 py-1 border border-gray-200 rounded-lg transition-colors"
                      >
                        Откл.
                      </button>
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}


export default function AdminPanel() {
  const nav = useNavigate()
  // ─── Текущий таб: 'staff' (сотрудники) | 'partners' (партнёры) ───
  const [activeTab, setActiveTab] = useState('staff')
  const [admins, setAdmins] = useState([])
  const [clinics, setClinics] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [bulkMode, setBulkMode] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [showBulkClinicModal, setShowBulkClinicModal] = useState(false)
  const [bulkTargetClinic, setBulkTargetClinic] = useState('')
  const [bulkAssigning, setBulkAssigning] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [adminsRes, clinicsRes] = await Promise.all([
        listAdmins(),
        listManagerClinics(),
      ])
      setAdmins(Array.isArray(adminsRes.data) ? adminsRes.data : [])
      setClinics(Array.isArray(clinicsRes.data) ? clinicsRes.data : [])
    } catch (err) {
      setError('Не удалось загрузить данные')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const filtered = admins.filter(a => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      (a.full_name || '').toLowerCase().includes(q) ||
      (a.phone_number || '').toLowerCase().includes(q)
    )
  })

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleBulkAssign = async () => {
    if (!bulkTargetClinic) return
    setBulkAssigning(true)
    try {
      for (const adminId of selected) {
        await assignClinic(adminId, bulkTargetClinic)
      }
      setSelected(new Set())
      setBulkMode(false)
      setShowBulkClinicModal(false)
      fetchData()
    } catch {
      setError('Ошибка массового перевода')
    } finally {
      setBulkAssigning(false)
    }
  }

  return (
    <div className="p-4 pb-24 max-w-lg mx-auto">

      {/* ─── Заголовок с кнопками действий ─── */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-800">Персонал</h1>
        {activeTab === 'staff' && (
          <div className="flex gap-2 flex-wrap justify-end">
            <button type="button" onClick={() => nav('/manager/schedules')}
              className="border border-gray-200 text-gray-600 rounded-xl px-3 py-2 text-sm font-medium">
              Расписание
            </button>
            <button type="button" onClick={() => { setBulkMode(b => !b); setSelected(new Set()) }}
              className={`border rounded-xl px-3 py-2 text-sm font-medium transition-colors ${bulkMode ? 'border-primary text-primary bg-blue-50' : 'border-gray-200 text-gray-600'}`}>
              Выбор
            </button>
          </div>
        )}
      </div>

      {/* ─── Переключатель табов: Сотрудники / Партнёры ─── */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-4">
        <button
          onClick={() => setActiveTab('staff')}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'staff' ? 'bg-white text-primary shadow-sm' : 'text-gray-500'
          }`}
        >
          👥 Сотрудники
        </button>
        <button
          onClick={() => setActiveTab('partners')}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'partners' ? 'bg-white text-primary shadow-sm' : 'text-gray-500'
          }`}
        >
          🤝 Партнёры
        </button>
      </div>

      {/* ─── Таб партнёров ─── */}
      {activeTab === 'partners' && <PartnersTab />}

      {/* ─── Таб сотрудников ─── */}
      {activeTab === 'staff' && <>

      {/* Search */}
      <div className="relative mb-4">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-base pointer-events-none">
          🔍
        </span>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Поиск по имени или телефону..."
          className="w-full border border-gray-200 rounded-xl pl-9 pr-4 py-2.5 text-sm text-gray-800 focus:outline-none focus:border-primary bg-white shadow-sm"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4">
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-gray-400 text-sm">
            {search.trim() ? 'Ничего не найдено' : 'Сотрудников нет'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map(admin => (
            <AdminCard
              key={admin.id}
              admin={admin}
              clinics={clinics}
              onClick={() => {}}
              bulkMode={bulkMode}
              selected={selected.has(admin.id)}
              onToggle={toggleSelect}
            />
          ))}
        </div>
      )}

      {/* Bulk assign bottom bar */}
      {bulkMode && selected.size > 0 && (
        <div className="fixed bottom-20 left-0 right-0 mx-4 bg-white rounded-2xl shadow-xl border border-gray-100 p-4 flex items-center gap-3 z-40">
          <p className="flex-1 text-sm font-semibold text-gray-700">{selected.size} выбрано</p>
          <button
            onClick={() => setShowBulkClinicModal(true)}
            className="bg-primary text-white rounded-xl px-4 py-2 text-sm font-medium"
          >
            Перевести в клинику
          </button>
        </div>
      )}

      {/* Bulk clinic modal */}
      {showBulkClinicModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-5 w-full max-w-sm shadow-xl">
            <h2 className="text-lg font-bold text-gray-800 mb-4">Перевести {selected.size} сотр. в клинику</h2>
            <select
              value={bulkTargetClinic}
              onChange={e => setBulkTargetClinic(e.target.value)}
              className="w-full border border-gray-200 rounded-xl p-2.5 text-sm mb-4 focus:outline-none focus:border-primary bg-white"
            >
              <option value="">Выберите клинику</option>
              {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div className="flex gap-2">
              <button onClick={() => setShowBulkClinicModal(false)} className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm font-medium">Отмена</button>
              <button
                onClick={handleBulkAssign}
                disabled={!bulkTargetClinic || bulkAssigning}
                className="flex-1 bg-primary text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-50"
              >
                {bulkAssigning ? 'Перевод...' : 'Перевести'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Закрываем таб сотрудников */}
      </>}

    </div>
  )
}
