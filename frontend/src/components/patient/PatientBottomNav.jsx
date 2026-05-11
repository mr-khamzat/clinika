/**
 * ========================================
 * БЛОК: PatientBottomNav — 5-табовая навигация Apple HIG
 * ========================================
 * Используется ИСКЛЮЧИТЕЛЬНО в PatientCabinet (новый редизайн).
 * Не путать с компонентом /components/BottomNav.jsx — тот для роли
 * partner_doctor/staff в основном приложении.
 *
 * Apple HIG mobile (iPhone SE 375×667):
 *   • 5 табов максимум — больше нечитаемо на 375px
 *   • Иконка 24px, label 11px
 *   • Touch target ≥ 44×44 (Apple HIG минимум)
 *   • Высота 56px + safe-area-inset-bottom
 *   • Активный — fill+цвет brand, неактивный — серый
 *   • Бейдж непрочитанных на иконке (badge)
 *
 * props:
 *   items: [{ key, icon, label, badge? }]
 *   value: текущий выбранный key
 *   onChange: (key) => void
 * ========================================
 */
export default function PatientBottomNav({ items, value, onChange }) {
  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40"
      style={{
        background: 'rgba(255,255,255,.96)',
        WebkitBackdropFilter: 'blur(20px)',
        backdropFilter: 'blur(20px)',
        borderTop: '1px solid rgba(0,0,0,.06)',
        paddingBottom: 'env(safe-area-inset-bottom,0px)',
        boxShadow: '0 -2px 12px rgba(0,0,0,.04)',
      }}
    >
      <nav
        role="tablist"
        aria-label="Главная навигация"
        className="max-w-lg mx-auto flex items-stretch justify-around"
        style={{ height: 56 }}
      >
        {items.map((t) => {
          const active = t.key === value
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={active}
              onClick={() => onChange(t.key)}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 transition-all relative"
              style={{
                minWidth: 44,
                minHeight: 44,
                color: active ? '#1565C0' : '#9CA3AF',
              }}
            >
              <span
                className="material-symbols-outlined transition-all"
                style={{
                  fontSize: 24,
                  lineHeight: '24px',
                  fontVariationSettings: active ? "'FILL' 1" : "'FILL' 0",
                  transform: active ? 'scale(1.05)' : 'scale(1)',
                }}
              >
                {t.icon}
              </span>
              <span
                className="font-semibold"
                style={{ fontSize: 11, lineHeight: '12px' }}
              >
                {t.label}
              </span>
              {t.badge ? (
                <span
                  className="absolute min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-bold flex items-center justify-center"
                  style={{
                    top: 6,
                    right: 'calc(50% - 22px)',
                    background: '#EF4444',
                    color: '#fff',
                    border: '1.5px solid #fff',
                  }}
                >
                  {t.badge > 99 ? '99+' : t.badge}
                </span>
              ) : null}
            </button>
          )
        })}
      </nav>
    </div>
  )
}
