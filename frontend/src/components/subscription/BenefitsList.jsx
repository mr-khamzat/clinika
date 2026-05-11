/**
 * ========================================
 * БЛОК: BenefitsList — список текущих привилегий подписки (Глава 9)
 * ========================================
 * Принимает benefits-объект с /patient/subscription/benefits
 * и рендерит сетку иконка+название+статус.
 *
 * Props:
 *   benefits — {chat_unlimited, appointment_discount_pct, monthly_spending_report, priority_booking, ...}
 * ========================================
 */

const ITEMS = [
  { key: 'chat_unlimited',           icon: 'chat_bubble',         label: 'Безлимит чата с клиникой',  good: v => v === true,                 fmt: () => 'включён' },
  { key: 'appointment_discount_pct', icon: 'discount',            label: 'Скидка на приёмы',          good: v => Number(v) > 0,              fmt: v => `${v}%` },
  { key: 'monthly_spending_report',  icon: 'analytics',           label: 'Ежемесячный расходник',     good: v => v === true,                 fmt: () => 'каждый месяц' },
  { key: 'priority_booking',         icon: 'bolt',                label: 'Приоритет записи',          good: v => v === true,                 fmt: () => 'первая очередь' },
  { key: 'family_slots',             icon: 'diversity_3',         label: 'Семейные слоты',            good: v => Number(v) > 0,              fmt: v => `${v} чел.` },
  { key: 'free_telemed',             icon: 'video_camera_front',  label: 'Бесплатная телемедицина',   good: v => v === true || Number(v) > 0, fmt: v => v === true ? 'без ограничений' : `${v}/мес` },
]

export default function BenefitsList({ benefits = {} }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {ITEMS.map(item => {
        const val = benefits[item.key]
        const isOn = item.good(val)
        if (!isOn && val === undefined) return null
        return (
          <div
            key={item.key}
            className="flex items-center gap-3 rounded-2xl p-3.5"
            style={{
              background: isOn ? 'rgba(16,185,129,.06)' : 'rgba(148,163,184,.08)',
              border: isOn ? '1px solid rgba(16,185,129,.2)' : '1px solid rgba(148,163,184,.2)',
            }}
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: isOn ? 'rgba(16,185,129,.15)' : 'rgba(148,163,184,.2)' }}
            >
              <span
                className="material-symbols-outlined text-xl"
                style={{ color: isOn ? '#059669' : '#94A3B8', fontVariationSettings: "'FILL' 1" }}
              >
                {item.icon}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold leading-tight" style={{ color: '#0F172A' }}>{item.label}</p>
              <p className="text-xs mt-0.5" style={{ color: isOn ? '#059669' : '#94A3B8' }}>
                {isOn ? item.fmt(val) : 'недоступно'}
              </p>
            </div>
            {isOn && (
              <span
                className="material-symbols-outlined text-base flex-shrink-0"
                style={{ color: '#10B981', fontVariationSettings: "'FILL' 1" }}
              >
                check_circle
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
