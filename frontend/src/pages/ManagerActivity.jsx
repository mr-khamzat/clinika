/**
 * ========================================
 * БЛОК: ManagerActivity (premium редизайн)
 * ========================================
 * Журнал активности менеджера: события системы по периоду, страничный пейджинг.
 * Бизнес-логика не изменена.
 * ========================================
 */
import { useEffect, useState } from 'react'
import { getActivityLog } from '../api'
import { Card, Chip, Button, EmptyState } from '../design'
import ManagerShell from './_ManagerShell'

function actionMeta(action) {
  if (!action) return { icon: 'info', color: 'var(--fg-3)', bg: 'var(--bg-2)' }
  if (action.includes('Создано')) return { icon: 'add_circle', color: 'var(--accent)', bg: 'var(--accent-soft)' }
  if (action.includes('Подтверждено')) return { icon: 'check_circle', color: 'var(--good)', bg: 'var(--good-soft)' }
  if (action.includes('отмен') || action.includes('Отмен') || action.includes('отклон'))
    return { icon: 'cancel', color: 'var(--bad)', bg: 'var(--bad-soft)' }
  if (action.includes('Выплата') || action.includes('бонус'))
    return { icon: 'payments', color: 'var(--warn)', bg: 'var(--warn-soft)' }
  return { icon: 'info', color: 'var(--fg-3)', bg: 'var(--bg-2)' }
}

function fmtDt(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return (
    d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) +
    ' ' +
    d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  )
}

export default function ManagerActivity() {
  const [logs, setLogs]       = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage]       = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo]     = useState('')
  const [error, setError]       = useState('')

  const load = async (p = 1, replace = true) => {
    setLoading(true); setError('')
    try {
      const params = { page: p, limit: 50 }
      if (dateFrom) params.date_from = dateFrom
      if (dateTo)   params.date_to   = dateTo
      const r = await getActivityLog(params)
      const items = Array.isArray(r.data) ? r.data : []
      setHasMore(items.length === 50)
      setLogs(prev => (replace ? items : [...prev, ...items]))
      setPage(p)
    } catch { setError('Ошибка загрузки журнала') } finally { setLoading(false) }
  }

  useEffect(() => { load(1, true) }, [dateFrom, dateTo])

  return (
    <ManagerShell
      active="activity"
      title="Журнал активности"
      subtitle={!loading && `${logs.length}${hasMore ? '+' : ''} событий`}
      icon="article"
    >
      {/* ─── Фильтр по датам ─── */}
      <Card className="mb-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[140px]">
            <label className="block mb-1" style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              С даты
            </label>
            <input
              type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="w-full text-sm outline-none"
              style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 9, padding: '8px 12px', color: 'var(--fg)' }}
            />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="block mb-1" style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              По дату
            </label>
            <input
              type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="w-full text-sm outline-none"
              style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 9, padding: '8px 12px', color: 'var(--fg)' }}
            />
          </div>
          {(dateFrom || dateTo) && (
            <Button variant="ghost" size="md" onClick={() => { setDateFrom(''); setDateTo('') }}>
              Сбросить
            </Button>
          )}
        </div>
      </Card>

      {error && (
        <div
          className="mb-4 rounded-xl p-3"
          style={{ background: 'var(--bad-soft)', border: '1px solid var(--bad-soft)', color: 'var(--bad)' }}
        >
          <p className="text-sm">{error}</p>
        </div>
      )}

      {loading && logs.length === 0 ? (
        <Card>
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 rounded-full animate-spin" style={{ border: '3px solid var(--accent-soft)', borderTopColor: 'var(--accent)' }} />
          </div>
        </Card>
      ) : logs.length === 0 ? (
        <Card>
          <EmptyState
            icon={<span className="material-symbols-outlined" style={{ fontSize: 28, fontVariationSettings: "'FILL' 1" }}>article</span>}
            title="Нет событий"
            message="За указанный период активность не зарегистрирована."
          />
        </Card>
      ) : (
        <>
          <Card padded={false}>
            {logs.map((log, i) => {
              const meta = actionMeta(log.action)
              return (
                <div
                  key={log.id}
                  className="flex items-start gap-3 px-4 py-3 transition-colors"
                  style={{ borderBottom: i < logs.length - 1 ? '1px solid var(--line)' : 'none' }}
                >
                  <span
                    className="inline-grid place-items-center flex-shrink-0"
                    style={{ width: 32, height: 32, borderRadius: 9, background: meta.bg, color: meta.color }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16, fontVariationSettings: "'FILL' 1" }}>
                      {meta.icon}
                    </span>
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate" style={{ color: 'var(--fg)' }}>{log.action}</div>
                    {log.user_name && (
                      <div className="text-xs" style={{ color: 'var(--fg-3)' }}>{log.user_name}</div>
                    )}
                    {log.entity_type && (
                      <div className="text-xs" style={{ color: 'var(--fg-3)' }}>{log.entity_type}</div>
                    )}
                  </div>
                  <span className="text-xs flex-shrink-0" style={{ color: 'var(--fg-3)', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtDt(log.created_at)}
                  </span>
                </div>
              )
            })}
          </Card>
          {hasMore && (
            <div className="mt-3">
              <Button variant="secondary" size="md" className="w-full" onClick={() => load(page + 1, false)} disabled={loading}>
                {loading ? 'Загрузка…' : 'Загрузить ещё'}
              </Button>
            </div>
          )}
        </>
      )}
    </ManagerShell>
  )
}
