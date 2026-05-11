/**
 * ========================================
 * БЛОК: LoyaltyRewardsCatalog — каталог наград пациента
 * ========================================
 * Используется внутри PatientLoyaltySection (вкладка «Награды»).
 *
 * API:
 *   GET  /patient/loyalty/rewards
 *     → [{ id, name, description, points_cost, min_tier, stock, active }]
 *   POST /patient/loyalty/claim body { reward_id }
 *     → { claim_id, status: 'requested' }
 *     | 400 если недостаточно points или tier ниже min_tier
 *
 * Поведение:
 *   - Сетка карточек (1 col mobile, 2 cols sm, 3 cols lg)
 *   - Кнопка «Получить» — disabled если points < cost или tier ниже min_tier
 *   - Locked-карточки — серый + замок
 *   - Confirm modal перед POST /claim
 *   - Toast при успехе + onClaimed() для обновления баланса
 * ========================================
 */
import { useEffect, useState, useCallback } from 'react'
import axios from 'axios'
import { API_BASE } from '../../config'
import { useToast } from '../../design'
import TierBadge, { TIER_PALETTE } from './TierBadge'

// Порядок тиров — для сравнения «patient tier >= reward min_tier»
const TIER_ORDER = ['bronze', 'silver', 'gold', 'platinum']
function tierIndex(t) {
  if (!t) return -1
  return TIER_ORDER.indexOf(String(t).toLowerCase())
}

export default function LoyaltyRewardsCatalog({ sessionToken, points, tier, onClaimed }) {
  const [rewards, setRewards] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filterAvailable, setFilterAvailable] = useState(false)
  const [confirmReward, setConfirmReward] = useState(null)  // объект награды
  const [claiming, setClaiming] = useState(false)
  const { toast } = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await axios.get(`${API_BASE}/patient/loyalty/rewards`, {
        params: { t: sessionToken },
      })
      const arr = Array.isArray(r?.data) ? r.data : []
      setRewards(arr.filter(x => x.active !== false))
    } catch (e) {
      const status = e?.response?.status
      if (status === 402) setError('module_off')
      else setError('load')
    } finally {
      setLoading(false)
    }
  }, [sessionToken])

  useEffect(() => { load() }, [load])

  const myTierIdx = tierIndex(tier)

  const isAvailable = (r) => {
    const enoughPoints = Number(points || 0) >= Number(r.points_cost || 0)
    const enoughTier = !r.min_tier || tierIndex(r.min_tier) <= myTierIdx
    const inStock = r.stock == null || Number(r.stock) > 0
    return enoughPoints && enoughTier && inStock
  }

  const shown = filterAvailable ? rewards.filter(isAvailable) : rewards

  const handleClaim = async () => {
    if (!confirmReward) return
    setClaiming(true)
    try {
      await axios.post(`${API_BASE}/patient/loyalty/claim`, { reward_id: confirmReward.id }, {
        params: { t: sessionToken },
      })
      toast({ kind: 'success', text: `Запрос на «${confirmReward.name}» отправлен. Менеджер свяжется с вами.` })
      setConfirmReward(null)
      if (typeof onClaimed === 'function') onClaimed()
      load()
    } catch (e) {
      const detail = e?.response?.data?.detail || e?.response?.data?.message
      toast({ kind: 'error', text: detail || 'Не удалось получить награду. Проверьте баланс и уровень.' })
    } finally {
      setClaiming(false)
    }
  }

  if (error === 'module_off') {
    return (
      <div className="rounded-2xl p-6 text-center" style={{ background: '#fef3c7', border: '1px solid #fde68a' }}>
        <span className="material-symbols-outlined text-3xl mb-2 block" style={{ color: '#92400e' }}>lock</span>
        <p className="text-sm font-semibold" style={{ color: '#92400e' }}>
          Модуль программы лояльности не подключен.
        </p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {[0,1,2,3].map(i => (
          <div key={i} className="rounded-2xl h-48 animate-pulse" style={{ background: '#e5e7eb' }} />
        ))}
      </div>
    )
  }

  if (error === 'load') {
    return (
      <div className="rounded-xl p-4 text-center text-sm" style={{ background: '#fee2e2', color: '#991b1b' }}>
        Не удалось загрузить каталог наград.
      </div>
    )
  }

  if (!rewards.length) {
    return (
      <div className="rounded-2xl p-8 text-center" style={{ background: '#f9fafb', border: '1px dashed #e5e7eb' }}>
        <span className="material-symbols-outlined text-4xl mb-2 block" style={{ color: '#9ca3af' }}>card_giftcard</span>
        <p className="text-sm font-semibold text-gray-700">Награды пока не добавлены</p>
        <p className="text-xs text-gray-500 mt-1">Скоро здесь появится каталог</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Фильтр «Доступно по тиру» */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">Всего: {rewards.length}</p>
        <label className="inline-flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={filterAvailable}
            onChange={e => setFilterAvailable(e.target.checked)}
            className="w-4 h-4 rounded"
            style={{ accentColor: '#0097A7' }}
          />
          <span className="text-xs font-medium text-gray-700">Только доступные</span>
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {shown.map(r => {
          const available = isAvailable(r)
          const enoughTier = !r.min_tier || tierIndex(r.min_tier) <= myTierIdx
          const enoughPoints = Number(points || 0) >= Number(r.points_cost || 0)
          const inStock = r.stock == null || Number(r.stock) > 0
          return (
            <div
              key={r.id}
              className="rounded-2xl p-4 flex flex-col transition-all"
              style={{
                background: available ? '#fff' : '#f9fafb',
                border: `1px solid ${available ? '#e5e7eb' : '#e5e7eb'}`,
                opacity: available ? 1 : 0.7,
                position: 'relative',
              }}
            >
              {!available && (
                <span
                  className="absolute top-3 right-3 inline-grid place-items-center"
                  style={{
                    width: 28, height: 28, borderRadius: 999,
                    background: '#e5e7eb', color: '#6b7280',
                  }}
                  title="Недоступно"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>lock</span>
                </span>
              )}

              <div className="flex items-start gap-2 mb-2">
                <span
                  className="inline-grid place-items-center flex-shrink-0"
                  style={{
                    width: 36, height: 36, borderRadius: 10,
                    background: '#0097A715', color: '#0097A7',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 20, fontVariationSettings: "'FILL' 1" }}>
                    redeem
                  </span>
                </span>
                <div className="flex-1 min-w-0 pr-7">
                  <p className="text-sm font-bold text-gray-900 leading-tight">{r.name}</p>
                  {r.min_tier && (
                    <div className="mt-1">
                      <TierBadge tier={r.min_tier} size="sm" />
                    </div>
                  )}
                </div>
              </div>

              {r.description && (
                <p className="text-xs text-gray-600 leading-snug mb-3 flex-1">{r.description}</p>
              )}

              <div className="mt-auto">
                <div className="flex items-baseline justify-between mb-2">
                  <span className="text-2xl font-extrabold" style={{ color: '#0097A7' }}>
                    {Number(r.points_cost).toLocaleString('ru-RU')}
                  </span>
                  <span className="text-xs text-gray-500">баллов</span>
                </div>

                {r.stock != null && (
                  <p className="text-[11px] mb-2" style={{ color: inStock ? '#9ca3af' : '#dc2626' }}>
                    {inStock ? `Осталось: ${r.stock}` : 'Закончились'}
                  </p>
                )}

                <button
                  onClick={() => setConfirmReward(r)}
                  disabled={!available}
                  className="w-full rounded-xl py-2.5 text-sm font-bold transition-all active:scale-[0.98] disabled:cursor-not-allowed"
                  style={{
                    background: available ? '#0097A7' : '#e5e7eb',
                    color: available ? '#fff' : '#9ca3af',
                  }}
                >
                  {!inStock ? 'Нет в наличии' :
                    !enoughTier ? `Нужен ${TIER_PALETTE[String(r.min_tier).toLowerCase()]?.label || r.min_tier}` :
                    !enoughPoints ? `Не хватает ${Number(r.points_cost) - Number(points || 0)}` :
                    'Получить'}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Confirm modal */}
      {confirmReward && (
        <>
          <div
            className="fixed inset-0 z-50"
            style={{ background: 'rgba(0,0,0,0.45)' }}
            onClick={() => !claiming && setConfirmReward(null)}
          />
          <div
            className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[92%] max-w-md rounded-3xl p-6"
            style={{ background: '#fff', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}
          >
            <div className="text-center mb-4">
              <span
                className="inline-grid place-items-center mx-auto mb-3"
                style={{
                  width: 64, height: 64, borderRadius: 999,
                  background: '#0097A715', color: '#0097A7',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 36, fontVariationSettings: "'FILL' 1" }}>
                  redeem
                </span>
              </span>
              <h3 className="text-lg font-extrabold text-gray-900">Получить «{confirmReward.name}»?</h3>
              <p className="text-sm text-gray-600 mt-1">
                Будет списано <strong>{Number(confirmReward.points_cost).toLocaleString('ru-RU')} баллов</strong>.
                <br />Менеджер свяжется с вами для оформления.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmReward(null)}
                disabled={claiming}
                className="flex-1 rounded-xl py-3 text-sm font-bold disabled:opacity-60"
                style={{ background: '#f3f4f6', color: '#374151' }}
              >
                Отмена
              </button>
              <button
                onClick={handleClaim}
                disabled={claiming}
                className="flex-1 rounded-xl py-3 text-sm font-bold disabled:opacity-60"
                style={{ background: '#0097A7', color: '#fff' }}
              >
                {claiming ? 'Отправка…' : 'Подтвердить'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
