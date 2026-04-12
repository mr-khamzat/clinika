import { useEffect, useState } from 'react'
import { getBonusSummary, getBonuses } from '../api'

function formatDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default function Bonuses() {
  const [summary, setSummary] = useState(null)
  const [bonuses, setBonuses] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('all')

  useEffect(() => {
    Promise.all([getBonusSummary(), getBonuses()])
      .then(([s, b]) => {
        setSummary(s.data)
        setBonuses(Array.isArray(b.data) ? b.data : [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const TABS = [['all', 'Все'], ['pending', 'Ожидают'], ['paid', 'Выплачено']]
  const filtered = tab === 'all' ? bonuses : bonuses.filter(b => b.status === tab)
  const totalAmount = summary ? (summary.total_pending ?? 0) + (summary.total_paid ?? 0) : null

  return (
    <div className="bg-[#f7f9fb] min-h-screen pb-28">
      <div className="px-4 pt-4 space-y-4">

        {/* Карточка сводки */}
        <div className="rounded-3xl p-6 text-white"
          style={{ background: 'linear-gradient(135deg, #1565c0 0%, #1e6fe8 100%)', boxShadow: '0 12px 32px rgba(21,101,192,0.25)' }}>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <p className="text-blue-200 text-sm mb-1">Всего начислено</p>
              <p className="text-4xl font-extrabold leading-none font-headline">
                {loading ? '...' : `${totalAmount ?? 0} Б`}
              </p>
              <div className="flex gap-2 mt-4 flex-wrap">
                <span className="inline-flex items-center gap-1.5 bg-white/15 text-white/90 text-xs px-3 py-1.5 rounded-full font-semibold">
                  <span className="material-symbols-outlined" style={{ fontSize: 13 }}>schedule</span>
                  Ожидают: {loading ? '...' : `${summary?.total_pending ?? 0} Б`}
                </span>
                <span className="inline-flex items-center gap-1.5 bg-white/15 text-white/90 text-xs px-3 py-1.5 rounded-full font-semibold">
                  <span className="material-symbols-outlined" style={{ fontSize: 13, fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                  Выплачено: {loading ? '...' : `${summary?.total_paid ?? 0} Б`}
                </span>
              </div>
            </div>
            <div className="bg-white/15 rounded-2xl p-3 flex-shrink-0">
              <span className="material-symbols-outlined text-white" style={{ fontSize: 32, fontVariationSettings: "'FILL' 1" }}>
                account_balance_wallet
              </span>
            </div>
          </div>
        </div>

        {/* Табы */}
        <div className="flex gap-2 bg-white rounded-2xl p-1" style={{ boxShadow: '0 4px 16px rgba(25,28,30,0.05)' }}>
          {TABS.map(([val, label]) => {
            const cnt = val === 'all' ? bonuses.length : bonuses.filter(b => b.status === val).length
            return (
              <button key={val} onClick={() => setTab(val)}
                className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  tab === val
                    ? 'bg-[#1565c0] text-white'
                    : 'text-[#727783] hover:text-[#424752]'
                }`}
                style={tab === val ? { boxShadow: '0 4px 12px rgba(21,101,192,0.2)' } : {}}>
                {label} {cnt > 0 && <span className={`text-[10px] ml-1 ${tab === val ? 'opacity-70' : 'text-[#c2c6d4]'}`}>{cnt}</span>}
              </button>
            )
          })}
        </div>

        {/* Список */}
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-[3px] border-[#1565c0] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-16 h-16 bg-[#eceef0] rounded-3xl flex items-center justify-center mb-4">
              <span className="material-symbols-outlined text-[#c2c6d4] text-3xl">account_balance_wallet</span>
            </div>
            <p className="text-[#727783] text-sm font-medium">Начислений пока нет</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(b => {
              const isPaid = b.status === 'paid'
              return (
                <div key={b.id} className="bg-white rounded-2xl p-4 flex items-center gap-3"
                  style={{ boxShadow: '0 4px 16px rgba(25,28,30,0.05)' }}>
                  <div className={`w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 ${isPaid ? 'bg-[#dcfce7]' : 'bg-orange-100'}`}>
                    <span className="material-symbols-outlined text-xl" style={{ color: isPaid ? '#166534' : '#c2410c', fontVariationSettings: "'FILL' 1" }}>
                      redeem
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[#191c1e] text-sm">
                      {b.bonus_type === 'commission' ? 'Комиссия' : 'Направление'}
                    </p>
                    {b.service_name && <p className="text-xs text-[#424752] truncate mt-0.5">{b.service_name}</p>}
                    {b.clinic_name && <p className="text-xs text-[#727783] truncate">{b.clinic_name}</p>}
                    <div className="flex items-center gap-1 mt-1">
                      <span className="material-symbols-outlined text-[#c2c6d4]" style={{ fontSize: 11 }}>calendar_today</span>
                      <span className="text-[11px] text-[#727783]">{formatDate(b.created_at)}</span>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                    <p className={`text-xl font-extrabold font-headline ${isPaid ? 'text-[#166534]' : 'text-orange-500'}`}>
                      +{parseFloat(b.amount).toFixed(0)} Б
                    </p>
                    <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-bold ${isPaid ? 'bg-[#dcfce7] text-[#166534]' : 'bg-orange-100 text-orange-700'}`}>
                      {isPaid ? 'Выплачено' : 'Ожидает'}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
