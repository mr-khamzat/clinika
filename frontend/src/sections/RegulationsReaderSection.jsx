/**
 * ========================================
 * <RegulationsReaderSection> — список «Мои регламенты»
 * ========================================
 * Глава 7 — Регламент-конструктор. Сторона читателя.
 *
 * Использование:
 *   <RegulationsReaderSection user={user} />
 *
 * Поведение:
 *   - GET /regulations/my-assigned → группировка по category (раскрывающиеся секции)
 *   - Каждый item: title, description (1 строка), бейдж статуса:
 *       ✓ прочитано       — completed=true
 *       ⚠️ изменено        — completed=true но current_version после completion_version
 *       🔴 не прочитано   — completed=false
 *   - Клик → открывает RegulationViewer (через локальный state activeId).
 *
 * URL-интеграция (опционально):
 *   - useParams() из react-router недоступен здесь (кабинеты не используют router),
 *     поэтому навигация — через локальный state. URL не меняется, что соответствует
 *     остальным секциям (например DoctorsSection).
 *
 * Props:
 *   user           — текущий user (для ФИО в подпись)
 *   initialId      — опц., если задано — сразу открыть конкретный регламент
 *   onChangeRoute  — опц., callback при изменении подмаршрута внутри секции
 * ========================================
 */
import { useEffect, useState, useMemo, useCallback } from 'react'
import api from '../api'
import { Card, Chip, Button, EmptyState, Page } from '../design'
import RegulationViewer from '../components/regulations/RegulationViewer'

const CATEGORY_ORDER = [
  'general',
  'hr',
  'medical',
  'reception',
  'service',
  'finance',
  'safety',
  'it',
  'legal',
]
const CATEGORY_LABELS = {
  general:   'Общие',
  hr:        'Кадры',
  medical:   'Медицинские',
  reception: 'Регистратура',
  service:   'Сервис',
  finance:   'Финансы',
  safety:    'Безопасность',
  it:        'IT / Информбезопасность',
  legal:     'Юридические',
}
const CATEGORY_ICONS = {
  general:   'rule',
  hr:        'badge',
  medical:   'medical_services',
  reception: 'support_agent',
  service:   'volunteer_activism',
  finance:   'account_balance',
  safety:    'health_and_safety',
  it:        'security',
  legal:     'gavel',
}

function fmtDate(d) {
  if (!d) return null
  try {
    return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch {
    return null
  }
}

function StatusBadge({ item }) {
  // Возможные поля от backend (любой набор поддерживаем):
  //   completed: bool
  //   current_version: number
  //   completion_version | last_read_version: number (опц.)
  //   changed: bool (если backend сам подсчитал)
  const completed = !!item.completed
  const cur = item.current_version
  const lastSeen =
    item.completion_version ??
    item.last_read_version ??
    item.completed_version ??
    null
  const changed = !!(
    item.changed
    || (completed && cur != null && lastSeen != null && Number(cur) > Number(lastSeen))
  )

  if (completed && changed) {
    return (
      <Chip variant="warn" dot>
        Изменено
      </Chip>
    )
  }
  if (completed) {
    return (
      <Chip variant="good" dot>
        Прочитано
      </Chip>
    )
  }
  return (
    <Chip variant="bad" dot>
      Не прочитано
    </Chip>
  )
}

export default function RegulationsReaderSection({ user, initialId = null, onChangeRoute }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeId, setActiveId] = useState(initialId)
  const [collapsed, setCollapsed] = useState({}) // { category: true=свёрнуто }

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const r = await api.get('/regulations/my-assigned')
      const list = Array.isArray(r.data) ? r.data : (r.data?.items || [])
      setItems(list)
    } catch (e) {
      const status = e?.response?.status
      if (status === 401 || status === 403) setError('Нет доступа')
      else if (status === 404) setItems([])
      else setError(e?.response?.data?.detail || e?.message || 'Не удалось загрузить регламенты')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Обновляем при возврате к списку: возможно изменился статус «прочитано»
  useEffect(() => {
    if (!activeId) load()
  }, [activeId, load])

  useEffect(() => {
    if (typeof onChangeRoute === 'function') {
      onChangeRoute(activeId ? `/${activeId}` : '/')
    }
  }, [activeId, onChangeRoute])

  // Группировка по category
  const groups = useMemo(() => {
    const m = new Map()
    for (const it of items) {
      const cat = it.category || 'general'
      if (!m.has(cat)) m.set(cat, [])
      m.get(cat).push(it)
    }
    // Сортируем категории в нужном порядке + кастомные в конце
    const keys = Array.from(m.keys())
    keys.sort((a, b) => {
      const ai = CATEGORY_ORDER.indexOf(a)
      const bi = CATEGORY_ORDER.indexOf(b)
      if (ai === -1 && bi === -1) return a.localeCompare(b)
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })
    return keys.map(k => ({
      key: k,
      label: CATEGORY_LABELS[k] || k,
      icon: CATEGORY_ICONS[k] || 'folder',
      items: m.get(k).slice().sort((x, y) => {
        // Сначала непрочитанные, потом прочитанные
        const xc = x.completed ? 1 : 0
        const yc = y.completed ? 1 : 0
        if (xc !== yc) return xc - yc
        return (x.title || '').localeCompare(y.title || '')
      }),
    }))
  }, [items])

  const stats = useMemo(() => {
    const total = items.length
    const unread = items.filter(i => !i.completed).length
    const changed = items.filter(i => {
      const cur = i.current_version
      const last = i.completion_version ?? i.last_read_version ?? i.completed_version ?? null
      return i.completed && cur != null && last != null && Number(cur) > Number(last)
    }).length
    return { total, unread, changed }
  }, [items])

  if (activeId) {
    return (
      <RegulationViewer
        regulationId={activeId}
        onBack={() => setActiveId(null)}
        user={user}
      />
    )
  }

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <div
          style={{
            display: 'inline-block',
            width: 32, height: 32,
            border: '3px solid var(--border)',
            borderTopColor: 'var(--accent)',
            borderRadius: '50%',
            animation: 'reg-spin 0.8s linear infinite',
          }}
        />
        <style>{`@keyframes reg-spin{to{transform:rotate(360deg)}}`}</style>
        <div style={{ marginTop: 12, fontSize: 13, color: 'var(--fg-3)' }}>Загрузка регламентов…</div>
      </div>
    )
  }

  if (error) {
    return (
      <Card>
        <EmptyState
          icon={<span className="material-symbols-outlined text-3xl" style={{ color: 'var(--bad, #dc2626)' }}>error</span>}
          title="Ошибка загрузки"
          message={error}
        />
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
          <Button variant="ghost" onClick={load}>Повторить</Button>
        </div>
      </Card>
    )
  }

  if (!items.length) {
    return (
      <Card>
        <EmptyState
          icon={<span className="material-symbols-outlined text-3xl">rule</span>}
          title="Регламентов нет"
          message="Вам пока не назначено ни одного регламента."
        />
      </Card>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Сводка */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Chip variant="default">Всего: {stats.total}</Chip>
        {stats.unread > 0 && <Chip variant="bad" dot>Не прочитано: {stats.unread}</Chip>}
        {stats.changed > 0 && <Chip variant="warn" dot>Обновлено: {stats.changed}</Chip>}
        {stats.unread === 0 && stats.changed === 0 && (
          <Chip variant="good" dot>Всё прочитано</Chip>
        )}
      </div>

      {groups.map(g => {
        const isCollapsed = !!collapsed[g.key]
        const unreadIn = g.items.filter(i => !i.completed).length
        return (
          <Card key={g.key}>
            <button
              type="button"
              onClick={() => setCollapsed(prev => ({ ...prev, [g.key]: !prev[g.key] }))}
              aria-expanded={!isCollapsed}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                width: '100%',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                textAlign: 'left',
              }}
            >
              <span
                className="inline-grid place-items-center"
                style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: 'var(--accent-soft)',
                  color: 'var(--accent)',
                  flexShrink: 0,
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 20, fontVariationSettings: "'FILL' 1" }}
                >
                  {g.icon}
                </span>
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg)' }}>
                  {g.label}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>
                  {g.items.length} {g.items.length === 1 ? 'регламент' : 'регламентов'}
                  {unreadIn > 0 && ` · ${unreadIn} не прочитан${unreadIn === 1 ? '' : 'о'}`}
                </div>
              </div>
              <span
                className="material-symbols-outlined"
                style={{
                  fontSize: 22,
                  color: 'var(--fg-3)',
                  transform: isCollapsed ? 'rotate(0deg)' : 'rotate(180deg)',
                  transition: 'transform 150ms ease',
                  flexShrink: 0,
                }}
              >
                expand_more
              </span>
            </button>

            {!isCollapsed && (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {g.items.map(it => {
                  const desc = it.description || ''
                  const required = !!it.required
                  return (
                    <button
                      type="button"
                      key={it.id}
                      onClick={() => setActiveId(it.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 12,
                        padding: '12px 14px',
                        background: 'var(--bg-1)',
                        border: '1px solid var(--border)',
                        borderRadius: 12,
                        cursor: 'pointer',
                        textAlign: 'left',
                        width: '100%',
                        transition: 'background 120ms ease, border-color 120ms ease',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.borderColor = 'var(--accent, #0ea5e9)'
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.borderColor = 'var(--border)'
                      }}
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{
                          fontSize: 22,
                          color: 'var(--fg-3)',
                          marginTop: 2,
                          flexShrink: 0,
                        }}
                      >
                        article
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 13.5,
                            fontWeight: 600,
                            color: 'var(--fg)',
                            display: 'flex',
                            gap: 6,
                            alignItems: 'center',
                            flexWrap: 'wrap',
                          }}
                        >
                          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                            {it.title || 'Без названия'}
                          </span>
                          {required && (
                            <Chip variant="accent">Обязательный</Chip>
                          )}
                          {it.current_version != null && (
                            <span style={{ fontSize: 11, color: 'var(--fg-4)' }}>
                              v{it.current_version}
                            </span>
                          )}
                        </div>
                        {desc && (
                          <div
                            style={{
                              marginTop: 3,
                              fontSize: 12.5,
                              color: 'var(--fg-3)',
                              lineHeight: 1.45,
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                            }}
                          >
                            {desc}
                          </div>
                        )}
                        {it.published_at && (
                          <div style={{ marginTop: 4, fontSize: 11, color: 'var(--fg-4)' }}>
                            опубликовано {fmtDate(it.published_at)}
                          </div>
                        )}
                      </div>
                      <div style={{ flexShrink: 0 }}>
                        <StatusBadge item={it} />
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </Card>
        )
      })}
    </div>
  )
}
