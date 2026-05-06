/**
 * ========================================
 * БЛОК: ManagerHistory (premium редизайн)
 * ========================================
 * История направлений — фильтр по статусу/датам, разворачиваемые карточки.
 * Бизнес-логика не изменена.
 * ========================================
 */
import { useEffect, useState, useCallback } from 'react'
import { getManagerReferrals } from '../api'
import { Card, Chip, Button, EmptyState } from '../design'
import ManagerShell from './_ManagerShell'

const STATUS_TABS = [
  { key: 'all',              label: 'Все' },
  { key: 'created',          label: 'Создано' },
  { key: 'confirmed',        label: 'Подтверждено' },
  { key: 'expired',          label: 'Истекло' },
  { key: 'cancel_requested', label: 'На отмене' },
  { key: 'cancelled',        label: 'Удалено' },
]

const STATUS_VARIANT = {
  created: 'accent',
  confirmed: 'good',
  expired: 'default',
  cancel_requested: 'warn',
  cancelled: 'bad',
}
const STATUS_LABEL = {
  created: 'создано',
  confirmed: 'подтверждено',
  expired: 'истекло',
  cancel_requested: 'на отмене',
  cancelled: 'удалено',
}
const STATUS_BORDER = {
  created: 'var(--accent)',
  confirmed: 'var(--good)',
  expired: 'var(--fg-4)',
  cancel_requested: 'var(--warn)',
  cancelled: 'var(--bad)',
}

function fmt(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function fmtFull(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function today() { return new Date().toISOString().slice(0, 10) }
function weekAgo() { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10) }
function monthAgo() { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10) }

function Row({ label, value, color }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-xs flex-shrink-0" style={{ color: 'var(--fg-3)' }}>{label}</span>
      <span className="text-xs font-medium text-right" style={{ color: color || 'var(--fg-2)' }}>{value || '—'}</span>
    </div>
  )
}

export default function ManagerHistory() {
  const [referrals, setReferrals] = useState([])
  const [loading, setLoading]     = useState(false)
  const [status, setStatus]       = useState('all')
  const [dateFrom, setDateFrom]   = useState(monthAgo())
  const [dateTo, setDateTo]       = useState(today())
  const [page, setPage]           = useState(1)
  const [hasMore, setHasMore]     = useState(false)
  const [expanded, setExpanded]   = useState(null)
  const LIMIT = 50

  const load = useCallback(async (reset = true) => {
    setLoading(true)
    const p = reset ? 1 : page + 1
    try {
      const params = { page: p, limit: LIMIT }
      if (dateFrom) params.date_from = dateFrom
      if (dateTo) params.date_to = dateTo
      if (status !== 'all') params.status = status
      const res = await getManagerReferrals(params)
      const data = Array.isArray(res.data) ? res.data : []
      if (reset) {
        setReferrals(data); setPage(1)
      } else {
        setReferrals(prev => [...prev, ...data]); setPage(p)
      }
      setHasMore(data.length === LIMIT)
    } catch {
      if (reset) setReferrals([])
    } finally {
      setLoading(false)
    }
  }, [status, dateFrom, dateTo, page])

  useEffect(() => { load(true) }, [status, dateFrom, dateTo])

  const setPreset = (preset) => {
    if (preset === 'today') { setDateFrom(today()); setDateTo(today()) }
    else if (preset === 'week') { setDateFrom(weekAgo()); setDateTo(today()) }
    else if (preset === 'month') { setDateFrom(monthAgo()); setDateTo(today()) }
    else { setDateFrom(''); setDateTo('') }
  }

  return (
    <ManagerShell
      active="history"
      title="История направлений"
      subtitle={!loading && (referrals.length === 0 ? 'Нет записей' : `Найдено: ${referrals.length}${hasMore ? '+' : ''}`)}
      icon="history"
    >
      {/* ─── Пресеты периода ─── */}
      <Card className="mb-3">
        <div className="flex flex-wrap gap-2">
          {[['today', 'Сегодня'], ['week', '7 дней'], ['month', 'Месяц'], ['all', 'Всё время']].map(([p, l]) => (
            <button
              key={p}
              onClick={() => setPreset(p)}
              className="text-xs font-semibold transition-colors"
              style={{
                padding: '7px 14px', borderRadius: 999,
                background: 'var(--bg-1)', border: '1px solid var(--border)', color: 'var(--fg-2)',
              }}
            >
              {l}
            </button>
          ))}
          <div className="flex gap-2 flex-1 min-w-[260px]">
            <input
              type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="text-xs outline-none flex-1 min-w-[120px]"
              style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 9, padding: '7px 10px', color: 'var(--fg)' }}
            />
            <input
              type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="text-xs outline-none flex-1 min-w-[120px]"
              style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 9, padding: '7px 10px', color: 'var(--fg)' }}
            />
          </div>
        </div>
      </Card>

      {/* ─── Статус-табы ─── */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1 scrollbar-none">
        {STATUS_TABS.map(t => {
          const active = status === t.key
          return (
            <button
              key={t.key}
              onClick={() => setStatus(t.key)}
              className="flex-shrink-0 text-xs font-semibold transition-colors"
              style={{
                padding: '8px 14px', borderRadius: 999,
                background: active ? 'var(--accent)' : 'var(--bg-1)',
                color: active ? 'var(--accent-fg)' : 'var(--fg-2)',
                border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                boxShadow: active ? '0 4px 12px oklch(0.55 0.16 240 / 0.20)' : 'none',
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {/* ─── Список ─── */}
      {loading && referrals.length === 0 ? (
        <Card>
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 rounded-full animate-spin" style={{ border: '3px solid var(--accent-soft)', borderTopColor: 'var(--accent)' }} />
          </div>
        </Card>
      ) : referrals.length === 0 ? (
        <Card>
          <EmptyState
            icon={<span className="material-symbols-outlined" style={{ fontSize: 28, fontVariationSettings: "'FILL' 1" }}>history</span>}
            title="Направлений не найдено"
            message="Попробуйте сменить период или фильтр статуса."
          />
        </Card>
      ) : (
        <div className="grid gap-2">
          {referrals.map(r => {
            const isOpen = expanded === r.id
            const isCancelled = r.status === 'cancelled'
            const isCancelReq = r.status === 'cancel_requested'
            return (
              <Card
                key={r.id}
                padded={false}
                style={{ borderLeft: `3px solid ${STATUS_BORDER[r.status] || 'var(--accent)'}` }}
              >
                <button className="w-full text-left p-4" onClick={() => setExpanded(isOpen ? null : r.id)}>
                  <div className="flex justify-between items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm truncate" style={{ color: 'var(--fg)' }}>{r.service_name}</div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--fg-3)' }}>{r.patient_phone}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <Chip variant={STATUS_VARIANT[r.status] || 'default'}>
                        {STATUS_LABEL[r.status] || r.status}
                      </Chip>
                      <span className="text-xs" style={{ color: 'var(--fg-3)' }}>{fmt(r.created_at)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-2 text-xs" style={{ color: 'var(--fg-3)' }}>
                    <span className="truncate">{r.from_clinic_name}</span>
                    <span>→</span>
                    <span className="truncate">{r.to_clinic_name}</span>
                  </div>
                </button>

                {isOpen && (
                  <div className="px-4 pb-4 pt-3 space-y-2" style={{ borderTop: '1px solid var(--line)' }}>
                    <Row label="Сотрудник" value={r.creator_name} />
                    <Row label="Создано" value={fmtFull(r.created_at)} />
                    {r.confirmed_at && <Row label="Подтверждено" value={fmtFull(r.confirmed_at)} color="var(--good)" />}
                    {r.expires_at && r.status === 'created' && <Row label="Истекает" value={fmtFull(r.expires_at)} />}
                    {r.bonus_amount != null && (
                      <Row
                        label="Бонус"
                        value={`${r.bonus_amount} Б (${r.bonus_status === 'PAID' ? 'выплачен' : 'в ожидании'})`}
                        color={r.bonus_status === 'PAID' ? 'var(--good)' : 'var(--warn)'}
                      />
                    )}
                    {(isCancelReq || isCancelled) && (
                      <>
                        {r.cancel_requested_at && <Row label="Запрос на удаление" value={fmtFull(r.cancel_requested_at)} />}
                        {r.cancel_reason && (
                          <div className="p-2.5 mt-1" style={{ background: 'var(--warn-soft)', borderRadius: 9 }}>
                            <div className="text-[10px] font-bold uppercase tracking-wider mb-0.5" style={{ color: 'var(--warn)' }}>Причина</div>
                            <div className="text-sm" style={{ color: 'var(--warn)' }}>«{r.cancel_reason}»</div>
                          </div>
                        )}
                        {isCancelled && r.cancelled_at && (
                          <Row
                            label="Удалено"
                            value={`${fmtFull(r.cancelled_at)}${r.canceller_name ? ` (${r.canceller_name})` : ''}`}
                            color="var(--bad)"
                          />
                        )}
                      </>
                    )}
                    {r.notes && <Row label="Примечание" value={r.notes} />}
                  </div>
                )}
              </Card>
            )
          })}

          {hasMore && (
            <div className="mt-2">
              <Button variant="secondary" size="md" className="w-full" onClick={() => load(false)} disabled={loading}>
                {loading ? 'Загрузка…' : 'Загрузить ещё'}
              </Button>
            </div>
          )}
        </div>
      )}
    </ManagerShell>
  )
}
