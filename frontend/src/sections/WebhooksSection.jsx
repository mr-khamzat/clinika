/**
 * WebhooksSection — управление исходящими вебхуками тенанта.
 * Тенант регистрирует URL → система отправляет POST при событии.
 */
import { useState, useEffect, useCallback } from 'react'
import { API_BASE, BASE_PATH, SLUG } from '../config'
import { useToast, useConfirm } from '../design'

const API = API_BASE

function apiFetch(token, path, opts = {}) {
  return fetch(API + path, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  })
}

// Список доступных событий с описанием
const EVENT_LABELS = {
  referral_created: 'Направление создано',
  referral_confirmed: 'Направление подтверждено',
  referral_cancelled: 'Направление отменено',
  bonus_paid: 'Бонус начислен',
  patient_registered: 'Пациент зарегистрирован',
  clinic_created: 'Клиника создана',
  user_created: 'Пользователь создан',
  invoice_paid: 'Счёт оплачен',
  subscription_trial_ending: 'Триал заканчивается',
}

export default function WebhooksSection({ token }) {
  // Замена alert/confirm на Toast и Modal из design-system
  const { toast } = useToast()
  const { confirm, ConfirmHost } = useConfirm()
  const [webhooks, setWebhooks] = useState([])
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editId, setEditId] = useState(null)
  const [deliveries, setDeliveries] = useState(null)
  const [deliveriesId, setDeliveriesId] = useState(null)
  const [testLoading, setTestLoading] = useState(null)
  const [err, setErr] = useState('')

  const [form, setForm] = useState({ url: '', events: [], secret: '', description: '' })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [wRes, eRes] = await Promise.all([
        apiFetch(token, '/webhooks'),
        apiFetch(token, '/webhooks/events'),
      ])
      if (wRes.ok) setWebhooks(await wRes.json())
      if (eRes.ok) {
        const eData = await eRes.json()
        // /webhooks/events returns {events: {...}} — extract keys
        setEvents(Array.isArray(eData) ? eData : Object.keys(eData?.events || eData || {}))
      }
    } catch (e) { setErr('Ошибка загрузки') }
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  const resetForm = () => setForm({ url: '', events: [], secret: '', description: '' })

  const openCreate = () => { resetForm(); setEditId(null); setShowCreate(true) }
  const openEdit = (w) => {
    setForm({ url: w.url, events: w.events || [], secret: '', description: w.description || '' })
    setEditId(w.id)
    setShowCreate(true)
  }

  const toggleEvent = (ev) => {
    set('events', form.events.includes(ev) ? form.events.filter(e => e !== ev) : [...form.events, ev])
  }

  const save = async () => {
    if (!form.url.startsWith('http')) { setErr('URL должен начинаться с http:// или https://'); return }
    const payload = {
      url: form.url.trim(),
      events: form.events.length ? form.events : null,
      description: form.description.trim() || null,
      ...(form.secret.trim() ? { secret: form.secret.trim() } : {}),
    }
    const res = await apiFetch(token,
      editId ? `/webhooks/${editId}` : '/webhooks',
      { method: editId ? 'PATCH' : 'POST', body: JSON.stringify(payload) }
    )
    if (res.ok) { setShowCreate(false); resetForm(); setEditId(null); load() }
    else { const d = await res.json(); setErr(d.detail || 'Ошибка сохранения') }
  }

  const remove = async (id) => {
    if (!(await confirm('Удалить вебхук?', { danger: true, okText: 'Удалить' }))) return
    await apiFetch(token, `/webhooks/${id}`, { method: 'DELETE' })
    load()
  }

  const toggle = async (w) => {
    await apiFetch(token, `/webhooks/${w.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: !w.is_active }),
    })
    load()
  }

  const sendTest = async (id) => {
    setTestLoading(id)
    const res = await apiFetch(token, `/webhooks/${id}/test`, { method: 'POST' })
    const d = await res.json()
    if (res.ok) toast(`Тест отправлен ✓ статус ${d.status_code}`, 'success')
    else toast(`Ошибка: ${d.detail || 'неизвестна'}`, 'error')
    setTestLoading(null)
  }

  const loadDeliveries = async (id) => {
    if (deliveriesId === id) { setDeliveries(null); setDeliveriesId(null); return }
    const res = await apiFetch(token, `/webhooks/${id}/deliveries?limit=20`)
    if (res.ok) { setDeliveries(await res.json()); setDeliveriesId(id) }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-40">
      <span className="material-symbols-outlined animate-spin text-4xl text-gray-300">progress_activity</span>
    </div>
  )

  return (
    <div className="space-y-5">
      {/* Хост Modal-диалога подтверждения */}
      <ConfirmHost />
      {/* Заголовок */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold font-headline text-gray-900 dark:text-white">Вебхуки</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Получайте уведомления о событиях в реальном времени на ваш сервер
          </p>
        </div>
        <button onClick={openCreate}
          className="flex items-center gap-2 bg-[#0097A7] text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-[#00838f] transition">
          <span className="material-symbols-outlined text-base">add</span>
          Добавить
        </button>
      </div>

      {err && (
        <div className="bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-xl px-4 py-3 text-sm flex items-center gap-2">
          <span className="material-symbols-outlined text-base">error</span>
          {err}
          <button onClick={() => setErr('')} className="ml-auto opacity-60 hover:opacity-100">
            <span className="material-symbols-outlined text-base">close</span>
          </button>
        </div>
      )}

      {/* Форма создания/редактирования */}
      {showCreate && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 border border-[#0097A7]/30 shadow-sm space-y-4">
          <p className="font-bold text-gray-800 dark:text-white">{editId ? 'Редактировать вебхук' : 'Новый вебхук'}</p>

          <div>
            <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 block">URL эндпоинта *</label>
            <input value={form.url} onChange={e => set('url', e.target.value)}
              placeholder="https://yoursite.com/webhook"
              className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0097A7]/40" />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 block">
              События <span className="font-normal text-gray-400">(не выбрано = все)</span>
            </label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {events.map(ev => (
                <label key={ev} className="flex items-center gap-2 cursor-pointer group">
                  <input type="checkbox" checked={form.events.includes(ev)} onChange={() => toggleEvent(ev)}
                    className="w-4 h-4 accent-[#0097A7]" />
                  <span className="text-xs text-gray-600 dark:text-gray-400 group-hover:text-gray-900 dark:group-hover:text-white transition">
                    {EVENT_LABELS[ev] || ev}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 block">Секрет (HMAC)</label>
              <input value={form.secret} onChange={e => set('secret', e.target.value)}
                type="password" placeholder="Необязательно — для подписи"
                className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0097A7]/40" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 block">Описание</label>
              <input value={form.description} onChange={e => set('description', e.target.value)}
                placeholder="Например: CRM интеграция"
                className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0097A7]/40" />
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <button onClick={() => { setShowCreate(false); setEditId(null); resetForm() }}
              className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-xl py-2 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition">
              Отмена
            </button>
            <button onClick={save}
              className="flex-1 bg-[#0097A7] text-white rounded-xl py-2 text-sm font-semibold hover:bg-[#00838f] transition">
              {editId ? 'Сохранить' : 'Создать'}
            </button>
          </div>
        </div>
      )}

      {/* Список вебхуков */}
      {webhooks.length === 0 && !showCreate && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-8 text-center" style={{boxShadow:'0 4px 20px rgba(25,28,30,0.06)'}}>
          <span className="material-symbols-outlined text-5xl text-gray-200 dark:text-gray-600 mb-3 block">webhook</span>
          <p className="font-semibold text-gray-600 dark:text-gray-400">Нет зарегистрированных вебхуков</p>
          <p className="text-sm text-gray-400 mt-1">Добавьте URL для получения уведомлений о событиях</p>
          <button onClick={openCreate}
            className="mt-4 bg-[#0097A7] text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-[#00838f] transition">
            Добавить первый вебхук
          </button>
        </div>
      )}

      <div className="space-y-3">
        {webhooks.map(w => (
          <div key={w.id} className="bg-white dark:bg-gray-800 rounded-2xl overflow-hidden" style={{boxShadow:'0 4px 20px rgba(25,28,30,0.06)'}}>
            <div className="p-4">
              <div className="flex items-start gap-3">
                {/* Иконка статуса */}
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${w.is_active ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'bg-gray-100 dark:bg-gray-700'}`}>
                  <span className={`material-symbols-outlined text-lg ${w.is_active ? 'text-emerald-600' : 'text-gray-400'}`}
                    style={{fontVariationSettings:"'FILL' 1"}}>
                    {w.is_active ? 'webhook' : 'link_off'}
                  </span>
                </div>

                {/* Инфо */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-bold text-gray-800 dark:text-white truncate">{w.url}</p>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${w.is_active ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-gray-100 text-gray-500'}`}>
                      {w.is_active ? 'АКТИВЕН' : 'ОТКЛ'}
                    </span>
                    {w.last_status_code && (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${w.last_status_code < 300 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                        {w.last_status_code}
                      </span>
                    )}
                  </div>
                  {w.description && <p className="text-xs text-gray-400 mt-0.5">{w.description}</p>}
                  <div className="flex flex-wrap gap-1 mt-2">
                    {(w.events && w.events.length > 0 ? w.events : Object.keys(EVENT_LABELS)).slice(0, 5).map(ev => (
                      <span key={ev} className="text-[10px] bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">
                        {EVENT_LABELS[ev] || ev}
                      </span>
                    ))}
                    {w.events && w.events.length > 5 && (
                      <span className="text-[10px] text-gray-400">+{w.events.length - 5}</span>
                    )}
                    {(!w.events || w.events.length === 0) && (
                      <span className="text-[10px] text-gray-400 italic">все события</span>
                    )}
                  </div>
                </div>

                {/* Кнопки */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => toggle(w)} title={w.is_active ? 'Отключить' : 'Включить'}
                    className="w-8 h-8 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center transition">
                    <span className="material-symbols-outlined text-base text-gray-500">
                      {w.is_active ? 'pause' : 'play_arrow'}
                    </span>
                  </button>
                  <button onClick={() => sendTest(w.id)} disabled={testLoading === w.id} title="Тест"
                    className="w-8 h-8 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 flex items-center justify-center transition">
                    <span className={`material-symbols-outlined text-base text-blue-500 ${testLoading === w.id ? 'animate-spin' : ''}`}>
                      {testLoading === w.id ? 'progress_activity' : 'send'}
                    </span>
                  </button>
                  <button onClick={() => loadDeliveries(w.id)} title="История доставок"
                    className="w-8 h-8 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center transition">
                    <span className="material-symbols-outlined text-base text-gray-500">history</span>
                  </button>
                  <button onClick={() => openEdit(w)} title="Редактировать"
                    className="w-8 h-8 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center transition">
                    <span className="material-symbols-outlined text-base text-gray-500">edit</span>
                  </button>
                  <button onClick={() => remove(w.id)} title="Удалить"
                    className="w-8 h-8 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center justify-center transition">
                    <span className="material-symbols-outlined text-base text-red-400">delete</span>
                  </button>
                </div>
              </div>
            </div>

            {/* История доставок */}
            {deliveriesId === w.id && deliveries && (
              <div className="border-t border-gray-100 dark:border-gray-700 px-4 pb-4 pt-3">
                <p className="text-xs font-bold text-gray-500 dark:text-gray-400 mb-2">История доставок</p>
                {deliveries.length === 0 ? (
                  <p className="text-xs text-gray-400">Доставок ещё не было</p>
                ) : (
                  <div className="space-y-1">
                    {deliveries.map(d => (
                      <div key={d.id} className="flex items-center gap-3 text-xs py-1">
                        <span className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${d.success ? 'bg-emerald-50' : 'bg-red-50'}`}>
                          <span className={`material-symbols-outlined text-xs ${d.success ? 'text-emerald-600' : 'text-red-500'}`}
                            style={{fontVariationSettings:"'FILL' 1"}}>
                            {d.success ? 'check' : 'close'}
                          </span>
                        </span>
                        <span className="font-mono text-gray-500 dark:text-gray-400 flex-1 truncate">{d.event}</span>
                        <span className={`font-bold ${d.status_code && d.status_code < 300 ? 'text-emerald-600' : 'text-red-500'}`}>
                          {d.status_code || '—'}
                        </span>
                        <span className="text-gray-300 dark:text-gray-600">
                          {new Date(d.delivered_at).toLocaleString('ru-RU', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Справка */}
      <div className="bg-blue-50 dark:bg-blue-900/10 rounded-2xl p-4 text-sm text-blue-800 dark:text-blue-300">
        <p className="font-bold mb-2 flex items-center gap-2">
          <span className="material-symbols-outlined text-base">info</span>
          Как это работает
        </p>
        <ul className="space-y-1 text-xs text-blue-700 dark:text-blue-400">
          <li>• Мы отправляем POST запрос на ваш URL при каждом событии</li>
          <li>• Тело запроса: JSON с полями <code className="bg-blue-100 dark:bg-blue-900/30 px-1 rounded">event</code>, <code className="bg-blue-100 dark:bg-blue-900/30 px-1 rounded">payload</code>, <code className="bg-blue-100 dark:bg-blue-900/30 px-1 rounded">tenant_id</code>, <code className="bg-blue-100 dark:bg-blue-900/30 px-1 rounded">timestamp</code></li>
          <li>• Подпись: заголовок <code className="bg-blue-100 dark:bg-blue-900/30 px-1 rounded">X-Clinika-Signature</code> (HMAC-SHA256) если указан секрет</li>
          <li>• При ошибке — 3 попытки с задержкой</li>
        </ul>
      </div>
    </div>
  )
}
