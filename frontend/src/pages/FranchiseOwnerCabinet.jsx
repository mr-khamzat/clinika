import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import axios from 'axios'
import { API_BASE, SLUG } from '../config'
import CallRulesSection from '../sections/CallRulesSection'
import PlatformInvoicesSection from '../sections/PlatformInvoicesSection'
import AppointmentsStatsSection from '../sections/AppointmentsStatsSection'

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

const DoctorsSection = lazy(() => import('../sections/DoctorsSection'))
const AIKnowledgeSection = lazy(() => import('../sections/AIKnowledgeSection'))

// ── Таб «Мои тенанты» — управление тенантами внутри своей франшизы ─────────
const EMPTY_TENANT = {
  name: '',
  slug: '',
  plan: 'trial',
  admin_full_name: '',
  admin_login: '',
  admin_password: '',
}

const PLAN_LABELS = {
  trial:        'Trial',
  basic:        'Basic',
  pro:          'Pro',
  professional: 'Professional',
  enterprise:   'Enterprise',
}

function MyTenantsTab({ adminToken }) {
  const [me, setMe]               = useState(null)
  const [tenants, setTenants]     = useState(null)
  const [loading, setLoading]     = useState(true)
  const [showForm, setShowForm]   = useState(false)
  const [form, setForm]           = useState(EMPTY_TENANT)
  const [saving, setSaving]       = useState(false)
  const [created, setCreated]     = useState(null) // данные созданного тенанта
  const [details, setDetails]     = useState(null) // детальный просмотр
  const [msg, setMsg]             = useState('')
  const [msgType, setMsgType]     = useState('ok')

  const showMsg = (text, type = 'ok') => {
    setMsg(text); setMsgType(type)
    setTimeout(() => setMsg(''), 4500)
  }

  const slugify = (s) =>
    (s || '').toLowerCase()
      .replace(/[^a-z0-9а-я]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50)

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [meR, tR] = await Promise.all([
        axios.get(`${API_BASE}/franchise-owner/me`, { headers: authH(adminToken) }).catch(() => ({ data: null })),
        axios.get(`${API_BASE}/franchise-owner/tenants`, { headers: authH(adminToken) }).catch(() => ({ data: [] })),
      ])
      setMe(meR.data)
      setTenants(Array.isArray(tR.data) ? tR.data : [])
    } catch {
      setTenants([])
    }
    setLoading(false)
  }, [adminToken])

  useEffect(() => { loadAll() }, [loadAll])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async (e) => {
    e?.preventDefault?.()
    if (!form.name.trim() || !form.slug.trim() || !form.admin_full_name.trim() || !form.admin_login.trim()) {
      showMsg('Заполните обязательные поля', 'err'); return
    }
    setSaving(true)
    try {
      const r = await axios.post(`${API_BASE}/franchise-owner/tenants`, {
        name: form.name.trim(),
        slug: form.slug.trim(),
        plan: form.plan,
        admin_full_name: form.admin_full_name.trim(),
        admin_login: form.admin_login.trim(),
        admin_password: form.admin_password.trim() || null,
      }, { headers: authH(adminToken) })
      setCreated(r.data)
      setForm(EMPTY_TENANT)
      setShowForm(false)
      await loadAll()
      showMsg('Тенант создан')
    } catch (e) {
      showMsg('Ошибка: ' + (e.response?.data?.detail || e.message), 'err')
    }
    setSaving(false)
  }

  const TENANT_PORTAL_URL = (slug) => `${window.location.origin}/${slug}/admin`

  return (
    <div className="space-y-4">
      {/* Сводка */}
      {me && (
        <div className="bg-white rounded-2xl p-5" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{ background:(me.brand_color || '#7c3aed') + '22' }}>
              <span className="material-symbols-outlined text-2xl"
                style={{ color:me.brand_color || '#7c3aed', fontVariationSettings:"'FILL' 1" }}>store</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-gray-900 truncate">{me.name}</p>
              <p className="text-xs text-gray-400">/{me.slug}</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-extrabold text-gray-900">{me.tenant_count ?? 0}</p>
              <p className="text-xs text-gray-400">тенантов</p>
            </div>
          </div>
        </div>
      )}

      {msg && (
        <div className={`px-4 py-3 rounded-xl text-sm font-medium ${
          msgType === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
          {msg}
        </div>
      )}

      {/* Кнопка добавления */}
      <button onClick={() => { setShowForm(true); setCreated(null); setForm(EMPTY_TENANT) }}
        className="w-full flex items-center justify-center gap-2 bg-violet-600 text-white py-3 rounded-2xl font-semibold hover:bg-violet-700 transition">
        <span className="material-symbols-outlined">add_business</span>
        Добавить тенант
      </button>

      {/* Список тенантов */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-10 h-10 border-4 border-violet-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (tenants || []).length === 0 ? (
        <div className="bg-white rounded-2xl p-10 text-center" style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
          <span className="material-symbols-outlined text-5xl text-gray-300 block mb-2"
            style={{ fontVariationSettings:"'FILL' 1" }}>business</span>
          <p className="text-gray-500 font-semibold mb-1">Нет тенантов</p>
          <p className="text-gray-400 text-sm">Создайте первый тенант своей франшизы</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tenants.map(t => {
            const isActive = t.is_active
            const isTrial = t.subscription_status === 'trial'
            const statusBg = isTrial ? 'bg-amber-50 text-amber-700' :
              (t.subscription_status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500')
            return (
              <div key={t.id} className="bg-white rounded-2xl p-4"
                style={{ boxShadow:'0 2px 12px rgba(0,0,0,0.05)' }}>
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: isActive ? '#7c3aed22' : '#f3f4f6' }}>
                    <span className="material-symbols-outlined"
                      style={{ color: isActive ? '#7c3aed' : '#9ca3af', fontVariationSettings:"'FILL' 1" }}>
                      corporate_fare
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={`font-bold ${isActive ? 'text-gray-900' : 'text-gray-400 line-through'}`}>{t.name}</p>
                      <span className="text-xs text-gray-400 truncate">/{t.slug}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap text-xs">
                      {t.plan && <span className="font-bold text-violet-600 uppercase">{PLAN_LABELS[t.plan] || t.plan}</span>}
                      <span className={`font-semibold px-2 py-0.5 rounded-full ${statusBg}`}>
                        {isTrial ? 'Trial' : (t.subscription_status || 'нет')}
                      </span>
                      <span className="text-gray-400">
                        {t.created_at ? new Date(t.created_at).toLocaleDateString('ru-RU') : ''}
                      </span>
                    </div>
                  </div>
                  <button onClick={() => setDetails(t)}
                    className="p-2 rounded-xl hover:bg-gray-100">
                    <span className="material-symbols-outlined text-gray-500">chevron_right</span>
                  </button>
                </div>
                {t.mrr ? (
                  <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between text-xs">
                    <span className="text-gray-400">MRR</span>
                    <span className="font-bold text-gray-700">{Number(t.mrr).toLocaleString('ru')} ₽/мес</span>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Модалка создания тенанта ───────────────────────────────────── */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl p-6 w-full sm:max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">Новый тенант</h2>
              <button onClick={() => setShowForm(false)} className="p-1 text-gray-400">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <form onSubmit={submit} className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Название тенанта *</label>
                <input type="text" value={form.name}
                  onChange={e => { set('name', e.target.value); if (!form.slug) set('slug', slugify(e.target.value)) }}
                  required className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Slug (URL) *</label>
                <input type="text" value={form.slug}
                  onChange={e => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  required pattern="^[a-z0-9-]+$"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono" />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Тариф</label>
                <select value={form.plan} onChange={e => set('plan', e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm">
                  <option value="trial">Trial</option>
                  <option value="basic">Basic</option>
                  <option value="pro">Pro</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>

              <div className="bg-gray-50 rounded-xl p-3 space-y-2">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Администратор тенанта</p>
                <input type="text" placeholder="ФИО *" required value={form.admin_full_name}
                  onChange={e => set('admin_full_name', e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
                <input type="text" placeholder="Логин *" required value={form.admin_login}
                  onChange={e => set('admin_login', e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono" />
                <input type="text" placeholder="Пароль (или сгенерировать)" value={form.admin_password}
                  onChange={e => set('admin_password', e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono" />
              </div>

              <div className="flex gap-2 mt-2">
                <button type="submit" disabled={saving}
                  className="flex-1 bg-violet-600 hover:bg-violet-700 text-white py-2.5 rounded-xl font-semibold disabled:opacity-50">
                  {saving ? 'Создание…' : 'Создать тенант'}
                </button>
                <button type="button" onClick={() => setShowForm(false)}
                  className="px-4 py-2.5 rounded-xl border border-gray-200 text-gray-600">
                  Отмена
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Уведомление о созданном тенанте — пароль показывается единожды */}
      {created && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
                <span className="material-symbols-outlined text-emerald-600">check_circle</span>
              </div>
              <p className="font-bold text-gray-900">Тенант создан</p>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs space-y-1 mb-4">
              <p className="font-bold text-amber-800">⚠ Сохраните данные доступа — показываются один раз</p>
              <p className="text-amber-700 font-mono">URL: {created.admin_panel || `${window.location.origin}/${created.slug}/admin`}</p>
              <p className="text-amber-700 font-mono">Логин: {created.admin_username}</p>
              <p className="text-amber-700 font-mono">Пароль: {created.admin_password}</p>
            </div>
            <button onClick={() => setCreated(null)}
              className="w-full bg-violet-600 hover:bg-violet-700 text-white py-2.5 rounded-xl font-semibold">
              Понятно
            </button>
          </div>
        </div>
      )}

      {/* Детальный просмотр тенанта */}
      {details && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl p-6 w-full sm:max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">Тенант</h2>
              <button onClick={() => setDetails(null)} className="p-1 text-gray-400">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Название</span><span className="font-semibold">{details.name}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Slug</span><span className="font-mono">{details.slug}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Тариф</span><span className="font-bold text-violet-600 uppercase">{PLAN_LABELS[details.plan] || details.plan}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Статус</span><span>{details.subscription_status || '—'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">MRR</span><span>{Number(details.mrr || 0).toLocaleString('ru')} ₽</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Создан</span><span>{details.created_at ? new Date(details.created_at).toLocaleDateString('ru-RU') : '—'}</span></div>
            </div>
            <a href={TENANT_PORTAL_URL(details.slug)} target="_blank" rel="noopener noreferrer"
              className="mt-5 w-full flex items-center justify-center gap-2 bg-violet-600 text-white py-2.5 rounded-xl font-semibold">
              <span className="material-symbols-outlined">open_in_new</span>
              Перейти в /{details.slug}/admin
            </a>
          </div>
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
    { id:'overview',  label:'Обзор',     icon:'dashboard'            },
    { id:'tenants',   label:'Тенанты',   icon:'business'             },
    { id:'doctors',   label:'Врачи',     icon:'stethoscope'          },
    { id:'analytics', label:'Аналитика', icon:'bar_chart'            },
    { id:'reviews',   label:'Отзывы',    icon:'rate_review'          },
    { id:'knowledge', label:'База AI',   icon:'library_books'        },
    { id:'royalty',   label:'Роялти',    icon:'account_balance_wallet'},
    { id:'calls',     label:'Звонки',    icon:'call'                 },
    { id:'platform',  label:'Платформа', icon:'receipt_long'         },
    { id:'apt_stats', label:'Записи',    icon:'query_stats'          },
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

        {loading && tab !== 'reviews' && tab !== 'tenants' && (
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

        {tab === 'tenants' && <MyTenantsTab adminToken={adminToken} />}
        {tab === 'calls' && <CallRulesSection adminToken={adminToken} />}
        {tab === 'platform' && <PlatformInvoicesSection adminToken={adminToken} />}
        {tab === 'apt_stats' && <AppointmentsStatsSection token={adminToken} />}

        {tab === 'doctors' && (
          <Suspense fallback={<div className="flex justify-center py-16"><div className="w-10 h-10 border-4 border-purple-600 border-t-transparent rounded-full animate-spin" /></div>}>
            <DoctorsSection token={adminToken} />
          </Suspense>
        )}

        {tab === 'reviews' && <ReviewsTab adminToken={adminToken} />}

        {tab === 'knowledge' && (
          <Suspense fallback={<div className="flex justify-center py-16"><div className="w-10 h-10 border-4 border-purple-600 border-t-transparent rounded-full animate-spin" /></div>}>
            <AIKnowledgeSection token={adminToken} />
          </Suspense>
        )}

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
