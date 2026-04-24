/**
 * TenantDrawer — правая sliding-панель управления тенантом.
 * Вкладки: Основное | Интеграции | Модули | Биллинг
 */
import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import { API_BASE } from '../config'

function api(method, url, token, data) {
  return axios({ method, url: `${API_BASE}${url}`, headers: { Authorization: `Bearer ${token}` }, data })
}

const STATUS_CLS = {
  trial:    'bg-blue-100 text-blue-700',
  active:   'bg-green-100 text-green-700',
  past_due: 'bg-yellow-100 text-yellow-700',
  cancelled:'bg-red-100 text-red-700',
  paused:   'bg-gray-100 text-gray-600',
  expired:  'bg-orange-100 text-orange-700',
}
const PLAN_CLS = {
  basic:        'bg-slate-100 text-slate-600',
  professional: 'bg-purple-100 text-purple-700',
  enterprise:   'bg-amber-100 text-amber-700',
}
const CAT_LABELS = { telephony: 'Телефония', ai: 'AI-аналитика', advertising: 'Реклама' }
const CAT_ICONS  = { telephony: 'phone_in_talk', ai: 'auto_awesome', advertising: 'campaign' }

// ── Основная вкладка ──────────────────────────────────────────────────────────
function TabMain({ token, tenant, onUpdate }) {
  const [resetting, setResetting] = useState(false)
  const [creds, setCreds]         = useState(null)
  const [toggling, setToggling]   = useState(false)
  const [copied, setCopied]       = useState(false)

  const resetPassword = async () => {
    setResetting(true)
    setCreds(null)
    try {
      const r = await api('post', `/admin/tenants/${tenant.id}/reset-password`, token)
      setCreds(r.data)
    } catch(e) {
      alert(e.response?.data?.detail || 'Ошибка сброса пароля')
    }
    setResetting(false)
  }

  const toggleActive = async () => {
    setToggling(true)
    try {
      await api('patch', `/admin/tenants/${tenant.id}/toggle`, token, { is_active: !tenant.is_active })
      onUpdate({ ...tenant, is_active: !tenant.is_active })
    } catch(e) {
      alert(e.response?.data?.detail || 'Ошибка')
    }
    setToggling(false)
  }

  const copyText = (t) => {
    navigator.clipboard.writeText(t)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const INFO_ROWS = [
    ['ID',       tenant.id],
    ['Slug',     tenant.slug],
    ['План',     <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${PLAN_CLS[tenant.plan] || 'bg-gray-100 text-gray-600'}`}>{tenant.plan || '—'}</span>],
    ['Подписка', <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_CLS[tenant.subscription_status] || 'bg-gray-100 text-gray-600'}`}>{tenant.subscription_status || '—'}</span>],
    ['Клиники',  tenant.clinics_count],
    ['Польз.',   tenant.users_count],
    ['Статус',   <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${tenant.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{tenant.is_active ? 'Активен' : 'Отключён'}</span>],
  ]

  return (
    <div className="space-y-5">
      <div className="bg-gray-50 dark:bg-gray-800 rounded-xl overflow-hidden">
        {INFO_ROWS.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 dark:border-gray-700 last:border-0">
            <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">{k}</span>
            <span className="text-sm text-gray-900 dark:text-white font-medium">{v}</span>
          </div>
        ))}
      </div>

      <div className="flex gap-3">
        <button
          onClick={toggleActive}
          disabled={toggling}
          className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition ${tenant.is_active
            ? 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200'
            : 'bg-green-50 text-green-600 hover:bg-green-100 border border-green-200'}`}
        >
          {toggling ? '...' : tenant.is_active ? 'Отключить тенант' : 'Включить тенант'}
        </button>
        <button
          onClick={resetPassword}
          disabled={resetting}
          className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 transition"
        >
          {resetting ? 'Сброс...' : '🔑 Сбросить пароль'}
        </button>
      </div>

      {creds && (
        <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 rounded-xl p-4 space-y-2">
          <p className="text-sm font-bold text-green-800 dark:text-green-300">Новые данные для входа:</p>
          {[['URL', creds.admin_panel || creds.url], ['Логин', creds.username || creds.admin_username], ['Пароль', creds.new_password || creds.admin_password]].map(([k, v]) => v && (
            <div key={k} className="flex items-center justify-between bg-white dark:bg-gray-900 rounded-lg px-3 py-2">
              <span className="text-xs text-gray-500">{k}</span>
              <span className="text-sm font-mono text-gray-900 dark:text-white">{v}</span>
            </div>
          ))}
          <button
            onClick={() => copyText([creds.admin_panel, creds.username || creds.admin_username, creds.new_password || creds.admin_password].filter(Boolean).join('\n'))}
            className="w-full py-2 bg-green-600 text-white rounded-lg text-xs font-bold hover:bg-green-700 transition mt-1"
          >
            {copied ? '✓ Скопировано' : 'Скопировать всё'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Интеграции ────────────────────────────────────────────────────────────────
const EMPTY_INT = { type: 'mis', name: '', base_url: '', api_key: '', extra_config: null }

function TabIntegrations({ token, tenantId }) {
  const [items, setItems]       = useState(null)
  const [editing, setEditing]   = useState(null)   // null | 'new' | integration object
  const [form, setForm]         = useState(EMPTY_INT)
  const [saving, setSaving]     = useState(false)
  const [testing, setTesting]   = useState(null)
  const [testRes, setTestRes]   = useState({})
  const [err, setErr]           = useState('')

  const load = useCallback(async () => {
    try {
      const r = await api('get', `/admin/tenants/${tenantId}/integrations`, token)
      setItems(r.data)
    } catch { setItems([]) }
  }, [tenantId, token])

  useEffect(() => { load() }, [load])

  const startNew   = () => { setEditing('new'); setForm(EMPTY_INT); setErr('') }
  const startEdit  = (i) => { setEditing(i); setForm({ type: i.type, name: i.name, base_url: i.base_url, api_key: '', extra_config: i.extra_config }); setErr('') }
  const cancelEdit = () => { setEditing(null); setErr('') }
  const set        = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const save = async () => {
    if (!form.name || !form.base_url || (editing === 'new' && !form.api_key)) {
      setErr('Заполните все поля'); return
    }
    setSaving(true); setErr('')
    try {
      if (editing === 'new') {
        await api('post', `/admin/tenants/${tenantId}/integrations`, token, form)
      } else {
        const payload = { name: form.name, base_url: form.base_url, extra_config: form.extra_config }
        if (form.api_key) payload.api_key = form.api_key
        await api('put', `/admin/tenants/${tenantId}/integrations/${editing.id}`, token, payload)
      }
      cancelEdit(); load()
    } catch(e) { setErr(e.response?.data?.detail || 'Ошибка') }
    setSaving(false)
  }

  const remove = async (i) => {
    if (!confirm(`Удалить интеграцию «${i.name}»?`)) return
    await api('delete', `/admin/tenants/${tenantId}/integrations/${i.id}`, token)
    load()
  }

  const testConn = async (i) => {
    setTesting(i.id)
    try {
      const r = await api('post', `/admin/tenants/${tenantId}/integrations/${i.id}/test`, token)
      setTestRes(prev => ({ ...prev, [i.id]: r.data }))
    } catch(e) {
      setTestRes(prev => ({ ...prev, [i.id]: { status: 'error', error: e.response?.data?.detail || 'Ошибка' } }))
    }
    setTesting(null)
  }

  if (!items) return <div className="text-center py-8 text-gray-400">Загрузка...</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500 dark:text-gray-400">{items.length} интегр.</p>
        <button onClick={startNew}
          className="flex items-center gap-1.5 bg-[#0097A7] text-white px-3 py-2 rounded-xl text-xs font-semibold hover:bg-[#00838f] transition">
          <span className="material-symbols-outlined text-[16px]">add</span>
          Добавить
        </button>
      </div>

      {items.length === 0 && !editing && (
        <div className="text-center py-10 text-gray-400">
          <span className="material-symbols-outlined text-4xl block mb-2">integration_instructions</span>
          Нет интеграций
        </div>
      )}

      {items.map(i => (
        <div key={i.id} className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 space-y-2">
          <div className="flex items-start justify-between">
            <div>
              <p className="font-semibold text-gray-900 dark:text-white text-sm">{i.name}</p>
              <p className="text-xs text-gray-500 font-mono mt-0.5">{i.base_url}</p>
              <p className="text-xs text-gray-400 mt-0.5">Ключ: {i.api_key_hint} · {i.type.toUpperCase()}</p>
            </div>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${i.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {i.is_active ? 'Активна' : 'Откл.'}
            </span>
          </div>

          {testRes[i.id] && (
            <div className={`rounded-lg px-3 py-1.5 text-xs font-medium ${testRes[i.id].status === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
              {testRes[i.id].status === 'ok' ? '✓ Соединение OK' : `✗ ${testRes[i.id].error || testRes[i.id].status}`}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={() => testConn(i)} disabled={testing === i.id}
              className="text-xs text-[#0097A7] hover:underline font-medium">
              {testing === i.id ? 'Тест...' : '⚡ Тест'}
            </button>
            <button onClick={() => startEdit(i)}
              className="text-xs text-blue-600 hover:underline font-medium">Изменить</button>
            <button onClick={() => remove(i)}
              className="text-xs text-red-500 hover:underline font-medium">Удалить</button>
          </div>
        </div>
      ))}

      {editing && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4 space-y-3">
          <p className="font-semibold text-gray-800 dark:text-white text-sm">
            {editing === 'new' ? 'Новая интеграция' : `Изменить: ${editing.name}`}
          </p>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Тип</label>
            <select value={form.type} onChange={e => set('type', e.target.value)}
              disabled={editing !== 'new'}
              className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
              {['mis','lis','bars','custom'].map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
            </select>
          </div>
          {[
            ['Название', 'name', 'text', 'МИС Клиника'],
            ['Base URL', 'base_url', 'url', 'https://mis.example.com/api'],
            ['API ключ' + (editing !== 'new' ? ' (оставьте пустым чтобы не менять)' : ''), 'api_key', 'password', ''],
          ].map(([label, key, type, ph]) => (
            <div key={key}>
              <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
              <input type={type} placeholder={ph} value={form[key]}
                onChange={e => set(key, e.target.value)}
                className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-[#0097A7] outline-none" />
            </div>
          ))}
          {err && <p className="text-red-500 text-xs bg-red-50 px-3 py-2 rounded-lg">{err}</p>}
          <div className="flex gap-2">
            <button onClick={save} disabled={saving}
              className="flex-1 py-2 bg-[#0097A7] text-white rounded-xl text-sm font-bold hover:bg-[#00838f] disabled:opacity-50 transition">
              {saving ? 'Сохранение...' : 'Сохранить'}
            </button>
            <button onClick={cancelEdit}
              className="px-4 py-2 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-xl text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition">
              Отмена
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Модули ────────────────────────────────────────────────────────────────────
function TabModules({ token, tenantId }) {
  const [items, setItems]         = useState(null)
  const [expandedKey, setExpanded]= useState(null)
  const [enabling, setEnabling]   = useState(null)
  const [enableForm, setEnableForm] = useState({ trial_days: 0, billing_cycle: 'monthly', custom_price: '' })
  const [customPrices, setCustomPrices] = useState({})
  const [savingPrice, setSavingPrice]   = useState(null)

  const load = useCallback(async () => {
    try {
      const r = await api('get', `/admin/tenants/${tenantId}/modules`, token)
      setItems(r.data)
    } catch { setItems([]) }
  }, [tenantId, token])

  useEffect(() => { load() }, [load])

  const enable = async (key) => {
    const payload = {
      billing_cycle: enableForm.billing_cycle,
      trial_days: Number(enableForm.trial_days),
      custom_price: enableForm.custom_price ? Number(enableForm.custom_price) : null,
    }
    setEnabling(key)
    try {
      await api('post', `/admin/tenants/${tenantId}/modules/${key}/enable`, token, payload)
      load()
      setExpanded(null)
    } catch(e) { alert(e.response?.data?.detail || 'Ошибка') }
    setEnabling(null)
  }

  const disable = async (key) => {
    if (!confirm('Отключить модуль?')) return
    try {
      await api('post', `/admin/tenants/${tenantId}/modules/${key}/disable`, token)
      load()
    } catch(e) { alert(e.response?.data?.detail || 'Ошибка') }
  }

  const savePrice = async (key) => {
    setSavingPrice(key)
    try {
      const price = customPrices[key]
      await api('put', `/admin/tenants/${tenantId}/modules/${key}/price`, token, {
        custom_price: price ? Number(price) : null
      })
      load()
    } catch(e) { alert(e.response?.data?.detail || 'Ошибка') }
    setSavingPrice(null)
  }

  if (!items) return <div className="text-center py-8 text-gray-400">Загрузка...</div>

  const byCategory = {}
  for (const item of items) {
    const cat = item.module.category
    if (!byCategory[cat]) byCategory[cat] = []
    byCategory[cat].push(item)
  }

  return (
    <div className="space-y-5">
      {Object.entries(byCategory).map(([cat, catItems]) => (
        <div key={cat}>
          <div className="flex items-center gap-2 mb-2">
            <span className="material-symbols-outlined text-[18px] text-gray-400"
              style={{fontVariationSettings:"'FILL' 1"}}>
              {CAT_ICONS[cat] || 'extension'}
            </span>
            <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest">
              {CAT_LABELS[cat] || cat}
            </p>
          </div>
          <div className="space-y-2">
            {catItems.map(({ module: m, subscription: sub }) => {
              const isActive   = sub && ['active','trial'].includes(sub.status)
              const isCancelled= sub?.status === 'cancelled' || sub?.status === 'expired'
              const expanded   = expandedKey === m.key

              return (
                <div key={m.key} className={`rounded-xl border transition ${isActive
                  ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-700'
                  : 'bg-gray-50 dark:bg-gray-800 border-gray-100 dark:border-gray-700'}`}>
                  <div className="flex items-center justify-between px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{m.name}</p>
                        {sub && (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${STATUS_CLS[sub.status] || 'bg-gray-100 text-gray-600'}`}>
                            {sub.status}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">{m.description}</p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-gray-600 dark:text-gray-300 font-medium">
                          {sub?.custom_price != null
                            ? `${sub.custom_price.toLocaleString('ru-RU')} ₽/мес (договор)`
                            : m.price_monthly === 0
                              ? (m.included_in_plans?.length ? `Включён в ${m.included_in_plans.join(', ')}` : 'Бесплатно')
                              : `${m.price_monthly.toLocaleString('ru-RU')} ₽/мес`}
                        </span>
                        {sub?.trial_ends_at && (
                          <span className="text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                            trial до {sub.trial_ends_at.slice(0,10)}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 ml-3">
                      {!isActive && (
                        <button
                          onClick={() => { setExpanded(expanded ? null : m.key); setEnableForm({ trial_days: 0, billing_cycle: 'monthly', custom_price: '' }) }}
                          className="px-2.5 py-1.5 bg-[#0097A7] text-white rounded-lg text-xs font-bold hover:bg-[#00838f] transition">
                          Включить
                        </button>
                      )}
                      {isActive && (
                        <>
                          <button
                            onClick={() => { setExpanded(expanded ? null : m.key); setEnableForm({ trial_days: 0, billing_cycle: sub.billing_cycle || 'monthly', custom_price: sub.custom_price != null ? String(sub.custom_price) : '' }) }}
                            className="px-2.5 py-1.5 bg-blue-50 text-blue-600 border border-blue-200 rounded-lg text-xs font-semibold hover:bg-blue-100 transition">
                            Изм.
                          </button>
                          <button onClick={() => disable(m.key)}
                            className="px-2.5 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded-lg text-xs font-semibold hover:bg-red-100 transition">
                            Откл.
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {expanded && (
                    <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-700 pt-3 space-y-3">
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Trial (дней, 0=нет)</label>
                          <input type="number" min="0" max="365"
                            value={enableForm.trial_days}
                            onChange={e => setEnableForm(f => ({ ...f, trial_days: e.target.value }))}
                            className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white" />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Цикл оплаты</label>
                          <select value={enableForm.billing_cycle}
                            onChange={e => setEnableForm(f => ({ ...f, billing_cycle: e.target.value }))}
                            className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
                            <option value="monthly">1 мес (ежемесячно)</option>
                            <option value="quarterly">3 мес (−5%)</option>
                            <option value="semi_annual">6 мес (−10%)</option>
                            <option value="nine_months">9 мес (−13%)</option>
                            <option value="annual">12 мес (−17%)</option>
                            <option value="one_time">Единоразово</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Договорная цена (₽/мес, пусто = из каталога)</label>
                        <input type="number" min="0" placeholder={String(m.price_monthly)}
                          value={enableForm.custom_price}
                          onChange={e => setEnableForm(f => ({ ...f, custom_price: e.target.value }))}
                          className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white" />
                      </div>
                      <button onClick={() => enable(m.key)} disabled={enabling === m.key}
                        className="w-full py-2 bg-[#0097A7] text-white rounded-xl text-sm font-bold hover:bg-[#00838f] disabled:opacity-50 transition">
                        {enabling === m.key ? 'Сохранение...' : isActive ? 'Обновить настройки' : 'Активировать модуль'}
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Биллинг ───────────────────────────────────────────────────────────────────
function TabBilling({ token, tenant }) {
  const [form, setForm]   = useState({ plan: tenant.plan || 'basic', billing_cycle: 'monthly', trial_days: 14 })
  const [msg, setMsg]     = useState(null)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true); setMsg(null)
    try {
      await api('post', `/admin/tenants/${tenant.id}/subscription`, token, form)
      setMsg({ ok: true, text: 'Подписка активирована!' })
    } catch(e) {
      setMsg({ ok: false, text: e.response?.data?.detail || 'Ошибка' })
    }
    setSaving(false)
  }

  const PLAN_OPTS = [
    { v: 'basic',        l: 'Basic',        sub: '9 900 ₽/мес',  color: 'bg-slate-100 text-slate-700' },
    { v: 'professional', l: 'Professional', sub: '24 900 ₽/мес',  color: 'bg-purple-100 text-purple-700' },
    { v: 'enterprise',   l: 'Enterprise',   sub: '49 900 ₽/мес', color: 'bg-amber-100 text-amber-700' },
  ]

  return (
    <div className="space-y-5">
      <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4">
        <p className="text-xs text-gray-500 mb-2 font-semibold uppercase tracking-wide">Текущее состояние</p>
        <div className="flex items-center gap-3">
          <span className={`px-3 py-1 rounded-full text-sm font-bold ${PLAN_CLS[tenant.plan] || 'bg-gray-100 text-gray-600'}`}>{tenant.plan || '—'}</span>
          <span className={`px-3 py-1 rounded-full text-sm font-bold ${STATUS_CLS[tenant.subscription_status] || 'bg-gray-100 text-gray-600'}`}>{tenant.subscription_status || '—'}</span>
        </div>
      </div>

      <div>
        <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-2">Тарифный план</p>
        <div className="grid grid-cols-3 gap-2">
          {PLAN_OPTS.map(p => (
            <button key={p.v} onClick={() => setForm(f => ({ ...f, plan: p.v }))}
              className={`py-3 rounded-xl text-center border-2 transition ${form.plan === p.v ? 'border-[#0097A7] bg-[#0097A7]/10' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'}`}>
              <p className={`text-xs font-bold px-1.5 py-0.5 rounded-full inline-block mb-1 ${p.color}`}>{p.l}</p>
              <p className="text-xs text-gray-500">{p.sub}</p>
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-2">Цикл оплаты</p>
        <div className="grid grid-cols-2 gap-2">
          {[['monthly','1 мес'],['quarterly','3 мес (−5%)'],['semi_annual','6 мес (−10%)'],['nine_months','9 мес (−13%)'],['annual','12 мес (−17%)']].map(([v,l]) => (
            <button key={v} onClick={() => setForm(f => ({ ...f, billing_cycle: v }))}
              className={`py-2.5 rounded-xl text-sm font-semibold border-2 transition ${form.billing_cycle === v ? 'border-[#0097A7] bg-[#0097A7]/10 text-[#0097A7]' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-2">Пробный период</p>
        <div className="grid grid-cols-6 gap-2">
          {[0, 7, 14, 30, 60, 90].map(d => (
            <button key={d} onClick={() => setForm(f => ({ ...f, trial_days: d }))}
              className={`py-2 rounded-xl text-sm font-semibold border-2 transition ${form.trial_days === d ? 'border-[#0097A7] bg-[#0097A7]/10 text-[#0097A7]' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'}`}>
              {d === 0 ? 'Нет' : `${d}д`}
            </button>
          ))}
        </div>
      </div>

      {msg && (
        <div className={`rounded-xl px-4 py-3 text-sm font-medium ${msg.ok ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {msg.text}
        </div>
      )}

      <button onClick={save} disabled={saving}
        className="w-full py-3 bg-[#0097A7] text-white rounded-xl font-bold hover:bg-[#00838f] disabled:opacity-50 transition">
        {saving ? 'Применение...' : 'Активировать / Обновить подписку'}
      </button>
    </div>
  )
}

// ── Главный компонент ─────────────────────────────────────────────────────────
export default function TenantDrawer({ token, tenant, onClose, onUpdate }) {
  const [tab, setTab] = useState('main')

  const TABS = [
    { key: 'main',         label: 'Основное',    icon: 'info' },
    { key: 'integrations', label: 'Интеграции',  icon: 'integration_instructions' },
    { key: 'modules',      label: 'Модули',      icon: 'extension' },
    { key: 'billing',      label: 'Биллинг',     icon: 'receipt_long' },
  ]

  return (
    <>
      {/* Затемнение */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
      />

      {/* Панель */}
      <div className="fixed top-0 right-0 h-full w-full max-w-md bg-white dark:bg-gray-900 shadow-2xl z-50 flex flex-col overflow-hidden">
        {/* Шапка */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 flex-shrink-0">
          <div>
            <h2 className="font-bold text-gray-900 dark:text-white text-base">{tenant.name}</h2>
            <p className="text-xs text-gray-500 font-mono mt-0.5">{tenant.slug}</p>
          </div>
          <button onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition">
            <span className="material-symbols-outlined text-gray-400">close</span>
          </button>
        </div>

        {/* Вкладки */}
        <div className="flex border-b border-gray-100 dark:border-gray-800 flex-shrink-0 overflow-x-auto">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-3 text-xs font-semibold whitespace-nowrap border-b-2 transition ${tab === t.key ? 'border-[#0097A7] text-[#0097A7]' : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400'}`}>
              <span className="material-symbols-outlined text-[15px]">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        {/* Контент */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'main'         && <TabMain         token={token} tenant={tenant} onUpdate={onUpdate} />}
          {tab === 'integrations' && <TabIntegrations token={token} tenantId={tenant.id} />}
          {tab === 'modules'      && <TabModules      token={token} tenantId={tenant.id} />}
          {tab === 'billing'      && <TabBilling      token={token} tenant={tenant} />}
        </div>
      </div>
    </>
  )
}
