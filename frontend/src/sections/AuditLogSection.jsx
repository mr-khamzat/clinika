/**
 * ========================================
 * БЛОК: <AuditLogSection> — журнал аудита (W4)
 * ========================================
 * UI к /audit/* endpoint'ам:
 *   GET /audit/feed                  — объединённый журнал (audit_log + activity_log)
 *   GET /audit/log                   — только audit_log с фильтрами
 *   GET /audit/actions               — список известных action-констант
 *   GET /audit/log/export.csv        — выгрузка CSV (UTF-8 BOM, ; для Excel)
 *
 * Две вкладки:
 *   • «Лента» — reverse-chronological список последних 100 событий
 *   • «Поиск» — фильтры (период, action type, entity type, actor по имени)
 *
 * Все строки — на русском, иконки Material Symbols.
 * ========================================
 */
import { useEffect, useMemo, useState, useCallback } from 'react'
import api from '../api'
import { Tabs, Chip, Card, Button, EmptyState } from '../design'

// ── Флаг страны через Emoji (regional indicator symbols) ────────────────────
function flagFromCountry(code) {
  if (!code || code.length !== 2) return ''
  const A = 0x1F1E6
  return String.fromCodePoint(...code.toUpperCase().split('').map(c => A + c.charCodeAt(0) - 65))
}

function formatGeoLocation(e) {
  const parts = []
  if (e.geo_city) parts.push(e.geo_city)
  if (e.geo_country_name) parts.push(e.geo_country_name)
  else if (e.geo_country) parts.push(e.geo_country)
  return parts.join(', ')
}

// ── Хелперы: иконка + цвет по action ────────────────────────────────────────
// Маппинг типов действий в иконку + tone (для chip).
function actionMeta(action) {
  if (!action) return { icon: 'history', tone: 'neutral' }
  const a = String(action).toLowerCase()
  if (a.startsWith('user.'))     return { icon: 'person',           tone: 'info' }
  if (a.startsWith('clinic.'))   return { icon: 'corporate_fare',   tone: 'info' }
  if (a.startsWith('referral.')) return { icon: 'how_to_reg',       tone: 'success' }
  if (a.startsWith('bonus.'))    return { icon: 'paid',             tone: 'success' }
  if (a.startsWith('settings.')) return { icon: 'tune',             tone: 'warning' }
  if (a.startsWith('ledger.'))   return { icon: 'account_balance',  tone: 'warning' }
  if (a.startsWith('discount.')) return { icon: 'local_offer',      tone: 'info' }
  if (a.startsWith('partner.'))  return { icon: 'handshake',        tone: 'info' }
  if (a.startsWith('login') || a.startsWith('auth.')) return { icon: 'login', tone: 'neutral' }
  return { icon: 'history', tone: 'neutral' }
}

// Tone (Chip variant) → CSS-класс/стиль
function toneStyle(tone) {
  switch (tone) {
    case 'info':    return { background: 'oklch(0.94 0.04 240)', color: 'oklch(0.42 0.12 240)' }
    case 'success': return { background: 'oklch(0.93 0.06 150)', color: 'oklch(0.40 0.12 150)' }
    case 'warning': return { background: 'oklch(0.94 0.08  80)', color: 'oklch(0.40 0.12  80)' }
    default:        return { background: 'var(--bg-2)',           color: 'var(--fg-2)' }
  }
}

// Человекочитаемый перевод action → русский глагол
const ACTION_RU = {
  'user.created':         'создал пользователя',
  'user.updated':         'изменил пользователя',
  'user.deleted':         'удалил пользователя',
  'user.assign_clinic':   'привязал к клинике',
  'clinic.created':       'создал клинику',
  'clinic.updated':       'изменил клинику',
  'referral.confirmed':   'подтвердил направление',
  'referral.cancelled':   'отменил направление',
  'bonus.paid':           'выплатил бонус',
  'bonus.cancelled':      'отменил бонус',
  'bonus.bulk_paid':      'провёл массовую выплату бонусов',
  'settings.updated':     'изменил настройки',
  'ledger.adjusted':      'провёл корректировку реестра',
  'discount.created':     'создал скидку',
  'discount.updated':     'изменил скидку',
  'discount.deleted':     'удалил скидку',
  'partner.created':      'создал партнёра',
  'partner.updated':      'изменил партнёра',
  'partner.deleted':      'удалил партнёра',
}

// Описание сущности (entity_type → "направлению" / "пользователю" и т.п.)
const ENTITY_RU_DAT = {
  user:     'пользователю',
  clinic:   'клинике',
  referral: 'направлению',
  bonus:    'бонусу',
  ledger:   'проводке',
  settings: 'настройкам',
  discount: 'скидке',
  partner:  'партнёру',
}

const ENTITY_RU_NOM = {
  user:     'пользователь',
  clinic:   'клиника',
  referral: 'направление',
  bonus:    'бонус',
  ledger:   'проводка',
  settings: 'настройки',
  discount: 'скидка',
  partner:  'партнёр',
}

// Относительное время ("5 минут назад", "вчера", "12 апр")
function relativeTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const diffMs = Date.now() - d.getTime()
  const sec = Math.floor(diffMs / 1000)
  if (sec < 60)        return 'только что'
  const min = Math.floor(sec / 60)
  if (min < 60)        return `${min} мин назад`
  const hr  = Math.floor(min / 60)
  if (hr  < 24)        return `${hr} ч назад`
  const day = Math.floor(hr / 24)
  if (day === 1)       return 'вчера'
  if (day < 7)         return `${day} дн назад`
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })
}

// Формирование роли/чипа актора
function actorRoleChip(actorRole) {
  if (!actorRole) return null
  const labels = {
    super_admin:     'Владелец платформы',
    franchise_owner: 'Владелец франшизы',
    manager:         'Руководитель',
    admin:           'Администратор',
    reg:             'Регистратор',
    doctor:          'Врач',
    partner_doctor:  'Врач-партнёр',
    accountant:      'Бухгалтер',
    director:        'Директор',
  }
  return labels[actorRole] || actorRole
}

// Описание события человеческим языком
function describeEvent(e) {
  const verb = ACTION_RU[e.action] || e.action || 'выполнил действие'
  const entityName = ENTITY_RU_DAT[e.entity_type] || e.entity_type || ''
  const ref = e.entity_id ? ` #${String(e.entity_id).slice(0, 8)}` : ''
  if (entityName) return `${verb} ${entityName}${ref}`.trim()
  return `${verb}${ref}`.trim()
}

// ── Компонент строки события (общий для Ленты и Поиска) ───────────────────
function EventRow({ e }) {
  const { icon, tone } = actionMeta(e.action)
  const ts = toneStyle(tone)
  return (
    <div
      className="flex items-start gap-3 py-3 px-4 transition-colors"
      style={{
        borderBottom: '1px solid var(--border)',
      }}
    >
      <div
        className="flex-shrink-0 flex items-center justify-center"
        style={{
          width: 36, height: 36, borderRadius: 10,
          background: ts.background, color: ts.color,
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 20 }}>{icon}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-0.5">
          <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>
            {e.actor_name || (e.actor_id ? `ID ${String(e.actor_id).slice(0, 8)}` : 'Система')}
          </span>
          {e.actor_role && (
            <Chip variant="default">{actorRoleChip(e.actor_role)}</Chip>
          )}
          {e.source && (
            <span
              style={{
                fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
                background: e.source === 'audit' ? 'oklch(0.93 0.07 300)' : 'var(--bg-2)',
                color:      e.source === 'audit' ? 'oklch(0.40 0.14 300)' : 'var(--fg-3)',
              }}
            >
              {e.source === 'audit' ? 'аудит' : 'активность'}
            </span>
          )}
        </div>
        <div style={{ fontSize: 13, color: 'var(--fg-2)' }}>
          {describeEvent(e)}
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-1" style={{ fontSize: 11.5, color: 'var(--fg-4)' }}>
          <span title={new Date(e.created_at).toLocaleString('ru-RU')}>
            {relativeTime(e.created_at)}
          </span>
          {(e.ip_address || e.ip) && (
            <>
              <span>·</span>
              <span className="font-mono">{e.ip_address || e.ip}</span>
            </>
          )}
          {e.geo_country && (
            <>
              <span>·</span>
              <span style={{ fontSize: 14, lineHeight: 1 }} title={e.geo_country_name || e.geo_country}>
                {flagFromCountry(e.geo_country)}
              </span>
              <span>{formatGeoLocation(e) || e.geo_country}</span>
            </>
          )}
          {e.user_agent && (
            <>
              <span>·</span>
              <span title={e.user_agent} style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {/Chrome|YaBrowser|Firefox|Safari|Edge|curl/.exec(e.user_agent)?.[0] || 'клиент'}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Главный компонент ─────────────────────────────────────────────────────
export default function AuditLogSection({ token }) {
  const [tab, setTab] = useState('feed')

  return (
    <div>
      <div className="mb-4">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { id: 'feed',   label: 'Лента' },
            { id: 'tenants', label: 'По тенантам' },
            { id: 'violations', label: 'Нарушения регионов' },
            { id: 'search', label: 'Поиск' },
          ]}
        />
      </div>

      {tab === 'feed'    && <FeedTab token={token} />}
      {tab === 'tenants' && <TenantsGeoTab token={token} />}
      {tab === 'violations' && <RegionViolationsTab token={token} />}
      {tab === 'search'  && <SearchTab token={token} />}
    </div>
  )
}

// ─── Вкладка «Лента» ─────────────────────────────────────────────────────
function FeedTab({ token }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      // Лимит 500 чтобы статистика была репрезентативной
      const r = await api.get('/audit/feed', { params: { days: 30, limit: 500 } })
      setItems(Array.isArray(r.data?.items) ? r.data.items : [])
    } catch {
      // fallback: /audit/log
      try {
        const r = await api.get('/audit/log', { params: { days: 30, limit: 500 } })
        setItems(Array.isArray(r.data?.items) ? r.data.items : [])
      } catch (e2) {
        setErr('Не удалось загрузить ленту аудита')
        setItems([])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // ── Статистика для KPI и диаграммы ──────────────────────────────────────
  const stats = useMemo(() => {
    if (!items.length) return null
    const now = Date.now()
    const ms24h = 24 * 3600 * 1000
    const ms7d  = 7  * 86400 * 1000
    const dayBuckets = new Map() // YYYY-MM-DD → count
    const actorBuckets = new Map()
    const actionBuckets = new Map()
    const countryBuckets = new Map()
    const ips = new Set()
    let last24h = 0
    let last7d = 0

    for (const e of items) {
      const ts = e.created_at ? new Date(e.created_at).getTime() : 0
      if (now - ts < ms24h) last24h++
      if (now - ts < ms7d)  last7d++
      const day = e.created_at?.slice(0, 10) || ''
      if (day) dayBuckets.set(day, (dayBuckets.get(day) || 0) + 1)
      const actor = e.actor_name || e.actor_id || 'Система'
      actorBuckets.set(actor, (actorBuckets.get(actor) || 0) + 1)
      if (e.action) actionBuckets.set(e.action, (actionBuckets.get(e.action) || 0) + 1)
      if (e.geo_country) countryBuckets.set(e.geo_country, (countryBuckets.get(e.geo_country) || 0) + 1)
      const ip = e.ip_address || e.ip
      if (ip) ips.add(ip)
    }

    // Сортируем дни хронологически — для стабильной диаграммы
    const sortedDays = Array.from(dayBuckets.entries()).sort((a, b) => a[0].localeCompare(b[0]))
    const maxDayCount = Math.max(1, ...sortedDays.map(([, c]) => c))

    const topActors = Array.from(actorBuckets.entries())
      .sort((a, b) => b[1] - a[1]).slice(0, 5)
    const topActions = Array.from(actionBuckets.entries())
      .sort((a, b) => b[1] - a[1]).slice(0, 1)
    const topCountries = Array.from(countryBuckets.entries())
      .sort((a, b) => b[1] - a[1]).slice(0, 5)

    return {
      total: items.length,
      last24h, last7d,
      uniqueActors: actorBuckets.size,
      uniqueIps: ips.size,
      sortedDays, maxDayCount,
      topActors, topActions, topCountries,
    }
  }, [items])

  return (
    <div className="space-y-4">
      {/* ── KPI-полоска: 5 метрик ───────────────────────────────────── */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {[
            { icon: 'history',      label: 'События',      value: stats.total,         hint: '30 дней' },
            { icon: 'today',        label: 'За 24 часа',   value: stats.last24h,       hint: 'последние сутки' },
            { icon: 'date_range',   label: 'За неделю',    value: stats.last7d,        hint: '7 дней' },
            { icon: 'group',        label: 'Акторов',      value: stats.uniqueActors,  hint: 'уникальных' },
            { icon: 'public',       label: 'IP адресов',   value: stats.uniqueIps,     hint: 'уникальных' },
          ].map((k) => (
            <Card key={k.label} style={{ padding: 14 }}>
              <div className="flex items-center gap-2 mb-1" style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{k.icon}</span>
                {k.label}
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--fg)', lineHeight: 1 }}>
                {Number(k.value).toLocaleString('ru-RU')}
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--fg-4)', marginTop: 2 }}>{k.hint}</div>
            </Card>
          ))}
        </div>
      )}

      {/* ── Диаграмма по дням + Топ-акторы + Топ-страны ──────────────── */}
      {stats && stats.sortedDays.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* Диаграмма */}
          <Card style={{ padding: 14, gridColumn: 'span 2 / span 2' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)', marginBottom: 10 }}>
              Активность по дням
            </div>
            <div className="flex items-end gap-1" style={{ height: 80 }}>
              {stats.sortedDays.map(([day, count]) => (
                <div
                  key={day}
                  className="flex-1 flex flex-col items-center justify-end"
                  title={`${day}: ${count} событий`}
                >
                  <div
                    style={{
                      width: '100%',
                      height: `${Math.max(4, (count / stats.maxDayCount) * 70)}px`,
                      background: 'linear-gradient(180deg, oklch(0.65 0.15 220) 0%, oklch(0.55 0.18 250) 100%)',
                      borderRadius: '3px 3px 0 0',
                      transition: 'opacity 200ms',
                    }}
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-between" style={{ fontSize: 9.5, color: 'var(--fg-4)', marginTop: 4 }}>
              <span>{stats.sortedDays[0]?.[0]}</span>
              <span>{stats.sortedDays[stats.sortedDays.length - 1]?.[0]}</span>
            </div>
          </Card>

          {/* Топ акторы */}
          <Card style={{ padding: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)', marginBottom: 10 }}>
              Топ акторов
            </div>
            <div className="space-y-2">
              {stats.topActors.map(([name, c]) => {
                const pct = stats.topActors[0] ? (c / stats.topActors[0][1]) * 100 : 0
                return (
                  <div key={name}>
                    <div className="flex justify-between" style={{ fontSize: 11.5, color: 'var(--fg-2)', marginBottom: 2 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>{name}</span>
                      <span style={{ fontWeight: 600, color: 'var(--fg)' }}>{c}</span>
                    </div>
                    <div style={{ height: 4, borderRadius: 2, background: 'var(--bg-2)', overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: 'oklch(0.60 0.16 220)' }} />
                    </div>
                  </div>
                )
              })}
              {stats.topCountries.length > 0 && (
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--fg-3)', marginBottom: 6 }}>География</div>
                  <div className="flex flex-wrap gap-1.5">
                    {stats.topCountries.map(([code, c]) => (
                      <div
                        key={code}
                        title={`${code}: ${c} событий`}
                        className="flex items-center gap-1 px-2 py-1"
                        style={{ fontSize: 11, borderRadius: 6, background: 'var(--bg-2)' }}
                      >
                        <span style={{ fontSize: 14 }}>{flagFromCountry(code)}</span>
                        <span style={{ color: 'var(--fg-2)' }}>{code}</span>
                        <span style={{ color: 'var(--fg-4)' }}>· {c}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* ── Лента событий ───────────────────────────────────────────── */}
      <Card style={{ overflow: 'hidden', padding: 0 }}>
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>
            Последние события (всего {items.length})
          </div>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            <span className="material-symbols-outlined" style={{ fontSize: 18, marginRight: 4 }}>
              refresh
            </span>
            Обновить
          </Button>
        </div>

      {loading && (
        <div className="py-12 text-center" style={{ color: 'var(--fg-3)', fontSize: 13 }}>
          Загрузка…
        </div>
      )}
      {!loading && err && (
        <div className="py-8 text-center" style={{ color: 'oklch(0.55 0.18 25)', fontSize: 13 }}>
          {err}
        </div>
      )}
      {!loading && !err && items.length === 0 && (
        <EmptyState
          icon={<span className="material-symbols-outlined">history</span>}
          title="Событий нет"
          message="За последние 30 дней действий пользователей не зафиксировано."
        />
      )}
      {!loading && !err && items.length > 0 && (
        <div>
          {items.slice(0, 100).map((e) => (
            <EventRow key={`${e.source || 'audit'}-${e.id}`} e={e} />
          ))}
        </div>
      )}
      </Card>
    </div>
  )
}

// ─── Вкладка «По тенантам» — гео-сводка по каждой франшизе ──────────────
function TenantsGeoTab({ token }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [days, setDays] = useState(30)

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const r = await api.get('/audit/by-tenant-geo', { params: { days } })
      setData(r.data)
    } catch (e) {
      setErr('Не удалось загрузить статистику')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-4">
      {/* Период */}
      <Card style={{ padding: 12 }}>
        <div className="flex flex-wrap items-center gap-3">
          <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>Период</div>
          <Tabs
            value={String(days)}
            onChange={(v) => setDays(Number(v))}
            items={[
              { id: '7',   label: '7 дн' },
              { id: '30',  label: '30 дн' },
              { id: '90',  label: '90 дн' },
              { id: '365', label: '1 год' },
            ]}
          />
          <div style={{ flex: 1 }} />
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            <span className="material-symbols-outlined" style={{ fontSize: 18, marginRight: 4 }}>refresh</span>
            Обновить
          </Button>
        </div>
      </Card>

      {loading && (
        <Card style={{ padding: 24, textAlign: 'center', color: 'var(--fg-3)', fontSize: 13 }}>
          Загрузка…
        </Card>
      )}
      {err && (
        <Card style={{ padding: 24, textAlign: 'center', color: 'oklch(0.55 0.18 25)', fontSize: 13 }}>
          {err}
        </Card>
      )}
      {!loading && !err && data && data.tenants.length === 0 && (
        <EmptyState
          icon={<span className="material-symbols-outlined">storefront</span>}
          title="Нет данных"
          message="За выбранный период не зафиксировано событий с гео."
        />
      )}

      {!loading && !err && data && data.tenants.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {data.tenants.map((t) => {
            // Топ-регион для определения «основного» — что бы подсветить если события из других
            const mainRegion = t.regions[0]
            return (
              <Card
                key={t.tenant_id || 'null'}
                style={{
                  padding: 16,
                  // Подсветка карточки рамкой если есть нарушения региона
                  borderColor: t.violations_count > 0 ? 'oklch(0.65 0.20 25)' : undefined,
                  borderWidth: t.violations_count > 0 ? 2 : undefined,
                }}
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg)' }}>
                      {t.tenant_name}
                    </div>
                    {t.tenant_slug && (
                      <div style={{ fontSize: 11, color: 'var(--fg-4)', fontFamily: 'monospace' }}>
                        /{t.tenant_slug}
                      </div>
                    )}
                    {/* Region Lock — разрешённый регион франшизы */}
                    {t.allowed_region && (
                      <div className="flex items-center gap-1 mt-1.5" style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 13 }}>shield_locked</span>
                        <span>Регион: <b style={{ color: 'var(--fg-2)' }}>{t.allowed_region}</b></span>
                        {t.region_strict && (
                          <span style={{ marginLeft: 4, fontSize: 9.5, padding: '1px 4px', borderRadius: 3, background: 'oklch(0.93 0.07 25)', color: 'oklch(0.40 0.18 25)' }}>
                            STRICT
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Chip variant="default">
                      <span className="material-symbols-outlined" style={{ fontSize: 14, marginRight: 4, verticalAlign: -2 }}>history</span>
                      {t.events_count}
                    </Chip>
                    {t.violations_count > 0 && (
                      <Chip
                        variant="default"
                        style={{
                          background: 'oklch(0.93 0.07 25)',
                          color: 'oklch(0.40 0.18 25)',
                          fontWeight: 600,
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 14, marginRight: 4, verticalAlign: -2 }}>gpp_bad</span>
                        {t.violations_count} наруш.
                      </Chip>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 mb-3" style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>
                  <div className="flex items-center gap-1">
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>public</span>
                    <span>{t.unique_ips} IP</span>
                  </div>
                  {t.last_event_at && (
                    <div className="flex items-center gap-1">
                      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>schedule</span>
                      <span>{relativeTime(t.last_event_at)}</span>
                    </div>
                  )}
                  {t.out_of_region_events > 0 && (
                    <div className="flex items-center gap-1" style={{ color: 'oklch(0.55 0.18 25)' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>my_location</span>
                      <span>{t.out_of_region_events} вне зоны</span>
                    </div>
                  )}
                </div>

                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  <div style={{ fontSize: 11, color: 'var(--fg-3)', marginBottom: 8 }}>Регионы</div>
                  <div className="space-y-1.5">
                    {t.regions.map((r, i) => {
                      // Если у франшизы задан allowed_region — используем серверный флаг,
                      // иначе фолбэк на старую эвристику «не топовый регион».
                      const isOther = t.allowed_region
                        ? !!r.out_of_region
                        : (i > 0 && mainRegion && r.region !== mainRegion.region)
                      const pct = mainRegion ? (r.count / mainRegion.count) * 100 : 0
                      return (
                        <div key={i}>
                          <div className="flex items-center gap-2" style={{ fontSize: 12 }}>
                            <span style={{ fontSize: 14 }}>{flagFromCountry(r.country)}</span>
                            <span style={{ flex: 1, color: isOther ? 'oklch(0.55 0.18 25)' : 'var(--fg-2)', fontWeight: isOther ? 600 : 400 }}>
                              {r.city ? `${r.city}, ${r.region || r.country_name || r.country || '?'}` : (r.region || r.country_name || r.country || 'неизвестно')}
                              {isOther && (
                                <span style={{ marginLeft: 6, fontSize: 10, padding: '1px 5px', borderRadius: 4, background: 'oklch(0.93 0.07 25)', color: 'oklch(0.40 0.18 25)' }}>
                                  ⚠ другой регион
                                </span>
                              )}
                            </span>
                            <span style={{ fontWeight: 600, color: 'var(--fg)' }}>{r.count}</span>
                          </div>
                          <div style={{ height: 3, marginTop: 2, borderRadius: 2, background: 'var(--bg-2)', overflow: 'hidden' }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: isOther ? 'oklch(0.55 0.18 25)' : 'oklch(0.60 0.16 220)' }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Вкладка «Поиск» ─────────────────────────────────────────────────────
const ENTITY_TYPES = [
  { value: '',          label: 'Все сущности' },
  { value: 'user',      label: ENTITY_RU_NOM.user },
  { value: 'clinic',    label: ENTITY_RU_NOM.clinic },
  { value: 'referral',  label: ENTITY_RU_NOM.referral },
  { value: 'bonus',     label: ENTITY_RU_NOM.bonus },
  { value: 'ledger',    label: ENTITY_RU_NOM.ledger },
  { value: 'settings',  label: ENTITY_RU_NOM.settings },
  { value: 'discount',  label: ENTITY_RU_NOM.discount },
  { value: 'partner',   label: ENTITY_RU_NOM.partner },
]

function SearchTab({ token }) {
  const [days, setDays]               = useState(30)
  const [action, setAction]           = useState('')
  const [entityType, setEntityType]   = useState('')
  const [actorSearch, setActorSearch] = useState('')
  const [actions, setActions]         = useState([])
  const [items, setItems]             = useState([])
  const [loading, setLoading]         = useState(false)
  const [err, setErr]                 = useState('')

  // Подгружаем список action-констант
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await api.get('/audit/actions')
        const list = Array.isArray(r.data) ? r.data : (r.data?.actions || [])
        if (!cancelled) setActions(list)
      } catch {
        if (!cancelled) setActions([])
      }
    })()
    return () => { cancelled = true }
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const params = { days, limit: 200 }
      if (action)     params.action      = action
      if (entityType) params.entity_type = entityType
      const r = await api.get('/audit/log', { params })
      let list = Array.isArray(r.data?.items) ? r.data.items : []
      // фильтрация по имени актора — на клиенте (бэкенд не имеет search)
      if (actorSearch.trim()) {
        const q = actorSearch.trim().toLowerCase()
        list = list.filter((e) => (e.actor_name || '').toLowerCase().includes(q))
      }
      setItems(list)
    } catch (e) {
      setErr('Ошибка загрузки')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [days, action, entityType, actorSearch])

  // Триггерим поиск при изменении любого фильтра (debounce для actorSearch)
  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
  }, [load])

  // ── Экспорт CSV ────────────────────────────────────────────────────────
  // Берём токен из localStorage и качаем blob; URL формируем через API_BASE.
  const handleExport = useCallback(async () => {
    try {
      const params = { days }
      if (action)     params.action      = action
      if (entityType) params.entity_type = entityType
      const r = await api.get('/audit/log/export.csv', {
        params,
        responseType: 'blob',
      })
      // Скачиваем файл
      const blob = new Blob([r.data], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const ts = new Date().toISOString().slice(0, 10)
      a.download = `audit-${ts}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      alert('Не удалось выгрузить CSV')
    }
  }, [days, action, entityType])

  return (
    <div className="space-y-4">
      {/* ── Период (Tabs 7д/30д/90д) ─── */}
      <Card style={{ padding: 16 }}>
        <div className="flex flex-wrap items-center gap-3">
          <div style={{ fontSize: 12, color: 'var(--fg-3)', minWidth: 56 }}>Период</div>
          <Tabs
            value={String(days)}
            onChange={(v) => setDays(Number(v))}
            items={[
              { id: '7',  label: '7 дн' },
              { id: '30', label: '30 дн' },
              { id: '90', label: '90 дн' },
            ]}
          />
        </div>
      </Card>

      {/* ── Остальные фильтры ─── */}
      <Card style={{ padding: 16 }}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Action */}
          <div>
            <label style={{ fontSize: 11, color: 'var(--fg-3)', display: 'block', marginBottom: 4 }}>
              Тип действия
            </label>
            <select
              value={action}
              onChange={(e) => setAction(e.target.value)}
              className="w-full"
              style={{
                padding: '8px 10px',
                fontSize: 13,
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--fg)',
              }}
            >
              <option value="">Все действия</option>
              {actions.map((a) => (
                <option key={a} value={a}>{ACTION_RU[a] ? `${ACTION_RU[a]} (${a})` : a}</option>
              ))}
            </select>
          </div>

          {/* Entity */}
          <div>
            <label style={{ fontSize: 11, color: 'var(--fg-3)', display: 'block', marginBottom: 4 }}>
              Тип сущности
            </label>
            <select
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              className="w-full"
              style={{
                padding: '8px 10px',
                fontSize: 13,
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--fg)',
              }}
            >
              {ENTITY_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Actor search */}
          <div>
            <label style={{ fontSize: 11, color: 'var(--fg-3)', display: 'block', marginBottom: 4 }}>
              Актор (имя/username)
            </label>
            <input
              type="text"
              value={actorSearch}
              onChange={(e) => setActorSearch(e.target.value)}
              placeholder="Поиск по имени…"
              className="w-full"
              style={{
                padding: '8px 10px',
                fontSize: 13,
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--fg)',
              }}
            />
          </div>

          {/* Export */}
          <div className="flex items-end">
            <Button variant="secondary" onClick={handleExport} disabled={loading}>
              <span className="material-symbols-outlined" style={{ fontSize: 18, marginRight: 6 }}>
                download
              </span>
              Экспорт CSV
            </Button>
          </div>
        </div>
      </Card>

      {/* ── Результаты ─── */}
      <Card style={{ overflow: 'hidden', padding: 0 }}>
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>
            Найдено: {items.length}
          </div>
          {loading && <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>Загрузка…</div>}
        </div>

        {err && (
          <div className="py-8 text-center" style={{ color: 'oklch(0.55 0.18 25)', fontSize: 13 }}>
            {err}
          </div>
        )}
        {!err && !loading && items.length === 0 && (
          <EmptyState
            icon={<span className="material-symbols-outlined">search_off</span>}
            title="Ничего не найдено"
            message="Попробуйте изменить период или сбросить фильтры."
          />
        )}
        {!err && items.length > 0 && (
          <div>
            {items.map((e) => (
              <EventRow key={`audit-${e.id}`} e={e} />
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

// ─── Вкладка «Нарушения регионов» — Region Lock ───────────────────────────
function RegionViolationsTab({ token }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [days, setDays] = useState(30)
  const [busyId, setBusyId] = useState(null)  // id строки с активным действием

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const r = await api.get('/audit/region-violations', { params: { days, limit: 500 } })
      setItems(Array.isArray(r.data?.items) ? r.data.items : [])
    } catch (e) {
      setErr('Не удалось загрузить нарушения')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => { load() }, [load])

  // Действия с франшизой по конкретному нарушению
  const addToWhitelist = useCallback(async (v) => {
    if (!v.franchise_id || !v.ip_address) {
      window.alert('Не хватает данных: franchise_id или IP')
      return
    }
    const comment = window.prompt(
      `Добавить IP ${v.ip_address} в whitelist франшизы «${v.franchise_name || ''}»?\n` +
      `Комментарий (необязательно):`,
      `${v.detected_city || v.detected_region || ''} (${new Date(v.created_at).toLocaleDateString('ru-RU')})`
    )
    if (comment === null) return
    setBusyId(v.id)
    try {
      await api.post(`/admin/franchises/${v.franchise_id}/ip-allowlist`, {
        ip_cidr: v.ip_address,
        comment: comment || null,
        bypass_block: false,
      })
      await load()
    } catch (e) {
      window.alert('Ошибка: ' + (e?.response?.data?.detail || e.message))
    } finally {
      setBusyId(null)
    }
  }, [load])

  const blockFranchise = useCallback(async (v) => {
    if (!v.franchise_id) return
    const reason = window.prompt(
      `Заблокировать франшизу «${v.franchise_name || ''}»?\n` +
      `Причина (будет видна пользователю):`,
      'Нарушение разрешённого региона'
    )
    if (reason === null) return
    setBusyId(v.id)
    try {
      await api.post(`/admin/franchises/${v.franchise_id}/block`, {
        reason: reason || null,
        blocked_until: null,
      })
      await load()
    } catch (e) {
      window.alert('Ошибка: ' + (e?.response?.data?.detail || e.message))
    } finally {
      setBusyId(null)
    }
  }, [load])

  const unblockFranchise = useCallback(async (v) => {
    if (!v.franchise_id) return
    if (!window.confirm(`Снять блокировку с франшизы «${v.franchise_name || ''}»?`)) return
    setBusyId(v.id)
    try {
      await api.post(`/admin/franchises/${v.franchise_id}/unblock`)
      await load()
    } catch (e) {
      window.alert('Ошибка: ' + (e?.response?.data?.detail || e.message))
    } finally {
      setBusyId(null)
    }
  }, [load])

  // Сводка по франшизам — сколько нарушений у каждой
  const summary = useMemo(() => {
    const byFr = new Map()
    for (const v of items) {
      const k = v.franchise_id || v.tenant_id || 'unknown'
      const name = v.franchise_name || v.tenant_name || 'Без франшизы'
      const cur = byFr.get(k) || { name, count: 0, allowed: v.allowed_region, last: null }
      cur.count += 1
      if (!cur.last || v.created_at > cur.last) cur.last = v.created_at
      byFr.set(k, cur)
    }
    return Array.from(byFr.values()).sort((a, b) => b.count - a.count)
  }, [items])

  return (
    <div className="space-y-4">
      <Card style={{ padding: 12 }}>
        <div className="flex flex-wrap items-center gap-3">
          <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>Период</div>
          <Tabs
            value={String(days)}
            onChange={(v) => setDays(Number(v))}
            items={[
              { id: '7',   label: '7 дн' },
              { id: '30',  label: '30 дн' },
              { id: '90',  label: '90 дн' },
              { id: '365', label: '1 год' },
            ]}
          />
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>
            Всего: <b style={{ color: 'var(--fg)' }}>{items.length}</b>
          </div>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            <span className="material-symbols-outlined" style={{ fontSize: 18, marginRight: 4 }}>refresh</span>
            Обновить
          </Button>
        </div>
      </Card>

      {/* Сводка по франшизам */}
      {summary.length > 0 && (
        <Card style={{ padding: 14 }}>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 8 }}>
            Сводка по франшизам
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {summary.map((s, i) => (
              <div
                key={i}
                style={{
                  padding: 10,
                  borderRadius: 8,
                  background: 'oklch(0.96 0.04 25)',
                  border: '1px solid oklch(0.85 0.08 25)',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: 'oklch(0.40 0.18 25)' }}>
                  {s.name}
                </div>
                <div style={{ fontSize: 11, color: 'oklch(0.45 0.12 25)', marginTop: 2 }}>
                  Разрешён: {s.allowed || '—'} · {s.count} наруш.
                </div>
                {s.last && (
                  <div style={{ fontSize: 10.5, color: 'var(--fg-4)', marginTop: 2 }}>
                    Последнее: {relativeTime(s.last)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {loading && (
        <Card style={{ padding: 24, textAlign: 'center', color: 'var(--fg-3)', fontSize: 13 }}>
          Загрузка…
        </Card>
      )}
      {err && (
        <Card style={{ padding: 24, textAlign: 'center', color: 'oklch(0.55 0.18 25)', fontSize: 13 }}>
          {err}
        </Card>
      )}

      {!loading && !err && items.length === 0 && (
        <EmptyState
          icon={<span className="material-symbols-outlined">verified_user</span>}
          title="Нарушений нет"
          message="За выбранный период ни одна франшиза не выходила за границы своего региона."
        />
      )}

      {!loading && !err && items.length > 0 && (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {items.map((v) => (
            <div
              key={v.id}
              style={{
                display: 'flex',
                gap: 12,
                padding: '10px 14px',
                borderBottom: '1px solid var(--border)',
                fontSize: 12.5,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ minWidth: 130, color: 'var(--fg-3)', fontFamily: 'monospace', fontSize: 11 }}>
                {v.created_at ? new Date(v.created_at).toLocaleString('ru-RU') : '—'}
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 600, color: 'var(--fg)' }}>
                  {v.franchise_name || v.tenant_name || 'Без франшизы'}
                  {v.franchise_is_blocked && (
                    <Chip
                      variant="default"
                      style={{
                        background: 'oklch(0.40 0.20 25)', color: 'white',
                        fontSize: 10, height: 18, marginLeft: 6,
                      }}
                    >
                      BLOCKED
                    </Chip>
                  )}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 2 }}>
                  Разрешён: <b>{v.allowed_region || '—'}</b>
                  {' → '}
                  Обнаружен:{' '}
                  <b style={{ color: 'oklch(0.40 0.18 25)' }}>
                    {v.detected_region || '?'}
                    {v.detected_city ? ` / ${v.detected_city}` : ''}
                  </b>
                  {v.detected_country ? `, ${v.detected_country}` : ''}
                </div>
                {(v.original_action || v.actor_name) && (
                  <div style={{ fontSize: 11, color: 'var(--fg-4)', marginTop: 2, fontFamily: 'monospace' }}>
                    {v.original_action && <span>{v.original_action}</span>}
                    {v.actor_name && <span> · {v.actor_name}</span>}
                    {v.ip_address && <span> · {v.ip_address}</span>}
                  </div>
                )}
              </div>

              {/* Действия по нарушению — IP whitelist + ручной блок */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignSelf: 'center' }}>
                {v.region_strict && (
                  <Chip
                    variant="default"
                    style={{
                      background: 'oklch(0.93 0.07 25)',
                      color: 'oklch(0.40 0.18 25)',
                      fontSize: 10,
                      height: 20,
                    }}
                  >
                    STRICT
                  </Chip>
                )}
                {v.ip_address && v.franchise_id && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busyId === v.id}
                    onClick={() => addToWhitelist(v)}
                    title={`Добавить ${v.ip_address} в whitelist франшизы`}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16, marginRight: 4 }}>shield_person</span>
                    В whitelist
                  </Button>
                )}
                {v.franchise_id && !v.franchise_is_blocked && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busyId === v.id}
                    onClick={() => blockFranchise(v)}
                    title="Ручная блокировка франшизы"
                    style={{ color: 'oklch(0.50 0.20 25)' }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16, marginRight: 4 }}>block</span>
                    Заблокировать
                  </Button>
                )}
                {v.franchise_id && v.franchise_is_blocked && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busyId === v.id}
                    onClick={() => unblockFranchise(v)}
                    title="Снять ручную блокировку"
                    style={{ color: 'oklch(0.45 0.18 145)' }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16, marginRight: 4 }}>lock_open</span>
                    Разблокировать
                  </Button>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}
