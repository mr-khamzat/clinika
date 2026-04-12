import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getManagerBonuses, markAllPaid } from '../api'

function fmt(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

export default function ManagerBonuses() {
  const nav = useNavigate()
  const [admins, setAdmins] = useState([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('pending') // 'pending' | 'all'
  const [expanded, setExpanded] = useState(null)
  const [paying, setPaying] = useState(null)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await getManagerBonuses({ only_pending: filter === 'pending' })
      setAdmins(Array.isArray(res.data) ? res.data : [])
    } catch {
      setError('Ошибка загрузки данных')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [filter])

  const handlePayAll = async (adminId) => {
    setPaying(adminId)
    setError('')
    try {
      await markAllPaid(adminId)
      await load()
    } catch (e) {
      setError(e.response?.data?.detail || 'Ошибка выплаты')
    } finally {
      setPaying(null)
    }
  }

  const handlePrintAct = (admin) => {
    const date = new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
    const rows = admin.pending_bonuses.map(b =>
      `<tr>
        <td style="padding:6px 8px;border:1px solid #ddd">${b.service_name}</td>
        <td style="padding:6px 8px;border:1px solid #ddd">${b.patient_phone}</td>
        <td style="padding:6px 8px;border:1px solid #ddd">${fmt(b.confirmed_at)}</td>
        <td style="padding:6px 8px;border:1px solid #ddd;text-align:right">${b.amount.toLocaleString('ru-RU')} Б</td>
      </tr>`
    ).join('')
    const total = admin.pending_total.toLocaleString('ru-RU')
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Акт о выплате бонусов</title>
    <style>body{font-family:Arial,sans-serif;font-size:13px;padding:24px;color:#111}
    h2{text-align:center;margin-bottom:8px}table{width:100%;border-collapse:collapse;margin-top:16px}
    th{background:#f5f5f5;padding:6px 8px;border:1px solid #ddd;text-align:left}
    .sign{margin-top:48px;display:flex;justify-content:space-between}
    .sign div{width:45%}.sign span{display:block;border-top:1px solid #111;margin-top:40px;padding-top:4px;font-size:11px}</style></head>
    <body>
    <h2>АКТ о выплате бонусов</h2>
    <p>Дата: <strong>${date}</strong></p>
    <p>Сотрудник: <strong>${admin.full_name}</strong></p>
    <p>Клиника: <strong>${admin.clinic_name}</strong></p>
    <table><thead><tr>
      <th>Услуга</th><th>Пациент</th><th>Дата подтв.</th><th>Сумма</th>
    </tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><td colspan="3" style="padding:8px;border:1px solid #ddd;font-weight:bold;text-align:right">ИТОГО:</td>
    <td style="padding:8px;border:1px solid #ddd;font-weight:bold;text-align:right">${total} Б</td></tr></tfoot></table>
    <div class="sign">
      <div>Руководитель:<span>подпись / ФИО</span></div>
      <div>Сотрудник:<span>подпись / ФИО</span></div>
    </div>
    </body></html>`

    const w = window.open('', '_blank')
    w.document.write(html)
    w.document.close()
    w.focus()
    w.print()
  }

  const pendingTotal = admins.reduce((s, a) => s + a.pending_total, 0)
  const hasPending = admins.some(a => a.pending_total > 0)

  return (
    <div className="p-4 pb-24">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => nav('/manager')} className="text-gray-400 hover:text-gray-600">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <h1 className="text-xl font-bold text-gray-800">Выплаты сотрудникам</h1>
      </div>

      {/* Total pending banner */}
      {pendingTotal > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-amber-600 font-medium">К выплате всего</p>
            <p className="text-2xl font-bold text-amber-700">{pendingTotal.toLocaleString('ru-RU')} Б</p>
          </div>
          <div className="bg-amber-100 rounded-full p-3">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4">
        {[['pending','Ожидают выплаты'],['all','Все бонусы']].map(([k, l]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors ${
              filter === k ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600'
            }`}
          >{l}</button>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4">
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="text-center text-gray-400 text-sm py-12">Загрузка...</div>
      ) : admins.length === 0 ? (
        <div className="text-center text-gray-400 text-sm py-12">
          {filter === 'pending' ? 'Нет ожидающих выплат' : 'Бонусы не найдены'}
        </div>
      ) : (
        <div className="space-y-3">
          {admins.map(a => {
            const isOpen = expanded === a.admin_id
            const bonusList = filter === 'pending' ? a.pending_bonuses : [...a.pending_bonuses, ...a.paid_bonuses]
            const hasPendingItems = a.pending_total > 0

            return (
              <div key={a.admin_id} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                {/* Employee header */}
                <button
                  className="w-full text-left p-4"
                  onClick={() => setExpanded(isOpen ? null : a.admin_id)}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-gray-800">{a.full_name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{a.clinic_name}</p>
                    </div>
                    <div className="text-right">
                      {a.pending_total > 0 && (
                        <p className="text-lg font-bold text-amber-600">{a.pending_total.toLocaleString('ru-RU')} Б</p>
                      )}
                      {a.paid_total > 0 && (
                        <p className="text-xs text-green-600 font-medium">выплачено: {a.paid_total.toLocaleString('ru-RU')} Б</p>
                      )}
                    </div>
                  </div>

                  {/* Mini stats row */}
                  <div className="flex gap-3 mt-2">
                    {a.pending_bonuses.length > 0 && (
                      <span className="text-xs bg-amber-50 text-amber-700 rounded-full px-2 py-0.5">
                        {a.pending_bonuses.length} ожидает
                      </span>
                    )}
                    {a.paid_bonuses.length > 0 && (
                      <span className="text-xs bg-green-50 text-green-700 rounded-full px-2 py-0.5">
                        {a.paid_bonuses.length} выплачено
                      </span>
                    )}
                    <span className="text-xs text-gray-400 ml-auto">{isOpen ? '▲' : '▼'}</span>
                  </div>
                </button>

                {/* Pay all button + Print Act */}
                {hasPendingItems && (
                  <div className="px-4 pb-3 flex gap-2">
                    <button
                      onClick={() => handlePayAll(a.admin_id)}
                      disabled={paying === a.admin_id}
                      className="flex-1 bg-green-500 text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50"
                    >
                      {paying === a.admin_id ? 'Выплата...' : `Выплатить ${a.pending_total.toLocaleString('ru-RU')} Б`}
                    </button>
                    <button
                      onClick={() => handlePrintAct(a)}
                      className="border border-gray-200 text-gray-600 rounded-xl px-3 py-2.5 text-sm font-medium"
                      title="Печать акта"
                    >
                      Акт
                    </button>
                  </div>
                )}

                {/* Bonus detail list */}
                {isOpen && bonusList.length > 0 && (
                  <div className="border-t border-gray-50">
                    {bonusList.map((b, idx) => {
                      const isPaid = !!b.paid_at
                      return (
                        <div
                          key={b.bonus_id}
                          className={`px-4 py-3 flex items-start justify-between ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800 truncate">{b.service_name}</p>
                            <p className="text-xs text-gray-400">{b.patient_phone}</p>
                            <p className="text-xs text-gray-400">
                              подтв. {fmt(b.confirmed_at)}
                              {isPaid && ` · выплачено ${fmt(b.paid_at)}`}
                            </p>
                          </div>
                          <div className="ml-3 flex-shrink-0 text-right">
                            <p className={`text-sm font-bold ${isPaid ? 'text-green-600' : 'text-amber-600'}`}>
                              {b.amount.toLocaleString('ru-RU')} Б
                            </p>
                            <p className={`text-xs ${isPaid ? 'text-green-500' : 'text-amber-500'}`}>
                              {isPaid ? 'выплачено' : 'ожидает'}
                            </p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
