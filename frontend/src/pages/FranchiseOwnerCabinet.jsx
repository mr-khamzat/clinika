import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import { API_BASE, SLUG } from '../config'

function authH(token) { return { Authorization: `Bearer ${token}` } }

function Stars({ value, size = 16 }) {
  return (
    <span style={{ display: 'inline-flex', gap: 1 }}>
      {[1,2,3,4,5].map(i => (
        <span key={i} className="material-symbols-outlined"
          style={{ fontSize: size, color: i <= Math.round(value || 0) ? '#f59e0b' : '#d1d5db', fontVariationSettings: "'FILL' 1" }}>
          star
        </span>
      ))}
    </span>
  )
}

function RatingBar({ label, count, total }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-4 text-right text-gray-500 font-medium">{label}</span>
      <span className="material-symbols-outlined text-base text-amber-400" style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full bg-amber-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-6 text-right text-gray-400 text-xs">{count}</span>
    </div>
  )
}

function ReviewsTab({ adminToken }) {
  const [reviews, setReviews] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('pending')
  const [page, setPage] = useState(0)
  const [stats, setStats] = useState(null)
  const limit = 20

  const loadReviews = useCallback(async () => {
    setLoading(true)
    try {
      const params = { limit, offset: page * limit }
      if (statusFilter !== 'all') params.status = statusFilter
      const r = await axios.get(`${API_BASE}/reviews/moderate`, {
        headers: authH(adminToken), params,
      })
      setReviews(Array.isArray(r.data?.items) ? r.data.items : [])
      setTotal(r.data?.total || 0)
    } catch { setReviews([]); setTotal(0) }
    setLoading(false)
  }, [adminToken, statusFilter, page])

  const loadStats = useCallback(async () => {
    try {
      const r = await axios.get(`${API_BASE}/reviews/moderate`, {
        headers: authH(adminToken), params: { limit: 1000 },
      })
      const all = Array.isArray(r.data?.items) ? r.data.items : []
      const approved = all.filter(x => x.status === 'approved')
      const breakdown = { 5:0, 4:0, 3:0, 2:0, 1:0 }
      approved.forEach(x => { if (breakdown[x.rating] !== undefined) breakdown[x.rating]++ })
      const avgRating = approved.length ? approved.reduce((s,x)=>s+x.rating,0)/approved.length : null
      setStats({ avgRating, total: all.length, approved: approved.length, pending: all.filter(x=>x.status==='pending').length, breakdown })
    } catch {}
  }, [adminToken])

  useEffect(() => { loadReviews() }, [loadReviews])
  useEffect(() => { loadStats() }, [loadStats])

  async function moderate(id, action) {
    try {
      await axios.patch(`${API_BASE}/reviews/${id}/${action}`, {}, { headers: authH(adminToken) })
      await loadReviews()
      await loadStats()
    } catch {}
  }

  async function deleteReview(id) {
    if (!confirm('Удалить отзыв?')) return
    try {
      await axios.delete(`${API_BASE}/reviews/${id}`, { headers: authH(adminToken) })
      await loadReviews()
      await loadStats()
    } catch {}
  }

  const STATUS_LABELS = { pending: 'На модерации', approved: 'Одобрен', rejected: 'Отклонён' }
  const STATUS_COLORS = { pending: '#f59e0b', approved: '#22c55e', rejected: '#ef4444' }

  return (
    <div>
      {/* Статистика */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Всего отзывов', value: stats.total, icon: 'rate_review', color: '#0097A7' },
            { label: 'Ожидают', value: stats.pending, icon: 'pending', color: '#f59e0b' },
            { label: 'Одобрено', value: stats.approved, icon: 'check_circle', color: '#22c55e' },
            { label: 'Средний рейтинг', value: stats.avgRating ? `★ ${stats.avgRating.toFixed(1)}` : '—', icon: 'star', color: '#f59e0b' },
          ].map(c => (
            <div key={c.label} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
              <div className="flex items-center gap-2 mb-1">
                <span className="material-symbols-outlined text-xl" style={{ color: c.color, fontVariationSettings: "'FILL' 1" }}>{c.icon}</span>
                <span className="text-[11px] text-gray-400 font-medium uppercase tracking-wide">{c.label}</span>
              </div>
              <div className="text-2xl font-bold text-gray-800">{c.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Распределение рейтингов */}
      {stats && stats.approved > 0 && (
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="text-center">
              <div className="text-4xl font-bold text-gray-800">{stats.avgRating?.toFixed(1)}</div>
              <Stars value={stats.avgRating} size={18} />
              <div className="text-xs text-gray-400 mt-1">{stats.approved} отзывов</div>
            </div>
            <div className="flex-1 space-y-1">
              {[5,4,3,2,1].map(s => (
                <RatingBar key={s} label={s} count={stats.breakdown[s]} total={stats.approved} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Фильтры */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 mb-4">
        <div className="flex gap-2 flex-wrap">
          {[
            { id: 'pending', label: 'Ожидают' },
            { id: 'approved', label: 'Одобрённые' },
            { id: 'rejected', label: 'Отклонённые' },
            { id: 'all', label: 'Все' },
          ].map(f => (
            <button key={f.id} onClick={() => { setStatusFilter(f.id); setPage(0) }}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${
                statusFilter === f.id
                  ? 'bg-teal-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>
              {f.label}
            </button>
          ))}
          <span className="ml-auto text-sm text-gray-400 self-center">Всего: {total}</span>
        </div>
      </div>

      {/* Список */}
      {loading ? (
        <div className="flex justify-center py-10">
          <div className="w-8 h-8 border-4 border-teal-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : reviews.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 text-center text-gray-400 shadow-sm border border-gray-100">
          <span className="material-symbols-outlined text-5xl mb-3 block" style={{ color: '#d1d5db' }}>rate_review</span>
          Нет отзывов в этой категории
        </div>
      ) : (
        <div className="space-y-3">
          {reviews.map(rv => (
            <div key={rv.id} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2">
                  <Stars value={rv.rating} size={15} />
                  <span className="text-xs font-semibold" style={{ color: STATUS_COLORS[rv.status] }}>
                    {STATUS_LABELS[rv.status] || rv.status}
                  </span>
                </div>
                <span className="text-xs text-gray-400">
                  {rv.created_at ? new Date(rv.created_at).toLocaleDateString('ru-RU') : ''}
                </span>
              </div>
              <p className="text-sm text-gray-700 mb-3 leading-relaxed">
                {rv.comment || <span className="text-gray-400 italic">Без комментария</span>}
              </p>
              <div className="flex items-center justify-between">
                <div className="text-xs text-gray-500">
                  {rv.is_anonymous ? '— Аноним' : `— ${rv.patient_name || 'Пациент'}`}
                </div>
                <div className="flex gap-2">
                  {rv.status !== 'approved' && (
                    <button onClick={() => moderate(rv.id, 'approve')}
                      className="flex items-center gap-1 px-3 py-1 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-medium hover:bg-emerald-100 transition">
                      <span className="material-symbols-outlined text-base">check_circle</span>
                      Одобрить
                    </button>
                  )}
                  {rv.status !== 'rejected' && (
                    <button onClick={() => moderate(rv.id, 'reject')}
                      className="flex items-center gap-1 px-3 py-1 rounded-lg bg-orange-50 text-orange-700 text-xs font-medium hover:bg-orange-100 transition">
                      <span className="material-symbols-outlined text-base">cancel</span>
                      Отклонить
                    </button>
                  )}
                  <button onClick={() => deleteReview(rv.id)}
                    className="flex items-center gap-1 px-3 py-1 rounded-lg bg-red-50 text-red-600 text-xs font-medium hover:bg-red-100 transition">
                    <span className="material-symbols-outlined text-base">delete</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Пагинация */}
      {total > limit && (
        <div className="flex justify-center gap-3 mt-6">
          <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
            className="px-4 py-2 rounded-lg bg-white border border-gray-200 text-sm text-gray-600 disabled:opacity-40 hover:bg-gray-50 transition">
            ← Назад
          </button>
          <span className="px-4 py-2 text-sm text-gray-500">
            {page + 1} / {Math.ceil(total / limit)}
          </span>
          <button disabled={(page + 1) * limit >= total} onClick={() => setPage(p => p + 1)}
            className="px-4 py-2 rounded-lg bg-white border border-gray-200 text-sm text-gray-600 disabled:opacity-40 hover:bg-gray-50 transition">
            Вперёд →
          </button>
        </div>
      )}
    </div>
  )
}

export default function FranchiseOwnerCabinet({ adminToken, user, onLogout }) {
  const [activeTab, setActiveTab] = useState('overview')
  const [analytics, setAnalytics] = useState(null)
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
    { id: 'overview',  label: 'Обзор',    icon: 'dashboard' },
    { id: 'analytics', label: 'Аналитика', icon: 'bar_chart' },
    { id: 'reviews',   label: 'Отзывы',   icon: 'rate_review' },
    { id: 'royalty',   label: 'Роялти',   icon: 'account_balance_wallet' },
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
      <div className="bg-white border-b border-gray-200 px-6 flex gap-1 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition whitespace-nowrap ${
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
        {loading && activeTab !== 'reviews' && (
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

        {activeTab === 'reviews' && (
          <div>
            <h2 className="text-xl font-bold text-gray-800 mb-6">Управление отзывами</h2>
            <ReviewsTab adminToken={adminToken} />
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
