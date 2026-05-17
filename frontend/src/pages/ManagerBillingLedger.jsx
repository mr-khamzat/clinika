/**
 * ========================================
 * БЛОК: ManagerBillingLedger — журнал биллинг-операций франшизы
 * ========================================
 * Источник данных:
 *   GET /manager/billing/ledger?from=&to=&type=&clinic_id=&page=&limit=
 *
 * UI:
 *   - Карточки сверху: Поступления / Возвраты / Чистая выручка
 *   - Фильтры: пресет дат (сегодня/неделя/месяц/всё время), тип операции, клиника
 *   - Таблица: дата, тип, клиника, пациент, сумма (+/-), описание, ссылка на receipt PDF
 *   - Пагинация (Prev/Next)
 *   - Экспорт CSV (fetch с большим limit и сохранение через Blob)
 *
 * Доступ: manager / franchise_owner / super_admin.
 * ========================================
 */
import { useEffect, useState, useMemo, useCallback } from 'react'
import api from '../api'
import { Card, Button, EmptyState, useToast } from '../design'
import ManagerShell from './_ManagerShell'

// ─── Справочник типов операций (entry_type → метка/цвет) ──────────────────
const ENTRY_TYPES = [
  { value: '',                     label: 'Все типы' },
  { value: 'subscription_charge',  label: 'Подписка: списание' },
  { value: 'subscription_credit',  label: 'Подписка: возврат/кредит' },
  { value: 'subscription_trial',   label: 'Подписка: trial' },
  { value: 'plugin_charge',        label: 'Плагин: подключение' },
  { value: 'plugin_renewal',       label: 'Плагин: продление' },
  { value: 'plugin_refund',        label: 'Плагин: возврат' },
  { value: 'ad_charge',            label: 'Реклама: размещение' },
  { value: 'ad_click_income',      label: 'Реклама: доход CPC' },
  { value: 'ad_impression_income', label: 'Реклама: доход CPM' },
  { value: 'platform_income',      label: 'Доля платформы' },
  { value: 'tenant_income',        label: 'Доля тенанта' },
  { value: 'franchise_fee',        label: 'Франшизный сбор' },
  { value: 'payment_received',     label: 'Платёж получен' },
  { value: 'refund',               label: 'Возврат тенанту' },
  { value: 'manual_adjustment',    label: 'Ручная корректировка' },
]

const TYPE_LABEL = Object.fromEntries(ENTRY_TYPES.map(t => [t.value, t.label]))

// Цвет «строки» — по типу. Только тонкая подсветка фона.
const TYPE_BG = {
  subscription_charge:  'oklch(0.97 0.04 150)',
  subscription_credit:  'oklch(0.97 0.04 25)',
  plugin_charge:        'oklch(0.97 0.04 230)',
  plugin_refund:        'oklch(0.97 0.04 25)',
  refund:               'oklch(0.97 0.04 25)',
  ad_charge:            'oklch(0.97 0.04 280)',
  platform_income:      'oklch(0.97 0.04 150)',
  tenant_income:        'oklch(0.97 0.04 180)',
  franchise_fee:        'oklch(0.97 0.04 80)',
  manual_adjustment:    'oklch(0.97 0.02 60)',
}

// ─── Пресеты дат ─────────────────────────────────────────────────────────
const DATE_PRESETS = [
  { key: 'today', label: 'Сегодня' },
  { key: 'week',  label: 'Неделя'  },
  { key: 'month', label: 'Месяц'   },
  { key: 'all',   label: 'Всё время' },
]

function presetToRange(key) {
  const today = new Date()
  const fmt = d => d.toISOString().slice(0, 10) // YYYY-MM-DD
  if (key === 'today') {
    return { from: fmt(today), to: fmt(today) }
  }
  if (key === 'week') {
    const d = new Date(today); d.setDate(d.getDate() - 7)
    return { from: fmt(d), to: fmt(today) }
  }
  if (key === 'month') {
    const d = new Date(today); d.setDate(d.getDate() - 30)
    return { from: fmt(d), to: fmt(today) }
  }
  return { from: '', to: '' }
}

// ─── Утилиты форматирования ─────────────────────────────────────────────
function formatRub(v) {
  const n = Number(v || 0)
  const sign = n > 0 ? '+' : (n < 0 ? '−' : '')
  const abs = Math.abs(n).toLocaleString('ru-RU', { maximumFractionDigits: 2 })
  return `${sign}${abs} ₽`
}

function formatRubPlain(v) {
  return Number(v || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽'
}

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// CSV-escape — оборачиваем в кавычки если есть запятые/кавычки/переводы.
function csvCell(v) {
  if (v == null) return ''
  const s = String(v)
  if (/[",\n;]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

// ─── Компонент ───────────────────────────────────────────────────────────
export default function ManagerBillingLedger() {
  const { show: toast } = useToast() || { show: () => {} }

  // ── Фильтры
  const [datePreset, setDatePreset] = useState('month')
  const [dateFrom, setDateFrom] = useState(() => presetToRange('month').from)
  const [dateTo, setDateTo]     = useState(() => presetToRange('month').to)
  const [typeFilter, setTypeFilter]     = useState('')
  const [clinicFilter, setClinicFilter] = useState('')

  // ── Данные
  const [items, setItems]   = useState([])
  const [total, setTotal]   = useState(0)
  const [totals, setTotals] = useState({ gross: 0, debit: 0, net: 0, by_type: {} })
  const [page, setPage]     = useState(1)
  const [limit]             = useState(50)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)

  // ── Клиники для дропдауна (берём из /manager/clinics-accessible)
  const [clinics, setClinics] = useState([])
  useEffect(() => {
    let alive = true
    api.get('/manager/clinics-accessible')
      .then(r => { if (alive) setClinics(Array.isArray(r.data) ? r.data : []) })
      .catch(() => { if (alive) setClinics([]) })
    return () => { alive = false }
  }, [])

  // ── Загрузка страницы
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = { page, limit }
      if (dateFrom)     params.from = dateFrom
      if (dateTo)       params.to = dateTo
      if (typeFilter)   params.type = typeFilter
      if (clinicFilter) params.clinic_id = clinicFilter
      const r = await api.get('/manager/billing/ledger', { params })
      setItems(r.data?.items || [])
      setTotal(r.data?.total || 0)
      setTotals(r.data?.totals || { gross: 0, debit: 0, net: 0, by_type: {} })
    } catch (e) {
      toast({ type: 'error', message: 'Не удалось загрузить журнал биллинга' })
      setItems([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [page, limit, dateFrom, dateTo, typeFilter, clinicFilter, toast])

  useEffect(() => { load() }, [load])

  // ── Применение пресета даты
  function applyPreset(key) {
    setDatePreset(key)
    const r = presetToRange(key)
    setDateFrom(r.from)
    setDateTo(r.to)
    setPage(1)
  }

  // ── Экспорт CSV (тянем до 5000 записей одним запросом)
  async function exportCsv() {
    setExporting(true)
    try {
      const params = { page: 1, limit: 5000 }
      if (dateFrom)     params.from = dateFrom
      if (dateTo)       params.to = dateTo
      if (typeFilter)   params.type = typeFilter
      if (clinicFilter) params.clinic_id = clinicFilter
      const r = await api.get('/manager/billing/ledger', { params })
      const rows = r.data?.items || []
      const headers = ['Дата', 'Тип', 'Клиника', 'Пациент', 'Сумма (₽)', 'Направление', 'Описание', 'Receipt URL']
      const lines = [headers.map(csvCell).join(',')]
      for (const it of rows) {
        lines.push([
          formatDate(it.created_at),
          TYPE_LABEL[it.entry_type] || it.entry_type,
          it.clinic_name || '',
          it.patient_name || '',
          Number(it.signed_amount || 0).toFixed(2),
          it.direction,
          it.description || '',
          it.receipt_url || '',
        ].map(csvCell).join(','))
      }
      // ﻿ — BOM для корректного открытия в Excel.
      const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const stamp = new Date().toISOString().slice(0, 10)
      a.href = url
      a.download = `billing_ledger_${stamp}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast({ type: 'success', message: `Экспортировано: ${rows.length} строк` })
    } catch (e) {
      toast({ type: 'error', message: 'Ошибка экспорта CSV' })
    } finally {
      setExporting(false)
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / limit))

  // Сумма «Возвратов» — все debit-операции (sum по by_type direction=debit).
  const refundsTotal = totals.debit || 0
  const incomeTotal  = totals.gross || 0
  const netTotal     = totals.net   || 0

  return (
    <ManagerShell
      active="finance"
      title="Журнал биллинга"
      subtitle="Все операции франшизы — append-only"
      icon="receipt_long"
    >
      <div className="px-4 sm:px-6 py-4 max-w-[1280px] mx-auto space-y-4">
        {/* ── KPI-карточки сверху ── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card>
            <div className="p-4 flex items-center gap-3">
              <span className="material-symbols-outlined" style={{
                fontSize: 32, color: 'oklch(0.55 0.15 150)',
                fontVariationSettings: "'FILL' 1",
              }}>trending_up</span>
              <div>
                <div className="text-xs uppercase tracking-wide" style={{ color: 'var(--fg-muted)' }}>
                  Поступления
                </div>
                <div className="text-2xl font-bold mt-0.5">{formatRubPlain(incomeTotal)}</div>
              </div>
            </div>
          </Card>
          <Card>
            <div className="p-4 flex items-center gap-3">
              <span className="material-symbols-outlined" style={{
                fontSize: 32, color: 'oklch(0.55 0.15 25)',
                fontVariationSettings: "'FILL' 1",
              }}>trending_down</span>
              <div>
                <div className="text-xs uppercase tracking-wide" style={{ color: 'var(--fg-muted)' }}>
                  Возвраты и списания
                </div>
                <div className="text-2xl font-bold mt-0.5">{formatRubPlain(refundsTotal)}</div>
              </div>
            </div>
          </Card>
          <Card>
            <div className="p-4 flex items-center gap-3">
              <span className="material-symbols-outlined" style={{
                fontSize: 32, color: 'oklch(0.5 0.18 230)',
                fontVariationSettings: "'FILL' 1",
              }}>account_balance_wallet</span>
              <div>
                <div className="text-xs uppercase tracking-wide" style={{ color: 'var(--fg-muted)' }}>
                  Чистая выручка
                </div>
                <div className="text-2xl font-bold mt-0.5"
                  style={{ color: netTotal >= 0 ? 'oklch(0.4 0.15 150)' : 'oklch(0.45 0.15 25)' }}>
                  {formatRubPlain(netTotal)}
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* ── Фильтры ── */}
        <Card>
          <div className="p-4 space-y-3">
            {/* Пресеты дат */}
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--fg-muted)' }}>
                Период:
              </span>
              {DATE_PRESETS.map(p => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => applyPreset(p.key)}
                  className="text-sm px-3 py-1 rounded-full transition-colors"
                  style={{
                    background: datePreset === p.key ? 'var(--accent-soft)' : 'var(--bg-1)',
                    color:      datePreset === p.key ? 'var(--accent)'      : 'var(--fg-2)',
                    border: '1px solid var(--border)',
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Ручные даты + тип + клиника + экспорт */}
            <div className="flex flex-wrap gap-2 items-end">
              <label className="flex flex-col text-xs" style={{ color: 'var(--fg-muted)' }}>
                С даты
                <input
                  type="date"
                  value={dateFrom}
                  onChange={e => { setDateFrom(e.target.value); setDatePreset(''); setPage(1) }}
                  className="mt-1 px-2 py-1 rounded text-sm"
                  style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', color: 'var(--fg-1)' }}
                />
              </label>
              <label className="flex flex-col text-xs" style={{ color: 'var(--fg-muted)' }}>
                По дату
                <input
                  type="date"
                  value={dateTo}
                  onChange={e => { setDateTo(e.target.value); setDatePreset(''); setPage(1) }}
                  className="mt-1 px-2 py-1 rounded text-sm"
                  style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', color: 'var(--fg-1)' }}
                />
              </label>
              <label className="flex flex-col text-xs" style={{ color: 'var(--fg-muted)' }}>
                Тип операции
                <select
                  value={typeFilter}
                  onChange={e => { setTypeFilter(e.target.value); setPage(1) }}
                  className="mt-1 px-2 py-1 rounded text-sm min-w-[200px]"
                  style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', color: 'var(--fg-1)' }}
                >
                  {ENTRY_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col text-xs" style={{ color: 'var(--fg-muted)' }}>
                Клиника
                <select
                  value={clinicFilter}
                  onChange={e => { setClinicFilter(e.target.value); setPage(1) }}
                  className="mt-1 px-2 py-1 rounded text-sm min-w-[180px]"
                  style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', color: 'var(--fg-1)' }}
                >
                  <option value="">Все клиники</option>
                  {clinics.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>

              <div className="ml-auto flex gap-2">
                <Button onClick={load} variant="ghost" disabled={loading}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>refresh</span>
                  Обновить
                </Button>
                <Button onClick={exportCsv} disabled={exporting || loading}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>download</span>
                  {exporting ? 'Экспорт…' : 'CSV'}
                </Button>
              </div>
            </div>
          </div>
        </Card>

        {/* ── Таблица ── */}
        <Card>
          <div className="p-0 overflow-x-auto">
            {loading ? (
              <div className="p-12 text-center" style={{ color: 'var(--fg-muted)' }}>
                Загрузка…
              </div>
            ) : items.length === 0 ? (
              <EmptyState
                icon="receipt_long"
                title="Нет операций"
                description="За выбранный период биллинг-операции не найдены."
              />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <th className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--fg-muted)' }}>Дата</th>
                    <th className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--fg-muted)' }}>Тип</th>
                    <th className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--fg-muted)' }}>Клиника</th>
                    <th className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--fg-muted)' }}>Пациент</th>
                    <th className="text-right px-3 py-2 font-semibold" style={{ color: 'var(--fg-muted)' }}>Сумма</th>
                    <th className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--fg-muted)' }}>Описание</th>
                    <th className="text-center px-3 py-2 font-semibold" style={{ color: 'var(--fg-muted)' }}>Чек</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(it => {
                    const isCredit = it.direction === 'credit'
                    return (
                      <tr key={it.id} style={{
                        borderBottom: '1px solid var(--border)',
                        background: TYPE_BG[it.entry_type] || 'transparent',
                      }}>
                        <td className="px-3 py-2 whitespace-nowrap">{formatDate(it.created_at)}</td>
                        <td className="px-3 py-2">
                          <span style={{ fontWeight: 500 }}>
                            {TYPE_LABEL[it.entry_type] || it.entry_type}
                          </span>
                          {it.is_split && (
                            <span className="ml-1 text-[10px] uppercase tracking-wide px-1.5 rounded"
                              style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                              split
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">{it.clinic_name || '—'}</td>
                        <td className="px-3 py-2">{it.patient_name || '—'}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap font-semibold"
                          style={{ color: isCredit ? 'oklch(0.4 0.15 150)' : 'oklch(0.45 0.15 25)' }}>
                          {formatRub(it.signed_amount)}
                        </td>
                        <td className="px-3 py-2" style={{ maxWidth: 360 }}>
                          <div className="truncate" title={it.description || ''}>
                            {it.description || '—'}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-center">
                          {it.receipt_url ? (
                            <a href={it.receipt_url} target="_blank" rel="noopener noreferrer"
                              className="inline-grid place-items-center"
                              style={{ color: 'var(--accent)' }}
                              title="Открыть чек PDF">
                              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>picture_as_pdf</span>
                            </a>
                          ) : (
                            <span style={{ color: 'var(--fg-muted)' }}>—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </Card>

        {/* ── Пагинация ── */}
        {total > limit && (
          <div className="flex items-center justify-between px-1">
            <div className="text-sm" style={{ color: 'var(--fg-muted)' }}>
              Показано {items.length} из {total} записей · стр. {page} / {pageCount}
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                disabled={page <= 1 || loading}
                onClick={() => setPage(p => Math.max(1, p - 1))}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>chevron_left</span>
                Назад
              </Button>
              <Button
                variant="ghost"
                disabled={page >= pageCount || loading}
                onClick={() => setPage(p => Math.min(pageCount, p + 1))}
              >
                Вперёд
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>chevron_right</span>
              </Button>
            </div>
          </div>
        )}
      </div>
    </ManagerShell>
  )
}
