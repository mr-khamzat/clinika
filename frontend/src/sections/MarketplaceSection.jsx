import { useState, useEffect, useCallback, useMemo } from 'react'
import api from '../api'
import { Modal, Button, Chip, useToast } from '../design'

/**
 * ============================================================================
 * MarketplaceSection — витрина модулей для FranchiseOwnerCabinet / super_admin
 * ============================================================================
 * Сетка карточек (4 кол. на десктопе, 2 на мобильном).
 * Hover/tap → модалка с детальным описанием, скриншотами, фичами, кнопками.
 *
 * Эндпоинты:
 *   GET  /marketplace/tenant/{id}/modules                         — каталог + статусы
 *   POST /marketplace/tenant/{id}/modules/{key}/start-trial       — активировать триал
 *   POST /marketplace/tenant/{id}/modules/{key}/activate          — купить
 *   POST /marketplace/tenant/{id}/modules/{key}/cancel            — отписаться
 *
 * Пропсы:
 *   - tenants:  список тенантов франшизы (для селектора)
 *   - tenantId: текущий выбранный uuid (контролируемый)
 *   - onTenantChange: setter
 * ============================================================================
 */

const CATEGORY_LABELS = {
  telephony:    { label: 'Телефония',    color: '#0284c7', bg: 'rgba(2,132,199,.10)',  icon: 'call' },
  ai:           { label: 'AI',           color: '#7c3aed', bg: 'rgba(124,58,237,.10)', icon: 'auto_awesome' },
  advertising:  { label: 'Реклама',      color: '#d97706', bg: 'rgba(217,119,6,.10)',  icon: 'campaign' },
  integrations: { label: 'Интеграции',   color: '#0891b2', bg: 'rgba(8,145,178,.10)',  icon: 'integration_instructions' },
  branding:     { label: 'Бренд',        color: '#db2777', bg: 'rgba(219,39,119,.10)', icon: 'palette' },
  telemedicine: { label: 'Телемедицина', color: '#0d9488', bg: 'rgba(13,148,136,.10)', icon: 'video_call' },
  finance:      { label: 'Финансы',      color: '#16a34a', bg: 'rgba(22,163,74,.10)',  icon: 'payments' },
  inventory:    { label: 'Склад',        color: '#ca8a04', bg: 'rgba(202,138,4,.10)',  icon: 'inventory_2' },
  loyalty:      { label: 'Лояльность',   color: '#e11d48', bg: 'rgba(225,29,72,.10)',  icon: 'stars' },
  health:       { label: 'Здоровье',     color: '#0ea5e9', bg: 'rgba(14,165,233,.10)', icon: 'monitor_heart' },
}

const STATUS_BADGE = {
  active:    { label: 'Подключено',  bg: 'rgba(16,185,129,.15)', fg: '#059669', icon: 'check_circle' },
  trial:     { label: 'Триал',       bg: 'rgba(2,132,199,.15)',  fg: '#0369a1', icon: 'schedule' },
  grace:     { label: 'Льготный',    bg: 'rgba(245,158,11,.15)', fg: '#b45309', icon: 'warning' },
  expired:   { label: 'Истёк',       bg: 'rgba(107,114,128,.15)',fg: '#374151', icon: 'block' },
  cancelled: { label: 'Отписано',    bg: 'rgba(220,38,38,.15)',  fg: '#b91c1c', icon: 'cancel' },
}

const COMPLEXITY = {
  easy:   { label: 'Просто',  color: '#16a34a', icon: 'sentiment_very_satisfied' },
  medium: { label: 'Средне',  color: '#d97706', icon: 'sentiment_neutral' },
  hard:   { label: 'Сложно',  color: '#dc2626', icon: 'engineering' },
}

const FILTERS = [
  { id: 'all',         label: 'Все' },
  { id: 'connected',   label: 'Подключённые' },
  { id: 'available',   label: 'Доступные' },
  { id: 'popular',     label: 'Популярные' },
]

function formatPrice(m) {
  if (m.price_monthly > 0) return `${Math.round(m.price_monthly).toLocaleString('ru')} ₽/мес`
  if (m.monthly_price_demo) return `от ${Math.round(m.monthly_price_demo).toLocaleString('ru')} ₽/мес`
  return 'Бесплатно'
}

function formatDate(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('ru', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch { return iso }
}

export default function MarketplaceSection({ tenants = [], tenantId: tenantIdProp, onTenantChange }) {
  // Если родитель не управляет тенантом — держим локально
  const [innerTid, setInnerTid] = useState('')
  const tenantId = tenantIdProp ?? innerTid
  const setTenantId = onTenantChange || setInnerTid

  const [rows, setRows] = useState([])     // [{module, subscription, trial_used}]
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [catFilter, setCatFilter] = useState('all')
  const [active, setActive] = useState(null) // выбранный модуль для модалки

  const { toast } = useToast()

  // Авто-выбор первого тенанта
  useEffect(() => {
    if (!tenantId && tenants?.length) {
      setTenantId(tenants[0].id)
    }
  }, [tenants, tenantId, setTenantId])

  const load = useCallback(async () => {
    if (!tenantId) {
      setRows([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const r = await api.get(`/marketplace/tenant/${tenantId}/modules`)
      setRows(Array.isArray(r.data) ? r.data : [])
    } catch (e) {
      toast('Не удалось загрузить marketplace: ' + (e.response?.data?.detail || e.message), 'error')
    }
    setLoading(false)
  }, [tenantId, toast])

  useEffect(() => { load() }, [load])

  // Подсчёты для KPI-плашки
  const stats = useMemo(() => {
    const connected = rows.filter(r => r.subscription && ['active', 'trial', 'grace'].includes(r.subscription.status)).length
    const trial     = rows.filter(r => r.subscription?.status === 'trial').length
    const total     = rows.length
    return { connected, trial, total, available: total - connected }
  }, [rows])

  // Все категории в каталоге
  const categories = useMemo(() => {
    const set = new Set(rows.map(r => r.module.category))
    return ['all', ...Array.from(set)]
  }, [rows])

  // Фильтрация + поиск
  const filtered = useMemo(() => {
    return rows.filter(r => {
      const sub = r.subscription
      const status = sub?.status
      if (filter === 'connected' && !['active', 'trial', 'grace'].includes(status)) return false
      if (filter === 'available' && ['active', 'trial', 'grace'].includes(status)) return false
      if (filter === 'popular' && !r.module.popular) return false
      if (catFilter !== 'all' && r.module.category !== catFilter) return false
      if (search) {
        const q = search.toLowerCase()
        if (!r.module.name.toLowerCase().includes(q)
          && !(r.module.description || '').toLowerCase().includes(q)
          && !r.module.key.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [rows, filter, catFilter, search])

  // ─── Действия ─────────────────────────────────────────────────────────────

  async function startTrial(modKey, name, trialDays) {
    if (!tenantId) return
    try {
      const r = await api.post(
        `/marketplace/tenant/${tenantId}/modules/${modKey}/start-trial`,
        {},
      )
      const ends = r.data?.trial_ends_at ? formatDate(r.data.trial_ends_at) : ''
      toast(
        `Триал «${name}» активен до ${ends}. После — автопереход в платный или отписка.`,
        'success',
      )
      setActive(null)
      await load()
    } catch (e) {
      toast('Ошибка триала: ' + (e.response?.data?.detail || e.message), 'error')
    }
  }

  async function activate(modKey, name) {
    if (!tenantId) return
    try {
      await api.post(
        `/marketplace/tenant/${tenantId}/modules/${modKey}/activate`,
        { billing_cycle: 'monthly' },
      )
      toast(`Модуль «${name}» подключён`, 'success')
      setActive(null)
      await load()
    } catch (e) {
      toast('Ошибка активации: ' + (e.response?.data?.detail || e.message), 'error')
    }
  }

  async function cancel(modKey, name) {
    if (!tenantId) return
    if (!window.confirm(`Отписаться от модуля «${name}»? Модуль перестанет работать сразу.`)) return
    try {
      await api.post(`/marketplace/tenant/${tenantId}/modules/${modKey}/cancel`, {})
      toast(`Отписка от «${name}» выполнена`, 'success')
      setActive(null)
      await load()
    } catch (e) {
      toast('Ошибка отписки: ' + (e.response?.data?.detail || e.message), 'error')
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  if (!tenants?.length) {
    return (
      <div className="p-8 text-center text-gray-500">
        <span className="material-symbols-outlined text-5xl text-gray-300 mb-2 block">storefront</span>
        Нет доступных тенантов для управления подписками.
      </div>
    )
  }

  const selectedTenant = tenants.find(t => t.id === tenantId)

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Заголовок + статистика */}
      <div className="mb-6 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">
              Маркетплейс модулей
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Подключайте новые возможности по триалу — без оплаты на 14 дней
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <Chip variant="accent">Всего: {stats.total}</Chip>
            <Chip variant="good">Подключено: {stats.connected}</Chip>
            <Chip variant="warn">Триалов: {stats.trial}</Chip>
          </div>
        </div>

        {/* Селектор тенанта */}
        {tenants.length > 1 && (
          <div className="bg-blue-50/50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-2xl p-3 flex items-center gap-3 flex-wrap">
            <span className="material-symbols-outlined text-blue-600">business</span>
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Клиника:</span>
            <select value={tenantId} onChange={e => setTenantId(e.target.value)}
              className="border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-800 dark:text-white min-w-[240px]">
              {tenants.map(t => (
                <option key={t.id} value={t.id}>{t.name}{t.slug ? ` (${t.slug})` : ''}</option>
              ))}
            </select>
          </div>
        )}

        {/* Фильтры */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-base">search</span>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Поиск по названию или описанию..."
              className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            {FILTERS.map(f => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`px-3 py-2 rounded-xl text-sm font-medium transition-all ${
                  filter === f.id
                    ? 'bg-blue-600 text-white shadow-md scale-[1.02]'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 hover:scale-[1.02]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Категории */}
        {categories.length > 1 && (
          <div className="flex gap-2 flex-wrap pb-1 -mx-1 overflow-x-auto">
            {categories.map(c => {
              const meta = CATEGORY_LABELS[c]
              return (
                <button
                  key={c}
                  onClick={() => setCatFilter(c)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all whitespace-nowrap ${
                    catFilter === c
                      ? 'bg-gray-900 text-white border-gray-900 dark:bg-white dark:text-gray-900 dark:border-white'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700'
                  }`}
                >
                  {c === 'all' ? 'Все категории' : (meta?.label || c)}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Сетка карточек */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-2xl bg-gray-100 dark:bg-gray-800 animate-pulse h-64" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-12 text-center text-gray-500 bg-gray-50 dark:bg-gray-800/50 rounded-2xl">
          <span className="material-symbols-outlined text-5xl text-gray-300 dark:text-gray-600 mb-2 block">search_off</span>
          <p>Модулей по выбранным фильтрам не найдено.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map(row => (
            <ModuleCard
              key={row.module.key}
              row={row}
              onOpen={() => setActive(row)}
            />
          ))}
        </div>
      )}

      {/* Модалка деталей */}
      {active && (
        <ModuleDetailModal
          row={active}
          tenantName={selectedTenant?.name || ''}
          onClose={() => setActive(null)}
          onStartTrial={startTrial}
          onActivate={activate}
          onCancel={cancel}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Карточка модуля (в сетке)
// ─────────────────────────────────────────────────────────────────────────────

function ModuleCard({ row, onOpen }) {
  const m = row.module
  const sub = row.subscription
  const cat = CATEGORY_LABELS[m.category] || { label: m.category, color: '#6b7280', bg: 'rgba(107,114,128,.10)', icon: 'extension' }
  const status = sub?.status
  const badge = status ? STATUS_BADGE[status] : null

  // «Триал заканчивается через X дней»
  let trialDaysLeft = null
  if (status === 'trial' && sub?.trial_ends_at) {
    const ms = new Date(sub.trial_ends_at).getTime() - Date.now()
    trialDaysLeft = Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)))
  }

  return (
    <button
      onClick={onOpen}
      className="group relative text-left bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-4 hover:shadow-xl hover:-translate-y-1 hover:border-blue-300 dark:hover:border-blue-600 transition-all duration-200 overflow-hidden flex flex-col"
      style={{ minHeight: 240 }}
    >
      {/* Декоративный градиент в углу */}
      <div
        className="absolute -top-12 -right-12 w-32 h-32 rounded-full opacity-30 group-hover:opacity-60 transition-opacity duration-300 blur-2xl pointer-events-none"
        style={{ background: cat.bg.replace('.10)', '.4)') }}
      />

      {/* Popular badge */}
      {m.popular && (
        <span className="absolute top-3 right-3 z-10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-gradient-to-r from-amber-400 to-orange-500 text-white shadow-sm">
          Популярно
        </span>
      )}

      {/* Иконка + категория */}
      <div className="flex items-center gap-3 mb-3 relative">
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110 group-hover:rotate-3"
          style={{ background: cat.bg, color: cat.color }}
        >
          <span className="material-symbols-outlined text-2xl">{cat.icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: cat.color }}>
            {cat.label}
          </p>
        </div>
      </div>

      {/* Название */}
      <h3 className="font-semibold text-gray-900 dark:text-white text-base mb-1 leading-tight line-clamp-2">
        {m.name}
      </h3>

      {/* Описание */}
      <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2 mb-3 flex-1">
        {m.description || '—'}
      </p>

      {/* Footer: цена + status */}
      <div className="flex items-end justify-between gap-2 pt-2 border-t border-gray-100 dark:border-gray-700">
        <div>
          <p className="text-xs text-gray-400 mb-0.5">Стоимость</p>
          <p className="font-bold text-gray-900 dark:text-white text-sm">
            {formatPrice(m)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {badge && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium"
              style={{ background: badge.bg, color: badge.fg }}
            >
              <span className="material-symbols-outlined text-[12px]">{badge.icon}</span>
              {badge.label}
            </span>
          )}
          {trialDaysLeft !== null && (
            <span className="text-[10px] text-gray-400">осталось {trialDaysLeft} дн.</span>
          )}
        </div>
      </div>
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Модалка деталей: скриншоты, фичи, кнопки действий
// ─────────────────────────────────────────────────────────────────────────────

function ModuleDetailModal({ row, tenantName, onClose, onStartTrial, onActivate, onCancel }) {
  const m = row.module
  const sub = row.subscription
  const trialUsed = row.trial_used
  const cat = CATEGORY_LABELS[m.category] || { label: m.category, color: '#6b7280', bg: 'rgba(107,114,128,.10)', icon: 'extension' }
  const cx = COMPLEXITY[m.setup_complexity] || COMPLEXITY.easy
  const status = sub?.status
  const isConnected = ['active', 'trial', 'grace'].includes(status)
  const features = m.features_list || []
  const screenshots = m.screenshots || []
  const trialDays = m.default_trial_days || 14

  // Carousel state
  const [shotIdx, setShotIdx] = useState(0)
  useEffect(() => { setShotIdx(0) }, [m.key])

  return (
    <Modal open onClose={onClose} title={null} size="lg">
      <div className="max-h-[85vh] overflow-y-auto -m-4 sm:-m-6">
        {/* Шапка с градиентом */}
        <div
          className="px-6 py-5 relative overflow-hidden"
          style={{ background: `linear-gradient(135deg, ${cat.bg}, transparent)` }}
        >
          <div className="flex items-start gap-4 relative">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-md shrink-0"
              style={{ background: cat.bg, color: cat.color }}
            >
              <span className="material-symbols-outlined text-3xl">{cat.icon}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: cat.color }}>
                  {cat.label}
                </span>
                {m.popular && (
                  <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-gradient-to-r from-amber-400 to-orange-500 text-white">
                    Популярно
                  </span>
                )}
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mb-1">
                {m.name}
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                {m.description}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-700 dark:hover:text-white transition shrink-0"
              aria-label="Закрыть"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Скриншоты-карусель */}
          {screenshots.length > 0 && (
            <div className="relative bg-gray-900 rounded-2xl overflow-hidden aspect-video group">
              <img
                src={screenshots[shotIdx]}
                alt={`${m.name} — скриншот ${shotIdx + 1}`}
                className="w-full h-full object-contain transition-opacity duration-300"
                onError={e => { e.currentTarget.style.display = 'none' }}
              />
              {screenshots.length > 1 && (
                <>
                  <button
                    onClick={() => setShotIdx(i => (i - 1 + screenshots.length) % screenshots.length)}
                    className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 hover:bg-black/60 text-white flex items-center justify-center transition opacity-0 group-hover:opacity-100"
                    aria-label="Назад"
                  >
                    <span className="material-symbols-outlined">chevron_left</span>
                  </button>
                  <button
                    onClick={() => setShotIdx(i => (i + 1) % screenshots.length)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 hover:bg-black/60 text-white flex items-center justify-center transition opacity-0 group-hover:opacity-100"
                    aria-label="Далее"
                  >
                    <span className="material-symbols-outlined">chevron_right</span>
                  </button>
                  <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
                    {screenshots.map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setShotIdx(i)}
                        className={`w-1.5 h-1.5 rounded-full transition-all ${
                          i === shotIdx ? 'bg-white w-6' : 'bg-white/40 hover:bg-white/70'
                        }`}
                        aria-label={`Слайд ${i + 1}`}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Мета-плашки */}
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800">
              <span className="material-symbols-outlined text-base" style={{ color: cx.color }}>{cx.icon}</span>
              <div>
                <p className="text-[10px] uppercase text-gray-400 leading-none">Подключение</p>
                <p className="text-sm font-semibold text-gray-900 dark:text-white">{cx.label}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800">
              <span className="material-symbols-outlined text-base text-blue-600">payments</span>
              <div>
                <p className="text-[10px] uppercase text-gray-400 leading-none">Стоимость</p>
                <p className="text-sm font-semibold text-gray-900 dark:text-white">{formatPrice(m)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800">
              <span className="material-symbols-outlined text-base text-emerald-600">schedule</span>
              <div>
                <p className="text-[10px] uppercase text-gray-400 leading-none">Триал</p>
                <p className="text-sm font-semibold text-gray-900 dark:text-white">{trialDays} дней</p>
              </div>
            </div>
            {sub && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800">
                <span className="material-symbols-outlined text-base text-gray-500">verified</span>
                <div>
                  <p className="text-[10px] uppercase text-gray-400 leading-none">Статус</p>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">
                    {STATUS_BADGE[status]?.label || status}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Features list */}
          {features.length > 0 && (
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300 mb-2">
                Что вы получите
              </h3>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                {features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-200">
                    <span className="material-symbols-outlined text-emerald-500 text-base shrink-0 mt-0.5">check_circle</span>
                    <span>{String(f).replace(/^[✓✔]\s*/, '')}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Trial info при активном триале */}
          {status === 'trial' && sub?.trial_ends_at && (
            <div className="rounded-2xl border border-blue-200 dark:border-blue-700 bg-blue-50/60 dark:bg-blue-900/20 p-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="material-symbols-outlined text-blue-600">schedule</span>
                <p className="font-semibold text-blue-900 dark:text-blue-200">Триал активен</p>
              </div>
              <p className="text-sm text-blue-800 dark:text-blue-300">
                Завершится {formatDate(sub.trial_ends_at)}. После — автопереход в платный или отписка.
              </p>
            </div>
          )}

          {/* Кабинет */}
          {tenantName && (
            <p className="text-xs text-gray-400">
              Действие применится для клиники: <span className="font-medium text-gray-600 dark:text-gray-300">{tenantName}</span>
            </p>
          )}

          {/* Кнопки действий */}
          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            {!isConnected && !trialUsed && (
              <Button
                variant="primary"
                className="flex-1"
                onClick={() => onStartTrial(m.key, m.name, trialDays)}
              >
                <span className="material-symbols-outlined text-base mr-1">rocket_launch</span>
                Начать триал {trialDays} дней
              </Button>
            )}
            {!isConnected && (
              <Button
                variant={trialUsed ? 'primary' : 'secondary'}
                className="flex-1"
                onClick={() => onActivate(m.key, m.name)}
              >
                <span className="material-symbols-outlined text-base mr-1">shopping_cart</span>
                Купить{m.price_monthly > 0 ? ` за ${Math.round(m.price_monthly).toLocaleString('ru')} ₽/мес` : ''}
              </Button>
            )}
            {isConnected && (
              <Button
                variant="danger"
                className="flex-1"
                onClick={() => onCancel(m.key, m.name)}
              >
                <span className="material-symbols-outlined text-base mr-1">cancel</span>
                Отписаться
              </Button>
            )}
          </div>

          {trialUsed && !isConnected && (
            <p className="text-xs text-gray-400 text-center">
              Триал этого модуля уже использовался — доступна только платная активация.
            </p>
          )}
        </div>
      </div>
    </Modal>
  )
}
