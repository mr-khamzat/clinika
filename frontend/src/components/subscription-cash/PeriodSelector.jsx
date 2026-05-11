/**
 * ========================================
 * КОМПОНЕНТ: PeriodSelector — выбор периода активации (1/3/6/12 мес)
 * ========================================
 * Используется в ManagerSubscriptionCashSection (Step 3 wizard'а).
 *
 * Props:
 *   priceMonthly  — базовая цена тарифа за месяц
 *   value         — текущий выбранный период (1|3|6|12)
 *   onChange(months) — колбек
 *
 * Скидки:
 *   1м  →  0%
 *   3м  → -5%
 *   6м  → -10%
 *   12м → -15%
 *
 * Дизайн:
 *   • 4 большие toggle-кнопки (≥ 84px для тач-устройств)
 *   • Активная: золотисто-фиолетовый градиент
 *   • Большой нижний блок с расчётом суммы
 * ========================================
 */
import { useMemo } from 'react'

export const PERIOD_OPTIONS = [
  { months: 1,  discount: 0,    label: '1 месяц' },
  { months: 3,  discount: 0.05, label: '3 месяца' },
  { months: 6,  discount: 0.10, label: '6 месяцев' },
  { months: 12, discount: 0.15, label: '12 месяцев' },
]

export function calcPrice(priceMonthly, months) {
  const opt = PERIOD_OPTIONS.find(o => o.months === months) || PERIOD_OPTIONS[0]
  const gross = Math.round(Number(priceMonthly || 0) * months)
  const total = Math.round(gross * (1 - opt.discount))
  return { gross, total, discount: opt.discount }
}

export default function PeriodSelector({ priceMonthly = 0, value = 1, onChange }) {
  const calc = useMemo(() => calcPrice(priceMonthly, value), [priceMonthly, value])

  return (
    <div>
      {/* ─── 4 toggle-кнопки ─── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {PERIOD_OPTIONS.map(opt => {
          const active = value === opt.months
          const pct = Math.round(opt.discount * 100)
          return (
            <button
              key={opt.months}
              onClick={() => onChange?.(opt.months)}
              className="relative flex flex-col items-center justify-center transition-all hover:scale-[1.03] rounded-2xl"
              style={{
                minHeight: 96,
                background: active
                  ? 'linear-gradient(135deg, #F59E0B, #7C3AED)'
                  : 'var(--surface)',
                border: active ? '2px solid transparent' : '1.5px solid var(--border)',
                color: active ? '#fff' : 'var(--fg)',
                boxShadow: active
                  ? '0 10px 28px rgba(124,58,237,.32)'
                  : '0 2px 10px rgba(0,0,0,.04)',
                cursor: 'pointer',
                padding: 12,
              }}
            >
              {pct > 0 && (
                <div
                  className="absolute -top-2 right-2 px-2 py-0.5 rounded-full"
                  style={{
                    fontSize: 10.5, fontWeight: 800, letterSpacing: 0.4,
                    background: active ? 'rgba(255,255,255,.95)' : '#10B981',
                    color: active ? '#7C3AED' : '#fff',
                    boxShadow: '0 2px 8px rgba(16,185,129,.3)',
                  }}
                >
                  −{pct}%
                </div>
              )}
              <div
                className="font-extrabold"
                style={{
                  fontSize: 22, lineHeight: 1, letterSpacing: '-0.02em',
                }}
              >
                {opt.months}
              </div>
              <div
                style={{
                  fontSize: 11, marginTop: 4, fontWeight: 700,
                  opacity: active ? 0.95 : 0.7, letterSpacing: 0.3,
                  textTransform: 'uppercase',
                }}
              >
                {opt.months === 1 ? 'месяц' : opt.months < 5 ? 'месяца' : 'месяцев'}
              </div>
            </button>
          )
        })}
      </div>

      {/* ─── Расчёт суммы (большой блок) ─── */}
      <div
        className="rounded-3xl p-6"
        style={{
          background: 'linear-gradient(145deg, rgba(245,158,11,.06), rgba(124,58,237,.06))',
          border: '1.5px solid transparent',
          backgroundImage: `linear-gradient(var(--surface),var(--surface)), linear-gradient(135deg, #F59E0B, #7C3AED)`,
          backgroundOrigin: 'border-box',
          backgroundClip: 'padding-box, border-box',
          boxShadow: '0 8px 28px rgba(124,58,237,.12)',
        }}
      >
        <div className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--fg-3)' }}>
          Сумма к получению
        </div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <span
            className="font-extrabold"
            style={{
              fontSize: 44, lineHeight: 1, letterSpacing: '-0.025em',
              background: 'linear-gradient(135deg, #F59E0B, #7C3AED)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            {calc.total.toLocaleString('ru-RU')} ₽
          </span>
          {calc.discount > 0 && (
            <span
              style={{
                fontSize: 18, fontWeight: 600,
                color: 'var(--fg-3)',
                textDecoration: 'line-through',
                textDecorationThickness: 2,
              }}
            >
              {calc.gross.toLocaleString('ru-RU')} ₽
            </span>
          )}
          {calc.discount > 0 && (
            <span
              className="inline-flex items-center gap-1 px-3 py-1 rounded-full"
              style={{
                fontSize: 12, fontWeight: 700, letterSpacing: 0.3,
                background: '#10B981', color: '#fff',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>savings</span>
              Экономия {(calc.gross - calc.total).toLocaleString('ru-RU')} ₽
            </span>
          )}
        </div>
        <div className="text-xs mt-2" style={{ color: 'var(--fg-3)' }}>
          {Number(priceMonthly || 0).toLocaleString('ru-RU')} ₽/мес × {value} мес
          {calc.discount > 0 && ` (скидка ${Math.round(calc.discount * 100)}%)`}
        </div>
      </div>
    </div>
  )
}
