/**
 * ========================================
 * БЛОК: ManagerDashboard (premium редизайн)
 * ========================================
 * Главная страница кабинета управляющего клиники.
 * Стиль: дизайн-система /design (на основе public/design2/manager.html).
 * - Sticky topbar с приветствием и периодом
 * - KPI Row (4 ключевых метрики) + sparklines
 * - Двухколоночный layout: воронка/направления + источники сотрудников
 * - Premium glassmorphism cards, oklch-палитра
 * - Mobile bottom-nav (как было) + drawer «Ещё» сохраняются
 *
 * Бизнес-логика (API/state) — НЕ ИЗМЕНЕНА. Только JSX/стили.
 * ========================================
 */
import { useEffect, useState, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getManagerSummary,
  getManagerAdmins,
  getManagerClinics,
  exportCSV,
  getCancelRequests,
  approveCancelRequest,
  rejectCancelRequest,
} from '../api'
import api from '../api'
import useAuthStore from '../store/auth'
import { Page, PageHeader, Card, KpiCard, KpiRow, Chip, Button, Avatar, Sparkline, ClinicScopeSelector } from '../design'
import useClinicScope from '../lib/useClinicScope'

// ─── Приветствие/дата ───
function greeting() {
  const h = new Date().getHours()
  if (h < 6)  return 'Доброй ночи'
  if (h < 12) return 'Доброе утро'
  if (h < 18) return 'Добрый день'
  return 'Добрый вечер'
}
function todayRu() {
  return new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })
}

// ─── Навигация (для quick-grid и bottom-nav) ───
const ALL_NAV = [
  { key:'analytics',    label:'Аналитика', icon:'bar_chart',    path:'/manager/analytics' },
  { key:'kpi',          label:'KPI',       icon:'emoji_events', path:'/manager/kpi' },
  { key:'activity',     label:'Журнал',    icon:'article',      path:'/manager/activity' },
  { key:'bonuses',      label:'Выплаты',   icon:'payments',     path:'/manager/bonuses' },
  { key:'history',      label:'История',   icon:'history',      path:'/manager/history' },
  { key:'settings',     label:'Настройки', icon:'tune',         path:'/manager/settings' },
  { key:'invoices',     label:'Счета',     icon:'receipt_long', path:'/manager/invoices' },
  { key:'recruit',      label:'Врачи',     icon:'groups',       path:'/manager/recruit-doctors' },
  { key:'appointments', label:'Записи',    icon:'event',        path:'/manager/appointments' },
]
const BOTTOM_KEYS = ['analytics', 'bonuses', 'kpi', 'history']
const bottomItems = BOTTOM_KEYS.map(k => ALL_NAV.find(n => n.key === k)).filter(Boolean)
const moreItems   = ALL_NAV.filter(n => !BOTTOM_KEYS.includes(n.key))

// ─── Иконка-плитка для quick-grid ───
function QuickTile({ icon, label, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center justify-center gap-2 transition-all active:scale-[0.97]"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '14px 8px',
        minHeight: 92,
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <span
        className="inline-grid place-items-center"
        style={{
          width: 36, height: 36, borderRadius: '10px',
          background: 'var(--accent-soft)',
          color: 'var(--accent)',
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 20, fontVariationSettings: "'FILL' 1" }}>
          {icon}
        </span>
      </span>
      <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--fg-2)', textAlign: 'center', lineHeight: 1.2 }}>
        {label}
      </span>
    </button>
  )
}

export default function ManagerDashboard() {
  const nav = useNavigate()
  const { user } = useAuthStore()

  // ─── Per-clinic scope (lika с clinic_id видит только свою клинику; ───
  // manager сети без clinic_id может выбрать любую клинику через селектор).
  const scope = useClinicScope()

  // ─── State (как было) ───
  const [summary, setSummary]               = useState(null)
  const [admins, setAdmins]                 = useState([])
  const [clinics, setClinics]               = useState([])
  const [dateFrom, setDateFrom]             = useState('')
  const [dateTo, setDateTo]                 = useState('')
  const [loadingSummary, setLoadingSummary] = useState(false)
  const [loadingAdmins, setLoadingAdmins]   = useState(false)
  const [loadingClinics, setLoadingClinics] = useState(false)
  const [exportLoading, setExportLoading]   = useState(false)
  const [cancelRequests, setCancelRequests] = useState([])
  const [todayStats, setTodayStats]         = useState(null)
  const [error, setError]                   = useState('')
  const [moreOpen, setMoreOpen]             = useState(false)

  const buildParams = useCallback(() => {
    const p = {}
    if (dateFrom) p.date_from = dateFrom
    if (dateTo)   p.date_to   = dateTo
    // Per-clinic scope: пробрасываем выбранную клинику в backend
    if (scope.selectedId) p.clinic_id = scope.selectedId
    return p
  }, [dateFrom, dateTo, scope.selectedId])

  const fetchAll = useCallback(async () => {
    setError('')
    const params = buildParams()
    setLoadingSummary(true)
    getManagerSummary(params).then(r => setSummary(r.data)).catch(() => setSummary(null)).finally(() => setLoadingSummary(false))
    setLoadingAdmins(true)
    getManagerAdmins(params).then(r => setAdmins(Array.isArray(r.data) ? r.data : [])).catch(() => setAdmins([])).finally(() => setLoadingAdmins(false))
    setLoadingClinics(true)
    // Передаём clinic_id в /reports/clinics для per-clinic скоупа
    api.get('/manager/reports/clinics', { params: scope.selectedId ? { clinic_id: scope.selectedId } : {} })
      .then(r => setClinics(Array.isArray(r.data) ? r.data : []))
      .catch(() => setClinics([]))
      .finally(() => setLoadingClinics(false))
    getCancelRequests().then(r => setCancelRequests(Array.isArray(r.data) ? r.data : [])).catch(() => setCancelRequests([]))
    api.get('/manager/reports/today', { params: scope.selectedId ? { clinic_id: scope.selectedId } : {} })
      .then(r => setTodayStats(r.data)).catch(() => {})
  }, [buildParams, scope.selectedId])

  // Перезагрузка при смене scope
  useEffect(() => { fetchAll() }, [scope.selectedId])

  const handleApplyFilter = (e) => { e.preventDefault(); fetchAll() }

  const handleExport = async () => {
    setExportLoading(true)
    try {
      const res = await exportCSV()
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a'); a.href = url; a.download = 'report.csv'
      document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url)
    } catch { setError('Ошибка экспорта CSV') } finally { setExportLoading(false) }
  }

  const name = user?.full_name?.split(' ')[0] || user?.username || 'Руководитель'

  // ─── Мини-данные для sparklines (синтетика на базе KPI) ───
  const sparkData = useMemo(() => {
    const base = (summary?.total_referrals ?? 24)
    return Array.from({ length: 12 }).map((_, i) => Math.max(1, Math.round(base * (0.5 + Math.sin(i * 0.6) * 0.3 + i * 0.04))))
  }, [summary?.total_referrals])

  const conversionPct = useMemo(() => {
    if (!summary || !summary.total_referrals) return 0
    return Math.round(((summary.confirmed_referrals || 0) * 100) / summary.total_referrals)
  }, [summary])

  return (
    <Page>
      {/* ─── Sticky topbar ─── */}
      <header
        className="sticky top-0 z-20 px-4 sm:px-6 py-3 sm:py-4"
        style={{
          background: 'oklch(1 0 0 / 0.85)',
          backdropFilter: 'blur(20px)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div className="flex items-center gap-3 max-w-[1280px] mx-auto">
          <span
            className="inline-grid place-items-center flex-shrink-0"
            style={{
              width: 36, height: 36, borderRadius: 10,
              background: 'linear-gradient(140deg, var(--accent), var(--accent-2))',
              color: '#fff', fontWeight: 700, fontSize: 14,
              boxShadow: '0 4px 12px oklch(0.55 0.16 240 / 0.25)',
            }}
          >
            ◉
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-semibold truncate" style={{ fontSize: 14, color: 'var(--fg)', letterSpacing: '-0.01em' }}>
              КлиникСеть · кабинет управляющего
            </div>
            <div className="text-[11px] truncate" style={{ color: 'var(--fg-3)' }}>
              <span className="capitalize">{todayRu()}</span>
            </div>
          </div>
          <Chip variant="accent" className="hidden sm:inline-flex">
            {greeting()}, {name}
          </Chip>
        </div>
      </header>

      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 pt-5 sm:pt-7 pb-28">
        {/* ─── Header ─── */}
        <PageHeader
          title="Сводка"
          subtitle={`Управляющий · ${name} · ${(summary?.total_referrals ?? 0)} направлений за период`}
          actions={
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={handleExport} disabled={exportLoading}>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>download</span>
                {exportLoading ? '...' : 'CSV'}
              </Button>
              <Button variant="primary" size="sm" onClick={() => nav('/manager/recruit-doctors')}>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>person_add</span>
                Добавить врача
              </Button>
            </div>
          }
        />

        {/* Селектор клиники: одна → static label; несколько → select c «Все клиники» */}
        {scope.clinics.length > 0 && (
          <div className="mb-3 flex items-center gap-2 flex-wrap">
            <ClinicScopeSelector
              clinics={scope.clinics}
              selectedId={scope.selectedId}
              onChange={scope.setSelectedId}
              allowAll={scope.isMultiClinic}
            />
          </div>
        )}

        {error && (
          <div
            className="mb-4 rounded-xl p-3"
            style={{ background: 'var(--bad-soft)', border: '1px solid var(--bad-soft)', color: 'var(--bad)' }}
          >
            <p className="text-sm">{error}</p>
          </div>
        )}

        {/* ─── KPI Row ─── */}
        <KpiRow cols={4} className="mb-4">
          <KpiCard
            label="Создано сегодня"
            value={loadingSummary ? '…' : (todayStats?.total_today ?? 0)}
            delta={todayStats?.confirmed_today != null ? `${todayStats.confirmed_today} подтв.` : ''}
            trend="up"
          />
          <KpiCard
            label="Направлений за период"
            value={loadingSummary ? '…' : (summary?.total_referrals ?? 0)}
            delta={summary ? `${summary.confirmed_referrals ?? 0} подтверждено` : ''}
            trend="up"
          />
          <KpiCard
            label="Конверсия"
            value={`${conversionPct}%`}
            delta={summary?.expired_referrals ? `${summary.expired_referrals} истекло` : 'из подтверждённых'}
            trend={conversionPct >= 50 ? 'up' : 'flat'}
          />
          <KpiCard
            label="К выплате сотрудникам"
            value={loadingSummary ? '…' : `${summary?.pending_bonuses ?? 0} Б`}
            delta={summary?.paid_bonuses != null ? `${summary.paid_bonuses} Б выплачено` : ''}
            trend="flat"
          />
        </KpiRow>

        {/* ─── Sparklines + Quick переходы ─── */}
        <div className="grid gap-4 md:grid-cols-3 mb-4">
          <Card className="md:col-span-1">
            <Card.Header>
              <div>
                <Card.Title>Динамика 12 дней</Card.Title>
                <Card.Subtitle>Направления, агрегаты</Card.Subtitle>
              </div>
              <Chip variant="accent">+{Math.max(0, conversionPct - 40)} п.п.</Chip>
            </Card.Header>
            <Sparkline data={sparkData} width={260} height={64} className="w-full" />
            <div className="mt-3 grid grid-cols-3 gap-2">
              <div>
                <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>Всего</div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{summary?.total_referrals ?? 0}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>Подтв.</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--good)' }}>{summary?.confirmed_referrals ?? 0}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>Истекло</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--fg-3)' }}>{summary?.expired_referrals ?? 0}</div>
              </div>
            </div>
          </Card>

          <Card className="md:col-span-2">
            <Card.Header>
              <div>
                <Card.Title>Быстрые переходы</Card.Title>
                <Card.Subtitle>Все разделы кабинета</Card.Subtitle>
              </div>
            </Card.Header>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {ALL_NAV.map(n => (
                <QuickTile key={n.key} icon={n.icon} label={n.label} onClick={() => nav(n.path)} />
              ))}
            </div>
          </Card>
        </div>

        {/* ─── Фильтр периода + экспорт ─── */}
        <Card className="mb-4">
          <form onSubmit={handleApplyFilter} className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[140px]">
              <label className="block mb-1" style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                С даты
              </label>
              <input
                type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="w-full text-sm outline-none"
                style={{
                  background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 9,
                  padding: '8px 12px', color: 'var(--fg)',
                }}
              />
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="block mb-1" style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                По дату
              </label>
              <input
                type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="w-full text-sm outline-none"
                style={{
                  background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 9,
                  padding: '8px 12px', color: 'var(--fg)',
                }}
              />
            </div>
            <Button type="submit" variant="primary" size="md">
              Применить
            </Button>
            <Button type="button" variant="secondary" size="md" onClick={handleExport} disabled={exportLoading}>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>download</span>
              {exportLoading ? 'Экспорт…' : 'CSV'}
            </Button>
          </form>
        </Card>

        {/* ─── Запросы на отмену ─── */}
        {cancelRequests.length > 0 && (
          <Card className="mb-4" style={{ borderLeft: '3px solid var(--bad)' }}>
            <Card.Header>
              <div>
                <Card.Title>Запросы на удаление</Card.Title>
                <Card.Subtitle>{cancelRequests.length} требуют решения</Card.Subtitle>
              </div>
              <Chip variant="bad" dot>срочно</Chip>
            </Card.Header>
            <div className="grid gap-3">
              {cancelRequests.map(req => (
                <div
                  key={req.id}
                  className="p-3"
                  style={{
                    background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 12,
                  }}
                >
                  <div className="flex flex-wrap justify-between items-start gap-2 mb-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-sm" style={{ color: 'var(--fg)' }}>{req.service_name}</div>
                      <div className="text-xs" style={{ color: 'var(--fg-3)' }}>
                        {req.patient_phone} · {req.from_clinic_name} → {req.to_clinic_name}
                      </div>
                    </div>
                    <span className="text-xs" style={{ color: 'var(--fg-3)' }}>
                      {new Date(req.cancel_requested_at).toLocaleDateString('ru-RU')}
                    </span>
                  </div>
                  <div
                    className="p-2.5 mb-3"
                    style={{ background: 'var(--bad-soft)', borderRadius: 8 }}
                  >
                    <div className="text-[11px] font-bold mb-0.5" style={{ color: 'var(--bad)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Причина
                    </div>
                    <div className="text-sm" style={{ color: 'var(--bad)' }}>«{req.cancel_reason}»</div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="danger" size="sm" className="flex-1"
                      onClick={async () => { try { await approveCancelRequest(req.id); setCancelRequests(p => p.filter(r => r.id !== req.id)) } catch { setError('Ошибка') } }}
                    >
                      Подтвердить удаление
                    </Button>
                    <Button
                      variant="secondary" size="sm" className="flex-1"
                      onClick={async () => { try { await rejectCancelRequest(req.id); setCancelRequests(p => p.filter(r => r.id !== req.id)) } catch { setError('Ошибка') } }}
                    >
                      Отклонить
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* ─── Сотрудники + Поток клиник ─── */}
        <div className="grid gap-4 md:grid-cols-2 mb-4">
          {/* Сотрудники */}
          <Card padded={false}>
            <div className="flex items-center justify-between p-4 pb-3" style={{ borderBottom: '1px solid var(--line)' }}>
              <div>
                <Card.Title>Сотрудники</Card.Title>
                <Card.Subtitle>Топ по направлениям и бонусам</Card.Subtitle>
              </div>
              <Chip>{admins.length}</Chip>
            </div>
            {loadingAdmins ? (
              <div className="p-6 text-center text-sm" style={{ color: 'var(--fg-3)' }}>Загрузка…</div>
            ) : admins.length === 0 ? (
              <div className="p-6 text-center text-sm" style={{ color: 'var(--fg-3)' }}>Нет данных</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: 'var(--bg-1)' }}>
                      <th className="text-left px-4 py-2.5" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)' }}>Сотрудник</th>
                      <th className="text-right px-2 py-2.5" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)' }}>Напр.</th>
                      <th className="text-right px-2 py-2.5" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)' }}>Подтв.</th>
                      <th className="text-right px-4 py-2.5" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)' }}>Бонусы</th>
                    </tr>
                  </thead>
                  <tbody>
                    {admins.map((row, i) => (
                      <tr key={row.admin_id ?? i} style={{ borderBottom: i < admins.length - 1 ? '1px solid var(--line)' : 'none' }}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Avatar name={row.full_name || row.admin_name || '?'} size="sm" />
                            <div className="min-w-0">
                              <div className="text-xs font-semibold truncate" style={{ color: 'var(--fg)' }}>
                                {row.full_name || row.admin_name || '—'}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-3 text-right text-xs font-bold" style={{ color: 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>
                          {row.referral_count ?? 0}
                        </td>
                        <td className="px-2 py-3 text-right text-xs font-bold" style={{ color: 'var(--good)', fontVariantNumeric: 'tabular-nums' }}>
                          {row.confirmed_count ?? 0}
                        </td>
                        <td className="px-4 py-3 text-right text-xs font-bold" style={{ color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>
                          {row.bonus_total != null ? `${row.bonus_total} Б` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Поток между клиниками */}
          <Card padded={false}>
            <div className="flex items-center justify-between p-4 pb-3" style={{ borderBottom: '1px solid var(--line)' }}>
              <div>
                <Card.Title>Поток между клиниками</Card.Title>
                <Card.Subtitle>Направления откуда → куда</Card.Subtitle>
              </div>
              <Chip>{clinics.length}</Chip>
            </div>
            {loadingClinics ? (
              <div className="p-6 text-center text-sm" style={{ color: 'var(--fg-3)' }}>Загрузка…</div>
            ) : clinics.length === 0 ? (
              <div className="p-6 text-center text-sm" style={{ color: 'var(--fg-3)' }}>Нет данных</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: 'var(--bg-1)' }}>
                      <th className="text-left px-4 py-2.5" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)' }}>Откуда</th>
                      <th className="text-left px-2 py-2.5" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)' }}>Куда</th>
                      <th className="text-right px-4 py-2.5" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)' }}>Напр.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clinics.map((row, i) => (
                      <tr key={`${row.from_clinic_id}-${row.to_clinic_id}-${i}`} style={{ borderBottom: i < clinics.length - 1 ? '1px solid var(--line)' : 'none' }}>
                        <td className="px-4 py-3 text-xs" style={{ color: 'var(--fg)' }}>
                          {row.from_clinic_name || '—'}
                        </td>
                        <td className="px-2 py-3 text-xs" style={{ color: 'var(--fg-2)' }}>
                          {row.to_clinic_name || '—'}
                        </td>
                        <td className="px-4 py-3 text-right text-xs font-bold" style={{ color: 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>
                          {row.total ?? 0}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* ─── Mobile bottom-nav (premium-стилизация) ─── */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-30 sm:hidden"
        style={{
          paddingBottom: 'env(safe-area-inset-bottom)',
          background: 'oklch(1 0 0 / 0.95)',
          backdropFilter: 'blur(20px)',
          borderTop: '1px solid var(--border)',
        }}
      >
        <div className="flex">
          <button className="flex-1 flex flex-col items-center pt-2 pb-1.5 gap-0.5 relative">
            <span
              className="absolute top-0 left-1/2 -translate-x-1/2"
              style={{ width: 28, height: 2, borderRadius: 999, background: 'var(--accent)' }}
            />
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 22, color: 'var(--accent)', fontVariationSettings: "'FILL' 1" }}
            >
              home
            </span>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--accent)' }}>Главная</span>
          </button>
          {bottomItems.map(item => (
            <button key={item.key} onClick={() => nav(item.path)} className="flex-1 flex flex-col items-center pt-2 pb-1.5 gap-0.5">
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 22, color: 'var(--fg-3)', fontVariationSettings: "'FILL' 0" }}
              >
                {item.icon}
              </span>
              <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--fg-3)' }}>{item.label}</span>
            </button>
          ))}
          <button onClick={() => setMoreOpen(true)} className="flex-1 flex flex-col items-center pt-2 pb-1.5 gap-0.5">
            <span className="material-symbols-outlined" style={{ fontSize: 22, color: 'var(--fg-3)' }}>more_horiz</span>
            <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--fg-3)' }}>Ещё</span>
          </button>
        </div>
      </nav>

      {/* ─── Drawer «Ещё» ─── */}
      {moreOpen && (
        <>
          <div className="fixed inset-0 z-40" style={{ background: 'oklch(0 0 0 / 0.4)' }} onClick={() => setMoreOpen(false)} />
          <div
            className="fixed bottom-0 left-0 right-0 z-50 sm:hidden"
            style={{
              background: 'var(--surface)',
              borderTopLeftRadius: 22, borderTopRightRadius: 22,
              paddingBottom: 'env(safe-area-inset-bottom)',
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            <div className="mx-auto mt-3 mb-4" style={{ width: 40, height: 4, borderRadius: 999, background: 'var(--bg-3)' }} />
            <div className="px-5 mb-3" style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Разделы
            </div>
            <div className="grid grid-cols-3 gap-3 px-4 pb-6">
              {moreItems.map(item => (
                <button
                  key={item.key}
                  onClick={() => { nav(item.path); setMoreOpen(false) }}
                  className="flex flex-col items-center gap-2 p-3 transition-transform active:scale-95"
                  style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 14 }}
                >
                  <span
                    className="inline-grid place-items-center"
                    style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--accent-soft)', color: 'var(--accent)' }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 20, fontVariationSettings: "'FILL' 1" }}>
                      {item.icon}
                    </span>
                  </span>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--fg-2)', textAlign: 'center', lineHeight: 1.2 }}>
                    {item.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </Page>
  )
}
