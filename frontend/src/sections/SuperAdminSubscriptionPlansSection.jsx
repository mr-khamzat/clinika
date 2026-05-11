/**
 * SuperAdminSubscriptionPlansSection — CRUD-управление каталогом тарифов
 * подписки «Здоровье+» (для super_admin).
 *
 * Endpoints:
 *   GET    /admin/subscription-plans/global
 *   POST   /admin/subscription-plans/global          — create или upsert
 *   PATCH  /admin/subscription-plans/global/{id}
 *   DELETE /admin/subscription-plans/global/{id}     — 409 если есть подписчики
 *   GET    /admin/subscription-plans/overrides       — все override-ы
 *   DELETE /admin/subscription-plans/override/{id}   — удалить override
 *
 * UI: tabs «Глобальные шаблоны» / «Override-ы по тенантам».
 */
import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import api from '../api'
import { useToast, useConfirm } from '../design'

const PlanEditorModal = lazy(() => import('../components/subscription/PlanEditorModal'))

function fmtPrice(v) {
  if (v === null || v === undefined) return '—'
  try { return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(v) } catch { return v }
}

function Skel() {
  return (
    <div style={{ padding: 16 }}>
      {[1, 2, 3].map(i => (
        <div key={i} style={{
          height: 60, marginBottom: 8, borderRadius: 10,
          background: 'linear-gradient(90deg, var(--bg-2, #f1f5f9) 0%, var(--bg-3, #e2e8f0) 50%, var(--bg-2, #f1f5f9) 100%)',
          backgroundSize: '200% 100%', animation: 'shimmer 1.5s linear infinite',
        }} />
      ))}
      <style>{`@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
    </div>
  )
}

export default function SuperAdminSubscriptionPlansSection({ token }) {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const [tab, setTab] = useState('global')
  const [loading, setLoading] = useState(true)
  const [plans, setPlans] = useState([])
  const [overrides, setOverrides] = useState([])
  const [editing, setEditing] = useState(null)        // {plan, isNew}
  const [tenants, setTenants] = useState([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.get('/admin/subscription-plans/global')
      setPlans(r.data?.plans || [])
      const o = await api.get('/admin/subscription-plans/overrides')
      setOverrides(o.data?.overrides || [])
    } catch (e) {
      toast({ type: 'error', text: 'Не удалось загрузить тарифы: ' + (e?.response?.data?.detail || e.message) })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  // Загружаем список тенантов для отображения имён в Override-табе
  useEffect(() => {
    api.get('/admin/tenants').then(r => {
      setTenants(Array.isArray(r.data) ? r.data : (r.data?.tenants || []))
    }).catch(() => {})
  }, [])

  const tenantName = (id) => {
    const t = tenants.find(x => x.id === id)
    return t?.name || t?.slug || id?.slice(0, 8)
  }

  const onCreate = () => setEditing({ plan: null, isNew: true })
  const onEdit = (p) => setEditing({ plan: p, isNew: false })

  const onDelete = async (p) => {
    const ok = await confirm({
      title: 'Удалить тариф?',
      message: `«${p.title}» (${p.plan_key}). Действие необратимо.`,
      confirmText: 'Удалить', danger: true,
    })
    if (!ok) return
    try {
      await api.delete(`/admin/subscription-plans/global/${p.id}`)
      toast({ type: 'success', text: 'Тариф удалён' })
      load()
    } catch (e) {
      toast({ type: 'error', text: e?.response?.data?.detail || 'Ошибка удаления' })
    }
  }

  const onDeleteOverride = async (o) => {
    const ok = await confirm({
      title: 'Сбросить override?',
      message: `Тенант вернётся к глобальным настройкам плана «${o.plan_key}».`,
      confirmText: 'Сбросить',
    })
    if (!ok) return
    try {
      await api.delete(`/admin/subscription-plans/override/${o.id}`)
      toast({ type: 'success', text: 'Override удалён' })
      load()
    } catch (e) {
      toast({ type: 'error', text: e?.response?.data?.detail || 'Ошибка удаления' })
    }
  }

  return (
    <div style={{ padding: 16 }}>
      {/* Hero */}
      <div style={{
        padding: 20,
        borderRadius: 16,
        background: 'linear-gradient(135deg, #f59e0b 0%, #ec4899 50%, #8b5cf6 100%)',
        color: '#fff',
        marginBottom: 16,
        boxShadow: '0 12px 32px rgba(245,158,11,.25)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, opacity: 0.9, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
              Платформа · Подписки
            </div>
            <h2 style={{ margin: '4px 0 0', fontSize: 24, fontWeight: 800 }}>
              Тарифы подписки «Здоровье+»
            </h2>
            <div style={{ fontSize: 13, opacity: 0.9, marginTop: 4 }}>
              Глобальные шаблоны видят все тенанты по умолчанию. Каждая франшиза может создать override.
            </div>
          </div>
          <button
            type="button" onClick={onCreate}
            style={{
              padding: '10px 18px', border: 0, borderRadius: 10,
              background: 'rgba(255,255,255,.2)', backdropFilter: 'blur(8px)',
              color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 14,
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <span className="material-symbols-outlined">add</span>
            Новый план
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--line)' }}>
        {[
          { k: 'global', label: 'Глобальные шаблоны', cnt: plans.length },
          { k: 'overrides', label: 'Override-ы по тенантам', cnt: overrides.length },
        ].map(t => (
          <button
            key={t.k} type="button" onClick={() => setTab(t.k)}
            style={{
              padding: '10px 16px', border: 0, background: 'transparent',
              cursor: 'pointer', fontWeight: 600, fontSize: 14,
              color: tab === t.k ? 'var(--brand, #0097A7)' : 'var(--fg-2)',
              borderBottom: tab === t.k ? '2px solid var(--brand, #0097A7)' : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {t.label} · <span style={{ opacity: 0.6 }}>{t.cnt}</span>
          </button>
        ))}
      </div>

      {loading ? <Skel /> : (
        tab === 'global' ? (
          <GlobalPlansTable plans={plans} onEdit={onEdit} onDelete={onDelete} />
        ) : (
          <OverridesTable overrides={overrides} tenantName={tenantName} onDelete={onDeleteOverride} />
        )
      )}

      {/* Editor modal */}
      {editing && (
        <Suspense fallback={null}>
          <PlanEditorModal
            plan={editing.plan}
            mode="global"
            lockPlanKey={!editing.isNew}
            onClose={() => setEditing(null)}
            onSaved={() => { toast({ type: 'success', text: 'Сохранено' }); load() }}
          />
        </Suspense>
      )}
    </div>
  )
}


function GlobalPlansTable({ plans, onEdit, onDelete }) {
  if (!plans.length) {
    return (
      <div style={{
        padding: 32, textAlign: 'center', color: 'var(--fg-2)',
        background: 'var(--bg-2, rgba(0,0,0,.02))', borderRadius: 12,
      }}>
        <div style={{ fontSize: 48, opacity: 0.3 }}>📋</div>
        <div style={{ marginTop: 8, fontSize: 14 }}>
          Глобальных тарифов нет. Создайте первый через «+ Новый план».
        </div>
      </div>
    )
  }

  return (
    <div style={{
      background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 12,
      overflow: 'hidden',
    }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: 'var(--bg-2, rgba(0,0,0,.03))' }}>
              {['Ключ', 'Название', '₽/мес', '₽/год', 'Trial', 'Активен', 'Подписчиков', 'Действия'].map(h => (
                <th key={h} style={{ padding: '12px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--fg-2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {plans.map(p => (
              <tr key={p.id} style={{ borderTop: '1px solid var(--line)' }}>
                <td style={{ padding: '10px 14px', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{p.plan_key}</td>
                <td style={{ padding: '10px 14px', fontWeight: 700 }}>
                  {p.title}
                  {p.description && (
                    <div style={{ fontSize: 12, fontWeight: 400, color: 'var(--fg-2)', marginTop: 2 }}>
                      {p.description.slice(0, 80)}{p.description.length > 80 ? '...' : ''}
                    </div>
                  )}
                </td>
                <td style={{ padding: '10px 14px', fontFeatureSettings: '"tnum"' }}>₽{fmtPrice(p.price_monthly)}</td>
                <td style={{ padding: '10px 14px', fontFeatureSettings: '"tnum"', color: 'var(--fg-2)' }}>
                  {p.price_annual ? `₽${fmtPrice(p.price_annual)}` : '—'}
                </td>
                <td style={{ padding: '10px 14px' }}>{p.trial_days} дн.</td>
                <td style={{ padding: '10px 14px' }}>
                  <span style={{
                    padding: '3px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700,
                    background: p.is_active ? 'rgba(16,185,129,.12)' : 'rgba(107,114,128,.12)',
                    color: p.is_active ? '#059669' : '#374151',
                  }}>
                    {p.is_active ? 'Да' : 'Скрыт'}
                  </span>
                </td>
                <td style={{ padding: '10px 14px', fontFeatureSettings: '"tnum"', fontWeight: 700 }}>
                  {p.subscribers_count || 0}
                </td>
                <td style={{ padding: '10px 14px' }}>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      type="button" onClick={() => onEdit(p)}
                      title="Редактировать"
                      style={{ border: 0, background: 'rgba(2,132,199,.12)', color: '#0369a1', borderRadius: 6, padding: 6, cursor: 'pointer' }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>edit</span>
                    </button>
                    <button
                      type="button" onClick={() => onDelete(p)}
                      title="Удалить"
                      style={{ border: 0, background: 'rgba(239,68,68,.12)', color: '#dc2626', borderRadius: 6, padding: 6, cursor: 'pointer' }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>delete</span>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}


function OverridesTable({ overrides, tenantName, onDelete }) {
  if (!overrides.length) {
    return (
      <div style={{
        padding: 32, textAlign: 'center', color: 'var(--fg-2)',
        background: 'var(--bg-2, rgba(0,0,0,.02))', borderRadius: 12,
      }}>
        <div style={{ fontSize: 48, opacity: 0.3 }}>🎯</div>
        <div style={{ marginTop: 8, fontSize: 14 }}>
          Override-ов нет. Каждая франшиза может создать свои настройки тарифов в кабинете владельца.
        </div>
      </div>
    )
  }
  return (
    <div style={{
      background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 12,
      overflow: 'hidden',
    }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: 'var(--bg-2, rgba(0,0,0,.03))' }}>
              {['Тенант', 'Ключ', 'Название', '₽/мес', 'Trial', 'Активен', 'Действие'].map(h => (
                <th key={h} style={{ padding: '12px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--fg-2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {overrides.map(o => (
              <tr key={o.id} style={{ borderTop: '1px solid var(--line)' }}>
                <td style={{ padding: '10px 14px', fontWeight: 700 }}>{tenantName(o.tenant_id)}</td>
                <td style={{ padding: '10px 14px', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{o.plan_key}</td>
                <td style={{ padding: '10px 14px' }}>{o.title}</td>
                <td style={{ padding: '10px 14px', fontFeatureSettings: '"tnum"' }}>₽{fmtPrice(o.price_monthly)}</td>
                <td style={{ padding: '10px 14px' }}>{o.trial_days} дн.</td>
                <td style={{ padding: '10px 14px' }}>{o.is_active ? 'Да' : 'Нет'}</td>
                <td style={{ padding: '10px 14px' }}>
                  <button
                    type="button" onClick={() => onDelete(o)}
                    title="Сбросить override"
                    style={{
                      border: 0, background: 'rgba(239,68,68,.12)', color: '#dc2626',
                      borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                    }}
                  >
                    Сбросить
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
