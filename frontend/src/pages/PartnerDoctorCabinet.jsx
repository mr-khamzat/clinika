import { useState, useEffect } from 'react'
import axios from 'axios'
import { API_BASE, SLUG } from '../config'

const ACCENT = '#1565C0'
const DARK   = '#0d2040'

const NAV = [
  { key: 'dashboard', label: 'Главная',      icon: 'dashboard'      },
  { key: 'referrals', label: 'Направления',  icon: 'send'           },
  { key: 'schedule',  label: 'Расписание',   icon: 'calendar_today' },
  { key: 'bonuses',   label: 'Бонусы',       icon: 'payments'       },
]

function fmt(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric' })
}

const STATUS_LABEL = { created:'Создано', confirmed:'Подтверждено', expired:'Истекло', cancelled:'Отменено' }
const STATUS_BG    = { created:'bg-blue-100 text-blue-700', confirmed:'bg-green-100 text-green-700', expired:'bg-gray-100 text-gray-500', cancelled:'bg-red-100 text-red-700' }

export default function PartnerDoctorCabinet({ adminToken, user, onLogout }) {
  const [tab, setTab] = useState('dashboard')
  const [referrals, setReferrals] = useState([])
  const [bonuses, setBonuses] = useState([])
  const [income, setIncome] = useState([])

  const hdr = { headers: { Authorization: `Bearer ${adminToken}` } }

  useEffect(() => {
    if (tab === 'referrals' || tab === 'dashboard') {
      axios.get(API_BASE + '/referrals', hdr).then(r => setReferrals(Array.isArray(r.data) ? r.data : (r.data?.items || []))).catch(() => {})
    }
    if (tab === 'bonuses') {
      axios.get(API_BASE + '/bonuses', hdr).then(r => setBonuses(Array.isArray(r.data) ? r.data : [])).catch(() => {})
      axios.get(API_BASE + '/visiting/my-income', hdr).then(r => setIncome(Array.isArray(r.data) ? r.data : [])).catch(() => {})
    }
  }, [tab])

  const totalIncome  = income.reduce((s, e) => s + parseFloat(e.amount || 0), 0)
  const totalBonuses = bonuses.reduce((s, b) => s + parseFloat(b.amount || 0), 0)
  const confirmed    = referrals.filter(r => r.status === 'confirmed').length

  return (
    <div className="min-h-screen bg-[#f7f9fb]" style={{ fontFamily:"'Inter',sans-serif" }}>

      {/* Gradient Header */}
      <div className="relative overflow-hidden px-4 pt-12 pb-6"
        style={{ background:'linear-gradient(135deg,#1565C0 0%,#0097A7 100%)' }}>
        <div className="absolute -top-8 -right-8 w-36 h-36 rounded-full bg-white/5 pointer-events-none" />
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{ background:'rgba(255,255,255,0.18)', backdropFilter:'blur(10px)' }}>
            <span className="material-symbols-outlined text-white text-2xl" style={{ fontVariationSettings:"'FILL' 1" }}>stethoscope</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-base truncate">{user?.full_name}</p>
            <p className="text-white/70 text-xs">Врач-партнёр</p>
          </div>
          <button onClick={onLogout} className="w-11 h-11 flex items-center justify-center rounded-xl flex-shrink-0" style={{ background:'rgba(255,255,255,0.12)' }}>
            <span className="material-symbols-outlined text-white/80 text-lg">logout</span>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-4 pb-28">

        {/* Dashboard */}
        {tab === 'dashboard' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {[
                { label:'Направлений',   value:referrals.length, icon:'send',         color:'#1565C0', bg:'#e3f2fd' },
                { label:'Подтверждено',  value:confirmed,         icon:'check_circle', color:'#16A34A', bg:'#e8f5e9' },
                { label:'Бонусы ₽',      value:Math.round(totalBonuses), icon:'star', color:'#d97706', bg:'#fff8e1' },
                { label:'Начислено ₽',   value:Math.round(totalIncome),  icon:'account_balance_wallet', color:'#7c3aed', bg:'#f3e8ff' },
              ].map(c => (
                <div key={c.label} className="bg-white rounded-2xl p-4 flex items-center gap-3" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background:c.bg }}>
                    <span className="material-symbols-outlined text-xl" style={{ color:c.color, fontVariationSettings:"'FILL' 1" }}>{c.icon}</span>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 font-medium">{c.label}</p>
                    <p className="text-xl font-bold text-gray-800">{c.value ?? '—'}</p>
                  </div>
                </div>
              ))}
            </div>
            {referrals.slice(0, 5).length > 0 && (
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Последние направления</p>
                <div className="space-y-2">
                  {referrals.slice(0, 5).map(r => (
                    <div key={r.id} className="bg-white rounded-xl p-3 flex items-center gap-3" style={{ boxShadow:'0 2px 8px rgba(0,0,0,0.04)' }}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">{r.to_clinic_name || '—'}</p>
                        <p className="text-xs text-gray-400 truncate">{r.service_name || '—'}</p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold flex-shrink-0 ${STATUS_BG[r.status] || 'bg-gray-100 text-gray-500'}`}>
                        {STATUS_LABEL[r.status] || r.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Направления */}
        {tab === 'referrals' && (
          <div className="space-y-3">
            {referrals.length === 0 && (
              <div className="bg-white rounded-2xl p-10 text-center" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
                <span className="material-symbols-outlined text-5xl text-gray-300 block mb-2" style={{ fontVariationSettings:"'FILL' 1" }}>send</span>
                <p className="text-gray-400 text-sm">Нет направлений</p>
              </div>
            )}
            {referrals.map(r => (
              <div key={r.id} className="bg-white rounded-2xl p-4" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background:'#e3f2fd' }}>
                    <span className="material-symbols-outlined text-xl" style={{ color:ACCENT, fontVariationSettings:"'FILL' 1" }}>send</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-800 text-sm truncate">{r.to_clinic_name || '—'}</p>
                    <p className="text-xs text-gray-400 truncate">{r.service_name}</p>
                    {r.short_code && <p className="text-xs text-gray-500 mt-0.5 font-mono">#{r.short_code}</p>}
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold flex-shrink-0 ${STATUS_BG[r.status] || 'bg-gray-100 text-gray-500'}`}>
                    {STATUS_LABEL[r.status] || r.status}
                  </span>
                </div>
                <p className="text-xs text-gray-300 mt-2">{fmt(r.created_at)}</p>
              </div>
            ))}
          </div>
        )}

        {/* Расписание */}
        {tab === 'schedule' && (
          <div className="bg-white rounded-2xl p-8 text-center" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
            <span className="material-symbols-outlined text-5xl text-gray-300 block mb-3" style={{ fontVariationSettings:"'FILL' 1" }}>calendar_today</span>
            <p className="text-gray-500 text-sm font-medium">Расписание назначается</p>
            <p className="text-gray-400 text-xs mt-1">администратором клиники</p>
          </div>
        )}

        {/* Бонусы */}
        {tab === 'bonuses' && (
          <div className="space-y-3">
            {bonuses.length === 0 && income.length === 0 && (
              <div className="bg-white rounded-2xl p-10 text-center" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
                <span className="material-symbols-outlined text-5xl text-gray-300 block mb-2" style={{ fontVariationSettings:"'FILL' 1" }}>payments</span>
                <p className="text-gray-400 text-sm">Нет начислений</p>
              </div>
            )}
            {bonuses.map(b => (
              <div key={b.id} className="bg-white rounded-2xl p-4 flex items-center gap-3" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background:'#fff8e1' }}>
                  <span className="material-symbols-outlined text-xl" style={{ color:'#d97706', fontVariationSettings:"'FILL' 1" }}>star</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800">Бонус</p>
                  <p className="text-xs text-gray-400">{fmt(b.created_at)}</p>
                </div>
                <p className="font-bold text-amber-600 text-base">+{b.amount} ₽</p>
              </div>
            ))}
            {income.map(e => (
              <div key={e.id} className="bg-white rounded-2xl p-4 flex items-center gap-3" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background:'#e8f5e9' }}>
                  <span className="material-symbols-outlined text-xl" style={{ color:'#16A34A', fontVariationSettings:"'FILL' 1" }}>payments</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800">{e.operation_type}</p>
                  <p className="text-xs text-gray-400">{fmt(e.created_at)}</p>
                </div>
                <p className="font-bold text-green-600 text-base">+{e.amount} ₽</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 z-50"
        style={{ paddingBottom:'env(safe-area-inset-bottom)', background:'rgba(255,255,255,0.95)', backdropFilter:'blur(20px)', borderTop:'1px solid rgba(0,0,0,0.06)' }}>
        <div className="flex">
          {NAV.map(item => (
            <button key={item.key} onClick={() => setTab(item.key)}
              className="flex-1 flex flex-col items-center justify-center pt-2 pb-1 min-h-[56px] gap-0.5 relative">
              {tab === item.key && <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full" style={{ background:ACCENT }} />}
              <span className="material-symbols-outlined text-2xl" style={{ color:tab === item.key ? ACCENT : '#9ca3af', fontVariationSettings:tab === item.key ? "'FILL' 1" : "'FILL' 0" }}>{item.icon}</span>
              <span className="text-xs font-semibold" style={{ color:tab === item.key ? ACCENT : '#9ca3af' }}>{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
