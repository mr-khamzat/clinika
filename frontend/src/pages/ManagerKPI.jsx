/**
 * ========================================
 * БЛОК: ManagerKPI (premium редизайн)
 * ========================================
 * Цели/KPI сотрудников по месяцам: установка целей и просмотр прогресса.
 * Бизнес-логика не изменена.
 * ========================================
 */
import { useEffect, useState } from 'react'
import { getKpi, setKpi } from '../api'
import { Card, Button, Avatar, EmptyState } from '../design'
import ManagerShell from './_ManagerShell'

function KpiBar({ label, actual, target, pct, color = 'var(--accent)' }) {
  const safePct = Math.min(Math.max(pct || 0, 0), 100)
  return (
    <div>
      <div className="flex justify-between text-xs mb-1.5" style={{ fontVariantNumeric: 'tabular-nums' }}>
        <span style={{ color: 'var(--fg-3)', fontWeight: 500 }}>{label}</span>
        <span style={{ color: 'var(--fg)', fontWeight: 700 }}>
          {actual} / {target || '—'}{target > 0 && ` · ${pct}%`}
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: 'var(--bg-2)', overflow: 'hidden' }}>
        <div
          style={{
            height: '100%', borderRadius: 999, width: `${safePct}%`,
            background: `linear-gradient(90deg, ${color}, var(--accent-2))`,
            transition: 'width 600ms ease',
          }}
        />
      </div>
    </div>
  )
}

export default function ManagerKPI() {
  const [kpiList, setKpiList]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(null)
  const [editing, setEditing]   = useState(null)
  const [editForm, setEditForm] = useState({ target_referrals: '', target_confirmed: '' })
  const [error, setError]       = useState('')
  const [savedMsg, setSavedMsg] = useState('')

  const today = new Date()
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  const [month, setMonth] = useState(currentMonth)

  const load = async () => {
    setLoading(true); setError('')
    try { const r = await getKpi(month); setKpiList(Array.isArray(r.data) ? r.data : []) }
    catch { setError('Ошибка загрузки KPI') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [month])

  const handleSave = async (adminId) => {
    setSaving(adminId); setError('')
    try {
      await setKpi(adminId, {
        target_referrals: parseInt(editForm.target_referrals) || 0,
        target_confirmed: parseInt(editForm.target_confirmed) || 0,
        month,
      })
      setSavedMsg('Сохранено'); setTimeout(() => setSavedMsg(''), 2000); setEditing(null); await load()
    } catch { setError('Ошибка сохранения') } finally { setSaving(null) }
  }

  return (
    <ManagerShell
      active="kpi"
      title="KPI / план"
      subtitle="Цели сотрудников по месяцам"
      icon="emoji_events"
    >
      {/* ─── Выбор месяца ─── */}
      <Card className="mb-4">
        <div className="flex items-center gap-3 flex-wrap">
          <span
            className="inline-grid place-items-center flex-shrink-0"
            style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--accent-soft)', color: 'var(--accent)' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20, fontVariationSettings: "'FILL' 1" }}>calendar_month</span>
          </span>
          <div className="flex-1 min-w-[160px]">
            <label className="block mb-1" style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Период
            </label>
            <input
              type="month" value={month} onChange={e => setMonth(e.target.value)}
              className="w-full text-sm outline-none"
              style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 9, padding: '8px 12px', color: 'var(--fg)' }}
            />
          </div>
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
      {savedMsg && (
        <div
          className="mb-4 rounded-xl p-3 flex items-center gap-2"
          style={{ background: 'var(--good-soft)', border: '1px solid var(--good-soft)', color: 'var(--good)' }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}>check_circle</span>
          <p className="text-sm font-medium">{savedMsg}</p>
        </div>
      )}

      {loading ? (
        <Card>
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 rounded-full animate-spin" style={{ border: '3px solid var(--accent-soft)', borderTopColor: 'var(--accent)' }} />
          </div>
        </Card>
      ) : kpiList.length === 0 ? (
        <Card>
          <EmptyState
            icon={<span className="material-symbols-outlined" style={{ fontSize: 28, fontVariationSettings: "'FILL' 1" }}>emoji_events</span>}
            title="Нет сотрудников"
            message="Добавьте администраторов в клиники, чтобы устанавливать цели и отслеживать KPI."
          />
        </Card>
      ) : (
        <div className="grid gap-3">
          {kpiList.map(item => {
            const isEditing = editing === item.admin_id
            return (
              <Card key={item.admin_id}>
                <div className="flex justify-between items-start mb-3 gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar name={item.admin_name || '?'} size="md" />
                    <div className="min-w-0">
                      <div className="font-semibold text-sm truncate" style={{ color: 'var(--fg)' }}>{item.admin_name}</div>
                      <div className="text-xs truncate" style={{ color: 'var(--fg-3)' }}>{item.clinic_name}</div>
                    </div>
                  </div>
                  <Button
                    variant={isEditing ? 'secondary' : 'ghost'} size="sm"
                    onClick={() => isEditing
                      ? setEditing(null)
                      : (setEditing(item.admin_id),
                         setEditForm({ target_referrals: String(item.target_referrals), target_confirmed: String(item.target_confirmed) }))
                    }
                  >
                    {isEditing ? 'Отмена' : 'Изменить'}
                  </Button>
                </div>

                {isEditing ? (
                  <div className="space-y-3 p-3" style={{ background: 'var(--bg-1)', borderRadius: 12 }}>
                    <div>
                      <label className="block mb-1" style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Цель — направлений
                      </label>
                      <input
                        type="number" min="0" value={editForm.target_referrals}
                        onChange={e => setEditForm(f => ({ ...f, target_referrals: e.target.value }))}
                        className="w-full text-sm outline-none"
                        style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 9, padding: '8px 12px', color: 'var(--fg)' }}
                      />
                    </div>
                    <div>
                      <label className="block mb-1" style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Цель — подтверждено
                      </label>
                      <input
                        type="number" min="0" value={editForm.target_confirmed}
                        onChange={e => setEditForm(f => ({ ...f, target_confirmed: e.target.value }))}
                        className="w-full text-sm outline-none"
                        style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 9, padding: '8px 12px', color: 'var(--fg)' }}
                      />
                    </div>
                    <Button
                      variant="primary" size="md" className="w-full"
                      onClick={() => handleSave(item.admin_id)}
                      disabled={saving === item.admin_id}
                    >
                      {saving === item.admin_id ? 'Сохранение…' : 'Сохранить'}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <KpiBar label="Направлений" actual={item.actual_referrals} target={item.target_referrals} pct={item.progress_refs_pct} color="var(--accent)" />
                    <KpiBar label="Подтверждено" actual={item.actual_confirmed} target={item.target_confirmed} pct={item.progress_conf_pct} color="var(--good)" />
                    {!item.target_referrals && !item.target_confirmed && (
                      <p className="text-xs text-center pt-1" style={{ color: 'var(--fg-3)' }}>Цели не установлены</p>
                    )}
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
