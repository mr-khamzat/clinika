/**
 * ========================================
 * БЛОК: AdminLoyaltySection — управление лояльностью для manager / franchise_owner (Глава 8)
 * ========================================
 * Используется внутри _ManagerShell и FranchiseOwnerCabinet (отдельный раздел
 * «Награды и пациенты» — не путать с существующим LoyaltySection, который
 * настраивает тиры/правила/обмен бонусов через /loyalty/*).
 *
 * API (все через apiClient: токен берётся из admin-стораджа автоматически):
 *   GET  /admin/loyalty/rewards
 *   POST /admin/loyalty/rewards { name, description, points_cost, min_tier, stock, active }
 *   PATCH  /admin/loyalty/rewards/{id}
 *   DELETE /admin/loyalty/rewards/{id}
 *   GET  /admin/loyalty/leaderboard       → [{ patient_id, full_name, points, tier }]
 *   POST /admin/loyalty/manual-adjust     { patient_id, delta, reason, note }
 *   GET  /admin/loyalty/claims?status=    → claims (request/approved/delivered/cancelled)
 *   PATCH /admin/loyalty/claims/{id}/status { status }
 *
 * Tabs:
 *   1. Каталог наград (CRUD)
 *   2. Лидерборд (топ пациентов)
 *   3. Запросы на награды (claims + approve/deliver/cancel)
 *   4. Ручная корректировка (форма)
 * ========================================
 */
import { useEffect, useState, useCallback } from 'react'
import api from '../api'
import { useToast } from '../design'
import TierBadge from '../components/loyalty/TierBadge'

// ── Универсальные мини-хелперы ───────────────────────────────────────────────
function moduleOffBlock() {
  return (
    <div className="rounded-2xl p-6 text-center" style={{ background: '#fef3c7', border: '1px solid #fde68a' }}>
      <span className="material-symbols-outlined text-3xl mb-2 block" style={{ color: '#92400e' }}>lock</span>
      <p className="text-sm font-semibold" style={{ color: '#92400e' }}>
        Модуль программы лояльности не подключен.
      </p>
      <p className="text-xs mt-1" style={{ color: '#92400e' }}>
        Подключите модуль <code>loyalty_pro</code> в «Маркетплейс модулей».
      </p>
    </div>
  )
}

// ── Каталог наград (CRUD) ───────────────────────────────────────────────────
function RewardsTab() {
  const { toast } = useToast()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null)  // объект или null
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await api.get('/admin/loyalty/rewards')
      setItems(Array.isArray(r.data) ? r.data : (Array.isArray(r.data?.items) ? r.data.items : []))
    } catch (e) {
      if (e?.response?.status === 402) setError('module_off')
      else setError('load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const removeReward = async (id) => {
    if (!confirm('Удалить эту награду?')) return
    try {
      await api.delete(`/admin/loyalty/rewards/${id}`)
      toast({ kind: 'success', text: 'Награда удалена' })
      load()
    } catch (e) {
      toast({ kind: 'error', text: e?.response?.data?.detail || 'Не удалось удалить' })
    }
  }

  if (error === 'module_off') return moduleOffBlock()
  if (loading) {
    return <div className="space-y-2">{[0,1,2].map(i => <div key={i} className="h-16 rounded-xl animate-pulse" style={{ background: '#e5e7eb' }} />)}</div>
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">Всего наград: {items.length}</p>
        <button
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold text-white transition-all active:scale-95"
          style={{ background: '#0097A7' }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
          Новая награда
        </button>
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl p-8 text-center" style={{ background: '#f9fafb', border: '1px dashed #e5e7eb' }}>
          <span className="material-symbols-outlined text-4xl mb-2 block" style={{ color: '#9ca3af' }}>card_giftcard</span>
          <p className="text-sm font-semibold text-gray-700">Каталог пуст</p>
          <p className="text-xs text-gray-500 mt-1">Добавьте первую награду для пациентов</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl" style={{ border: '1px solid #e5e7eb', background: '#fff' }}>
          <table className="w-full text-sm">
            <thead style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2 font-semibold">Название</th>
                <th className="px-3 py-2 font-semibold">Цена</th>
                <th className="px-3 py-2 font-semibold">Мин. тир</th>
                <th className="px-3 py-2 font-semibold">Остаток</th>
                <th className="px-3 py-2 font-semibold">Статус</th>
                <th className="px-3 py-2 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {items.map(r => (
                <tr key={r.id} className="border-t" style={{ borderColor: '#f3f4f6' }}>
                  <td className="px-3 py-2.5">
                    <div className="font-semibold text-gray-900">{r.name}</div>
                    {r.description && <div className="text-xs text-gray-500 truncate max-w-xs">{r.description}</div>}
                  </td>
                  <td className="px-3 py-2.5 font-bold" style={{ color: '#0097A7' }}>
                    {Number(r.cost_points ?? r.points_cost ?? 0).toLocaleString('ru-RU')}
                  </td>
                  <td className="px-3 py-2.5">
                    {r.min_tier ? <TierBadge tier={r.min_tier} size="sm" /> : <span className="text-xs text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-gray-700">{r.stock == null ? '∞' : r.stock}</td>
                  <td className="px-3 py-2.5">
                    {(() => {
                      const isActive = (r.is_active ?? r.active) !== false
                      return (
                        <span
                          className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                          style={{
                            background: isActive ? '#dcfce7' : '#fee2e2',
                            color: isActive ? '#15803d' : '#991b1b',
                          }}
                        >
                          {isActive ? 'активна' : 'выкл.'}
                        </span>
                      )
                    })()}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex gap-1 justify-end">
                      <button
                        onClick={() => setEditing(r)}
                        className="rounded-lg p-1.5 transition-all hover:bg-gray-100"
                        title="Редактировать"
                      >
                        <span className="material-symbols-outlined text-gray-600" style={{ fontSize: 18 }}>edit</span>
                      </button>
                      <button
                        onClick={() => removeReward(r.id)}
                        className="rounded-lg p-1.5 transition-all hover:bg-red-50"
                        title="Удалить"
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#dc2626' }}>delete</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(creating || editing) && (
        <RewardFormModal
          initial={editing}
          onClose={() => { setEditing(null); setCreating(false) }}
          onSaved={() => { setEditing(null); setCreating(false); load() }}
        />
      )}
    </div>
  )
}

// ── Модалка создания / редактирования награды ───────────────────────────────
function RewardFormModal({ initial, onClose, onSaved }) {
  const { toast } = useToast()
  // Бэкенд использует cost_points / is_active. В UI хранения «points_cost / active»
  // оставлено для обратной совместимости с initial из GET-ответа (он отдаёт оба варианта).
  const [form, setForm] = useState({
    name: initial?.name || '',
    description: initial?.description || '',
    points_cost: initial?.cost_points ?? initial?.points_cost ?? 100,
    min_tier: initial?.min_tier || '',
    stock: initial?.stock ?? '',
    active: (initial?.is_active ?? initial?.active) ?? true,
  })
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!form.name.trim()) {
      toast({ kind: 'error', text: 'Введите название награды' })
      return
    }
    setSaving(true)
    try {
      // Глава 9 hotfix: бэкенд требует cost_points + is_active.
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        cost_points: Number(form.points_cost) || 1,
        min_tier: form.min_tier || 'bronze',
        stock: form.stock === '' ? null : Number(form.stock),
        is_active: !!form.active,
      }
      if (initial?.id) {
        await api.patch(`/admin/loyalty/rewards/${initial.id}`, payload)
        toast({ kind: 'success', text: 'Награда обновлена' })
      } else {
        await api.post('/admin/loyalty/rewards', payload)
        toast({ kind: 'success', text: 'Награда создана' })
      }
      onSaved()
    } catch (e) {
      toast({ kind: 'error', text: e?.response?.data?.detail || 'Не удалось сохранить' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-50" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={() => !saving && onClose()} />
      <div
        className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[92%] max-w-md rounded-3xl p-6 overflow-y-auto"
        style={{ background: '#fff', maxHeight: '90vh', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}
      >
        <h3 className="text-lg font-extrabold text-gray-900 mb-4">
          {initial ? 'Редактировать награду' : 'Новая награда'}
        </h3>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">Название *</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              className="w-full rounded-xl px-3 py-2 text-sm border focus:outline-none focus:ring-2"
              style={{ borderColor: '#e5e7eb' }}
              placeholder="Например: Подарочный сертификат 500 ₽"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">Описание</label>
            <textarea
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              className="w-full rounded-xl px-3 py-2 text-sm border focus:outline-none focus:ring-2"
              style={{ borderColor: '#e5e7eb', minHeight: 72 }}
              placeholder="Что получит пациент"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">Цена (баллов)</label>
              <input
                type="number"
                min={0}
                value={form.points_cost}
                onChange={e => setForm({ ...form, points_cost: e.target.value })}
                className="w-full rounded-xl px-3 py-2 text-sm border"
                style={{ borderColor: '#e5e7eb' }}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">Мин. тир</label>
              <select
                value={form.min_tier}
                onChange={e => setForm({ ...form, min_tier: e.target.value })}
                className="w-full rounded-xl px-3 py-2 text-sm border"
                style={{ borderColor: '#e5e7eb' }}
              >
                <option value="">— любой —</option>
                <option value="bronze">Bronze</option>
                <option value="silver">Silver</option>
                <option value="gold">Gold</option>
                <option value="platinum">Platinum</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 items-end">
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">Остаток (пусто = ∞)</label>
              <input
                type="number"
                min={0}
                value={form.stock}
                onChange={e => setForm({ ...form, stock: e.target.value })}
                className="w-full rounded-xl px-3 py-2 text-sm border"
                style={{ borderColor: '#e5e7eb' }}
                placeholder="∞"
              />
            </div>
            <label className="inline-flex items-center gap-2 cursor-pointer select-none rounded-xl px-3 py-2 border" style={{ borderColor: '#e5e7eb' }}>
              <input
                type="checkbox"
                checked={form.active}
                onChange={e => setForm({ ...form, active: e.target.checked })}
                className="w-4 h-4"
                style={{ accentColor: '#0097A7' }}
              />
              <span className="text-sm font-semibold text-gray-700">Активна</span>
            </label>
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 rounded-xl py-3 text-sm font-bold disabled:opacity-60"
            style={{ background: '#f3f4f6', color: '#374151' }}
          >
            Отмена
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="flex-1 rounded-xl py-3 text-sm font-bold text-white disabled:opacity-60"
            style={{ background: '#0097A7' }}
          >
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </>
  )
}

// ── Лидерборд ───────────────────────────────────────────────────────────────
function LeaderboardTab() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    api.get('/admin/loyalty/leaderboard')
      .then(r => { if (alive) { setItems(Array.isArray(r.data) ? r.data : (Array.isArray(r.data?.items) ? r.data.items : [])); setLoading(false) } })
      .catch(e => {
        if (!alive) return
        if (e?.response?.status === 402) setError('module_off')
        else setError('load')
        setLoading(false)
      })
    return () => { alive = false }
  }, [])

  if (error === 'module_off') return moduleOffBlock()
  if (loading) {
    return <div className="space-y-2">{[0,1,2,3,4].map(i => <div key={i} className="h-12 rounded-xl animate-pulse" style={{ background: '#e5e7eb' }} />)}</div>
  }

  if (!items.length) {
    return (
      <div className="rounded-2xl p-8 text-center" style={{ background: '#f9fafb', border: '1px dashed #e5e7eb' }}>
        <span className="material-symbols-outlined text-4xl mb-2 block" style={{ color: '#9ca3af' }}>leaderboard</span>
        <p className="text-sm font-semibold text-gray-700">Лидерборд пуст</p>
        <p className="text-xs text-gray-500 mt-1">Пациенты появятся после первых начислений баллов</p>
      </div>
    )
  }

  const TROPHIES = ['#ffd700', '#c0c0c0', '#cd7f32']  // gold/silver/bronze для первых 3

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: '#fff', border: '1px solid #e5e7eb' }}>
      {items.map((p, idx) => (
        <div key={p.patient_id || idx} className="flex items-center gap-3 px-3 py-2.5 border-b last:border-b-0" style={{ borderColor: '#f3f4f6' }}>
          <span
            className="inline-grid place-items-center font-extrabold flex-shrink-0"
            style={{
              width: 32, height: 32, borderRadius: 999,
              background: idx < 3 ? TROPHIES[idx] : '#f3f4f6',
              color: idx < 3 ? '#fff' : '#6b7280',
              fontSize: idx < 3 ? 14 : 13,
            }}
          >
            {idx + 1}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{(p.patient_name || p.full_name) || `Пациент #${p.patient_id}`}</p>
            <p className="text-xs text-gray-500">ID: {p.patient_id}</p>
          </div>
          {p.tier && <TierBadge tier={p.tier} size="sm" />}
          <span className="font-extrabold flex-shrink-0" style={{ color: '#0097A7' }}>
            {Number(p.points || 0).toLocaleString('ru-RU')}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Запросы на награды (claims) ─────────────────────────────────────────────
function ClaimsTab() {
  const { toast } = useToast()
  const [items, setItems] = useState([])
  const [statusFilter, setStatusFilter] = useState('requested')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await api.get('/admin/loyalty/claims', { params: statusFilter ? { status: statusFilter } : {} })
      setItems(Array.isArray(r.data) ? r.data : (Array.isArray(r.data?.items) ? r.data.items : []))
    } catch (e) {
      if (e?.response?.status === 402) setError('module_off')
      else setError('load')
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => { load() }, [load])

  const setStatus = async (id, status) => {
    try {
      await api.patch(`/admin/loyalty/claims/${id}/status`, { status })
      toast({ kind: 'success', text: `Статус обновлён: ${status}` })
      load()
    } catch (e) {
      toast({ kind: 'error', text: e?.response?.data?.detail || 'Не удалось обновить' })
    }
  }

  if (error === 'module_off') return moduleOffBlock()

  const FILTERS = [
    { v: 'requested',  label: 'Новые' },
    { v: 'approved',   label: 'Одобрены' },
    { v: 'delivered',  label: 'Выданы' },
    { v: 'cancelled',  label: 'Отменены' },
    { v: '',           label: 'Все' },
  ]

  const STATUS_LABEL = {
    requested:  { label: 'новый',     bg: '#fef3c7', fg: '#92400e' },
    approved:   { label: 'одобрен',   bg: '#dbeafe', fg: '#1e40af' },
    delivered:  { label: 'выдан',     bg: '#dcfce7', fg: '#15803d' },
    cancelled:  { label: 'отменён',   bg: '#fee2e2', fg: '#991b1b' },
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-1 p-1 rounded-xl overflow-x-auto" style={{ background: '#f3f4f6' }}>
        {FILTERS.map(f => {
          const active = statusFilter === f.v
          return (
            <button
              key={f.v}
              onClick={() => setStatusFilter(f.v)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap"
              style={{
                background: active ? '#fff' : 'transparent',
                color: active ? '#0097A7' : '#6b7280',
              }}
            >
              {f.label}
            </button>
          )
        })}
      </div>

      {loading ? (
        <div className="space-y-2">{[0,1,2].map(i => <div key={i} className="h-16 rounded-xl animate-pulse" style={{ background: '#e5e7eb' }} />)}</div>
      ) : !items.length ? (
        <div className="rounded-2xl p-8 text-center" style={{ background: '#f9fafb', border: '1px dashed #e5e7eb' }}>
          <span className="material-symbols-outlined text-4xl mb-2 block" style={{ color: '#9ca3af' }}>inbox</span>
          <p className="text-sm font-semibold text-gray-700">Запросов нет</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(c => {
            const st = STATUS_LABEL[c.status] || { label: c.status, bg: '#f3f4f6', fg: '#374151' }
            return (
              <div key={c.id} className="rounded-2xl p-3" style={{ background: '#fff', border: '1px solid #e5e7eb' }}>
                <div className="flex items-start gap-3">
                  <span
                    className="inline-grid place-items-center flex-shrink-0"
                    style={{ width: 36, height: 36, borderRadius: 10, background: '#0097A715', color: '#0097A7' }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 20, fontVariationSettings: "'FILL' 1" }}>redeem</span>
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-gray-900">{c.reward_name || `Reward #${c.reward_id}`}</p>
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: st.bg, color: st.fg }}>
                        {st.label}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 mt-0.5">
                      {c.patient_name || `Пациент #${c.patient_id}`}
                      {(c.points_spent ?? c.points_cost) != null && <> · <span className="font-bold" style={{ color: '#0097A7' }}>{Number(c.points_spent ?? c.points_cost).toLocaleString('ru-RU')} б</span></>}
                    </p>
                    {c.created_at && (
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        {new Date(c.created_at).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    )}
                  </div>
                </div>

                {c.status !== 'delivered' && c.status !== 'cancelled' && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {c.status === 'requested' && (
                      <button
                        onClick={() => setStatus(c.id, 'approved')}
                        className="rounded-lg px-3 py-1.5 text-xs font-bold text-white transition-all active:scale-95"
                        style={{ background: '#1565C0' }}
                      >
                        Одобрить
                      </button>
                    )}
                    {(c.status === 'requested' || c.status === 'approved') && (
                      <button
                        onClick={() => setStatus(c.id, 'delivered')}
                        className="rounded-lg px-3 py-1.5 text-xs font-bold text-white transition-all active:scale-95"
                        style={{ background: '#10b981' }}
                      >
                        Выдано
                      </button>
                    )}
                    <button
                      onClick={() => setStatus(c.id, 'cancelled')}
                      className="rounded-lg px-3 py-1.5 text-xs font-bold transition-all active:scale-95"
                      style={{ background: '#fee2e2', color: '#991b1b' }}
                    >
                      Отменить
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Ручная корректировка баллов ─────────────────────────────────────────────
function ManualAdjustTab() {
  const { toast } = useToast()
  const [form, setForm] = useState({ patient_id: '', delta: '', reason: 'manual_adjust', note: '' })
  const [saving, setSaving] = useState(false)
  const [leaderboard, setLeaderboard] = useState([])
  const [search, setSearch] = useState('')

  useEffect(() => {
    api.get('/admin/loyalty/leaderboard')
      .then(r => setLeaderboard(Array.isArray(r.data) ? r.data : (Array.isArray(r.data?.items) ? r.data.items : [])))
      .catch(() => setLeaderboard([]))
  }, [])

  const filtered = search
    ? leaderboard.filter(p => ((p.patient_name || p.full_name) || '').toLowerCase().includes(search.toLowerCase()) || String(p.patient_id).includes(search))
    : leaderboard.slice(0, 20)

  const submit = async () => {
    if (!form.patient_id) return toast({ kind: 'error', text: 'Выберите пациента' })
    if (!form.delta || isNaN(Number(form.delta))) return toast({ kind: 'error', text: 'Введите число баллов (+/−)' })
    if (!form.reason.trim()) return toast({ kind: 'error', text: 'Укажите причину' })

    setSaving(true)
    try {
      // patient_id может быть UUID (из leaderboard) или телефон. Не Number'ить.
      await api.post('/admin/loyalty/manual-adjust', {
        patient_id: String(form.patient_id).trim(),
        delta: Number(form.delta),
        reason: form.reason.trim(),
        note: form.note.trim() || null,
      })
      toast({ kind: 'success', text: 'Баллы скорректированы' })
      setForm({ patient_id: '', delta: '', reason: 'manual_adjust', note: '' })
    } catch (e) {
      if (e?.response?.status === 402) {
        toast({ kind: 'error', text: 'Модуль программы лояльности не подключен.' })
      } else {
        toast({ kind: 'error', text: e?.response?.data?.detail || 'Не удалось скорректировать' })
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {/* Левая колонка — форма */}
      <div className="rounded-2xl p-4 space-y-3" style={{ background: '#fff', border: '1px solid #e5e7eb' }}>
        <h3 className="text-sm font-bold text-gray-900">Корректировка баллов</h3>

        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1 block">ID пациента *</label>
          <input
            type="number"
            value={form.patient_id}
            onChange={e => setForm({ ...form, patient_id: e.target.value })}
            className="w-full rounded-xl px-3 py-2 text-sm border"
            style={{ borderColor: '#e5e7eb' }}
            placeholder="ID из лидерборда справа"
          />
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1 block">Δ баллов *</label>
          <input
            type="number"
            value={form.delta}
            onChange={e => setForm({ ...form, delta: e.target.value })}
            className="w-full rounded-xl px-3 py-2 text-sm border"
            style={{ borderColor: '#e5e7eb' }}
            placeholder="100 (начислить) или -50 (списать)"
          />
          <p className="text-[11px] text-gray-500 mt-1">Используйте «−» для списания (например, штраф).</p>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1 block">Причина *</label>
          <select
            value={form.reason}
            onChange={e => setForm({ ...form, reason: e.target.value })}
            className="w-full rounded-xl px-3 py-2 text-sm border"
            style={{ borderColor: '#e5e7eb' }}
          >
            <option value="manual_adjust">Ручная корректировка</option>
            <option value="signup_bonus">Бонус за регистрацию</option>
            <option value="birthday_bonus">Бонус ко дню рождения</option>
            <option value="review_bonus">Бонус за отзыв</option>
            <option value="invite_friend">Приглашение друга</option>
            <option value="tier_upgrade">Повышение уровня</option>
            <option value="expired">Истёк срок действия</option>
          </select>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1 block">Комментарий</label>
          <textarea
            value={form.note}
            onChange={e => setForm({ ...form, note: e.target.value })}
            className="w-full rounded-xl px-3 py-2 text-sm border"
            style={{ borderColor: '#e5e7eb', minHeight: 72 }}
            placeholder="Видно пациенту в истории"
          />
        </div>

        <button
          onClick={submit}
          disabled={saving}
          className="w-full rounded-xl py-3 text-sm font-bold text-white transition-all active:scale-95 disabled:opacity-60"
          style={{ background: '#0097A7' }}
        >
          {saving ? 'Применяем…' : 'Применить'}
        </button>
      </div>

      {/* Правая колонка — поиск пациента */}
      <div className="rounded-2xl p-4" style={{ background: '#fff', border: '1px solid #e5e7eb' }}>
        <h3 className="text-sm font-bold text-gray-900 mb-2">Выбор пациента</h3>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full rounded-xl px-3 py-2 text-sm border mb-3"
          style={{ borderColor: '#e5e7eb' }}
          placeholder="Имя или ID…"
        />
        <div className="space-y-1.5 max-h-[440px] overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-6">Никого не найдено</p>
          ) : filtered.map(p => (
            <button
              key={p.patient_id}
              onClick={() => setForm({ ...form, patient_id: String(p.patient_id) })}
              className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-left transition-all"
              style={{
                background: String(form.patient_id) === String(p.patient_id) ? '#0097A715' : '#f9fafb',
                border: `1px solid ${String(form.patient_id) === String(p.patient_id) ? '#0097A7' : '#f3f4f6'}`,
              }}
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-gray-900 truncate">{(p.patient_name || p.full_name) || `Пациент #${p.patient_id}`}</p>
                <p className="text-[11px] text-gray-500">ID: {p.patient_id}</p>
              </div>
              {p.tier && <TierBadge tier={p.tier} size="sm" />}
              <span className="text-xs font-bold flex-shrink-0" style={{ color: '#0097A7' }}>
                {Number(p.points || 0).toLocaleString('ru-RU')}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Корневой компонент ──────────────────────────────────────────────────────
const TABS = [
  { id: 'rewards',     label: 'Каталог наград',      icon: 'card_giftcard' },
  { id: 'leaderboard', label: 'Лидерборд',           icon: 'leaderboard'   },
  { id: 'claims',      label: 'Запросы на награды',  icon: 'inbox'         },
  { id: 'adjust',      label: 'Ручная корректировка', icon: 'tune'         },
]

export default function AdminLoyaltySection({ token: _token }) {
  // token принимается для совместимости (FranchiseOwnerCabinet передаёт adminToken),
  // но реально не используется — apiClient сам подставит admin-токен из localStorage.
  const [tab, setTab] = useState('rewards')

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-extrabold text-gray-900 dark:text-white flex items-center gap-2">
          <span
            className="material-symbols-outlined"
            style={{ fontVariationSettings: "'FILL' 1", color: '#0097A7' }}
          >
            workspace_premium
          </span>
          Лояльность: награды и пациенты
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Управление каталогом наград, запросы пациентов, лидерборд и ручная корректировка баллов
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-2xl overflow-x-auto" style={{ background: '#f3f4f6' }}>
        {TABS.map(t => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all whitespace-nowrap"
              style={{
                background: active ? '#fff' : 'transparent',
                color: active ? '#0097A7' : '#6b7280',
                boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16, fontVariationSettings: active ? "'FILL' 1" : "'FILL' 0" }}>
                {t.icon}
              </span>
              {t.label}
            </button>
          )
        })}
      </div>

      <div>
        {tab === 'rewards'     && <RewardsTab />}
        {tab === 'leaderboard' && <LeaderboardTab />}
        {tab === 'claims'      && <ClaimsTab />}
        {tab === 'adjust'      && <ManualAdjustTab />}
      </div>
    </div>
  )
}
