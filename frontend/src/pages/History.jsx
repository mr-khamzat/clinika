import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getReferrals } from '../api'
import CancelModal from '../components/CancelModal'

const STATUS_STYLE = {
  created:          'bg-[#dae5ff] text-[#1565c0]',
  confirmed:        'bg-[#dcfce7] text-[#166534]',
  expired:          'bg-[#eceef0] text-[#727783]',
  cancel_requested: 'bg-orange-100 text-orange-700',
  cancelled:        'bg-red-100 text-red-700',
}

const STATUS_LABELS = {
  created:          'Создано',
  confirmed:        'Подтверждено',
  expired:          'Истекло',
  cancel_requested: 'На отмене',
  cancelled:        'Отменено',
}

const STATUS_ICON = {
  created:          { bg: 'bg-[#dae5ff]', color: '#1565c0', icon: 'send' },
  confirmed:        { bg: 'bg-[#dcfce7]', color: '#166534', icon: 'check_circle' },
  expired:          { bg: 'bg-[#eceef0]', color: '#727783', icon: 'schedule' },
  cancel_requested: { bg: 'bg-orange-100', color: '#c2410c', icon: 'pending' },
  cancelled:        { bg: 'bg-red-100',    color: '#ba1a1a', icon: 'cancel' },
}

function formatDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default function History() {
  const [referrals, setReferrals] = useState([])
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [cancelTarget, setCancelTarget] = useState(null)
  const nav = useNavigate()

  const load = () => {
    setLoading(true)
    getReferrals().then(r => { setReferrals(r.data); setLoading(false) })
  }
  useEffect(() => { load() }, [])

  const FILTERS = [
    ['all',              'Все'],
    ['created',          'Создано'],
    ['confirmed',        'Подтверждено'],
    ['expired',          'Просрочено'],
    ['cancel_requested', 'На отмене'],
    ['cancelled',        'Отменено'],
  ]

  const filtered = filter === 'all' ? referrals : referrals.filter(r => r.status === filter)

  return (
    <div className="bg-[#f7f9fb] min-h-screen pb-28">
      <div className="px-4 pt-4 space-y-4">

        {/* Фильтры */}
        <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {FILTERS.map(([val, label]) => {
            const cnt = val === 'all' ? referrals.length : referrals.filter(r => r.status === val).length
            return (
              <button key={val} onClick={() => setFilter(val)}
                className={`flex-shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
                  filter === val
                    ? 'bg-[#1565c0] text-white'
                    : 'bg-white text-[#424752] border border-[#eceef0]'
                }`}
                style={filter === val ? { boxShadow: '0 4px 12px rgba(21,101,192,0.2)' } : {}}>
                {label}
                {cnt > 0 && (
                  <span className={`text-[10px] font-bold rounded-full px-1.5 py-0.5 ${filter === val ? 'bg-white/20 text-white' : 'bg-[#f2f4f6] text-[#727783]'}`}>
                    {cnt}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Контент */}
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-[3px] border-[#1565c0] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-16 h-16 bg-[#eceef0] rounded-3xl flex items-center justify-center mb-4">
              <span className="material-symbols-outlined text-[#c2c6d4] text-3xl">description</span>
            </div>
            <p className="text-[#727783] text-sm font-medium">Направлений пока нет</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(r => {
              const ic = STATUS_ICON[r.status] || STATUS_ICON.expired
              return (
                <div key={r.id} className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: '0 4px 16px rgba(25,28,30,0.05)' }}>
                  <div onClick={() => nav(`/qr/${r.id}`)} className="p-4 cursor-pointer">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 ${ic.bg}`}>
                          <span className="material-symbols-outlined text-xl" style={{ color: ic.color, fontVariationSettings: "'FILL' 1" }}>{ic.icon}</span>
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-[#191c1e] text-sm leading-tight truncate">{r.to_clinic_name || 'Клиника'}</p>
                          <p className="text-xs text-[#727783] truncate mt-0.5">{r.service_name || 'Услуга'}</p>
                        </div>
                      </div>
                      <span className={`flex-shrink-0 text-[11px] px-2.5 py-1 rounded-full font-bold uppercase tracking-tight ${STATUS_STYLE[r.status] || 'bg-[#eceef0] text-[#727783]'}`}>
                        {STATUS_LABELS[r.status] || r.status}
                      </span>
                    </div>

                    <div className="flex items-center gap-4 mt-3 flex-wrap">
                      {r.patient_phone && (
                        <div className="flex items-center gap-1 text-[#727783]">
                          <span className="material-symbols-outlined" style={{ fontSize: 13 }}>phone</span>
                          <span className="text-xs">{r.patient_phone}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-1 text-[#727783]">
                        <span className="material-symbols-outlined" style={{ fontSize: 13 }}>calendar_today</span>
                        <span className="text-xs">{formatDate(r.created_at)}</span>
                      </div>
                      {r.bonus_amount > 0 && (
                        <span className="text-[#166534] font-bold text-sm ml-auto">+{r.bonus_amount} Б</span>
                      )}
                    </div>

                    {r.status === 'cancel_requested' && r.cancel_reason && (
                      <p className="text-xs text-orange-600 mt-2 flex items-center gap-1">
                        <span className="material-symbols-outlined" style={{ fontSize: 13 }}>pending</span>
                        На отмене: «{r.cancel_reason}»
                      </p>
                    )}
                    {r.status === 'cancelled' && r.cancel_reason && (
                      <p className="text-xs text-[#727783] mt-2 flex items-center gap-1">
                        <span className="material-symbols-outlined" style={{ fontSize: 13 }}>cancel</span>
                        Отменено: «{r.cancel_reason}»
                      </p>
                    )}
                  </div>

                  {['created', 'confirmed'].includes(r.status) && (
                    <div className="border-t border-[#f2f4f6] px-4 py-2.5">
                      <button onClick={e => { e.stopPropagation(); setCancelTarget(r) }}
                        className="w-full text-xs font-semibold text-[#ba1a1a] hover:bg-red-50 rounded-xl py-1.5 transition-colors">
                        Запросить удаление
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {cancelTarget && (
        <CancelModal referral={cancelTarget} onClose={() => setCancelTarget(null)} onDone={() => { setCancelTarget(null); load() }} />
      )}
    </div>
  )
}
