/**
 * CallRulesSection — управление правилами звонков для тенантов франшизы.
 * Доступна владельцу франшизы (FranchiseOwnerCabinet).
 *
 * UX: дропдаун тенанта → проверка активного модуля телефонии →
 *     список правил-исключений + кнопка добавить новое.
 *
 * Дефолт системы: «все активные роли могут друг другу аудио и видео».
 * Правила в этом UI — это ОТКЛЮЧЕНИЯ или сужения дефолта.
 */
import { useEffect, useState, useMemo } from 'react'
import axios from 'axios'
import { API_BASE } from '../config'

const authH = t => ({ Authorization: `Bearer ${t}` })

const ROLE_LABELS = {
  franchise_owner: 'Владелец франшизы',
  manager:         'Управляющий',
  supervisor:      'Старший',
  admin:           'Администратор',
  nurse:           'Медсестра',
  doctor:          'Врач',
  recruiter:       'Рекрутер',
  accountant:      'Бухгалтер',
}
const SCOPE_LABELS = {
  any:           'Любая клиника',
  same_clinic:   'В одной клинике',
  cross_clinic:  'Между клиниками',
}
const TELEPHONY_MODULES = ['telephony_basic', 'cross_clinic_audio', 'video_calls', 'video_conference']

export default function CallRulesSection({ adminToken, tenantId: fixedTenantId }) {
  const [tenants, setTenants]       = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [tenantData, setTenantData] = useState(null)  // {modules: [...], ...}
  const [rules, setRules]           = useState([])
  const [activeRoles, setActiveRoles] = useState([])
  const [loading, setLoading]       = useState(true)
  const [adding, setAdding]         = useState(false)
  const [draft, setDraft]           = useState({ from_role:'doctor', to_role:'doctor', scope:'any', allow_audio:false, allow_video:false })

  // Загрузка списка тенантов франшизы — пропускаем если tenantId передан явно
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

  // Загрузка правил и модулей выбранного тенанта
  useEffect(() => {
    if (!selectedId) { setRules([]); setTenantData(null); return }
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
  }, [selectedId])

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

  const saveRule = async (rule) => {
    await axios.put(`${API_BASE}/call-rules/${selectedId}`, rule, { headers: authH(adminToken) })
    const r = await axios.get(`${API_BASE}/call-rules/${selectedId}`, { headers: authH(adminToken) })
    setRules(r.data.rules || [])
  }

  const onAdd = async () => {
    await saveRule(draft)
    setAdding(false)
    setDraft({ from_role:'doctor', to_role:'doctor', scope:'any', allow_audio:false, allow_video:false })
  }

  const toggleField = async (rule, field) => {
    await saveRule({ ...rule, [field]: !rule[field] })
  }

  const resetAll = async () => {
    if (!confirm('Удалить все правила и вернуться к дефолтам?')) return
    await axios.delete(`${API_BASE}/call-rules/${selectedId}`, { headers: authH(adminToken) })
    setRules([])
  }

  if (loading) return <div className="p-6 text-center text-gray-500">Загрузка…</div>

  return (
    <div className="px-4 pb-24 max-w-4xl mx-auto">
      <h2 className="text-2xl font-black mb-1">Правила звонков</h2>
      <p className="text-sm text-gray-500 mb-5">
        По умолчанию все активные роли могут звонить друг другу. Здесь добавляются исключения.
      </p>

      {/* Выбор тенанта — скрыт если tenantId зафиксирован */}
      {!fixedTenantId && (
      <div className="mb-5">
        <label className="block text-xs font-semibold text-gray-500 mb-1">Тенант</label>
        <select value={selectedId} onChange={e => setSelectedId(e.target.value)}
          className="w-full p-3 rounded-xl border border-gray-200 bg-white text-sm font-medium">
          {tenants.map(t => <option key={t.id} value={t.id}>{t.name} ({t.slug})</option>)}
        </select>
      </div>
      )}

      {/* Состояние модуля */}
      {!hasTelephonyModule && (
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-5 mb-5">
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined text-amber-600">warning</span>
            <div>
              <div className="font-bold text-amber-900 mb-1">Модуль телефонии не подключён</div>
              <div className="text-sm text-amber-800">
                Чтобы настраивать звонки, подключите хотя бы один из модулей:
                «Базовая телефония», «Аудио между клиниками», «Видеозвонки», «Видеоконференция».
                Перейдите в раздел <span className="font-semibold">Модули</span> у этого тенанта.
              </div>
            </div>
          </div>
        </div>
      )}

      {hasTelephonyModule && inGrace && (
        <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4 mb-5">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-rose-600">schedule</span>
            <div className="text-sm text-rose-800">
              <span className="font-bold">Льготный период.</span> Звонки работают до{' '}
              {new Date(inGrace).toLocaleString('ru-RU')}. После этой даты модуль отключится.
            </div>
          </div>
        </div>
      )}

      {hasTelephonyModule && (
        <>
          {/* Список правил */}
          <div className="space-y-2 mb-5">
            {rules.length === 0 && !adding && (
              <div className="text-center py-8 text-gray-400 text-sm">
                Правил-исключений нет — действует дефолт «все могут всем».
              </div>
            )}

            {rules.map(rule => (
              <div key={rule.id} className="bg-white rounded-2xl p-4 border border-gray-100 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold">
                    {ROLE_LABELS[rule.from_role] || rule.from_role}{' '}
                    <span className="text-gray-400">→</span>{' '}
                    {ROLE_LABELS[rule.to_role] || rule.to_role}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">{SCOPE_LABELS[rule.scope]}</div>
                </div>
                <button onClick={() => toggleField(rule, 'allow_audio')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 ${rule.allow_audio ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                  <span className="material-symbols-outlined" style={{ fontSize:'16px' }}>{rule.allow_audio ? 'call' : 'call_end'}</span>
                  Аудио
                </button>
                <button onClick={() => toggleField(rule, 'allow_video')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 ${rule.allow_video ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                  <span className="material-symbols-outlined" style={{ fontSize:'16px' }}>{rule.allow_video ? 'videocam' : 'videocam_off'}</span>
                  Видео
                </button>
              </div>
            ))}
          </div>

          {/* Добавить правило */}
          {!adding && (
            <button onClick={() => setAdding(true)}
              className="w-full py-3 rounded-2xl bg-violet-600 text-white font-bold flex items-center justify-center gap-2">
              <span className="material-symbols-outlined">add</span>
              Добавить правило
            </button>
          )}

          {adding && (
            <div className="bg-white rounded-2xl p-4 border border-violet-200 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Кто звонит</label>
                <select value={draft.from_role} onChange={e => setDraft({...draft, from_role:e.target.value})}
                  className="w-full p-2.5 rounded-lg border border-gray-200 text-sm">
                  {activeRoles.map(r => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Кому</label>
                <select value={draft.to_role} onChange={e => setDraft({...draft, to_role:e.target.value})}
                  className="w-full p-2.5 rounded-lg border border-gray-200 text-sm">
                  {activeRoles.map(r => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Где</label>
                <select value={draft.scope} onChange={e => setDraft({...draft, scope:e.target.value})}
                  className="w-full p-2.5 rounded-lg border border-gray-200 text-sm">
                  <option value="any">Любая клиника</option>
                  <option value="same_clinic">В одной клинике</option>
                  <option value="cross_clinic">Между клиниками</option>
                </select>
              </div>
              <div className="flex gap-2">
                <label className="flex-1 flex items-center gap-2 p-2.5 rounded-lg border border-gray-200">
                  <input type="checkbox" checked={draft.allow_audio} onChange={e => setDraft({...draft, allow_audio:e.target.checked})} />
                  <span className="text-sm font-medium">Разрешить аудио</span>
                </label>
                <label className="flex-1 flex items-center gap-2 p-2.5 rounded-lg border border-gray-200">
                  <input type="checkbox" checked={draft.allow_video} onChange={e => setDraft({...draft, allow_video:e.target.checked})} />
                  <span className="text-sm font-medium">Разрешить видео</span>
                </label>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setAdding(false)}
                  className="flex-1 py-2.5 rounded-lg bg-gray-100 text-gray-700 font-semibold text-sm">
                  Отменить
                </button>
                <button onClick={onAdd}
                  className="flex-1 py-2.5 rounded-lg bg-violet-600 text-white font-semibold text-sm">
                  Сохранить
                </button>
              </div>
            </div>
          )}

          {rules.length > 0 && (
            <button onClick={resetAll}
              className="mt-4 w-full py-2.5 rounded-xl text-sm font-semibold text-rose-600 hover:bg-rose-50">
              Сбросить все правила
            </button>
          )}
        </>
      )}
    </div>
  )
}
