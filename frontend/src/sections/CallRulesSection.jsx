/**
 * CallRulesSection — правила звонков (светлый стиль, единый с кабинетом).
 *
 * Компонент использует ту же палитру что весь SupervisorCabinet/FranchiseOwnerCabinet:
 *   фон #F0F4F8, поверхности белые, акценты teal #0097A7 и emerald,
 *   иконки Material Symbols (как везде в кабинете).
 */
import { useEffect, useState, useMemo, useCallback } from 'react'
import axios from 'axios'
import { API_BASE } from '../config'

const authH = t => ({ Authorization: `Bearer ${t}` })

const ROLE_INFO = {
  franchise_owner: { short: 'Владелец',    full: 'Владелец франшизы',   desc: 'Управляет всеми тенантами франшизы' },
  manager:         { short: 'Управляющий', full: 'Управляющий клиники', desc: 'Полная операционка одного тенанта' },
  supervisor:      { short: 'Старший',     full: 'Старший на месте',    desc: 'Оперативное управление, аналитика' },
  admin:           { short: 'Регистратор', full: 'Администратор',       desc: 'Создание направлений, чаты' },
  nurse:           { short: 'Медсестра',   full: 'Медсестра',           desc: 'Запись пациентов, помощь врачу' },
  doctor:          { short: 'Врач',        full: 'Врач (штатный)',      desc: 'Расписание, приём, медкарта' },
  recruiter:       { short: 'Рекрутер',    full: 'Рекрутер',            desc: 'Приглашение врачей, бонусы' },
  accountant:      { short: 'Бухгалтер',   full: 'Бухгалтер',           desc: 'Акты, счета, реквизиты, ЭП' },
}

const SCOPE_INFO = {
  any: {
    title: 'Любая клиника',
    sub: 'Применяется когда стороны в одной или разных клиниках',
    icon: 'public',
  },
  same_clinic: {
    title: 'В одной клинике',
    sub: 'Когда обе стороны работают в одном филиале',
    icon: 'local_hospital',
  },
  cross_clinic: {
    title: 'Между клиниками',
    sub: 'Когда стороны в разных филиалах одной сети',
    icon: 'alt_route',
  },
}

const TELEPHONY_MODULES = ['telephony_basic', 'cross_clinic_audio', 'video_calls', 'video_conference']

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
    if (r) return { audio: r.allow_audio, video: r.allow_video, hasOverride: true, fallback: false }
    if (scope !== 'any') {
      const r2 = ruleIndex[`${from}|${to}|any`]
      if (r2) return { audio: r2.allow_audio, video: r2.allow_video, hasOverride: false, fallback: true }
    }
    return { audio: true, video: true, hasOverride: false, fallback: false }
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

  if (loading) return <div className="p-8 text-center text-gray-500">Загрузка…</div>

  return (
    <div className="px-4 pb-24 max-w-6xl mx-auto">
      {/* Hero */}
      <div className="mb-5">
        <div className="text-[11px] font-bold uppercase tracking-wider text-[#0097A7] mb-1.5">
          Модуль связи · Правила
        </div>
        <h1 className="text-2xl sm:text-3xl font-black text-gray-900 leading-tight">
          Кто и кому может звонить
        </h1>
        <p className="text-sm text-gray-500 mt-2 max-w-2xl">
          Настройте права аудио- и видеозвонков для каждой пары ролей.
          По умолчанию все сотрудники могут связываться друг с другом —
          здесь вы добавляете точечные ограничения.
        </p>
      </div>

      {/* Tenant selector */}
      {!fixedTenantId && (
        <div className="mb-4">
          <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Тенант</label>
          <select value={selectedId} onChange={e => setSelectedId(e.target.value)}
            className="w-full p-3 rounded-xl border border-gray-200 bg-white text-sm font-medium">
            {tenants.map(t => <option key={t.id} value={t.id}>{t.name} ({t.slug})</option>)}
          </select>
        </div>
      )}

      {/* Module status */}
      {!hasTelephonyModule && (
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-5 mb-5 flex items-start gap-3">
          <span className="material-symbols-outlined text-amber-600" style={{ fontSize: 28 }}>warning</span>
          <div>
            <div className="font-bold text-amber-900 mb-1">Модуль телефонии не подключён</div>
            <div className="text-sm text-amber-800">
              Чтобы настраивать правила, нужен один из активных модулей: «Базовая телефония»,
              «Аудио между клиниками», «Видеозвонки» или «Видеоконференция». Откройте раздел
              «Модули» у этого тенанта.
            </div>
          </div>
        </div>
      )}

      {hasTelephonyModule && inGrace && (
        <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4 mb-5 flex items-center gap-3 text-sm text-rose-800">
          <span className="material-symbols-outlined text-rose-600">schedule</span>
          <div>
            <span className="font-bold">Льготный период.</span>{' '}
            Звонки работают до {new Date(inGrace).toLocaleString('ru-RU')}, после этой даты модуль отключится.
          </div>
        </div>
      )}

      {hasTelephonyModule && (
        <>
          {/* How to */}
          <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-[#0097A7] mb-4">
              Как настроить
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Step n={1} title="Выберите уровень"
                text='«Любая клиника» — общая политика. «В одной клинике» — для коллег под одной крышей. «Между клиниками» — для разных филиалов сети.' />
              <Step n={2} title="Снимите галочки"
                text="Найдите пару ролей. Зелёные иконки = разрешено, серые = запрещено. Микрофон — голос, камера — видео." />
              <Step n={3} title="Сохранится автоматически"
                text="Каждый клик мгновенно отправляется на сервер. Можно сбросить все правила одной кнопкой внизу." />
            </div>
          </div>

          {/* Scope cards */}
          <div className="mb-5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">Уровень правил</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {Object.entries(SCOPE_INFO).map(([id, info]) => {
                const active = scope === id
                return (
                  <button key={id} onClick={() => setScope(id)}
                    className={`p-4 rounded-2xl text-left border-2 transition ${
                      active
                        ? 'bg-[#0097A7]/10 border-[#0097A7]'
                        : 'bg-white border-gray-100 hover:border-gray-300'
                    }`}>
                    <span className="material-symbols-outlined mb-2 block"
                      style={{ fontSize: 28, color: active ? '#0097A7' : '#9ca3af' }}>{info.icon}</span>
                    <div className={`font-bold text-sm mb-1 ${active ? 'text-[#0097A7]' : 'text-gray-900'}`}>
                      {info.title}
                    </div>
                    <div className="text-xs text-gray-500 leading-snug">{info.sub}</div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Legend */}
          <div className="bg-white rounded-2xl border border-gray-100 p-3 mb-4 flex flex-wrap gap-4 items-center">
            <LegendItem on icon="mic"      label="Аудио разрешено" />
            <LegendItem on icon="videocam" label="Видео разрешено" />
            <LegendItem    icon="mic"      label="Аудио запрещено" />
            <LegendItem    icon="videocam" label="Видео запрещено" />
            <div className="ml-auto text-[11px] text-gray-400">
              {rules.length > 0 ? `${rules.length} ${ruleWordRu(rules.length)} настроено` : 'Активна политика по умолчанию'}
            </div>
          </div>

          {/* Matrix */}
          <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto">
            <table className="w-full text-xs" style={{ minWidth: 720, borderCollapse: 'separate', borderSpacing: 0 }}>
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left p-3 sticky left-0 bg-gray-50 z-10 border-b border-gray-200">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 leading-tight">КТО ↓</div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 leading-tight">КОМУ →</div>
                  </th>
                  {activeRoles.map(r => (
                    <th key={r} className="p-3 text-center border-b border-gray-200">
                      <div className="font-bold text-gray-900 text-xs">{ROLE_INFO[r]?.short || r}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeRoles.map(from => (
                  <tr key={from}>
                    <td className="p-3 sticky left-0 bg-white z-10 whitespace-nowrap border-b border-gray-100">
                      <div className="font-bold text-gray-900 text-xs">{ROLE_INFO[from]?.short || from}</div>
                      <div className="text-[10px] text-gray-400 mt-0.5">{ROLE_INFO[from]?.full}</div>
                    </td>
                    {activeRoles.map(to => {
                      if (from === to) {
                        return (
                          <td key={to} className="text-center text-gray-200 border-b border-gray-100">—</td>
                        )
                      }
                      const cur = cellState(from, to)
                      const audioKey = `${from}|${to}|${scope}|audio`
                      const videoKey = `${from}|${to}|${scope}|video`
                      const tipKey = `${from}|${to}`
                      return (
                        <td key={to} className="p-2 text-center border-b border-gray-100 relative"
                            onMouseEnter={() => setTooltip(tipKey)}
                            onMouseLeave={() => setTooltip(null)}>
                          <div className="inline-flex flex-col gap-1">
                            <Pill icon="mic"      on={cur.audio} loading={saving === audioKey} fallback={cur.fallback}
                              onClick={() => toggleCell(from, to, 'audio')} />
                            <Pill icon="videocam" on={cur.video} loading={saving === videoKey} fallback={cur.fallback}
                              onClick={() => toggleCell(from, to, 'video')} />
                          </div>
                          {tooltip === tipKey && (
                            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-3.5 py-2.5
                              bg-gray-900 text-white rounded-lg shadow-xl z-30 whitespace-nowrap pointer-events-none">
                              <div className="text-[11px] mb-1">
                                <span className="text-gray-400">Звонит:</span>{' '}
                                <strong>{ROLE_INFO[from]?.full}</strong>
                              </div>
                              <div className="text-[11px] mb-2">
                                <span className="text-gray-400">Принимает:</span>{' '}
                                <strong>{ROLE_INFO[to]?.full}</strong>
                              </div>
                              <div className="flex gap-3 text-[11px]">
                                <span className={cur.audio ? 'text-emerald-300' : 'text-gray-500 line-through'}>
                                  <span className="material-symbols-outlined align-middle" style={{ fontSize: 14 }}>mic</span>
                                  {' '}{cur.audio ? 'разрешено' : 'запрещено'}
                                </span>
                                <span className={cur.video ? 'text-emerald-300' : 'text-gray-500 line-through'}>
                                  <span className="material-symbols-outlined align-middle" style={{ fontSize: 14 }}>videocam</span>
                                  {' '}{cur.video ? 'разрешено' : 'запрещено'}
                                </span>
                              </div>
                              {cur.fallback && (
                                <div className="mt-1.5 text-[10px] text-gray-400">
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
            <div className="mt-4 flex items-center gap-3 justify-between flex-wrap">
              <div className="text-xs text-gray-500">
                Создано {rules.length} {ruleWordRu(rules.length)}. Все остальные пары — по умолчанию разрешены.
              </div>
              <button onClick={resetAll}
                className="px-4 py-2 rounded-lg bg-rose-50 text-rose-700 border border-rose-200
                  text-xs font-bold hover:bg-rose-100 transition flex items-center gap-1.5">
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span>
                Сбросить всё
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}


function Step({ n, title, text }) {
  return (
    <div>
      <div className="w-7 h-7 rounded-full bg-[#0097A7]/15 text-[#0097A7] inline-flex items-center justify-center font-black text-[13px] mb-2">
        {n}
      </div>
      <div className="font-bold text-sm text-gray-900 mb-1">{title}</div>
      <div className="text-xs text-gray-500 leading-relaxed">{text}</div>
    </div>
  )
}

function LegendItem({ on, icon, label }) {
  return (
    <div className="inline-flex items-center gap-2 text-xs">
      <div className={`w-7 h-6 rounded-md inline-flex items-center justify-center ${
        on ? 'bg-emerald-100' : 'bg-gray-100'
      }`}>
        <span className="material-symbols-outlined" style={{
          fontSize: 16,
          color: on ? '#059669' : '#94a3b8',
        }}>{icon}</span>
      </div>
      <span className="text-gray-700">{label}</span>
    </div>
  )
}

function Pill({ icon, on, loading, fallback, onClick }) {
  return (
    <button onClick={onClick} disabled={loading}
      title={loading ? 'Сохраняется…' : (on ? 'Разрешено — клик чтобы запретить' : 'Запрещено — клик чтобы разрешить')}
      className={`w-9 h-7 rounded-md inline-flex items-center justify-center transition relative ${
        on
          ? 'bg-emerald-50 border border-emerald-300 hover:bg-emerald-100'
          : 'bg-gray-50 border border-gray-200 hover:bg-gray-100'
      } ${loading ? 'opacity-50' : ''}`}>
      <span className="material-symbols-outlined" style={{
        fontSize: 16,
        color: on ? '#059669' : '#94a3b8',
      }}>{icon}</span>
      {fallback && (
        <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-400 border border-white" />
      )}
    </button>
  )
}


function ruleWordRu(n) {
  const last = n % 10
  if (n >= 11 && n <= 14) return 'правил'
  if (last === 1) return 'правило'
  if (last >= 2 && last <= 4) return 'правила'
  return 'правил'
}
