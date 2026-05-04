import { useState, useEffect, useCallback, useMemo } from 'react'
import axios from 'axios'
import { API_BASE } from '../config'

// ─── Константы ────────────────────────────────────────────────────────────────
const DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const DEFAULT_SCHEDULE = Array.from({ length: 7 }, (_, i) => ({
  day_of_week: i,
  is_active: i < 5, // Пн-Пт по умолчанию
  start_time: '09:00',
  end_time: '18:00',
}))
const EMPTY_FORM = {
  full_name: '',
  specialty: '',
  clinic_id: '',
  slot_duration: 30,
  bio: '',
  experience_years: '',
}

// ─── Хелперы ──────────────────────────────────────────────────────────────────
function authH(token) {
  return { Authorization: `Bearer ${token}` }
}

// Преобразование URL фото к абсолютному (через API_BASE)
function resolvePhotoUrl(photo_url) {
  if (!photo_url) return null
  if (/^https?:\/\//i.test(photo_url)) return photo_url
  return API_BASE + photo_url
}

// ─── Компонент: аватар врача (с fallback) ────────────────────────────────────
function DoctorAvatar({ photo_url, name, size = 56 }) {
  const [errored, setErrored] = useState(false)
  const url = resolvePhotoUrl(photo_url)
  const showImg = url && !errored
  const initials = (name || '?').split(' ').map(s => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()

  if (showImg) {
    return (
      <img
        src={url}
        alt={name || 'doctor'}
        onError={() => setErrored(true)}
        style={{
          width: size, height: size, borderRadius: '50%',
          objectFit: 'cover',
          border: '2px solid #fff',
          boxShadow: '0 2px 6px rgba(0,151,167,0.15)',
          flexShrink: 0,
        }}
      />
    )
  }
  return (
    <div
      style={{
        width: size, height: size, borderRadius: '50%',
        background: 'linear-gradient(135deg, #0097A7 0%, #00C4D7 100%)',
        color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 700, fontSize: size * 0.36,
        boxShadow: '0 2px 6px rgba(0,151,167,0.25)',
        flexShrink: 0,
      }}
    >
      {initials || <span className="material-symbols-outlined" style={{ fontSize: size * 0.6 }}>person</span>}
    </div>
  )
}

// ─── Главный компонент ────────────────────────────────────────────────────────
export default function DoctorsSection({ token }) {
  const [doctors, setDoctors] = useState([])
  const [clinics, setClinics] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null) // null | 'new' | doctor object
  const [search, setSearch] = useState('')

  // ── Загрузка списка ────────────────────────────────────────────────────────
  const loadDoctors = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const r = await axios.get(`${API_BASE}/doctors`, { headers: authH(token) })
      setDoctors(Array.isArray(r.data) ? r.data : [])
    } catch (e) {
      setError(e?.response?.data?.detail || 'Не удалось загрузить список врачей')
      setDoctors([])
    }
    setLoading(false)
  }, [token])

  const loadClinics = useCallback(async () => {
    try {
      const r = await axios.get(`${API_BASE}/manager/clinics/`, { headers: authH(token) })
      setClinics(Array.isArray(r.data) ? r.data : [])
    } catch {
      setClinics([])
    }
  }, [token])

  useEffect(() => { loadDoctors(); loadClinics() }, [loadDoctors, loadClinics])

  // ── Удаление (мягкое: is_active=false) ─────────────────────────────────────
  async function deleteDoctor(doctor) {
    if (!confirm(`Удалить врача «${doctor.full_name}»? (он будет деактивирован)`)) return
    try {
      await axios.patch(`${API_BASE}/doctors/${doctor.id}`,
        { is_active: false }, { headers: authH(token) })
      await loadDoctors()
    } catch (e) {
      alert('Ошибка: ' + (e?.response?.data?.detail || e.message))
    }
  }

  // ── Поиск + лукап клиник ───────────────────────────────────────────────────
  const clinicById = useMemo(() => {
    const m = {}
    for (const c of clinics) m[c.id] = c
    return m
  }, [clinics])

  const filtered = useMemo(() => {
    if (!search.trim()) return doctors
    const q = search.toLowerCase()
    return doctors.filter(d =>
      (d.full_name || '').toLowerCase().includes(q) ||
      (d.specialty || '').toLowerCase().includes(q)
    )
  }, [doctors, search])

  // ─── Render ──────────────────────────────────────────────────────────────────
  if (editing !== null) {
    return (
      <DoctorEditor
        token={token}
        clinics={clinics}
        initial={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); loadDoctors() }}
      />
    )
  }

  return (
    <div className="p-4 md:p-6">
      {/* Заголовок */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <span className="material-symbols-outlined" style={{ color: '#0097A7', fontVariationSettings: "'FILL' 1" }}>stethoscope</span>
            Врачи
          </h2>
          <p className="text-sm text-gray-400 mt-0.5">Управление врачами клиник: профиль, фото и расписание</p>
        </div>
        <button
          onClick={() => setEditing('new')}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-white font-semibold shadow-md hover:shadow-lg transition"
          style={{ background: 'linear-gradient(135deg, #0097A7 0%, #00C4D7 100%)' }}
        >
          <span className="material-symbols-outlined text-xl">add</span>
          Добавить врача
        </button>
      </div>

      {/* Поиск */}
      <div className="bg-white rounded-2xl p-3 border border-gray-100 shadow-sm mb-4 flex items-center gap-3">
        <span className="material-symbols-outlined text-gray-400">search</span>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Поиск по ФИО или специальности..."
          className="flex-1 outline-none text-sm bg-transparent"
        />
        <button onClick={loadDoctors} className="text-gray-400 hover:text-gray-600 transition" title="Обновить">
          <span className="material-symbols-outlined text-xl">refresh</span>
        </button>
      </div>

      {/* Сообщение об ошибке */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 text-sm text-red-600">{error}</div>
      )}

      {/* Список */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-[#0097A7] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl p-14 text-center border border-gray-100 shadow-sm">
          <span className="material-symbols-outlined text-6xl text-gray-200 block mb-3">stethoscope</span>
          <p className="text-gray-500 text-sm font-medium mb-1">
            {doctors.length === 0 ? 'Врачей пока нет' : 'Ничего не найдено'}
          </p>
          {doctors.length === 0 && (
            <p className="text-gray-400 text-xs">Нажмите «Добавить врача», чтобы создать первого</p>
          )}
        </div>
      ) : (
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map(doctor => (
            <div
              key={doctor.id}
              className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm hover:shadow-md transition"
            >
              <div className="flex items-start gap-3 mb-3">
                <DoctorAvatar photo_url={doctor.photo_url} name={doctor.full_name} size={56} />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-gray-800 text-sm leading-tight truncate">
                    {doctor.full_name}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5 truncate">
                    {doctor.specialty || <span className="italic text-gray-300">без специальности</span>}
                  </div>
                  <div className="text-xs text-gray-400 mt-1 flex items-center gap-1 truncate">
                    <span className="material-symbols-outlined" style={{ fontSize: 13 }}>location_on</span>
                    {clinicById[doctor.clinic_id]?.name || '—'}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-400 mb-3 flex-wrap">
                <span className="flex items-center gap-1 bg-gray-50 px-2 py-1 rounded-lg">
                  <span className="material-symbols-outlined" style={{ fontSize: 13 }}>schedule</span>
                  {doctor.slot_duration || 30} мин
                </span>
                {typeof doctor.experience_years === 'number' && doctor.experience_years > 0 && (
                  <span className="flex items-center gap-1 bg-gray-50 px-2 py-1 rounded-lg">
                    <span className="material-symbols-outlined" style={{ fontSize: 13 }}>workspace_premium</span>
                    {doctor.experience_years} лет
                  </span>
                )}
                {doctor.is_active === false && (
                  <span className="bg-red-50 text-red-600 px-2 py-1 rounded-lg">Неактивен</span>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setEditing(doctor)}
                  className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 bg-[#E0F7FA] text-[#0097A7] rounded-lg text-xs font-semibold hover:bg-[#B2EBF2] transition"
                >
                  <span className="material-symbols-outlined text-base">edit</span>
                  Редактировать
                </button>
                <button
                  onClick={() => deleteDoctor(doctor)}
                  className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-semibold hover:bg-red-100 transition"
                  title="Удалить"
                >
                  <span className="material-symbols-outlined text-base">delete</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Подкомпонент: форма создания/редактирования ───────────────────────────────
function DoctorEditor({ token, clinics, initial, onClose, onSaved }) {
  const isEdit = !!initial
  const [form, setForm] = useState(initial ? {
    full_name: initial.full_name || '',
    specialty: initial.specialty || '',
    clinic_id: initial.clinic_id || '',
    slot_duration: initial.slot_duration || 30,
    bio: initial.bio || '',
    experience_years: initial.experience_years ?? '',
  } : { ...EMPTY_FORM })

  const [photoFile, setPhotoFile] = useState(null) // File object для нового фото
  const [photoPreview, setPhotoPreview] = useState(null) // dataURL
  const [photoUrl, setPhotoUrl] = useState(initial?.photo_url || null) // текущее URL с сервера
  const [doctorId, setDoctorId] = useState(initial?.id || null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  // Расписание (массив 7 дней)
  const [schedule, setSchedule] = useState(DEFAULT_SCHEDULE)
  const [scheduleLoading, setScheduleLoading] = useState(false)
  const [scheduleSaving, setScheduleSaving] = useState(false)
  const [scheduleMsg, setScheduleMsg] = useState('')

  // Загрузить расписание (только при редактировании существующего)
  useEffect(() => {
    if (!doctorId) return
    setScheduleLoading(true)
    axios.get(`${API_BASE}/doctors/${doctorId}/schedule`, { headers: authH(token) })
      .then(r => {
        if (Array.isArray(r.data) && r.data.length === 7) {
          setSchedule(r.data.map(d => ({
            day_of_week: d.day_of_week,
            is_active: !!d.is_active,
            start_time: d.start_time || '09:00',
            end_time: d.end_time || '18:00',
          })))
        }
      })
      .catch(() => { /* нет расписания — оставляем дефолт */ })
      .finally(() => setScheduleLoading(false))
  }, [doctorId, token])

  // ── Хендлеры ───────────────────────────────────────────────────────────────
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  function onPickPhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      alert('Размер файла не должен превышать 5 МБ')
      return
    }
    if (!/^image\/(jpeg|jpg|png|webp)$/i.test(file.type)) {
      alert('Только JPEG, PNG или WEBP')
      return
    }
    setPhotoFile(file)
    const reader = new FileReader()
    reader.onload = () => setPhotoPreview(reader.result)
    reader.readAsDataURL(file)
  }

  async function deletePhoto() {
    if (!doctorId) {
      // ещё не сохранён — просто очищаем превью
      setPhotoFile(null); setPhotoPreview(null); setPhotoUrl(null)
      return
    }
    if (!confirm('Удалить фото врача?')) return
    try {
      await axios.delete(`${API_BASE}/doctors/${doctorId}/photo`, { headers: authH(token) })
      setPhotoFile(null); setPhotoPreview(null); setPhotoUrl(null)
      setMsg('Фото удалено')
      setTimeout(() => setMsg(''), 2500)
    } catch (e) {
      alert('Ошибка: ' + (e?.response?.data?.detail || e.message))
    }
  }

  async function saveDoctor() {
    setError('')
    setMsg('')
    if (!form.full_name.trim()) { setError('Введите ФИО'); return }
    if (!form.clinic_id) { setError('Выберите клинику'); return }

    setSaving(true)
    try {
      // Готовим payload (experience_years → number или null)
      const payload = {
        full_name: form.full_name.trim(),
        specialty: form.specialty.trim() || null,
        clinic_id: form.clinic_id,
        slot_duration: Number(form.slot_duration) || 30,
        bio: form.bio.trim() || null,
        experience_years: form.experience_years === '' ? null : Number(form.experience_years),
      }
      let savedId = doctorId
      if (isEdit && doctorId) {
        await axios.patch(`${API_BASE}/doctors/${doctorId}`, payload, { headers: authH(token) })
      } else {
        const r = await axios.post(`${API_BASE}/doctors`, payload, { headers: authH(token) })
        savedId = r.data?.id
        setDoctorId(savedId)
      }

      // Если выбрано новое фото — загружаем
      if (photoFile && savedId) {
        const fd = new FormData()
        fd.append('file', photoFile)
        try {
          const r = await axios.post(
            `${API_BASE}/doctors/${savedId}/photo`,
            fd,
            { headers: { ...authH(token), 'Content-Type': 'multipart/form-data' } },
          )
          setPhotoUrl(r.data?.photo_url || null)
          setPhotoFile(null)
          setPhotoPreview(null)
        } catch (e) {
          setError('Врач сохранён, но фото загрузить не удалось: ' + (e?.response?.data?.detail || e.message))
          setSaving(false)
          return
        }
      }

      setMsg(isEdit ? 'Сохранено' : 'Врач создан')
      setTimeout(() => onSaved(), 800)
    } catch (e) {
      setError(e?.response?.data?.detail || 'Не удалось сохранить')
    }
    setSaving(false)
  }

  // ── Расписание ─────────────────────────────────────────────────────────────
  function setDay(i, patch) {
    setSchedule(prev => prev.map((d, idx) => idx === i ? { ...d, ...patch } : d))
  }

  async function saveSchedule() {
    if (!doctorId) {
      alert('Сначала сохраните врача')
      return
    }
    setScheduleSaving(true)
    setScheduleMsg('')
    try {
      // Бэкенд ожидает start_time/end_time как time-объект или ISO HH:MM:SS
      const payload = schedule.map(d => ({
        day_of_week: d.day_of_week,
        start_time: d.start_time.length === 5 ? d.start_time + ':00' : d.start_time,
        end_time: d.end_time.length === 5 ? d.end_time + ':00' : d.end_time,
        is_active: d.is_active,
      }))
      await axios.put(`${API_BASE}/doctors/${doctorId}/schedule`, payload, { headers: authH(token) })
      setScheduleMsg('Расписание сохранено')
      setTimeout(() => setScheduleMsg(''), 2500)
    } catch (e) {
      setScheduleMsg('Ошибка: ' + (e?.response?.data?.detail || e.message))
    }
    setScheduleSaving(false)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const previewUrl = photoPreview || resolvePhotoUrl(photoUrl)

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onClose}
          className="w-10 h-10 rounded-xl bg-white border border-gray-200 hover:bg-gray-50 flex items-center justify-center transition"
          title="Назад">
          <span className="material-symbols-outlined text-gray-600">arrow_back</span>
        </button>
        <div className="flex-1">
          <h2 className="text-xl font-bold text-gray-800">
            {isEdit ? 'Редактирование врача' : 'Новый врач'}
          </h2>
          <p className="text-sm text-gray-400 mt-0.5">
            {isEdit ? form.full_name || initial?.full_name : 'Заполните основные данные'}
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 text-sm text-red-600">{error}</div>
      )}
      {msg && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 mb-4 text-sm text-emerald-700">{msg}</div>
      )}

      {/* Карточка: основные данные */}
      <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm mb-4">
        <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <span className="material-symbols-outlined" style={{ color: '#0097A7' }}>badge</span>
          Профиль
        </h3>

        <div className="grid md:grid-cols-[auto_1fr] gap-5">
          {/* Колонка: фото */}
          <div className="flex flex-col items-center gap-3">
            <div style={{
              width: 140, height: 140, borderRadius: '50%',
              background: previewUrl ? '#f3f4f6' : 'linear-gradient(135deg, #0097A7 0%, #00C4D7 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,151,167,0.18)',
            }}>
              {previewUrl ? (
                <img src={previewUrl} alt="preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <span className="material-symbols-outlined" style={{ fontSize: 70, color: '#fff' }}>person</span>
              )}
            </div>
            <label className="cursor-pointer flex items-center gap-1.5 px-3 py-1.5 bg-[#E0F7FA] text-[#0097A7] rounded-lg text-xs font-semibold hover:bg-[#B2EBF2] transition">
              <span className="material-symbols-outlined text-base">upload</span>
              {previewUrl ? 'Заменить' : 'Загрузить фото'}
              <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={onPickPhoto} />
            </label>
            {previewUrl && (
              <button onClick={deletePhoto}
                className="text-xs text-red-500 hover:text-red-700 transition flex items-center gap-1">
                <span className="material-symbols-outlined text-base">delete</span>
                Удалить фото
              </button>
            )}
            <p className="text-[11px] text-gray-400 text-center max-w-[160px]">
              JPEG, PNG, WEBP до 5 МБ
            </p>
          </div>

          {/* Колонка: поля */}
          <div className="grid gap-3">
            <Field label="ФИО *">
              <input type="text" value={form.full_name} onChange={e => set('full_name', e.target.value)}
                placeholder="Иванов Иван Иванович" style={inputStyle} />
            </Field>
            <Field label="Специальность">
              <input type="text" value={form.specialty} onChange={e => set('specialty', e.target.value)}
                placeholder="Терапевт, Кардиолог..." style={inputStyle} />
            </Field>
            <Field label="Клиника *">
              <select value={form.clinic_id} onChange={e => set('clinic_id', e.target.value)} style={inputStyle}>
                <option value="">— выберите клинику —</option>
                {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Длительность приёма, мин">
                <input type="number" min="5" max="240" step="5"
                  value={form.slot_duration}
                  onChange={e => set('slot_duration', e.target.value)} style={inputStyle} />
              </Field>
              <Field label="Опыт, лет">
                <input type="number" min="0" max="80"
                  value={form.experience_years}
                  onChange={e => set('experience_years', e.target.value)}
                  placeholder="—" style={inputStyle} />
              </Field>
            </div>
            <Field label="Биография">
              <textarea value={form.bio} onChange={e => set('bio', e.target.value)}
                rows={3} style={{ ...inputStyle, resize: 'vertical', minHeight: 70 }}
                placeholder="Образование, достижения, специализация..." />
            </Field>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-gray-100">
          <button onClick={onClose} disabled={saving}
            className="px-5 py-2 rounded-xl bg-gray-100 text-gray-700 font-medium hover:bg-gray-200 transition disabled:opacity-50">
            Отмена
          </button>
          <button onClick={saveDoctor} disabled={saving}
            className="px-6 py-2 rounded-xl text-white font-semibold shadow-md hover:shadow-lg transition disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #0097A7 0%, #00C4D7 100%)' }}>
            {saving ? 'Сохранение...' : (isEdit ? 'Сохранить' : 'Создать')}
          </button>
        </div>
      </div>

      {/* Карточка: расписание (только при редактировании) */}
      {doctorId && (
        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h3 className="font-semibold text-gray-800 flex items-center gap-2">
              <span className="material-symbols-outlined" style={{ color: '#0097A7' }}>calendar_month</span>
              Шаблонное расписание
            </h3>
            {scheduleMsg && (
              <span className={`text-xs px-2 py-1 rounded-lg ${scheduleMsg.startsWith('Ошибка') ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700'}`}>
                {scheduleMsg}
              </span>
            )}
          </div>

          {scheduleLoading ? (
            <div className="text-center text-sm text-gray-400 py-6">Загрузка расписания...</div>
          ) : (
            <div className="space-y-2">
              {schedule.map((day, i) => (
                <div key={day.day_of_week}
                  className={`flex items-center gap-3 p-3 rounded-xl transition ${day.is_active ? 'bg-[#F0FDFE]' : 'bg-gray-50'}`}>
                  <label className="flex items-center gap-2 cursor-pointer min-w-[110px]">
                    <input type="checkbox" checked={day.is_active}
                      onChange={e => setDay(i, { is_active: e.target.checked })}
                      style={{ accentColor: '#0097A7', width: 18, height: 18 }} />
                    <span className={`text-sm font-medium ${day.is_active ? 'text-gray-800' : 'text-gray-400'}`}>
                      {DAY_NAMES[day.day_of_week]}
                    </span>
                  </label>
                  <div className="flex items-center gap-2 flex-1 flex-wrap">
                    <input type="time" value={day.start_time}
                      disabled={!day.is_active}
                      onChange={e => setDay(i, { start_time: e.target.value })}
                      style={{ ...inputStyle, padding: '6px 10px', maxWidth: 120 }} />
                    <span className="text-gray-400">—</span>
                    <input type="time" value={day.end_time}
                      disabled={!day.is_active}
                      onChange={e => setDay(i, { end_time: e.target.value })}
                      style={{ ...inputStyle, padding: '6px 10px', maxWidth: 120 }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end mt-4 pt-4 border-t border-gray-100">
            <button onClick={saveSchedule} disabled={scheduleSaving || scheduleLoading}
              className="px-6 py-2 rounded-xl text-white font-semibold shadow-md hover:shadow-lg transition disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #0097A7 0%, #00C4D7 100%)' }}>
              {scheduleSaving ? 'Сохранение...' : 'Сохранить расписание'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Мини-компоненты UI ───────────────────────────────────────────────────────
function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-gray-600">{label}</span>
      {children}
    </label>
  )
}

const inputStyle = {
  padding: '8px 12px',
  border: '1px solid #e5e7eb',
  borderRadius: 10,
  fontSize: 14,
  outline: 'none',
  background: '#fff',
  width: '100%',
  boxSizing: 'border-box',
}
