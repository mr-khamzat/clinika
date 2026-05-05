/**
 * ========================================
 * БЛОК: Превью премиум-палитры (пилотный экран)
 * ========================================
 * Демо страница для проверки дизайн-токенов из tokens.css.
 * URL: /{slug}/design-preview
 *
 * ВАЖНО:
 *  - использует только CSS-переменные из tokens.css/shared.css
 *  - все стили scoped через корневой класс `.design-preview-root`,
 *    поэтому не ломает существующие страницы
 *  - тогл темы меняет атрибут data-theme на корневом div
 *  - Tailwind не используется для цветов (только токены)
 * ========================================
 */
import { useEffect, useState } from 'react'
import '../styles/tokens.css'
import '../styles/shared.css'

// ─── Хелпер: определить системную тему для Auto ───
function getSystemTheme() {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export default function DesignPreview() {
  // ─── Стейт темы: 'light' | 'dark' | 'auto' ───
  const [themeMode, setThemeMode] = useState('dark')

  // Эффективная тема — для data-theme атрибута
  const effectiveTheme = themeMode === 'auto' ? getSystemTheme() : themeMode

  useEffect(() => {
    // При выборе Auto — слушаем системные изменения
    if (themeMode !== 'auto') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => setThemeMode((prev) => (prev === 'auto' ? 'auto' : prev))
    mq.addEventListener?.('change', handler)
    return () => mq.removeEventListener?.('change', handler)
  }, [themeMode])

  return (
    <div className="design-preview-root" data-theme={effectiveTheme} style={{ minHeight: '100vh', padding: 28 }}>

      {/* ─── Заголовок страницы ─── */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 28, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
            Дизайн-система · пилот
          </div>
          <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: '-0.025em' }}>
            Превью премиум-палитры
          </div>
          <div style={{ fontSize: 14, color: 'var(--fg-3)', marginTop: 6, maxWidth: 720 }}>
            Тёмно-голубая медицинская OKLCH-палитра. Light / Dark / Auto через <span className="mono" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>data-theme</span>.
          </div>
        </div>

        {/* ─── Тогл темы ─── */}
        <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)' }}>
          {['light', 'dark', 'auto'].map((m) => (
            <button
              key={m}
              onClick={() => setThemeMode(m)}
              className={'btn ' + (themeMode === m ? 'btn-primary' : 'btn-ghost')}
              style={{ padding: '6px 14px', fontSize: 12, textTransform: 'capitalize' }}
            >
              {m === 'light' ? 'Light' : m === 'dark' ? 'Dark' : 'Auto'}
            </button>
          ))}
        </div>
      </div>

      {/* ─── KPI карточки ─── */}
      <div style={{ marginBottom: 14 }}>
        <SubLabel>KPI · карточки с числами</SubLabel>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 28 }}>
        <KpiCard label="Записей сегодня" value="248" delta="+12 vs вчера" />
        <KpiCard label="Выручка месяц" value="3 240 800 ₽" delta="+8.4%" />
        <KpiCard label="Загрузка зала" value="76%" delta="оптимум" tone="muted" />
        <KpiCard label="Жалобы за неделю" value="3" delta="превышение" tone="bad" />
      </div>

      {/* ─── Кнопки ─── */}
      <div className="surface-flat" style={{ padding: 20, marginBottom: 16 }}>
        <SubLabel>Buttons</SubLabel>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
          <button className="btn btn-primary">Primary · Создать визит</button>
          <button className="btn btn-secondary">Secondary · Фильтры</button>
          <button className="btn btn-ghost">Ghost · Отмена</button>
          <button className="btn btn-danger-soft">Danger soft · Удалить</button>
          <button className="btn btn-primary btn-lg">Primary Large</button>
          <button className="btn btn-secondary btn-sm">Secondary Small</button>
        </div>
      </div>

      {/* ─── Бейджи / чипы ─── */}
      <div className="surface-flat" style={{ padding: 20, marginBottom: 16 }}>
        <SubLabel>Бейджи статусов</SubLabel>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
          <span className="chip"><span className="chip-dot"></span>neutral</span>
          <span className="chip chip-good"><span className="chip-dot"></span>принят</span>
          <span className="chip chip-info"><span className="chip-dot"></span>в работе</span>
          <span className="chip chip-warn"><span className="chip-dot"></span>занят</span>
          <span className="chip chip-bad"><span className="chip-dot"></span>не явился</span>
          <span className="chip chip-accent">Platinum</span>
        </div>
      </div>

      {/* ─── Поле ввода ─── */}
      <div className="surface-flat" style={{ padding: 20, marginBottom: 16 }}>
        <SubLabel>Inputs</SubLabel>
        <div style={{ display: 'flex', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
          <div className="input" style={{ flex: 1, minWidth: 260 }}>
            {/* inline svg "search" — не используем сторонние пакеты */}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input placeholder="Найти пациента, врача, услугу..." />
            <span className="kbd">⌘K</span>
          </div>
          <div className="input" style={{ width: 200 }}>
            <input placeholder="Период" defaultValue="7 дней" />
          </div>
        </div>
      </div>

      {/* ─── Inline-таблица ─── */}
      <div className="surface" style={{ padding: 0, overflow: 'hidden', marginBottom: 28 }}>
        <div className="card-hd">
          <div>
            <div className="card-hd-title">Записи на приём</div>
            <div className="card-hd-sub">3 ближайших визита</div>
          </div>
          <button className="btn btn-secondary btn-sm">Все записи</button>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Пациент</th>
              <th>Врач</th>
              <th>Время</th>
              <th style={{ textAlign: 'right' }}>Сумма</th>
              <th style={{ textAlign: 'right' }}>Статус</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="avatar av-sm av-1">ИА</div>
                  <div>
                    <div style={{ fontWeight: 600 }}>Иванов А. С.</div>
                    <div style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>Карта · 104857</div>
                  </div>
                </div>
              </td>
              <td style={{ color: 'var(--fg-2)' }}>Петров К. Д.</td>
              <td className="tnum">10:30</td>
              <td style={{ textAlign: 'right', fontWeight: 600 }} className="tnum">4 200 ₽</td>
              <td style={{ textAlign: 'right' }}><span className="chip chip-good"><span className="chip-dot"></span>подтв.</span></td>
            </tr>
            <tr>
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="avatar av-sm av-2">СМ</div>
                  <div>
                    <div style={{ fontWeight: 600 }}>Сидорова М. В.</div>
                    <div style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>Карта · 104861</div>
                  </div>
                </div>
              </td>
              <td style={{ color: 'var(--fg-2)' }}>Назарова Е. И.</td>
              <td className="tnum">11:00</td>
              <td style={{ textAlign: 'right', fontWeight: 600 }} className="tnum">7 800 ₽</td>
              <td style={{ textAlign: 'right' }}><span className="chip chip-warn"><span className="chip-dot"></span>занят</span></td>
            </tr>
            <tr>
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="avatar av-sm av-3">ПД</div>
                  <div>
                    <div style={{ fontWeight: 600 }}>Полев Д. Н.</div>
                    <div style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>Карта · 104873</div>
                  </div>
                </div>
              </td>
              <td style={{ color: 'var(--fg-2)' }}>Кулиев Х. М.</td>
              <td className="tnum">11:30</td>
              <td style={{ textAlign: 'right', fontWeight: 600 }} className="tnum">2 400 ₽</td>
              <td style={{ textAlign: 'right' }}><span className="chip chip-bad"><span className="chip-dot"></span>не явился</span></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ─── Сводка по токенам ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 28 }}>
        {[
          ['accent', 'Brand'],
          ['good', 'Success'],
          ['info', 'Info'],
          ['warn', 'Warning'],
          ['bad', 'Danger'],
          ['gold', 'Gold'],
        ].map(([k, n]) => (
          <div
            key={k}
            style={{
              background: `var(--${k}-soft, var(--bg-2))`,
              border: '1px solid var(--border)',
              padding: 14,
              borderRadius: 'var(--r-lg)',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <div style={{ width: 28, height: 28, borderRadius: 7, background: `var(--${k})` }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: `var(--${k})` }}>{n}</div>
              <div className="mono" style={{ fontSize: 10.5, color: 'var(--fg-3)', fontFamily: 'JetBrains Mono, monospace' }}>--{k}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ─── Подвал ─── */}
      <div style={{ fontSize: 12, color: 'var(--fg-4)', textAlign: 'center', paddingTop: 20, borderTop: '1px solid var(--line)' }}>
        Текущая тема: <strong style={{ color: 'var(--fg-2)' }}>{themeMode}</strong>
        {themeMode === 'auto' && <> · эффективная: <strong style={{ color: 'var(--fg-2)' }}>{effectiveTheme}</strong></>}
        {' · '}
        пилотный экран дизайн-токенов
      </div>
    </div>
  )
}

// ─── Атомы UI (используют только токены) ───

function SubLabel({ children }) {
  return (
    <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
      {children}
    </div>
  )
}

function KpiCard({ label, value, delta, tone = 'good' }) {
  const deltaCls = tone === 'bad' ? 'kpi-delta bad' : tone === 'muted' ? 'kpi-delta muted' : 'kpi-delta'
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      <div className={deltaCls}>{delta}</div>
    </div>
  )
}
