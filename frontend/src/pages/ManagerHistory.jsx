/**
 * ========================================
 * БЛОК: ManagerHistory (premium редизайн)
 * ========================================
 * История направлений — фильтр по статусу/датам, разворачиваемые карточки.
 * Бизнес-логика не изменена.
 * ========================================
 */
import { useEffect, useState, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getManagerReferrals } from '../api'
import { Card, Chip, Button, EmptyState, ClinicScopeSelector, QuickActions, buildPatientCardActions, Modal } from '../design'
import useClinicScope from '../lib/useClinicScope'
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
  // Если в URL пришёл patient_phone — раскрываем диапазон на «Всё время»,
  // чтобы пользователь сразу увидел всю историю по этому телефону.
  const [searchParams, setSearchParams] = useSearchParams()
  const initialPhoneFilter = (searchParams.get('patient_phone') || '').trim()
  const [phoneFilter, setPhoneFilter] = useState(initialPhoneFilter)
  const [dateFrom, setDateFrom]   = useState(initialPhoneFilter ? '' : monthAgo())
  const [dateTo, setDateTo]       = useState(initialPhoneFilter ? '' : today())
  const [page, setPage]           = useState(1)
  const [hasMore, setHasMore]     = useState(false)
  const [expanded, setExpanded]   = useState(null)
  const [qrPrint, setQrPrint]     = useState(null) // { qr_code, short_code, service_name }
  const LIMIT = 50

  // Нормализация телефона для сравнения (только цифры).
  const normPhone = (s) => (s || '').replace(/\D+/g, '')
  const filteredReferrals = useMemo(() => {
    if (!phoneFilter) return referrals
    const target = normPhone(phoneFilter)
    if (!target) return referrals
    return referrals.filter(r => normPhone(r.patient_phone).includes(target))
  }, [referrals, phoneFilter])

  const clearPhoneFilter = () => {
    setPhoneFilter('')
    // Убираем patient_phone из URL, остальные query сохраняем.
    const sp = new URLSearchParams(searchParams)
    sp.delete('patient_phone')
    setSearchParams(sp, { replace: true })
  }

  // Per-clinic scope — пробрасываем clinic_id в фильтр истории
  const scope = useClinicScope()

  const load = useCallback(async (reset = true) => {
    setLoading(true)
    const p = reset ? 1 : page + 1
    try {
      const params = { page: p, limit: LIMIT }
      if (dateFrom) params.date_from = dateFrom
      if (dateTo) params.date_to = dateTo
      if (status !== 'all') params.status = status
      if (scope.selectedId) params.clinic_id = scope.selectedId
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
  }, [status, dateFrom, dateTo, page, scope.selectedId])

  useEffect(() => { load(true) }, [status, dateFrom, dateTo, scope.selectedId])

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
      subtitle={!loading && (filteredReferrals.length === 0 ? 'Нет записей' : `Найдено: ${filteredReferrals.length}${(!phoneFilter && hasMore) ? '+' : ''}`)}
      icon="history"
    >
      {/* Селектор клиники для per-clinic скоупа */}
      {scope.clinics.length > 0 && (
        <div className="mb-3">
          <ClinicScopeSelector
            clinics={scope.clinics}
            selectedId={scope.selectedId}
            onChange={scope.setSelectedId}
            allowAll={scope.isMultiClinic}
          />
        </div>
      )}

      {/* Фильтр по телефону пациента (из URL ?patient_phone=) */}
      {phoneFilter && (
        <div className="mb-3 flex items-center gap-2">
          <Chip variant="accent">Пациент: {phoneFilter}</Chip>
          <button
            type="button"
            onClick={clearPhoneFilter}
            className="text-xs font-semibold"
            style={{ padding: '6px 10px', borderRadius: 999, background: 'var(--bg-1)', border: '1px solid var(--border)', color: 'var(--fg-2)' }}
          >
            Сбросить
          </button>
        </div>
      )}

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
      {loading && filteredReferrals.length === 0 ? (
        <Card>
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 rounded-full animate-spin" style={{ border: '3px solid var(--accent-soft)', borderTopColor: 'var(--accent)' }} />
          </div>
        </Card>
      ) : filteredReferrals.length === 0 ? (
        <Card>
          <EmptyState
            icon={<span className="material-symbols-outlined" style={{ fontSize: 28, fontVariationSettings: "'FILL' 1" }}>history</span>}
            title="Направлений не найдено"
            message={phoneFilter ? `По телефону «${phoneFilter}» направлений не найдено.` : 'Попробуйте сменить период или фильтр статуса.'}
          />
        </Card>
      ) : (
        <div className="grid gap-2">
          {filteredReferrals.map(r => {
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

                {/* ─── Quick Actions (W4): иконки прямо на карточке ─── */}
                <div className="px-4 pb-3" onClick={(e) => e.stopPropagation()}>
                  <QuickActions
                    actions={buildPatientCardActions({
                      phone: r.patient_phone,
                      onPrintQr: r.qr_code ? () => setQrPrint({
                        qr_code: r.qr_code,
                        short_code: r.short_code,
                        service_name: r.service_name,
                        patient_phone: r.patient_phone,
                      }) : undefined,
                      // reschedule/cancel неприменимы к завершённым/удалённым направлениям
                    })}
                  />
                </div>

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

      {/* ───── QR Print Modal (W4) ───── */}
      <PrintQrModal qrCtx={qrPrint} onClose={() => setQrPrint(null)} />
    </ManagerShell>
  )
}

// ─── Модалка печати QR направления (W4) ───
function PrintQrModal({ qrCtx, onClose }) {
  const handlePrint = () => {
    if (!qrCtx) return
    const w = window.open('', '_blank', 'width=420,height=600')
    if (!w) { alert('Разрешите всплывающие окна для печати'); return }
    const code = (qrCtx.short_code || '').replace(/[<>&"']/g, '')
    const svc  = (qrCtx.service_name || 'Направление').replace(/[<>&"']/g, '')
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>QR направления</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;text-align:center;padding:24px;color:#0f172a}
h1{font-size:18px;margin:0 0 8px}p{margin:4px 0;color:#475569;font-size:13px}
img{width:280px;height:280px;border:1px solid #e2e8f0;border-radius:12px;padding:12px;background:#fff;margin:16px auto;display:block}
.code{font-family:ui-monospace,monospace;font-size:24px;letter-spacing:0.18em;margin:8px 0;color:#0e7490;font-weight:700}
@media print{body{padding:0}}
</style></head><body>
<h1>${svc}</h1>
<img src="data:image/png;base64,${qrCtx.qr_code}" alt="QR"/>
${code ? `<div class="code">${code}</div>` : ''}
<p>Покажите код в регистратуре</p>
<script>setTimeout(()=>{window.print();},200);window.onafterprint=()=>window.close();</script>
</body></html>`)
    w.document.close()
  }

  return (
    <Modal
      open={!!qrCtx}
      onClose={onClose}
      title="QR направления"
      size="sm"
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>Закрыть</Button>
          <Button variant="primary" onClick={handlePrint}>
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>print</span>
            Печать
          </Button>
        </>
      }
    >
      {qrCtx && (
        <div className="text-center">
          <div className="text-sm font-semibold mb-2" style={{ color: 'var(--fg)' }}>{qrCtx.service_name || '—'}</div>
          <img
            alt="QR"
            src={`data:image/png;base64,${qrCtx.qr_code}`}
            style={{ width: 220, height: 220, margin: '0 auto', background: '#fff', padding: 8, borderRadius: 12, border: '1px solid var(--border)' }}
          />
          {qrCtx.short_code && (
            <div className="mt-3 font-mono tabular-nums" style={{ fontSize: 22, letterSpacing: '0.16em', color: 'var(--accent)' }}>
              {qrCtx.short_code}
            </div>
          )}
          {qrCtx.patient_phone && (
            <div className="mt-2 text-xs" style={{ color: 'var(--fg-3)' }}>{qrCtx.patient_phone}</div>
          )}
        </div>
      )}
    </Modal>
  )
}
