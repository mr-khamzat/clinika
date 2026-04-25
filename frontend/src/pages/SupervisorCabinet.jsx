import { useState, useEffect } from 'react'
import axios from 'axios'
import { API_BASE } from '../config'

const api = (token) => ({
  get: (url, params) =>
    axios.get(API_BASE + url, {
      headers: { Authorization: `Bearer ${token}` },
      params,
    }),
})

const ROLE_LABELS = {
  admin: 'Администратор',
  manager: 'Руководитель',
  doctor: 'Врач',
  nurse: 'Медсестра',
  recruiter: 'Рекрутер',
  supervisor: 'Супервизор',
  partner: 'Партнёр',
  super_admin: 'Супер-админ',
}

export default function SupervisorCabinet({ adminToken, user, onLogout }) {
  const [tab, setTab] = useState('dashboard')

  // Дашборд
  const [days, setDays] = useState(30)
  const [dashboard, setDashboard] = useState(null)
  const [dashLoading, setDashLoading] = useState(false)
  const [dashError, setDashError] = useState('')

  // Пользователи
  const [users, setUsers] = useState([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [usersSearch, setUsersSearch] = useState('')

  // Журнал аудита
  const [auditItems, setAuditItems] = useState([])
  const [auditTotal, setAuditTotal] = useState(0)
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditSkip, setAuditSkip] = useState(0)
  const AUDIT_LIMIT = 50

  const a = api(adminToken)

  // Загрузка при смене вкладки
  useEffect(() => {
    if (tab === 'dashboard') loadDashboard()
    if (tab === 'users') loadUsers()
    if (tab === 'journal') loadAudit(0)
  }, [tab])

  // Перезагрузка дашборда при смене периода
  useEffect(() => {
    if (tab === 'dashboard') loadDashboard()
  }, [days])

  async function loadDashboard() {
    setDashLoading(true)
    setDashError('')
    try {
      const res = await a.get('/supervisor/dashboard', { days })
      setDashboard(res.data)
    } catch (err) {
      setDashError(err?.response?.data?.detail || 'Ошибка загрузки статистики')
    }
    setDashLoading(false)
  }

  async function loadUsers() {
    setUsersLoading(true)
    try {
      const res = await a.get('/supervisor/users')
      setUsers(Array.isArray(res.data) ? res.data : [])
    } catch {
      setUsers([])
    }
    setUsersLoading(false)
  }

  async function loadAudit(skip = 0) {
    setAuditLoading(true)
    try {
      const res = await a.get('/supervisor/audit', { skip, limit: AUDIT_LIMIT, days: 90 })
      setAuditItems(res.data.items || [])
      setAuditTotal(res.data.total || 0)
      setAuditSkip(skip)
    } catch {
      // TODO: если endpoint не вернул данные — показываем пустой список
      setAuditItems([])
      setAuditTotal(0)
    }
    setAuditLoading(false)
  }

  const filteredUsers = users.filter((u) => {
    if (!usersSearch) return true
    const q = usersSearch.toLowerCase()
    return (
      u.full_name?.toLowerCase().includes(q) ||
      u.email?.toLowerCase().includes(q) ||
      u.phone_number?.toLowerCase().includes(q) ||
      u.role?.toLowerCase().includes(q)
    )
  })

  const tabs = [
    { key: 'dashboard', label: 'Дашборд' },
    { key: 'users', label: 'Пользователи' },
    { key: 'journal', label: 'Журнал' },
  ]

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Шапка */}
      <header className="bg-gray-800 border-b border-gray-700 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <div className="text-base font-bold text-white">{user.full_name || 'Супервизор'}</div>
            <div className="text-xs text-teal-400 font-medium">Кабинет супервизора</div>
          </div>
          <button
            onClick={onLogout}
            className="text-xs text-gray-400 hover:text-gray-200 transition"
          >
            Выйти
          </button>
        </div>

        {/* Вкладки */}
        <div className="max-w-5xl mx-auto px-4 flex gap-1 pb-0 overflow-x-auto no-scrollbar">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition whitespace-nowrap ${
                tab === t.key
                  ? 'border-teal-400 text-teal-400'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">

        {/* ─── Дашборд ─── */}
        {tab === 'dashboard' && (
          <div className="space-y-6">
            {/* Фильтр периода */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-gray-400">Период:</span>
              {[7, 30, 90].map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={`px-3 py-1 rounded-lg text-sm font-semibold transition ${
                    days === d
                      ? 'bg-teal-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {d} дней
                </button>
              ))}
            </div>

            {dashError && (
              <div className="bg-red-900/40 border border-red-700 rounded-xl p-4 text-red-300 text-sm">
                {dashError}
              </div>
            )}

            {dashLoading ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-24 bg-gray-700 rounded-xl animate-pulse" />
                ))}
              </div>
            ) : dashboard ? (
              <>
                {/* Карточки метрик */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 text-center">
                    <div className="text-xs text-gray-400 mb-1">Направлений</div>
                    <div className="text-2xl font-bold text-white">
                      {dashboard.total_referrals}
                    </div>
                    <div className="text-xs text-gray-500">за {dashboard.period_days} дней</div>
                  </div>
                  <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 text-center">
                    <div className="text-xs text-gray-400 mb-1">Пациентов</div>
                    <div className="text-2xl font-bold text-teal-400">
                      {dashboard.unique_patients}
                    </div>
                    <div className="text-xs text-gray-500">уникальных</div>
                  </div>
                  <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 text-center">
                    <div className="text-xs text-gray-400 mb-1">Врачей</div>
                    <div className="text-2xl font-bold text-blue-400">
                      {dashboard.active_doctors}
                    </div>
                    <div className="text-xs text-gray-500">активных</div>
                  </div>
                  <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 text-center">
                    <div className="text-xs text-gray-400 mb-1">Клиник</div>
                    <div className="text-2xl font-bold text-purple-400">
                      {dashboard.total_clinics}
                    </div>
                    <div className="text-xs text-gray-500">активных</div>
                  </div>
                </div>

                {/* Топ врачей */}
                {dashboard.top_doctors && dashboard.top_doctors.length > 0 && (
                  <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
                    <h3 className="text-sm font-bold text-white mb-4">
                      Топ-5 врачей по направлениям
                    </h3>
                    <div className="space-y-2">
                      {dashboard.top_doctors.map((doc, idx) => (
                        <div
                          key={doc.id}
                          className="flex items-center justify-between py-2 border-b border-gray-700 last:border-0"
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-bold text-gray-500 w-5">
                              {idx + 1}
                            </span>
                            <span className="text-sm text-white">{doc.full_name}</span>
                          </div>
                          <span className="text-sm font-semibold text-teal-400">
                            {doc.referrals_count} нап.
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {dashboard.top_doctors && dashboard.top_doctors.length === 0 && (
                  <div className="text-center py-8 text-gray-500 text-sm">
                    Нет данных о направлениях за выбранный период
                  </div>
                )}
              </>
            ) : null}
          </div>
        )}

        {/* ─── Пользователи ─── */}
        {tab === 'users' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <h2 className="text-lg font-bold text-white">Пользователи тенанта</h2>
              <input
                type="text"
                placeholder="Поиск по имени, email, роли..."
                value={usersSearch}
                onChange={(e) => setUsersSearch(e.target.value)}
                className="bg-gray-700 border border-gray-600 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 w-64"
              />
            </div>

            {usersLoading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-14 bg-gray-700 rounded-xl animate-pulse" />
                ))}
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="text-center py-12 text-gray-500 text-sm">
                {usersSearch ? 'Ничего не найдено' : 'Нет пользователей'}
              </div>
            ) : (
              <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-700">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                        ФИО
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide hidden md:table-cell">
                        Email / Телефон
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                        Роль
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                        Статус
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide hidden lg:table-cell">
                        Создан
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((u) => (
                      <tr
                        key={u.id}
                        className="border-b border-gray-700 last:border-0 hover:bg-gray-750 transition"
                      >
                        <td className="px-4 py-3 text-white font-medium">{u.full_name}</td>
                        <td className="px-4 py-3 text-gray-400 hidden md:table-cell">
                          {u.email || u.phone_number || '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded-full">
                            {ROLE_LABELS[u.role] || u.role}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                              u.is_active
                                ? 'bg-green-900/40 text-green-400'
                                : 'bg-gray-700 text-gray-400'
                            }`}
                          >
                            {u.is_active ? 'Активен' : 'Неактивен'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs hidden lg:table-cell">
                          {new Date(u.created_at).toLocaleDateString('ru')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {!usersLoading && (
              <div className="text-xs text-gray-500 text-right">
                Показано: {filteredUsers.length} из {users.length}
              </div>
            )}
          </div>
        )}

        {/* ─── Журнал аудита ─── */}
        {tab === 'journal' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">Журнал действий</h2>
              {auditTotal > 0 && (
                <span className="text-xs text-gray-500">
                  Всего записей: {auditTotal}
                </span>
              )}
            </div>

            {auditLoading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-14 bg-gray-700 rounded-xl animate-pulse" />
                ))}
              </div>
            ) : auditItems.length === 0 ? (
              <div className="text-center py-12 text-gray-500 text-sm">
                Журнал пуст — нет событий за последние 90 дней
              </div>
            ) : (
              <>
                <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-700">
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                          Действие
                        </th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide hidden md:table-cell">
                          Объект
                        </th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                          Пользователь
                        </th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                          Время
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditItems.map((entry) => (
                        <tr
                          key={entry.id}
                          className="border-b border-gray-700 last:border-0 hover:bg-gray-750 transition"
                        >
                          <td className="px-4 py-3">
                            <span className="text-xs font-mono bg-gray-700 text-teal-300 px-2 py-0.5 rounded">
                              {entry.action}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-400 text-xs hidden md:table-cell">
                            {entry.entity_type || '—'}
                            {entry.entity_id && (
                              <span className="text-gray-600 ml-1">
                                #{entry.entity_id.slice(0, 8)}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-300 text-xs">
                            {entry.actor_name || '—'}
                          </td>
                          <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                            {new Date(entry.created_at).toLocaleString('ru', {
                              day: '2-digit',
                              month: '2-digit',
                              year: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Пагинация */}
                {auditTotal > AUDIT_LIMIT && (
                  <div className="flex justify-center gap-2 mt-4">
                    <button
                      disabled={auditSkip === 0}
                      onClick={() => loadAudit(Math.max(0, auditSkip - AUDIT_LIMIT))}
                      className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg text-sm disabled:opacity-40 hover:bg-gray-600 transition"
                    >
                      Назад
                    </button>
                    <span className="px-4 py-2 text-gray-500 text-sm">
                      {Math.floor(auditSkip / AUDIT_LIMIT) + 1} /{' '}
                      {Math.ceil(auditTotal / AUDIT_LIMIT)}
                    </span>
                    <button
                      disabled={auditSkip + AUDIT_LIMIT >= auditTotal}
                      onClick={() => loadAudit(auditSkip + AUDIT_LIMIT)}
                      className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg text-sm disabled:opacity-40 hover:bg-gray-600 transition"
                    >
                      Вперёд
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
