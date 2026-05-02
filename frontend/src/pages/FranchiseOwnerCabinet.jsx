import { useState, useEffect } from 'react'
import axios from 'axios'
import { API_BASE, SLUG } from '../config'

function authH(token) { return { Authorization: `Bearer ${token}` } }

export default function FranchiseOwnerCabinet({ adminToken, user, onLogout }) {
  const [activeTab, setActiveTab] = useState('overview')
  const [analytics, setAnalytics] = useState(null)
  const [tenants, setTenants] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    try {
      const [analyticsRes] = await Promise.all([
        axios.get(`${API_BASE}/analytics/overview`, { headers: authH(adminToken) }).catch(() => ({ data: null })),
      ])
      setAnalytics(analyticsRes.data)
    } catch {}
    setLoading(false)
  }

  const TABS = [
    { id: 'overview', label: 'Обзор', icon: 'dashboard' },
    { id: 'analytics', label: 'Аналитика', icon: 'bar_chart' },
    { id: 'royalty', label: 'Роялти', icon: 'account_balance_wallet' },
  ]

  return (
    <div className="min-h-screen bg-[#f7f9fb] font-sans">
      {/* Header */}
      <header className="bg-[#1a2232] text-white flex items-center gap-3 px-6 py-4 shadow-lg">
        <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center font-bold text-lg">
          {(user?.full_name || 'F')[0].toUpperCase()}
        </div>
        <div className="flex-1">
          <div className="font-bold text-base leading-tight">{user?.full_name || 'Владелец франшизы'}</div>
          <div className="text-[11px] text-slate-400 uppercase tracking-widest">Franchise Owner</div>
        </div>
        <button onClick={onLogout}
          className="text-slate-400 hover:text-white transition flex items-center gap-1 text-sm">
          <span className="material-symbols-outlined text-lg">logout</span>
          Выйти
        </button>
      </header>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200 px-6 flex gap-1">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition ${
              activeTab === t.id
                ? 'border-teal-600 text-teal-600'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}>
            <span className="material-symbols-outlined text-lg">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <main className="max-w-5xl mx-auto p-6">
        {loading && (
          <div className="flex justify-center py-16">
            <div className="w-10 h-10 border-4 border-teal-600 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && activeTab === 'overview' && (
          <div>
            <h2 className="text-xl font-bold text-gray-800 mb-6">Обзор франшизы</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              {[
                { label: 'Направлений', value: analytics?.total_referrals ?? '—', icon: 'groups', color: '#0097A7' },
                { label: 'Подтверждено', value: analytics?.confirmed ?? '—', icon: 'check_circle', color: '#4caf50' },
                { label: 'Конверсия', value: analytics?.conversion_rate ? `${analytics.conversion_rate}%` : '—', icon: 'trending_up', color: '#ff9800' },
                { label: 'Выплачено', value: analytics?.total_paid ? `${Number(analytics.total_paid).toLocaleString('ru')} ₽` : '—', icon: 'payments', color: '#9c27b0' },
              ].map(c => (
                <div key={c.label} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="material-symbols-outlined text-2xl" style={{ color: c.color, fontVariationSettings: "'FILL' 1" }}>{c.icon}</span>
                    <span className="text-xs text-gray-400 font-medium uppercase tracking-wide">{c.label}</span>
                  </div>
                  <div className="text-2xl font-bold text-gray-800">{c.value}</div>
                </div>
              ))}
            </div>
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <p className="text-gray-500 text-sm">
                Кабинет владельца франшизы — сводная аналитика по всем клиникам вашей сети.
                Переключайтесь между вкладками для просмотра деталей.
              </p>
            </div>
          </div>
        )}

        {!loading && activeTab === 'analytics' && (
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
            <h2 className="text-lg font-bold text-gray-800 mb-4">Аналитика по сети</h2>
            {analytics ? (
              <div className="grid grid-cols-2 gap-4">
                {Object.entries(analytics).map(([k, v]) => (
                  <div key={k} className="flex justify-between py-2 border-b border-gray-100">
                    <span className="text-sm text-gray-500">{k}</span>
                    <span className="text-sm font-semibold text-gray-800">{typeof v === 'number' ? v.toLocaleString('ru') : String(v)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-400 text-sm">Нет данных аналитики.</p>
            )}
          </div>
        )}

        {!loading && activeTab === 'royalty' && (
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
            <h2 className="text-lg font-bold text-gray-800 mb-4">Роялти</h2>
            <p className="text-gray-400 text-sm">Модуль расчёта роялти — в разработке. Здесь будут отображаться начисления и выплаты роялти по вашей франшизе.</p>
          </div>
        )}
      </main>
    </div>
  )
}
