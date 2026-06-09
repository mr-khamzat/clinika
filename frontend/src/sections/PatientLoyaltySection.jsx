/**
 * ========================================
 * БЛОК: PatientLoyaltySection — премиум-дашборд лояльности пациента (Глава 8)
 * ========================================
 * Используется внутри PatientCabinet.jsx (вкладка «Лояльность»).
 *
 * API:
 *   GET /patient/loyalty/account
 *     → { points, tier, next_tier_at, points_to_next_tier,
 *         total_spent, joined_at, last_activity_at }
 *     | 402 если модуль loyalty_pro не активен
 *
 * Слои:
 *   1. Header-карточка тира (градиент по тиру + большие баллы + прогресс-бар)
 *   2. Tabs:
 *        • История (LoyaltyTransactionsList)
 *        • Награды (LoyaltyRewardsCatalog)
 *        • Достижения (статичные badge с эвристикой по аккаунту)
 *
 * Графический язык:
 *   - градиент-фоны по TIER_PALETTE из TierBadge.jsx
 *   - shimmer-эффект на header'е (CSS keyframes)
 *   - анимация прогресс-бара (transition: width 0.5s)
 * ========================================
 */
import { useEffect, useState, useCallback, useRef, lazy, Suspense } from 'react'
import axios from 'axios'
import { API_BASE } from '../config'
import TierBadge, { TIER_PALETTE, paletteFor } from '../components/loyalty/TierBadge'

// ═════ БЛОК: useCountUp — animated number tween (premium hero metric) ═════
function useCountUp(target, { duration = 1200, enabled = true } = {}) {
  const [value, setValue] = useState(enabled ? 0 : target)
  const rafRef = useRef(null)
  const startRef = useRef(null)
  useEffect(() => {
    if (!enabled) { setValue(target); return }
    const from = 0
    const to = Number(target) || 0
    if (to === from) { setValue(to); return }
    cancelAnimationFrame(rafRef.current)
    startRef.current = null
    const step = (ts) => {
      if (startRef.current == null) startRef.current = ts
      const elapsed = ts - startRef.current
      const t = Math.min(1, elapsed / duration)
      // easeOutExpo
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t)
      setValue(Math.round(from + (to - from) * eased))
      if (t < 1) rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target, duration, enabled])
  return value
}

const LoyaltyTransactionsList = lazy(() => import('../components/loyalty/LoyaltyTransactionsList'))
const LoyaltyRewardsCatalog   = lazy(() => import('../components/loyalty/LoyaltyRewardsCatalog'))

const SESSION_KEY = 'clinika_patient_session'

// Локализация: «До Platinum осталось …»
const NEXT_LABEL = {
  bronze: 'Silver',
  silver: 'Gold',
  gold: 'Platinum',
  platinum: null,
}

function PageStub({ icon = 'hourglass_empty', title, sub, tone = 'info' }) {
  const colors = {
    info:    { bg: '#e0f2fe', border: '#bae6fd', icon: '#0369a1', text: '#0c4a6e' },
    warn:    { bg: '#fef3c7', border: '#fde68a', icon: '#92400e', text: '#92400e' },
    success: { bg: '#dcfce7', border: '#bbf7d0', icon: '#15803d', text: '#14532d' },
  }
  const c = colors[tone] || colors.info
  return (
    <div className="rounded-2xl p-6 text-center" style={{ background: c.bg, border: `1px solid ${c.border}` }}>
      <span className="material-symbols-outlined text-3xl mb-2 block" style={{ color: c.icon }}>{icon}</span>
      <p className="text-sm font-semibold" style={{ color: c.text }}>{title}</p>
      {sub && <p className="text-xs mt-1" style={{ color: c.text }}>{sub}</p>}
    </div>
  )
}

// Список достижений (эвристика — пока без отдельного API; считаем по account)
function buildAchievements(account) {
  const totalSpent = Number(account?.total_spent || 0)
  const joinedYears = account?.joined_at ? (Date.now() - new Date(account.joined_at).getTime()) / (365.25 * 86400000) : 0
  const tierIdx = ['bronze','silver','gold','platinum'].indexOf(String(account?.tier || '').toLowerCase())
  return [
    { id: 'first_visit',  icon: 'event_available',   label: 'Первый приём',        unlocked: totalSpent > 0 },
    { id: 'spent_10k',    icon: 'payments',          label: 'Потрачено ₽10 000',   unlocked: totalSpent >= 10000 },
    { id: 'spent_50k',    icon: 'payments',          label: 'Потрачено ₽50 000',   unlocked: totalSpent >= 50000 },
    { id: 'spent_100k',   icon: 'savings',           label: 'Потрачено ₽100 000',  unlocked: totalSpent >= 100000 },
    { id: 'tier_silver',  icon: 'workspace_premium', label: 'Уровень Silver',      unlocked: tierIdx >= 1 },
    { id: 'tier_gold',    icon: 'workspace_premium', label: 'Уровень Gold',        unlocked: tierIdx >= 2 },
    { id: 'tier_platinum',icon: 'diamond',           label: 'Уровень Platinum',    unlocked: tierIdx >= 3 },
    { id: 'loyal_year',   icon: 'verified_user',     label: '1 год в программе',   unlocked: joinedYears >= 1 },
  ]
}

export default function PatientLoyaltySection({ sessionToken: sessionTokenProp }) {
  const sessionToken = sessionTokenProp || (typeof window !== 'undefined' ? localStorage.getItem(SESSION_KEY) : null)

  const [account, setAccount] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('history')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await axios.get(`${API_BASE}/patient/loyalty/account`, {
        params: { t: sessionToken },
      })
      setAccount(r?.data || {})
    } catch (e) {
      const status = e?.response?.status
      if (status === 402) setError('module_off')
      else if (status === 404) {
        // backend handles auto-create on first hit — повторим один раз
        try {
          const r2 = await axios.get(`${API_BASE}/patient/loyalty/account`, { params: { t: sessionToken } })
          setAccount(r2?.data || {})
        } catch {
          setError('load')
        }
      } else setError('load')
    } finally {
      setLoading(false)
    }
  }, [sessionToken])

  useEffect(() => { load() }, [load])

  if (error === 'module_off') {
    return (
      <div className="px-1 pt-2 pb-6">
        <PageStub
          icon="lock"
          tone="warn"
          title="Модуль программы лояльности не подключен"
          sub="Свяжитесь с менеджером клиники для активации."
        />
      </div>
    )
  }

  if (loading) {
    return (
      <div className="px-1 pt-2 space-y-3">
        <div className="rounded-3xl h-56 animate-pulse bg-gray-200 dark:bg-gray-800" />
        <div className="rounded-2xl h-12 animate-pulse bg-gray-200 dark:bg-gray-800" />
        <div className="rounded-2xl h-32 animate-pulse bg-gray-200 dark:bg-gray-800" />
      </div>
    )
  }

  if (error === 'load') {
    return (
      <div className="px-1 pt-2">
        <PageStub icon="error" tone="warn" title="Не удалось загрузить данные" sub="Попробуйте позже." />
      </div>
    )
  }

  const tier = account?.tier || 'bronze'
  const palette = paletteFor(tier)
  const points = Number(account?.points || 0)
  const nextTierAt = Number(account?.next_tier_at || 0)
  const toNext = Number(account?.points_to_next_tier || 0)
  const totalSpent = Number(account?.total_spent || 0)
  const isMax = !NEXT_LABEL[String(tier).toLowerCase()]
  const nextLabel = NEXT_LABEL[String(tier).toLowerCase()]

  // Прогресс-бар: рассчитываем от nextTierAt (порог следующего тира)
  let progressPct = 100
  if (!isMax && nextTierAt > 0) {
    const ratio = (nextTierAt - toNext) / nextTierAt
    progressPct = Math.max(0, Math.min(100, ratio * 100))
  }

  const achievements = buildAchievements(account)
  const animatedPoints = useCountUp(points, { duration: 1200 })

  return (
    <div className="px-1 pt-2 pb-6 space-y-4">
      <style>{`
        @keyframes loyaltyShimmer { 0%{transform:translateX(-100%)} 100%{transform:translateX(100%)} }
        @keyframes loyaltyPop { from{opacity:0; transform:translateY(10px) scale(.98)} to{opacity:1; transform:translateY(0) scale(1)} }
        @keyframes loyaltyHeroIn { from{opacity:0; transform:translateY(14px)} to{opacity:1; transform:translateY(0)} }
        @keyframes loyaltyGlow { 0%,100%{box-shadow:0 0 0 0 rgba(255,255,255,0)} 50%{box-shadow:0 0 24px 4px rgba(255,255,255,.35)} }
        @keyframes loyaltyProgress { from{width:0%} to{width:var(--lp-target,0%)} }
        .lp-card { animation: loyaltyPop .55s cubic-bezier(.22,1,.36,1) both; }
        .lp-hero { animation: loyaltyHeroIn .7s cubic-bezier(.22,1,.36,1) both; }
        .lp-progress-fill {
          animation: loyaltyProgress 1.2s cubic-bezier(.22,1,.36,1) .15s both;
          transition: width 0.6s cubic-bezier(.22,1,.36,1);
        }
        .lp-tap:active { transform: scale(.97); }
      `}</style>

      {/* ═════ БЛОК: Hero — премиум-карточка тира с count-up баллов ═════ */}
      <div
        className="lp-hero relative overflow-hidden rounded-3xl p-6 text-white"
        style={{
          background: `linear-gradient(135deg, ${palette.from} 0%, ${palette.to} 100%)`,
          color: palette.text,
          boxShadow: '0 14px 40px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,.35)',
        }}
      >
        {/* shimmer overlay */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.28) 50%, transparent 70%)',
            animation: 'loyaltyShimmer 3.8s ease-in-out infinite',
          }}
        />
        {/* декоративная медаль */}
        <span
          className="material-symbols-outlined absolute"
          style={{
            top: -30, right: -28, fontSize: 220, opacity: 0.13,
            fontVariationSettings: `'FILL' ${palette.fill}`,
            color: palette.text,
            pointerEvents: 'none',
            transform: 'rotate(-8deg)',
          }}
        >
          {palette.icon}
        </span>

        <div className="relative">
          {/* premium tier-badge */}
          <div className="flex items-center justify-between mb-4">
            <div
              className="inline-flex items-center gap-2 rounded-full px-3 py-1.5"
              style={{
                background: 'rgba(255,255,255,0.22)',
                backdropFilter: 'blur(6px)',
                border: '1px solid rgba(255,255,255,0.35)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,.4)',
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}
              >
                workspace_premium
              </span>
              <span className="text-xs font-extrabold uppercase tracking-wider">{palette.label}</span>
            </div>
            <span
              className="material-symbols-outlined"
              style={{
                fontSize: 48,
                fontVariationSettings: `'FILL' ${palette.fill}`,
                color: palette.text,
                filter: 'drop-shadow(0 4px 12px rgba(0,0,0,.25))',
              }}
            >
              {palette.icon}
            </span>
          </div>

          {/* large count-up */}
          <div className="mt-2">
            <p className="text-[11px] font-bold uppercase tracking-widest opacity-75">Баллы на счету</p>
            <p
              className="font-black leading-none tracking-tight tabular-nums mt-1"
              style={{ fontSize: 'clamp(40px, 11vw, 56px)' }}
            >
              {animatedPoints.toLocaleString('ru-RU')}
              <span className="text-base font-bold ml-2 opacity-80">баллов</span>
            </p>
          </div>

          {/* Прогресс до следующего тира */}
          {isMax ? (
            <div
              className="mt-5 rounded-2xl px-4 py-3 inline-flex items-center gap-2"
              style={{
                background: 'rgba(255,255,255,0.20)',
                border: '1px solid rgba(255,255,255,0.30)',
                backdropFilter: 'blur(6px)',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 22, fontVariationSettings: "'FILL' 1" }}>diamond</span>
              <div>
                <p className="text-sm font-extrabold leading-tight">Максимальный уровень</p>
                <p className="text-[11px] opacity-85 mt-0.5">Все награды и привилегии доступны</p>
              </div>
            </div>
          ) : (
            <div className="mt-5">
              <div className="flex items-center justify-between mb-2 text-xs font-bold">
                <span className="opacity-90 inline-flex items-center gap-1">
                  <span className="material-symbols-outlined" style={{ fontSize: 14, fontVariationSettings: "'FILL' 1" }}>trending_up</span>
                  До {nextLabel}
                </span>
                <span className="tabular-nums">
                  {toNext > 0 ? `${toNext.toLocaleString('ru-RU')} баллов` : 'почти!'}
                </span>
              </div>
              <div
                className="relative w-full rounded-full overflow-hidden"
                style={{
                  height: 12,
                  background: 'rgba(0,0,0,0.18)',
                  boxShadow: 'inset 0 1px 2px rgba(0,0,0,.18)',
                }}
              >
                <div
                  className="lp-progress-fill h-full rounded-full relative overflow-hidden"
                  style={{
                    '--lp-target': `${progressPct}%`,
                    width: `${progressPct}%`,
                    background: 'linear-gradient(90deg, #fff 0%, rgba(255,255,255,.85) 100%)',
                    boxShadow: '0 0 12px rgba(255,255,255,.6)',
                  }}
                >
                  <div
                    className="absolute inset-0"
                    style={{
                      background: 'linear-gradient(110deg, transparent 30%, rgba(255,255,255,.45) 50%, transparent 70%)',
                      animation: 'loyaltyShimmer 2.2s ease-in-out infinite',
                    }}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between mt-1.5 text-[11px] opacity-75 tabular-nums">
                <span>0</span>
                {nextTierAt > 0 && <span>{nextTierAt.toLocaleString('ru-RU')}</span>}
              </div>
            </div>
          )}

          {/* Микро-сводка glass-карточки */}
          <div className="grid grid-cols-2 gap-2.5 mt-5">
            <div
              className="rounded-2xl px-3 py-2.5"
              style={{
                background: 'rgba(255,255,255,0.18)',
                border: '1px solid rgba(255,255,255,.25)',
                backdropFilter: 'blur(6px)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,.3)',
              }}
            >
              <p className="text-[10px] uppercase tracking-wider opacity-75 font-bold">Потрачено</p>
              <p className="text-base font-extrabold mt-0.5 tabular-nums">
                {totalSpent.toLocaleString('ru-RU')} <span className="text-xs opacity-85">₽</span>
              </p>
            </div>
            <div
              className="rounded-2xl px-3 py-2.5"
              style={{
                background: 'rgba(255,255,255,0.18)',
                border: '1px solid rgba(255,255,255,.25)',
                backdropFilter: 'blur(6px)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,.3)',
              }}
            >
              <p className="text-[10px] uppercase tracking-wider opacity-75 font-bold">В программе с</p>
              <p className="text-base font-extrabold mt-0.5">
                {account?.joined_at
                  ? new Date(account.joined_at).toLocaleDateString('ru-RU', { month: 'short', year: 'numeric' })
                  : '—'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ═════ БЛОК: Tabs — переключатель сегментов ═════ */}
      <div
        className="flex gap-1 p-1 rounded-2xl overflow-x-auto bg-gray-100 dark:bg-gray-800/60"
        style={{
          boxShadow: 'inset 0 1px 2px rgba(0,0,0,.04)',
        }}
      >
        {[
          { key: 'history',      label: 'История',     icon: 'history' },
          { key: 'rewards',      label: 'Награды',     icon: 'redeem' },
          { key: 'achievements', label: 'Достижения', icon: 'military_tech' },
        ].map(t => {
          const active = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="lp-tap flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-bold transition-all"
              style={{
                background: active
                  ? 'linear-gradient(135deg,#fff 0%,#f8fafc 100%)'
                  : 'transparent',
                color: active ? '#0097A7' : '#6b7280',
                boxShadow: active
                  ? '0 4px 12px rgba(0,151,167,.18), inset 0 1px 0 rgba(255,255,255,.6)'
                  : 'none',
                whiteSpace: 'nowrap',
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 17, fontVariationSettings: active ? "'FILL' 1" : "'FILL' 0" }}
              >
                {t.icon}
              </span>
              {t.label}
            </button>
          )
        })}
      </div>

      {/* ═════ БЛОК: Tab content ═════ */}
      <div>
        {tab === 'history' && (
          <Suspense fallback={<div className="rounded-2xl h-32 animate-pulse bg-gray-200 dark:bg-gray-800" />}>
            <LoyaltyTransactionsList sessionToken={sessionToken} />
          </Suspense>
        )}

        {tab === 'rewards' && (
          <Suspense fallback={<div className="rounded-2xl h-32 animate-pulse bg-gray-200 dark:bg-gray-800" />}>
            <LoyaltyRewardsCatalog
              sessionToken={sessionToken}
              points={points}
              tier={tier}
              onClaimed={load}
            />
          </Suspense>
        )}

        {tab === 'achievements' && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
            {achievements.map((a, idx) => (
              <div
                key={a.id}
                className="lp-card lp-tap relative rounded-2xl p-3.5 text-center transition-all"
                style={{
                  animationDelay: `${idx * 0.05}s`,
                  background: a.unlocked
                    ? 'linear-gradient(180deg,#ffffff 0%,#f8fafc 100%)'
                    : '#f9fafb',
                  border: '1px solid',
                  borderColor: a.unlocked ? 'rgba(0,151,167,.15)' : '#e5e7eb',
                  boxShadow: a.unlocked
                    ? '0 4px 16px rgba(0,0,0,.06), inset 0 1px 0 rgba(255,255,255,.5)'
                    : 'inset 0 1px 0 rgba(255,255,255,.4)',
                  opacity: a.unlocked ? 1 : 0.55,
                }}
              >
                <span
                  className="inline-grid place-items-center mx-auto mb-2"
                  style={{
                    width: 52, height: 52, borderRadius: 999,
                    background: a.unlocked
                      ? 'linear-gradient(135deg,#0097A7 0%,#1565C0 100%)'
                      : '#e5e7eb',
                    color: a.unlocked ? '#fff' : '#9ca3af',
                    boxShadow: a.unlocked
                      ? '0 6px 16px rgba(0,151,167,.35), inset 0 1px 0 rgba(255,255,255,.4)'
                      : 'none',
                  }}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 26, fontVariationSettings: a.unlocked ? "'FILL' 1" : "'FILL' 0" }}
                  >
                    {a.icon}
                  </span>
                </span>
                <p className="text-[11px] font-bold leading-tight text-gray-800 dark:text-gray-100">
                  {a.label}
                </p>
                {a.unlocked ? (
                  <span
                    className="absolute -top-1.5 -right-1.5 inline-grid place-items-center"
                    style={{
                      width: 22, height: 22, borderRadius: 999,
                      background: 'linear-gradient(135deg,#10B981,#059669)',
                      color: '#fff',
                      boxShadow: '0 4px 10px rgba(16,185,129,.45)',
                      border: '2px solid #fff',
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 13, fontVariationSettings: "'FILL' 1" }}>check</span>
                  </span>
                ) : (
                  <span
                    className="absolute -top-1.5 -right-1.5 inline-grid place-items-center"
                    style={{
                      width: 22, height: 22, borderRadius: 999,
                      background: '#fff',
                      color: '#9ca3af',
                      border: '2px solid #e5e7eb',
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 13 }}>lock</span>
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
