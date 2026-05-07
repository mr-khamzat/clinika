import { useState, useEffect } from 'react'
import axios from 'axios'
import { API_BASE } from '../config'
import { useConfirm } from '../design'

function authH(token) { return { Authorization: `Bearer ${token}` } }

const STATUS = {
  pending:  { label: 'На модерации', color: '#d97706', bg: 'rgba(217,119,6,.1)' },
  approved: { label: 'Одобрен',      color: '#16a34a', bg: 'rgba(22,163,74,.1)' },
  rejected: { label: 'Отклонён',     color: '#dc2626', bg: 'rgba(220,38,38,.1)' },
}

function Stars({ rating, size = 'text-base' }) {
  return (
    <span className={`${size} leading-none`}>
      {[1,2,3,4,5].map(i => (
        <span key={i} style={{ color: i <= rating ? '#f59e0b' : '#d1d5db' }}>★</span>
      ))}
    </span>
  )
}

export default function ReviewsSection({ token }) {
  // Замена window.confirm на Modal
  const { confirm, ConfirmHost } = useConfirm()
  const [reviews, setReviews]   = useState([])
  const [total,   setTotal]     = useState(0)
  const [loading, setLoading]   = useState(true)
  const [filter,  setFilter]    = useState('pending')
  const [offset,  setOffset]    = useState(0)
  const [msg,     setMsg]       = useState('')
  const LIMIT = 20

  useEffect(() => { load(filter, 0) }, [filter])

  async function load(status, off) {
    setLoading(true)
    setOffset(off)
    try {
      const params = { limit: LIMIT, offset: off }
      if (status !== 'all') params.status = status
      const r = await axios.get(`${API_BASE}/reviews/moderate`, { headers: authH(token), params })
      setReviews(r.data.items || [])
      setTotal(r.data.total || 0)
    } catch {}
    setLoading(false)
  }

  async function act(id, action) {
    try {
      await axios.patch(`${API_BASE}/reviews/${id}/${action}`, {}, { headers: authH(token) })
      setMsg(action === 'approve' ? 'Одобрено ✓' : 'Отклонено ✓')
      await load(filter, offset)
    } catch (e) {
      setMsg('Ошибка: ' + (e.response?.data?.detail || e.message))
    }
    setTimeout(() => setMsg(''), 3000)
  }

  async function del(id) {
    if (!(await confirm('Удалить отзыв?', { danger: true, okText: 'Удалить' }))) return
    try {
      await axios.delete(`${API_BASE}/reviews/${id}`, { headers: authH(token) })
      setMsg('Удалено ✓')
      await load(filter, offset)
    } catch (e) {
      setMsg('Ошибка: ' + (e.response?.data?.detail || e.message))
    }
    setTimeout(() => setMsg(''), 3000)
  }

  const FILTERS = [
    { key: 'pending',  label: 'Ожидают' },
    { key: 'approved', label: 'Одобренные' },
    { key: 'rejected', label: 'Отклонённые' },
    { key: 'all',      label: 'Все' },
  ]

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <ConfirmHost />
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Отзывы пациентов</h1>
          <p className="text-sm text-gray-500 mt-1">Всего: {total}</p>
        </div>
        <div className="flex gap-1.5">
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-xl text-sm font-medium transition ${
                filter === f.key ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300'
              }`}>{f.label}</button>
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
          <div className="w-10 h-10 border-4 border-teal-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : reviews.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-10 text-center text-gray-400">
          <span className="material-symbols-outlined text-4xl block mb-2">rate_review</span>
          Отзывов нет
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {reviews.map(r => {
            const st = STATUS[r.status] || STATUS.pending
            return (
              <div key={r.id} className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 font-bold text-lg flex-shrink-0">
                    {r.is_anonymous ? '?' : (r.patient_name?.[0] || '?').toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-800 dark:text-white text-sm">
                        {r.is_anonymous ? 'Анонимно' : (r.patient_name || 'Пациент')}
                      </span>
                      <Stars rating={r.rating} />
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium"
                        style={{ background: st.bg, color: st.color }}>{st.label}</span>
                    </div>
                    {r.comment && (
                      <p className="text-sm text-gray-600 dark:text-gray-300 mt-2 leading-relaxed">{r.comment}</p>
                    )}
                    <div className="text-xs text-gray-400 mt-1.5">
                      {r.created_at ? new Date(r.created_at).toLocaleString('ru') : '—'}
                      {r.patient_phone && !r.is_anonymous && ` · ${r.patient_phone}`}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5 flex-shrink-0">
                    {r.status === 'pending' && (
                      <>
                        <button onClick={() => act(r.id, 'approve')}
                          className="px-3 py-1.5 bg-green-50 text-green-700 rounded-xl text-xs font-semibold hover:bg-green-100 transition flex items-center gap-1">
                          <span className="material-symbols-outlined text-sm">check</span> Одобрить
                        </button>
                        <button onClick={() => act(r.id, 'reject')}
                          className="px-3 py-1.5 bg-red-50 text-red-600 rounded-xl text-xs font-semibold hover:bg-red-100 transition flex items-center gap-1">
                          <span className="material-symbols-outlined text-sm">close</span> Отклонить
                        </button>
                      </>
                    )}
                    {r.status === 'approved' && (
                      <button onClick={() => act(r.id, 'reject')}
                        className="px-3 py-1.5 bg-gray-50 text-gray-500 rounded-xl text-xs hover:bg-red-50 hover:text-red-600 transition">
                        Снять
                      </button>
                    )}
                    {r.status === 'rejected' && (
                      <button onClick={() => act(r.id, 'approve')}
                        className="px-3 py-1.5 bg-gray-50 text-gray-500 rounded-xl text-xs hover:bg-green-50 hover:text-green-700 transition">
                        Одобрить
                      </button>
                    )}
                    <button onClick={() => del(r.id)}
                      className="px-3 py-1.5 bg-gray-50 text-gray-400 rounded-xl text-xs hover:bg-red-50 hover:text-red-500 transition flex items-center gap-1">
                      <span className="material-symbols-outlined text-sm">delete</span>
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Пагинация */}
      {total > LIMIT && (
        <div className="flex justify-center gap-3 mt-6">
          <button disabled={offset === 0}
            onClick={() => load(filter, Math.max(0, offset - LIMIT))}
            className="px-4 py-2 rounded-xl bg-gray-100 text-gray-600 disabled:opacity-40 hover:bg-gray-200 transition text-sm">
            ← Назад
          </button>
          <span className="px-4 py-2 text-sm text-gray-500">
            {offset + 1}–{Math.min(offset + LIMIT, total)} из {total}
          </span>
          <button disabled={offset + LIMIT >= total}
            onClick={() => load(filter, offset + LIMIT)}
            className="px-4 py-2 rounded-xl bg-gray-100 text-gray-600 disabled:opacity-40 hover:bg-gray-200 transition text-sm">
            Вперёд →
          </button>
        </div>
      )}
    </div>
  )
}
