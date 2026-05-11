/**
 * ========================================
 * БЛОК: PlanComparisonTable — таблица сравнения тарифов подписки (Глава 9 v2)
 * ========================================
 * Рендерится под карточками планов на desktop (md+).
 * На mobile прячется (родитель должен накрутить hidden md:block).
 *
 * Источник данных:
 *   1) plans — массив с features-объектом (или summary_benefits)
 *   2) ROWS — фиксированный набор строк для сравнения
 *
 * Колонки берём из props.plans (только не-free, чтобы не перегружать).
 *
 * Props:
 *   plans     — [{key, name, price_monthly, features?:{}, summary_benefits?:[]}]
 *   recommend — string — key плана для подсветки (рекомендуемый)
 *   billing   — 'monthly' | 'annual'
 *   onSelect  — (planKey) => void — CTA в footer колонки
 *
 * Логика разрешения значения для ячейки:
 *   1) plan.features[row.key]      — explicit
 *   2) plan.summary_benefits.find(b => b.detail_key === row.detail_key)?.value
 *   3) FALLBACK_MATRIX[plan.key]?.[row.key]
 *   4) '—'
 * ========================================
 */

const ROWS = [
  { key: 'chat',         label: 'Чат с врачом',           icon: 'chat_bubble',         detail_key: null },
  { key: 'discount',     label: 'Скидка на приёмы',       icon: 'discount',            detail_key: null },
  { key: 'lab',          label: 'Анализы со скидкой',     icon: 'science',             detail_key: 'lab' },
  { key: 'consult',      label: 'Консультации врачей',    icon: 'stethoscope',         detail_key: 'consult' },
  { key: 'diagnostic',   label: 'Диагностика',            icon: 'monitor_heart',       detail_key: 'diagnostic' },
  { key: 'supply',       label: 'Расходник ежемесячный',  icon: 'inventory_2',         detail_key: 'supply' },
  { key: 'priority',     label: 'Приоритет записи',       icon: 'bolt',                detail_key: null },
  { key: 'family',       label: 'Семейный аккаунт',       icon: 'diversity_3',         detail_key: null },
  { key: 'telemed',      label: 'Телемедицина',           icon: 'video_camera_front',  detail_key: null },
]

const FALLBACK_MATRIX = {
  health_plus: {
    chat: 'безлимит',
    discount: '10%',
    lab: '20 / мес · −20%',
    consult: '4 / мес',
    diagnostic: '−15%',
    supply: true,
    priority: true,
    family: false,
    telemed: '2 / мес',
  },
  family_plus: {
    chat: 'безлимит',
    discount: '15%',
    lab: '40 / мес · −25%',
    consult: '8 / мес',
    diagnostic: '−20%',
    supply: true,
    priority: true,
    family: 'до 5 чел',
    telemed: 'безлимит',
  },
  pro: {
    chat: 'безлимит',
    discount: '20%',
    lab: '100 / мес · −30%',
    consult: 'безлимит',
    diagnostic: '−25%',
    supply: true,
    priority: true,
    family: 'до 8 чел',
    telemed: 'безлимит',
  },
}

const PALETTES = {
  health_plus: { from: '#F59E0B', to: '#7C3AED', accent: '#A855F7' },
  family_plus: { from: '#0EA5E9', to: '#6366F1', accent: '#4F46E5' },
  pro:         { from: '#9333EA', to: '#4338CA', accent: '#7C3AED' },
}

function resolveCell(plan, row) {
  // explicit features
  if (plan.features && plan.features[row.key] !== undefined) return plan.features[row.key]
  // summary_benefits via detail_key
  if (row.detail_key && Array.isArray(plan.summary_benefits)) {
    const m = plan.summary_benefits.find(b => b.detail_key === row.detail_key)
    if (m?.value) return m.value
  }
  // fallback matrix
  const fb = FALLBACK_MATRIX[plan.key]
  if (fb && fb[row.key] !== undefined) return fb[row.key]
  return null
}

function Cell({ value, accent }) {
  if (value === true) {
    return (
      <span
        className="inline-flex items-center justify-center w-7 h-7 rounded-full"
        style={{ background: '#DCFCE7' }}
      >
        <span className="material-symbols-outlined text-[18px]" style={{ color: '#15803D', fontVariationSettings: "'FILL' 1" }}>check</span>
      </span>
    )
  }
  if (value === false || value === null || value === undefined || value === '—') {
    return <span className="text-[14px] font-bold" style={{ color: '#CBD5E1' }}>—</span>
  }
  return (
    <span className="text-[13px] font-bold" style={{ color: accent || '#0F172A' }}>{value}</span>
  )
}

export default function PlanComparisonTable({ plans = [], recommend = 'health_plus', billing = 'monthly', onSelect }) {
  // Берём только не-free планы; сортируем по price_monthly
  const cols = plans
    .filter(p => Number(p.price_monthly || 0) > 0)
    .slice()
    .sort((a, b) => Number(a.price_monthly || 0) - Number(b.price_monthly || 0))

  if (cols.length === 0) return null

  return (
    <div className="rounded-3xl bg-white overflow-hidden" style={{ border: '1px solid rgba(15,23,42,.06)', boxShadow: '0 6px 22px rgba(15,23,42,.04)' }}>
      <div className="px-5 sm:px-6 pt-5 pb-3">
        <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#94A3B8' }}>Сравнение</p>
        <h3 className="text-xl font-extrabold" style={{ color: '#0F172A' }}>Что входит в каждый тариф</h3>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full" style={{ minWidth: 600 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #E2E8F0' }}>
              <th className="text-left px-6 py-3 text-[11px] font-bold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
                Привилегия
              </th>
              {cols.map(p => {
                const palette = PALETTES[p.key] || PALETTES.health_plus
                const isRec = p.key === recommend
                return (
                  <th key={p.key} className="px-4 py-3 text-center align-bottom relative" style={{ minWidth: 140 }}>
                    {isRec && (
                      <div
                        className="absolute top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full text-[9px] font-extrabold text-white uppercase tracking-wider"
                        style={{ background: `linear-gradient(135deg, ${palette.from}, ${palette.to})` }}
                      >
                        ⭐ Рекомендуем
                      </div>
                    )}
                    <div className={isRec ? 'pt-4' : ''}>
                      <p className="text-[14px] font-extrabold" style={{ color: '#0F172A' }}>
                        {p.title || p.name}
                      </p>
                      <p className="text-[12px] font-bold mt-0.5" style={{ color: palette.accent }}>
                        {Number(p.price_monthly || 0).toLocaleString('ru-RU')} ₽
                        <span className="font-medium" style={{ color: '#94A3B8' }}> / мес</span>
                      </p>
                    </div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row, ri) => (
              <tr key={row.key} style={{ borderBottom: ri === ROWS.length - 1 ? 'none' : '1px solid #F1F5F9' }}>
                <td className="px-6 py-3">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px]" style={{ color: '#64748B' }}>{row.icon}</span>
                    <span className="text-[13px] font-semibold" style={{ color: '#334155' }}>{row.label}</span>
                  </div>
                </td>
                {cols.map(p => {
                  const palette = PALETTES[p.key] || PALETTES.health_plus
                  const isRec = p.key === recommend
                  return (
                    <td
                      key={p.key}
                      className="px-4 py-3 text-center"
                      style={{ background: isRec ? `${palette.accent}07` : 'transparent' }}
                    >
                      <Cell value={resolveCell(p, row)} accent={palette.accent} />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
          {/* Footer CTA */}
          <tfoot>
            <tr style={{ borderTop: '1px solid #E2E8F0', background: '#F8FAFC' }}>
              <td className="px-6 py-4 text-[11px] font-semibold" style={{ color: '#64748B' }}>
                Выберите тариф
              </td>
              {cols.map(p => {
                const palette = PALETTES[p.key] || PALETTES.health_plus
                const isRec = p.key === recommend
                return (
                  <td key={p.key} className="px-3 py-4 text-center" style={{ background: isRec ? `${palette.accent}07` : 'transparent' }}>
                    <button
                      type="button"
                      onClick={() => onSelect?.(p.key)}
                      className="px-3 py-1.5 rounded-xl text-[12px] font-extrabold text-white transition-all active:scale-95"
                      style={{
                        background: `linear-gradient(135deg, ${palette.from}, ${palette.to})`,
                        boxShadow: `0 6px 16px ${palette.to}44`,
                      }}
                    >
                      Подключить
                    </button>
                  </td>
                )
              })}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
