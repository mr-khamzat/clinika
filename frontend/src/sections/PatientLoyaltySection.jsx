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
import { useEffect, useState, useCallback, lazy, Suspense } from 'react'
import axios from 'axios'
import { API_BASE } from '../config'
import TierBadge, { TIER_PALETTE, paletteFor } from '../components/loyalty/TierBadge'

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
        <div className="rounded-3xl h-48 animate-pulse" style={{ background: '#e5e7eb' }} />
        <div className="rounded-2xl h-12 animate-pulse" style={{ background: '#e5e7eb' }} />
        <div className="rounded-2xl h-32 animate-pulse" style={{ background: '#e5e7eb' }} />
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

  return (
    <div className="px-1 pt-2 pb-6 space-y-4">
      <style>{`
        @keyframes loyaltyShimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .loyalty-progress-fill { transition: width 0.6s cubic-bezier(.22,1,.36,1); }
      `}</style>

      {/* ── Hero-карточка тира ── */}
      <div
        className="relative overflow-hidden rounded-3xl p-6 text-white"
        style={{
          background: `linear-gradient(135deg, ${palette.from} 0%, ${palette.to} 100%)`,
          color: palette.text,
          boxShadow: '0 12px 32px rgba(0,0,0,0.15)',
        }}
      >
        {/* shimmer overlay */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.25) 50%, transparent 70%)',
            animation: 'loyaltyShimmer 3.5s ease-in-out infinite',
          }}
        />
        {/* декоративная медаль фоном */}
        <span
          className="material-symbols-outlined absolute"
          style={{
            top: -20, right: -20, fontSize: 200, opacity: 0.12,
            fontVariationSettings: `'FILL' ${palette.fill}`,
            color: palette.text,
            pointerEvents: 'none',
          }}
        >
          {palette.icon}
        </span>

        <div className="relative">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide opacity-70">Ваш статус</p>
              <h2 className="text-2xl font-extrabold mt-0.5">{palette.label}</h2>
            </div>
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 44, fontVariationSettings: `'FILL' ${palette.fill}`, color: palette.text }}
            >
              {palette.icon}
            </span>
          </div>

          <div className="mt-4">
            <p className="text-xs opacity-70 mb-0.5">Баллы на счету</p>
            <p className="text-5xl font-black leading-none tracking-tight">
              {points.toLocaleString('ru-RU')}
              <span className="text-base font-bold ml-2 opacity-80">баллов</span>
            </p>
          </div>

          {/* Прогресс до следующего тира */}
          {isMax ? (
            <div className="mt-5 rounded-xl px-3 py-2.5" style={{ background: 'rgba(255,255,255,0.18)' }}>
              <p className="text-sm font-bold">Максимальный уровень — вы лучший!</p>
              <p className="text-xs opacity-80 mt-0.5">Награды и привилегии доступны без ограничений.</p>
            </div>
          ) : (
            <div className="mt-5">
              <div className="flex items-center justify-between mb-1.5 text-xs font-semibold">
                <span className="opacity-90">До {nextLabel}</span>
                <span>{toNext > 0 ? `осталось ${toNext.toLocaleString('ru-RU')}` : 'почти!'}</span>
              </div>
              <div
                className="relative w-full rounded-full overflow-hidden"
                style={{ height: 10, background: 'rgba(255,255,255,0.25)' }}
              >
                <div
                  className="loyalty-progress-fill h-full rounded-full"
                  style={{
                    width: `${progressPct}%`,
                    background: 'rgba(255,255,255,0.85)',
                  }}
                />
              </div>
              <div className="flex items-center justify-between mt-1.5 text-[11px] opacity-75">
                <span>0</span>
                {nextTierAt > 0 && <span>{nextTierAt.toLocaleString('ru-RU')}</span>}
              </div>
            </div>
          )}

          {/* Микро-сводка */}
          <div className="grid grid-cols-2 gap-2 mt-4">
            <div className="rounded-xl px-3 py-2" style={{ background: 'rgba(255,255,255,0.18)' }}>
              <p className="text-[10px] uppercase tracking-wide opacity-70">Потрачено всего</p>
              <p className="text-sm font-extrabold mt-0.5">
                {totalSpent.toLocaleString('ru-RU')} ₽
              </p>
            </div>
            <div className="rounded-xl px-3 py-2" style={{ background: 'rgba(255,255,255,0.18)' }}>
              <p className="text-[10px] uppercase tracking-wide opacity-70">В программе с</p>
              <p className="text-sm font-extrabold mt-0.5">
                {account?.joined_at
                  ? new Date(account.joined_at).toLocaleDateString('ru-RU', { month: 'short', year: 'numeric' })
                  : '—'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div
        className="flex gap-1 p-1 rounded-2xl overflow-x-auto"
        style={{ background: '#f3f4f6' }}
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
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all"
              style={{
                background: active ? '#fff' : 'transparent',
                color: active ? '#0097A7' : '#6b7280',
                boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                whiteSpace: 'nowrap',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16, fontVariationSettings: active ? "'FILL' 1" : "'FILL' 0" }}>
                {t.icon}
              </span>
              {t.label}
            </button>
          )
        })}
      </div>

      {/* ── Tab content ── */}
      <div>
        {tab === 'history' && (
          <Suspense fallback={<div className="rounded-xl h-32 animate-pulse" style={{ background: '#e5e7eb' }} />}>
            <LoyaltyTransactionsList sessionToken={sessionToken} />
          </Suspense>
        )}

        {tab === 'rewards' && (
          <Suspense fallback={<div className="rounded-xl h-32 animate-pulse" style={{ background: '#e5e7eb' }} />}>
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
            {achievements.map(a => (
              <div
                key={a.id}
                className="rounded-2xl p-3 text-center"
                style={{
                  background: a.unlocked ? '#fff' : '#f9fafb',
                  border: `1px solid ${a.unlocked ? '#e5e7eb' : '#e5e7eb'}`,
                  opacity: a.unlocked ? 1 : 0.55,
                  position: 'relative',
                }}
              >
                <span
                  className="inline-grid place-items-center mx-auto mb-2"
                  style={{
                    width: 44, height: 44, borderRadius: 999,
                    background: a.unlocked ? '#0097A715' : '#e5e7eb',
                    color: a.unlocked ? '#0097A7' : '#9ca3af',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 24, fontVariationSettings: a.unlocked ? "'FILL' 1" : "'FILL' 0" }}>
                    {a.icon}
                  </span>
                </span>
                <p className="text-[11px] font-bold text-gray-800 leading-tight">{a.label}</p>
                {a.unlocked && (
                  <span
                    className="absolute top-1.5 right-1.5 inline-grid place-items-center"
                    style={{ width: 18, height: 18, borderRadius: 999, background: '#10b981', color: '#fff' }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 12, fontVariationSettings: "'FILL' 1" }}>check</span>
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
