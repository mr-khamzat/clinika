/**
 * ========================================
 * БЛОК: AdminWellnessSection — CRUD wellness-партнёров (Глава 10)
 * ========================================
 * Используется в FranchiseOwnerCabinet (super_admin only).
 *
 * API:
 *   GET    /admin/wellness/partners
 *   POST   /admin/wellness/partners
 *   PATCH  /admin/wellness/partners/{id}
 *   DELETE /admin/wellness/partners/{id}
 *   GET    /admin/wellness/analytics?partner_id={id}
 *     → { total_clicks, unique_users, conversion }
 *
 * Поля:
 *   name, category, description, logo_url, discount_text, promo_code,
 *   link_url, min_subscription_plan, active, sort_order
 *
 * Сортировка — по sort_order ASC.
 * ========================================
 */
import { useEffect, useState, useCallback, useMemo } from 'react'
import api from '../api'
import { useToast, Modal, Button } from '../design'
import CategoryTabs, { WELLNESS_CATEGORIES } from '../components/wellness/CategoryTabs'

const PLAN_OPTIONS = [
  { value: '',            label: 'Доступно всем'         },
  { value: 'health',      label: 'Health'                },
  { value: 'health_plus', label: 'Health+'               },
  { value: 'premium',     label: 'Premium'               },
]

const EMPTY_PARTNER = {
  name: '',
  category: 'fitness',
  description: '',
  logo_url: '',
  discount_text: '',
  promo_code: '',
  link_url: '',
  min_subscription_plan: '',
  active: true,
  sort_order: 100,
}

function moduleOffBlock() {
  return (
    <div className="rounded-2xl p-6 text-center" style={{ background: '#fef3c7', border: '1px solid #fde68a' }}>
      <span className="material-symbols-outlined text-3xl mb-2 block" style={{ color: '#92400e' }}>lock</span>
      <p className="text-sm font-semibold" style={{ color: '#92400e' }}>Модуль wellness-партнёров не подключён.</p>
      <p className="text-xs mt-1" style={{ color: '#92400e' }}>Подключите модуль <code>wellness_partners</code> в «Маркетплейс модулей».</p>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block mb-1" style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </label>
      {children}
    </div>
  )
}

function PartnerModal({ open, initial, onClose, onSave }) {
  const isEdit = !!initial
  const [form, setForm] = useState(() => initial ? { ...EMPTY_PARTNER, ...initial } : EMPTY_PARTNER)
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    setForm(initial ? { ...EMPTY_PARTNER, ...initial } : EMPTY_PARTNER)
  }, [initial, open])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async () => {
    if (!form.name?.trim() || !form.category || !form.discount_text?.trim()) {
      toast({ kind: 'error', text: 'Заполните обязательные поля: название, категория, скидка' })
      return
    }
    setBusy(true)
    try {
      const payload = {
        ...form,
        name: form.name.trim(),
        description: form.description?.trim() || '',
        discount_text: form.discount_text.trim(),
        promo_code: form.promo_code?.trim() || null,
        link_url: form.link_url?.trim() || null,
        logo_url: form.logo_url?.trim() || null,
        min_subscription_plan: form.min_subscription_plan || null,
        sort_order: Number(form.sort_order || 100),
      }
      if (isEdit) {
        await api.patch(`/admin/wellness/partners/${initial.id}`, payload)
        toast({ kind: 'success', text: 'Партнёр обновлён' })
      } else {
        await api.post('/admin/wellness/partners', payload)
        toast({ kind: 'success', text: 'Партнёр создан' })
      }
      onSave && onSave()
      onClose && onClose()
    } catch (e) {
      toast({ kind: 'error', text: e?.response?.data?.detail || 'Не удалось сохранить' })
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null
  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Редактирование партнёра' : 'Новый партнёр'} size="lg">
      <div className="flex flex-col gap-3" style={{ minWidth: 320 }}>
        <Field label="Название*">
          <input
            value={form.name}
            onChange={e => set('name', e.target.value)}
            className="w-full rounded-xl"
            style={{ padding: '9px 12px', border: '1px solid #e2e8f0', fontSize: 13, outline: 'none' }}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Категория*">
            <select
              value={form.category}
              onChange={e => set('category', e.target.value)}
              className="w-full rounded-xl"
              style={{ padding: '9px 12px', border: '1px solid #e2e8f0', fontSize: 13, background: '#fff', outline: 'none' }}
            >
              {WELLNESS_CATEGORIES.filter(c => c.id !== 'all').map(c => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </Field>

          <Field label="Sort order">
            <input
              type="number"
              value={form.sort_order}
              onChange={e => set('sort_order', e.target.value)}
              className="w-full rounded-xl"
              style={{ padding: '9px 12px', border: '1px solid #e2e8f0', fontSize: 13, outline: 'none' }}
            />
          </Field>
        </div>

        <Field label="Описание">
          <textarea
            value={form.description}
            onChange={e => set('description', e.target.value)}
            rows={2}
            className="w-full rounded-xl"
            style={{ padding: '9px 12px', border: '1px solid #e2e8f0', fontSize: 13, outline: 'none', resize: 'vertical' }}
          />
        </Field>

        <Field label="Текст скидки*">
          <input
            value={form.discount_text}
            onChange={e => set('discount_text', e.target.value)}
            placeholder="−25% на абонемент"
            className="w-full rounded-xl"
            style={{ padding: '9px 12px', border: '1px solid #e2e8f0', fontSize: 13, outline: 'none' }}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Промокод">
            <input
              value={form.promo_code}
              onChange={e => set('promo_code', e.target.value)}
              placeholder="CLINIKA25"
              className="w-full rounded-xl"
              style={{ padding: '9px 12px', border: '1px solid #e2e8f0', fontSize: 13, outline: 'none', fontFamily: 'monospace' }}
            />
          </Field>
          <Field label="Мин. подписка">
            <select
              value={form.min_subscription_plan || ''}
              onChange={e => set('min_subscription_plan', e.target.value)}
              className="w-full rounded-xl"
              style={{ padding: '9px 12px', border: '1px solid #e2e8f0', fontSize: 13, background: '#fff', outline: 'none' }}
            >
              {PLAN_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </Field>
        </div>

        <Field label="Ссылка на партнёра">
          <input
            value={form.link_url}
            onChange={e => set('link_url', e.target.value)}
            placeholder="https://partner.example.com/promo"
            className="w-full rounded-xl"
            style={{ padding: '9px 12px', border: '1px solid #e2e8f0', fontSize: 13, outline: 'none' }}
          />
        </Field>

        <Field label="Logo URL">
          <input
            value={form.logo_url}
            onChange={e => set('logo_url', e.target.value)}
            placeholder="https://cdn/.../logo.png"
            className="w-full rounded-xl"
            style={{ padding: '9px 12px', border: '1px solid #e2e8f0', fontSize: 13, outline: 'none' }}
          />
        </Field>

        <label className="flex items-center gap-2 cursor-pointer mt-1">
          <input type="checkbox" checked={!!form.active} onChange={e => set('active', e.target.checked)} />
          <span style={{ fontSize: 13, color: '#475569', fontWeight: 600 }}>Партнёр активен (виден пациентам)</span>
        </label>

        <div className="flex items-center justify-end gap-2 pt-3" style={{ borderTop: '1px solid #f1f5f9' }}>
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button onClick={submit} disabled={busy}>{busy ? 'Сохраняем…' : (isEdit ? 'Сохранить' : 'Создать')}</Button>
        </div>
      </div>
    </Modal>
  )
}

export default function AdminWellnessSection() {
  const { toast } = useToast()
  const [items, setItems] = useState([])
  const [analytics, setAnalytics] = useState({})  // { partnerId: { total_clicks, unique_users, conversion } }
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [editing, setEditing] = useState(null)
  const [creating, setCreating] = useState(false)
  const [cat, setCat] = useState('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await api.get('/admin/wellness/partners')
      const arr = Array.isArray(r.data) ? r.data : (r.data?.partners || [])
      arr.sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999))
      setItems(arr)

      // Подгружаем аналитику параллельно (best-effort)
      const map = {}
      await Promise.all(arr.map(async (p) => {
        try {
          const ar = await api.get('/admin/wellness/analytics', { params: { partner_id: p.id } })
          map[p.id] = ar.data || {}
        } catch { /* пусто */ }
      }))
      setAnalytics(map)
    } catch (e) {
      if (e?.response?.status === 402) setError('module_off')
      else setError('load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const removePartner = async (id) => {
    if (!confirm('Удалить партнёра? Аналитика по нему сохранится.')) return
    try {
      await api.delete(`/admin/wellness/partners/${id}`)
      toast({ kind: 'success', text: 'Партнёр удалён' })
      load()
    } catch (e) {
      toast({ kind: 'error', text: e?.response?.data?.detail || 'Не удалось удалить' })
    }
  }

  const toggleActive = async (p) => {
    try {
      await api.patch(`/admin/wellness/partners/${p.id}`, { active: !p.active })
      load()
    } catch (e) {
      toast({ kind: 'error', text: e?.response?.data?.detail || 'Не удалось обновить' })
    }
  }

  const counts = useMemo(() => {
    const c = { all: items.length }
    for (const it of items) {
      const k = String(it.category || 'other').toLowerCase()
      c[k] = (c[k] || 0) + 1
    }
    return c
  }, [items])

  const filtered = useMemo(() => {
    if (cat === 'all') return items
    return items.filter(it => String(it.category || 'other').toLowerCase() === cat)
  }, [items, cat])

  // Аггрегаты сверху
  const totalClicks = useMemo(
    () => Object.values(analytics).reduce((s, a) => s + Number(a.total_clicks || 0), 0),
    [analytics]
  )
  const totalUniqueUsers = useMemo(
    () => Object.values(analytics).reduce((s, a) => s + Number(a.unique_users || 0), 0),
    [analytics]
  )

  if (error === 'module_off') return moduleOffBlock()

  return (
    <div className="space-y-4">
      {/* ── KPI top row ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiBox label="Партнёров" value={items.length} icon="storefront" tone="#0ea5e9" />
        <KpiBox label="Активных" value={items.filter(i => i.active).length} icon="check_circle" tone="#10b981" />
        <KpiBox label="Кликов всего" value={totalClicks} icon="ads_click" tone="#8b5cf6" />
        <KpiBox label="Уникальных" value={totalUniqueUsers} icon="group" tone="#f59e0b" />
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <CategoryTabs value={cat} onChange={setCat} counts={counts} />
        <button
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold text-white transition-all active:scale-95 flex-shrink-0"
          style={{ background: '#0097A7' }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
          Новый партнёр
        </button>
      </div>

      {loading && (
        <div className="space-y-2">{[0,1,2].map(i => <div key={i} className="h-16 rounded-xl animate-pulse" style={{ background: '#e5e7eb' }} />)}</div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="rounded-2xl p-8 text-center" style={{ background: '#f9fafb', border: '1px dashed #e5e7eb' }}>
          <span className="material-symbols-outlined text-4xl mb-2 block" style={{ color: '#9ca3af' }}>storefront</span>
          <p className="text-sm font-semibold text-gray-700">В этой категории пусто</p>
          <p className="text-xs text-gray-500 mt-1">Добавьте первого партнёра — кнопка справа сверху</p>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="overflow-x-auto rounded-2xl" style={{ border: '1px solid #e5e7eb', background: '#fff' }}>
          <table className="w-full text-sm">
            <thead style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2 font-semibold">#</th>
                <th className="px-3 py-2 font-semibold">Партнёр</th>
                <th className="px-3 py-2 font-semibold">Категория</th>
                <th className="px-3 py-2 font-semibold">Скидка</th>
                <th className="px-3 py-2 font-semibold">Подписка</th>
                <th className="px-3 py-2 font-semibold text-right">Клики</th>
                <th className="px-3 py-2 font-semibold text-right">Уник.</th>
                <th className="px-3 py-2 font-semibold">Статус</th>
                <th className="px-3 py-2 font-semibold text-right">Действия</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p, i) => {
                const a = analytics[p.id] || {}
                return (
                  <tr key={p.id} style={{ borderTop: i === 0 ? 'none' : '1px solid #f1f5f9' }}>
                    <td className="px-3 py-3" style={{ color: '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>{p.sort_order ?? '—'}</td>
                    <td className="px-3 py-3">
                      <div className="font-semibold" style={{ color: '#0f172a' }}>{p.name}</div>
                      {p.description && (
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, maxWidth: 220, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {p.description}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3" style={{ color: '#475569' }}>
                      {(WELLNESS_CATEGORIES.find(c => c.id === p.category) || {}).label || p.category}
                    </td>
                    <td className="px-3 py-3 font-semibold" style={{ color: '#0f172a' }}>{p.discount_text || '—'}</td>
                    <td className="px-3 py-3" style={{ color: '#475569' }}>
                      {(PLAN_OPTIONS.find(o => o.value === (p.min_subscription_plan || '')) || {}).label || p.min_subscription_plan}
                    </td>
                    <td className="px-3 py-3 text-right" style={{ color: '#0f172a', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                      {a.total_clicks ?? 0}
                    </td>
                    <td className="px-3 py-3 text-right" style={{ color: '#0f172a', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                      {a.unique_users ?? 0}
                    </td>
                    <td className="px-3 py-3">
                      <button
                        onClick={() => toggleActive(p)}
                        title="Переключить активность"
                        style={{
                          padding: '3px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                          background: p.active ? '#dcfce7' : '#f1f5f9',
                          color: p.active ? '#166534' : '#64748b',
                          border: '1px solid ' + (p.active ? '#bbf7d0' : '#e2e8f0'),
                        }}
                      >
                        {p.active ? 'Активен' : 'Отключён'}
                      </button>
                    </td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => setEditing(p)}
                        className="text-xs font-semibold mr-1 transition-colors"
                        style={{ color: '#475569', padding: '4px 8px', borderRadius: 8, background: '#f1f5f9' }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => removePartner(p.id)}
                        className="text-xs font-semibold transition-colors"
                        style={{ color: '#b91c1c', padding: '4px 8px', borderRadius: 8, background: '#fef2f2' }}
                      >
                        Del
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <PartnerModal
        open={creating || !!editing}
        initial={editing}
        onClose={() => { setCreating(false); setEditing(null) }}
        onSave={load}
      />
    </div>
  )
}

function KpiBox({ label, value, icon, tone = '#0ea5e9' }) {
  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: '#fff', border: '1px solid #e2e8f0' }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className="inline-grid place-items-center"
          style={{ width: 32, height: 32, borderRadius: 9, background: tone + '20', color: tone }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}>
            {icon}
          </span>
        </span>
        <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          {label}
        </div>
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
    </div>
  )
}
