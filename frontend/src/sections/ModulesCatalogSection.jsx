import { useState, useEffect } from 'react'
import axios from 'axios'
import { API_BASE } from '../config'

const CATEGORY_LABELS = {
  telephony:   { label: 'Телефония', color: '#0284c7', bg: 'rgba(2,132,199,.1)',   icon: 'call' },
  ai:          { label: 'AI',        color: '#7c3aed', bg: 'rgba(124,58,237,.1)', icon: 'auto_awesome' },
  advertising: { label: 'Реклама',   color: '#d97706', bg: 'rgba(217,119,6,.1)',  icon: 'campaign' },
}

function authH(token) { return { Authorization: `Bearer ${token}` } }

export default function ModulesCatalogSection({ token }) {
  const [modules, setModules]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [editKey, setEditKey]   = useState(null)
  const [editPrice, setEditPrice] = useState({ monthly: '', annual: '' })
  const [saving, setSaving]     = useState(false)
  const [msg, setMsg]           = useState('')
  const [filterCat, setFilterCat] = useState('all')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const r = await axios.get(`${API_BASE}/admin/modules`, { headers: authH(token) })
      setModules(r.data)
    } catch {}
    setLoading(false)
  }

  function openEdit(m) {
    setEditKey(m.key)
    setEditPrice({ monthly: String(m.price_monthly), annual: String(m.price_annual) })
  }

  async function savePrice() {
    setSaving(true)
    try {
      await axios.put(
        `${API_BASE}/admin/modules/${editKey}/price`,
        { price_monthly: Number(editPrice.monthly), price_annual: Number(editPrice.annual) },
        { headers: authH(token) }
      )
      setMsg('Цена обновлена ✓')
      setEditKey(null)
      await load()
    } catch (e) {
      setMsg('Ошибка: ' + (e.response?.data?.detail || e.message))
    }
    setSaving(false)
    setTimeout(() => setMsg(''), 4000)
  }

  async function toggleActive(m) {
    try {
      await axios.patch(
        `${API_BASE}/admin/modules/${m.key}`,
        { is_active: !m.is_active },
        { headers: authH(token) }
      )
      await load()
    } catch (e) {
      setMsg('Ошибка: ' + (e.response?.data?.detail || e.message))
      setTimeout(() => setMsg(''), 4000)
    }
  }

  const categories = ['all', ...Object.keys(CATEGORY_LABELS)]
  const filtered = filterCat === 'all' ? modules : modules.filter(m => m.category === filterCat)

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Каталог модулей</h1>
          <p className="text-sm text-gray-500 mt-1">Управление платными модулями платформы</p>
        </div>
        <div className="flex gap-2">
          {categories.map(c => (
            <button key={c} onClick={() => setFilterCat(c)}
              className={`px-3 py-1.5 rounded-xl text-sm font-medium transition ${
                filterCat === c
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300'
              }`}>
              {c === 'all' ? 'Все' : CATEGORY_LABELS[c]?.label || c}
            </button>
          ))}
        </div>
      </div>

      {msg && (
        <div className={`mb-4 px-4 py-3 rounded-xl text-sm ${msg.startsWith('Ошибка') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {msg}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="grid gap-4">
          {filtered.map(m => {
            const cat = CATEGORY_LABELS[m.category] || { label: m.category, color: '#6b7280', bg: 'rgba(107,114,128,.1)', icon: 'widgets' }
            const isEditing = editKey === m.key
            return (
              <div key={m.key} className={`bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border transition ${m.is_active ? 'border-gray-100 dark:border-gray-700' : 'border-gray-200 dark:border-gray-600 opacity-60'}`}>
                <div className="flex items-start gap-4">
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: cat.bg }}>
                    <span className="material-symbols-outlined text-xl" style={{ color: cat.color, fontVariationSettings: "'FILL' 1" }}>{cat.icon}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-gray-900 dark:text-white">{m.name}</span>
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium"
                        style={{ background: cat.bg, color: cat.color }}>{cat.label}</span>
                      <span className="font-mono text-xs text-gray-400 bg-gray-50 dark:bg-gray-900 px-2 py-0.5 rounded-lg">{m.key}</span>
                    </div>
                    {m.description && (
                      <p className="text-sm text-gray-500 mt-1 leading-snug">{m.description}</p>
                    )}
                    {m.included_in_plans?.length > 0 && (
                      <div className="flex gap-1 mt-1.5">
                        <span className="text-xs text-gray-400">Включён в:</span>
                        {m.included_in_plans.map(p => (
                          <span key={p} className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-md font-medium">{p}</span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3 flex-shrink-0">
                    {!isEditing ? (
                      <>
                        <div className="text-right">
                          <div className="text-base font-bold text-gray-800 dark:text-white">
                            {Number(m.price_monthly).toLocaleString('ru')} ₽/мес
                          </div>
                          {Number(m.price_annual) > 0 && (
                            <div className="text-xs text-gray-400">{Number(m.price_annual).toLocaleString('ru')} ₽/год</div>
                          )}
                        </div>
                        <button onClick={() => openEdit(m)}
                          className="p-2 rounded-xl bg-gray-50 hover:bg-blue-50 text-gray-500 hover:text-blue-600 dark:bg-gray-700 dark:hover:bg-blue-900/30 transition">
                          <span className="material-symbols-outlined text-lg">edit</span>
                        </button>
                        <button onClick={() => toggleActive(m)}
                          className={`p-2 rounded-xl transition ${m.is_active ? 'bg-green-50 text-green-600 hover:bg-red-50 hover:text-red-500' : 'bg-gray-50 text-gray-400 hover:bg-green-50 hover:text-green-600'} dark:bg-gray-700`}>
                          <span className="material-symbols-outlined text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>
                            {m.is_active ? 'toggle_on' : 'toggle_off'}
                          </span>
                        </button>
                      </>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div>
                          <label className="text-xs text-gray-400 block mb-0.5">Мес. ₽</label>
                          <input value={editPrice.monthly}
                            onChange={e => setEditPrice(p => ({ ...p, monthly: e.target.value }))}
                            className="w-24 border border-gray-200 rounded-lg px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                            type="number" min="0" />
                        </div>
                        <div>
                          <label className="text-xs text-gray-400 block mb-0.5">Год. ₽</label>
                          <input value={editPrice.annual}
                            onChange={e => setEditPrice(p => ({ ...p, annual: e.target.value }))}
                            className="w-24 border border-gray-200 rounded-lg px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                            type="number" min="0" />
                        </div>
                        <div className="flex flex-col gap-1 mt-4">
                          <button onClick={savePrice} disabled={saving}
                            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                            {saving ? '...' : 'Сохранить'}
                          </button>
                          <button onClick={() => setEditKey(null)}
                            className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-sm dark:bg-gray-700 dark:text-gray-300">
                            Отмена
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
