import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getKpi, setKpi } from '../api'

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

export default function ManagerKPI() {
  const [kpiList, setKpiList]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(null)
  const [editing, setEditing]   = useState(null)
  const [editForm, setEditForm] = useState({ target_referrals:'', target_confirmed:'' })
  const [error, setError]       = useState('')
  const [savedMsg, setSavedMsg] = useState('')

  const today = new Date()
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`
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
      await setKpi(adminId, { target_referrals: parseInt(editForm.target_referrals)||0, target_confirmed: parseInt(editForm.target_confirmed)||0, month })
      setSavedMsg('Сохранено'); setTimeout(()=>setSavedMsg(''),2000); setEditing(null); await load()
    } catch { setError('Ошибка сохранения') } finally { setSaving(null) }
  }

  return (
    <div className="bg-[#f7f9fb] dark:bg-gray-900 min-h-screen pb-24">
      <PageHeader title="KPI / план" icon="emoji_events" color="text-[#1565c0]" />
      <div className="px-4">
        {/* Выбор месяца */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 mb-4 flex items-center gap-3" style={{ boxShadow:'0 4px 16px rgba(25,28,30,0.05)' }}>
          <span className="material-symbols-outlined text-[#0097A7] text-xl" style={{ fontVariationSettings:"'FILL' 1" }}>calendar_month</span>
          <div className="flex-1">
            <label className="block text-[10px] font-bold text-[#727783] uppercase tracking-wider mb-1">Период</label>
            <input type="month" value={month} onChange={e => setMonth(e.target.value)}
              className="bg-[#f7f9fb] dark:bg-gray-700 rounded-xl px-3 py-2 text-[#191c1e] dark:text-white text-sm outline-none border-2 border-transparent focus:border-[#0097A7]/40 focus:bg-white transition-all" />
          </div>
        </div>

        {error  && <div className="bg-red-50 border border-red-200 rounded-2xl p-3 mb-4"><p className="text-red-600 text-sm">{error}</p></div>}
        {savedMsg && <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3 mb-4"><p className="text-emerald-700 text-sm font-medium">✓ {savedMsg}</p></div>}

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-8 h-8 rounded-full border-4 border-[#0097A7]/20 border-t-[#0097A7] animate-spin" />
          </div>
        ) : kpiList.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-8 text-center" style={{ boxShadow:'0 4px 16px rgba(25,28,30,0.05)' }}>
            <span className="material-symbols-outlined text-5xl text-[#eceef0] dark:text-gray-600 block mb-3">emoji_events</span>
            <p className="text-[#727783] text-sm">Нет сотрудников</p>
          </div>
        ) : (
          <div className="space-y-3">
            {kpiList.map(item => {
              const isEditing = editing === item.admin_id
              return (
                <div key={item.admin_id} className="bg-white dark:bg-gray-800 rounded-2xl p-4" style={{ boxShadow:'0 4px 16px rgba(25,28,30,0.05)' }}>
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                        style={{ background:'linear-gradient(135deg,#1565c0,#1e6fe8)' }}>
                        {(item.admin_name||'?')[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="font-bold text-[#191c1e] dark:text-white text-sm">{item.admin_name}</p>
                        <p className="text-xs text-[#727783]">{item.clinic_name}</p>
                      </div>
                    </div>
                    <button onClick={() => isEditing ? setEditing(null) : (setEditing(item.admin_id), setEditForm({ target_referrals: String(item.target_referrals), target_confirmed: String(item.target_confirmed) }))}
                      className={`text-sm font-bold px-3 py-2 min-h-[40px] rounded-xl transition-colors flex-shrink-0 ${isEditing ? 'bg-[#f7f9fb] dark:bg-gray-700 text-[#727783]' : 'bg-[#0097A7]/10 text-[#0097A7]'}`}>
                      {isEditing ? 'Отмена' : 'Изменить'}
                    </button>
                  </div>

                  {isEditing ? (
                    <div className="space-y-3 bg-[#f7f9fb] dark:bg-gray-700 rounded-xl p-3">
                      <div>
                        <label className="block text-xs font-semibold text-[#727783] mb-1">Цель — направлений</label>
                        <input type="number" min="0" value={editForm.target_referrals}
                          onChange={e => setEditForm(f=>({...f,target_referrals:e.target.value}))}
                          className="w-full bg-white dark:bg-gray-600 border-2 border-[#eceef0] dark:border-gray-500 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#0097A7] text-[#191c1e] dark:text-white" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#727783] mb-1">Цель — подтверждено</label>
                        <input type="number" min="0" value={editForm.target_confirmed}
                          onChange={e => setEditForm(f=>({...f,target_confirmed:e.target.value}))}
                          className="w-full bg-white dark:bg-gray-600 border-2 border-[#eceef0] dark:border-gray-500 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#0097A7] text-[#191c1e] dark:text-white" />
                      </div>
                      <button onClick={() => handleSave(item.admin_id)} disabled={saving===item.admin_id}
                        className="w-full text-white rounded-xl py-2.5 text-sm font-bold disabled:opacity-50 active:scale-95 transition-transform"
                        style={{ background:'linear-gradient(135deg,#0097A7,#006173)' }}>
                        {saving===item.admin_id ? 'Сохранение...' : 'Сохранить'}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <KpiBar label="Направлений" actual={item.actual_referrals} target={item.target_referrals} pct={item.progress_refs_pct} color="bg-[#0097A7]" />
                      <KpiBar label="Подтверждено" actual={item.actual_confirmed} target={item.target_confirmed} pct={item.progress_conf_pct} color="bg-[#16A34A]" />
                      {!item.target_referrals && !item.target_confirmed && (
                        <p className="text-xs text-[#727783] text-center py-1">Цели не установлены</p>
                      )}
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

function KpiBar({ label, actual, target, pct, color }) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1.5">
        <span className="text-[#727783] font-medium">{label}</span>
        <span className="font-bold text-[#191c1e] dark:text-white">
          {actual} / {target || '—'}{target > 0 && ` · ${pct}%`}
        </span>
      </div>
      <div className="w-full bg-[#f7f9fb] dark:bg-gray-700 rounded-full h-2">
        <div className={`${color} h-2 rounded-full transition-all duration-500`} style={{ width:`${Math.min(pct||0,100)}%` }} />
      </div>
    </div>
  )
}
