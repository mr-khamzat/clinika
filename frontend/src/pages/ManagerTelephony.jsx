/**
 * Manager: Телефония (3 таба: Провайдер / DID / История)
 * Route: /manager/telephony
 */
import { useEffect, useState } from 'react'
import api from '../api'
import { useToast } from '../design'
import ManagerShell from './_ManagerShell'

const PROVIDERS = [
  { value: 'null',      label: 'Отключено' },
  { value: 'mango',     label: 'Mango Office' },
  { value: 'sipuni',    label: 'Sipuni' },
  { value: 'zadarma',   label: 'Zadarma' },
  { value: 'onlinepbx', label: 'OnlinePBX' },
  { value: 'custom',    label: 'Свой SIP-trunk' },
]

const FEATURES_DEFAULT = { record_calls: true, ivr_enabled: false, voicemail: false, callback: false }

export default function ManagerTelephony() {
  const { toast } = useToast() || {}
  const [tab, setTab] = useState('provider')

  return (
    <ManagerShell active="telephony" title="Телефония" icon="phone">
      <div className="flex gap-2 mb-4 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {[
          ['provider', 'Провайдер', 'settings'],
          ['dids',     'Номера (DID)', 'dialpad'],
          ['history',  'История звонков', 'history'],
        ].map(([k, l, ic]) => (
          <button key={k} onClick={() => setTab(k)}
            className="px-4 py-2 rounded-xl font-semibold whitespace-nowrap"
            style={{
              background: tab === k ? 'var(--accent, #0097A7)' : 'var(--bg-1, #f1f5f9)',
              color: tab === k ? '#fff' : 'var(--fg-2, #475569)', fontSize: 13,
            }}>
            <span className="material-symbols-outlined" style={{ fontSize: 14, verticalAlign: 'middle', marginRight: 6 }}>{ic}</span>
            {l}
          </button>
        ))}
      </div>
      {tab === 'provider' && <ProviderTab toast={toast} />}
      {tab === 'dids'     && <DidTab toast={toast} />}
      {tab === 'history'  && <HistoryTab />}
    </ManagerShell>
  )
}


function ProviderTab({ toast }) {
  const [cfg, setCfg] = useState({ provider: 'null', api_url: '', is_active: false, features: FEATURES_DEFAULT, has_api_key: false, has_api_secret: false })
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.get('/tenant/settings/telephony').then(r => {
      setCfg({ ...r.data, features: r.data.features || FEATURES_DEFAULT })
    }).catch(() => {})
  }, [])

  const save = async () => {
    setBusy(true)
    try {
      const payload = {
        provider: cfg.provider,
        api_url: cfg.api_url || null,
        is_active: cfg.is_active,
        features: cfg.features,
      }
      if (apiKey)    payload.api_key = apiKey
      if (apiSecret) payload.api_secret = apiSecret
      const r = await api.patch('/tenant/settings/telephony', payload)
      setCfg({ ...r.data, features: r.data.features || FEATURES_DEFAULT })
      setApiKey(''); setApiSecret('')
      toast?.('Сохранено', 'success')
    } catch (e) {
      toast?.(e?.response?.data?.detail || 'Ошибка', 'error')
    } finally { setBusy(false) }
  }

  const input = {
    background: 'var(--bg-1, #f6f6f8)',
    border: '1px solid var(--border, rgba(0,0,0,.08))',
    color: 'var(--fg, #0F172A)',
    fontSize: 14, width: '100%', padding: '8px 12px', borderRadius: 10,
  }

  return (
    <div className="grid gap-3 max-w-lg">
      <label>
        <div style={{ fontSize: 12, color: 'var(--fg-2)', marginBottom: 4 }}>Провайдер</div>
        <select value={cfg.provider} onChange={e => setCfg({ ...cfg, provider: e.target.value })} style={input}>
          {PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </label>
      <label>
        <div style={{ fontSize: 12, color: 'var(--fg-2)', marginBottom: 4 }}>API URL</div>
        <input value={cfg.api_url || ''} onChange={e => setCfg({ ...cfg, api_url: e.target.value })}
               placeholder="https://app.mango-office.ru" style={input}/>
      </label>
      <label>
        <div style={{ fontSize: 12, color: 'var(--fg-2)', marginBottom: 4 }}>
          API Key {cfg.has_api_key && <span style={{ color: 'var(--good, #22c55e)' }}>✓ сохранён</span>}
        </div>
        <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
               placeholder={cfg.has_api_key ? '••••••••' : 'Введите API Key'} style={input}/>
      </label>
      <label>
        <div style={{ fontSize: 12, color: 'var(--fg-2)', marginBottom: 4 }}>
          API Secret {cfg.has_api_secret && <span style={{ color: 'var(--good, #22c55e)' }}>✓ сохранён</span>}
        </div>
        <input type="password" value={apiSecret} onChange={e => setApiSecret(e.target.value)}
               placeholder={cfg.has_api_secret ? '••••••••' : 'Введите API Secret'} style={input}/>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" checked={!!cfg.is_active}
               onChange={e => setCfg({ ...cfg, is_active: e.target.checked })}/>
        <span style={{ fontSize: 14 }}>Активна</span>
      </label>
      <div style={{ fontSize: 12, color: 'var(--fg-2)', marginTop: 8 }}>Опции:</div>
      {[
        ['record_calls', 'Запись звонков'],
        ['ivr_enabled',  'IVR (голосовое меню)'],
        ['voicemail',    'Голосовая почта'],
        ['callback',     'Callback'],
      ].map(([k, l]) => (
        <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={!!cfg.features?.[k]}
                 onChange={e => setCfg({ ...cfg, features: { ...cfg.features, [k]: e.target.checked } })}/>
          <span style={{ fontSize: 13 }}>{l}</span>
        </label>
      ))}
      <button onClick={save} disabled={busy}
              className="px-4 py-2.5 rounded-xl text-white font-semibold disabled:opacity-50 mt-2"
              style={{ background: 'linear-gradient(135deg, #0097A7, #0A2342)' }}>
        {busy ? 'Сохраняем…' : 'Сохранить'}
      </button>
      <div className="rounded-xl p-3" style={{ background: 'rgba(0,151,167,.08)', fontSize: 12, color: 'var(--fg-2)' }}>
        ℹ️ Реальные провайдеры (Mango/Sipuni/Zadarma) пока не подключены — выбор сохранится в конфиге, dial вернёт 503. Подключение — отдельной задачей.
      </div>
    </div>
  )
}


function DidTab({ toast }) {
  const [dids, setDids] = useState([])
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState(null)

  const load = async () => {
    setLoading(true)
    try { const r = await api.get('/tenant/did-numbers'); setDids(r.data?.dids || []) }
    catch { setDids([]) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const save = async () => {
    if (!edit?.number?.trim() || !edit?.display_name?.trim()) {
      toast?.('Заполните номер и название', 'error'); return
    }
    const payload = {
      number: edit.number.trim(), display_name: edit.display_name.trim(),
      clinic_id: edit.clinic_id || null, default_assignee_id: edit.default_assignee_id || null,
      record_calls: !!edit.record_calls, is_active: edit.is_active !== false,
    }
    try {
      if (edit.id) await api.patch(`/tenant/did-numbers/${edit.id}`, payload)
      else await api.post('/tenant/did-numbers', payload)
      toast?.('Сохранено', 'success'); setEdit(null); load()
    } catch (e) { toast?.(e?.response?.data?.detail || 'Ошибка', 'error') }
  }

  const remove = async (id) => {
    if (!confirm('Удалить номер?')) return
    try { await api.delete(`/tenant/did-numbers/${id}`); load() }
    catch (e) { toast?.(e?.response?.data?.detail || 'Ошибка', 'error') }
  }

  const input = {
    background: 'var(--bg-1)', border: '1px solid var(--border)',
    color: 'var(--fg)', fontSize: 14, width: '100%', padding: '8px 12px', borderRadius: 10,
  }

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button onClick={() => setEdit({ number: '', display_name: '', record_calls: true, is_active: true })}
                className="px-4 py-2 rounded-xl text-white font-semibold"
                style={{ background: 'linear-gradient(135deg, #0097A7, #0A2342)' }}>
          + Добавить номер
        </button>
      </div>
      {loading ? <div style={{ color: 'var(--fg-3)' }}>Загрузка…</div>
       : dids.length === 0 ? <div style={{ color: 'var(--fg-3)' }}>Номера не добавлены</div>
       : (
        <div className="grid gap-2">
          {dids.map(d => (
            <div key={d.id} className="p-3 rounded-2xl flex items-center gap-3"
                 style={{ background: 'var(--surface, #fff)', border: '1px solid var(--border)' }}>
              <div className="flex-1 min-w-0">
                <div style={{ fontWeight: 700, fontSize: 15 }}>{d.number}</div>
                <div style={{ fontSize: 12, color: 'var(--fg-2)' }}>{d.display_name}</div>
                <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 2 }}>
                  {d.is_active ? '✅ активен' : '⏸ выключен'}
                  {d.record_calls ? ' · 🎙 запись' : ''}
                </div>
              </div>
              <button onClick={() => setEdit({ ...d })} className="px-3 py-1 rounded-lg"
                      style={{ background: 'var(--bg-1)', fontSize: 12 }}>Изменить</button>
              <button onClick={() => remove(d.id)} className="px-3 py-1 rounded-lg"
                      style={{ background: '#fee2e2', color: '#991b1b', fontSize: 12 }}>Удалить</button>
            </div>
          ))}
        </div>
       )}
      {edit && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4"
             style={{ background: 'rgba(15,23,42,.55)' }} onClick={() => setEdit(null)}>
          <div onClick={e => e.stopPropagation()}
               className="w-full max-w-md rounded-3xl overflow-hidden p-5 space-y-3"
               style={{ background: 'var(--bg, #fff)' }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>
              {edit.id ? 'Изменить номер' : 'Новый номер'}
            </div>
            <input placeholder="+7XXX..." value={edit.number || ''}
                   onChange={e => setEdit({ ...edit, number: e.target.value })} style={input}/>
            <input placeholder="Название (Регистратура Назрань)" value={edit.display_name || ''}
                   onChange={e => setEdit({ ...edit, display_name: e.target.value })} style={input}/>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={!!edit.record_calls}
                     onChange={e => setEdit({ ...edit, record_calls: e.target.checked })}/>
              <span style={{ fontSize: 13 }}>Записывать звонки</span>
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={edit.is_active !== false}
                     onChange={e => setEdit({ ...edit, is_active: e.target.checked })}/>
              <span style={{ fontSize: 13 }}>Активен</span>
            </label>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setEdit(null)} className="flex-1 py-2.5 rounded-xl"
                      style={{ background: 'var(--bg-1)' }}>Отмена</button>
              <button onClick={save} className="flex-1 py-2.5 rounded-xl text-white font-semibold"
                      style={{ background: 'linear-gradient(135deg, #0097A7, #0A2342)' }}>
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


function HistoryTab() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [direction, setDirection] = useState('')
  const [q, setQ] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const params = { page: 1, limit: 100 }
      if (direction) params.direction = direction
      if (q) params.q = q
      const r = await api.get('/telephony/calls', { params })
      setItems(r.data?.calls || [])
    } catch { setItems([]) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [direction])

  return (
    <div>
      <div className="flex gap-2 mb-3 flex-wrap">
        {[['', 'Все'], ['in', '⬇ Входящие'], ['out', '⬆ Исходящие']].map(([v, l]) => (
          <button key={v} onClick={() => setDirection(v)}
                  className="px-3 py-1.5 rounded-full text-xs"
                  style={{
                    background: direction === v ? 'var(--accent)' : 'var(--bg-1)',
                    color: direction === v ? '#fff' : 'var(--fg-2)',
                  }}>{l}</button>
        ))}
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()}
               placeholder="Поиск по номеру… (Enter)"
               className="px-3 py-1.5 rounded-full"
               style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', fontSize: 12, flex: 1, minWidth: 180 }}/>
      </div>
      {loading ? <div style={{ color: 'var(--fg-3)' }}>Загрузка…</div>
       : items.length === 0 ? <div style={{ color: 'var(--fg-3)' }}>Звонков пока нет</div>
       : (
        <div className="grid gap-1">
          {items.map(c => (
            <div key={c.id} className="p-2 rounded-xl flex items-center gap-3"
                 style={{ background: 'var(--surface, #fff)', border: '1px solid var(--border)' }}>
              <span style={{ fontSize: 18 }}>{c.direction === 'in' ? '⬇' : '⬆'}</span>
              <div className="flex-1 min-w-0">
                <div style={{ fontWeight: 600 }}>{c.external_number}</div>
                <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                  {c.started_at && new Date(c.started_at).toLocaleString('ru-RU')} · {c.status}
                  {c.duration_sec ? ` · ${c.duration_sec}s` : ''}
                </div>
              </div>
              {c.recording_url && <a href={c.recording_url} target="_blank" rel="noreferrer"
                                     style={{ fontSize: 12, color: 'var(--accent)' }}>▶</a>}
            </div>
          ))}
        </div>
       )}
    </div>
  )
}
