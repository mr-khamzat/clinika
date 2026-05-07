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
        <div className="flex items-center gap-2 mt-1" style={{ fontSize: 11.5, color: 'var(--fg-4)' }}>
          <span title={new Date(e.created_at).toLocaleString('ru-RU')}>
            {relativeTime(e.created_at)}
          </span>
          {(e.ip_address || e.ip) && (
            <>
              <span>·</span>
              <span className="font-mono">{e.ip_address || e.ip}</span>
            </>
          )}
          {e.geo_city && (
            <>
              <span>·</span>
              <span>{e.geo_city}</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Главный компонент ─────────────────────────────────────────────────────
export default function AuditLogSection({ token }) {
  const [tab, setTab] = useState('feed') // 'feed' | 'search'

  return (
    <div>
      <div className="mb-4">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { id: 'feed',   label: 'Лента' },
            { id: 'search', label: 'Поиск' },
          ]}
        />
      </div>

      {tab === 'feed'   && <FeedTab token={token} />}
      {tab === 'search' && <SearchTab token={token} />}
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
      const r = await api.get('/audit/feed', { params: { days: 30, limit: 100 } })
      setItems(Array.isArray(r.data?.items) ? r.data.items : [])
    } catch {
      // fallback: /audit/log
      try {
        const r = await api.get('/audit/log', { params: { days: 30, limit: 100 } })
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

  return (
    <Card style={{ overflow: 'hidden', padding: 0 }}>
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>
          Последние 100 событий (за 30 дней)
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
          {items.map((e) => (
            <EventRow key={`${e.source || 'audit'}-${e.id}`} e={e} />
          ))}
        </div>
      )}
    </Card>
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
