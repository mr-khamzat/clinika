/**
 * CallRulesSection — управление правилами звонков (матричная версия).
 *
 * UX: дропдаун выбора тенанта (если не fixedTenantId) → проверка модуля телефонии →
 *     дропдаун scope (any / same_clinic / cross_clinic) → матрица rows=from_role,
 *     cols=to_role с двумя чекбоксами в ячейке: 🎤 audio и 🎥 video.
 *
 * Дефолт системы: «все активные роли могут друг другу аудио и видео» — все галочки on.
 * Каждый клик по галочке → upsert правила (если оба on и =дефолт — можно оставить запись,
 * это не вредит). Снятие галочки = explicit deny.
 */
import { useEffect, useState, useMemo, useCallback } from 'react'
import axios from 'axios'
import { API_BASE } from '../config'

const authH = t => ({ Authorization: `Bearer ${t}` })

const ROLE_LABELS = {
  franchise_owner: 'Влад. фр.',
  manager:         'Управ.',
  supervisor:      'Старший',
  admin:           'Регистр.',
  nurse:           'Медсестра',
  doctor:          'Врач',
  recruiter:       'Рекрутер',
  accountant:      'Бухгал.',
}
const SCOPE_OPTIONS = [
  { id: 'any',          label: 'Любая клиника' },
  { id: 'same_clinic',  label: 'Одна клиника' },
  { id: 'cross_clinic', label: 'Между клиниками' },
]
const TELEPHONY_MODULES = ['telephony_basic', 'cross_clinic_audio', 'video_calls', 'video_conference']

export default function CallRulesSection({ adminToken, tenantId: fixedTenantId }) {
  const [tenants, setTenants]     = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [tenantData, setTenantData] = useState(null)
  const [rules, setRules]         = useState([])
  const [activeRoles, setActiveRoles] = useState([])
  const [scope, setScope]         = useState('any')
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(null)  // ключ ячейки, которая сейчас сохраняется

  // Загрузка тенантов франшизы (если tenantId не зафиксирован)
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

  // Загрузка правил + модулей
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

  // Индекс правил для быстрого поиска: ключ "from|to|scope"
  const ruleIndex = useMemo(() => {
    const idx = {}
    for (const r of rules) idx[`${r.from_role}|${r.to_role}|${r.scope}`] = r
    return idx
  }, [rules])

  // Получить текущие права для ячейки (rule || default = both true)
  const cellState = (from, to) => {
    const r = ruleIndex[`${from}|${to}|${scope}`]
    if (r) return { audio: r.allow_audio, video: r.allow_video }
    // Если scope != any и точного нет — fallback на ANY
    if (scope !== 'any') {
      const r2 = ruleIndex[`${from}|${to}|any`]
      if (r2) return { audio: r2.allow_audio, video: r2.allow_video }
    }
    return { audio: true, video: true }   // дефолт
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
    if (!confirm('Удалить все правила и вернуться к дефолтам?')) return
    await axios.delete(`${API_BASE}/call-rules/${selectedId}`, { headers: authH(adminToken) })
    reload()
  }

  if (loading) return <div className="p-6 text-center text-gray-500">Загрузка…</div>

  return (
    <div className="px-4 pb-24 max-w-6xl mx-auto">
      <h2 className="text-2xl font-black mb-1">Правила звонков</h2>
      <p className="text-sm text-gray-500 mb-5">
        По умолчанию все могут звонить друг другу. Снимите галочку чтобы запретить связь между ролями.
      </p>

      {/* Tenant selector — скрыт если зафиксирован */}
      {!fixedTenantId && (
        <div className="mb-4">
          <label className="block text-xs font-semibold text-gray-500 mb-1">Тенант</label>
          <select value={selectedId} onChange={e => setSelectedId(e.target.value)}
            className="w-full p-3 rounded-xl border border-gray-200 bg-white text-sm font-medium">
            {tenants.map(t => <option key={t.id} value={t.id}>{t.name} ({t.slug})</option>)}
          </select>
        </div>
      )}

      {/* Module status */}
      {!hasTelephonyModule && (
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-5 mb-5">
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined text-amber-600">warning</span>
            <div className="text-sm text-amber-800">
              <span className="font-bold">Модуль телефонии не подключён.</span>{' '}
              Перейдите в раздел «Модули» и активируйте «Базовая телефония», «Аудио между клиниками» или «Видеозвонки».
            </div>
          </div>
        </div>
      )}

      {hasTelephonyModule && inGrace && (
        <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4 mb-5 text-sm text-rose-800">
          <span className="font-bold">Льготный период.</span> Звонки работают до{' '}
          {new Date(inGrace).toLocaleString('ru-RU')}.
        </div>
      )}

      {hasTelephonyModule && (
        <>
          {/* Scope tabs */}
          <div className="flex bg-gray-100 rounded-xl p-1 mb-4 max-w-md">
            {SCOPE_OPTIONS.map(s => (
              <button key={s.id} onClick={() => setScope(s.id)}
                className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold transition ${scope === s.id ? 'bg-white shadow' : 'text-gray-500'}`}>
                {s.label}
              </button>
            ))}
          </div>

          {/* Matrix */}
          <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto">
            <table className="w-full text-xs" style={{ minWidth: 700 }}>
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left p-2 font-bold text-gray-500 sticky left-0 bg-gray-50">КТО ↓ КОМУ →</th>
                  {activeRoles.map(r => (
                    <th key={r} className="p-2 font-bold text-gray-700 text-center">
                      <div>{ROLE_LABELS[r] || r}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeRoles.map(from => (
                  <tr key={from} className="border-t border-gray-100">
                    <td className="p-2 font-bold text-gray-700 sticky left-0 bg-white whitespace-nowrap">
                      {ROLE_LABELS[from] || from}
                    </td>
                    {activeRoles.map(to => {
                      if (from === to) {
                        return <td key={to} className="p-2 text-center text-gray-200">—</td>
                      }
                      const cur = cellState(from, to)
                      const audioKey = `${from}|${to}|${scope}|audio`
                      const videoKey = `${from}|${to}|${scope}|video`
                      return (
                        <td key={to} className="p-2 text-center">
                          <div className="inline-flex flex-col gap-1">
                            <Toggle
                              icon="🎤"
                              on={cur.audio}
                              loading={saving === audioKey}
                              onClick={() => toggleCell(from, to, 'audio')}
                            />
                            <Toggle
                              icon="🎥"
                              on={cur.video}
                              loading={saving === videoKey}
                              onClick={() => toggleCell(from, to, 'video')}
                            />
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {rules.length > 0 && (
            <button onClick={resetAll}
              className="mt-4 px-4 py-2 rounded-xl text-sm font-semibold text-rose-600 hover:bg-rose-50">
              Сбросить все правила к дефолтам ({rules.length})
            </button>
          )}

          <div className="mt-4 text-xs text-gray-400">
            🎤 — голосовые звонки, 🎥 — видеозвонки. Правило сохраняется при клике.
            Зелёный = разрешено, серый = запрещено.
          </div>
        </>
      )}
    </div>
  )
}


function Toggle({ icon, on, loading, onClick }) {
  return (
    <button onClick={onClick} disabled={loading}
      className={`w-7 h-7 rounded-md text-sm flex items-center justify-center transition ${
        on ? 'bg-emerald-100 hover:bg-emerald-200' : 'bg-gray-100 hover:bg-gray-200 grayscale opacity-40'
      } ${loading ? 'animate-pulse' : ''}`}>
      {icon}
    </button>
  )
}
