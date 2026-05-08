/**
 * FranchisesSection — Управление франшизами (super_admin).
 *
 * Иерархия: Платформа → Франшиза → Тенант → Клиника.
 * Здесь super_admin создаёт новые франшизы, назначает им владельцев
 * (роль franchise_owner), и при необходимости создаёт нового владельца inline.
 *
 * После создания франшизы, владелец заходит в свой кабинет (/franchise-owner),
 * где сам формирует список тенантов — тенанты автоматически попадают в его франшизу.
 *
 * API:
 *   GET    /admin/franchises              — список (with tenant_count, mrr_sum)
 *   POST   /admin/franchises              — создать
 *   PATCH  /admin/franchises/{id}         — редактировать
 *   DELETE /admin/franchises/{id}         — удалить (тенанты остаются)
 *   GET    /admin/users?role=franchise_owner — кандидаты в владельцы
 *   POST   /admin/users                   — создать нового пользователя-владельца
 */
import { useState, useEffect, useCallback } from 'react'
import api from '../api'

// Унификация: единый axios-инстанс с auto-Bearer + auto-refresh.
// Параметр token оставлен для сигнатуры — больше не используется.
const apiFetch = (m, url, _t, d) => api({ method: m, url, data: d })

// Преобразование name → slug
const slugify = (s) =>
  (s || '')
    .toString()
    .toLowerCase()
    .replace(/[ё]/g, 'e')
    .replace(/[а]/g, 'a').replace(/[б]/g, 'b').replace(/[в]/g, 'v')
    .replace(/[г]/g, 'g').replace(/[д]/g, 'd').replace(/[е]/g, 'e')
    .replace(/[ж]/g, 'zh').replace(/[з]/g, 'z').replace(/[и]/g, 'i')
    .replace(/[й]/g, 'i').replace(/[к]/g, 'k').replace(/[л]/g, 'l')
    .replace(/[м]/g, 'm').replace(/[н]/g, 'n').replace(/[о]/g, 'o')
    .replace(/[п]/g, 'p').replace(/[р]/g, 'r').replace(/[с]/g, 's')
    .replace(/[т]/g, 't').replace(/[у]/g, 'u').replace(/[ф]/g, 'f')
    .replace(/[х]/g, 'h').replace(/[ц]/g, 'c').replace(/[ч]/g, 'ch')
    .replace(/[ш]/g, 'sh').replace(/[щ]/g, 'sh').replace(/[ъь]/g, '')
    .replace(/[ы]/g, 'y').replace(/[э]/g, 'e').replace(/[ю]/g, 'yu')
    .replace(/[я]/g, 'ya')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)

const EMPTY_FORM = {
  name: '',
  slug: '',
  owner_user_id: '',
  contact_email: '',
  contact_phone: '',
  brand_color: '#7c3aed',
  notes: '',
  // Region Lock — географический контроль франшизы
  allowed_region: '',
  region_strict: false,
}

const EMPTY_OWNER_FORM = {
  full_name: '',
  username: '',
  email: '',
  password: '',
}

export default function FranchisesSection({ token }) {
  const [items, setItems]         = useState(null)
  const [owners, setOwners]       = useState([])
  const [showForm, setShowForm]   = useState(false)
  const [editing, setEditing]     = useState(null) // объект редактирования
  const [form, setForm]           = useState(EMPTY_FORM)
  const [slugManual, setSlugManual] = useState(false)
  const [showOwnerForm, setShowOwnerForm] = useState(false)
  const [ownerForm, setOwnerForm] = useState(EMPTY_OWNER_FORM)
  const [ownerCreated, setOwnerCreated] = useState(null) // {username, password}
  const [saving, setSaving]       = useState(false)
  const [msg, setMsg]             = useState('')
  const [msgType, setMsgType]     = useState('ok')
  const [confirmDelete, setConfirmDelete] = useState(null) // объект удаления

  const showMsg = (text, type = 'ok') => {
    setMsg(text); setMsgType(type)
    setTimeout(() => setMsg(''), 4500)
  }

  const loadList = useCallback(async () => {
    try {
      const r = await apiFetch('get', '/admin/franchises', token)
      setItems(Array.isArray(r.data) ? r.data : [])
    } catch (e) {
      showMsg('Ошибка загрузки списка франшиз: ' + (e.response?.data?.detail || e.message), 'err')
      setItems([])
    }
  }, [token])

  const loadOwners = useCallback(async () => {
    try {
      const r = await apiFetch('get', '/admin/users?role=franchise_owner', token)
      setOwners(Array.isArray(r.data) ? r.data : [])
    } catch {
      setOwners([])
    }
  }, [token])

  useEffect(() => { loadList(); loadOwners() }, [loadList, loadOwners])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setOwner = (k, v) => setOwnerForm(f => ({ ...f, [k]: v }))

  const onChangeName = (val) => {
    set('name', val)
    if (!slugManual && !editing) set('slug', slugify(val))
  }

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setSlugManual(false)
    setShowForm(true)
    setOwnerCreated(null)
    setShowOwnerForm(false)
    setOwnerForm(EMPTY_OWNER_FORM)
  }

  const openEdit = (it) => {
    setEditing(it)
    setForm({
      name: it.name || '',
      slug: it.slug || '',
      owner_user_id: it.owner_user_id || '',
      contact_email: it.contact_email || '',
      contact_phone: it.contact_phone || '',
      brand_color: it.brand_color || '#7c3aed',
      notes: it.notes || '',
      allowed_region: it.allowed_region || '',
      region_strict: !!it.region_strict,
    })
    setSlugManual(true)
    setShowForm(true)
    setOwnerCreated(null)
    setShowOwnerForm(false)
  }

  const submitOwner = async (e) => {
    e?.preventDefault?.()
    if (!ownerForm.full_name.trim() || !ownerForm.username.trim()) {
      showMsg('Заполните ФИО и логин', 'err'); return
    }
    setSaving(true)
    try {
      const body = {
        full_name: ownerForm.full_name.trim(),
        username: ownerForm.username.trim(),
        role: 'franchise_owner',
      }
      if (ownerForm.email.trim()) body.email = ownerForm.email.trim()
      if (ownerForm.password.trim()) body.password = ownerForm.password.trim()
      const r = await apiFetch('post', '/admin/users', token, body)
      setOwnerCreated({ ...r.data })
      // Авто-выбор только что созданного владельца
      set('owner_user_id', r.data.id)
      await loadOwners()
      setShowOwnerForm(false)
      setOwnerForm(EMPTY_OWNER_FORM)
      showMsg('Владелец создан. Сохраните пароль — он показывается только один раз.')
    } catch (e) {
      showMsg('Ошибка: ' + (e.response?.data?.detail || e.message), 'err')
    }
    setSaving(false)
  }

  const submit = async (e) => {
    e?.preventDefault?.()
    if (!form.name.trim() || !form.slug.trim()) { showMsg('Имя и slug обязательны', 'err'); return }
    if (!form.owner_user_id) { showMsg('Выберите владельца франшизы', 'err'); return }
    setSaving(true)
    try {
      const body = {
        name: form.name.trim(),
        slug: form.slug.trim(),
        owner_user_id: form.owner_user_id,
        contact_email: form.contact_email.trim() || null,
        contact_phone: form.contact_phone.trim() || null,
        brand_color: form.brand_color || null,
        notes: form.notes.trim() || null,
        // Region Lock — пустое значение трактуется бэком как «снять регион»
        allowed_region: form.allowed_region.trim() || '',
        region_strict: !!form.region_strict,
      }
      if (editing) {
        await apiFetch('patch', `/admin/franchises/${editing.id}`, token, body)
        showMsg('Франшиза обновлена')
      } else {
        await apiFetch('post', '/admin/franchises', token, body)
        showMsg('Франшиза создана')
      }
      setShowForm(false)
      await loadList()
    } catch (e) {
      showMsg('Ошибка: ' + (e.response?.data?.detail || e.message), 'err')
    }
    setSaving(false)
  }

  const removeFranchise = async (it) => {
    setSaving(true)
    try {
      await apiFetch('delete', `/admin/franchises/${it.id}`, token)
      setConfirmDelete(null)
      await loadList()
      showMsg('Франшиза удалена. Связанные тенанты сохранены (без франшизы).')
    } catch (e) {
      showMsg('Ошибка: ' + (e.response?.data?.detail || e.message), 'err')
    }
    setSaving(false)
  }

  // ── UI ─────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Франшизы</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Один владелец франшизы → несколько тенантов под общим брендом
          </p>
        </div>
        <button onClick={openCreate}
          className="flex items-center gap-2 bg-violet-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-violet-700 transition">
          <span className="material-symbols-outlined text-base">add_business</span>
          Новая франшиза
        </button>
      </div>

      {msg && (
        <div className={`px-4 py-3 rounded-xl text-sm font-medium ${
          msgType === 'ok'
            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400'
            : 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400'}`}>
          {msg}
        </div>
      )}

      {/* Список карточек */}
      {items === null ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-10 text-center border border-gray-100 dark:border-gray-700">
          <span className="material-symbols-outlined text-5xl text-gray-300 block mb-2"
            style={{ fontVariationSettings: "'FILL' 1" }}>store</span>
          <p className="font-semibold text-gray-600 dark:text-gray-300 mb-1">Нет франшиз</p>
          <p className="text-gray-400 text-sm mb-4">Создайте первую франшизу, чтобы начать</p>
          <button onClick={openCreate}
            className="inline-flex items-center gap-2 bg-violet-600 text-white px-4 py-2 rounded-xl text-sm font-semibold">
            <span className="material-symbols-outlined text-base">add</span>Создать франшизу
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {items.map(it => (
            <div key={it.id}
              className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col gap-3">
              {/* Заголовок */}
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: (it.brand_color || '#7c3aed') + '22' }}>
                  <span className="material-symbols-outlined text-xl"
                    style={{ color: it.brand_color || '#7c3aed', fontVariationSettings: "'FILL' 1" }}>
                    store
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-bold text-gray-900 dark:text-white truncate">{it.name}</p>
                    {!it.is_active && (
                      <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500">
                        Не активна
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 truncate">/{it.slug}</p>
                </div>
                {it.brand_color && (
                  <span className="inline-block w-5 h-5 rounded-full border border-gray-200 dark:border-gray-600 flex-shrink-0"
                    style={{ background: it.brand_color }} />
                )}
              </div>

              {/* Владелец */}
              <div className="flex items-center gap-2 text-sm">
                <span className="material-symbols-outlined text-base text-gray-400">person</span>
                <span className="text-gray-700 dark:text-gray-200 truncate">
                  {it.owner_full_name || <span className="text-gray-400 italic">— владелец не назначен —</span>}
                </span>
              </div>

              {/* Region Lock — разрешённый регион */}
              {it.allowed_region && (
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="material-symbols-outlined text-sm text-violet-500">shield_locked</span>
                  <span className="text-violet-700 dark:text-violet-300 font-medium">{it.allowed_region}</span>
                  {it.region_strict && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
                      STRICT
                    </span>
                  )}
                </div>
              )}

              {/* Контакты */}
              {(it.contact_email || it.contact_phone) && (
                <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                  {it.contact_email && (
                    <div className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-sm">mail</span>
                      <span className="truncate">{it.contact_email}</span>
                    </div>
                  )}
                  {it.contact_phone && (
                    <div className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-sm">call</span>
                      <span>{it.contact_phone}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Метрики */}
              <div className="grid grid-cols-2 gap-2 mt-1">
                <div className="bg-gray-50 dark:bg-gray-900/40 rounded-xl p-3 text-center">
                  <p className="text-xs text-gray-400 mb-1">Тенантов</p>
                  <p className="text-lg font-extrabold text-gray-900 dark:text-white">{it.tenant_count ?? 0}</p>
                </div>
                <div className="bg-gray-50 dark:bg-gray-900/40 rounded-xl p-3 text-center">
                  <p className="text-xs text-gray-400 mb-1">MRR ₽</p>
                  <p className="text-lg font-extrabold text-gray-900 dark:text-white">
                    {Number(it.mrr_sum || 0).toLocaleString('ru')}
                  </p>
                </div>
              </div>

              {/* Действия */}
              <div className="flex gap-2 mt-1">
                <button onClick={() => openEdit(it)}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-violet-50 text-violet-700 dark:bg-violet-900/20 dark:text-violet-300 text-sm font-semibold hover:bg-violet-100 dark:hover:bg-violet-900/30 transition">
                  <span className="material-symbols-outlined text-base">edit</span>Изменить
                </button>
                <button onClick={() => setConfirmDelete(it)}
                  className="flex items-center justify-center gap-1 px-3 py-2 rounded-xl bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 text-sm font-semibold hover:bg-red-100 dark:hover:bg-red-900/30 transition">
                  <span className="material-symbols-outlined text-base">delete</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Модалка создания/редактирования ───────────────────────────────── */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl p-6 w-full sm:max-w-xl shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-800 dark:text-white">
                {editing ? 'Редактировать франшизу' : 'Новая франшиза'}
              </h2>
              <button onClick={() => setShowForm(false)} className="p-1 text-gray-400 hover:text-gray-600">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <form onSubmit={submit} className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  Название <span className="text-red-500">*</span>
                </label>
                <input type="text" value={form.name} onChange={e => onChangeName(e.target.value)}
                  required maxLength={200}
                  className="w-full bg-white dark:bg-gray-700 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm" />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  Slug (для URL) <span className="text-red-500">*</span>
                </label>
                <input type="text" value={form.slug}
                  onChange={e => { setSlugManual(true); set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')) }}
                  required maxLength={50} pattern="^[a-z0-9-]+$"
                  className="w-full bg-white dark:bg-gray-700 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm font-mono" />
              </div>

              {/* Владелец */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
                    Владелец франшизы <span className="text-red-500">*</span>
                  </label>
                  {!showOwnerForm && (
                    <button type="button" onClick={() => setShowOwnerForm(true)}
                      className="text-xs text-violet-600 dark:text-violet-400 font-semibold hover:underline">
                      + Создать нового владельца
                    </button>
                  )}
                </div>
                <select value={form.owner_user_id} onChange={e => set('owner_user_id', e.target.value)}
                  required disabled={showOwnerForm}
                  className="w-full bg-white dark:bg-gray-700 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm">
                  <option value="">— выберите владельца —</option>
                  {owners.map(o => (
                    <option key={o.id} value={o.id}>
                      {o.full_name} {o.username ? `(@${o.username})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Inline форма создания владельца */}
              {showOwnerForm && (
                <div className="bg-violet-50 dark:bg-violet-900/20 rounded-xl p-4 space-y-2 border border-violet-100 dark:border-violet-800">
                  <p className="text-xs font-bold text-violet-700 dark:text-violet-300 uppercase tracking-wider mb-2">
                    Новый владелец
                  </p>
                  <input type="text" placeholder="ФИО *"
                    value={ownerForm.full_name} onChange={e => setOwner('full_name', e.target.value)}
                    className="w-full bg-white dark:bg-gray-700 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm" />
                  <input type="text" placeholder="Логин *"
                    value={ownerForm.username} onChange={e => setOwner('username', e.target.value)}
                    className="w-full bg-white dark:bg-gray-700 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm font-mono" />
                  <input type="email" placeholder="Email"
                    value={ownerForm.email} onChange={e => setOwner('email', e.target.value)}
                    className="w-full bg-white dark:bg-gray-700 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm" />
                  <input type="text" placeholder="Пароль (или оставьте пустым — сгенерируем)"
                    value={ownerForm.password} onChange={e => setOwner('password', e.target.value)}
                    className="w-full bg-white dark:bg-gray-700 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm font-mono" />
                  <div className="flex gap-2">
                    <button type="button" onClick={submitOwner} disabled={saving}
                      className="flex-1 bg-violet-600 text-white py-2 rounded-xl text-sm font-semibold disabled:opacity-50">
                      {saving ? 'Создание…' : 'Создать владельца'}
                    </button>
                    <button type="button" onClick={() => { setShowOwnerForm(false); setOwnerForm(EMPTY_OWNER_FORM) }}
                      className="px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-300">
                      Отмена
                    </button>
                  </div>
                </div>
              )}

              {/* Уведомление о только что созданном владельце */}
              {ownerCreated && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3 text-xs">
                  <p className="font-bold text-amber-800 dark:text-amber-300 mb-1">⚠ Сохраните данные доступа</p>
                  <p className="text-amber-700 dark:text-amber-300/80 font-mono">
                    Логин: {ownerCreated.username}<br />
                    Пароль: {ownerCreated.password}
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Email</label>
                  <input type="email" value={form.contact_email} onChange={e => set('contact_email', e.target.value)}
                    className="w-full bg-white dark:bg-gray-700 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Телефон</label>
                  <input type="text" value={form.contact_phone} onChange={e => set('contact_phone', e.target.value)}
                    className="w-full bg-white dark:bg-gray-700 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Цвет бренда</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={form.brand_color || '#7c3aed'} onChange={e => set('brand_color', e.target.value)}
                    className="w-12 h-10 rounded cursor-pointer border border-gray-200 dark:border-gray-600" />
                  <input type="text" value={form.brand_color} onChange={e => set('brand_color', e.target.value)}
                    className="flex-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm font-mono" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Заметки</label>
                <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3}
                  className="w-full bg-white dark:bg-gray-700 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm resize-none" />
              </div>

              {/* ── Region Lock — географический контроль ─────────────────────── */}
              <div className="rounded-xl border border-violet-200 dark:border-violet-800/40 bg-violet-50/50 dark:bg-violet-900/10 p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-violet-600 dark:text-violet-400 text-base">shield_locked</span>
                  <div>
                    <div className="text-sm font-semibold text-violet-900 dark:text-violet-200">Region Lock</div>
                    <div className="text-[11px] text-violet-700/70 dark:text-violet-300/70">
                      Если заполнено — выход за пределы региона будет фиксироваться в аудите и слать алерт владельцу платформы.
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    Разрешённый регион
                  </label>
                  <input
                    type="text"
                    value={form.allowed_region}
                    onChange={e => set('allowed_region', e.target.value)}
                    placeholder="например: Ingushetia, Чеченская Республика, RU-IN"
                    className="w-full bg-white dark:bg-gray-700 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm"
                  />
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                    Сравнение с geo_region из IP пользователя. Пустое значение — проверки выключены.
                  </div>
                </div>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={!!form.region_strict}
                    onChange={e => set('region_strict', e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    Строгий режим (Phase 2 — блокировать действия вне региона)
                  </span>
                </label>
              </div>

              <div className="flex gap-2 mt-2">
                <button type="submit" disabled={saving}
                  className="flex-1 bg-violet-600 hover:bg-violet-700 text-white py-2.5 rounded-xl font-semibold transition disabled:opacity-50">
                  {saving ? 'Сохранение…' : (editing ? 'Сохранить' : 'Создать франшизу')}
                </button>
                <button type="button" onClick={() => setShowForm(false)}
                  className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300">
                  Отмена
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Модалка подтверждения удаления ───────────────────────────────── */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <span className="material-symbols-outlined text-red-600 dark:text-red-400">warning</span>
              </div>
              <div>
                <p className="font-bold text-gray-900 dark:text-white">Удалить франшизу?</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Действие необратимо</p>
              </div>
            </div>
            <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">
              Франшиза <b>«{confirmDelete.name}»</b> будет удалена. Связанные тенанты ({confirmDelete.tenant_count ?? 0})
              сохранятся, но потеряют связь с франшизой.
            </p>
            <div className="flex gap-2">
              <button onClick={() => removeFranchise(confirmDelete)} disabled={saving}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2.5 rounded-xl font-semibold disabled:opacity-50">
                {saving ? 'Удаление…' : 'Удалить'}
              </button>
              <button onClick={() => setConfirmDelete(null)}
                className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300">
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
