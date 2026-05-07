/**
 * ========================================
 * БЛОК: <WikiHero> — hero-секция главной страницы Wiki
 * ========================================
 * Современный hero с заголовком, описанием и крупным поиском.
 * Используется ТОЛЬКО на корневой странице /wiki (не в категориях/статьях).
 *
 * Props:
 *   query        — текущий поисковый запрос
 *   onQueryChange — setter
 *   onFocus      — колбэк при фокусе input (для открытия результатов)
 *   inputRef     — ref на input (для Cmd+K)
 *   resultsCount — кол-во статей всего (отображается subtle hint)
 * ========================================
 */
export default function WikiHero({ query, onQueryChange, onFocus, inputRef, resultsCount }) {
  return (
    <section
      className="relative overflow-hidden rounded-[24px] mb-8 sm:mb-10"
      style={{
        background:
          'linear-gradient(135deg, var(--accent-soft) 0%, var(--bg-1) 60%, var(--bg-1) 100%)',
        border: '1px solid var(--border)',
        padding: 'clamp(28px, 5vw, 56px)',
      }}
    >
      {/* ─── Декоративный круг фон ─── */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-20 -right-20 w-[320px] h-[320px] rounded-full opacity-60"
        style={{
          background:
            'radial-gradient(closest-side, var(--accent-soft), transparent 70%)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-24 -left-16 w-[280px] h-[280px] rounded-full opacity-50"
        style={{
          background:
            'radial-gradient(closest-side, var(--accent-soft), transparent 70%)',
        }}
      />

      <div className="relative z-10 max-w-[760px]">
        {/* ─── Маленький бейдж сверху ─── */}
        <div
          className="inline-flex items-center gap-1.5 mb-4 px-2.5 py-1 rounded-full"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            fontSize: '11.5px',
            color: 'var(--fg-2)',
            fontWeight: 500,
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: '14px', color: 'var(--accent)' }}
          >
            auto_stories
          </span>
          База знаний КлиникСеть
        </div>

        {/* ─── Заголовок ─── */}
        <h1
          className="font-semibold leading-[1.05] tracking-tight"
          style={{
            fontSize: 'clamp(30px, 5vw, 46px)',
            letterSpacing: '-0.03em',
            color: 'var(--fg)',
          }}
        >
          Документация для команды и пациентов
        </h1>

        {/* ─── Описание ─── */}
        <p
          className="mt-3 sm:mt-4 leading-relaxed"
          style={{
            fontSize: 'clamp(15px, 1.6vw, 17px)',
            color: 'var(--fg-2)',
            maxWidth: '600px',
          }}
        >
          Роли, процессы и пошаговые инструкции по работе с платформой.
          Найдите ответ за секунды — поиск работает по заголовкам и содержимому статей.
        </p>

        {/* ─── Search input крупный ─── */}
        <div
          className="mt-6 sm:mt-8 flex items-center gap-3 rounded-2xl transition-all"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            padding: '14px 18px',
            boxShadow: 'var(--shadow-md)',
            maxWidth: '600px',
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: '22px', color: 'var(--fg-3)' }}
          >
            search
          </span>
          <input
            ref={inputRef}
            type="text"
            placeholder="Поиск по статьям…"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onFocus={onFocus}
            className="flex-1 bg-transparent outline-none"
            style={{ color: 'var(--fg)', fontSize: '15.5px' }}
          />
          {query ? (
            <button
              onClick={() => onQueryChange('')}
              className="material-symbols-outlined transition-colors"
              style={{ fontSize: '20px', color: 'var(--fg-3)' }}
              aria-label="Очистить"
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--fg)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--fg-3)')}
            >
              close
            </button>
          ) : (
            <kbd
              className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-mono"
              style={{
                background: 'var(--bg-2)',
                border: '1px solid var(--border)',
                color: 'var(--fg-3)',
                fontSize: '11px',
              }}
              title="Cmd+K / Ctrl+K"
            >
              <span style={{ fontSize: '12px' }}>⌘</span>K
            </kbd>
          )}
        </div>

        {resultsCount != null && (
          <p
            className="mt-3 text-xs"
            style={{ color: 'var(--fg-3)' }}
          >
            Всего {resultsCount} {pluralize(resultsCount)} в базе знаний
          </p>
        )}
      </div>
    </section>
  )
}

// ─── Простой плюрал для «статей» ───
function pluralize(n) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'статья'
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'статьи'
  return 'статей'
}
