/**
 * ========================================
 * БЛОК: AdminAggregatorSection — заявки от партнёров-агрегаторов (Глава 10)
 * ========================================
 * Используется в _ManagerShell → ManagerAggregator page для роли manager,
 * а также внутри FranchiseOwnerCabinet (route='aggregator_leads').
 *
 * API:
 *   GET   /admin/aggregator/leads?status=&partner=
 *   PATCH /admin/aggregator/leads/{id}/status body {status, appointment_id?, commission_amount?}
 *   GET   /admin/aggregator/stats?period=30d
 *
 * Tabs:
 *   1. Заявки — список лидов с фильтрами + поиск + workflow-кнопки
 *   2. Статистика — KPI cards + breakdown по партнёрам
 *
 * Workflow статусов: received → contacted → scheduled → completed | lost
 * ========================================
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '../api'
import { useToast } from '../design'
import LeadCard from '../components/aggregator/LeadCard'

const STATUS_OPTIONS = [
  { value: '',          label: 'Все статусы'           },
  { value: 'received',  label: 'Получены'              },
  { value: 'contacted', label: 'В контакте'            },
  { value: 'scheduled', label: 'Записаны'              },
  { value: 'completed', label: 'Завершены'             },
  { value: 'lost',      label: 'Потеряны'              },
]

function moduleOffBlock() {
  return (
    <div className="rounded-2xl p-6 text-center" style={{ background: '#fef3c7', border: '1px solid #fde68a' }}>
      <span className="material-symbols-outlined text-3xl mb-2 block" style={{ color: '#92400e' }}>lock</span>
      <p className="text-sm font-semibold" style={{ color: '#92400e' }}>Модуль агрегаторов не подключён.</p>
      <p className="text-xs mt-1" style={{ color: '#92400e' }}>
        Подключите модуль <code>aggregator_integration</code> в «Маркетплейс модулей».
      </p>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// TAB 1: Заявки
// ────────────────────────────────────────────────────────────────────────────
function LeadsTab() {
  const { toast } = useToast()
  const [leads, setLeads]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)

  const [filterStatus, setFilterStatus]   = useState('')
  const [filterPartner, setFilterPartner] = useState('')
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = {}
      if (filterStatus)  params.status  = filterStatus
      if (filterPartner) params.partner = filterPartner
      const r = await api.get('/admin/aggregator/leads', { params })
      setLeads(Array.isArray(r.data) ? r.data : (r.data?.items || []))
    } catch (e) {
      if (e?.response?.status === 402) setError('module_off')
      else setError('load')
    } finally {
      setLoading(false)
    }
  }, [filterStatus, filterPartner])

  useEffect(() => { load() }, [load])

  // Уникальные партнёры из загруженных лидов — для фильтра
  const partners = useMemo(() => {
    const s = new Set(leads.map(l => l.partner_name).filter(Boolean))
    return Array.from(s).sort()
  }, [leads])

  // Локальная фильтрация по поиску (телефон/ФИО)
  const filteredLeads = useMemo(() => {
    if (!search.trim()) return leads
    const q = search.trim().toLowerCase()
    return leads.filter(l => (
      (l.patient_phone || '').toLowerCase().includes(q) ||
      (l.patient_full_name || '').toLowerCase().includes(q) ||
      (l.service_requested || '').toLowerCase().includes(q)
    ))
  }, [leads, search])

  const handleAction = async ({ id, status, appointment_id, commission_amount }) => {
    setBusyId(id)
    try {
      const payload = { status }
      if (appointment_id) payload.appointment_id = appointment_id
      if (commission_amount !== undefined) payload.commission_amount = commission_amount
      await api.patch(`/admin/aggregator/leads/${id}/status`, payload)
      toast({ kind: 'success', text: 'Статус обновлён' })
      load()
    } catch (e) {
      toast({ kind: 'error', text: e?.response?.data?.detail || 'Не удалось обновить статус' })
    } finally {
      setBusyId(null)
    }
  }

  if (error === 'module_off') return moduleOffBlock()

  return (
    <div className="space-y-3">
      {/* Filters bar */}
      <div
        className="rounded-2xl p-3 flex flex-wrap items-center gap-2"
        style={{ background: 'var(--bg-1, #f8fafc)', border: '1px solid var(--border, #e5e7eb)' }}
      >
        <div className="flex-1 min-w-[200px] flex items-center gap-2 rounded-xl px-3" style={{ background: '#fff', border: '1px solid #e2e8f0', height: 38 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#94a3b8' }}>search</span>
          <input
            type="text"
            placeholder="Поиск: телефон, ФИО, услуга…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 bg-transparent outline-none text-sm"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-gray-400 hover:text-gray-700">
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
            </button>
          )}
        </div>

        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="rounded-xl"
          style={{ padding: '8px 12px', border: '1px solid #e2e8f0', background: '#fff', fontSize: 13, outline: 'none', height: 38 }}
        >
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <select
          value={filterPartner}
          onChange={e => setFilterPartner(e.target.value)}
          className="rounded-xl"
          style={{ padding: '8px 12px', border: '1px solid #e2e8f0', background: '#fff', fontSize: 13, outline: 'none', height: 38 }}
        >
          <option value="">Все партнёры</option>
          {partners.map(p => <option key={p} value={p}>{p}</option>)}
        </select>

        <button
          onClick={load}
          title="Обновить"
          className="grid place-items-center rounded-xl"
          style={{ width: 38, height: 38, border: '1px solid #e2e8f0', background: '#fff', color: '#475569' }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>refresh</span>
        </button>
      </div>

      {/* Stats line */}
      <div className="text-xs" style={{ color: '#64748b' }}>
        Найдено: <b style={{ color: '#0f172a' }}>{filteredLeads.length}</b> из {leads.length}
      </div>

      {/* List */}
      {loading && (
        <div className="space-y-2">
          {[0,1,2].map(i => <div key={i} className="h-32 rounded-2xl animate-pulse" style={{ background: '#e5e7eb' }} />)}
        </div>
      )}

      {!loading && filteredLeads.length === 0 && (
        <div className="rounded-2xl p-10 text-center" style={{ background: '#f9fafb', border: '1px dashed #e5e7eb' }}>
          <span className="material-symbols-outlined text-4xl mb-2 block" style={{ color: '#9ca3af' }}>campaign</span>
          <p className="text-sm font-semibold text-gray-700">
            {leads.length === 0 ? 'Заявок от агрегаторов пока нет' : 'По вашим фильтрам ничего не найдено'}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {leads.length === 0
              ? 'Партнёры передают лидов через API — они появятся здесь автоматически'
              : 'Попробуйте сбросить фильтры или поисковую строку'}
          </p>
        </div>
      )}

      {!loading && filteredLeads.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {filteredLeads.map(l => (
            <LeadCard
              key={l.id}
              lead={l}
              onAction={handleAction}
              busy={busyId === l.id}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// TAB 2: Статистика
// ────────────────────────────────────────────────────────────────────────────
function StatsTab() {
  const [stats, setStats] = useState(null)
  const [period, setPeriod] = useState('30d')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await api.get('/admin/aggregator/stats', { params: { period } })
      setStats(r.data || null)
    } catch (e) {
      if (e?.response?.status === 402) setError('module_off')
      else setError('load')
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => { load() }, [load])

  if (error === 'module_off') return moduleOffBlock()

  const byStatus  = stats?.leads_by_status  || {}
  const byPartner = Array.isArray(stats?.leads_by_partner) ? stats.leads_by_partner : []

  return (
    <div className="space-y-4">
      {/* Period selector */}
      <div className="flex items-center justify-end gap-2">
        <span className="text-xs" style={{ color: '#64748b' }}>Период:</span>
        {[
          { v: '7d',  l: '7 дней'  },
          { v: '30d', l: '30 дней' },
          { v: '90d', l: '90 дней' },
        ].map(p => (
          <button
            key={p.v}
            onClick={() => setPeriod(p.v)}
            className="rounded-lg text-xs font-bold transition-all"
            style={{
              padding: '5px 10px',
              background: period === p.v ? 'var(--accent-soft, #cffafe)' : 'transparent',
              color: period === p.v ? 'var(--accent, #0097A7)' : '#64748b',
              border: '1px solid ' + (period === p.v ? 'var(--accent, #0097A7)' : '#e2e8f0'),
            }}
          >{p.l}</button>
        ))}
      </div>

      {loading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[0,1,2,3].map(i => <div key={i} className="h-24 rounded-2xl animate-pulse" style={{ background: '#e5e7eb' }} />)}
        </div>
      )}

      {!loading && stats && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard
              icon="campaign"
              label="Всего лидов"
              value={stats.leads_count ?? 0}
            />
            <KpiCard
              icon="trending_up"
              label="Конверсия"
              value={stats.conversion_pct != null ? `${Number(stats.conversion_pct).toFixed(1)}%` : '—'}
              accent="#7c3aed"
            />
            <KpiCard
              icon="payments"
              label="Сумма комиссии"
              value={stats.total_commission != null
                ? `${Number(stats.total_commission).toLocaleString('ru')} ₽`
                : '—'}
              accent="#15803d"
            />
            <KpiCard
              icon="task_alt"
              label="Завершено"
              value={byStatus.completed ?? 0}
              accent="#0097A7"
            />
          </div>

          {/* Status breakdown */}
          <div
            className="rounded-2xl p-4"
            style={{ background: '#fff', border: '1px solid #e5e7eb' }}
          >
            <div
              className="font-bold uppercase mb-3"
              style={{ fontSize: 10.5, color: '#94a3b8', letterSpacing: '0.08em' }}
            >Распределение по статусам</div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(byStatus).map(([status, count]) => (
                <span
                  key={status}
                  style={{
                    padding: '5px 11px', borderRadius: 999,
                    background: '#f1f5f9', color: '#0f172a',
                    fontSize: 12, fontWeight: 600,
                  }}
                >
                  {status}: <b>{count}</b>
                </span>
              ))}
              {Object.keys(byStatus).length === 0 && (
                <span className="text-xs" style={{ color: '#94a3b8' }}>Нет данных</span>
              )}
            </div>
          </div>

          {/* По партнёрам */}
          <div
            className="rounded-2xl overflow-hidden"
            style={{ background: '#fff', border: '1px solid #e5e7eb' }}
          >
            <div
              className="font-bold uppercase px-4 pt-4 pb-2"
              style={{ fontSize: 10.5, color: '#94a3b8', letterSpacing: '0.08em' }}
            >Партнёры (топ-источники)</div>

            {byPartner.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs" style={{ color: '#94a3b8' }}>
                Пока нет лидов от партнёров за этот период
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead style={{ background: '#f9fafb', borderTop: '1px solid #f1f5f9', borderBottom: '1px solid #e5e7eb' }}>
                    <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                      <th className="px-4 py-2 font-semibold">Партнёр</th>
                      <th className="px-4 py-2 font-semibold text-right">Лидов</th>
                      <th className="px-4 py-2 font-semibold text-right">Завершено</th>
                      <th className="px-4 py-2 font-semibold text-right">Комиссия</th>
                      <th className="px-4 py-2 font-semibold text-right">Конверсия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byPartner.map((p, i) => (
                      <tr key={p.partner_name || i} style={{ borderTop: i === 0 ? 'none' : '1px solid #f1f5f9' }}>
                        <td className="px-4 py-3 font-semibold" style={{ color: '#0f172a' }}>
                          {p.partner_name}
                        </td>
                        <td className="px-4 py-3 text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>{p.leads_count ?? 0}</td>
                        <td className="px-4 py-3 text-right" style={{ fontVariantNumeric: 'tabular-nums', color: '#15803d', fontWeight: 600 }}>
                          {p.completed ?? 0}
                        </td>
                        <td className="px-4 py-3 text-right" style={{ fontVariantNumeric: 'tabular-nums', color: '#0f172a', fontWeight: 600 }}>
                          {p.commission != null
                            ? `${Number(p.commission).toLocaleString('ru')} ₽`
                            : '—'}
                        </td>
                        <td className="px-4 py-3 text-right" style={{ fontVariantNumeric: 'tabular-nums', color: '#7c3aed', fontWeight: 600 }}>
                          {p.conversion_pct != null ? `${Number(p.conversion_pct).toFixed(1)}%` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function KpiCard({ icon, label, value, accent = '#0097A7' }) {
  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: '#fff', border: '1px solid #e5e7eb' }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className="inline-grid place-items-center"
          style={{ width: 28, height: 28, borderRadius: 8, background: `${accent}1A`, color: accent }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16, fontVariationSettings: "'FILL' 1" }}>{icon}</span>
        </span>
        <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>{label}</span>
      </div>
      <div
        className="font-bold"
        style={{
          fontSize: 22, color: '#0f172a',
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: '-0.02em',
        }}
      >{value}</div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// MAIN
// ────────────────────────────────────────────────────────────────────────────
export default function AdminAggregatorSection() {
  const [tab, setTab] = useState('leads')

  return (
    <div className="space-y-3">
      {/* Tabs */}
      <div
        className="rounded-2xl p-1 inline-flex"
        style={{ background: 'var(--bg-2, #f1f5f9)' }}
      >
        {[
          { v: 'leads', l: 'Заявки',     i: 'campaign'  },
          { v: 'stats', l: 'Статистика', i: 'analytics' },
        ].map(t => {
          const active = tab === t.v
          return (
            <button
              key={t.v}
              onClick={() => setTab(t.v)}
              className="inline-flex items-center gap-1.5 rounded-xl text-sm font-bold transition-all"
              style={{
                padding: '7px 14px',
                background: active ? '#fff' : 'transparent',
                color: active ? '#0097A7' : '#64748b',
                boxShadow: active ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{t.i}</span>
              {t.l}
            </button>
          )
        })}
      </div>

      {tab === 'leads' && <LeadsTab />}
      {tab === 'stats' && <StatsTab />}
    </div>
  )
}
