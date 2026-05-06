/**
 * ========================================
 * БЛОК: ManagerBonuses (premium редизайн)
 * ========================================
 * Выплаты сотрудникам — список агрегированных бонусов с раскрытием деталей,
 * массовой выплатой и печатью акта. Бизнес-логика не изменена.
 * ========================================
 */
import { useEffect, useState, useMemo } from 'react'
import { getManagerBonuses, markAllPaid } from '../api'
import { Card, Chip, Button, Avatar, EmptyState, Tabs } from '../design'
import ManagerShell from './_ManagerShell'

function fmt(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit', year:'2-digit' })
}

export default function ManagerBonuses() {
  const [admins, setAdmins]     = useState([])
  const [loading, setLoading]   = useState(false)
  const [filter, setFilter]     = useState('pending')
  const [expanded, setExpanded] = useState(null)
  const [paying, setPaying]     = useState(null)
  const [error, setError]       = useState('')

  const load = async () => {
    setLoading(true); setError('')
    try {
      const r = await getManagerBonuses({ only_pending: filter === 'pending' })
      setAdmins(Array.isArray(r.data) ? r.data : [])
    } catch { setError('Ошибка загрузки данных') } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [filter])

  const handlePayAll = async (adminId) => {
    setPaying(adminId); setError('')
    try { await markAllPaid(adminId); await load() }
    catch (e) { setError(e.response?.data?.detail || 'Ошибка выплаты') }
    finally { setPaying(null) }
  }

  const handlePrintAct = (admin) => {
    const date = new Date().toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric' })
    const rows = admin.pending_bonuses.map(b =>
      `<tr><td style="padding:6px 8px;border:1px solid #ddd">${b.service_name}</td><td style="padding:6px 8px;border:1px solid #ddd">${b.patient_phone}</td><td style="padding:6px 8px;border:1px solid #ddd">${fmt(b.confirmed_at)}</td><td style="padding:6px 8px;border:1px solid #ddd;text-align:right">${b.amount.toLocaleString('ru-RU')} Б</td></tr>`
    ).join('')
    const total = admin.pending_total.toLocaleString('ru-RU')
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Акт о выплате бонусов</title><style>body{font-family:Arial,sans-serif;font-size:13px;padding:24px;color:#111}h2{text-align:center;margin-bottom:8px}table{width:100%;border-collapse:collapse;margin-top:16px}th{background:#f5f5f5;padding:6px 8px;border:1px solid #ddd;text-align:left}.sign{margin-top:48px;display:flex;justify-content:space-between}.sign div{width:45%}.sign span{display:block;border-top:1px solid #111;margin-top:40px;padding-top:4px;font-size:11px}</style></head><body><h2>АКТ о выплате бонусов</h2><p>Дата: <strong>${date}</strong></p><p>Сотрудник: <strong>${admin.full_name}</strong></p><p>Клиника: <strong>${admin.clinic_name}</strong></p><table><thead><tr><th>Услуга</th><th>Пациент</th><th>Дата подтв.</th><th>Сумма</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="3" style="padding:8px;border:1px solid #ddd;font-weight:bold;text-align:right">ИТОГО:</td><td style="padding:8px;border:1px solid #ddd;font-weight:bold;text-align:right">${total} Б</td></tr></tfoot></table><div class="sign"><div>Руководитель:<span>подпись / ФИО</span></div><div>Сотрудник:<span>подпись / ФИО</span></div></div></body></html>`
    const w = window.open('', '_blank'); w.document.write(html); w.document.close(); w.focus(); w.print()
  }

  const pendingTotal = useMemo(() => admins.reduce((s, a) => s + (a.pending_total || 0), 0), [admins])

  return (
    <ManagerShell
      active="bonuses"
      title="Выплаты сотрудникам"
      subtitle={pendingTotal > 0 ? `К выплате: ${pendingTotal.toLocaleString('ru-RU')} Б` : 'Нет ожидающих выплат'}
      icon="payments"
      badge={admins.length > 0 ? <Chip variant="warn">{admins.length}</Chip> : null}
    >
      {/* ─── Hero: К выплате всего ─── */}
      {pendingTotal > 0 && (
        <div
          className="mb-4 p-5 flex items-center justify-between text-white"
          style={{
            background: 'linear-gradient(135deg, var(--accent), var(--accent-2))',
            borderRadius: 'var(--radius-lg)',
            boxShadow: '0 14px 40px oklch(0.55 0.16 240 / 0.25)',
          }}
        >
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.85, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              К выплате всего
            </div>
            <div className="font-semibold mt-1" style={{ fontSize: 36, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
              {pendingTotal.toLocaleString('ru-RU')} Б
            </div>
            <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>
              {admins.length} {admins.length === 1 ? 'сотрудник' : 'сотрудников'} ожидает выплат
            </div>
          </div>
          <div
            className="inline-grid place-items-center"
            style={{ width: 56, height: 56, borderRadius: 18, background: 'oklch(1 0 0 / 0.15)' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 30, fontVariationSettings: "'FILL' 1" }}>
              payments
            </span>
          </div>
        </div>
      )}

      {/* ─── Фильтр ─── */}
      <div className="mb-4">
        <Tabs
          items={[
            { id: 'pending', label: 'Ожидают выплаты' },
            { id: 'all',     label: 'Все бонусы' },
          ]}
          value={filter}
          onChange={setFilter}
        />
      </div>

      {error && (
        <div
          className="mb-4 rounded-xl p-3"
          style={{ background: 'var(--bad-soft)', border: '1px solid var(--bad-soft)', color: 'var(--bad)' }}
        >
          <p className="text-sm">{error}</p>
        </div>
      )}

      {loading ? (
        <Card>
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 rounded-full animate-spin" style={{ border: '3px solid var(--accent-soft)', borderTopColor: 'var(--accent)' }} />
          </div>
        </Card>
      ) : admins.length === 0 ? (
        <Card>
          <EmptyState
            icon={<span className="material-symbols-outlined" style={{ fontSize: 28, fontVariationSettings: "'FILL' 1" }}>payments</span>}
            title={filter === 'pending' ? 'Нет ожидающих выплат' : 'Бонусы не найдены'}
            message="Все начисленные бонусы уже выплачены либо ещё не накоплены."
          />
        </Card>
      ) : (
        <div className="grid gap-3">
          {admins.map(a => {
            const isOpen = expanded === a.admin_id
            const bonusList = filter === 'pending' ? a.pending_bonuses : [...a.pending_bonuses, ...a.paid_bonuses]
            return (
              <Card key={a.admin_id} padded={false}>
                <button
                  className="w-full text-left p-4 transition-colors"
                  onClick={() => setExpanded(isOpen ? null : a.admin_id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar name={a.full_name || '?'} size="md" />
                      <div className="min-w-0">
                        <div className="font-semibold text-sm truncate" style={{ color: 'var(--fg)' }}>{a.full_name}</div>
                        <div className="text-xs truncate" style={{ color: 'var(--fg-3)' }}>{a.clinic_name}</div>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      {a.pending_total > 0 && (
                        <div className="font-bold" style={{ fontSize: 18, color: 'var(--warn)', fontVariantNumeric: 'tabular-nums' }}>
                          {a.pending_total.toLocaleString('ru-RU')} Б
                        </div>
                      )}
                      {a.paid_total > 0 && (
                        <div className="text-[11px] font-semibold" style={{ color: 'var(--good)' }}>
                          выплачено: {a.paid_total.toLocaleString('ru-RU')} Б
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-3 items-center">
                    {a.pending_bonuses.length > 0 && <Chip variant="warn">{a.pending_bonuses.length} ожидает</Chip>}
                    {a.paid_bonuses.length > 0 && <Chip variant="good">{a.paid_bonuses.length} выплачено</Chip>}
                    <span className="ml-auto text-xs" style={{ color: 'var(--fg-3)' }}>
                      {isOpen ? 'свернуть ▲' : 'развернуть ▼'}
                    </span>
                  </div>
                </button>

                {a.pending_total > 0 && (
                  <div className="px-4 pb-3 flex flex-wrap gap-2">
                    <Button
                      variant="primary" size="sm" className="flex-1"
                      onClick={() => handlePayAll(a.admin_id)}
                      disabled={paying === a.admin_id}
                    >
                      {paying === a.admin_id ? 'Выплата…' : `Выплатить ${a.pending_total.toLocaleString('ru-RU')} Б`}
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => handlePrintAct(a)}>
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>print</span>
                      Акт
                    </Button>
                  </div>
                )}

                {isOpen && bonusList.length > 0 && (
                  <div style={{ borderTop: '1px solid var(--line)' }}>
                    {bonusList.map((b, idx) => {
                      const isPaid = !!b.paid_at
                      return (
                        <div
                          key={b.bonus_id}
                          className="px-4 py-3 flex items-start justify-between gap-3"
                          style={{ background: idx % 2 === 0 ? 'var(--surface)' : 'var(--bg-1)' }}
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-semibold truncate" style={{ color: 'var(--fg)' }}>{b.service_name}</div>
                            <div className="text-xs" style={{ color: 'var(--fg-3)' }}>{b.patient_phone}</div>
                            <div className="text-[11px]" style={{ color: 'var(--fg-3)' }}>
                              подтв. {fmt(b.confirmed_at)}{isPaid && ` · выплачено ${fmt(b.paid_at)}`}
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <div className="text-sm font-bold" style={{ color: isPaid ? 'var(--good)' : 'var(--warn)' }}>
                              {b.amount.toLocaleString('ru-RU')} Б
                            </div>
                            <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: isPaid ? 'var(--good)' : 'var(--warn)' }}>
                              {isPaid ? 'выплачено' : 'ожидает'}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </ManagerShell>
  )
}
