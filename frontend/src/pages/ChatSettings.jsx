/**
 * ========================================
 * БЛОК: ChatSettings — глобальные настройки чата (Phase 2)
 * ========================================
 * Только для super_admin / franchise_owner.
 * GET/PUT /admin/chat-settings — TTL файлов, размер, TG-уведомления, inter-clinic.
 * ========================================
 */
import { useEffect, useState } from 'react'
import api from '../api'

export default function ChatSettings() {
  const [s, setS] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')

  useEffect(() => {
    document.title = 'Настройки чата — КлиникСеть'
    api.get('/admin/chat-settings')
      .then((r) => setS(r.data))
      .catch((e) => setError(e?.response?.data?.detail || 'Ошибка загрузки'))
  }, [])

  async function save(field, value) {
    setSaving(true)
    try {
      const { data } = await api.put('/admin/chat-settings', { [field]: value })
      setS(data)
      setToast(`Сохранено: ${LABELS[field]}`)
      setTimeout(() => setToast(''), 2000)
    } catch (e) {
      setError(e?.response?.data?.detail || 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  if (error) return <ErrorState msg={error} />
  if (!s) return <LoadingState />

  return (
    <div className="cs-root">
      <style>{CS_CSS}</style>
      <header className="cs-head">
        <div>
          <h1 className="cs-title">Настройки чата</h1>
          <p className="cs-sub">Глобальные параметры для всех сотрудников вашей сети</p>
        </div>
        {toast && <div className="cs-toast">{toast}</div>}
      </header>

      <section className="cs-section">
        <h2 className="cs-section-title">📎 Файлы и вложения</h2>
        <Field label="Срок хранения файлов" hint="Через сколько часов файлы автоматически удаляются с сервера">
          <NumberInput value={s.file_ttl_hours} min={1} max={720} step={1} suffix="часов"
            onChange={(v) => save('file_ttl_hours', v)} disabled={saving} />
          <FieldPresets onPick={(v) => save('file_ttl_hours', v)} disabled={saving}
            presets={[
              { label: '24 ч', value: 24 },
              { label: '48 ч', value: 48 },
              { label: '72 ч', value: 72 },
              { label: '7 дней', value: 168 },
              { label: '30 дней', value: 720 },
            ]} />
        </Field>
        <Field label="Максимальный размер файла" hint="Большие файлы отклоняются на этапе загрузки">
          <NumberInput value={s.max_file_mb} min={1} max={500} step={1} suffix="МБ"
            onChange={(v) => save('max_file_mb', v)} disabled={saving} />
          <FieldPresets onPick={(v) => save('max_file_mb', v)} disabled={saving}
            presets={[
              { label: '10 МБ', value: 10 },
              { label: '25 МБ', value: 25 },
              { label: '50 МБ', value: 50 },
              { label: '100 МБ', value: 100 },
              { label: '500 МБ', value: 500 },
            ]} />
        </Field>
      </section>

      <section className="cs-section">
        <h2 className="cs-section-title">🌐 Inter-clinic</h2>
        <ToggleField label="Чат между клиниками" hint="Сотрудники разных клиник одной франшизы могут писать друг другу"
          value={s.inter_clinic_allowed}
          onChange={(v) => save('inter_clinic_allowed', v)} disabled={saving} />
      </section>

      <section className="cs-section">
        <h2 className="cs-section-title">📲 Telegram-уведомления</h2>
        <ToggleField label="Уведомления включены"
          hint="Глобальный switch — если выключить, никаких TG-нотификаций"
          value={s.tg_notifications_enabled}
          onChange={(v) => save('tg_notifications_enabled', v)} disabled={saving} />
        <ToggleField label="Уведомлять super_admin"
          hint="Главный администратор получает копии важных сообщений"
          value={s.tg_notify_super_admin}
          onChange={(v) => save('tg_notify_super_admin', v)} disabled={saving || !s.tg_notifications_enabled} />
        <ToggleField label="Уведомлять владельцев сетей"
          hint="franchise_owner получает уведомления о сообщениях в его сети"
          value={s.tg_notify_franchise_owner}
          onChange={(v) => save('tg_notify_franchise_owner', v)} disabled={saving || !s.tg_notifications_enabled} />
        <ToggleField label="Пациентские чаты в TG"
          hint="Сообщения от пациентов клиники дублируются в Telegram владельцу"
          value={s.patient_chat_tg_enabled}
          onChange={(v) => save('patient_chat_tg_enabled', v)} disabled={saving || !s.tg_notifications_enabled} />
      </section>

      <footer className="cs-foot">
        Обновлено: {s.updated_at ? new Date(s.updated_at).toLocaleString('ru-RU') : '—'}
      </footer>
    </div>
  )
}

const LABELS = {
  file_ttl_hours: 'срок хранения файлов',
  max_file_mb: 'максимальный размер',
  inter_clinic_allowed: 'inter-clinic',
  tg_notifications_enabled: 'TG-уведомления',
  tg_notify_super_admin: 'нотификации super_admin',
  tg_notify_franchise_owner: 'нотификации franchise_owner',
  patient_chat_tg_enabled: 'пациентские чаты в TG',
}

function Field({ label, hint, children }) {
  return (
    <div className="cs-field">
      <div className="cs-field-head">
        <div className="cs-field-label">{label}</div>
        {hint && <div className="cs-field-hint">{hint}</div>}
      </div>
      <div className="cs-field-body">{children}</div>
    </div>
  )
}

function ToggleField({ label, hint, value, onChange, disabled }) {
  return (
    <div className={'cs-toggle-row' + (disabled ? ' is-disabled' : '')}>
      <div>
        <div className="cs-field-label">{label}</div>
        {hint && <div className="cs-field-hint">{hint}</div>}
      </div>
      <button type="button" disabled={disabled}
        onClick={() => onChange(!value)}
        className={'cs-toggle' + (value ? ' is-on' : '')}
        aria-label={label}>
        <span className="cs-toggle-thumb" />
      </button>
    </div>
  )
}

function NumberInput({ value, min, max, step, suffix, onChange, disabled }) {
  const [local, setLocal] = useState(value)
  useEffect(() => setLocal(value), [value])
  return (
    <div className="cs-number">
      <button type="button" onClick={() => onChange(Math.max(min, value - step))}
        disabled={disabled || value <= min}>−</button>
      <input type="number" value={local} min={min} max={max}
        onChange={(e) => setLocal(Number(e.target.value))}
        onBlur={() => { if (local !== value && local >= min && local <= max) onChange(local) }}
        disabled={disabled} />
      <button type="button" onClick={() => onChange(Math.min(max, value + step))}
        disabled={disabled || value >= max}>+</button>
      <span className="cs-suffix">{suffix}</span>
    </div>
  )
}

function FieldPresets({ presets, onPick, disabled }) {
  return (
    <div className="cs-presets">
      {presets.map((p) => (
        <button key={p.value} type="button" disabled={disabled}
          className="cs-preset" onClick={() => onPick(p.value)}>{p.label}</button>
      ))}
    </div>
  )
}

function LoadingState() {
  return <div className="cs-root"><div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>Загрузка…</div></div>
}
function ErrorState({ msg }) {
  return <div className="cs-root"><div style={{ padding: 40, textAlign: 'center', color: '#dc2626' }}>{msg}</div></div>
}

const CS_CSS = `
.cs-root {
  --cs-bg: oklch(0.99 0.005 250);
  --cs-surface: #ffffff;
  --cs-border: oklch(0.92 0.005 250);
  --cs-fg: oklch(0.2 0.02 250);
  --cs-fg-2: oklch(0.45 0.02 250);
  --cs-fg-3: oklch(0.6 0.015 250);
  --cs-accent: oklch(0.55 0.18 230);
  --cs-accent-soft: oklch(0.95 0.04 230);
  background: var(--cs-bg);
  min-height: 100vh;
  padding: 24px 16px;
  font-family: "Golos Text", "Inter", system-ui, sans-serif;
  color: var(--cs-fg);
}
.cs-head { max-width: 760px; margin: 0 auto 24px; display: flex; align-items: start; justify-content: space-between; gap: 16px; }
.cs-title { font-size: 24px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 4px; }
.cs-sub { font-size: 14px; color: var(--cs-fg-2); margin: 0; }
.cs-toast {
  background: oklch(0.65 0.18 145); color: white;
  padding: 8px 14px; border-radius: 10px; font-size: 13px; font-weight: 600;
  box-shadow: 0 4px 16px -4px oklch(0.65 0.18 145 / 0.4);
  animation: csFade 2s ease;
}
@keyframes csFade { 0% { opacity: 0; transform: translateY(-8px) } 15%,85% { opacity: 1; transform: translateY(0) } 100% { opacity: 0 } }
.cs-section {
  max-width: 760px;
  margin: 0 auto 20px;
  background: var(--cs-surface);
  border: 1px solid var(--cs-border);
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 2px 8px -2px oklch(0.2 0.02 250 / 0.04);
}
.cs-section-title { font-size: 16px; font-weight: 600; margin: 0 0 16px; }
.cs-field { padding: 14px 0; border-bottom: 1px solid var(--cs-border); }
.cs-field:last-child { border-bottom: none; }
.cs-field-head { margin-bottom: 10px; }
.cs-field-label { font-size: 14px; font-weight: 600; color: var(--cs-fg); }
.cs-field-hint { font-size: 12.5px; color: var(--cs-fg-3); margin-top: 3px; line-height: 1.5; }
.cs-field-body { display: flex; flex-direction: column; gap: 8px; }
.cs-number { display: inline-flex; align-items: center; gap: 6px; }
.cs-number button {
  width: 32px; height: 32px; border-radius: 8px;
  border: 1px solid var(--cs-border); background: var(--cs-surface);
  font-size: 18px; font-weight: 600; cursor: pointer;
}
.cs-number button:hover:not(:disabled) { background: var(--cs-bg); }
.cs-number button:disabled { opacity: 0.4; cursor: not-allowed; }
.cs-number input {
  width: 84px; padding: 6px 10px;
  border: 1px solid var(--cs-border); border-radius: 8px;
  font: inherit; font-size: 14px; text-align: center; background: var(--cs-surface);
  -moz-appearance: textfield;
}
.cs-number input::-webkit-outer-spin-button, .cs-number input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.cs-suffix { font-size: 13px; color: var(--cs-fg-3); }
.cs-presets { display: flex; gap: 6px; flex-wrap: wrap; }
.cs-preset {
  padding: 4px 10px; border-radius: 999px;
  border: 1px solid var(--cs-border); background: transparent;
  font: inherit; font-size: 12px; color: var(--cs-fg-2); cursor: pointer;
}
.cs-preset:hover:not(:disabled) { background: var(--cs-accent-soft); color: var(--cs-accent); border-color: var(--cs-accent); }

.cs-toggle-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 0; border-bottom: 1px solid var(--cs-border); gap: 16px;
}
.cs-toggle-row:last-child { border-bottom: none; }
.cs-toggle-row.is-disabled { opacity: 0.5; }
.cs-toggle {
  width: 44px; height: 24px; border-radius: 999px;
  border: none; background: var(--cs-border); cursor: pointer; position: relative;
  transition: background 0.2s;
}
.cs-toggle.is-on { background: var(--cs-accent); }
.cs-toggle-thumb {
  position: absolute; top: 2px; left: 2px;
  width: 20px; height: 20px; border-radius: 50%; background: white;
  transition: transform 0.2s;
  box-shadow: 0 1px 3px oklch(0.2 0.02 250 / 0.2);
}
.cs-toggle.is-on .cs-toggle-thumb { transform: translateX(20px); }
.cs-toggle:disabled { cursor: not-allowed; }
.cs-foot { max-width: 760px; margin: 24px auto 0; text-align: center; font-size: 12px; color: var(--cs-fg-3); }
`
