/**
 * ========================================
 * БЛОК: <CommandPalette> — глобальный поиск Cmd+K (Ctrl+K)
 * ========================================
 * Подключается на верхнем уровне (Layout, AdminLayout, _ManagerShell, DoctorLayout).
 * Слушает Cmd+K / Ctrl+K глобально (если фокус не в input/textarea/contentEditable).
 *
 * W3 расширение:
 *   - GET /search/global?q=...&limit=8  — единый endpoint (manager+).
 *     Возвращает {patients, doctors, referrals, services, clinics, navigation}
 *     где каждый item = {id, type, title, subtitle, url, icon}.
 *   - Группы: 🏥 Пациенты / 👨‍⚕️ Врачи / 📋 Направления / 🛠 Услуги /
 *             🏢 Клиники / 🧭 Навигация (по 5 элементов на группу).
 *   - Recent searches — localStorage 'cmdk_recent' (10 последних кликов).
 *     При пустом query — показываем «Недавно».
 *   - Whitelist разделов админки (NAV_ITEMS) — фильтр client-side по q.
 *
 * Esc — закрывает, ↑↓ — навигация по элементам (с пропуском заголовков),
 * Enter — открыть выделенный.
 * ========================================
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api'
import { BASE_PATH, SLUG } from '../config'

/* eslint-disable react-hooks/exhaustive-deps */

// ─── Whitelist разделов админки (зеркало ADMIN_SECTIONS из AdminLayout.jsx) ───
// При добавлении новой секции — продублировать сюда.
const NAV_ITEMS = [
  { id: 'home',               title: 'Главная',              subtitle: 'Дашборд',                  icon: 'dashboard',             url: '/admin' },
  { id: 'wiki',               title: 'Wiki',                 subtitle: 'База знаний',              icon: 'menu_book',             url: '/admin/wiki' },
  { id: 'settings',           title: 'Настройки',            subtitle: 'Параметры системы',        icon: 'settings',              url: '/admin/settings' },
  { id: 'analytics',          title: 'Аналитика',            subtitle: 'Воронка и drill-down',     icon: 'insights',              url: '/admin/analytics' },
  { id: 'audit',              title: 'Аудит',                subtitle: 'Журнал событий',           icon: 'history',               url: '/admin/audit' },
  { id: 'billing',            title: 'Биллинг',              subtitle: 'Подписки и оплаты',        icon: 'credit_card',           url: '/admin/billing' },
  { id: 'billing_ledger',     title: 'Реестр операций',      subtitle: 'BillingLedger UI',         icon: 'receipt_long',          url: '/admin/billing_ledger' },
  { id: 'monitoring',         title: 'Мониторинг',           subtitle: 'Health и метрики',         icon: 'monitor_heart',         url: '/admin/monitoring' },
  { id: 'contacts',           title: 'Контакты',             subtitle: 'Каталог контактов',        icon: 'contacts',              url: '/admin/contacts' },
  { id: 'reviews',            title: 'Отзывы',               subtitle: 'Обратная связь',           icon: 'reviews',               url: '/admin/reviews' },
  { id: 'modules_catalog',    title: 'Модули',               subtitle: 'Каталог модулей',          icon: 'extension',             url: '/admin/modules_catalog' },
  { id: 'roles',              title: 'Роли',                 subtitle: 'Матрица прав (RBAC)',      icon: 'verified_user',         url: '/admin/roles' },
  { id: 'mis_sync',           title: 'Синхронизация МИС',    subtitle: 'Импорт пациентов',         icon: 'sync',                  url: '/admin/mis_sync' },
  { id: 'doctors',            title: 'Врачи',                subtitle: 'Реестр врачей',            icon: 'medical_services',      url: '/admin/doctors' },
  { id: 'patient_chats',      title: 'Чаты пациентов',       subtitle: 'Поддержка/общение',        icon: 'forum',                 url: '/admin/patient_chats' },
  { id: 'calls_cfg',          title: 'Звонки — настройки',   subtitle: 'Правила и SIP-транк',      icon: 'phone_in_talk',         url: '/admin/calls_cfg' },
  { id: 'calls_log',          title: 'Журнал звонков',       subtitle: 'Лента вызовов',            icon: 'call_log',              url: '/admin/calls_log' },
  { id: 'push_notify',        title: 'Push-уведомления',     subtitle: 'Рассылки и шаблоны',       icon: 'notifications',         url: '/admin/push_notify' },
  { id: 'webhooks',           title: 'Webhooks',             subtitle: 'Интеграции',               icon: 'webhook',               url: '/admin/webhooks' },
  { id: 'ads',                title: 'Реклама',              subtitle: 'Кампании и метрики',       icon: 'campaign',              url: '/admin/ads' },
  { id: 'ai_analytics',       title: 'AI-аналитика',         subtitle: 'Инсайты и прогноз',        icon: 'smart_toy',             url: '/admin/ai_analytics' },
  { id: 'ai_knowledge',       title: 'AI-база знаний',       subtitle: 'Документы для ассистента', icon: 'auto_stories',          url: '/admin/ai_knowledge' },
  { id: 'super_admin',        title: 'Платформа',            subtitle: 'Тенанты',                  icon: 'admin_panel_settings',  url: '/admin/super_admin' },
  { id: 'franchises',         title: 'Франшизы',             subtitle: 'Управление франшизами',    icon: 'store',                 url: '/admin/franchises' },
  { id: 'branding',           title: 'Брендинг',             subtitle: 'Тема и White-Label',       icon: 'palette',               url: '/admin/branding' },
  { id: 'cms',                title: 'CMS-страницы',         subtitle: 'Лендинг и контент',        icon: 'article',               url: '/admin/cms' },
  { id: 'acts',               title: 'Акты',                 subtitle: 'Inter-clinic акты',        icon: 'description',           url: '/admin/acts' },
  { id: 'platform_billing',   title: 'Биллинг платформы',    subtitle: 'Платежи франшиз',          icon: 'account_balance',       url: '/admin/platform_billing' },
  { id: 'platform_analytics', title: 'Аналитика платформы',  subtitle: 'MRR / Churn / LTV',        icon: 'show_chart',            url: '/admin/platform_analytics' },
  { id: 'payment_gateways',   title: 'Платёжные шлюзы',      subtitle: 'Конфиг провайдеров',       icon: 'payments',              url: '/admin/payment_gateways' },
  { id: 'loyalty',            title: 'Лояльность',           subtitle: 'Бонусы и кешбэк',          icon: 'loyalty',               url: '/admin/loyalty' },
  { id: 'recordings',         title: 'Записи звонков',       subtitle: 'Архив аудио',              icon: 'graphic_eq',            url: '/admin/recordings' },
  { id: 'telemedicine',       title: 'Телемедицина',         subtitle: 'Видеоконсультации',        icon: 'video_call',            url: '/admin/telemedicine' },
  { id: 'sms_marketing',      title: 'SMS-маркетинг',        subtitle: 'Рассылки и сегменты',      icon: 'sms',                   url: '/admin/sms_marketing' },
  { id: 'inventory',          title: 'Склад',                subtitle: 'Материалы и остатки',      icon: 'inventory_2',           url: '/admin/inventory' },
]

// ─── Recent searches (localStorage) ───
const RECENT_KEY = 'cmdk_recent'
const RECENT_MAX = 10

function loadRecent() {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.slice(0, RECENT_MAX) : []
  } catch { return [] }
}

function pushRecent(item) {
  try {
    const cur = loadRecent()
    // Дедупликация по type+id — поднимаем наверх
    const filtered = cur.filter(x => !(x.type === item.type && x.id === item.id))
    const next = [{ ...item, ts: Date.now() }, ...filtered].slice(0, RECENT_MAX)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {/* ignore */}
}

// ─── Группы: ключ → {title, emoji} ───
const GROUP_META = {
  patients:   { title: 'Пациенты',     emoji: '🏥' },
  doctors:    { title: 'Врачи',        emoji: '👨‍⚕️' },
  referrals:  { title: 'Направления',  emoji: '📋' },
  services:   { title: 'Услуги',       emoji: '🛠' },
  clinics:    { title: 'Клиники',      emoji: '🏢' },
  navigation: { title: 'Навигация',    emoji: '🧭' },
}
const GROUP_ORDER = ['patients', 'doctors', 'referrals', 'services', 'clinics', 'navigation']

const ICON_FOR_TYPE = {
  patient:    'person',
  doctor:     'medical_services',
  referral:   'qr_code_2',
  service:    'health_and_safety',
  clinic:     'local_hospital',
  navigation: 'arrow_outward',
}

export default function CommandPalette() {
  const navigate = useNavigate()
  // Стабильная пустая ссылка
  const EMPTY = useMemo(() => ({
    patients: [], doctors: [], referrals: [], services: [], clinics: [], navigation: [],
  }), [])
  const enabled = !!SLUG
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [data, setData] = useState(EMPTY)
  const [loading, setLoading] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const [recent, setRecent] = useState(() => loadRecent())
  const inputRef = useRef(null)
  const debounceRef = useRef(null)

  // Глобальный hotkey: Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e) => {
      const t = e.target
      const tag = (t?.tagName || '').toLowerCase()
      const inEditable = tag === 'input' || tag === 'textarea' || t?.isContentEditable
      const isHotkey = (e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')
      if (isHotkey && !inEditable) {
        e.preventDefault()
        setOpen(o => !o)
        return
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])

  // При открытии — фокус на input + загрузить свежие recent
  useEffect(() => {
    if (!open) return
    setActiveIdx(0)
    setRecent(loadRecent())
    const t = setTimeout(() => inputRef.current?.focus(), 30)
    return () => clearTimeout(t)
  }, [open])

  // При закрытии — сбрасываем запрос
  useEffect(() => {
    if (open) return
    setQ('')
    setData(EMPTY)
  }, [open, EMPTY])

  // Debounced поиск через /search/global
  useEffect(() => {
    if (!open) return
    if (!enabled || !q || q.trim().length < 2) {
      setData(EMPTY)
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const r = await api.get('/search/global', { params: { q: q.trim(), limit: 8 } })
        setData({
          patients:   r.data.patients   || [],
          doctors:    r.data.doctors    || [],
          referrals:  r.data.referrals  || [],
          services:   r.data.services   || [],
          clinics:    r.data.clinics    || [],
          navigation: r.data.navigation || [],
        })
        setActiveIdx(0)
      } catch (e) {
        // Деградация: пробуем legacy /search чтобы сохранить базовый функционал
        try {
          const r = await api.get('/search', { params: { q: q.trim() } })
          setData({
            patients:   (r.data.patients   || []).map(p => ({ id: p.id, type: 'patient',  title: p.name, subtitle: p.phone || '', url: `/admin/patient_chats?id=${p.id}`, icon: 'person' })),
            doctors:    (r.data.doctors    || []).map(d => ({ id: d.id, type: 'doctor',   title: d.full_name, subtitle: d.specialty || '', url: `/admin/doctors?id=${d.id}`, icon: 'medical_services' })),
            referrals:  (r.data.referrals  || []).map(rr => ({ id: rr.id, type: 'referral', title: `#${rr.short_code || ''} · ${rr.patient_name || ''}`, subtitle: rr.service_name || '', url: `/admin?ref=${rr.short_code || rr.id}`, icon: 'qr_code_2' })),
            services:   (r.data.services   || []).map(s => ({ id: s.id, type: 'service',  title: s.name, subtitle: s.code || '', url: `/admin?tab=services&service=${s.id}`, icon: 'health_and_safety' })),
            clinics:    [],
            navigation: [],
          })
        } catch {
          setData(EMPTY)
        }
      } finally {
        setLoading(false)
      }
    }, 250)
    return () => debounceRef.current && clearTimeout(debounceRef.current)
  }, [q, open, enabled, EMPTY])

  // Клиентский фильтр навигации (дублирует серверный — быстрее без round-trip)
  const navClient = useMemo(() => {
    const qq = q.trim().toLowerCase()
    if (!qq || qq.length < 2) return []
    return NAV_ITEMS.filter(n =>
      n.title.toLowerCase().includes(qq) || (n.subtitle || '').toLowerCase().includes(qq)
    ).slice(0, 5).map(n => ({
      id: n.id, type: 'navigation', title: n.title, subtitle: n.subtitle, url: n.url, icon: n.icon,
    }))
  }, [q])

  // Объединяем nav: сервер + клиент, дедупликация по id
  const navigationMerged = useMemo(() => {
    const seen = new Set()
    const out = []
    for (const it of [...(data.navigation || []), ...navClient]) {
      if (seen.has(it.id)) continue
      seen.add(it.id)
      out.push(it)
      if (out.length >= 5) break
    }
    return out
  }, [data.navigation, navClient])

  // Плоский список для навигации стрелками (из всех групп, обрезанных до 5)
  const flat = useMemo(() => {
    const out = []
    for (const key of GROUP_ORDER) {
      const items = key === 'navigation' ? navigationMerged : (data[key] || [])
      items.slice(0, 5).forEach(it => out.push({ ...it, _group: key }))
    }
    return out
  }, [data, navigationMerged])

  // Recent (показываем когда query пуст)
  const recentFlat = useMemo(() => {
    if (q.trim().length >= 2) return []
    return (recent || []).slice(0, 8).map(r => ({
      ...r, _group: 'recent', icon: r.icon || ICON_FOR_TYPE[r.type] || 'history',
    }))
  }, [recent, q])

  const allFlat = recentFlat.length ? recentFlat : flat

  // Открытие выделенного элемента
  const openItem = useCallback((it) => {
    if (!it || !it.url) return
    // Запоминаем в recent (только для реальных типов)
    if (it.type && it.type !== 'recent') {
      pushRecent({
        type: it.type, id: it.id, title: it.title, subtitle: it.subtitle || '',
        url: it.url, icon: it.icon || ICON_FOR_TYPE[it.type] || 'search',
      })
    }
    setOpen(false)
    // Учитываем BASE_PATH (slug префикс)
    const url = it.url
    navigate(url.replace(BASE_PATH, '') || '/')
  }, [navigate])

  // Стрелки и Enter
  const onKey = useCallback((e) => {
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return }
    if (!allFlat.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => Math.min(allFlat.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      openItem(allFlat[activeIdx])
    }
  }, [allFlat, activeIdx, openItem])

  if (!open) return null

  // Рендер группы (унифицированные item'ы из /search/global)
  let globalIdx = -1
  const renderGroup = (key, items) => {
    if (!items || !items.length) return null
    const meta = GROUP_META[key] || { title: key, emoji: '' }
    return (
      <div className="ks-cp-group" style={{ padding: '8px 0' }} key={key}>
        <div className="ks-cp-group-title" style={{
          padding: '4px 16px', fontSize: 11, fontWeight: 700,
          color: 'var(--fg-4, #888)', textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>{meta.emoji} {meta.title}</div>
        {items.slice(0, 5).map(it => {
          globalIdx += 1
          const isActive = globalIdx === activeIdx
          return (
            <button
              key={`${key}-${it.id}`}
              type="button"
              onMouseEnter={() => setActiveIdx(globalIdx)}
              onClick={() => openItem(it)}
              className="w-full flex items-center gap-3 text-left"
              style={{
                padding: '10px 16px',
                background: isActive ? 'var(--accent-soft, rgba(0,151,167,0.08))' : 'transparent',
                color: 'var(--fg, #191c1e)',
                cursor: 'pointer',
                border: 0, outline: 0,
              }}
            >
              <span
                className="material-symbols-outlined flex-shrink-0"
                style={{
                  fontSize: 20, color: isActive ? 'var(--accent, #0097A7)' : 'var(--fg-3, #727783)',
                }}
              >{it.icon || ICON_FOR_TYPE[it.type] || 'search'}</span>
              <span className="flex-1 min-w-0">
                <div className="truncate" style={{ fontSize: 14, fontWeight: 600 }}>{it.title || '—'}</div>
                {it.subtitle && (
                  <div className="truncate" style={{ fontSize: 12, color: 'var(--fg-3, #727783)' }}>{it.subtitle}</div>
                )}
              </span>
              <span style={{
                fontSize: 10, color: 'var(--fg-4, #aab)',
                textTransform: 'uppercase', letterSpacing: '0.06em',
              }}>{(GROUP_META[key]?.title || it.type || '').toUpperCase()}</span>
            </button>
          )
        })}
      </div>
    )
  }

  // Группа recent
  const renderRecent = () => {
    if (!recentFlat.length) return null
    return (
      <div className="ks-cp-group" style={{ padding: '8px 0' }}>
        <div className="ks-cp-group-title" style={{
          padding: '4px 16px', fontSize: 11, fontWeight: 700,
          color: 'var(--fg-4, #888)', textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>🕘 Недавно</div>
        {recentFlat.map(it => {
          globalIdx += 1
          const isActive = globalIdx === activeIdx
          return (
            <button
              key={`recent-${it.type}-${it.id}-${it.ts}`}
              type="button"
              onMouseEnter={() => setActiveIdx(globalIdx)}
              onClick={() => openItem(it)}
              className="w-full flex items-center gap-3 text-left"
              style={{
                padding: '10px 16px',
                background: isActive ? 'var(--accent-soft, rgba(0,151,167,0.08))' : 'transparent',
                color: 'var(--fg, #191c1e)',
                cursor: 'pointer',
                border: 0, outline: 0,
              }}
            >
              <span
                className="material-symbols-outlined flex-shrink-0"
                style={{
                  fontSize: 20, color: isActive ? 'var(--accent, #0097A7)' : 'var(--fg-3, #727783)',
                }}
              >{it.icon || ICON_FOR_TYPE[it.type] || 'history'}</span>
              <span className="flex-1 min-w-0">
                <div className="truncate" style={{ fontSize: 14, fontWeight: 600 }}>{it.title || '—'}</div>
                {it.subtitle && (
                  <div className="truncate" style={{ fontSize: 12, color: 'var(--fg-3, #727783)' }}>{it.subtitle}</div>
                )}
              </span>
              <span style={{
                fontSize: 10, color: 'var(--fg-4, #aab)',
                textTransform: 'uppercase', letterSpacing: '0.06em',
              }}>{(GROUP_META[`${it.type}s`]?.title || it.type || '').toUpperCase()}</span>
            </button>
          )
        })}
      </div>
    )
  }

  const hasAnyResult = GROUP_ORDER.some(k => {
    const items = k === 'navigation' ? navigationMerged : (data[k] || [])
    return (items || []).length > 0
  })

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-start justify-center"
      onClick={() => setOpen(false)}
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
      role="dialog"
      aria-label="Глобальный поиск"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          marginTop: '12vh',
          width: 'min(640px, 92vw)',
          background: 'var(--surface, #fff)',
          color: 'var(--fg, #191c1e)',
          borderRadius: 14,
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          overflow: 'hidden',
          border: '1px solid var(--border, rgba(0,0,0,0.08))',
        }}
      >
        {/* Поисковая строка */}
        <div className="flex items-center gap-3" style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--border, rgba(0,0,0,0.08))',
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 22, color: 'var(--fg-3, #727783)' }}>search</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Поиск пациентов, врачей, направлений, услуг, клиник, разделов…"
            className="flex-1 bg-transparent border-0 outline-none"
            style={{ fontSize: 16, color: 'var(--fg, #191c1e)' }}
            autoFocus
          />
          <kbd style={{
            fontSize: 11, padding: '2px 6px', borderRadius: 4,
            background: 'var(--bg-2, #f1f3f5)', color: 'var(--fg-3, #727783)',
            border: '1px solid var(--border, rgba(0,0,0,0.08))',
          }}>Esc</kbd>
        </div>

        {/* Тело */}
        <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {loading && (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--fg-3, #727783)', fontSize: 13 }}>
              Ищу…
            </div>
          )}

          {/* Пустой query — показываем recent если есть */}
          {!loading && q.trim().length < 2 && recentFlat.length > 0 && renderRecent()}

          {/* Пустой query, нет recent — подсказка */}
          {!loading && q.trim().length < 2 && recentFlat.length === 0 && (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--fg-3, #727783)', fontSize: 13 }}>
              Введите минимум 2 символа — имя пациента, телефон, код направления, название услуги или раздел админки
            </div>
          )}

          {/* Запрос ≥ 2 символов */}
          {!loading && q.trim().length >= 2 && !hasAnyResult && (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--fg-3, #727783)', fontSize: 13 }}>
              Ничего не найдено
            </div>
          )}
          {!loading && q.trim().length >= 2 && hasAnyResult && (
            <>
              {GROUP_ORDER.map(k => renderGroup(
                k,
                k === 'navigation' ? navigationMerged : data[k]
              ))}
            </>
          )}
        </div>

        {/* Футер с подсказками */}
        <div className="flex items-center gap-3" style={{
          padding: '8px 12px',
          borderTop: '1px solid var(--border, rgba(0,0,0,0.08))',
          fontSize: 11, color: 'var(--fg-4, #888)',
          background: 'var(--bg-1, #fafbfc)',
          flexWrap: 'wrap',
        }}>
          <span><kbd style={{ padding: '1px 4px', background: 'var(--bg-2)', borderRadius: 3 }}>↑↓</kbd> — навигация</span>
          <span><kbd style={{ padding: '1px 4px', background: 'var(--bg-2)', borderRadius: 3 }}>↵</kbd> — открыть</span>
          <span><kbd style={{ padding: '1px 4px', background: 'var(--bg-2)', borderRadius: 3 }}>Esc</kbd> — закрыть</span>
          <span style={{ marginLeft: 'auto' }}>
            <kbd style={{ padding: '1px 4px', background: 'var(--bg-2)', borderRadius: 3 }}>⌘K</kbd>
            {' / '}
            <kbd style={{ padding: '1px 4px', background: 'var(--bg-2)', borderRadius: 3 }}>Ctrl+K</kbd>
          </span>
        </div>
      </div>
    </div>
  )
}
