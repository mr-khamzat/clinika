/**
 * PlatformSection — Панель управления платформой для суперадмина.
 * Показывает: метрики, список тенантов, биллинг, форму создания нового тенанта.
 * Подключается к: GET /admin/metrics, GET /admin/tenants, GET /admin/billing, POST /tenant/create
 *
 * Импортируется лениво из AdminLayout через React.lazy.
 */
import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'

const API = '/clinika/api'
const authH = (t) => ({ Authorization: `Bearer ${t}` })
const apiFetch = (m, url, t, d) => axios({ method: m, url: `${API}${url}`, headers: authH(t), data: d })

// Статус подписки → цвет и текст
const SUB_STATUS = {
  trial:     { color: 'bg-amber-50 text-amber-700',   label: 'Trial' },
  active:    { color: 'bg-emerald-50 text-emerald-700', label: 'Активна' },
  past_due:  { color: 'bg-red-50 text-red-600',       label: 'Просрочена' },
  paused:    { color: 'bg-gray-100 text-gray-500',    label: 'Пауза' },
  cancelled: { color: 'bg-red-50 text-red-600',       label: 'Отменена' },
  null:      { color: 'bg-gray-100 text-gray-400',    label: 'Нет' },
}

const PLAN_COLOR = {
  basic: 'text-slate-600',
  professional: 'text-[#0097A7]',
  enterprise: 'text-violet-600',
}

const EMPTY_PROVISION = {
  name: '', slug: '', city: '', plan: 'basic',
  admin_name: '', admin_username: '', admin_password: '',
  primary_color: '#0097A7', sidebar_color: '#004D5F',
}

export default function PlatformSection({ token }) {
  const [tab, setTab] = useState('overview')
  const [metrics, setMetrics] = useState(null)
  const [tenants, setTenants] = useState(null)
  const [billing, setBilling] = useState(null)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [msgType, setMsgType] = useState('ok') // 'ok' | 'err'

  // Форма создания тенанта
  const [showProvision, setShowProvision] = useState(false)
  const [provForm, setProvForm] = useState(EMPTY_PROVISION)
  const [provLoading, setProvLoading] = useState(false)
  const [provResult, setProvResult] = useState(null)

  const showMsg = (text, type = 'ok') => {
    setMsg(text); setMsgType(type)
    setTimeout(() => setMsg(''), 5000)
  }

  const loadMetrics = useCallback(async () => {
    try {
      const r = await apiFetch('get', '/admin/metrics', token)
      setMetrics(r.data)
    } catch { showMsg('Ошибка загрузки метрик', 'err') }
  }, [token])

  const loadTenants = useCallback(async () => {
    try {
      const r = await apiFetch('get', '/admin/tenants', token)
      setTenants(r.data)
    } catch { showMsg('Ошибка загрузки тенантов', 'err') }
  }, [token])

  const loadBilling = useCallback(async () => {
    try {
      const r = await apiFetch('get', '/admin/billing', token)
      setBilling(r.data)
    } catch { showMsg('Ошибка загрузки биллинга', 'err') }
  }, [token])

  useEffect(() => {
    loadMetrics()
    if (tab === 'tenants' && !tenants) loadTenants()
    if (tab === 'billing' && !billing) loadBilling()
  }, [tab])

  const toggleTenant = async (tenantId, currentActive) => {
    try {
      await apiFetch('patch', `/admin/tenants/${tenantId}/toggle`, token)
      setTenants(prev => prev.map(t => t.id === tenantId ? { ...t, is_active: !currentActive } : t))
      showMsg(currentActive ? 'Тенант деактивирован' : 'Тенант активирован')
    } catch (e) { showMsg('Ошибка: ' + (e.response?.data?.detail || e.message), 'err') }
  }

  const provision = async () => {
    setProvLoading(true)
    try {
      const r = await apiFetch('post', '/tenant/create', token, provForm)
      setProvResult(r.data)
      setTenants(null) // reset, reload
      showMsg('Тенант создан успешно!')
    } catch (e) {
      showMsg('Ошибка: ' + (e.response?.data?.detail || e.message), 'err')
    }
    setProvLoading(false)
  }

  const TABS = [
    { key: 'overview', label: 'Обзор', icon: 'dashboard' },
    { key: 'tenants',  label: 'Тенанты', icon: 'corporate_fare' },
    { key: 'billing',  label: 'Биллинг', icon: 'payments' },
  ]

  // ── Метрики — сводные плитки ─────────────────────────────────────────────
  const MetricCard = ({ icon, label, value, sub, color = '#0097A7' }) => (
    <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: color + '18' }}>
          <span className="material-symbols-outlined text-base" style={{ color, fontVariationSettings: "'FILL' 1" }}>{icon}</span>
        </div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{label}</p>
      </div>
      <p className="text-3xl font-extrabold text-gray-900 dark:text-white">{value ?? '—'}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Платформа</h1>
          <p className="text-sm text-gray-400 mt-0.5">Управление всеми тенантами и биллингом</p>
        </div>
        <button onClick={() => { setShowProvision(true); setProvResult(null) }}
          className="flex items-center gap-2 bg-[#0097A7] text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#00838f] transition">
          <span className="material-symbols-outlined text-base">add_business</span>
          Новый тенант
        </button>
      </div>

      {/* Сообщение */}
      {msg && (
        <div className={`px-4 py-3 rounded-xl text-sm font-medium ${msgType === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
          {msg}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl w-fit">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition ${tab === t.key ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
            <span className="material-symbols-outlined text-base">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── TAB: Обзор ── */}
      {tab === 'overview' && (
        <div className="space-y-4">
          {metrics ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <MetricCard icon="corporate_fare" label="Всего тенантов" value={metrics.tenants_total}
                  sub={`${metrics.tenants_active} активных`} color="#0097A7" />
                <MetricCard icon="group" label="Пользователей" value={metrics.users_total} color="#7C3AED" />
                <MetricCard icon="local_hospital" label="Клиник" value={metrics.clinics_total} color="#059669" />
                <MetricCard icon="send" label="Направлений" value={metrics.referrals_total} color="#D97706" />
              </div>

              {/* Подписки по статусу */}
              {metrics.subscriptions_by_status && Object.keys(metrics.subscriptions_by_status).length > 0 && (
                <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
                  <h3 className="font-bold text-gray-900 dark:text-white mb-4">Подписки по статусу</h3>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(metrics.subscriptions_by_status).map(([status, count]) => {
                      const s = SUB_STATUS[status] || { color: 'bg-gray-100 text-gray-500', label: status }
                      return (
                        <div key={status} className={`px-3 py-1.5 rounded-full text-sm font-semibold ${s.color}`}>
                          {s.label}: {count}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Тарифы */}
              {metrics.tenants_by_plan && Object.keys(metrics.tenants_by_plan).length > 0 && (
                <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
                  <h3 className="font-bold text-gray-900 dark:text-white mb-4">Распределение по тарифам</h3>
                  <div className="flex flex-wrap gap-3">
                    {Object.entries(metrics.tenants_by_plan).map(([plan, count]) => (
                      <div key={plan} className="flex items-center gap-2">
                        <span className={`text-lg font-extrabold ${PLAN_COLOR[plan] || 'text-gray-600'}`}>{count}</span>
                        <span className="text-sm text-gray-500 capitalize">{plan}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center justify-center h-40">
              <div className="w-8 h-8 border-4 border-[#0097A7] border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>
      )}

      {/* ── TAB: Тенанты ── */}
      {tab === 'tenants' && (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-500">Всего: {tenants?.length ?? '...'}</p>
            <button onClick={loadTenants}
              className="text-xs text-[#0097A7] border border-[#0097A7] px-3 py-1.5 rounded-xl hover:bg-[#0097A7]/5 transition">
              Обновить
            </button>
          </div>

          {tenants === null && (
            <div className="flex items-center justify-center h-32">
              <div className="w-8 h-8 border-4 border-[#0097A7] border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {(tenants || []).map(t => {
            const sub = SUB_STATUS[t.subscription_status] || SUB_STATUS['null']
            return (
              <div key={t.id} className="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-gray-700">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${t.is_active ? 'bg-[#0097A7]/10' : 'bg-gray-100 dark:bg-gray-700'}`}>
                    <span className="material-symbols-outlined text-base" style={{ color: t.is_active ? '#0097A7' : '#9ca3af', fontVariationSettings: "'FILL' 1" }}>
                      corporate_fare
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={`font-semibold ${t.is_active ? 'text-gray-900 dark:text-white' : 'text-gray-400 line-through'}`}>{t.name}</p>
                      <span className="text-xs text-gray-400">/{t.slug}</span>
                      {t.plan && (
                        <span className={`text-xs font-bold uppercase ${PLAN_COLOR[t.plan] || 'text-gray-500'}`}>{t.plan}</span>
                      )}
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${sub.color}`}>{sub.label}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                      <span>{t.clinics_count} клиник</span>
                      <span>{t.users_count} сотрудников</span>
                      <span>{new Date(t.created_at).toLocaleDateString('ru-RU')}</span>
                    </div>
                  </div>
                  <button onClick={() => toggleTenant(t.id, t.is_active)}
                    className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${t.is_active ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${t.is_active ? 'translate-x-5' : ''}`} />
                  </button>
                </div>
              </div>
            )
          })}

          {tenants?.length === 0 && (
            <div className="text-center py-10 text-gray-400 text-sm">Тенантов нет</div>
          )}
        </div>
      )}

      {/* ── TAB: Биллинг ── */}
      {tab === 'billing' && (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-500">Подписки и платежи всех тенантов</p>
            <button onClick={loadBilling}
              className="text-xs text-[#0097A7] border border-[#0097A7] px-3 py-1.5 rounded-xl hover:bg-[#0097A7]/5 transition">
              Обновить
            </button>
          </div>

          {billing === null && (
            <div className="flex items-center justify-center h-32">
              <div className="w-8 h-8 border-4 border-[#0097A7] border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {billing && (
            <>
              {/* Финансовая сводка */}
              {billing.summary && (
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-2xl p-4 text-center">
                    <p className="text-2xl font-extrabold text-emerald-700">{(billing.summary.total_paid_rub || 0).toLocaleString('ru-RU')} ₽</p>
                    <p className="text-xs text-emerald-600 font-semibold mt-1">Оплачено</p>
                  </div>
                  <div className="bg-amber-50 dark:bg-amber-900/20 rounded-2xl p-4 text-center">
                    <p className="text-2xl font-extrabold text-amber-700">{(billing.summary.total_pending_rub || 0).toLocaleString('ru-RU')} ₽</p>
                    <p className="text-xs text-amber-600 font-semibold mt-1">Ожидает</p>
                  </div>
                  <div className="bg-blue-50 dark:bg-blue-900/20 rounded-2xl p-4 text-center">
                    <p className="text-2xl font-extrabold text-blue-700">{billing.summary.mrr_rub ? (billing.summary.mrr_rub).toLocaleString('ru-RU') + ' ₽' : '—'}</p>
                    <p className="text-xs text-blue-600 font-semibold mt-1">MRR</p>
                  </div>
                </div>
              )}

              {/* Список подписок */}
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {(billing.subscriptions || []).map(s => {
                  const sub = SUB_STATUS[s.status] || { color: 'bg-gray-100 text-gray-500', label: s.status }
                  return (
                    <div key={s.id} className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-100 dark:border-gray-700 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-gray-800 dark:text-white">{s.tenant_name || s.tenant_id}</p>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${sub.color}`}>{sub.label}</span>
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {s.plan} · {s.billing_cycle} · до {s.current_period_end}
                        </p>
                      </div>
                      <p className="text-sm font-bold text-gray-900 dark:text-white flex-shrink-0">
                        {s.amount_per_period ? Number(s.amount_per_period).toLocaleString('ru-RU') + ' ₽' : '—'}
                      </p>
                    </div>
                  )
                })}
                {billing.subscriptions?.length === 0 && (
                  <p className="text-center text-gray-400 text-sm py-8">Подписок нет</p>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Модал: Создать тенант ── */}
      {showProvision && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={e => e.target === e.currentTarget && !provResult && setShowProvision(false)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
            {!provResult ? (
              <>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Создать нового клиента</h2>
                <div className="space-y-3">
                  {[
                    { key: 'name',           label: 'Название клиники/сети',  placeholder: 'ООО "МедЦентр Альфа"' },
                    { key: 'slug',           label: 'URL-идентификатор',      placeholder: 'medcenter-alpha' },
                    { key: 'city',           label: 'Город',                  placeholder: 'Москва' },
                    { key: 'admin_name',     label: 'ФИО руководителя',       placeholder: 'Иванов Иван Иванович' },
                    { key: 'admin_username', label: 'Логин руководителя',     placeholder: 'ivanov_med' },
                    { key: 'admin_password', label: 'Пароль (необязательно)', placeholder: 'авто-генерация если пусто' },
                  ].map(f => (
                    <div key={f.key}>
                      <label className="block text-xs font-medium text-gray-500 mb-1">{f.label}</label>
                      <input value={provForm[f.key]}
                        onChange={e => setProvForm(p => ({ ...p, [f.key]: e.target.value }))}
                        placeholder={f.placeholder}
                        className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0097A7]" />
                    </div>
                  ))}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Тариф</label>
                    <select value={provForm.plan} onChange={e => setProvForm(p => ({ ...p, plan: e.target.value }))}
                      className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm dark:bg-gray-800 dark:text-white">
                      <option value="basic">Basic — 3 клиники, 20 сотрудников</option>
                      <option value="professional">Professional — 10 клиник, 100 сотрудников</option>
                      <option value="enterprise">Enterprise — безлимит</option>
                    </select>
                  </div>
                </div>
                <div className="flex gap-3 mt-5">
                  <button onClick={() => setShowProvision(false)}
                    className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-xl py-2.5 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                    Отмена
                  </button>
                  <button onClick={provision} disabled={provLoading || !provForm.name || !provForm.slug || !provForm.admin_name || !provForm.admin_username}
                    className="flex-1 bg-[#0097A7] text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50 hover:bg-[#00838f] transition">
                    {provLoading ? 'Создание...' : 'Создать'}
                  </button>
                </div>
              </>
            ) : (
              /* Результат создания */
              <div className="text-center">
                <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="material-symbols-outlined text-3xl text-emerald-600" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                </div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Тенант создан!</h2>
                <p className="text-sm text-gray-500 mb-5">Trial 14 дней активирован</p>
                <div className="bg-gray-50 dark:bg-gray-800 rounded-2xl p-4 text-left space-y-2 mb-5">
                  {[
                    { label: 'Название', value: provResult.tenant_name },
                    { label: 'Логин', value: provResult.admin_username },
                    { label: 'Пароль', value: provResult.admin_password, mono: true },
                    { label: 'Trial до', value: provResult.trial_until },
                    { label: 'URL', value: provResult.url },
                  ].map(r => (
                    <div key={r.label} className="flex justify-between text-sm">
                      <span className="text-gray-400">{r.label}</span>
                      <span className={`font-semibold text-gray-800 dark:text-white ${r.mono ? 'font-mono bg-gray-200 dark:bg-gray-700 px-2 py-0.5 rounded' : ''}`}>{r.value}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-amber-600 bg-amber-50 rounded-xl px-3 py-2 mb-4">
                  Сохраните пароль — он больше не будет показан
                </p>
                <button onClick={() => { setShowProvision(false); setProvForm(EMPTY_PROVISION); setProvResult(null); loadTenants() }}
                  className="w-full bg-[#0097A7] text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-[#00838f] transition">
                  Готово
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
