/**
 * LoyaltyTransactionsSection — история начислений/списаний баллов.
 *
 * API:
 *   GET /loyalty/transactions?limit=&op_type=&phone=
 *
 * Фильтры: телефон + тип операции; CSV-экспорт текущей выборки.
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import api from '../../api'
import { useToast } from '../../design'

const apiFetch = (m, url, _t, d) => api({ method: m, url, data: d })

const OP_LABEL = {
  earn:           'Начисление',
  redeem:         'Списание',
  expire:         'Сгорание',
  tier_bonus:     'Бонус тира',
  manual_credit:  'Ручное начисление',
  manual_debit:   'Ручное списание',
}
const OP_COLOR = {
  earn:          'text-emerald-600',
  tier_bonus:    'text-emerald-600',
  manual_credit: 'text-emerald-600',
  redeem:        'text-red-500',
  expire:        'text-amber-500',
  manual_debit:  'text-red-500',
}

const OP_TYPES = [
  { id: '',              label: 'Все' },
  { id: 'earn',          label: 'Начисление' },
  { id: 'redeem',        label: 'Списание' },
  { id: 'expire',        label: 'Сгорание' },
  { id: 'tier_bonus',    label: 'Бонус тира' },
  { id: 'manual_credit', label: 'Ручное +' },
  { id: 'manual_debit',  label: 'Ручное −' },
]

function toCsv(rows) {
  // Простая CSV-сериализация без внешних библиотек.
  const head = ['Дата', 'Телефон', 'Тип', 'Изменение', 'Описание', 'Reference']
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = [head.map(esc).join(',')]
  for (const r of rows) {
    lines.push([
      new Date(r.created_at).toISOString(),
      r.patient_phone,
      OP_LABEL[r.op_type] || r.op_type,
      r.delta,
      r.description || '',
      r.reference_id || '',
    ].map(esc).join(','))
  }
  return lines.join('\n')
}

export default function LoyaltyTransactionsSection({ token }) {
  const [items, setItems] = useState(null)
  const [err, setErr] = useState('')
  const [needPay, setNeedPay] = useState(false)
  const [phone, setPhone] = useState('')
  const [opType, setOpType] = useState('')
  const [limit, setLimit] = useState(100)
  const { toast } = useToast()

  const load = useCallback(async () => {
    setErr(''); setNeedPay(false)
    const params = new URLSearchParams()
    params.set('limit', String(limit))
    if (opType) params.set('op_type', opType)
    if (phone.trim()) params.set('phone', phone.trim())
    try {
      const r = await apiFetch('get', `/loyalty/transactions?${params.toString()}`, token)
      setItems(Array.isArray(r.data) ? r.data : [])
    } catch (e) {
      const code = e?.response?.status
      if (code === 402) setNeedPay(true)
      else setErr(e?.response?.data?.detail || 'Ошибка загрузки истории')
      setItems([])
    }
  }, [token, limit, opType, phone])

  useEffect(() => { load() }, [load])

  const totals = useMemo(() => {
    if (!items) return { earned: 0, redeemed: 0, count: 0 }
    let earned = 0, redeemed = 0
    for (const t of items) {
      if (t.delta > 0) earned += t.delta
      else redeemed += -t.delta
    }
    return { earned, redeemed, count: items.length }
  }, [items])

  const exportCsv = () => {
    if (!items?.length) { toast({ kind: 'error', text: 'Нет данных для экспорта' }); return }
    const blob = new Blob(['﻿' + toCsv(items)], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `loyalty_transactions_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (needPay) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
        Подключите модуль <code>loyalty_pro</code> в каталоге.
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* KPI strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4">
          <div className="text-xs uppercase tracking-wider text-gray-500">Записей</div>
          <div className="text-2xl font-extrabold text-gray-900 dark:text-white mt-1">{totals.count}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4">
          <div className="text-xs uppercase tracking-wider text-emerald-600">Начислено</div>
          <div className="text-2xl font-extrabold text-emerald-600 mt-1">+{totals.earned.toLocaleString('ru')}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4">
          <div className="text-xs uppercase tracking-wider text-red-500">Списано</div>
          <div className="text-2xl font-extrabold text-red-500 mt-1">−{totals.redeemed.toLocaleString('ru')}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs font-semibold text-gray-500 mb-1">Телефон пациента</label>
          <input value={phone} onChange={e => setPhone(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()}
            placeholder="+7..." className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 text-sm" />
        </div>
        <div className="min-w-[160px]">
          <label className="block text-xs font-semibold text-gray-500 mb-1">Тип операции</label>
          <select value={opType} onChange={e => setOpType(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 text-sm">
            {OP_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        <div className="min-w-[120px]">
          <label className="block text-xs font-semibold text-gray-500 mb-1">Лимит</label>
          <select value={limit} onChange={e => setLimit(Number(e.target.value))}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 text-sm">
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={500}>500</option>
            <option value={1000}>1000</option>
          </select>
        </div>
        <button onClick={load} className="bg-[#0097A7] hover:bg-[#00838F] text-white px-4 py-2 rounded-lg text-sm font-semibold">
          Обновить
        </button>
        <button onClick={exportCsv} className="px-4 py-2 rounded-lg text-sm font-semibold border border-gray-200 dark:border-gray-700 inline-flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[18px]">download</span>
          CSV
        </button>
      </div>

      {err && <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-600 text-sm">{err}</div>}

      {items === null ? (
        <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-[#0097A7] border-t-transparent rounded-full animate-spin" /></div>
      ) : items.length === 0 ? (
        <div className="bg-gray-50 dark:bg-gray-800/50 border border-dashed border-gray-200 dark:border-gray-700 rounded-2xl p-10 text-center">
          <span className="material-symbols-outlined text-[40px] text-gray-400 mb-2">history</span>
          <div className="text-base font-semibold text-gray-700 dark:text-gray-200 mb-1">Транзакций нет</div>
          <div className="text-sm text-gray-500">Попробуйте изменить фильтры или подождите первых начислений.</div>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/40 text-gray-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left">Дата</th>
                <th className="px-4 py-3 text-left">Телефон</th>
                <th className="px-4 py-3 text-left">Тип</th>
                <th className="px-4 py-3 text-right">Δ</th>
                <th className="px-4 py-3 text-left">Описание</th>
                <th className="px-4 py-3 text-left">Reference</th>
              </tr>
            </thead>
            <tbody>
              {items.map(t => (
                <tr key={t.id} className="border-t border-gray-100 dark:border-gray-700">
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300 text-xs whitespace-nowrap">
                    {new Date(t.created_at).toLocaleString('ru')}
                  </td>
                  <td className="px-4 py-3 text-gray-900 dark:text-white font-mono text-xs">{t.patient_phone}</td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{OP_LABEL[t.op_type] || t.op_type}</td>
                  <td className={`px-4 py-3 text-right font-bold ${OP_COLOR[t.op_type] || ''}`}>
                    {t.delta > 0 ? `+${t.delta}` : t.delta}
                  </td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300 text-xs">{t.description || '—'}</td>
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs">{t.reference_id || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
