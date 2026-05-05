/**
 * CallRulesSection — премиум-версия правил звонков.
 *
 * Структура:
 *   1. Заголовок + описание модуля
 *   2. Бейдж статуса модуля (active/grace/нет модуля)
 *   3. Карточка «Как это работает» — 3 шага
 *   4. Tabs: 3 уровня правил (any / same_clinic / cross_clinic) с пояснениями
 *   5. Легенда — что значит каждый бейдж
 *   6. Матрица ролей с tooltip-подсказками
 *   7. Сводка: сколько правил создано + кнопка сброса
 */
import { useEffect, useState, useMemo, useCallback } from 'react'
import axios from 'axios'
import { API_BASE } from '../config'

const authH = t => ({ Authorization: `Bearer ${t}` })

const ROLE_INFO = {
  franchise_owner: { short: 'Владелец',   full: 'Владелец франшизы',  desc: 'Управляет всеми тенантами франшизы' },
  manager:         { short: 'Управляющий', full: 'Управляющий клиники', desc: 'Полная операционка одного тенанта' },
  supervisor:      { short: 'Старший',     full: 'Старший на месте',    desc: 'Оперативное управление, аналитика, реестр' },
  admin:           { short: 'Регистратор', full: 'Администратор',       desc: 'Создание направлений, чаты с пациентами' },
  nurse:           { short: 'Медсестра',   full: 'Медсестра',           desc: 'Запись пациентов, помощь врачу' },
  doctor:          { short: 'Врач',        full: 'Врач (штатный)',      desc: 'Расписание, приём, медкарта' },
  recruiter:       { short: 'Рекрутер',    full: 'Рекрутер',            desc: 'Приглашение врачей, бонусы за привлечение' },
  accountant:      { short: 'Бухгалтер',   full: 'Бухгалтер',           desc: 'Акты, счета, реквизиты, ЭП' },
}

const SCOPE_INFO = {
  any:          { title: 'Любая клиника',       sub: 'Применяется когда стороны в одной или разных клиниках', icon: '🌐' },
  same_clinic:  { title: 'В одной клинике',     sub: 'Когда обе стороны работают в одном филиале',           icon: '🏥' },
  cross_clinic: { title: 'Между клиниками',     sub: 'Когда стороны в разных филиалах одной сети',           icon: '🔀' },
}

const TELEPHONY_MODULES = ['telephony_basic', 'cross_clinic_audio', 'video_calls', 'video_conference']

// Premium oklch палитра (локальная, не зависит от глобальных tokens)
const C = {
  bg:        'oklch(0.20 0.018 235)',
  surface:   'oklch(0.245 0.020 235)',
  surfaceHi: 'oklch(0.275 0.022 235)',
  border:    'oklch(0.34 0.022 235)',
  line:      'oklch(0.295 0.020 235)',
  fg:        'oklch(0.97 0.008 230)',
  fg2:       'oklch(0.82 0.014 230)',
  fg3:       'oklch(0.66 0.018 230)',
  fg4:       'oklch(0.52 0.018 230)',
  accent:    'oklch(0.72 0.13 220)',
  accentSoft:'oklch(0.72 0.13 220 / 0.16)',
  good:      'oklch(0.74 0.15 160)',
  goodSoft:  'oklch(0.74 0.15 160 / 0.18)',
  warn:      'oklch(0.78 0.14 80)',
  warnSoft:  'oklch(0.78 0.14 80 / 0.18)',
  bad:       'oklch(0.70 0.18 25)',
  badSoft:   'oklch(0.70 0.18 25 / 0.18)',
}

export default function CallRulesSection({ adminToken, tenantId: fixedTenantId }) {
  const [tenants, setTenants]       = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [tenantData, setTenantData] = useState(null)
  const [rules, setRules]           = useState([])
  const [activeRoles, setActiveRoles] = useState([])
  const [scope, setScope]           = useState('any')
  const [loading, setLoading]       = useState(true)
  const [saving, setSaving]         = useState(null)
  const [tooltip, setTooltip]       = useState(null)

  useEffect(() => {
    if (fixedTenantId) {
      setSelectedId(fixedTenantId)
      setLoading(false)
      return
    }
    setLoading(true)
    axios.get(`${API_BASE}/franchise-owner/tenants`, { headers: authH(adminToken) })
      .then(r => {
        setTenants(r.data || [])
        if (r.data?.length && !selectedId) setSelectedId(r.data[0].id)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [fixedTenantId])

  const reload = useCallback(() => {
    if (!selectedId) return
    const detailUrl = fixedTenantId
      ? `${API_BASE}/tenant/modules-status`
      : `${API_BASE}/franchise-owner/tenants/${selectedId}`
    Promise.all([
      axios.get(`${API_BASE}/call-rules/${selectedId}`, { headers: authH(adminToken) })
        .then(r => r.data).catch(() => ({ rules: [], active_roles: [] })),
      axios.get(detailUrl, { headers: authH(adminToken) })
        .then(r => r.data).catch(() => null),
    ]).then(([rulesData, tData]) => {
      setRules(rulesData.rules || [])
      setActiveRoles(rulesData.active_roles || [])
      setTenantData(tData)
    })
  }, [selectedId, fixedTenantId, adminToken])

  useEffect(reload, [reload])

  const hasTelephonyModule = useMemo(() => {
    if (!tenantData?.modules) return false
    return tenantData.modules.some(m =>
      TELEPHONY_MODULES.includes(m.module_key) &&
      ['active', 'trial', 'grace'].includes(m.status)
    )
  }, [tenantData])

  const inGrace = useMemo(() => {
    if (!tenantData?.modules) return null
    const g = tenantData.modules.find(m =>
      TELEPHONY_MODULES.includes(m.module_key) && m.status === 'grace'
    )
    return g?.grace_until || null
  }, [tenantData])

  const ruleIndex = useMemo(() => {
    const idx = {}
    for (const r of rules) idx[`${r.from_role}|${r.to_role}|${r.scope}`] = r
    return idx
  }, [rules])

  const cellState = (from, to) => {
    const r = ruleIndex[`${from}|${to}|${scope}`]
    if (r) return { audio: r.allow_audio, video: r.allow_video, hasOverride: true }
    if (scope !== 'any') {
      const r2 = ruleIndex[`${from}|${to}|any`]
      if (r2) return { audio: r2.allow_audio, video: r2.allow_video, hasOverride: false, fallback: true }
    }
    return { audio: true, video: true, hasOverride: false }
  }

  const toggleCell = async (from, to, field) => {
    const cur = cellState(from, to)
    const next = { ...cur, [field]: !cur[field] }
    const cellKey = `${from}|${to}|${scope}|${field}`
    setSaving(cellKey)
    try {
      await axios.put(`${API_BASE}/call-rules/${selectedId}`, {
        from_role: from,
        to_role: to,
        scope,
        allow_audio: next.audio,
        allow_video: next.video,
      }, { headers: authH(adminToken) })
      reload()
    } finally {
      setSaving(null)
    }
  }

  const resetAll = async () => {
    if (!confirm('Удалить все настройки и вернуться к политике «все могут всем»?')) return
    await axios.delete(`${API_BASE}/call-rules/${selectedId}`, { headers: authH(adminToken) })
    reload()
  }

  if (loading) return <div style={{ padding: 32, textAlign:'center', color: C.fg3 }}>Загрузка…</div>

  return (
    <div style={{
      background: C.bg, color: C.fg, minHeight: '100vh',
      padding: '24px 16px 96px', fontFamily: "'Inter',system-ui,sans-serif",
    }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>

        {/* Hero */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.accent, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>
            Модуль связи · Правила
          </div>
          <h1 style={{ fontSize: 32, fontWeight: 800, margin: 0, lineHeight: 1.15 }}>
            Кто и кому может звонить
          </h1>
          <p style={{ fontSize: 14, color: C.fg3, marginTop: 10, maxWidth: 720 }}>
            Настройте права аудио- и видеозвонков для каждой пары ролей.
            По умолчанию все сотрудники могут связываться друг с другом —
            здесь вы добавляете точечные ограничения.
          </p>
        </div>

        {/* Tenant selector (если не зафиксирован) */}
        {!fixedTenantId && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: C.fg3, marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' }}>
              Тенант
            </label>
            <select value={selectedId} onChange={e => setSelectedId(e.target.value)}
              style={{
                width: '100%', padding: '12px 14px', borderRadius: 12,
                background: C.surface, color: C.fg, border: `1px solid ${C.border}`,
                fontSize: 14, fontWeight: 500, cursor: 'pointer', outline: 'none',
              }}>
              {tenants.map(t => <option key={t.id} value={t.id} style={{background:C.surface}}>{t.name} ({t.slug})</option>)}
            </select>
          </div>
        )}

        {/* Module status banner */}
        {!hasTelephonyModule && (
          <div style={{
            padding: 20, borderRadius: 16, marginBottom: 20,
            background: C.warnSoft, border: `1px solid ${C.warn}`,
            display: 'flex', gap: 14, alignItems: 'flex-start',
          }}>
            <div style={{ fontSize: 28, lineHeight: 1 }}>⚠️</div>
            <div>
              <div style={{ fontWeight: 700, color: C.warn, marginBottom: 4 }}>Модуль телефонии не подключён</div>
              <div style={{ fontSize: 13, color: C.fg2 }}>
                Чтобы настраивать правила, нужен один из активных модулей: «Базовая телефония»,
                «Аудио между клиниками», «Видеозвонки» или «Видеоконференция». Откройте раздел
                «Модули» у этого тенанта.
              </div>
            </div>
          </div>
        )}

        {hasTelephonyModule && inGrace && (
          <div style={{
            padding: 16, borderRadius: 14, marginBottom: 20,
            background: C.badSoft, border: `1px solid ${C.bad}`,
            display: 'flex', gap: 12, alignItems: 'center', fontSize: 13,
          }}>
            <div style={{ fontSize: 22 }}>🕒</div>
            <div style={{ color: C.fg }}>
              <span style={{ fontWeight: 700 }}>Льготный период.</span>{' '}
              Звонки работают до {new Date(inGrace).toLocaleString('ru-RU')}, после этой даты модуль отключится.
            </div>
          </div>
        )}

        {hasTelephonyModule && (
          <>
            {/* Help: 3 шага как пользоваться */}
            <div style={{
              padding: 20, borderRadius: 16, marginBottom: 20,
              background: C.surface, border: `1px solid ${C.line}`,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.accent, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 14 }}>
                Как настроить
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
                <Step n={1} title="Выберите уровень"
                  text='«Любая клиника» — общая политика для всех. «В одной клинике» — для коллег под одной крышей. «Между клиниками» — для разных филиалов сети.' />
                <Step n={2} title="Снимите галочки"
                  text="В таблице найдите пару ролей. Зелёные кнопки = разрешено, серые = запрещено. Микрофон — голос, камера — видео." />
                <Step n={3} title="Сохранится автоматически"
                  text="Каждый клик мгновенно отправляется на сервер. Можно сбросить все правила одной кнопкой внизу страницы." />
              </div>
            </div>

            {/* Scope tabs */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.fg3, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 10 }}>
                Уровень правил
              </div>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10,
              }}>
                {Object.entries(SCOPE_INFO).map(([id, info]) => (
                  <button key={id} onClick={() => setScope(id)}
                    style={{
                      padding: 14, borderRadius: 14, cursor: 'pointer', textAlign: 'left',
                      background: scope === id ? C.accentSoft : C.surface,
                      border: `1px solid ${scope === id ? C.accent : C.line}`,
                      color: C.fg, transition: 'all 0.15s',
                    }}>
                    <div style={{ fontSize: 22, marginBottom: 6 }}>{info.icon}</div>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{info.title}</div>
                    <div style={{ fontSize: 12, color: C.fg3, lineHeight: 1.4 }}>{info.sub}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Legend */}
            <div style={{
              padding: 14, borderRadius: 12, marginBottom: 16,
              background: C.surface, border: `1px solid ${C.line}`,
              display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 12,
            }}>
              <LegendItem on color={C.good} icon="🎤" label="Аудио разрешено" />
              <LegendItem on color={C.good} icon="🎥" label="Видео разрешено" />
              <LegendItem on={false} icon="🎤" label="Аудио запрещено" />
              <LegendItem on={false} icon="🎥" label="Видео запрещено" />
              <div style={{ marginLeft: 'auto', color: C.fg4, fontSize: 11 }}>
                {rules.length > 0 ? `${rules.length} правил настроено` : 'Активна политика по умолчанию'}
              </div>
            </div>

            {/* Matrix */}
            <div style={{ background: C.surface, borderRadius: 16, border: `1px solid ${C.line}`, padding: 4, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: 720, fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={cellHead(C, 'left')}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: C.fg4, marginBottom: 2 }}>КТО ↓</div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: C.fg4 }}>КОМУ →</div>
                    </th>
                    {activeRoles.map(r => (
                      <th key={r} style={cellHead(C, 'center')}>
                        <div style={{ fontWeight: 700, color: C.fg, fontSize: 12 }}>
                          {ROLE_INFO[r]?.short || r}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeRoles.map(from => (
                    <tr key={from}>
                      <td style={{
                        padding: '14px 12px', position: 'sticky', left: 0,
                        background: C.surface, borderTop: `1px solid ${C.line}`,
                        whiteSpace: 'nowrap',
                      }}>
                        <div style={{ fontWeight: 700, color: C.fg }}>{ROLE_INFO[from]?.short || from}</div>
                        <div style={{ fontSize: 10, color: C.fg4, marginTop: 2 }}>{ROLE_INFO[from]?.full}</div>
                      </td>
                      {activeRoles.map(to => {
                        if (from === to) {
                          return (
                            <td key={to} style={{ padding: 8, textAlign: 'center', borderTop: `1px solid ${C.line}` }}>
                              <span style={{ color: C.fg4, fontSize: 18 }}>—</span>
                            </td>
                          )
                        }
                        const cur = cellState(from, to)
                        const audioKey = `${from}|${to}|${scope}|audio`
                        const videoKey = `${from}|${to}|${scope}|video`
                        const tipKey = `${from}|${to}`
                        return (
                          <td key={to} style={{ padding: 8, textAlign: 'center', borderTop: `1px solid ${C.line}`, position: 'relative' }}
                              onMouseEnter={() => setTooltip(tipKey)}
                              onMouseLeave={() => setTooltip(null)}>
                            <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 4 }}>
                              <Pill icon="🎤" on={cur.audio} loading={saving === audioKey} fallback={cur.fallback}
                                onClick={() => toggleCell(from, to, 'audio')} C={C} />
                              <Pill icon="🎥" on={cur.video} loading={saving === videoKey} fallback={cur.fallback}
                                onClick={() => toggleCell(from, to, 'video')} C={C} />
                            </div>
                            {tooltip === tipKey && (
                              <div style={{
                                position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
                                marginTop: 8, padding: '10px 14px', background: C.bg,
                                border: `1px solid ${C.border}`, borderRadius: 10,
                                boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                                zIndex: 50, whiteSpace: 'nowrap', pointerEvents: 'none',
                                fontSize: 12, fontWeight: 500, color: C.fg,
                              }}>
                                <div style={{ marginBottom: 4 }}>
                                  <span style={{ color: C.fg3 }}>Звонит:</span>{' '}
                                  <strong>{ROLE_INFO[from]?.full}</strong>
                                </div>
                                <div style={{ marginBottom: 6 }}>
                                  <span style={{ color: C.fg3 }}>Принимает:</span>{' '}
                                  <strong>{ROLE_INFO[to]?.full}</strong>
                                </div>
                                <div style={{ display:'flex', gap: 12, fontSize: 11 }}>
                                  <span style={{ color: cur.audio ? C.good : C.fg4 }}>🎤 {cur.audio ? 'разрешено' : 'запрещено'}</span>
                                  <span style={{ color: cur.video ? C.good : C.fg4 }}>🎥 {cur.video ? 'разрешено' : 'запрещено'}</span>
                                </div>
                                {cur.fallback && (
                                  <div style={{ marginTop: 6, fontSize: 10, color: C.fg4 }}>
                                    Унаследовано из «Любая клиника»
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {rules.length > 0 && (
              <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12, justifyContent:'space-between' }}>
                <div style={{ fontSize: 12, color: C.fg3 }}>
                  Создано {rules.length} {ruleWordRu(rules.length)}. Все остальные пары — по умолчанию разрешены.
                </div>
                <button onClick={resetAll}
                  style={{
                    padding: '10px 18px', borderRadius: 10, cursor: 'pointer',
                    background: C.badSoft, color: C.bad, border: `1px solid ${C.bad}`,
                    fontSize: 12, fontWeight: 600, transition: 'all 0.15s',
                  }}>
                  Сбросить всё
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}


function ruleWordRu(n) {
  const last = n % 10
  if (n >= 11 && n <= 14) return 'правил'
  if (last === 1) return 'правило'
  if (last >= 2 && last <= 4) return 'правила'
  return 'правил'
}

function cellHead(C, align) {
  return {
    padding: '14px 12px',
    textAlign: align,
    background: C.surfaceHi,
    color: C.fg2,
    fontWeight: 600,
    fontSize: 12,
    borderBottom: `2px solid ${C.line}`,
    position: align === 'left' ? 'sticky' : undefined,
    left: align === 'left' ? 0 : undefined,
    zIndex: align === 'left' ? 2 : 1,
    whiteSpace: 'nowrap',
  }
}

function Step({ n, title, text }) {
  return (
    <div>
      <div style={{
        width: 28, height: 28, borderRadius: '50%',
        background: 'oklch(0.72 0.13 220 / 0.18)', color: 'oklch(0.72 0.13 220)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 800, fontSize: 13, marginBottom: 8,
      }}>{n}</div>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12.5, color: 'oklch(0.66 0.018 230)', lineHeight: 1.5 }}>{text}</div>
    </div>
  )
}

function LegendItem({ on, color, icon, label }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        width: 26, height: 26, borderRadius: 8,
        background: on ? 'oklch(0.74 0.15 160 / 0.18)' : 'oklch(0.295 0.020 235)',
        opacity: on ? 1 : 0.45,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ fontSize: 14, filter: on ? 'none' : 'grayscale(1)' }}>{icon}</span>
      </div>
      <span style={{ color: 'oklch(0.82 0.014 230)' }}>{label}</span>
    </div>
  )
}

function Pill({ icon, on, loading, fallback, onClick, C }) {
  return (
    <button onClick={onClick} disabled={loading}
      title={loading ? 'Сохраняется…' : (on ? 'Разрешено — клик чтобы запретить' : 'Запрещено — клик чтобы разрешить')}
      style={{
        width: 38, height: 28, borderRadius: 8,
        background: on ? C.goodSoft : C.surfaceHi,
        border: `1px solid ${on ? C.good : C.border}`,
        color: on ? C.good : C.fg4,
        cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        opacity: loading ? 0.5 : (on ? 1 : 0.55),
        filter: on ? 'none' : 'grayscale(1)',
        position: 'relative',
        transition: 'all 0.15s',
        fontSize: 14,
      }}>
      <span>{icon}</span>
      {fallback && (
        <span style={{
          position: 'absolute', top: -3, right: -3, fontSize: 8, color: C.fg4,
        }}>↑</span>
      )}
    </button>
  )
}
