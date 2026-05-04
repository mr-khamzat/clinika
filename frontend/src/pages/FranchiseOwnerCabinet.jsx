import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import { API_BASE, SLUG } from '../config'

const ACCENT = '#7c3aed'

function authH(token) { return { Authorization: `Bearer ${token}` } }

function Stars({ value, size = 16 }) {
  return (
    <span style={{ display:'inline-flex', gap:1 }}>
      {[1,2,3,4,5].map(i => (
        <span key={i} className="material-symbols-outlined"
          style={{ fontSize:size, color: i <= Math.round(value || 0) ? '#f59e0b' : '#d1d5db', fontVariationSettings:"'FILL' 1" }}>star</span>
      ))}
    </span>
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
      const r = await axios.get(`${API_BASE}/reviews/moderate`, { headers: authH(adminToken), params })
      setReviews(Array.isArray(r.data?.items) ? r.data.items : [])
      setTotal(r.data?.total || 0)
    } catch { setReviews([]); setTotal(0) }
    setLoading(false)
  }, [adminToken, statusFilter, page])

  const loadStats = useCallback(async () => {
    try {
      const r = await axios.get(`${API_BASE}/reviews/moderate`, { headers: authH(adminToken), params: { limit:1000 } })
      const all = Array.isArray(r.data?.items) ? r.data.items : []
      const approved = all.filter(x => x.status === 'approved')
      const breakdown = { 5:0, 4:0, 3:0, 2:0, 1:0 }
      approved.forEach(x => { if (breakdown[x.rating] !== undefined) breakdown[x.rating]++ })
      setStats({ avgRating: approved.length ? approved.reduce((s,x)=>s+x.rating,0)/approved.length : null, total:all.length, approved:approved.length, pending:all.filter(x=>x.status==='pending').length, breakdown })
    } catch {}
  }, [adminToken])

  useEffect(() => { loadReviews() }, [loadReviews])
  useEffect(() => { loadStats() }, [loadStats])

  async function moderate(id, action) {
    try { await axios.patch(`${API_BASE}/reviews/${id}/${action}`, {}, { headers: authH(adminToken) }); await loadReviews(); await loadStats() } catch {}
  }

  async function deleteReview(id) {
    if (!confirm('Удалить отзыв?')) return
    try { await axios.delete(`${API_BASE}/reviews/${id}`, { headers: authH(adminToken) }); await loadReviews(); await loadStats() } catch {}
  }

  const STATUS_LABELS = { pending:'На модерации', approved:'Одобрен', rejected:'Отклонён' }
  const STATUS_COLORS = { pending:'#f59e0b', approved:'#22c55e', rejected:'#ef4444' }

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-2 gap-3">
          {[
            { label:'Всего отзывов', value:stats.total,    icon:'rate_review', color:'#0097A7' },
            { label:'Ожидают',       value:stats.pending,  icon:'pending',     color:'#f59e0b' },
            { label:'Одобрено',      value:stats.approved, icon:'check_circle',color:'#22c55e' },
            { label:'Ср. рейтинг',   value:stats.avgRating ? `★ ${stats.avgRating.toFixed(1)}` : '—', icon:'star', color:'#f59e0b' },
          ].map(c => (
            <div key={c.label} className="bg-white rounded-2xl p-4 flex items-center gap-3" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background:c.color+'20' }}>
                <span className="material-symbols-outlined text-xl" style={{ color:c.color, fontVariationSettings:"'FILL' 1" }}>{c.icon}</span>
              </div>
              <div>
                <p className="text-xs text-gray-400 font-medium">{c.label}</p>
                <p className="text-xl font-bold text-gray-800">{c.value}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        {[{id:'pending',label:'Ожидают'},{id:'approved',label:'Одобрённые'},{id:'rejected',label:'Отклонённые'},{id:'all',label:'Все'}].map(f => (
          <button key={f.id} onClick={() => { setStatusFilter(f.id); setPage(0) }}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold transition ${statusFilter === f.id ? 'text-white' : 'bg-gray-100 text-gray-600'}`}
            style={statusFilter === f.id ? { background:'linear-gradient(135deg,#7c3aed,#6d28d9)' } : {}}>
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <div className="w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : reviews.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 text-center" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
          <span className="material-symbols-outlined text-5xl text-gray-300 block mb-2" style={{ fontVariationSettings:"'FILL' 1" }}>rate_review</span>
          <p className="text-gray-400 text-sm">Нет отзывов в этой категории</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reviews.map(rv => (
            <div key={rv.id} className="bg-white rounded-2xl p-4" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2">
                  <Stars value={rv.rating} size={15} />
                  <span className="text-xs font-semibold" style={{ color:STATUS_COLORS[rv.status] }}>{STATUS_LABELS[rv.status] || rv.status}</span>
                </div>
                <span className="text-xs text-gray-400">{rv.created_at ? new Date(rv.created_at).toLocaleDateString('ru-RU') : ''}</span>
              </div>
              <p className="text-sm text-gray-700 mb-3 leading-relaxed">{rv.comment || <span className="text-gray-400 italic">Без комментария</span>}</p>
              <div className="flex items-center justify-between">
                <div className="text-xs text-gray-500">{rv.is_anonymous ? '— Аноним' : `— ${rv.patient_name || 'Пациент'}`}</div>
                <div className="flex gap-2">
                  {rv.status !== 'approved' && (
                    <button onClick={() => moderate(rv.id, 'approve')}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-medium">
                      <span className="material-symbols-outlined text-base">check_circle</span>Одобрить
                    </button>
                  )}
                  {rv.status !== 'rejected' && (
                    <button onClick={() => moderate(rv.id, 'reject')}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-orange-50 text-orange-700 text-xs font-medium">
                      <span className="material-symbols-outlined text-base">cancel</span>Отклонить
                    </button>
                  )}
                  <button onClick={() => deleteReview(rv.id)}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg bg-red-50 text-red-600 text-xs font-medium">
                    <span className="material-symbols-outlined text-base">delete</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {total > limit && (
        <div className="flex justify-center gap-3 mt-4">
          <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
            className="px-4 py-2 rounded-xl bg-white border border-gray-200 text-sm text-gray-600 disabled:opacity-40">← Назад</button>
          <span className="px-4 py-2 text-sm text-gray-500">{page + 1} / {Math.ceil(total / limit)}</span>
          <button disabled={(page + 1) * limit >= total} onClick={() => setPage(p => p + 1)}
            className="px-4 py-2 rounded-xl bg-white border border-gray-200 text-sm text-gray-600 disabled:opacity-40">Вперёд →</button>
        </div>
      )}
    </div>
  )
}

export default function FranchiseOwnerCabinet({ adminToken, user, onLogout }) {
  const [tab, setTab] = useState('overview')
  const [analytics, setAnalytics] = useState(null)
  const [loading, setLoading] = useState(true)

  const TABS = [
    { id:'overview',  label:'Обзор',    icon:'dashboard'            },
    { id:'analytics', label:'Аналитика',icon:'bar_chart'            },
    { id:'reviews',   label:'Отзывы',   icon:'rate_review'          },
    { id:'royalty',   label:'Роялти',   icon:'account_balance_wallet'},
  ]

  useEffect(() => {
    axios.get(`${API_BASE}/analytics/overview`, { headers: authH(adminToken) })
      .then(r => setAnalytics(r.data)).catch(() => {}).finally(() => setLoading(false))
  }, [])

  return (
    <div className="min-h-screen bg-[#f7f9fb]" style={{ fontFamily:"'Inter',sans-serif" }}>

      {/* Gradient Header */}
      <div className="relative overflow-hidden px-4 pt-12 pb-6"
        style={{ background:'linear-gradient(135deg,#7c3aed 0%,#1a1a2e 100%)' }}>
        <div className="absolute -top-8 -right-8 w-36 h-36 rounded-full bg-white/5 pointer-events-none" />
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-white font-black text-xl flex-shrink-0"
            style={{ background:'rgba(255,255,255,0.18)', backdropFilter:'blur(10px)' }}>
            {(user?.full_name || 'F')[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-base truncate">{user?.full_name || 'Владелец франшизы'}</p>
            <p className="text-white/70 text-xs uppercase tracking-widest">Franchise Owner</p>
          </div>
          <button onClick={onLogout} className="p-2 rounded-xl" style={{ background:'rgba(255,255,255,0.12)' }}>
            <span className="material-symbols-outlined text-white/80 text-lg">logout</span>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-4 pb-28">

        {loading && tab !== 'reviews' && (
          <div className="flex justify-center py-16">
            <div className="w-10 h-10 border-4 border-purple-600 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && tab === 'overview' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {[
                { label:'Направлений', value:analytics?.total_referrals ?? '—', icon:'groups',         color:'#0097A7' },
                { label:'Подтверждено',value:analytics?.confirmed ?? '—',        icon:'check_circle',   color:'#4caf50' },
                { label:'Конверсия',   value:analytics?.conversion_rate ? `${analytics.conversion_rate}%` : '—', icon:'trending_up', color:'#ff9800' },
                { label:'Выплачено',   value:analytics?.total_paid ? `${Number(analytics.total_paid).toLocaleString('ru')} ₽` : '—', icon:'payments', color:'#9c27b0' },
              ].map(c => (
                <div key={c.label} className="bg-white rounded-2xl p-4 flex items-center gap-3" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background:c.color+'20' }}>
                    <span className="material-symbols-outlined text-xl" style={{ color:c.color, fontVariationSettings:"'FILL' 1" }}>{c.icon}</span>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 font-medium">{c.label}</p>
                    <p className="text-xl font-bold text-gray-800">{c.value}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="bg-white rounded-2xl p-5" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
              <p className="text-sm text-gray-500 leading-relaxed">
                Кабинет владельца франшизы — сводная аналитика по всем клиникам вашей сети. Переключайтесь между разделами для просмотра деталей.
              </p>
            </div>
          </div>
        )}

        {!loading && tab === 'analytics' && (
          <div className="bg-white rounded-2xl p-5" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
            <h2 className="font-bold text-gray-800 mb-4">Аналитика по сети</h2>
            {analytics ? (
              <div className="space-y-2">
                {Object.entries(analytics).map(([k, v]) => (
                  <div key={k} className="flex justify-between items-center py-2 border-b border-gray-100 last:border-0">
                    <span className="text-sm text-gray-500">{k}</span>
                    <span className="text-sm font-semibold text-gray-800">{typeof v === 'number' ? v.toLocaleString('ru') : String(v)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-400 text-sm text-center py-8">Нет данных аналитики</p>
            )}
          </div>
        )}

        {tab === 'reviews' && <ReviewsTab adminToken={adminToken} />}

        {!loading && tab === 'royalty' && (
          <div className="bg-white rounded-2xl p-5" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
            <div className="text-center py-8">
              <span className="material-symbols-outlined text-5xl text-gray-300 block mb-3" style={{ fontVariationSettings:"'FILL' 1" }}>account_balance_wallet</span>
              <p className="font-semibold text-gray-600 mb-1">Модуль роялти в разработке</p>
              <p className="text-gray-400 text-sm">Здесь будут отображаться начисления и выплаты роялти по вашей франшизе</p>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 z-50"
        style={{ paddingBottom:'env(safe-area-inset-bottom)', background:'rgba(255,255,255,0.95)', backdropFilter:'blur(20px)', borderTop:'1px solid rgba(0,0,0,0.06)' }}>
        <div className="flex">
          {TABS.map(item => (
            <button key={item.id} onClick={() => setTab(item.id)}
              className="flex-1 flex flex-col items-center pt-2 pb-1 gap-0.5 relative">
              {tab === item.id && <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full" style={{ background:ACCENT }} />}
              <span className="material-symbols-outlined text-2xl" style={{ color:tab === item.id ? ACCENT : '#9ca3af', fontVariationSettings:tab === item.id ? "'FILL' 1" : "'FILL' 0" }}>{item.icon}</span>
              <span className="text-xs font-semibold" style={{ color:tab === item.id ? ACCENT : '#9ca3af' }}>{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
