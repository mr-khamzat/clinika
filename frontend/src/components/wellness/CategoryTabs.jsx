/**
 * ========================================
 * БЛОК: CategoryTabs — горизонтальные табы категорий wellness (Глава 10)
 * ========================================
 * Используется в PatientWellnessSection и AdminWellnessSection.
 *
 * props.value: ключ активной категории ('all'|'fitness'|'spa'|...).
 * props.onChange(key)
 * props.counts: { fitness: 3, spa: 1, all: 12 } — бейджи (опц.)
 *
 * Скроллится по горизонтали на мобиле.
 * ========================================
 */
export const WELLNESS_CATEGORIES = [
  { id: 'all',        label: 'Все',         icon: 'apps'              },
  { id: 'fitness',    label: 'Фитнес',      icon: 'fitness_center'    },
  { id: 'spa',        label: 'Спа',         icon: 'spa'               },
  { id: 'nutrition',  label: 'Питание',     icon: 'restaurant'        },
  { id: 'psychology', label: 'Психология',  icon: 'psychology'        },
  { id: 'yoga',       label: 'Йога',        icon: 'self_improvement'  },
  { id: 'other',      label: 'Прочее',      icon: 'storefront'        },
]

export default function CategoryTabs({ value = 'all', onChange, counts = {} }) {
  return (
    <div
      className="flex gap-1.5 overflow-x-auto"
      style={{ scrollbarWidth: 'none', paddingBottom: 4 }}
    >
      {WELLNESS_CATEGORIES.map(c => {
        const active = c.id === value
        const count = counts[c.id]
        return (
          <button
            key={c.id}
            onClick={() => onChange && onChange(c.id)}
            className="flex items-center gap-1.5 flex-shrink-0 transition-all active:scale-95"
            style={{
              padding: '8px 14px',
              borderRadius: 999,
              background: active ? 'linear-gradient(135deg, #0ea5e9, #0369a1)' : '#fff',
              color: active ? '#fff' : '#475569',
              border: active ? '1px solid #0284c7' : '1px solid #e2e8f0',
              fontSize: 13, fontWeight: active ? 700 : 600,
              whiteSpace: 'nowrap',
              boxShadow: active ? '0 4px 12px rgba(2,132,199,0.25)' : 'none',
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 16, fontVariationSettings: active ? "'FILL' 1" : "'FILL' 0" }}
            >
              {c.icon}
            </span>
            <span>{c.label}</span>
            {typeof count === 'number' && count > 0 && (
              <span
                style={{
                  display: 'inline-grid', placeItems: 'center',
                  minWidth: 18, height: 18, padding: '0 5px',
                  borderRadius: 999,
                  background: active ? 'rgba(255,255,255,0.25)' : '#f1f5f9',
                  color: active ? '#fff' : '#64748b',
                  fontSize: 10.5, fontWeight: 700,
                }}
              >
                {count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
