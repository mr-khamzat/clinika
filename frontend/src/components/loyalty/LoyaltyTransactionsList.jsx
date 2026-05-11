/**
 * ========================================
 * БЛОК: LoyaltyTransactionsList — список транзакций программы лояльности пациента
 * ========================================
 * Используется внутри PatientLoyaltySection (вкладка «История»).
 *
 * API:
 *   GET /patient/loyalty/transactions?limit=50&offset=0
 *     → { items: [{ delta, reason, note, appointment_id?, referral_id?, created_at }], total }
 *
 * Поведение:
 *   - Бесконечная подгрузка: кнопка «Показать ещё» (по 20)
 *   - Иконка по reason + локализация причины на русский
 *   - Бейдж справа: +N (зелёный) или -N (красный)
 *   - Пусто → EmptyState
 * ========================================
 */
import { useEffect, useState, useCallback } from 'react'
import axios from 'axios'
import { API_BASE } from '../../config'

const PAGE = 20

// ── Локализация причин начисления/списания ────────────────────────────────────
const REASON_MAP = {
  appointment_completed:  { label: 'Завершён приём',         icon: 'event_available',  color: '#10b981' },
  referral_completed:     { label: 'Подтверждено направление', icon: 'assignment_turned_in', color: '#10b981' },
  signup_bonus:           { label: 'Бонус за регистрацию',    icon: 'card_giftcard',    color: '#0097A7' },
  birthday_bonus:         { label: 'Бонус ко дню рождения',   icon: 'cake',             color: '#f59e0b' },
  review_bonus:           { label: 'Бонус за отзыв',          icon: 'rate_review',      color: '#0097A7' },
  invite_friend:          { label: 'Приглашение друга',       icon: 'group_add',        color: '#0097A7' },
  manual_adjust:          { label: 'Ручная корректировка',    icon: 'tune',             color: '#6366f1' },
  reward_claim:           { label: 'Получение награды',       icon: 'redeem',           color: '#dc2626' },
  reward_cancelled:       { label: 'Отмена награды (возврат)', icon: 'undo',             color: '#10b981' },
  expired:                { label: 'Истёк срок действия',     icon: 'schedule',         color: '#9ca3af' },
  tier_upgrade:           { label: 'Повышение уровня',        icon: 'trending_up',      color: '#10b981' },
}

function reasonInfo(reason) {
  return REASON_MAP[reason] || { label: reason || 'Операция', icon: 'history', color: '#6b7280' }
}

function formatDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('ru-RU', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return String(iso)
  }
}

export default function LoyaltyTransactionsList({ sessionToken }) {
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async (off, append = false) => {
    if (append) setLoadingMore(true)
    else setLoading(true)
    setError(null)
    try {
      const r = await axios.get(`${API_BASE}/patient/loyalty/transactions`, {
        params: { t: sessionToken, limit: PAGE, offset: off },
      })
      const data = r?.data || {}
      const arr = Array.isArray(data.items) ? data.items : []
      setItems(prev => append ? [...prev, ...arr] : arr)
      setTotal(Number(data.total || arr.length))
    } catch (e) {
      const status = e?.response?.status
      if (status === 402) setError('module_off')
      else setError('load')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [sessionToken])

  useEffect(() => { load(0, false) }, [load])

  const hasMore = items.length < total

  if (error === 'module_off') {
    return (
      <div className="rounded-2xl p-6 text-center" style={{ background: '#fef3c7', border: '1px solid #fde68a' }}>
        <span className="material-symbols-outlined text-3xl mb-2 block" style={{ color: '#92400e' }}>lock</span>
        <p className="text-sm font-semibold" style={{ color: '#92400e' }}>
          Модуль программы лояльности не подключен.
        </p>
        <p className="text-xs mt-1" style={{ color: '#92400e' }}>
          Свяжитесь с менеджером клиники.
        </p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="space-y-2">
        {[0,1,2,3].map(i => (
          <div key={i} className="rounded-xl h-14 animate-pulse" style={{ background: '#e5e7eb' }} />
        ))}
      </div>
    )
  }

  if (error === 'load') {
    return (
      <div className="rounded-xl p-4 text-center text-sm" style={{ background: '#fee2e2', color: '#991b1b' }}>
        Не удалось загрузить историю. Попробуйте позже.
      </div>
    )
  }

  if (!items.length) {
    return (
      <div className="rounded-2xl p-8 text-center" style={{ background: '#f9fafb', border: '1px dashed #e5e7eb' }}>
        <span className="material-symbols-outlined text-4xl mb-2 block" style={{ color: '#9ca3af' }}>receipt_long</span>
        <p className="text-sm font-semibold text-gray-700">История пуста</p>
        <p className="text-xs text-gray-500 mt-1">Начисления появятся после первого визита</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {items.map((t, idx) => {
        const info = reasonInfo(t.reason)
        const positive = Number(t.delta) >= 0
        return (
          <div
            key={`${t.created_at}-${idx}`}
            className="flex items-center gap-3 rounded-2xl p-3"
            style={{ background: '#fff', border: '1px solid #f3f4f6' }}
          >
            <span
              className="inline-grid place-items-center flex-shrink-0"
              style={{
                width: 40, height: 40, borderRadius: 12,
                background: `${info.color}15`, color: info.color,
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 22, fontVariationSettings: "'FILL' 1" }}>
                {info.icon}
              </span>
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">{info.label}</p>
              {t.note && <p className="text-xs text-gray-500 truncate">{t.note}</p>}
              <p className="text-[11px] text-gray-400 mt-0.5">{formatDate(t.created_at)}</p>
            </div>
            <span
              className="flex-shrink-0 text-sm font-extrabold px-2.5 py-1 rounded-full"
              style={{
                background: positive ? '#dcfce7' : '#fee2e2',
                color: positive ? '#15803d' : '#991b1b',
              }}
            >
              {positive ? '+' : ''}{Number(t.delta).toLocaleString('ru-RU')}
            </span>
          </div>
        )
      })}

      {hasMore && (
        <button
          onClick={() => {
            const next = offset + PAGE
            setOffset(next)
            load(next, true)
          }}
          disabled={loadingMore}
          className="w-full rounded-2xl py-3 text-sm font-semibold transition-all active:scale-[0.99] disabled:opacity-60"
          style={{ background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb' }}
        >
          {loadingMore ? 'Загружаем…' : `Показать ещё (${total - items.length})`}
        </button>
      )}
    </div>
  )
}
