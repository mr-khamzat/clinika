/**
 * FranchiseSubscriptionPlansSection — секция для franchise_owner.
 *
 * Показывает итоговые планы (глобальные + override) и даёт редактировать
 * через override на свой tenant_id. Сброс возвращает к настройкам платформы.
 *
 * Endpoints:
 *   GET /admin/subscription-plans/effective?tenant_id=<my>
 *   POST /admin/subscription-plans/override
 *   PATCH /admin/subscription-plans/override/{id}
 *   DELETE /admin/subscription-plans/override/{id}
 *   GET /admin/subscription-plans/kpi
 *   GET /admins/me  — чтобы получить tenant_id
 */
import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import api from '../api'
import { useToast, useConfirm } from '../design'

const PlanEditorModal     = lazy(() => import('../components/subscription/PlanEditorModal'))
const PlanComparisonCard  = lazy(() => import('../components/subscription/PlanComparisonCard'))

function fmtPrice(v) {
  if (v === null || v === undefined) return '—'
  try { return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(v) } catch { return v }
}

function Kpi({ label, value, sub }) {
  return (
    <div style={{
      flex: 1, minWidth: 140, padding: 16,
      background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 12,
    }}>
      <div style={{ fontSize: 11, color: 'var(--fg-2)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4, fontFeatureSettings: '"tnum"' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 12, color: 'var(--fg-2)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

export default function FranchiseSubscriptionPlansSection({ adminToken }) {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const [me, setMe] = useState(null)
  const [tenantId, setTenantId] = useState(null)
  const [plans, setPlans] = useState([])
  const [kpi, setKpi] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)

  useEffect(() => {
    api.get('/admins/me').then(r => {
      setMe(r.data)
      setTenantId(r.data?.tenant_id || null)
    }).catch(() => {})
  }, [])

  const load = useCallback(async () => {
    if (!tenantId) { setLoading(false); return }
    setLoading(true)
    try {
      const r = await api.get('/admin/subscription-plans/effective', { params: { tenant_id: tenantId } })
      setPlans(r.data?.plans || [])
      try {
        const k = await api.get('/admin/subscription-plans/kpi')
        setKpi(k.data)
      } catch {}
    } catch (e) {
      toast({ type: 'error', text: 'Не удалось загрузить тарифы: ' + (e?.response?.data?.detail || e.message) })
    } finally {
      setLoading(false)
    }
  }, [tenantId, toast])

  useEffect(() => { load() }, [load])

  const onEdit = (plan) => setEditing({ plan })

  const onReset = async (plan) => {
    if (!plan.has_override || !plan.id) return
    const ok = await confirm({
      title: 'Сбросить override?',
      message: `«${plan.title}» вернётся к настройкам платформы.`,
      confirmText: 'Сбросить',
    })
    if (!ok) return
    try {
      await api.delete(`/admin/subscription-plans/override/${plan.id}`)
      toast({ type: 'success', text: 'Override сброшен' })
      load()
    } catch (e) {
      toast({ type: 'error', text: e?.response?.data?.detail || 'Ошибка' })
    }
  }

  return (
    <div style={{ padding: 16 }}>
      {/* Hero */}
      <div style={{
        padding: 20, borderRadius: 16, marginBottom: 16,
        background: 'linear-gradient(135deg, #14b8a6 0%, #0891b2 50%, #6366f1 100%)',
        color: '#fff', boxShadow: '0 12px 32px rgba(20,184,166,.25)',
      }}>
        <div style={{ fontSize: 11, opacity: 0.9, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
          Франшиза · Тарифы подписки
        </div>
        <h2 style={{ margin: '4px 0 0', fontSize: 24, fontWeight: 800 }}>
          Тарифы для пациентов вашей сети
        </h2>
        <div style={{ fontSize: 13, opacity: 0.92, marginTop: 6, maxWidth: 760 }}>
          По умолчанию пациенты видят стандартные тарифы платформы. Вы можете изменить цену,
          описание и набор привилегий — это создаст <b>override</b> только для вашей сети.
          В любой момент можно вернуться к настройкам платформы кнопкой «Сбросить».
        </div>
      </div>

      {/* KPI */}
      {kpi && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <Kpi label="Активных подписок" value={kpi.active_count} />
          <Kpi label="MRR" value={`₽${fmtPrice(kpi.mrr)}`} sub="ежемесячная выручка" />
          <Kpi label="ARPU" value={`₽${fmtPrice(kpi.arpu)}`} sub="средний чек/мес" />
          <Kpi label="Отмен за 30д" value={kpi.cancelled_30d} sub={`Churn ${kpi.churn_pct_30d}%`} />
        </div>
      )}

      {!tenantId && !loading && (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-2)' }}>
          Не удалось определить тенант. Обратитесь к super_admin.
        </div>
      )}

      {loading ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-2)' }}>Загрузка...</div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 16,
        }}>
          {plans.map(p => (
            <Suspense key={p.plan_key} fallback={<div style={{ height: 380, borderRadius: 16, background: 'var(--bg-2, rgba(0,0,0,.03))' }} />}>
              <PlanComparisonCard
                plan={p}
                onEdit={() => onEdit(p)}
                onReset={p.has_override ? () => onReset(p) : null}
              />
            </Suspense>
          ))}
          {!plans.length && (
            <div style={{ gridColumn: '1 / -1', padding: 32, textAlign: 'center', color: 'var(--fg-2)' }}>
              На платформе пока нет активных тарифов. Обратитесь к super_admin.
            </div>
          )}
        </div>
      )}

      {editing && (
        <Suspense fallback={null}>
          <PlanEditorModal
            plan={editing.plan}
            mode="override"
            tenantId={tenantId}
            lockPlanKey={true}    // plan_key всегда из глобального шаблона
            hideActive={true}     // не даём франчайзи скрывать тариф полностью
            onClose={() => setEditing(null)}
            onSaved={() => { toast({ type: 'success', text: 'Сохранено' }); load() }}
          />
        </Suspense>
      )}
    </div>
  )
}
