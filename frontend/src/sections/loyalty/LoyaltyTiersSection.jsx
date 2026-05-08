/**
 * LoyaltyTiersSection — CRUD уровней лояльности + топ-пациенты в каждом тире.
 *
 * API:
 *   GET    /loyalty/tiers/with-top   — тиры с patients_count + top_patients[]
 *   POST   /loyalty/tiers            — создать
 *   PATCH  /loyalty/tiers/{id}       — редактировать
 *   DELETE /loyalty/tiers/{id}       — удалить
 *
 * Цветовая палитра тира выбирается по имени или индексу.
 * 402 Payment Required → CTA «Подключить модуль loyalty_pro».
 */
import { useState, useEffect, useCallback } from 'react'
import api from '../../api'
import { useToast } from '../../design'

const apiFetch = (m, url, _t, d) => api({ method: m, url, data: d })

// ── Палитра тиров (корпоративный медицинский стиль, без радуги) ──────────────
// Подбираем border/bg по имени; fallback — синий нейтральный.
const TIER_PALETTE = {
  bronze:   { border: '#cd7f32', soft: '#fef3e2', text: '#92400e', icon: 'workspace_premium' },
  silver:   { border: '#9ca3af', soft: '#f3f4f6', text: '#374151', icon: 'workspace_premium' },
  gold:     { border: '#d4af37', soft: '#fef9c3', text: '#854d0e', icon: 'workspace_premium' },
  platinum: { border: '#0097A7', soft: '#e0f7fa', text: '#006064', icon: 'diamond' },
  diamond:  { border: '#7c3aed', soft: '#ede9fe', text: '#5b21b6', icon: 'diamond' },
}
const DEFAULT_PALETTE = { border: '#0097A7', soft: '#e0f7fa', text: '#006064', icon: 'workspace_premium' }
const paletteFor = (name) => TIER_PALETTE[(name || '').toLowerCase()] || DEFAULT_PALETTE

const EMPTY_FORM = {
  name: '',
  threshold_rub: 0,
  discount_percent: 0,
  perks: '',  // вводим как plain text (json optional)
}

// ── Карточка одного тира ─────────────────────────────────────────────────────
function TierCard({ tier, onEdit, onDelete }) {
  const p = paletteFor(tier.name)
  return (
    <div
      className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden"
      style={{ border: `2px solid ${p.border}` }}
    >
      <div
        className="px-5 py-4 flex items-center justify-between"
        style={{ background: p.soft, color: p.text }}
      >
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[28px]" style={{ fontVariationSettings: "'FILL' 1" }}>
            {p.icon}
          </span>
          <div>
            <div className="text-lg font-bold capitalize">{tier.name}</div>
            <div className="text-xs opacity-80">
              от {Number(tier.threshold_rub).toLocaleString('ru')} ₽ · скидка {Number(tier.discount_percent)}%
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-extrabold">{tier.patients_count || 0}</div>
          <div className="text-[10px] uppercase tracking-wider opacity-70">пациентов</div>
        </div>
      </div>

      <div className="p-4">
        <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
          Топ пациентов
        </div>
        {(tier.top_patients || []).length === 0 ? (
          <div className="text-sm text-gray-400 italic py-3 text-center">Пока нет участников</div>
        ) : (
          <div className="space-y-1.5">
            {tier.top_patients.slice(0, 10).map((pt, i) => (
              <div key={pt.phone + i} className="flex items-center justify-between text-sm">
                <span className="text-gray-700 dark:text-gray-200 font-mono">{pt.phone}</span>
                <span className="text-gray-500 dark:text-gray-400 text-xs">
                  {pt.points_balance} / {pt.points_total} баллов
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2 mt-4 pt-3 border-t border-gray-100 dark:border-gray-700">
          <button
            onClick={() => onEdit(tier)}
            className="flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            Редактировать
          </button>
          <button
            onClick={() => onDelete(tier)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-red-600 hover:bg-red-50"
          >
            Удалить
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Главный компонент ────────────────────────────────────────────────────────
export default function LoyaltyTiersSection({ token }) {
  const [tiers, setTiers]   = useState(null)
  const [err, setErr]       = useState('')
  const [needPay, setNeedPay] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing]   = useState(null)
  const [form, setForm]     = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()

  const load = useCallback(async () => {
    setErr('')
    setNeedPay(false)
    try {
      const r = await apiFetch('get', '/loyalty/tiers/with-top?top_n=10', token)
      setTiers(Array.isArray(r.data) ? r.data : [])
    } catch (e) {
      const code = e?.response?.status
      if (code === 402) setNeedPay(true)
      else setErr(e?.response?.data?.detail || 'Ошибка загрузки тиров')
      setTiers([])
    }
  }, [token])

  useEffect(() => { load() }, [load])

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
  }
  const openEdit = (tier) => {
    setEditing(tier)
    setForm({
      name: tier.name,
      threshold_rub: Number(tier.threshold_rub),
      discount_percent: Number(tier.discount_percent),
      perks: tier.perks ? JSON.stringify(tier.perks, null, 2) : '',
    })
    setShowForm(true)
  }

  const submit = async () => {
    setSaving(true)
    try {
      let perks = null
      if (form.perks?.trim()) {
        try { perks = JSON.parse(form.perks) }
        catch { toast({ kind: 'error', text: 'Поле «Перки» — некорректный JSON' }); setSaving(false); return }
      }
      const body = {
        name: form.name.trim(),
        threshold_rub: Number(form.threshold_rub) || 0,
        discount_percent: Number(form.discount_percent) || 0,
        perks,
      }
      if (editing) {
        await apiFetch('patch', `/loyalty/tiers/${editing.id}`, token, body)
        toast({ kind: 'success', text: 'Тир обновлён' })
      } else {
        await apiFetch('post', '/loyalty/tiers', token, body)
        toast({ kind: 'success', text: 'Тир создан' })
      }
      setShowForm(false)
      await load()
    } catch (e) {
      toast({ kind: 'error', text: e?.response?.data?.detail || 'Ошибка сохранения' })
    } finally {
      setSaving(false)
    }
  }

  const onDelete = async (tier) => {
    if (!confirm(`Удалить тир «${tier.name}»? Пациенты в нём будут переведены на ближайший нижний уровень при следующем пересчёте.`)) return
    try {
      await apiFetch('delete', `/loyalty/tiers/${tier.id}`, token)
      toast({ kind: 'success', text: 'Тир удалён' })
      await load()
    } catch (e) {
      toast({ kind: 'error', text: e?.response?.data?.detail || 'Ошибка удаления' })
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (needPay) {
    return (
      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-6 text-center">
        <span className="material-symbols-outlined text-[40px] text-amber-500 mb-2">workspace_premium</span>
        <div className="text-lg font-bold text-amber-900 dark:text-amber-200 mb-1">Модуль не подключён</div>
        <div className="text-sm text-amber-700 dark:text-amber-300 mb-4">
          Чтобы пользоваться программой лояльности, подключите модуль <code className="bg-amber-100 dark:bg-amber-900/40 px-1 rounded">loyalty_pro</code> (2&nbsp;990&nbsp;₽/мес).
        </div>
        <a href="../admin/modules_catalog" className="inline-block bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-xl text-sm font-semibold">
          Перейти в каталог модулей
        </a>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">
          {tiers === null ? 'Загрузка…' : `Уровней: ${tiers.length}`}
        </div>
        <button
          onClick={openCreate}
          className="bg-[#0097A7] hover:bg-[#00838F] text-white px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-1.5"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          Новый тир
        </button>
      </div>

      {err && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-600 text-sm">{err}</div>
      )}

      {tiers === null ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-[#0097A7] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : tiers.length === 0 ? (
        <div className="bg-gray-50 dark:bg-gray-800/50 border border-dashed border-gray-200 dark:border-gray-700 rounded-2xl p-10 text-center">
          <span className="material-symbols-outlined text-[40px] text-gray-400 mb-2">workspace_premium</span>
          <div className="text-base font-semibold text-gray-700 dark:text-gray-200 mb-1">Тиров пока нет</div>
          <div className="text-sm text-gray-500 mb-4">Создайте первый уровень — например, «bronze» с порогом 0 ₽</div>
          <button onClick={openCreate} className="bg-[#0097A7] hover:bg-[#00838F] text-white px-4 py-2 rounded-xl text-sm font-semibold">
            Создать тир
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {tiers.map(t => (
            <TierCard key={t.id} tier={t} onEdit={openEdit} onDelete={onDelete} />
          ))}
        </div>
      )}

      {/* Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <div className="text-lg font-bold text-gray-900 dark:text-white">
                {editing ? 'Редактирование тира' : 'Новый тир'}
              </div>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-700">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Название</label>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="bronze / silver / gold / platinum"
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 dark:text-white text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Порог (₽)</label>
                  <input
                    type="number" min="0"
                    value={form.threshold_rub}
                    onChange={e => setForm(f => ({ ...f, threshold_rub: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 dark:text-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Скидка / cashback (%)</label>
                  <input
                    type="number" min="0" max="100" step="0.5"
                    value={form.discount_percent}
                    onChange={e => setForm(f => ({ ...f, discount_percent: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 dark:text-white text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
                  Перки (JSON, необязательно)
                </label>
                <textarea
                  rows={3}
                  value={form.perks}
                  onChange={e => setForm(f => ({ ...f, perks: e.target.value }))}
                  placeholder='{"priority":true,"free_consult":1}'
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 dark:text-white text-sm font-mono"
                />
              </div>
            </div>
            <div className="px-5 py-3 bg-gray-50 dark:bg-gray-900/40 rounded-b-2xl flex justify-end gap-2">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg text-sm font-semibold border border-gray-200 dark:border-gray-700">
                Отмена
              </button>
              <button onClick={submit} disabled={saving || !form.name.trim()} className="bg-[#0097A7] hover:bg-[#00838F] disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-semibold">
                {saving ? 'Сохранение…' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
