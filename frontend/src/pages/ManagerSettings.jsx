import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listManagerServices, updateService } from '../api'

export default function ManagerSettings() {
  const nav = useNavigate()
  const [services, setServices] = useState([])
  const [loading, setLoading] = useState(true)
  const [savedMsg, setSavedMsg] = useState('')
  const [error, setError] = useState('')
  const [savingService, setSavingService] = useState(null)
  const [serviceBonuses, setServiceBonuses] = useState({})

  useEffect(() => {
    listManagerServices()
      .then(svRes => {
        const svcs = Array.isArray(svRes.data) ? svRes.data : []
        setServices(svcs)
        const bonusMap = {}
        svcs.forEach(s => { bonusMap[s.id] = String(s.bonus_amount ?? '') })
        setServiceBonuses(bonusMap)
      })
      .catch(() => setError('Ошибка загрузки настроек'))
      .finally(() => setLoading(false))
  }, [])

  const handleSaveServiceBonus = async (svcId) => {
    setSavingService(svcId)
    try {
      await updateService(svcId, { bonus_amount: parseFloat(serviceBonuses[svcId]) || 0 })
      setSavedMsg('Бонус обновлён')
      setTimeout(() => setSavedMsg(''), 2000)
    } catch {
      setError('Ошибка сохранения бонуса')
    } finally {
      setSavingService(null)
    }
  }

  if (loading) return <div className="p-4 text-center text-gray-400 py-16">Загрузка...</div>

  return (
    <div className="p-4 pb-24">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => nav('/manager')} className="text-gray-400 hover:text-gray-600">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <h1 className="text-xl font-bold text-gray-800">Настройки</h1>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4">
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      )}
      {savedMsg && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 mb-4">
          <p className="text-green-700 text-sm">{savedMsg}</p>
        </div>
      )}

      {/* Info notice */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4">
        <p className="text-blue-700 text-sm">Настройки МИС и Telegram доступны в панели администратора.</p>
      </div>

      {/* Services quick edit */}
      <div className="bg-white rounded-2xl p-4 shadow-sm mb-4">
        <p className="text-sm font-semibold text-gray-700 mb-3">Быстрое редактирование бонусов по услугам</p>
        {services.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-3">Нет услуг</p>
        ) : (
          <div className="space-y-2">
            {services.map(svc => (
              <div key={svc.id} className="flex items-center gap-2">
                <span className="flex-1 text-sm text-gray-700 truncate">{svc.name}</span>
                <input
                  type="number"
                  value={serviceBonuses[svc.id] ?? ''}
                  onChange={e => setServiceBonuses(b => ({ ...b, [svc.id]: e.target.value }))}
                  className="border border-gray-200 rounded-xl p-2 text-sm w-24 text-right focus:outline-none focus:border-primary"
                  placeholder="Б"
                />
                <button
                  onClick={() => handleSaveServiceBonus(svc.id)}
                  disabled={savingService === svc.id}
                  className="bg-primary text-white rounded-xl px-3 py-2 text-xs font-medium disabled:opacity-50"
                >
                  {savingService === svc.id ? '...' : 'OK'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
