import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import { API_BASE } from '../config'

/**
 * ============================================================================
 * БЛОК: ModulesCatalogSection — каталог платных модулей платформы
 * ============================================================================
 * Совмещённая секция:
 *   • super_admin → редактируемый каталог (цены / активность модулей).
 *   • franchise_owner → read-only каталог + статусы по своим тенантам
 *     (активен / триал / выключен).
 *
 * Endpoints:
 *   GET /admin/modules                                  — каталог (super_admin)
 *   PUT /admin/modules/{key}/price                      — цена (super_admin)
 *   PATCH /admin/modules/{key}                          — toggle (super_admin)
 *   GET /franchise-owner/tenants                        — список тенантов (owner)
 *   GET /franchise-owner/tenants/{id}                   — модули тенанта (owner)
 *
 * NOTE: enable/disable per-tenant делает только super_admin через
 *   POST /admin/tenants/{id}/modules/{key}/enable. Для franchise_owner
 *   эквивалентного эндпоинта нет — кнопка показывает TODO-уведомление
 *   («запросите подключение у платформы»).
 * ============================================================================
 */

const CATEGORY_LABELS = {
  telephony:   { label: 'Телефония',   color: '#0284c7', bg: 'rgba(2,132,199,.1)',  icon: 'call' },
  ai:          { label: 'AI',          color: '#7c3aed', bg: 'rgba(124,58,237,.1)', icon: 'auto_awesome' },
  advertising: { label: 'Реклама',     color: '#d97706', bg: 'rgba(217,119,6,.1)',  icon: 'campaign' },
  integrations:{ label: 'Интеграции',  color: '#0891b2', bg: 'rgba(8,145,178,.1)',  icon: 'integration_instructions' },
  branding:    { label: 'Бренд',       color: '#db2777', bg: 'rgba(219,39,119,.1)', icon: 'palette' },
}

const STATUS_BADGE = {
  active:    { label: 'Активен',    bg: 'rgba(16,185,129,.12)', fg: '#059669' },
  trial:     { label: 'Триал',      bg: 'rgba(2,132,199,.12)',  fg: '#0369a1' },
  grace:     { label: 'Льготный',   bg: 'rgba(245,158,11,.12)', fg: '#b45309' },
  expired:   { label: 'Истёк',      bg: 'rgba(107,114,128,.12)',fg: '#374151' },
  cancelled: { label: 'Отменён',    bg: 'rgba(220,38,38,.12)',  fg: '#b91c1c' },
}

function authH(token) { return { Authorization: `Bearer ${token}` } }

// ── Хелпер: понимаем роль из URL (если переданы пропсы — приоритет) ──
function detectMode(propMode) {
  if (propMode) return propMode
  // На /franchise-owner/* кабинете показываем owner-режим, иначе super_admin
  if (typeof window !== 'undefined') {
    const p = (window.location?.pathname || '').toLowerCase()
    if (p.includes('franchise')) return 'owner'
  }
  return 'admin'
}

export default function ModulesCatalogSection({ token, mode: propMode }) {
  const mode = detectMode(propMode)
  return mode === 'owner'
    ? <OwnerCatalog token={token} />
    : <AdminCatalog token={token} />
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin (super_admin) — оригинальная редактируемая секция
// ─────────────────────────────────────────────────────────────────────────────

function AdminCatalog({ token }) {
  const [modules, setModules]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [editKey, setEditKey]   = useState(null)
  const [editPrice, setEditPrice] = useState({ monthly: '', annual: '' })
  const [saving, setSaving]     = useState(false)
  const [msg, setMsg]           = useState('')
  const [filterCat, setFilterCat] = useState('all')

  // ── Селектор тенанта + статус подписок (super_admin) ──
  // tenants: [{id, name, slug, ...}]
  // tenantId: выбранный uuid
  // tenantSubs: { module_key: subscription } — текущие подписки выбранного тенанта
  const [tenants, setTenants]   = useState([])
  const [tenantId, setTenantId] = useState('')
  const [tenantSubs, setTenantSubs] = useState({})
  const [busyKey, setBusyKey]   = useState(null) // ключ модуля при операции trial/disable

  // Загрузка каталога модулей платформы
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await axios.get(`${API_BASE}/admin/modules`, { headers: authH(token) })
      setModules(r.data)
    } catch {}
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  // Загрузка списка тенантов один раз
  useEffect(() => {
    let aborted = false
    axios.get(`${API_BASE}/admin/tenants`, { headers: authH(token) })
      .then(r => {
        if (aborted) return
        const list = Array.isArray(r.data) ? r.data : []
        setTenants(list)
        if (list.length && !tenantId) setTenantId(list[0].id)
      })
      .catch(() => {})
    return () => { aborted = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  // Загрузка подписок выбранного тенанта (по /admin/tenants/{id}/modules)
  const loadTenantSubs = useCallback(async () => {
    if (!tenantId) { setTenantSubs({}); return }
    try {
      const r = await axios.get(
        `${API_BASE}/admin/tenants/${tenantId}/modules`,
        { headers: authH(token) }
      )
      // ответ: [{module: {...}, subscription: {...}|null}]
      const map = {}
      for (const row of (r.data || [])) {
        if (row.subscription) map[row.module.key] = row.subscription
      }
      setTenantSubs(map)
    } catch {
      setTenantSubs({})
    }
  }, [token, tenantId])

  useEffect(() => { loadTenantSubs() }, [loadTenantSubs])

  function openEdit(m) {
    setEditKey(m.key)
    setEditPrice({ monthly: String(m.price_monthly), annual: String(m.price_annual) })
  }

  async function savePrice() {
    setSaving(true)
    try {
      await axios.put(
        `${API_BASE}/admin/modules/${editKey}/price`,
        { price_monthly: Number(editPrice.monthly), price_annual: Number(editPrice.annual) },
        { headers: authH(token) }
      )
      setMsg('Цена обновлена ✓')
      setEditKey(null)
      await load()
    } catch (e) {
      setMsg('Ошибка: ' + (e.response?.data?.detail || e.message))
    }
    setSaving(false)
    setTimeout(() => setMsg(''), 4000)
  }

  async function toggleActive(m) {
    try {
      await axios.patch(
        `${API_BASE}/admin/modules/${m.key}`,
        { is_active: !m.is_active },
        { headers: authH(token) }
      )
      await load()
    } catch (e) {
      setMsg('Ошибка: ' + (e.response?.data?.detail || e.message))
      setTimeout(() => setMsg(''), 4000)
    }
  }

  // ── Активация trial-подписки модуля для выбранного тенанта ──
  // POST /admin/tenants/{tid}/modules/{key}/enable  body: {trial_days, billing_cycle}
  async function activateTrial(modKey, days = 30) {
    if (!tenantId) {
      setMsg('Ошибка: выберите тенанта')
      setTimeout(() => setMsg(''), 4000)
      return
    }
    setBusyKey(modKey)
    try {
      await axios.post(
        `${API_BASE}/admin/tenants/${tenantId}/modules/${modKey}/enable`,
        { trial_days: days, billing_cycle: 'monthly' },
        { headers: authH(token) }
      )
      setMsg(`Trial (${days} дн.) активирован для модуля ${modKey} ✓`)
      await loadTenantSubs()
    } catch (e) {
      setMsg('Ошибка: ' + (e.response?.data?.detail || e.message))
    } finally {
      setBusyKey(null)
      setTimeout(() => setMsg(''), 4000)
    }
  }

  // ── Полное активирование (без trial — сразу платная подписка) ──
  async function activateFull(modKey) {
    if (!tenantId) {
      setMsg('Ошибка: выберите тенанта'); setTimeout(() => setMsg(''), 4000); return
    }
    setBusyKey(modKey)
    try {
      await axios.post(
        `${API_BASE}/admin/tenants/${tenantId}/modules/${modKey}/enable`,
        { trial_days: 0, billing_cycle: 'monthly' },
        { headers: authH(token) }
      )
      setMsg(`Модуль ${modKey} активирован ✓`)
      await loadTenantSubs()
    } catch (e) {
      setMsg('Ошибка: ' + (e.response?.data?.detail || e.message))
    } finally {
      setBusyKey(null)
      setTimeout(() => setMsg(''), 4000)
    }
  }

  // ── Отключение модуля у тенанта (cancel) ──
  async function disableForTenant(modKey) {
    if (!tenantId) return
    setBusyKey(modKey)
    try {
      await axios.post(
        `${API_BASE}/admin/tenants/${tenantId}/modules/${modKey}/disable`,
        {},
        { headers: authH(token) }
      )
      setMsg(`Модуль ${modKey} отключён ✓`)
      await loadTenantSubs()
    } catch (e) {
      setMsg('Ошибка: ' + (e.response?.data?.detail || e.message))
    } finally {
      setBusyKey(null)
      setTimeout(() => setMsg(''), 4000)
    }
  }

  const categories = ['all', ...Object.keys(CATEGORY_LABELS)]
  const filtered = filterCat === 'all' ? modules : modules.filter(m => m.category === filterCat)
  const selectedTenant = tenants.find(t => t.id === tenantId)

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Каталог модулей</h1>
          <p className="text-sm text-gray-500 mt-1">Управление платными модулями платформы и подписками тенантов</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {categories.map(c => (
            <button key={c} onClick={() => setFilterCat(c)}
              className={`px-3 py-1.5 rounded-xl text-sm font-medium transition ${
                filterCat === c
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300'
              }`}>
              {c === 'all' ? 'Все' : CATEGORY_LABELS[c]?.label || c}
            </button>
          ))}
        </div>
      </div>

      {/* ─── Селектор тенанта (для управления подписками) ─── */}
      <div className="mb-6 bg-blue-50/50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-2xl p-4 flex items-center gap-3 flex-wrap">
        <span className="material-symbols-outlined text-blue-600">business</span>
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Тенант для управления подписками:</span>
        <select value={tenantId} onChange={e => setTenantId(e.target.value)}
          className="border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-800 dark:text-white min-w-[240px]">
          {tenants.length === 0 && <option value="">— нет тенантов —</option>}
          {tenants.map(t => (
            <option key={t.id} value={t.id}>{t.name}{t.slug ? ` (${t.slug})` : ''}</option>
          ))}
        </select>
        {selectedTenant && (
          <span className="text-xs text-gray-500">
            план: <b>{selectedTenant.plan || '—'}</b> | клиник: {selectedTenant.clinics_count} | юзеров: {selectedTenant.users_count}
          </span>
        )}
      </div>

      {msg && (
        <div className={`mb-4 px-4 py-3 rounded-xl text-sm ${msg.startsWith('Ошибка') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {msg}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-8 text-center text-gray-500 border border-gray-100 dark:border-gray-700">
          В каталоге нет модулей. Запустите seed (commercial_modules).
        </div>
      ) : (
        <div className="grid gap-4">
          {filtered.map(m => {
            const cat = CATEGORY_LABELS[m.category] || { label: m.category, color: '#6b7280', bg: 'rgba(107,114,128,.1)', icon: 'widgets' }
            const isEditing = editKey === m.key
            // Подписка выбранного тенанта на этот модуль (если есть)
            const sub    = tenantSubs[m.key]
            const status = sub?.status || 'disabled'
            const badge  = STATUS_BADGE[status] || { label: 'Не подключён', bg: 'rgba(107,114,128,.12)', fg: '#374151' }
            const expires = sub?.expires_at || sub?.trial_ends_at || sub?.grace_until
            const busy   = busyKey === m.key
            return (
              <div key={m.key} className={`bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border transition ${m.is_active ? 'border-gray-100 dark:border-gray-700' : 'border-gray-200 dark:border-gray-600 opacity-60'}`}>
                <div className="flex items-start gap-4">
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: cat.bg }}>
                    <span className="material-symbols-outlined text-xl" style={{ color: cat.color, fontVariationSettings: "'FILL' 1" }}>{cat.icon}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-gray-900 dark:text-white">{m.name}</span>
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium"
                        style={{ background: cat.bg, color: cat.color }}>{cat.label}</span>
                      <span className="font-mono text-xs text-gray-400 bg-gray-50 dark:bg-gray-900 px-2 py-0.5 rounded-lg">{m.key}</span>
                      {tenantId && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium ml-auto"
                          style={{ background: badge.bg, color: badge.fg }}>{badge.label}</span>
                      )}
                    </div>
                    {m.description && (
                      <p className="text-sm text-gray-500 mt-1 leading-snug">{m.description}</p>
                    )}
                    {m.included_in_plans?.length > 0 && (
                      <div className="flex gap-1 mt-1.5">
                        <span className="text-xs text-gray-400">Включён в:</span>
                        {m.included_in_plans.map(p => (
                          <span key={p} className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-md font-medium">{p}</span>
                        ))}
                      </div>
                    )}
                    {expires && (
                      <p className="text-xs text-gray-400 mt-1">
                        {sub?.status === 'trial' ? 'Триал до' : sub?.status === 'grace' ? 'Льготный период до' : 'Действует до'}
                        &nbsp;{new Date(expires).toLocaleDateString('ru')}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-3 flex-shrink-0">
                    {!isEditing ? (
                      <>
                        <div className="text-right">
                          <div className="text-base font-bold text-gray-800 dark:text-white">
                            {Number(m.price_monthly).toLocaleString('ru')} ₽/мес
                          </div>
                          {Number(m.price_annual) > 0 && (
                            <div className="text-xs text-gray-400">{Number(m.price_annual).toLocaleString('ru')} ₽/год</div>
                          )}
                        </div>
                        <button onClick={() => openEdit(m)}
                          title="Редактировать цену"
                          className="p-2 rounded-xl bg-gray-50 hover:bg-blue-50 text-gray-500 hover:text-blue-600 dark:bg-gray-700 dark:hover:bg-blue-900/30 transition">
                          <span className="material-symbols-outlined text-lg">edit</span>
                        </button>
                        <button onClick={() => toggleActive(m)}
                          title={m.is_active ? 'Деактивировать в каталоге' : 'Активировать в каталоге'}
                          className={`p-2 rounded-xl transition ${m.is_active ? 'bg-green-50 text-green-600 hover:bg-red-50 hover:text-red-500' : 'bg-gray-50 text-gray-400 hover:bg-green-50 hover:text-green-600'} dark:bg-gray-700`}>
                          <span className="material-symbols-outlined text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>
                            {m.is_active ? 'toggle_on' : 'toggle_off'}
                          </span>
                        </button>
                      </>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div>
                          <label className="text-xs text-gray-400 block mb-0.5">Мес. ₽</label>
                          <input value={editPrice.monthly}
                            onChange={e => setEditPrice(p => ({ ...p, monthly: e.target.value }))}
                            className="w-24 border border-gray-200 rounded-lg px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                            type="number" min="0" />
                        </div>
                        <div>
                          <label className="text-xs text-gray-400 block mb-0.5">Год. ₽</label>
                          <input value={editPrice.annual}
                            onChange={e => setEditPrice(p => ({ ...p, annual: e.target.value }))}
                            className="w-24 border border-gray-200 rounded-lg px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                            type="number" min="0" />
                        </div>
                        <div className="flex flex-col gap-1 mt-4">
                          <button onClick={savePrice} disabled={saving}
                            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                            {saving ? '...' : 'Сохранить'}
                          </button>
                          <button onClick={() => setEditKey(null)}
                            className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-sm dark:bg-gray-700 dark:text-gray-300">
                            Отмена
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* ─── Управление подпиской выбранного тенанта ─── */}
                {tenantId && !isEditing && (
                  <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700 flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-gray-500 mr-2">Подписка тенанта:</span>
                    {(!sub || status === 'cancelled' || status === 'expired') && (
                      <>
                        <button onClick={() => activateTrial(m.key, 14)} disabled={busy}
                          className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold disabled:opacity-50 inline-flex items-center gap-1">
                          <span className="material-symbols-outlined text-sm">science</span>
                          Trial 14 дн.
                        </button>
                        <button onClick={() => activateTrial(m.key, 30)} disabled={busy}
                          className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold disabled:opacity-50 inline-flex items-center gap-1">
                          <span className="material-symbols-outlined text-sm">science</span>
                          Trial 30 дн.
                        </button>
                        <button onClick={() => activateFull(m.key)} disabled={busy}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold disabled:opacity-50 inline-flex items-center gap-1">
                          <span className="material-symbols-outlined text-sm">check_circle</span>
                          Активировать
                        </button>
                      </>
                    )}
                    {sub && (status === 'trial' || status === 'active' || status === 'grace') && (
                      <>
                        {status === 'trial' && (
                          <button onClick={() => activateFull(m.key)} disabled={busy}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold disabled:opacity-50 inline-flex items-center gap-1">
                            <span className="material-symbols-outlined text-sm">upgrade</span>
                            Перевести на платную
                          </button>
                        )}
                        <button onClick={() => disableForTenant(m.key)} disabled={busy}
                          className="px-3 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold disabled:opacity-50 inline-flex items-center gap-1">
                          <span className="material-symbols-outlined text-sm">block</span>
                          Отключить
                        </button>
                      </>
                    )}
                    {busy && <span className="text-xs text-gray-400">…</span>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Owner (franchise_owner) — read-only каталог + статусы по своим тенантам
// ─────────────────────────────────────────────────────────────────────────────

function OwnerCatalog({ token }) {
  const [tenants, setTenants]       = useState([])
  const [tenantId, setTenantId]     = useState('')
  const [tenantData, setTenantData] = useState(null) // { modules: [{module_key, status, ...}] }
  const [catalog, setCatalog]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [filterCat, setFilterCat]   = useState('all')
  const [msg, setMsg]               = useState('')

  // Загрузка списка моих тенантов и публичного каталога модулей
  useEffect(() => {
    let aborted = false
    async function init() {
      setLoading(true)
      try {
        const [tRes, mRes] = await Promise.all([
          axios.get(`${API_BASE}/franchise-owner/tenants`, { headers: authH(token) }),
          // /modules/features даёт публичный список модулей с метаданными;
          // фоллбэк через /admin/modules недоступен для owner-роли (403).
          axios.get(`${API_BASE}/modules/features`, { headers: authH(token) }).catch(() => ({ data: [] })),
        ])
        if (aborted) return
        setTenants(tRes.data || [])
        if (tRes.data?.length) setTenantId(tRes.data[0].id)
        setCatalog(mRes.data || [])
      } catch (e) {
        if (!aborted) setMsg('Не удалось загрузить данные')
      } finally {
        if (!aborted) setLoading(false)
      }
    }
    init()
    return () => { aborted = true }
  }, [token])

  // Загрузка модулей выбранного тенанта
  useEffect(() => {
    if (!tenantId) return
    let aborted = false
    axios.get(`${API_BASE}/franchise-owner/tenants/${tenantId}`, { headers: authH(token) })
      .then(r => { if (!aborted) setTenantData(r.data) })
      .catch(() => { if (!aborted) setTenantData(null) })
    return () => { aborted = true }
  }, [tenantId, token])

  function requestEnable(modKey) {
    // TODO: бэк-эндпоинт «запрос на подключение модуля» для franchise_owner
    // отсутствует. Пока показываем уведомление с инструкцией.
    setMsg(`Чтобы подключить модуль "${modKey}", обратитесь в поддержку платформы (admin@клиниксеть.рф) или к super_admin.`)
    setTimeout(() => setMsg(''), 6000)
  }

  // Маппа: module_key → subscription
  const subsMap = {}
  for (const m of (tenantData?.modules || [])) subsMap[m.module_key] = m

  // Категории: используем catalog если есть, иначе подписки
  const sourceList = catalog.length
    ? catalog.map(c => ({
        key: c.name,                    // /modules/features даёт {name, label, ...}
        name: c.label || c.name,
        description: '',
        category: c.category || 'other',
        price_monthly: 0,
        price_annual: 0,
      }))
    : Object.values(subsMap).map(s => ({
        key: s.module_key,
        name: s.module_key,
        category: 'other',
        price_monthly: 0,
      }))

  const categories = ['all', ...new Set(sourceList.map(m => m.category))]
  const filtered = filterCat === 'all' ? sourceList : sourceList.filter(m => m.category === filterCat)

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Модули франшизы</h1>
          <p className="text-sm text-gray-500 mt-1">
            Подписки тенанта: статус, тариф, продление. Подключение/отключение —
            через службу поддержки платформы.
          </p>
        </div>
        {tenants.length > 1 && (
          <select value={tenantId} onChange={e => setTenantId(e.target.value)}
            className="border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-800 dark:text-white">
            {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
      </div>

      {msg && (
        <div className="mb-4 px-4 py-3 rounded-xl text-sm bg-blue-50 text-blue-800 border border-blue-200">
          {msg}
        </div>
      )}

      <div className="flex gap-2 mb-5 flex-wrap">
        {categories.map(c => (
          <button key={c} onClick={() => setFilterCat(c)}
            className={`px-3 py-1.5 rounded-xl text-sm font-medium transition ${
              filterCat === c
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300'
            }`}>
            {c === 'all' ? 'Все' : CATEGORY_LABELS[c]?.label || c}
          </button>
        ))}
      </div>

      <div className="grid gap-4">
        {filtered.length === 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-8 text-center text-gray-500 border border-gray-100 dark:border-gray-700">
            Каталог модулей пуст. Обратитесь к платформе.
          </div>
        )}
        {filtered.map(m => {
          const cat = CATEGORY_LABELS[m.category] || { label: m.category, color: '#6b7280', bg: 'rgba(107,114,128,.1)', icon: 'widgets' }
          const sub = subsMap[m.key]
          const status = sub?.status || 'disabled'
          const badge = STATUS_BADGE[status] || { label: 'Не подключён', bg: 'rgba(107,114,128,.12)', fg: '#374151' }
          const expires = sub?.expires_at || sub?.trial_ends_at || sub?.grace_until
          return (
            <div key={m.key} className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
              <div className="flex items-start gap-4">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: cat.bg }}>
                  <span className="material-symbols-outlined text-xl"
                    style={{ color: cat.color, fontVariationSettings: "'FILL' 1" }}>{cat.icon}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-gray-900 dark:text-white">{m.name}</span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium"
                      style={{ background: cat.bg, color: cat.color }}>{cat.label}</span>
                    <span className="font-mono text-xs text-gray-400 bg-gray-50 dark:bg-gray-900 px-2 py-0.5 rounded-lg">{m.key}</span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium ml-auto"
                      style={{ background: badge.bg, color: badge.fg }}>{badge.label}</span>
                  </div>
                  {m.description && (
                    <p className="text-sm text-gray-500 mt-1 leading-snug">{m.description}</p>
                  )}
                  {expires && (
                    <p className="text-xs text-gray-400 mt-1">
                      {sub?.status === 'trial' ? 'Триал до' : sub?.status === 'grace' ? 'Льготный период до' : 'Действует до'}
                      &nbsp;{new Date(expires).toLocaleDateString('ru')}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {Number(m.price_monthly) > 0 && (
                    <div className="text-right">
                      <div className="text-base font-bold text-gray-800 dark:text-white">
                        {Number(m.price_monthly).toLocaleString('ru')} ₽/мес
                      </div>
                      {Number(m.price_annual) > 0 && (
                        <div className="text-xs text-gray-400">{Number(m.price_annual).toLocaleString('ru')} ₽/год</div>
                      )}
                    </div>
                  )}
                  {!sub && (
                    <button onClick={() => requestEnable(m.key)}
                      className="px-3 py-1.5 rounded-xl text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition">
                      Запросить
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
