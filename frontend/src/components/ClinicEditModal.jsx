/**
 * ========================================
 * БЛОК: <ClinicEditModal>
 * ========================================
 * Модалка редактирования одной клиники сети из кабинета franchise_owner.
 *
 * Содержит две вкладки:
 *   • «Реквизиты»     — name, address, phone + контракт (royalty_percent /
 *                        bonus_per_referral / contract_type)
 *   • «Руководитель»  — primary manager (full_name/username/phone) +
 *                        кнопка [🔑 Сгенерировать новый пароль] +
 *                        форма «Назначить руководителя» если manager-а нет
 *
 * КРИТИЧЕСКОЕ правило (см. backend/franchise_owner_clinics.py):
 *   Смена руководителя — это РЕДАКТИРОВАНИЕ User, не удаление-создание.
 *   user_id сохраняется, все связи (appointments/referrals/bonuses/audit)
 *   остаются целыми.
 *
 * Props:
 *   open      — boolean
 *   onClose   — () => void
 *   tenantId  — uuid строкой (selected clinic)
 *   onSaved   — () => void  (вызывается после успешного PATCH/POST,
 *                            родитель должен перегрузить список)
 * ========================================
 */
import { useEffect, useState } from 'react'
import api from '../api'
import {
  Modal,
  Button,
  Tabs,
  Chip,
  useToast,
  useConfirm,
} from '../design'

// ── Опции типа контракта ────────────────────────────────────────────────────
const CONTRACT_TYPES = [
  { value: '',             label: '— не задан —' },
  { value: 'royalty',      label: 'Royalty (% с выручки)' },
  { value: 'per_referral', label: 'Per referral (₽ за направление)' },
  { value: 'hybrid',       label: 'Hybrid (% + ₽)' },
]

// ── Внутренние формовые поля (унифицированы с TenantsSection) ───────────────
function FormField({ label, hint, children }) {
  return (
    <div>
      <label className="block mb-1.5 font-medium" style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>
        {label}
      </label>
      {children}
      {hint && (
        <div className="mt-1" style={{ fontSize: 11, color: 'var(--fg-4)' }}>{hint}</div>
      )}
    </div>
  )
}

function FormInput({ mono, ...rest }) {
  return (
    <input
      {...rest}
      className="w-full"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '9px 12px',
        fontSize: 13,
        color: 'var(--fg)',
        fontFamily: mono ? 'ui-monospace, SF Mono, Menlo, Consolas, monospace' : 'inherit',
        outline: 'none',
      }}
      onFocus={(e) => { e.target.style.borderColor = 'var(--accent)' }}
      onBlur={(e) => { e.target.style.borderColor = 'var(--border)' }}
    />
  )
}

function FormSelect({ children, ...rest }) {
  return (
    <select
      {...rest}
      className="w-full"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '9px 12px',
        fontSize: 13,
        color: 'var(--fg)',
        outline: 'none',
      }}
    >
      {children}
    </select>
  )
}

// ── Иконка material через span ──────────────────────────────────────────────
function Icon({ name, size = 18, fill = 0, style = {} }) {
  return (
    <span
      className="material-symbols-outlined"
      style={{
        fontSize: size,
        fontVariationSettings: `'FILL' ${fill}, 'wght' 500, 'opsz' 24`,
        lineHeight: 1,
        display: 'inline-flex',
        ...style,
      }}
    >{name}</span>
  )
}

// ============================================================================
// БЛОК: <PasswordRevealCard> — показывает plaintext пароль 1 раз
// ============================================================================
function PasswordRevealCard({ username, password, warning, onClose }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* no-op */
    }
  }
  return (
    <div
      className="rounded-xl p-3 flex flex-col gap-2"
      style={{ background: 'var(--warn-soft)', border: '1px solid var(--warn-soft)', fontSize: 12 }}
    >
      <div className="font-bold" style={{ color: 'var(--warn)' }}>
        ⚠ {warning || 'Сохраните пароль сейчас — он больше не будет показан'}
      </div>
      {username && (
        <div className="font-mono" style={{ color: 'var(--warn)' }}>
          Логин: {username}
        </div>
      )}
      <div className="flex items-center gap-2">
        <code
          className="font-mono flex-1"
          style={{
            background: 'var(--surface)',
            color: 'var(--fg)',
            padding: '8px 10px',
            borderRadius: 8,
            fontSize: 13,
            border: '1px solid var(--border)',
            wordBreak: 'break-all',
          }}
        >{password}</code>
        <Button size="sm" variant="secondary" onClick={copy}>
          {copied ? 'Скопировано!' : 'Скопировать'}
        </Button>
      </div>
      {onClose && (
        <div className="flex justify-end mt-1">
          <Button size="sm" variant="ghost" onClick={onClose}>Скрыть</Button>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// БЛОК: главный компонент модалки
// ============================================================================
export default function ClinicEditModal({ open, onClose, tenantId, onSaved }) {
  // useToast возвращает { toast, dismiss }; toast(message, level)
  const toastCtx = useToast?.()
  const toast = toastCtx?.toast
  const { confirm, ConfirmHost } = useConfirm()
  const [tab, setTab] = useState('details')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [data, setData] = useState(null)            // ответ GET /clinics/{tenantId}
  const [details, setDetails] = useState({          // вкладка «Реквизиты»
    name: '',
    address: '',
    phone: '',
    contract_type: '',
    royalty_percent: '',
    bonus_per_referral: '',
  })
  const [mgrEditing, setMgrEditing] = useState(false)
  const [mgrForm, setMgrForm] = useState({          // вкладка «Руководитель» — редактирование
    full_name: '',
    username: '',
    phone: '',
  })
  const [createMgr, setCreateMgr] = useState({      // создание нового manager-а
    full_name: '',
    username: '',
    phone: '',
    password: '',
  })
  const [createMode, setCreateMode] = useState(false)
  const [revealedPassword, setRevealedPassword] = useState(null)  // { username, password, warning }

  // ── Загрузка данных при открытии ─────────────────────────────────────────
  useEffect(() => {
    if (!open || !tenantId) return
    setTab('details')
    setMgrEditing(false)
    setCreateMode(false)
    setRevealedPassword(null)
    setLoading(true)
    api.get(`/franchise-owner/clinics/${tenantId}`)
      .then(r => {
        const d = r.data
        setData(d)
        setDetails({
          name: d.name || d.clinic_name || '',
          address: d.address || '',
          phone: d.phone || '',
          contract_type: d.contract_type || '',
          royalty_percent: d.royalty_percent != null ? String(d.royalty_percent) : '',
          bonus_per_referral: d.bonus_per_referral != null ? String(d.bonus_per_referral) : '',
        })
        if (d.manager) {
          setMgrForm({
            full_name: d.manager.full_name || '',
            username: d.manager.username || '',
            phone: d.manager.phone || '',
          })
        }
      })
      .catch(err => {
        toast?.('Ошибка загрузки: ' + (err.response?.data?.detail || err.message), 'error')
      })
      .finally(() => setLoading(false))
  }, [open, tenantId])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Сохранить реквизиты + контракт ───────────────────────────────────────
  const saveDetails = async (e) => {
    e?.preventDefault?.()
    if (!details.name.trim()) {
      toast?.('Заполните название клиники', 'error')
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: details.name.trim(),
        address: details.address.trim() || null,
        phone: details.phone.trim() || null,
        contract_type: details.contract_type || null,
      }
      if (details.royalty_percent !== '') {
        payload.royalty_percent = Number(details.royalty_percent)
      }
      if (details.bonus_per_referral !== '') {
        payload.bonus_per_referral = Number(details.bonus_per_referral)
      }
      const r = await api.patch(`/franchise-owner/clinics/${tenantId}`, payload)
      setData(r.data)
      toast?.('Реквизиты сохранены', 'success')
      onSaved?.()
    } catch (err) {
      toast?.('Ошибка: ' + (err.response?.data?.detail || err.message), 'error')
    }
    setSaving(false)
  }

  // ── Сохранить данные руководителя (PATCH) ────────────────────────────────
  const saveManager = async (e) => {
    e?.preventDefault?.()
    if (!mgrForm.full_name.trim() || !mgrForm.username.trim()) {
      toast?.('Заполните ФИО и логин', 'error')
      return
    }
    setSaving(true)
    try {
      await api.patch(`/franchise-owner/clinics/${tenantId}/manager`, {
        full_name: mgrForm.full_name.trim(),
        username: mgrForm.username.trim(),
        phone: mgrForm.phone.trim() || null,
      })
      // Перезагружаем актуальные данные
      const r = await api.get(`/franchise-owner/clinics/${tenantId}`)
      setData(r.data)
      setMgrEditing(false)
      toast?.('Данные руководителя обновлены', 'success')
      onSaved?.()
    } catch (err) {
      toast?.('Ошибка: ' + (err.response?.data?.detail || err.message), 'error')
    }
    setSaving(false)
  }

  // ── Создать первого руководителя (POST) ──────────────────────────────────
  const submitCreateManager = async (e) => {
    e?.preventDefault?.()
    if (!createMgr.full_name.trim() || !createMgr.username.trim()) {
      toast?.('Заполните ФИО и логин', 'error')
      return
    }
    setSaving(true)
    try {
      const r = await api.post(`/franchise-owner/clinics/${tenantId}/manager`, {
        full_name: createMgr.full_name.trim(),
        username: createMgr.username.trim(),
        phone: createMgr.phone.trim() || null,
        password: createMgr.password.trim() || null,
      })
      setRevealedPassword({
        username: r.data.username,
        password: r.data.password,
        warning: r.data.warning,
      })
      // Перезагружаем
      const r2 = await api.get(`/franchise-owner/clinics/${tenantId}`)
      setData(r2.data)
      if (r2.data?.manager) {
        setMgrForm({
          full_name: r2.data.manager.full_name || '',
          username: r2.data.manager.username || '',
          phone: r2.data.manager.phone || '',
        })
      }
      setCreateMode(false)
      setCreateMgr({ full_name: '', username: '', phone: '', password: '' })
      toast?.('Руководитель назначен', 'success')
      onSaved?.()
    } catch (err) {
      toast?.('Ошибка: ' + (err.response?.data?.detail || err.message), 'error')
    }
    setSaving(false)
  }

  // ── Сброс пароля ─────────────────────────────────────────────────────────
  const resetPassword = async () => {
    const ok = await confirm(
      'Старый пароль перестанет работать. Новый пароль будет показан один раз — обязательно скопируйте его.',
      {
        title: 'Сгенерировать новый пароль?',
        okText: 'Сгенерировать',
        cancelText: 'Отмена',
        danger: true,
      }
    )
    if (!ok) return
    setSaving(true)
    try {
      const r = await api.post(`/franchise-owner/clinics/${tenantId}/manager/reset-password`)
      setRevealedPassword({
        username: r.data.username,
        password: r.data.password,
        warning: r.data.warning,
      })
      toast?.('Новый пароль сгенерирован', 'success')
    } catch (err) {
      toast?.('Ошибка: ' + (err.response?.data?.detail || err.message), 'error')
    }
    setSaving(false)
  }

  // ── UI ──────────────────────────────────────────────────────────────────
  const headerTitle = data ? `Клиника: ${data.name || data.clinic_name || data.slug}` : 'Клиника'

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        size="lg"
        title={headerTitle}
        actions={
          <>
            <Button variant="secondary" onClick={onClose}>Закрыть</Button>
            {tab === 'details' && (
              <Button onClick={saveDetails} disabled={saving || loading}>
                {saving ? 'Сохранение…' : 'Сохранить реквизиты'}
              </Button>
            )}
          </>
        }
      >
        {loading ? (
          <div className="py-10 text-center" style={{ color: 'var(--fg-3)', fontSize: 13 }}>
            Загрузка…
          </div>
        ) : !data ? (
          <div className="py-10 text-center" style={{ color: 'var(--fg-3)', fontSize: 13 }}>
            Нет данных
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* ─── Шапка: бренд, slug, статус ─── */}
            <div className="flex items-center gap-3 flex-wrap">
              <div
                className="grid place-items-center flex-shrink-0"
                style={{
                  width: 44, height: 44, borderRadius: 11,
                  background: data.is_active ? 'var(--accent-soft)' : 'var(--bg-2)',
                  color: data.is_active ? 'var(--accent)' : 'var(--fg-4)',
                }}
              >
                <Icon name="corporate_fare" size={22} fill={1} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate" style={{ fontSize: 14, color: 'var(--fg)' }}>
                  {data.name}
                </div>
                <div className="font-mono truncate" style={{ fontSize: 11, color: 'var(--fg-4)' }}>
                  /{data.slug}
                </div>
              </div>
              <Chip variant={data.is_active ? 'good' : 'default'} dot={data.is_active}>
                {data.is_active ? 'Активна' : 'Неактивна'}
              </Chip>
            </div>

            {/* ─── Tabs ─── */}
            <Tabs
              items={[
                { id: 'details', label: 'Реквизиты' },
                { id: 'manager', label: 'Руководитель', badge: data.manager ? null : '!' },
              ]}
              value={tab}
              onChange={setTab}
            />

            {/* ─── Вкладка «Реквизиты» ─── */}
            {tab === 'details' && (
              <form onSubmit={saveDetails} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Название клиники *">
                  <FormInput
                    value={details.name}
                    onChange={e => setDetails(d => ({ ...d, name: e.target.value }))}
                    required
                  />
                </FormField>
                <FormField label="Телефон">
                  <FormInput
                    value={details.phone}
                    onChange={e => setDetails(d => ({ ...d, phone: e.target.value }))}
                    placeholder="+7 ..."
                  />
                </FormField>
                <div className="sm:col-span-2">
                  <FormField label="Адрес">
                    <FormInput
                      value={details.address}
                      onChange={e => setDetails(d => ({ ...d, address: e.target.value }))}
                    />
                  </FormField>
                </div>

                <div
                  className="sm:col-span-2 rounded-xl p-3 flex flex-col gap-3"
                  style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}
                >
                  <div
                    className="font-bold uppercase"
                    style={{ fontSize: 10, color: 'var(--fg-3)', letterSpacing: '0.08em' }}
                  >Контракт партнёра</div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <FormField label="Тип контракта">
                      <FormSelect
                        value={details.contract_type}
                        onChange={e => setDetails(d => ({ ...d, contract_type: e.target.value }))}
                      >
                        {CONTRACT_TYPES.map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </FormSelect>
                    </FormField>
                    <FormField label="Royalty %" hint="0–100">
                      <FormInput
                        type="number" min="0" max="100" step="0.01"
                        value={details.royalty_percent}
                        onChange={e => setDetails(d => ({ ...d, royalty_percent: e.target.value }))}
                        disabled={!['royalty', 'hybrid'].includes(details.contract_type)}
                        mono
                      />
                    </FormField>
                    <FormField label="Бонус ₽ / направление">
                      <FormInput
                        type="number" min="0" step="0.01"
                        value={details.bonus_per_referral}
                        onChange={e => setDetails(d => ({ ...d, bonus_per_referral: e.target.value }))}
                        disabled={!['per_referral', 'hybrid'].includes(details.contract_type)}
                        mono
                      />
                    </FormField>
                  </div>
                </div>

                {/* submit handled by footer button (form="…" не используется — saveDetails вызывается напрямую) */}
                <button type="submit" style={{ display: 'none' }} aria-hidden="true" />
              </form>
            )}

            {/* ─── Вкладка «Руководитель» ─── */}
            {tab === 'manager' && (
              <div className="flex flex-col gap-3">
                {revealedPassword && (
                  <PasswordRevealCard
                    username={revealedPassword.username}
                    password={revealedPassword.password}
                    warning={revealedPassword.warning}
                    onClose={() => setRevealedPassword(null)}
                  />
                )}

                {/* ── Существующий manager ── */}
                {data.manager && !createMode && (
                  <div
                    className="rounded-xl p-4 flex flex-col gap-3"
                    style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}
                  >
                    {!mgrEditing ? (
                      <>
                        <div className="flex items-center gap-3">
                          <div
                            className="grid place-items-center flex-shrink-0"
                            style={{
                              width: 40, height: 40, borderRadius: 10,
                              background: 'var(--accent-soft)', color: 'var(--accent)',
                            }}
                          >
                            <Icon name="badge" size={20} fill={1} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold truncate" style={{ fontSize: 14, color: 'var(--fg)' }}>
                              {data.manager.full_name}
                            </div>
                            <div className="font-mono truncate" style={{ fontSize: 11, color: 'var(--fg-4)' }}>
                              {data.manager.username}
                            </div>
                          </div>
                          <Chip variant="default">manager</Chip>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" style={{ fontSize: 12 }}>
                          <div className="flex items-center justify-between py-1"
                               style={{ borderBottom: '1px solid var(--line)' }}>
                            <span style={{ color: 'var(--fg-3)' }}>Телефон</span>
                            <span className="font-medium" style={{ color: 'var(--fg)' }}>
                              {data.manager.phone || '—'}
                            </span>
                          </div>
                          <div className="flex items-center justify-between py-1"
                               style={{ borderBottom: '1px solid var(--line)' }}>
                            <span style={{ color: 'var(--fg-3)' }}>user_id</span>
                            <span className="font-mono" style={{ fontSize: 10.5, color: 'var(--fg-4)' }}>
                              {data.manager.user_id?.slice(0, 8)}…
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap mt-1">
                          <Button
                            size="sm"
                            variant="secondary"
                            leftIcon={<Icon name="edit" size={14} />}
                            onClick={() => setMgrEditing(true)}
                          >
                            Редактировать данные
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            leftIcon={<Icon name="key" size={14} />}
                            onClick={resetPassword}
                            disabled={saving}
                          >
                            Сгенерировать новый пароль
                          </Button>
                        </div>
                        <div
                          className="rounded-lg p-2 mt-1"
                          style={{ background: 'var(--bg-2)', fontSize: 11, color: 'var(--fg-3)' }}
                        >
                          <Icon name="info" size={13} style={{ marginRight: 4, verticalAlign: '-2px' }} />
                          Редактирование изменяет данные ТОГО ЖЕ User-а. user_id сохраняется,
                          все связи (записи, направления, бонусы, аудит) остаются целыми.
                        </div>
                      </>
                    ) : (
                      <form onSubmit={saveManager} className="flex flex-col gap-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <FormField label="ФИО *">
                            <FormInput
                              value={mgrForm.full_name}
                              onChange={e => setMgrForm(f => ({ ...f, full_name: e.target.value }))}
                              required
                            />
                          </FormField>
                          <FormField label="Логин (username) *">
                            <FormInput
                              value={mgrForm.username}
                              onChange={e => setMgrForm(f => ({ ...f, username: e.target.value }))}
                              required mono pattern="^[A-Za-z0-9_.\\-]+$"
                            />
                          </FormField>
                          <div className="sm:col-span-2">
                            <FormField label="Телефон">
                              <FormInput
                                value={mgrForm.phone}
                                onChange={e => setMgrForm(f => ({ ...f, phone: e.target.value }))}
                                placeholder="+7 ..."
                              />
                            </FormField>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 justify-end">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setMgrEditing(false)
                              // Восстанавливаем оригинальные значения
                              setMgrForm({
                                full_name: data.manager?.full_name || '',
                                username: data.manager?.username || '',
                                phone: data.manager?.phone || '',
                              })
                            }}
                          >Отмена</Button>
                          <Button type="submit" size="sm" disabled={saving}>
                            {saving ? 'Сохранение…' : 'Сохранить'}
                          </Button>
                        </div>
                      </form>
                    )}
                  </div>
                )}

                {/* ── Если manager-а нет ── */}
                {!data.manager && !createMode && (
                  <div
                    className="rounded-xl p-5 flex flex-col items-center gap-3 text-center"
                    style={{ background: 'var(--bg-1)', border: '1px dashed var(--border)' }}
                  >
                    <div
                      className="grid place-items-center"
                      style={{
                        width: 48, height: 48, borderRadius: 12,
                        background: 'var(--warn-soft)', color: 'var(--warn)',
                      }}
                    >
                      <Icon name="person_off" size={24} fill={1} />
                    </div>
                    <div>
                      <div className="font-semibold" style={{ fontSize: 14, color: 'var(--fg)' }}>
                        У клиники пока нет руководителя
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>
                        Создайте первого manager-а — он сможет логиниться в /{data.slug}/admin.
                      </div>
                    </div>
                    <Button
                      leftIcon={<Icon name="person_add" size={16} />}
                      onClick={() => setCreateMode(true)}
                    >
                      Назначить руководителя
                    </Button>
                  </div>
                )}

                {/* ── Форма создания ── */}
                {createMode && (
                  <form
                    onSubmit={submitCreateManager}
                    className="rounded-xl p-4 flex flex-col gap-3"
                    style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}
                  >
                    <div
                      className="font-bold uppercase"
                      style={{ fontSize: 10, color: 'var(--fg-3)', letterSpacing: '0.08em' }}
                    >Новый руководитель клиники</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <FormField label="ФИО *">
                        <FormInput
                          value={createMgr.full_name}
                          onChange={e => setCreateMgr(f => ({ ...f, full_name: e.target.value }))}
                          required
                        />
                      </FormField>
                      <FormField label="Логин *">
                        <FormInput
                          value={createMgr.username}
                          onChange={e => setCreateMgr(f => ({ ...f, username: e.target.value }))}
                          required mono pattern="^[A-Za-z0-9_.\\-]+$"
                        />
                      </FormField>
                      <FormField label="Телефон">
                        <FormInput
                          value={createMgr.phone}
                          onChange={e => setCreateMgr(f => ({ ...f, phone: e.target.value }))}
                          placeholder="+7 ..."
                        />
                      </FormField>
                      <FormField label="Пароль" hint="Оставьте пустым — сгенерируем автоматически">
                        <FormInput
                          value={createMgr.password}
                          onChange={e => setCreateMgr(f => ({ ...f, password: e.target.value }))}
                          mono
                        />
                      </FormField>
                    </div>
                    <div className="flex items-center gap-2 justify-end">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setCreateMode(false)
                          setCreateMgr({ full_name: '', username: '', phone: '', password: '' })
                        }}
                      >Отмена</Button>
                      <Button type="submit" size="sm" disabled={saving}>
                        {saving ? 'Создание…' : 'Создать'}
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
      <ConfirmHost />
    </>
  )
}
