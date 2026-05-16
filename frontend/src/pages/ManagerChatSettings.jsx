/**
 * Manager: SLA-настройки чата.
 * Route: /manager/chat-settings
 */
import { useEffect, useState } from 'react'
import api from '../api'
import { useToast } from '../design'
import ManagerShell from './_ManagerShell'

const DEFAULTS = {
  chat_sla_enabled: false,
  chat_sla_minutes_reg: 15,
  chat_sla_minutes_manager: 30,
  chat_sla_minutes_owner: 60,
  chat_autoclose_days: 7,
}

export default function ManagerChatSettings() {
  const { toast } = useToast() || {}
  const [s, setS] = useState(DEFAULTS)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.get('/tenant/settings/chat').then(r => setS({ ...DEFAULTS, ...(r.data || {}) })).catch(() => {})
  }, [])

  const save = async () => {
    setBusy(true)
    try {
      const r = await api.patch('/tenant/settings/chat', s)
      setS({ ...DEFAULTS, ...(r.data || {}) })
      toast?.('Сохранено', 'success')
    } catch (e) {
      toast?.(e?.response?.data?.detail || 'Ошибка', 'error')
    } finally { setBusy(false) }
  }
  const setNum = (k) => (e) => setS({ ...s, [k]: Number(e.target.value) || 0 })

  return (
    <ManagerShell active="chat-settings" title="Настройки чата" icon="tune">
      <div className="grid gap-4 max-w-md">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={s.chat_sla_enabled}
                 onChange={e => setS({ ...s, chat_sla_enabled: e.target.checked })}/>
          <span>SLA-эскалация включена</span>
        </label>
        {[
          ['chat_sla_minutes_reg',     'Эскалация на reg через (мин)'],
          ['chat_sla_minutes_manager', 'Эскалация на manager через (мин)'],
          ['chat_sla_minutes_owner',   'Эскалация на владельца через (мин)'],
          ['chat_autoclose_days',      'Автозакрытие после (дней)'],
        ].map(([k, label]) => (
          <label key={k}>
            <div style={{ fontSize: 12, color: 'var(--fg-2)', marginBottom: 4 }}>{label}</div>
            <input type="number" value={s[k]} onChange={setNum(k)}
                   className="w-full px-3 py-2 rounded-xl outline-none"
                   style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}/>
          </label>
        ))}
        <button onClick={save} disabled={busy}
                className="px-4 py-2.5 rounded-xl text-white font-semibold disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #0097A7, #0A2342)' }}>
          {busy ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </div>
    </ManagerShell>
  )
}
