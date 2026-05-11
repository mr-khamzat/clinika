/**
 * ========================================
 * БЛОК: AdminSystemStatusSection — мониторинг и disaster-mode (Глава 10)
 * ========================================
 * Используется в FranchiseOwnerCabinet — раздел «Состояние системы»
 * (только для super_admin).
 *
 * API:
 *   GET  /health/detailed
 *     → { database:{ok,latency_ms}, redis:{ok,latency_ms},
 *         disk:{usage_pct, free_gb}, last_migration,
 *         active_subscriptions_count, recent_error_rate,
 *         uptime_seconds, environment }
 *   GET  /admin/system/status
 *     → { disaster_mode:{enabled, enabled_at?, reason?}, ... }
 *   POST /admin/system/enable-disaster-mode  body {reason}
 *   POST /admin/system/disable-disaster-mode
 *
 * Auto-refresh: health-метрики обновляются каждые 30 секунд.
 * ========================================
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import api from '../api'
import HealthCard from '../components/system/HealthCard'
import DisasterModeToggle from '../components/system/DisasterModeToggle'

const REFRESH_MS = 30_000

function fmtUptime(seconds) {
  const s = Number(seconds || 0)
  if (!Number.isFinite(s) || s <= 0) return '—'
  const days = Math.floor(s / 86400)
  const hours = Math.floor((s % 86400) / 3600)
  const mins = Math.floor((s % 3600) / 60)
  if (days > 0) return `${days} д ${hours} ч`
  if (hours > 0) return `${hours} ч ${mins} мин`
  return `${mins} мин`
}

function fmtTime(iso) {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
  } catch { return iso }
}

export default function AdminSystemStatusSection() {
  const [health, setHealth]       = useState(null)
  const [sysStatus, setSysStatus] = useState(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const intervalRef = useRef(null)

  const load = useCallback(async (silent) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const [hR, sR] = await Promise.all([
        api.get('/health/detailed').catch(e => ({ error: e })),
        api.get('/admin/system/status').catch(e => ({ error: e })),
      ])
      if (!hR.error) setHealth(hR.data)
      if (!sR.error) setSysStatus(sR.data)
      if (hR.error && sR.error) setError('load')
      setLastUpdated(new Date())
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  // Initial + автообновление каждые 30 секунд
  useEffect(() => {
    load(false)
    intervalRef.current = setInterval(() => load(true), REFRESH_MS)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [load])

  const disaster = sysStatus?.disaster_mode || { enabled: false }

  // Recent events: пытаемся прочесть из sysStatus.recent_events; если нет —
  // показываем mock-блок (только UI-полезно для super_admin).
  const recentEvents = Array.isArray(sysStatus?.recent_events) ? sysStatus.recent_events : null

  return (
    <div className="space-y-4">
      {/* Hero card + disaster-toggle */}
      <DisasterModeToggle state={disaster} onChanged={() => load(false)} />

      {/* Refresh-banner */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-xs" style={{ color: '#64748b' }}>
          {lastUpdated && (
            <>Обновлено: <b style={{ color: '#0f172a' }}>{fmtTime(lastUpdated.toISOString())}</b> · авто-обновление каждые 30 сек</>
          )}
        </div>
        <button
          onClick={() => load(false)}
          className="inline-flex items-center gap-1.5 rounded-lg text-xs font-bold transition-all"
          style={{ padding: '6px 10px', background: '#f1f5f9', color: '#475569' }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>refresh</span>
          Обновить сейчас
        </button>
      </div>

      {loading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[0,1,2,3,4,5,6,7].map(i => <div key={i} className="h-28 rounded-2xl animate-pulse" style={{ background: '#e5e7eb' }} />)}
        </div>
      )}

      {!loading && error === 'load' && (
        <div className="rounded-2xl p-6 text-center" style={{ background: '#fef2f2', border: '1px solid #fecaca' }}>
          <span className="material-symbols-outlined text-3xl mb-2 block" style={{ color: '#991b1b' }}>error</span>
          <p className="text-sm font-semibold" style={{ color: '#991b1b' }}>Не удалось загрузить метрики системы</p>
          <p className="text-xs mt-1" style={{ color: '#991b1b' }}>
            Проверьте, что эндпойнты /health/detailed и /admin/system/status доступны
          </p>
        </div>
      )}

      {!loading && !error && health && (
        <>
          {/* Health metrics grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <HealthCard
              icon="database"
              title="База данных"
              okStatus={!!health.database?.ok}
              value={health.database?.latency_ms != null ? Number(health.database.latency_ms).toFixed(0) : null}
              unit="ms"
              hint={health.database?.ok ? 'PostgreSQL отвечает' : 'Нет соединения'}
            />
            <HealthCard
              icon="bolt"
              title="Redis"
              okStatus={!!health.redis?.ok}
              value={health.redis?.latency_ms != null ? Number(health.redis.latency_ms).toFixed(0) : null}
              unit="ms"
              hint={health.redis?.ok ? 'Cache работает' : 'Нет соединения'}
            />
            <HealthCard
              icon="hard_drive"
              title="Диск"
              value={health.disk?.usage_pct != null ? Math.round(health.disk.usage_pct) : null}
              unit="%"
              usagePct={typeof health.disk?.usage_pct === 'number' ? health.disk.usage_pct : undefined}
              hint={health.disk?.free_gb != null
                ? `${Number(health.disk.free_gb).toFixed(1)} GB свободно`
                : undefined}
            />
            <HealthCard
              icon="card_membership"
              title="Активные подписки"
              value={health.active_subscriptions_count ?? 0}
              tone="neutral"
              hint="всего по сети"
            />
            <HealthCard
              icon="timer"
              title="Uptime"
              value={fmtUptime(health.uptime_seconds)}
              tone="ok"
              hint="с момента старта процесса"
            />
            <HealthCard
              icon="error"
              title="Recent error rate"
              value={health.recent_error_rate != null
                ? Number(health.recent_error_rate).toFixed(2)
                : '0.00'}
              unit="%"
              tone={
                typeof health.recent_error_rate === 'number'
                  ? (health.recent_error_rate > 5 ? 'bad' : health.recent_error_rate > 1 ? 'warn' : 'ok')
                  : 'neutral'
              }
              hint="последние 5 мин"
            />
            <HealthCard
              icon="history_edu"
              title="Последняя миграция"
              value={health.last_migration
                ? String(health.last_migration).slice(0, 14)
                : '—'}
              tone="neutral"
              hint="alembic revision"
            />
            <HealthCard
              icon="settings_suggest"
              title="Окружение"
              value={
                <span style={{ textTransform: 'uppercase', fontSize: 14, letterSpacing: '0.04em' }}>
                  {health.environment || '—'}
                </span>
              }
              tone={health.environment === 'production' ? 'ok' : 'warn'}
              hint={health.environment === 'production'
                ? 'прод-режим, все хуки активны'
                : 'не production'}
            />
          </div>

          {/* Лог последних событий */}
          <div
            className="rounded-2xl"
            style={{ background: '#fff', border: '1px solid #e5e7eb' }}
          >
            <div className="px-4 pt-4 pb-2 flex items-center gap-2">
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#0097A7' }}>history</span>
              <span
                className="font-bold uppercase"
                style={{ fontSize: 10.5, color: '#94a3b8', letterSpacing: '0.08em' }}
              >Последние события системы</span>
            </div>

            {recentEvents && recentEvents.length > 0 ? (
              <div style={{ borderTop: '1px solid #f1f5f9' }}>
                {recentEvents.slice(0, 12).map((ev, i) => (
                  <div
                    key={i}
                    className="px-4 py-3 flex items-start gap-3"
                    style={{ borderTop: i === 0 ? 'none' : '1px solid #f8fafc' }}
                  >
                    <span
                      className="material-symbols-outlined flex-shrink-0"
                      style={{
                        fontSize: 16,
                        color: ev.severity === 'error' ? '#dc2626'
                          : ev.severity === 'warn'   ? '#d97706'
                          : '#0369a1',
                        marginTop: 2,
                      }}
                    >
                      {ev.severity === 'error' ? 'error' : ev.severity === 'warn' ? 'warning' : 'info'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm" style={{ color: '#0f172a', fontWeight: 500 }}>
                        {ev.message || ev.text || ev.title || '—'}
                      </div>
                      {ev.created_at && (
                        <div className="text-[11px] mt-0.5" style={{ color: '#64748b', fontVariantNumeric: 'tabular-nums' }}>
                          {fmtTime(ev.created_at)}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div
                className="px-4 py-8 text-center"
                style={{ borderTop: '1px solid #f1f5f9' }}
              >
                <div className="text-xs" style={{ color: '#94a3b8' }}>
                  Лог событий пока пуст — это нормально для штатного режима.
                </div>
                <div className="text-[11px] mt-1" style={{ color: '#cbd5e1' }}>
                  При инцидентах здесь будут отображаться записи (миграции, disaster on/off, критичные ошибки).
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
