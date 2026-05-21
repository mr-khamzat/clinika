/**
 * ========================================
 * БЛОК: <ProfileModal> — личный кабинет сотрудника
 * ========================================
 * Любой сотрудник (doctor/reg/nurse/manager/recruiter/...) может через эту
 * модалку поменять свой телефон, email, пароль и загрузить аватарку.
 *
 * Поля только для чтения (показываются с пометкой «(только администратор
 * может изменить)»): full_name, username, role, clinic_name.
 *
 * API:
 *   GET    /profile/me              — текущий профиль
 *   PATCH  /profile/me              — телефон / email / пароль
 *   POST   /profile/me/avatar       — multipart upload
 *   DELETE /profile/me/avatar       — удалить
 *
 * NB: компонент рендерится из кабинетов, которые живут вне BrowserRouter
 * (AdminRoot), поэтому здесь НЕ используются useNavigate/useLocation/useParams.
 * ========================================
 */
import { useEffect, useRef, useState } from 'react'
import api from '../api'
import { Avatar, Button, Modal, Tabs, useToast } from '../design'

// ── Названия ролей на русском (для read-only поля) ─────────────────────────
const ROLE_LABEL = {
  super_admin: 'Супер-администратор',
  franchise_owner: 'Владелец франшизы',
  manager: 'Системный администратор',
  doctor: 'Врач',
  reg: 'Регистратор',
  nurse: 'Медсестра',
  recruiter: 'Рекрутер',
  partner_doctor: 'Привлечённый врач',
  visiting_doctor: 'Приезжий врач',
  acquisition_manager: 'Менеджер привлечения',
  patient: 'Пациент',
  director: 'Директор сети',
  deputy_director: 'Зам директора',
  accountant: 'Бухгалтер',
  lab_ct: 'Лаборант КТ',
  lab_xray: 'Лаборант (рентген)',
}

// ── Стили инпутов / лейблов ────────────────────────────────────────────────
const inputStyle = {
  width: '100%',
  padding: '9px 12px',
  borderRadius: 9,
  border: '1px solid var(--border)',
  background: 'var(--bg-1)',
  color: 'var(--fg)',
  fontSize: 13,
  outline: 'none',
}
const labelStyle = {
  display: 'block',
  fontSize: 11.5,
  fontWeight: 600,
  color: 'var(--fg-3)',
  marginBottom: 5,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
}
const hintStyle = {
  fontSize: 11,
  color: 'var(--fg-4)',
  marginTop: 4,
}
const readonlyStyle = {
  ...inputStyle,
  background: 'var(--bg-2)',
  color: 'var(--fg-3)',
  cursor: 'not-allowed',
}

export default function ProfileModal({ open, onClose, onSaved }) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState('personal')
  const [profile, setProfile] = useState(null)
  // Локальная форма (не мутируем profile до Save)
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [curPwd, setCurPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [newPwd2, setNewPwd2] = useState('')
  // Аватар
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef(null)

  // ── Загрузка профиля при открытии ───────────────────────────────────────
  useEffect(() => {
    if (!open) return
    setTab('personal')
    setCurPwd('')
    setNewPwd('')
    setNewPwd2('')
    setLoading(true)
    api
      .get('/profile/me')
      .then((r) => {
        setProfile(r.data)
        setPhone(r.data.phone_number || '')
        setEmail(r.data.email || '')
      })
      .catch((e) => {
        toast(e?.response?.data?.detail || 'Не удалось загрузить профиль', 'error')
      })
      .finally(() => setLoading(false))
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Сохранить личные данные (телефон/email) ─────────────────────────────
  const savePersonal = async () => {
    setSaving(true)
    try {
      const payload = {}
      if ((phone || '') !== (profile.phone_number || '')) payload.phone_number = phone || ''
      if ((email || '') !== (profile.email || '')) payload.email = email || ''
      if (Object.keys(payload).length === 0) {
        toast('Нет изменений', 'info')
        return
      }
      const r = await api.patch('/profile/me', payload)
      setProfile(r.data)
      setPhone(r.data.phone_number || '')
      setEmail(r.data.email || '')
      toast('Сохранено', 'success')
      onSaved && onSaved(r.data)
    } catch (e) {
      toast(e?.response?.data?.detail || 'Не удалось сохранить', 'error')
    } finally {
      setSaving(false)
    }
  }

  // ── Сменить пароль ──────────────────────────────────────────────────────
  const changePassword = async () => {
    if (!curPwd || !newPwd) {
      toast('Введите текущий и новый пароль', 'error')
      return
    }
    if (newPwd.length < 6) {
      toast('Новый пароль должен быть не короче 6 символов', 'error')
      return
    }
    if (newPwd !== newPwd2) {
      toast('Пароли не совпадают', 'error')
      return
    }
    setSaving(true)
    try {
      await api.patch('/profile/me', {
        current_password: curPwd,
        new_password: newPwd,
      })
      setCurPwd('')
      setNewPwd('')
      setNewPwd2('')
      toast('Пароль изменён. Рекомендуем войти заново.', 'success')
    } catch (e) {
      toast(e?.response?.data?.detail || 'Не удалось изменить пароль', 'error')
    } finally {
      setSaving(false)
    }
  }

  // ── Загрузить аватар ────────────────────────────────────────────────────
  const onPickFile = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > 5 * 1024 * 1024) {
      toast('Файл больше 5 МБ', 'error')
      return
    }
    setUploading(true)
    const fd = new FormData()
    fd.append('file', f)
    api
      .post('/profile/me/avatar', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => {
        setProfile((p) => ({ ...p, avatar_url: r.data.avatar_url }))
        toast('Аватар обновлён', 'success')
        onSaved && onSaved({ ...profile, avatar_url: r.data.avatar_url })
      })
      .catch((err) =>
        toast(err?.response?.data?.detail || 'Не удалось загрузить', 'error')
      )
      .finally(() => {
        setUploading(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
      })
  }

  // ── Удалить аватар ──────────────────────────────────────────────────────
  const deleteAvatar = async () => {
    if (!profile?.avatar_url) return
    setUploading(true)
    try {
      await api.delete('/profile/me/avatar')
      setProfile((p) => ({ ...p, avatar_url: null }))
      toast('Аватар удалён', 'success')
      onSaved && onSaved({ ...profile, avatar_url: null })
    } catch (e) {
      toast(e?.response?.data?.detail || 'Не удалось удалить', 'error')
    } finally {
      setUploading(false)
    }
  }

  // ── Префиксим относительный avatar_url через API_BASE на отображении ────
  const apiBase = api.defaults.baseURL || ''
  const avatarSrc =
    profile?.avatar_url
      ? profile.avatar_url.startsWith('http')
        ? profile.avatar_url
        : `${apiBase}${profile.avatar_url}`
      : null

  const roleLabel = profile ? ROLE_LABEL[profile.role] || profile.role : ''

  return (
    <Modal open={open} onClose={onClose} title="Мой профиль" size="md">
      {loading || !profile ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--fg-3)' }}>
          Загрузка…
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Шапка: аватар + ФИО / роль */}
          <div className="flex items-center gap-3" style={{ paddingBottom: 8 }}>
            <Avatar src={avatarSrc} name={profile.full_name} size="xl" />
            <div className="min-w-0">
              <div
                className="font-semibold truncate"
                style={{ fontSize: 16, color: 'var(--fg)' }}
              >
                {profile.full_name}
              </div>
              <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>
                {roleLabel}
                {profile.clinic_name ? ` · ${profile.clinic_name}` : ''}
              </div>
            </div>
          </div>

          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { id: 'personal', label: 'Личные данные' },
              { id: 'password', label: 'Пароль' },
              { id: 'avatar', label: 'Аватар' },
            ]}
          />

          {/* ── Tab: личные данные ───────────────────────────────────── */}
          {tab === 'personal' && (
            <div className="flex flex-col gap-3">
              <div>
                <label style={labelStyle}>ФИО</label>
                <input
                  type="text"
                  value={profile.full_name || ''}
                  disabled
                  style={readonlyStyle}
                />
                <div style={hintStyle}>
                  Только администратор может изменить
                </div>
              </div>
              <div>
                <label style={labelStyle}>Логин</label>
                <input
                  type="text"
                  value={profile.username || ''}
                  disabled
                  style={readonlyStyle}
                />
                <div style={hintStyle}>
                  Только администратор может изменить
                </div>
              </div>
              <div>
                <label style={labelStyle}>Роль</label>
                <input type="text" value={roleLabel} disabled style={readonlyStyle} />
              </div>
              {profile.clinic_name && (
                <div>
                  <label style={labelStyle}>Клиника</label>
                  <input
                    type="text"
                    value={profile.clinic_name}
                    disabled
                    style={readonlyStyle}
                  />
                </div>
              )}
              <div>
                <label style={labelStyle}>Телефон</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+79991234567"
                  autoComplete="tel"
                  style={inputStyle}
                />
                <div style={hintStyle}>Только цифры и опциональный «+», 10-15 знаков</div>
              </div>
              <div>
                <label style={labelStyle}>Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="user@example.com"
                  autoComplete="email"
                  style={inputStyle}
                />
              </div>
              <div className="flex justify-end gap-2" style={{ marginTop: 6 }}>
                <Button variant="ghost" onClick={onClose}>
                  Закрыть
                </Button>
                <Button onClick={savePersonal} disabled={saving}>
                  {saving ? 'Сохранение…' : 'Сохранить'}
                </Button>
              </div>
            </div>
          )}

          {/* ── Tab: пароль ──────────────────────────────────────────── */}
          {tab === 'password' && (
            <div className="flex flex-col gap-3">
              <div>
                <label style={labelStyle}>Текущий пароль</label>
                <input
                  type="password"
                  value={curPwd}
                  onChange={(e) => setCurPwd(e.target.value)}
                  autoComplete="current-password"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Новый пароль</label>
                <input
                  type="password"
                  value={newPwd}
                  onChange={(e) => setNewPwd(e.target.value)}
                  autoComplete="new-password"
                  style={inputStyle}
                />
                <div style={hintStyle}>Не короче 6 символов</div>
              </div>
              <div>
                <label style={labelStyle}>Повторите новый пароль</label>
                <input
                  type="password"
                  value={newPwd2}
                  onChange={(e) => setNewPwd2(e.target.value)}
                  autoComplete="new-password"
                  style={inputStyle}
                />
              </div>
              <div className="flex justify-end gap-2" style={{ marginTop: 6 }}>
                <Button variant="ghost" onClick={onClose}>
                  Закрыть
                </Button>
                <Button onClick={changePassword} disabled={saving}>
                  {saving ? 'Сохранение…' : 'Изменить пароль'}
                </Button>
              </div>
            </div>
          )}

          {/* ── Tab: аватар ──────────────────────────────────────────── */}
          {tab === 'avatar' && (
            <div className="flex flex-col gap-3">
              <div
                className="flex items-center gap-4"
                style={{
                  padding: 14,
                  background: 'var(--bg-1)',
                  borderRadius: 10,
                  border: '1px solid var(--border)',
                }}
              >
                <Avatar src={avatarSrc} name={profile.full_name} size="xl" />
                <div className="min-w-0 flex-1">
                  <div style={{ fontSize: 13, color: 'var(--fg)', marginBottom: 4 }}>
                    {profile.avatar_url ? 'Аватар загружен' : 'Аватар не загружен'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                    Поддерживаются JPEG, PNG, WEBP. До 5 МБ. Большие изображения
                    будут уменьшены до 512×512.
                  </div>
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={onPickFile}
                style={{ display: 'none' }}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? 'Загрузка…' : profile.avatar_url ? 'Заменить' : 'Загрузить'}
                </Button>
                {profile.avatar_url && (
                  <Button
                    variant="secondary"
                    onClick={deleteAvatar}
                    disabled={uploading}
                  >
                    Удалить
                  </Button>
                )}
                <div className="flex-1" />
                <Button variant="ghost" onClick={onClose}>
                  Закрыть
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
