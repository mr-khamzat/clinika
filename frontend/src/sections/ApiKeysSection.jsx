/**
 * ApiKeysSection — управление API-ключами тенанта для внешних интеграций (CRM / BI).
 *
 * Ключи генерируются на бэкенде (`POST /tenant/api-keys`) и показываются в raw-виде
 * ОДИН раз — далее в БД хранится только sha256-хэш и префикс.
 *
 * Скоупы и rate-limit описаны в встроенной документации в нижней части секции.
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { API_BASE } from '../config'
import { useToast, useConfirm } from '../design'

const API = API_BASE

function apiFetch(token, path, opts = {}) {
  return fetch(API + path, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  })
}

// ── Скоупы (синхронно с api_key_service.ALLOWED_SCOPES) ─────────────────────
const SCOPE_DEFS = [
  { key: 'read:referrals',    label: 'Чтение направлений',  group: 'Направления' },
  { key: 'write:referrals',   label: 'Создание направлений', group: 'Направления' },
  { key: 'read:patients',     label: 'Чтение пациентов',     group: 'Пациенты' },
  { key: 'write:patients',    label: 'Изменение пациентов',  group: 'Пациенты' },
  { key: 'read:appointments', label: 'Чтение записей',       group: 'Расписание' },
  { key: 'read:finance',      label: 'Чтение финсводки',     group: 'Финансы' },
]

const TTL_PRESETS = [
  { value: 30,   label: '30 дней' },
  { value: 90,   label: '90 дней' },
  { value: 365,  label: '1 год' },
  { value: 0,    label: 'Без срока' },
]

const STATUS_BADGES = {
  active:  { label: 'Активный',  cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300' },
  revoked: { label: 'Отозван',   cls: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400' },
  expired: { label: 'Просрочен', cls: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300' },
}

function formatDate(iso) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}

// ── Reusable copy-button с tooltip «Скопировано» ────────────────────────────
function CopyButton({ value, label = 'Скопировать', className = '' }) {
  const [copied, setCopied] = useState(false)
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // fallback
      const ta = document.createElement('textarea')
      ta.value = value; document.body.appendChild(ta); ta.select()
      try { document.execCommand('copy') } catch {}
      document.body.removeChild(ta)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    }
  }
  return (
    <button onClick={onClick}
      className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition
        ${copied ? 'bg-emerald-600 text-white' : 'bg-[#0097A7] text-white hover:bg-[#00838f]'} ${className}`}>
      <span className="material-symbols-outlined text-sm">
        {copied ? 'check' : 'content_copy'}
      </span>
      {copied ? 'Скопировано' : label}
      {copied && (
        <span className="absolute -top-7 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-[10px] px-2 py-0.5 rounded whitespace-nowrap">
          В буфере обмена
        </span>
      )}
    </button>
  )
}

// ── Документация API (раскрывающаяся) ───────────────────────────────────────
function ApiDocs() {
  const [open, setOpen] = useState(false)
  const curl = (path, scope) =>
    `curl -H "Authorization: Bearer clk_live_..." \\\n     "https://clinikset.ru${path}"   # требует scope: ${scope}`
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl overflow-hidden" style={{boxShadow:'0 4px 20px rgba(25,28,30,0.06)'}}>
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[#0097A7]">menu_book</span>
          <span className="font-bold text-gray-800 dark:text-white">Документация API</span>
          <span className="text-xs text-gray-400">curl, скоупы, rate-limit</span>
        </div>
        <span className="material-symbols-outlined text-gray-400">{open ? 'expand_less' : 'expand_more'}</span>
      </button>
      {open && (
        <div className="px-5 pb-5 space-y-5 border-t border-gray-100 dark:border-gray-700 pt-4">
          {/* Базовый URL */}
          <div>
            <p className="font-semibold text-sm text-gray-700 dark:text-gray-200 mb-1">Базовый URL</p>
            <code className="block text-xs bg-gray-50 dark:bg-gray-900 rounded-lg p-2 font-mono">
              https://clinikset.ru/api/v1
            </code>
          </div>

          {/* Авторизация */}
          <div>
            <p className="font-semibold text-sm text-gray-700 dark:text-gray-200 mb-1">Авторизация</p>
            <p className="text-xs text-gray-500 mb-2">
              Один из двух заголовков:
            </p>
            <pre className="text-xs bg-gray-50 dark:bg-gray-900 rounded-lg p-2 font-mono overflow-x-auto">
{`Authorization: Bearer clk_live_AbCdEf...
# или
X-Clinika-API-Key: clk_live_AbCdEf...`}
            </pre>
          </div>

          {/* Скоупы */}
          <div>
            <p className="font-semibold text-sm text-gray-700 dark:text-gray-200 mb-2">Скоупы</p>
            <div className="grid md:grid-cols-2 gap-1.5">
              {SCOPE_DEFS.map(s => (
                <div key={s.key} className="flex items-center gap-2 text-xs">
                  <code className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded font-mono text-gray-700 dark:text-gray-200">{s.key}</code>
                  <span className="text-gray-500 dark:text-gray-400">— {s.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Rate-limit */}
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/30 rounded-lg p-3">
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1">
              <span className="material-symbols-outlined text-sm">speed</span>
              Rate-limit: 1000 запросов в час на ключ
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
              При превышении возвращается HTTP 429. Используйте экспоненциальный backoff.
            </p>
          </div>

          {/* curl примеры */}
          <div className="space-y-3">
            <p className="font-semibold text-sm text-gray-700 dark:text-gray-200">Примеры curl</p>

            {[
              { title: 'Список направлений', path: '/api/v1/referrals?limit=50', scope: 'read:referrals' },
              { title: 'Одно направление',   path: '/api/v1/referrals/{id}',     scope: 'read:referrals' },
              { title: 'Поиск пациентов',    path: '/api/v1/patients?phone=7989', scope: 'read:patients' },
              { title: 'Записи на приём',    path: '/api/v1/appointments?date_from=2026-01-01', scope: 'read:appointments' },
              { title: 'Финсводка',          path: '/api/v1/finance/summary?date_from=2026-01-01&date_to=2026-12-31', scope: 'read:finance' },
              { title: 'Проверка ключа',     path: '/api/v1/whoami',             scope: '— (любой)' },
            ].map(ex => (
              <div key={ex.path}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{ex.title}</span>
                  <code className="text-[10px] text-gray-400">scope: {ex.scope}</code>
                </div>
                <div className="relative">
                  <pre className="text-xs bg-gray-900 text-gray-100 rounded-lg p-2.5 font-mono overflow-x-auto pr-20">
{curl(ex.path, ex.scope)}
                  </pre>
                  <div className="absolute top-2 right-2">
                    <CopyButton value={curl(ex.path, ex.scope)} label="" className="!px-2 !py-1" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Webhooks tutorial */}
          <div className="bg-[#0097A7]/5 dark:bg-[#0097A7]/10 border border-[#0097A7]/20 rounded-lg p-3">
            <p className="text-xs font-semibold text-[#0097A7] flex items-center gap-1">
              <span className="material-symbols-outlined text-sm">webhook</span>
              Webhooks — обратная сторона
            </p>
            <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">
              API-ключи нужны если ваша CRM/BI <b>забирает</b> данные из КлиникСети.
              Если же вы хотите получать события в реальном времени (push-уведомления),
              используйте раздел <b>«Платформа → Webhooks»</b> — там настраиваются исходящие
              POST-запросы с HMAC-подписью.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Главный компонент ──────────────────────────────────────────────────────
export default function ApiKeysSection({ token }) {
  const { toast } = useToast()
  const { confirm, ConfirmHost } = useConfirm()

  const [keys, setKeys] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', scopes: [], ttl_days: 365, allowed_ips: '' })
  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Модалка с raw-key (показывается ОДИН раз)
  const [revealed, setRevealed] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const res = await apiFetch(token, '/tenant/api-keys')
      if (res.ok) setKeys(await res.json())
      else if (res.status === 402) setErr('Модуль API-ключей не подключён в вашем тарифе')
      else setErr('Не удалось загрузить ключи')
    } catch { setErr('Ошибка сети') }
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  const resetForm = () => setForm({ name: '', scopes: [], ttl_days: 365, allowed_ips: '' })
  const openCreate = () => { resetForm(); setShowCreate(true) }

  const toggleScope = (s) => {
    setF('scopes', form.scopes.includes(s) ? form.scopes.filter(x => x !== s) : [...form.scopes, s])
  }

  const create = async () => {
    if (!form.name.trim()) { setErr('Укажите название ключа'); return }
    if (form.scopes.length === 0) { setErr('Выберите хотя бы один scope'); return }
    const allowed = form.allowed_ips.split(/[\n,]/).map(s => s.trim()).filter(Boolean)
    const body = {
      name: form.name.trim(),
      scopes: form.scopes,
      ttl_days: form.ttl_days || null,
      allowed_ips: allowed.length ? allowed : null,
    }
    const res = await apiFetch(token, '/tenant/api-keys', { method: 'POST', body: JSON.stringify(body) })
    if (res.ok) {
      const d = await res.json()
      setRevealed(d) // показываем raw key один раз
      setShowCreate(false); resetForm()
      load()
    } else {
      const d = await res.json().catch(() => ({}))
      setErr(d.detail || 'Не удалось создать ключ')
    }
  }

  const revoke = async (k) => {
    if (!(await confirm(`Отозвать ключ «${k.name}»? Это действие необратимо.`, { danger: true, okText: 'Отозвать' }))) return
    const res = await apiFetch(token, `/tenant/api-keys/${k.id}`, { method: 'DELETE' })
    if (res.ok) { toast('Ключ отозван', 'success'); load() }
    else toast('Не удалось отозвать', 'error')
  }

  const sortedKeys = useMemo(() => {
    return [...keys].sort((a, b) => {
      const order = { active: 0, expired: 1, revoked: 2 }
      const sa = order[a.status] ?? 3
      const sb = order[b.status] ?? 3
      if (sa !== sb) return sa - sb
      return (b.created_at || '').localeCompare(a.created_at || '')
    })
  }, [keys])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <span className="material-symbols-outlined animate-spin text-4xl text-gray-300">progress_activity</span>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <ConfirmHost />

      {/* Заголовок */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold font-headline text-gray-900 dark:text-white">API-ключи</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Внешний доступ для CRM, BI и собственных интеграций. Ключи действуют per-tenant.
          </p>
        </div>
        <button onClick={openCreate}
          className="flex items-center gap-2 bg-[#0097A7] text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-[#00838f] transition">
          <span className="material-symbols-outlined text-base">add</span>
          Создать ключ
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

      {/* Форма создания */}
      {showCreate && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 border border-[#0097A7]/30 shadow-sm space-y-4">
          <p className="font-bold text-gray-800 dark:text-white">Новый API-ключ</p>

          <div>
            <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 block">Название *</label>
            <input value={form.name} onChange={e => setF('name', e.target.value)}
              placeholder="Например: amoCRM продакшен"
              className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0097A7]/40" />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 block">
              Скоупы *
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {SCOPE_DEFS.map(s => (
                <label key={s.key} className="flex items-center gap-2 cursor-pointer group p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/40 transition">
                  <input type="checkbox" checked={form.scopes.includes(s.key)} onChange={() => toggleScope(s.key)}
                    className="w-4 h-4 accent-[#0097A7]" />
                  <div className="flex flex-col">
                    <span className="text-xs font-mono text-gray-700 dark:text-gray-200">{s.key}</span>
                    <span className="text-[10px] text-gray-400">{s.label}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 block">Срок действия</label>
              <select value={form.ttl_days} onChange={e => setF('ttl_days', Number(e.target.value))}
                className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0097A7]/40">
                {TTL_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 block">
                IP allowlist <span className="font-normal text-gray-400">(опционально)</span>
              </label>
              <textarea value={form.allowed_ips} onChange={e => setF('allowed_ips', e.target.value)}
                rows={2} placeholder="1.2.3.4, 10.0.0.0/24"
                className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0097A7]/40 resize-none" />
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <button onClick={() => { setShowCreate(false); resetForm() }}
              className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-xl py-2 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition">
              Отмена
            </button>
            <button onClick={create}
              className="flex-1 bg-[#0097A7] text-white rounded-xl py-2 text-sm font-semibold hover:bg-[#00838f] transition">
              Создать ключ
            </button>
          </div>
        </div>
      )}

      {/* Пустое состояние */}
      {sortedKeys.length === 0 && !showCreate && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-8 text-center" style={{boxShadow:'0 4px 20px rgba(25,28,30,0.06)'}}>
          <span className="material-symbols-outlined text-5xl text-gray-200 dark:text-gray-600 mb-3 block">vpn_key</span>
          <p className="font-semibold text-gray-600 dark:text-gray-400">Нет созданных API-ключей</p>
          <p className="text-sm text-gray-400 mt-1">Создайте ключ для подключения вашей CRM или BI-системы</p>
          <button onClick={openCreate}
            className="mt-4 bg-[#0097A7] text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-[#00838f] transition">
            Создать первый ключ
          </button>
        </div>
      )}

      {/* Таблица ключей */}
      {sortedKeys.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl overflow-hidden" style={{boxShadow:'0 4px 20px rgba(25,28,30,0.06)'}}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900/40 text-xs uppercase text-gray-500">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold">Название</th>
                  <th className="text-left px-4 py-3 font-semibold">Ключ</th>
                  <th className="text-left px-4 py-3 font-semibold">Скоупы</th>
                  <th className="text-left px-4 py-3 font-semibold">Использован</th>
                  <th className="text-left px-4 py-3 font-semibold">Срок</th>
                  <th className="text-left px-4 py-3 font-semibold">Статус</th>
                  <th className="text-right px-4 py-3 font-semibold">Действия</th>
                </tr>
              </thead>
              <tbody>
                {sortedKeys.map(k => {
                  const badge = STATUS_BADGES[k.status] || STATUS_BADGES.active
                  return (
                    <tr key={k.id} className="border-t border-gray-100 dark:border-gray-700">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-gray-800 dark:text-white">{k.name}</div>
                        <div className="text-xs text-gray-400">{k.request_count} запросов</div>
                      </td>
                      <td className="px-4 py-3">
                        <code className="text-xs font-mono bg-gray-50 dark:bg-gray-900 px-2 py-1 rounded text-gray-600 dark:text-gray-300">
                          {k.key_prefix}
                        </code>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1 max-w-[220px]">
                          {(k.scopes || []).map(s => (
                            <span key={s} className="text-[10px] font-mono bg-[#0097A7]/10 text-[#0097A7] dark:text-[#5fd2e0] px-1.5 py-0.5 rounded">
                              {s}
                            </span>
                          ))}
                          {(!k.scopes || k.scopes.length === 0) && <span className="text-xs text-gray-400">—</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-300">
                        {formatDate(k.last_used_at)}
                        {k.last_used_ip && (
                          <div className="text-[10px] text-gray-400 font-mono">{k.last_used_ip}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-300">
                        {k.expires_at ? formatDate(k.expires_at) : <span className="text-gray-400">бессрочно</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] font-semibold px-2 py-1 rounded-full ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {k.status === 'active' && (
                          <button onClick={() => revoke(k)}
                            className="text-xs text-red-600 hover:text-red-700 font-semibold inline-flex items-center gap-1">
                            <span className="material-symbols-outlined text-sm">block</span>
                            Отозвать
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Документация */}
      <ApiDocs />

      {/* Модалка с raw-key — ОДНОРАЗОВЫЙ показ */}
      {revealed && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setRevealed(null) }}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-xl w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center flex-shrink-0">
                <span className="material-symbols-outlined text-2xl text-emerald-600">vpn_key</span>
              </div>
              <div>
                <p className="font-extrabold text-lg text-gray-900 dark:text-white">Ключ создан</p>
                <p className="text-xs text-gray-500 mt-0.5">«{revealed.name}»</p>
              </div>
            </div>

            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/30 rounded-xl p-3 flex gap-2">
              <span className="material-symbols-outlined text-amber-600 text-base">warning</span>
              <div>
                <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                  Этот ключ показывается ОДИН РАЗ
                </p>
                <p className="text-xs text-amber-800 dark:text-amber-300 mt-0.5">
                  Скопируйте его сейчас. Повторно увидеть raw-значение будет невозможно —
                  в БД хранится только sha256-хэш.
                </p>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 block">Raw API key</label>
              <div className="flex gap-2 items-stretch">
                <code className="flex-1 text-xs font-mono bg-gray-900 text-emerald-300 rounded-lg p-3 overflow-x-auto break-all">
                  {revealed.raw_key}
                </code>
                <CopyButton value={revealed.raw_key} label="Копировать" className="!px-3" />
              </div>
            </div>

            <div className="text-xs text-gray-500 space-y-1">
              <div className="flex gap-2"><span className="font-semibold">Scopes:</span>
                {(revealed.scopes || []).map(s => (
                  <code key={s} className="bg-gray-100 dark:bg-gray-700 px-1 rounded">{s}</code>
                ))}
              </div>
              <div><span className="font-semibold">Действует до:</span> {revealed.expires_at ? formatDate(revealed.expires_at) : 'бессрочно'}</div>
            </div>

            <button onClick={() => setRevealed(null)}
              className="w-full bg-[#0097A7] text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-[#00838f] transition">
              Я сохранил ключ
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
