import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getManagerBonuses, markAllPaid } from '../api'

function fmt(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit', year:'2-digit' })
}

function PageHeader({ title, icon, color }) {
  const nav = useNavigate()
  return (
    <div className="sticky top-14 z-30 bg-[#f7f9fb]/90 dark:bg-gray-900/90 backdrop-blur-sm px-4 pt-4 pb-3 border-b border-[#eceef0]/60 dark:border-gray-700/60 mb-4">
      <div className="flex items-center gap-3">
        <button onClick={() => nav('/manager')} className="w-11 h-11 rounded-xl bg-white dark:bg-gray-800 flex items-center justify-center shadow-sm active:scale-95 transition-transform flex-shrink-0">
          <span className="material-symbols-outlined text-[#727783] text-xl">arrow_back_ios_new</span>
        </button>
        <div className="flex items-center gap-2">
          <span className={`material-symbols-outlined text-xl ${color}`} style={{ fontVariationSettings:"'FILL' 1" }}>{icon}</span>
          <h1 className="text-lg font-extrabold text-[#191c1e] dark:text-white font-headline">{title}</h1>
        </div>
      </div>
    </div>
  )
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
    try { const r = await getManagerBonuses({ only_pending: filter==='pending' }); setAdmins(Array.isArray(r.data) ? r.data : []) }
    catch { setError('Ошибка загрузки данных') } finally { setLoading(false) }
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

  const pendingTotal = admins.reduce((s,a) => s + a.pending_total, 0)

  return (
    <div className="bg-[#f7f9fb] dark:bg-gray-900 min-h-screen pb-24">
      <PageHeader title="Выплаты сотрудникам" icon="payments" color="text-amber-500" />
      <div className="px-4">

        {/* Итого к выплате */}
        {pendingTotal > 0 && (
          <div className="rounded-2xl p-4 mb-4 flex items-center justify-between text-white"
            style={{ background:'linear-gradient(135deg,#d97706,#b45309)', boxShadow:'0 8px 24px rgba(217,119,6,0.25)' }}>
            <div>
              <p className="text-white/70 text-xs font-semibold uppercase tracking-wider mb-1">К выплате всего</p>
              <p className="text-3xl font-extrabold font-headline">{pendingTotal.toLocaleString('ru-RU')} Б</p>
            </div>
            <div className="w-14 h-14 rounded-2xl bg-white/15 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl" style={{ fontVariationSettings:"'FILL' 1" }}>payments</span>
            </div>
          </div>
        )}

        {/* Фильтр */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-1.5 mb-4 flex gap-1.5" style={{ boxShadow:'0 4px 16px rgba(25,28,30,0.05)' }}>
          {[['pending','Ожидают выплаты'],['all','Все бонусы']].map(([k,l]) => (
            <button key={k} onClick={() => setFilter(k)}
              className={`flex-1 py-3 min-h-[44px] rounded-xl text-sm font-bold transition-all ${filter===k ? 'text-white shadow-sm' : 'text-[#727783]'}`}
              style={filter===k ? { background:'linear-gradient(135deg,#0097A7,#006173)' } : {}}>
              {l}
            </button>
          ))}
        </div>

        {error && <div className="bg-red-50 border border-red-200 rounded-2xl p-3 mb-4"><p className="text-red-600 text-sm">{error}</p></div>}

        {loading ? (
          <div className="flex items-center justify-center py-24"><div className="w-8 h-8 rounded-full border-4 border-[#0097A7]/20 border-t-[#0097A7] animate-spin" /></div>
        ) : admins.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-8 text-center" style={{ boxShadow:'0 4px 16px rgba(25,28,30,0.05)' }}>
            <span className="material-symbols-outlined text-5xl text-[#eceef0] dark:text-gray-600 block mb-3">payments</span>
            <p className="text-[#727783] text-sm">{filter==='pending' ? 'Нет ожидающих выплат' : 'Бонусы не найдены'}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {admins.map(a => {
              const isOpen = expanded === a.admin_id
              const bonusList = filter==='pending' ? a.pending_bonuses : [...a.pending_bonuses, ...a.paid_bonuses]
              return (
                <div key={a.admin_id} className="bg-white dark:bg-gray-800 rounded-2xl overflow-hidden" style={{ boxShadow:'0 4px 16px rgba(25,28,30,0.05)' }}>
                  <button className="w-full text-left p-4" onClick={() => setExpanded(isOpen ? null : a.admin_id)}>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                          style={{ background:'linear-gradient(135deg,#d97706,#b45309)' }}>
                          {(a.full_name||'?')[0].toUpperCase()}
                        </div>
                        <div>
                          <p className="font-bold text-[#191c1e] dark:text-white text-sm">{a.full_name}</p>
                          <p className="text-xs text-[#727783]">{a.clinic_name}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        {a.pending_total > 0 && <p className="text-lg font-extrabold text-amber-600">{a.pending_total.toLocaleString('ru-RU')} Б</p>}
                        {a.paid_total > 0 && <p className="text-xs text-[#16A34A] font-semibold">выплачено: {a.paid_total.toLocaleString('ru-RU')} Б</p>}
                      </div>
                    </div>
                    <div className="flex gap-2 mt-2">
                      {a.pending_bonuses.length > 0 && <span className="text-[10px] bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 font-semibold">{a.pending_bonuses.length} ожидает</span>}
                      {a.paid_bonuses.length > 0 && <span className="text-[10px] bg-green-100 text-green-700 rounded-full px-2 py-0.5 font-semibold">{a.paid_bonuses.length} выплачено</span>}
                      <span className="text-xs text-[#727783] ml-auto">{isOpen ? '▲' : '▼'}</span>
                    </div>
                  </button>

                  {a.pending_total > 0 && (
                    <div className="px-4 pb-3 flex gap-2">
                      <button onClick={() => handlePayAll(a.admin_id)} disabled={paying===a.admin_id}
                        className="flex-1 text-white rounded-xl py-2.5 text-sm font-bold disabled:opacity-50 active:scale-95 transition-transform"
                        style={{ background:'linear-gradient(135deg,#16A34A,#15803d)' }}>
                        {paying===a.admin_id ? 'Выплата...' : `Выплатить ${a.pending_total.toLocaleString('ru-RU')} Б`}
                      </button>
                      <button onClick={() => handlePrintAct(a)}
                        className="border-2 border-[#eceef0] dark:border-gray-600 text-[#727783] dark:text-gray-300 rounded-xl px-3 py-2.5 text-sm font-bold">
                        Акт
                      </button>
                    </div>
                  )}

                  {isOpen && bonusList.length > 0 && (
                    <div className="border-t border-[#f7f9fb] dark:border-gray-700">
                      {bonusList.map((b,idx) => {
                        const isPaid = !!b.paid_at
                        return (
                          <div key={b.bonus_id} className={`px-4 py-3 flex items-start justify-between ${idx%2===0 ? 'bg-white dark:bg-gray-800' : 'bg-[#f7f9fb] dark:bg-gray-700/50'}`}>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-[#191c1e] dark:text-white truncate">{b.service_name}</p>
                              <p className="text-xs text-[#727783]">{b.patient_phone}</p>
                              <p className="text-xs text-[#727783]">подтв. {fmt(b.confirmed_at)}{isPaid && ` · выплачено ${fmt(b.paid_at)}`}</p>
                            </div>
                            <div className="ml-3 flex-shrink-0 text-right">
                              <p className={`text-sm font-bold ${isPaid ? 'text-[#16A34A]' : 'text-amber-600'}`}>{b.amount.toLocaleString('ru-RU')} Б</p>
                              <p className={`text-[10px] font-semibold ${isPaid ? 'text-[#16A34A]' : 'text-amber-500'}`}>{isPaid ? 'выплачено' : 'ожидает'}</p>
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
    </div>
  )
}
