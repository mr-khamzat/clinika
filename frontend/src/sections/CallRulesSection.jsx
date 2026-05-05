/**
 * CallRulesSection — правила звонков (v2: глобально + per-clinic).
 *
 * Tabs:
 *   1. Глобально — матрица ролей без учёта клиник (наследуется как fallback)
 *   2. По клиникам — выбираешь пару клиник → точечная матрица ролей
 *
 * Иерархия: per-clinic (точное) → role-only (глобально) → дефолт.
 */
import { useEffect, useState, useMemo, useCallback } from 'react'
import axios from 'axios'
import { API_BASE } from '../config'

const authH = t => ({ Authorization: `Bearer ${t}` })

const ROLE_INFO = {
  franchise_owner: { short: 'Владелец',    full: 'Владелец франшизы' },
  manager:         { short: 'Управляющий', full: 'Управляющий клиники' },
  supervisor:      { short: 'Старший',     full: 'Старший на месте' },
  admin:           { short: 'Регистратор', full: 'Администратор' },
  nurse:           { short: 'Медсестра',   full: 'Медсестра' },
  doctor:          { short: 'Врач',        full: 'Врач (штатный)' },
  recruiter:       { short: 'Рекрутер',    full: 'Рекрутер' },
  accountant:      { short: 'Бухгалтер',   full: 'Бухгалтер' },
}

const TELEPHONY_MODULES = ['telephony_basic', 'cross_clinic_audio', 'video_calls', 'video_conference']

export default function CallRulesSection({ adminToken, tenantId: fixedTenantId }) {
  const [tenants, setTenants]       = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [tenantData, setTenantData] = useState(null)
  const [clinics, setClinics]       = useState([])
  const [rules, setRules]           = useState([])
  const [activeRoles, setActiveRoles] = useState([])
  const [tab, setTab]               = useState('global')   // 'global' | 'per_clinic'
  const [scope, setScope]           = useState('any')
  const [fromClinic, setFromClinic] = useState('')
  const [toClinic, setToClinic]     = useState('')
  const [loading, setLoading]       = useState(true)
  const [saving, setSaving]         = useState(null)

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
      axios.get(`${API_BASE}/clinics`, { headers: authH(adminToken) })
        .then(r => Array.isArray(r.data) ? r.data : (r.data?.clinics || []))
        .catch(() => []),
    ]).then(([rulesData, tData, clinicsData]) => {
      setRules(rulesData.rules || [])
      setActiveRoles(rulesData.active_roles || [])
      setTenantData(tData)
      const list = (clinicsData || []).filter(c => c.is_active !== false)
      setClinics(list)
      if (list.length && !fromClinic) setFromClinic(list[0].id)
      if (list.length > 1 && !toClinic) setToClinic(list[1].id)
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

  // Индекс правил по ключу
  const ruleIndex = useMemo(() => {
    const idx = {}
    for (const r of rules) {
      const fc = r.from_clinic_id || ''
      const tc = r.to_clinic_id || ''
      idx[`${fc}|${tc}|${r.from_role}|${r.to_role}|${r.scope}`] = r
    }
    return idx
  }, [rules])

  const cellState = (from, to) => {
    if (tab === 'per_clinic' && fromClinic && toClinic) {
      const r = ruleIndex[`${fromClinic}|${toClinic}|${from}|${to}|any`]
      if (r) return { audio: r.allow_audio, video: r.allow_video, fromOverride: 'clinic' }
      // fallback на global
      const g = ruleIndex[`||${from}|${to}|${scope}`] || ruleIndex[`||${from}|${to}|any`]
      if (g) return { audio: g.allow_audio, video: g.allow_video, fromOverride: 'global' }
      return { audio: true, video: true, fromOverride: 'default' }
    }
    // Глобальный таб
    const r = ruleIndex[`||${from}|${to}|${scope}`]
    if (r) return { audio: r.allow_audio, video: r.allow_video, fromOverride: 'global' }
    if (scope !== 'any') {
      const r2 = ruleIndex[`||${from}|${to}|any`]
      if (r2) return { audio: r2.allow_audio, video: r2.allow_video, fromOverride: 'global', fallback: true }
    }
    return { audio: true, video: true, fromOverride: 'default' }
  }

  const toggleCell = async (from, to, field) => {
    const cur = cellState(from, to)
    const next = { ...cur, [field]: !cur[field] }
    const cellKey = `${from}|${to}|${field}`
    setSaving(cellKey)
    try {
      const body = {
        from_role: from,
        to_role: to,
        scope: tab === 'per_clinic' ? 'any' : scope,
        allow_audio: next.audio,
        allow_video: next.video,
      }
      if (tab === 'per_clinic') {
        body.from_clinic_id = fromClinic
        body.to_clinic_id = toClinic
      }
      await axios.put(`${API_BASE}/call-rules/${selectedId}`, body, { headers: authH(adminToken) })
      reload()
    } finally {
      setSaving(null)
    }
  }

  const resetAll = async () => {
    if (!confirm('Удалить все правила (глобальные и по клиникам)?')) return
    await axios.delete(`${API_BASE}/call-rules/${selectedId}`, { headers: authH(adminToken) })
    reload()
  }

  // Кол-во правил для пары клиник (для grid)
  const pairsCount = useMemo(() => {
    const m = {}
    for (const r of rules) {
      if (!r.from_clinic_id || !r.to_clinic_id) continue
      const k = `${r.from_clinic_id}|${r.to_clinic_id}`
      m[k] = (m[k] || 0) + 1
    }
    return m
  }, [rules])

  const fromClinicName = clinics.find(c => c.id === fromClinic)?.name || ''
  const toClinicName   = clinics.find(c => c.id === toClinic)?.name || ''

  if (loading) return <div className="p-8 text-center text-gray-500">Загрузка…</div>

  return (
    <div className="px-4 pb-24 max-w-6xl mx-auto">
      <div className="mb-5">
        <div className="text-[11px] font-bold uppercase tracking-wider text-[#0097A7] mb-1.5">
          Модуль связи · Правила звонков
        </div>
        <h1 className="text-2xl sm:text-3xl font-black text-gray-900 leading-tight">
          Кто и кому может звонить
        </h1>
        <p className="text-sm text-gray-500 mt-2 max-w-2xl">
          Настройте права аудио- и видеозвонков на двух уровнях:
          глобально по ролям или точечно для конкретной пары клиник.
          Per-clinic правила имеют приоритет над глобальными.
        </p>
      </div>

      {!fixedTenantId && (
        <div className="mb-4">
          <select value={selectedId} onChange={e => setSelectedId(e.target.value)}
            className="w-full p-3 rounded-xl border border-gray-200 bg-white text-sm font-medium">
            {tenants.map(t => <option key={t.id} value={t.id}>{t.name} ({t.slug})</option>)}
          </select>
        </div>
      )}

      {!hasTelephonyModule && (
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-5 mb-5 flex items-start gap-3">
          <span className="material-symbols-outlined text-amber-600" style={{ fontSize: 28 }}>warning</span>
          <div>
            <div className="font-bold text-amber-900 mb-1">Модуль телефонии не подключён</div>
            <div className="text-sm text-amber-800">
              Нужен один из активных модулей: «Базовая телефония», «Аудио между клиниками», «Видеозвонки» или «Видеоконференция».
            </div>
          </div>
        </div>
      )}

      {hasTelephonyModule && (
        <>
          {/* Main tabs */}
          <div className="flex bg-white rounded-xl border border-gray-200 p-1 mb-5 max-w-md">
            <TabBtn active={tab === 'global'} onClick={() => setTab('global')} icon="public" label="Глобально" />
            <TabBtn active={tab === 'per_clinic'} onClick={() => setTab('per_clinic')} icon="apartment" label="По клиникам" />
          </div>

          {tab === 'global' && (
            <GlobalTab
              activeRoles={activeRoles}
              scope={scope}
              setScope={setScope}
              cellState={cellState}
              saving={saving}
              toggleCell={toggleCell}
              rulesCount={rules.filter(r => !r.from_clinic_id).length}
            />
          )}

          {tab === 'per_clinic' && (
            <PerClinicTab
              clinics={clinics}
              fromClinic={fromClinic}
              toClinic={toClinic}
              setFromClinic={setFromClinic}
              setToClinic={setToClinic}
              fromClinicName={fromClinicName}
              toClinicName={toClinicName}
              activeRoles={activeRoles}
              cellState={cellState}
              saving={saving}
              toggleCell={toggleCell}
              pairsCount={pairsCount}
              setScope={setScope}
            />
          )}

          {rules.length > 0 && (
            <div className="mt-5 flex items-center gap-3 justify-between flex-wrap">
              <div className="text-xs text-gray-500">
                Всего {rules.length} {ruleWordRu(rules.length)}: глобальных{' '}
                <strong>{rules.filter(r => !r.from_clinic_id).length}</strong>, по клиникам{' '}
                <strong>{rules.filter(r => r.from_clinic_id).length}</strong>
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


function TabBtn({ active, onClick, icon, label }) {
  return (
    <button onClick={onClick}
      className={`flex-1 px-4 py-2 rounded-lg text-sm font-bold transition flex items-center justify-center gap-2 ${
        active ? 'bg-[#0097A7] text-white' : 'text-gray-500 hover:bg-gray-50'
      }`}>
      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{icon}</span>
      {label}
    </button>
  )
}


function GlobalTab({ activeRoles, scope, setScope, cellState, saving, toggleCell, rulesCount }) {
  const SCOPE_INFO = {
    any:          { title: 'Любая клиника',   sub: 'Применяется когда стороны в одной или разных клиниках', icon: 'public' },
    same_clinic:  { title: 'В одной клинике', sub: 'Только когда обе стороны в одном филиале',             icon: 'local_hospital' },
    cross_clinic: { title: 'Между клиниками', sub: 'Только когда стороны в разных филиалах',               icon: 'alt_route' },
  }

  return (
    <>
      <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-4">
        <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">Уровень применения</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {Object.entries(SCOPE_INFO).map(([id, info]) => {
            const active = scope === id
            return (
              <button key={id} onClick={() => setScope(id)}
                className={`p-3 rounded-xl text-left border-2 transition ${
                  active ? 'bg-[#0097A7]/10 border-[#0097A7]' : 'bg-white border-gray-100 hover:border-gray-300'
                }`}>
                <span className="material-symbols-outlined mb-1 block"
                  style={{ fontSize: 22, color: active ? '#0097A7' : '#9ca3af' }}>{info.icon}</span>
                <div className={`font-bold text-sm ${active ? 'text-[#0097A7]' : 'text-gray-900'}`}>
                  {info.title}
                </div>
                <div className="text-xs text-gray-500 mt-1 leading-snug">{info.sub}</div>
              </button>
            )
          })}
        </div>
      </div>

      <Matrix activeRoles={activeRoles} cellState={cellState} saving={saving} toggleCell={toggleCell} />
    </>
  )
}


function PerClinicTab({ clinics, fromClinic, toClinic, setFromClinic, setToClinic, fromClinicName, toClinicName,
                       activeRoles, cellState, saving, toggleCell, pairsCount, setScope }) {
  // Заменим scope на 'any' для per-clinic — он не используется но в backend нужно any
  if (clinics.length < 2) {
    return (
      <div className="rounded-2xl bg-blue-50 border border-blue-200 p-5 text-sm text-blue-800">
        Для настройки правил между клиниками нужно минимум 2 клиники в тенанте. Сейчас {clinics.length}.
      </div>
    )
  }

  return (
    <>
      <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-4">
        <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">Пара клиник</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Кто звонит</label>
            <select value={fromClinic} onChange={e => setFromClinic(e.target.value)}
              className="w-full p-2.5 rounded-lg border border-gray-200 bg-white text-sm font-medium">
              {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Кому звонят</label>
            <select value={toClinic} onChange={e => setToClinic(e.target.value)}
              className="w-full p-2.5 rounded-lg border border-gray-200 bg-white text-sm font-medium">
              {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-3 text-xs text-gray-500 flex items-center gap-2">
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>info</span>
          Правила для пары <strong>{fromClinicName}</strong> →{' '}
          <strong>{toClinicName}</strong> переопределяют глобальные.
          Если не задано — наследуется из «Глобально».
        </div>
      </div>

      <Matrix activeRoles={activeRoles} cellState={cellState} saving={saving} toggleCell={toggleCell} />

      {/* Сводка по всем парам */}
      {Object.keys(pairsCount).length > 0 && (
        <div className="mt-4 bg-white rounded-2xl border border-gray-100 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">Настроенные пары</div>
          <div className="space-y-1.5">
            {Object.entries(pairsCount).map(([k, count]) => {
              const [fc, tc] = k.split('|')
              const fn = clinics.find(c => c.id === fc)?.name || fc.slice(0, 6)
              const tn = clinics.find(c => c.id === tc)?.name || tc.slice(0, 6)
              return (
                <button key={k} onClick={() => { setFromClinic(fc); setToClinic(tc) }}
                  className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 text-left">
                  <span className="material-symbols-outlined text-gray-400" style={{ fontSize: 16 }}>arrow_forward</span>
                  <span className="text-sm font-medium">{fn}</span>
                  <span className="text-gray-300">→</span>
                  <span className="text-sm font-medium">{tn}</span>
                  <span className="ml-auto text-xs bg-gray-100 px-2 py-0.5 rounded">{count} {ruleWordRu(count)}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}


function Matrix({ activeRoles, cellState, saving, toggleCell }) {
  return (
    <>
      <div className="bg-white rounded-2xl border border-gray-100 p-3 mb-3 flex flex-wrap gap-4 items-center">
        <Legend on icon="mic"      label="Аудио разрешено" />
        <Legend on icon="videocam" label="Видео разрешено" />
        <Legend    icon="mic"      label="Запрещено (аудио)" />
        <Legend    icon="videocam" label="Запрещено (видео)" />
      </div>

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
                  if (from === to) return <td key={to} className="text-center text-gray-200 border-b border-gray-100">—</td>
                  const cur = cellState(from, to)
                  const audioKey = `${from}|${to}|audio`
                  const videoKey = `${from}|${to}|video`
                  return (
                    <td key={to} className="p-2 text-center border-b border-gray-100">
                      <div className="inline-flex flex-col gap-1">
                        <Pill icon="mic"      on={cur.audio} loading={saving === audioKey}
                          inheritedFrom={cur.fromOverride}
                          onClick={() => toggleCell(from, to, 'audio')} />
                        <Pill icon="videocam" on={cur.video} loading={saving === videoKey}
                          inheritedFrom={cur.fromOverride}
                          onClick={() => toggleCell(from, to, 'video')} />
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}


function Legend({ on, icon, label }) {
  return (
    <div className="inline-flex items-center gap-2 text-xs">
      <div className={`w-7 h-6 rounded-md inline-flex items-center justify-center ${on ? 'bg-emerald-100' : 'bg-gray-100'}`}>
        <span className="material-symbols-outlined" style={{ fontSize: 16, color: on ? '#059669' : '#94a3b8' }}>{icon}</span>
      </div>
      <span className="text-gray-700">{label}</span>
    </div>
  )
}


function Pill({ icon, on, loading, inheritedFrom, onClick }) {
  // inheritedFrom: 'clinic' | 'global' | 'default'
  const isInherited = inheritedFrom === 'global' || inheritedFrom === 'default'
  return (
    <button onClick={onClick} disabled={loading}
      title={
        loading ? 'Сохраняется…' :
        (on ? 'Разрешено — клик чтобы запретить' : 'Запрещено — клик чтобы разрешить') +
        (inheritedFrom === 'global' ? ' (унаследовано из глобальных)' :
         inheritedFrom === 'default' ? ' (по умолчанию)' : '')
      }
      className={`w-9 h-7 rounded-md inline-flex items-center justify-center transition relative ${
        on
          ? 'bg-emerald-50 border border-emerald-300 hover:bg-emerald-100'
          : 'bg-gray-50 border border-gray-200 hover:bg-gray-100'
      } ${loading ? 'opacity-50' : ''} ${isInherited ? 'opacity-70' : ''}`}>
      <span className="material-symbols-outlined" style={{ fontSize: 16, color: on ? '#059669' : '#94a3b8' }}>{icon}</span>
      {inheritedFrom === 'global' && (
        <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-400" />
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
