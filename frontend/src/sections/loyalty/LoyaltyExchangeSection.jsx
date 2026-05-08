/**
 * LoyaltyExchangeSection — каталог наград + интерфейс обмена баллов.
 *
 * Левая часть: CRUD каталога (награды).
 * Правая часть: блок «Обмен» — ввод телефона пациента и кнопка «Обменять» для
 * выбранной награды (POST /loyalty/exchange).
 *
 * API:
 *   GET    /loyalty/rewards
 *   POST   /loyalty/rewards
 *   PATCH  /loyalty/rewards/{id}
 *   DELETE /loyalty/rewards/{id}
 *   POST   /loyalty/exchange  { phone, reward_id }
 *   GET    /loyalty/account/{phone}  — для проверки баланса
 */
import { useState, useEffect, useCallback } from 'react'
import api from '../../api'
import { useToast } from '../../design'

const apiFetch = (m, url, _t, d) => api({ method: m, url, data: d })

const REWARD_TYPES = [
  { id: 'free_service',     label: 'Бесплатная услуга',  icon: 'medical_services' },
  { id: 'service_discount', label: 'Скидка на услугу',   icon: 'percent' },
  { id: 'gift',             label: 'Подарок',            icon: 'redeem' },
]
const TYPE_LABEL = Object.fromEntries(REWARD_TYPES.map(t => [t.id, t.label]))
const TYPE_ICON  = Object.fromEntries(REWARD_TYPES.map(t => [t.id, t.icon]))

const EMPTY_FORM = {
  name: '',
  description: '',
  reward_type: 'free_service',
  cost_points: 100,
  discount_percent: '',
  service_ref: '',
  is_active: true,
  icon: '',
  sort_order: 0,
}

// ── Карточка награды ─────────────────────────────────────────────────────────
function RewardCard({ reward, onPick, onEdit, onDelete, picked }) {
  const icon = reward.icon || TYPE_ICON[reward.reward_type] || 'redeem'
  return (
    <div
      className={`bg-white dark:bg-gray-800 rounded-2xl border p-4 transition-all ${
        picked ? 'border-[#0097A7] shadow-md' : 'border-gray-100 dark:border-gray-700 hover:shadow-sm'
      } ${reward.is_active ? '' : 'opacity-60'}`}
    >
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-xl bg-[#e0f7fa] dark:bg-cyan-900/30 text-[#0097A7] flex items-center justify-center shrink-0">
          <span className="material-symbols-outlined text-[24px]" style={{ fontVariationSettings: "'FILL' 1" }}>
            {icon}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-gray-900 dark:text-white">{reward.name}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">{TYPE_LABEL[reward.reward_type] || reward.reward_type}</div>
          {reward.description && <div className="text-xs text-gray-600 dark:text-gray-300 mt-1 line-clamp-2">{reward.description}</div>}
          {reward.reward_type === 'service_discount' && reward.discount_percent != null && (
            <div className="text-xs text-emerald-600 mt-1">−{reward.discount_percent}%</div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="text-base font-extrabold text-[#0097A7]">{reward.cost_points} б.</div>
          {!reward.is_active && <div className="text-[10px] text-amber-600 mt-0.5">отключено</div>}
        </div>
      </div>

      <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
        <button
          onClick={() => onPick(reward)}
          disabled={!reward.is_active}
          className="flex-1 bg-[#0097A7] hover:bg-[#00838F] disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg text-xs font-semibold"
        >
          {picked ? 'Выбрано ✓' : 'Выбрать для обмена'}
        </button>
        <button onClick={() => onEdit(reward)} className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 dark:border-gray-700">
          <span className="material-symbols-outlined text-[16px]">edit</span>
        </button>
        <button onClick={() => onDelete(reward)} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-red-500 border border-red-200">
          <span className="material-symbols-outlined text-[16px]">delete</span>
        </button>
      </div>
    </div>
  )
}

// ── Главный компонент ────────────────────────────────────────────────────────
export default function LoyaltyExchangeSection({ token }) {
  const [rewards, setRewards] = useState(null)
  const [err, setErr] = useState('')
  const [needPay, setNeedPay] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  // Состояние «обменника»
  const [picked, setPicked] = useState(null)
  const [phone, setPhone] = useState('')
  const [account, setAccount] = useState(null)
  const [accLoading, setAccLoading] = useState(false)
  const [exchanging, setExchanging] = useState(false)

  const { toast } = useToast()

  const load = useCallback(async () => {
    setErr(''); setNeedPay(false)
    try {
      const r = await apiFetch('get', '/loyalty/rewards', token)
      setRewards(Array.isArray(r.data) ? r.data : [])
    } catch (e) {
      const code = e?.response?.status
      if (code === 402) setNeedPay(true)
      else setErr(e?.response?.data?.detail || 'Ошибка загрузки каталога')
      setRewards([])
    }
  }, [token])

  useEffect(() => { load() }, [load])

  const checkPhone = async () => {
    if (!phone.trim()) return
    setAccLoading(true)
    try {
      const r = await apiFetch('get', `/loyalty/account/${encodeURIComponent(phone.trim())}`, token)
      setAccount(r.data)
    } catch (e) {
      setAccount(null)
      toast({ kind: 'error', text: e?.response?.data?.detail || 'Ошибка получения баланса' })
    } finally { setAccLoading(false) }
  }

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setShowForm(true) }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      name: r.name,
      description: r.description || '',
      reward_type: r.reward_type,
      cost_points: r.cost_points,
      discount_percent: r.discount_percent ?? '',
      service_ref: r.service_ref || '',
      is_active: !!r.is_active,
      icon: r.icon || '',
      sort_order: r.sort_order || 0,
    })
    setShowForm(true)
  }

  const submit = async () => {
    setSaving(true)
    try {
      const body = {
        name: form.name.trim(),
        description: form.description?.trim() || null,
        reward_type: form.reward_type,
        cost_points: Number(form.cost_points) || 0,
        discount_percent: form.discount_percent === '' ? null : Number(form.discount_percent),
        service_ref: form.service_ref?.trim() || null,
        is_active: !!form.is_active,
        icon: form.icon?.trim() || null,
        sort_order: Number(form.sort_order) || 0,
      }
      if (editing) {
        await apiFetch('patch', `/loyalty/rewards/${editing.id}`, token, body)
        toast({ kind: 'success', text: 'Награда обновлена' })
      } else {
        await apiFetch('post', '/loyalty/rewards', token, body)
        toast({ kind: 'success', text: 'Награда создана' })
      }
      setShowForm(false)
      await load()
    } catch (e) {
      toast({ kind: 'error', text: e?.response?.data?.detail || 'Ошибка сохранения' })
    } finally { setSaving(false) }
  }

  const onDelete = async (r) => {
    if (!confirm(`Удалить награду «${r.name}»?`)) return
    try {
      await apiFetch('delete', `/loyalty/rewards/${r.id}`, token)
      toast({ kind: 'success', text: 'Награда удалена' })
      if (picked?.id === r.id) setPicked(null)
      await load()
    } catch (e) {
      toast({ kind: 'error', text: e?.response?.data?.detail || 'Ошибка удаления' })
    }
  }

  const doExchange = async () => {
    if (!picked || !phone.trim()) return
    if (!account || account.points_balance < picked.cost_points) {
      toast({ kind: 'error', text: 'Недостаточно баллов на счёте пациента' })
      return
    }
    if (!confirm(`Обменять ${picked.cost_points} баллов пациента ${phone.trim()} на «${picked.name}»?`)) return
    setExchanging(true)
    try {
      const r = await apiFetch('post', '/loyalty/exchange', token, { phone: phone.trim(), reward_id: picked.id })
      setAccount(r.data)
      toast({ kind: 'success', text: `Обмен выполнен. Новый баланс: ${r.data.points_balance} б.` })
      setPicked(null)
    } catch (e) {
      toast({ kind: 'error', text: e?.response?.data?.detail || 'Ошибка обмена' })
    } finally { setExchanging(false) }
  }

  if (needPay) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
        Подключите модуль <code>loyalty_pro</code> в каталоге.
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      {/* Левая колонка: каталог */}
      <div className="lg:col-span-2 space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-500">{rewards === null ? 'Загрузка…' : `Наград в каталоге: ${rewards.length}`}</div>
          <button onClick={openCreate} className="bg-[#0097A7] hover:bg-[#00838F] text-white px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[18px]">add</span>
            Новая награда
          </button>
        </div>

        {err && <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-600 text-sm">{err}</div>}

        {rewards === null ? (
          <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-[#0097A7] border-t-transparent rounded-full animate-spin" /></div>
        ) : rewards.length === 0 ? (
          <div className="bg-gray-50 dark:bg-gray-800/50 border border-dashed border-gray-200 dark:border-gray-700 rounded-2xl p-10 text-center">
            <span className="material-symbols-outlined text-[40px] text-gray-400 mb-2">redeem</span>
            <div className="text-base font-semibold text-gray-700 dark:text-gray-200 mb-1">Каталог пуст</div>
            <div className="text-sm text-gray-500 mb-4">Добавьте первую награду — например «Бесплатная консультация» за 500 баллов.</div>
            <button onClick={openCreate} className="bg-[#0097A7] hover:bg-[#00838F] text-white px-4 py-2 rounded-xl text-sm font-semibold">
              Создать награду
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {rewards.map(r => (
              <RewardCard
                key={r.id}
                reward={r}
                picked={picked?.id === r.id}
                onPick={setPicked}
                onEdit={openEdit}
                onDelete={onDelete}
              />
            ))}
          </div>
        )}
      </div>

      {/* Правая колонка: обменник */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 h-fit sticky top-4">
        <div className="text-base font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
          <span className="material-symbols-outlined text-[#0097A7]" style={{ fontVariationSettings: "'FILL' 1" }}>
            swap_horiz
          </span>
          Обмен баллов
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Телефон пациента</label>
            <div className="flex gap-2">
              <input value={phone} onChange={e => setPhone(e.target.value)} onKeyDown={e => e.key === 'Enter' && checkPhone()}
                placeholder="+7..." className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 text-sm" />
              <button onClick={checkPhone} disabled={accLoading || !phone.trim()} className="px-3 py-2 rounded-lg text-xs font-semibold border border-gray-200 dark:border-gray-700 disabled:opacity-50">
                {accLoading ? '…' : 'Проверить'}
              </button>
            </div>
          </div>

          {account && (
            <div className="bg-cyan-50 dark:bg-cyan-900/20 border border-cyan-100 dark:border-cyan-800 rounded-xl p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-gray-600 dark:text-gray-300">Баланс:</span>
                <span className="font-bold text-[#0097A7] text-lg">{account.points_balance} б.</span>
              </div>
              <div className="flex items-center justify-between text-xs mt-1">
                <span className="text-gray-500">Тир:</span>
                <span className="capitalize font-semibold text-gray-700 dark:text-gray-200">{account.tier}</span>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Выбранная награда</label>
            {picked ? (
              <div className="bg-gray-50 dark:bg-gray-900/40 rounded-xl p-3">
                <div className="text-sm font-bold text-gray-900 dark:text-white">{picked.name}</div>
                <div className="text-xs text-gray-500">{TYPE_LABEL[picked.reward_type] || picked.reward_type}</div>
                <div className="text-sm text-[#0097A7] font-bold mt-1">{picked.cost_points} баллов</div>
              </div>
            ) : (
              <div className="text-xs text-gray-400 italic py-2">Кликните «Выбрать для обмена» в каталоге слева</div>
            )}
          </div>

          <button
            onClick={doExchange}
            disabled={exchanging || !picked || !account || account.points_balance < (picked?.cost_points || 0)}
            className="w-full bg-[#0097A7] hover:bg-[#00838F] disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-xl text-sm font-semibold"
          >
            {exchanging ? 'Обмен…' : 'Обменять'}
          </button>

          {picked && account && account.points_balance < picked.cost_points && (
            <div className="text-xs text-red-500 text-center">
              Не хватает {picked.cost_points - account.points_balance} баллов
            </div>
          )}
        </div>
      </div>

      {/* Modal редактирования награды */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <div className="text-lg font-bold">{editing ? 'Редактирование награды' : 'Новая награда'}</div>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-700">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Название</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Описание</label>
                <textarea rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Тип</label>
                  <select value={form.reward_type} onChange={e => setForm(f => ({ ...f, reward_type: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 text-sm">
                    {REWARD_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Стоимость (баллы)</label>
                  <input type="number" min="1" value={form.cost_points} onChange={e => setForm(f => ({ ...f, cost_points: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 text-sm" />
                </div>
              </div>
              {form.reward_type === 'service_discount' && (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">% скидки</label>
                  <input type="number" min="0" max="100" step="0.5" value={form.discount_percent} onChange={e => setForm(f => ({ ...f, discount_percent: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 text-sm" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Иконка (material-symbols)</label>
                  <input value={form.icon} onChange={e => setForm(f => ({ ...f, icon: e.target.value }))}
                    placeholder="redeem / cake / medical_services"
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Сортировка</label>
                  <input type="number" value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Ссылка на услугу (id или название)</label>
                <input value={form.service_ref} onChange={e => setForm(f => ({ ...f, service_ref: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 text-sm" />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                Активная (доступна для обмена)
              </label>
            </div>
            <div className="px-5 py-3 bg-gray-50 dark:bg-gray-900/40 rounded-b-2xl flex justify-end gap-2">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg text-sm font-semibold border border-gray-200 dark:border-gray-700">Отмена</button>
              <button onClick={submit} disabled={saving || !form.name.trim() || !Number(form.cost_points)} className="bg-[#0097A7] hover:bg-[#00838F] disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-semibold">
                {saving ? 'Сохранение…' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
