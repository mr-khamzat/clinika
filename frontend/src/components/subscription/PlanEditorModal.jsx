/**
 * PlanEditorModal — модалка редактирования / создания тарифа подписки.
 *
 * Props:
 *   plan: object | null     — существующий план (для редактирования). null = создание
 *   mode: 'global' | 'override'  — какой scope сохраняем
 *   tenantId: uuid | null   — обязателен для mode='override'
 *   lockPlanKey: bool       — read-only plan_key (true при редактировании)
 *   hideActive: bool        — скрыть toggle is_active (true для franchise_owner)
 *   onClose: () => void
 *   onSaved: (plan) => void
 */
import { useState, useEffect, lazy, Suspense } from 'react'
import api from '../../api'

const FeaturesToggleList    = lazy(() => import('./FeaturesToggleList'))
const BenefitsBulletEditor  = lazy(() => import('./BenefitsBulletEditor'))

const DEFAULT_FEATURES = {
  unlimited_chat: false,
  discount_percent: 0,
  family_members_allowed: 1,
  telemedicine_unlimited: false,
  priority_booking: false,
  monthly_supply: false,
}

function blankForm() {
  return {
    plan_key: '',
    title: '',
    description: '',
    price_monthly: '',
    price_annual: '',
    trial_days: 7,
    benefits: [],
    features: { ...DEFAULT_FEATURES },
    is_active: true,
    sort_order: 0,
  }
}

function fromPlan(p) {
  return {
    plan_key: p?.plan_key || '',
    title: p?.title || '',
    description: p?.description || '',
    price_monthly: p?.price_monthly ?? '',
    price_annual: p?.price_annual ?? '',
    trial_days: p?.trial_days ?? 7,
    benefits: Array.isArray(p?.benefits) ? p.benefits : [],
    features: { ...DEFAULT_FEATURES, ...(p?.features || {}) },
    is_active: p?.is_active !== false,
    sort_order: p?.sort_order ?? 0,
  }
}

export default function PlanEditorModal({
  plan, mode = 'global', tenantId = null,
  lockPlanKey = false, hideActive = false,
  onClose, onSaved,
}) {
  const [form, setForm] = useState(() => plan ? fromPlan(plan) : blankForm())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    setForm(plan ? fromPlan(plan) : blankForm())
  }, [plan])

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }))

  const save = async () => {
    setError(null)
    if (!form.title?.trim()) { setError('Название обязательно'); return }
    if (form.price_monthly === '' || isNaN(Number(form.price_monthly))) {
      setError('Цена в месяц обязательна'); return
    }
    if (mode === 'global' && !lockPlanKey && !/^[a-z][a-z0-9_]+$/.test(form.plan_key)) {
      setError('plan_key: латиница, цифры, _ (начинается с буквы)'); return
    }
    setSaving(true)
    try {
      const payload = {
        plan_key: lockPlanKey ? plan.plan_key : form.plan_key,
        title: form.title.trim(),
        description: form.description?.trim() || null,
        price_monthly: Number(form.price_monthly),
        price_annual: form.price_annual === '' ? null : Number(form.price_annual),
        trial_days: Number(form.trial_days) || 0,
        benefits: form.benefits,
        features: form.features,
        is_active: !!form.is_active,
        sort_order: Number(form.sort_order) || 0,
      }
      let resp
      if (mode === 'override') {
        if (!tenantId) throw new Error('tenant_id required for override')
        payload.tenant_id = tenantId
        if (plan?.has_override && plan?.id) {
          // PATCH существующего override
          resp = await api.patch(`/admin/subscription-plans/override/${plan.id}`, payload)
        } else {
          resp = await api.post('/admin/subscription-plans/override', payload)
        }
      } else {
        // global
        if (plan?.id && lockPlanKey) {
          resp = await api.patch(`/admin/subscription-plans/global/${plan.id}`, payload)
        } else {
          resp = await api.post('/admin/subscription-plans/global', payload)
        }
      }
      onSaved && onSaved(resp.data)
      onClose && onClose()
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
        zIndex: 9999, display: 'flex', alignItems: 'flex-start',
        justifyContent: 'center', padding: '24px 12px', overflow: 'auto',
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 720, background: 'var(--bg, #fff)',
          borderRadius: 16, boxShadow: '0 20px 60px rgba(0,0,0,.3)',
          color: 'var(--fg)',
        }}
      >
        {/* Header — золотистый градиент */}
        <div style={{
          padding: '20px 24px', borderRadius: '16px 16px 0 0',
          background: 'linear-gradient(135deg, #f59e0b 0%, #ec4899 100%)',
          color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 12, opacity: 0.9, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {mode === 'override' ? 'Override для тенанта' : 'Глобальный шаблон'}
            </div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>
              {plan ? `Редактирование: ${plan.title || plan.plan_key}` : 'Новый тариф подписки'}
            </h2>
          </div>
          <button
            type="button" onClick={onClose}
            style={{ border: 0, background: 'rgba(255,255,255,.2)', color: '#fff', borderRadius: 8, padding: 6, cursor: 'pointer' }}
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {error && (
            <div style={{ padding: 10, background: 'rgba(239,68,68,.1)', color: '#dc2626', borderRadius: 8, fontSize: 13 }}>
              {error}
            </div>
          )}

          {/* plan_key */}
          {mode === 'global' && (
            <Field label="Ключ плана (plan_key)" hint="латиница, цифры, _ — нельзя изменить после создания">
              <input
                type="text"
                value={form.plan_key}
                onChange={e => set('plan_key', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                disabled={lockPlanKey}
                placeholder="custom_premium"
                style={inputStyle(lockPlanKey)}
              />
            </Field>
          )}

          {/* title */}
          <Field label="Название (видит пациент)">
            <input
              type="text" value={form.title}
              onChange={e => set('title', e.target.value)}
              placeholder="Здоровье+"
              style={inputStyle(false)}
            />
          </Field>

          {/* description */}
          <Field label="Описание">
            <textarea
              value={form.description || ''}
              onChange={e => set('description', e.target.value)}
              placeholder="Что входит в этот тариф (текст под названием на карточке)"
              rows={2}
              style={{ ...inputStyle(false), resize: 'vertical', fontFamily: 'inherit' }}
            />
          </Field>

          {/* Цены */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="Цена ₽/мес">
              <input
                type="number" min={0} step={10}
                value={form.price_monthly}
                onChange={e => set('price_monthly', e.target.value)}
                style={inputStyle(false)}
              />
            </Field>
            <Field label="Цена ₽/год" hint="опц., null = ×10">
              <input
                type="number" min={0} step={100}
                value={form.price_annual}
                onChange={e => set('price_annual', e.target.value)}
                style={inputStyle(false)}
              />
            </Field>
            <Field label="Trial, дней">
              <input
                type="number" min={0} max={90}
                value={form.trial_days}
                onChange={e => set('trial_days', e.target.value)}
                style={inputStyle(false)}
              />
            </Field>
          </div>

          {/* Привилегии (features) */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg-2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              Привилегии (доступ к функциям)
            </div>
            <Suspense fallback={<div style={{ padding: 8, color: 'var(--fg-2)' }}>Загрузка...</div>}>
              <FeaturesToggleList
                value={form.features}
                onChange={v => set('features', v)}
              />
            </Suspense>
          </div>

          {/* Бенефиты (список строк) */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg-2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              Текстовые буллеты на карточке (то что видит пациент)
            </div>
            <Suspense fallback={<div style={{ padding: 8, color: 'var(--fg-2)' }}>Загрузка...</div>}>
              <BenefitsBulletEditor
                value={form.benefits}
                onChange={v => set('benefits', v)}
              />
            </Suspense>
          </div>

          {/* sort_order + is_active */}
          <div style={{ display: 'grid', gridTemplateColumns: hideActive ? '1fr' : '1fr 1fr', gap: 12 }}>
            <Field label="Порядок сортировки" hint="меньше = выше">
              <input
                type="number" value={form.sort_order}
                onChange={e => set('sort_order', e.target.value)}
                style={inputStyle(false)}
              />
            </Field>
            {!hideActive && (
              <Field label="Активен">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 8 }}>
                  <input
                    id="plan_active" type="checkbox"
                    checked={!!form.is_active}
                    onChange={e => set('is_active', e.target.checked)}
                    style={{ width: 18, height: 18 }}
                  />
                  <label htmlFor="plan_active" style={{ fontSize: 14 }}>
                    Показывать пациентам
                  </label>
                </div>
              </Field>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: 16, borderTop: '1px solid var(--line)',
          display: 'flex', justifyContent: 'flex-end', gap: 8,
        }}>
          <button
            type="button" onClick={onClose} disabled={saving}
            style={{
              padding: '10px 20px', border: '1px solid var(--line)', borderRadius: 8,
              background: 'transparent', color: 'var(--fg)', cursor: 'pointer', fontWeight: 600,
            }}
          >
            Отмена
          </button>
          <button
            type="button" onClick={save} disabled={saving}
            style={{
              padding: '10px 24px', border: 0, borderRadius: 8,
              background: 'linear-gradient(135deg, #f59e0b 0%, #ec4899 100%)',
              color: '#fff', cursor: 'pointer', fontWeight: 700,
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg-2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {label}
        </span>
        {hint && <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>{hint}</span>}
      </div>
      {children}
    </label>
  )
}

function inputStyle(disabled) {
  return {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid var(--line)',
    borderRadius: 8,
    background: disabled ? 'var(--bg-2, rgba(0,0,0,.04))' : 'var(--bg, #fff)',
    color: 'var(--fg)',
    fontSize: 14,
    outline: 'none',
  }
}
