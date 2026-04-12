import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getKpi, setKpi } from '../api'

function ProgressBar({ value, color = 'bg-primary' }) {
  const pct = Math.min(Math.max(value || 0, 0), 100)
  return (
    <div className="w-full bg-gray-100 rounded-full h-2">
      <div
        className={`${color} h-2 rounded-full transition-all duration-300`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export default function ManagerKPI() {
  const nav = useNavigate()
  const [kpiList, setKpiList] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(null)
  const [editing, setEditing] = useState(null) // admin_id being edited
  const [editForm, setEditForm] = useState({ target_referrals: '', target_confirmed: '' })
  const [error, setError] = useState('')
  const [savedMsg, setSavedMsg] = useState('')

  const today = new Date()
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  const [month, setMonth] = useState(currentMonth)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await getKpi(month)
      setKpiList(Array.isArray(res.data) ? res.data : [])
    } catch {
      setError('Ошибка загрузки KPI')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [month])

  const handleEdit = (item) => {
    setEditing(item.admin_id)
    setEditForm({
      target_referrals: String(item.target_referrals),
      target_confirmed: String(item.target_confirmed),
    })
  }

  const handleSave = async (adminId) => {
    setSaving(adminId)
    setError('')
    try {
      await setKpi(adminId, {
        target_referrals: parseInt(editForm.target_referrals) || 0,
        target_confirmed: parseInt(editForm.target_confirmed) || 0,
        month,
      })
      setSavedMsg('Сохранено')
      setTimeout(() => setSavedMsg(''), 2000)
      setEditing(null)
      await load()
    } catch {
      setError('Ошибка сохранения')
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="p-4 pb-24">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => nav('/manager')} className="text-gray-400 hover:text-gray-600">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <h1 className="text-xl font-bold text-gray-800">KPI / план</h1>
      </div>

      {/* Month picker */}
      <div className="bg-white rounded-2xl p-4 shadow-sm mb-4">
        <label className="block text-xs font-medium text-gray-500 mb-1">Месяц</label>
        <input
          type="month"
          value={month}
          onChange={e => setMonth(e.target.value)}
          className="border border-gray-200 rounded-xl p-2.5 text-gray-800 text-sm focus:outline-none focus:border-primary"
        />
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

      {loading ? (
        <div className="text-center text-gray-400 py-16">Загрузка...</div>
      ) : kpiList.length === 0 ? (
        <div className="text-center text-gray-400 py-16">Нет сотрудников</div>
      ) : (
        <div className="space-y-3">
          {kpiList.map(item => {
            const isEditing = editing === item.admin_id
            return (
              <div key={item.admin_id} className="bg-white rounded-2xl p-4 shadow-sm">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <p className="font-semibold text-gray-800">{item.admin_name}</p>
                    <p className="text-xs text-gray-400">{item.clinic_name}</p>
                  </div>
                  <button
                    onClick={() => isEditing ? setEditing(null) : handleEdit(item)}
                    className="text-xs text-primary font-medium"
                  >
                    {isEditing ? 'Отмена' : 'Изменить'}
                  </button>
                </div>

                {isEditing ? (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Цель — направлений</label>
                      <input
                        type="number"
                        min="0"
                        value={editForm.target_referrals}
                        onChange={e => setEditForm(f => ({ ...f, target_referrals: e.target.value }))}
                        className="w-full border border-gray-200 rounded-xl p-2.5 text-sm focus:outline-none focus:border-primary"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Цель — подтверждено</label>
                      <input
                        type="number"
                        min="0"
                        value={editForm.target_confirmed}
                        onChange={e => setEditForm(f => ({ ...f, target_confirmed: e.target.value }))}
                        className="w-full border border-gray-200 rounded-xl p-2.5 text-sm focus:outline-none focus:border-primary"
                      />
                    </div>
                    <button
                      onClick={() => handleSave(item.admin_id)}
                      disabled={saving === item.admin_id}
                      className="w-full bg-primary text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50"
                    >
                      {saving === item.admin_id ? 'Сохранение...' : 'Сохранить'}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Referrals progress */}
                    <div>
                      <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>Направлений</span>
                        <span className="font-medium text-gray-700">
                          {item.actual_referrals} / {item.target_referrals || '—'}
                          {item.target_referrals > 0 && ` (${item.progress_refs_pct}%)`}
                        </span>
                      </div>
                      <ProgressBar value={item.progress_refs_pct} color="bg-primary" />
                    </div>
                    {/* Confirmed progress */}
                    <div>
                      <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>Подтверждено</span>
                        <span className="font-medium text-green-700">
                          {item.actual_confirmed} / {item.target_confirmed || '—'}
                          {item.target_confirmed > 0 && ` (${item.progress_conf_pct}%)`}
                        </span>
                      </div>
                      <ProgressBar value={item.progress_conf_pct} color="bg-green-500" />
                    </div>
                    {!item.target_referrals && !item.target_confirmed && (
                      <p className="text-xs text-gray-400 text-center">Цели не установлены. Нажмите «Изменить».</p>
                    )}
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
