import { NavLink } from 'react-router-dom'
import useAuthStore from '../store/auth'

const partnerItems = [
  { to: '/',               icon: 'home',          label: 'Главная'    },
  { to: '/partner/create', icon: 'add_circle',    label: 'Записать'   },
  { to: '/history',        icon: 'list_alt',      label: 'История'    },
  { to: '/bonuses',        icon: 'payments',      label: 'Бонусы'     },
]

const baseItems = [
  { to: '/',        icon: 'home',            label: 'Главная'    },
  { to: '/create',  icon: 'add_circle',      label: 'Направление'},
  { to: '/scan',    icon: 'qr_code_scanner', label: 'Сканер'     },
  { to: '/history', icon: 'list_alt',        label: 'История'    },
  { to: '/bonuses', icon: 'payments',        label: 'Бонусы'     },
]

// Менеджер: 6 вкладок, Главная = /manager
const managerItems = [
  { to: '/manager',          icon: 'home',       label: 'Главная'    },
  { to: '/create',           icon: 'add_circle', label: 'Направление'},
  { to: '/history',          icon: 'list_alt',   label: 'История'    },
  { to: '/bonuses',          icon: 'payments',   label: 'Бонусы'     },
  { to: '/admin-panel',      icon: 'group',      label: 'Персонал'   },
  { to: '/manager/analytics',icon: 'bar_chart',  label: 'Отчёты'     },
]

export default function BottomNav() {
  const { user } = useAuthStore()

  // У роли manager своя навигация в _ManagerShell. Старый bottom-nav
  // со ссылками на /history, /bonuses (старый дизайн страниц) скрываем —
  // менеджер ходит через ManagerShell на /manager/history, /manager/bonuses.
  if (user?.role === 'manager') return null

  const items =
    user?.role === 'partner_doctor' ? partnerItems :
    baseItems

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white dark:bg-[#1a2232] border-t border-[#eceef0] dark:border-[#ffffff10] shadow-[0_-4px_20px_rgba(25,28,30,0.06)] z-50">
      <div className="flex overflow-x-auto">
        {items.map(({ to, icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/manager' || to === '/'}
            className={({ isActive }) =>
              `flex-shrink-0 flex-1 min-w-[48px] flex flex-col items-center py-2 text-[10px] transition-colors ${
                isActive ? 'text-[#0097A7] dark:text-[#4dd0e1]' : 'text-[#727783] dark:text-slate-500'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span className="material-symbols-outlined text-[21px] mb-0.5"
                  style={{ fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0" }}>
                  {icon}
                </span>
                {label}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
