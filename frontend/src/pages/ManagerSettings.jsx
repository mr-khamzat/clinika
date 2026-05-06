import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listManagerServices, updateService } from '../api'

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

export default function ManagerSettings() {
  const [services, setServices]           = useState([])
  const [loading, setLoading]             = useState(true)
  const [savedMsg, setSavedMsg]           = useState('')
  const [error, setError]                 = useState('')
  const [savingService, setSavingService] = useState(null)
  const [serviceBonuses, setServiceBonuses] = useState({})

  useEffect(() => {
    listManagerServices()
      .then(svRes => {
        const svcs = Array.isArray(svRes.data) ? svRes.data : []
        setServices(svcs)
        const bm = {}; svcs.forEach(s => { bm[s.id] = String(s.bonus_amount ?? '') })
        setServiceBonuses(bm)
      })
      .catch(() => setError('Ошибка загрузки настроек'))
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async (svcId) => {
    setSavingService(svcId)
    try {
      await updateService(svcId, { bonus_amount: parseFloat(serviceBonuses[svcId])||0 })
      setSavedMsg('Бонус обновлён'); setTimeout(()=>setSavedMsg(''),2000)
    } catch { setError('Ошибка сохранения бонуса') } finally { setSavingService(null) }
  }

  if (loading) return (
    <div className="bg-[#f7f9fb] dark:bg-gray-900 min-h-screen">
      <div className="flex items-center justify-center py-24"><div className="w-8 h-8 rounded-full border-4 border-[#0097A7]/20 border-t-[#0097A7] animate-spin" /></div>
    </div>
  )

  return (
    <div className="bg-[#f7f9fb] dark:bg-gray-900 min-h-screen pb-24">
      <PageHeader title="Настройки" icon="tune" color="text-[#374151] dark:text-gray-400" />
      <div className="px-4">
        {error   && <div className="bg-red-50 border border-red-200 rounded-2xl p-3 mb-4"><p className="text-red-600 text-sm">{error}</p></div>}
        {savedMsg && <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3 mb-4"><p className="text-emerald-700 text-sm font-medium">✓ {savedMsg}</p></div>}

        {/* Инфо */}
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-2xl p-4 mb-4 flex gap-3">
          <span className="material-symbols-outlined text-blue-500 text-xl flex-shrink-0" style={{ fontVariationSettings:"'FILL' 1" }}>info</span>
          <p className="text-blue-700 dark:text-blue-300 text-sm">Настройки МИС и Telegram доступны в панели администратора.</p>
        </div>

        {/* Бонусы по услугам */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-amber-500 text-xl" style={{ fontVariationSettings:"'FILL' 1" }}>sell</span>
            <h2 className="text-sm font-bold text-[#191c1e] dark:text-white">Бонусы по услугам</h2>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-2xl overflow-hidden" style={{ boxShadow:'0 4px 16px rgba(25,28,30,0.05)' }}>
            {services.length===0 ? (
              <div className="p-6 text-center text-[#727783] text-sm">Нет услуг</div>
            ) : (
              <div className="divide-y divide-[#f7f9fb] dark:divide-gray-700/50">
                {services.map(svc => (
                  <div key={svc.id} className="flex items-center gap-3 px-4 py-3">
                    <p className="flex-1 text-sm font-medium text-[#191c1e] dark:text-white truncate">{svc.name}</p>
                    <input type="number" value={serviceBonuses[svc.id] ?? ''}
                      onChange={e => setServiceBonuses(b=>({...b,[svc.id]:e.target.value}))}
                      className="bg-[#f7f9fb] dark:bg-gray-700 border-2 border-transparent focus:border-[#0097A7]/40 rounded-xl p-2 text-sm w-24 text-right outline-none text-[#191c1e] dark:text-white transition-all"
                      placeholder="Б" />
                    <button onClick={() => handleSave(svc.id)} disabled={savingService===svc.id}
                      className="w-11 h-11 flex-shrink-0 rounded-xl flex items-center justify-center text-white font-bold text-sm disabled:opacity-50 active:scale-95 transition-transform"
                      style={{ background:'linear-gradient(135deg,#0097A7,#006173)' }}>
                      {savingService===svc.id ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'OK'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
