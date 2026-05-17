/**
 * ========================================
 * БЛОК: ManagerSubscriptionDiscounts — категорные скидки тарифа подписки
 * ========================================
 * Премиум-страница для управляющего. Управляет дифференцированными %
 * скидки подписки «Здоровье+» / «Семья+» / «Pro»:
 *   • scope='all'      — скидка на ВСЕ услуги плана (fallback);
 *   • scope='category' — на категорию услуг (services.category);
 *   • scope='service'  — на конкретную услугу.
 *
 * API (миграция discountrules01):
 *   GET    /manager/subscription/discounts
 *   POST   /manager/subscription/discounts
 *   PATCH  /manager/subscription/discounts/{id}
 *   DELETE /manager/subscription/discounts/{id}
 * ========================================
 */
import { useEffect, useMemo, useState } from 'react'
import apiClient from '../api'
import ManagerShell from './_ManagerShell'

const PLAN_OPTIONS = [
  { key: 'health_plus', label: 'Здоровье+' },
  { key: 'family_plus', label: 'Семья+' },
  { key: 'pro',         label: 'Pro' },
]

const SCOPE_LABELS = {
  all:      'На все услуги плана',
  category: 'На категорию',
  service:  'На конкретную услугу',
}

export default function ManagerSubscriptionDiscounts() {
  const [planKey, setPlanKey] = useState('health_plus')
  const [rules, setRules]     = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [showModal, setShowModal] = useState(false)
  const [services, setServices]   = useState([])

  const load = async (plan = planKey) => {
    setLoading(true); setError('')
    try {
      const r = await apiClient.get('/manager/subscription/discounts', {
        params: { plan_key: plan },
      })
      setRules(r.data?.items || [])
    } catch (e) {
      setError(e?.response?.data?.detail || e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(planKey) }, [planKey])

  useEffect(() => {
    // Подгружаем список услуг для autocomplete (best-effort, не критично)
    apiClient.get('/services', { params: { limit: 500 } })
      .then(r => setServices(r.data?.items || r.data || []))
      .catch(() => setServices([]))
  }, [])

  const categories = useMemo(() => {
    const set = new Set()
    services.forEach(s => { if (s.category) set.add(s.category) })
    return [...set].sort()
  }, [services])

  const onDelete = async (id) => {
    if (!confirm('Удалить правило?')) return
    try {
      await apiClient.delete(`/manager/subscription/discounts/${id}`)
      await load()
    } catch (e) {
      alert(e?.response?.data?.detail || e.message)
    }
  }

  const onToggleActive = async (rule) => {
    try {
      await apiClient.patch(`/manager/subscription/discounts/${rule.id}`, {
        is_active: !rule.is_active,
      })
      await load()
    } catch (e) {
      alert(e?.response?.data?.detail || e.message)
    }
  }

  return (
    <ManagerShell
      active="subscription_discounts"
      title="Скидки тарифов"
      subtitle="Дифференцированные % скидки для подписки «Здоровье+» по категориям и услугам"
      icon="percent"
    >
      <div className="space-y-4">
        {/* Селектор плана */}
        <div className="flex flex-wrap items-center gap-2">
          {PLAN_OPTIONS.map(p => (
            <button
              key={p.key}
              onClick={() => setPlanKey(p.key)}
              className="px-3 py-2 rounded-xl text-sm font-medium"
              style={{
                background: planKey === p.key ? '#047857' : '#f3f4f6',
                color:      planKey === p.key ? '#fff'    : '#374151',
                border:     '1px solid #e5e7eb',
              }}
            >
              {p.label}
            </button>
          ))}
          <div className="flex-1" />
          <button
            onClick={() => setShowModal(true)}
            className="px-4 py-2 rounded-xl text-sm font-medium"
            style={{ background: '#047857', color: '#fff' }}
          >
            + Добавить правило
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-xl text-sm" style={{ background: '#fee2e2', color: '#b91c1c' }}>
            {error}
          </div>
        )}

        {/* Таблица правил */}
        <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid #e5e7eb', background: '#fff' }}>
          <table className="w-full text-sm">
            <thead style={{ background: '#f9fafb' }}>
              <tr>
                <th className="text-left p-3">Тип</th>
                <th className="text-left p-3">Объект</th>
                <th className="text-right p-3">% скидки</th>
                <th className="text-center p-3">Активно</th>
                <th className="text-center p-3" />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={5} className="p-4 text-center text-gray-500">Загрузка…</td></tr>
              )}
              {!loading && rules.length === 0 && (
                <tr><td colSpan={5} className="p-4 text-center text-gray-500">
                  Правил для этого плана пока нет — используется общая скидка из benefits плана.
                </td></tr>
              )}
              {!loading && rules.map(r => (
                <tr key={r.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                  <td className="p-3">{SCOPE_LABELS[r.scope] || r.scope}</td>
                  <td className="p-3 text-gray-700">
                    {r.scope === 'service'  && (services.find(s => s.id === r.service_id)?.name || r.service_id)}
                    {r.scope === 'category' && (r.category_name || r.category_id)}
                    {r.scope === 'all'      && '—'}
                    {r.tenant_id ? '' : <span className="ml-1 text-xs text-amber-600">(глобальное)</span>}
                  </td>
                  <td className="p-3 text-right font-medium">{Number(r.discount_percent).toFixed(2)}%</td>
                  <td className="p-3 text-center">
                    <input
                      type="checkbox"
                      checked={!!r.is_active}
                      onChange={() => onToggleActive(r)}
                      disabled={!r.tenant_id}
                    />
                  </td>
                  <td className="p-3 text-center">
                    {r.tenant_id && (
                      <button
                        onClick={() => onDelete(r.id)}
                        className="text-xs px-2 py-1 rounded"
                        style={{ background: '#fee2e2', color: '#b91c1c' }}
                      >
                        Удалить
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {showModal && (
          <AddRuleModal
            planKey={planKey}
            categories={categories}
            services={services}
            onClose={() => setShowModal(false)}
            onCreated={async () => { setShowModal(false); await load() }}
          />
        )}
      </div>
    </ManagerShell>
  )
}


function AddRuleModal({ planKey, categories, services, onClose, onCreated }) {
  const [scope, setScope] = useState('all')
  const [categoryName, setCategoryName] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [discountPercent, setDiscountPercent] = useState(10)
  const [serviceQuery, setServiceQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const filteredServices = useMemo(() => {
    const q = serviceQuery.trim().toLowerCase()
    if (!q) return services.slice(0, 30)
    return services.filter(s =>
      (s.name || '').toLowerCase().includes(q) ||
      (s.category || '').toLowerCase().includes(q)
    ).slice(0, 30)
  }, [services, serviceQuery])

  const submit = async () => {
    setBusy(true); setErr('')
    try {
      const payload = {
        plan_key: planKey,
        scope,
        discount_percent: Number(discountPercent),
        is_active: true,
      }
      if (scope === 'category') payload.category_name = categoryName
      if (scope === 'service')  payload.service_id    = serviceId
      await apiClient.post('/manager/subscription/discounts', payload)
      await onCreated()
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl bg-white p-6 max-w-lg w-full"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold mb-4">Новое правило для «{planKey}»</h3>

        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-700 mb-1">Тип правила</label>
            <select
              value={scope}
              onChange={e => setScope(e.target.value)}
              className="w-full border rounded-xl px-3 py-2"
            >
              <option value="all">На все услуги плана</option>
              <option value="category">На категорию</option>
              <option value="service">На конкретную услугу</option>
            </select>
          </div>

          {scope === 'category' && (
            <div>
              <label className="block text-sm text-gray-700 mb-1">Категория</label>
              <input
                list="cat-options"
                value={categoryName}
                onChange={e => setCategoryName(e.target.value)}
                className="w-full border rounded-xl px-3 py-2"
                placeholder="lab, usi, consultation…"
              />
              <datalist id="cat-options">
                {categories.map(c => <option key={c} value={c} />)}
              </datalist>
            </div>
          )}

          {scope === 'service' && (
            <div>
              <label className="block text-sm text-gray-700 mb-1">Услуга</label>
              <input
                value={serviceQuery}
                onChange={e => setServiceQuery(e.target.value)}
                placeholder="Поиск по названию или категории…"
                className="w-full border rounded-xl px-3 py-2 mb-2"
              />
              <select
                value={serviceId}
                onChange={e => setServiceId(e.target.value)}
                className="w-full border rounded-xl px-3 py-2"
                size={6}
              >
                {filteredServices.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.category ? `(${s.category})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm text-gray-700 mb-1">% скидки</label>
            <input
              type="number"
              min={0}
              max={100}
              step="0.5"
              value={discountPercent}
              onChange={e => setDiscountPercent(e.target.value)}
              className="w-full border rounded-xl px-3 py-2"
            />
          </div>

          {err && (
            <div className="p-2 rounded text-xs" style={{ background: '#fee2e2', color: '#b91c1c' }}>
              {err}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm"
            style={{ background: '#f3f4f6' }}
          >
            Отмена
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="px-4 py-2 rounded-xl text-sm font-medium"
            style={{ background: '#047857', color: '#fff', opacity: busy ? 0.7 : 1 }}
          >
            {busy ? 'Сохранение…' : 'Создать'}
          </button>
        </div>
      </div>
    </div>
  )
}
