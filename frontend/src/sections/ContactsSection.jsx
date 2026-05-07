import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import { API_BASE } from '../config'
import { useConfirm } from '../design'

function authH(token) { return { Authorization: `Bearer ${token}` } }

export default function ContactsSection({ token }) {
  // Замена window.confirm на Modal-диалог
  const { confirm, ConfirmHost } = useConfirm()
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [page, setPage] = useState(0)
  const [expanded, setExpanded] = useState(null)
  const limit = 30

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await axios.get(`${API_BASE}/contact/admin/list`, {
        headers: authH(token),
        params: { unread_only: unreadOnly, limit, offset: page * limit },
      })
      setItems(Array.isArray(r.data?.items) ? r.data.items : [])
      setTotal(r.data?.total || 0)
    } catch { setItems([]); setTotal(0) }
    setLoading(false)
  }, [token, unreadOnly, page])

  useEffect(() => { load() }, [load])

  async function markRead(id) {
    await axios.patch(`${API_BASE}/contact/admin/${id}/read`, {}, { headers: authH(token) })
    setItems(prev => prev.map(x => x.id === id ? { ...x, is_read: true } : x))
  }

  async function del(id) {
    if (!(await confirm('Удалить обращение?', { danger: true, okText: 'Удалить' }))) return
    await axios.delete(`${API_BASE}/contact/admin/${id}`, { headers: authH(token) })
    setItems(prev => prev.filter(x => x.id !== id))
    setTotal(t => t - 1)
  }

  const unreadCount = items.filter(x => !x.is_read).length

  return (
    <div>
      {/* Хост Modal-подтверждения */}
      <ConfirmHost />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Обращения с сайта</h2>
          <p className="text-sm text-gray-400 mt-0.5">Заявки из формы «Написать нам»</p>
        </div>
        {unreadCount > 0 && (
          <span className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 rounded-full text-sm font-semibold">
            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            {unreadCount} новых
          </span>
        )}
      </div>

      {/* Фильтры */}
      <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm mb-4 flex items-center gap-3">
        <button
          onClick={() => { setUnreadOnly(false); setPage(0) }}
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${!unreadOnly ? 'bg-[#0A2342] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          Все ({total})
        </button>
        <button
          onClick={() => { setUnreadOnly(true); setPage(0) }}
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${unreadOnly ? 'bg-[#0A2342] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          Непрочитанные
        </button>
        <button onClick={load} className="ml-auto text-gray-400 hover:text-gray-600 transition">
          <span className="material-symbols-outlined text-xl">refresh</span>
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-[#0A2342] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-2xl p-14 text-center border border-gray-100 shadow-sm">
          <span className="material-symbols-outlined text-5xl text-gray-200 block mb-3">mail</span>
          <p className="text-gray-400 text-sm">Нет обращений</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(item => (
            <div key={item.id}
              className={`bg-white rounded-2xl border shadow-sm transition ${item.is_read ? 'border-gray-100' : 'border-blue-200 ring-1 ring-blue-100'}`}>
              {/* Заголовок строки */}
              <div
                className="flex items-center gap-4 p-4 cursor-pointer"
                onClick={() => {
                  setExpanded(expanded === item.id ? null : item.id)
                  if (!item.is_read) markRead(item.id)
                }}>
                {/* Аватар */}
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm flex-shrink-0 ${item.is_read ? 'bg-gray-100 text-gray-500' : 'bg-blue-600 text-white'}`}>
                  {(item.name || item.phone || '?')[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-800 text-sm truncate">
                      {item.name || 'Без имени'}
                    </span>
                    {!item.is_read && (
                      <span className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0" />
                    )}
                  </div>
                  <div className="text-xs text-gray-400 flex items-center gap-3 mt-0.5">
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-xs" style={{ fontSize: 13 }}>phone</span>
                      {item.phone}
                    </span>
                    {item.email && (
                      <span className="flex items-center gap-1 truncate">
                        <span className="material-symbols-outlined text-xs" style={{ fontSize: 13 }}>mail</span>
                        {item.email}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-xs text-gray-400">
                    {item.created_at ? new Date(item.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }) : ''}
                  </div>
                  <div className="text-xs text-gray-400">
                    {item.created_at ? new Date(item.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : ''}
                  </div>
                </div>
                <span className="material-symbols-outlined text-gray-300 text-xl flex-shrink-0">
                  {expanded === item.id ? 'expand_less' : 'expand_more'}
                </span>
              </div>

              {/* Раскрытое сообщение */}
              {expanded === item.id && (
                <div className="px-4 pb-4 border-t border-gray-50 pt-3">
                  <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap mb-4 bg-gray-50 rounded-xl p-4">
                    {item.message}
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <a href={`tel:${item.phone}`}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-medium hover:bg-emerald-100 transition">
                      <span className="material-symbols-outlined text-base" style={{ fontVariationSettings: "'FILL' 1" }}>phone</span>
                      Позвонить
                    </a>
                    {item.email && (
                      <a href={`mailto:${item.email}`}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-medium hover:bg-blue-100 transition">
                        <span className="material-symbols-outlined text-base" style={{ fontVariationSettings: "'FILL' 1" }}>mail</span>
                        Написать Email
                      </a>
                    )}
                    {!item.is_read && (
                      <button onClick={() => markRead(item.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-100 transition">
                        <span className="material-symbols-outlined text-base">mark_email_read</span>
                        Отметить прочитанным
                      </button>
                    )}
                    <button onClick={() => del(item.id)}
                      className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-medium hover:bg-red-100 transition">
                      <span className="material-symbols-outlined text-base">delete</span>
                      Удалить
                    </button>
                  </div>
                </div>
              )}
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
          <span className="px-4 py-2 text-sm text-gray-500">{page + 1} / {Math.ceil(total / limit)}</span>
          <button disabled={(page + 1) * limit >= total} onClick={() => setPage(p => p + 1)}
            className="px-4 py-2 rounded-lg bg-white border border-gray-200 text-sm text-gray-600 disabled:opacity-40 hover:bg-gray-50 transition">
            Вперёд →
          </button>
        </div>
      )}
    </div>
  )
}
