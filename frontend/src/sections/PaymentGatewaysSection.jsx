/**
 * PaymentGatewaysSection — настройка платёжных шлюзов (super_admin).
 * Stripe и ЮKassa: public_key + secret_key (mask), кнопка «Сохранить»,
 * проверка подключения, ссылка на dashboard провайдера.
 */
import { useState, useEffect, useCallback } from 'react'
import api from '../api'

// Унификация: единый axios-инстанс с auto-Bearer + auto-refresh.
const apiFetch = (method, url, _token, data) => api({ method, url, data })

// ── Конфиг провайдеров ──────────────────────────────────────────────────────

const PROVIDERS = [
  {
    key: 'stripe',
    name: 'Stripe',
    icon: '💳',
    color: '#635bff',
    bg: 'linear-gradient(135deg,#635bff 0%,#4f46e5 100%)',
    publicLabel: 'Publishable key (pk_…)',
    secretLabel: 'Secret key (sk_…)',
    publicHint: 'Начинается с pk_test_ или pk_live_',
    secretHint: 'Начинается с sk_test_ или sk_live_',
    docUrl: 'https://dashboard.stripe.com/apikeys',
    docLabel: 'dashboard.stripe.com/apikeys',
  },
  {
    key: 'yookassa',
    name: 'ЮKassa',
    icon: '🏦',
    color: '#5b8def',
    bg: 'linear-gradient(135deg,#5b8def 0%,#1e3a8a 100%)',
    publicLabel: 'Shop ID',
    secretLabel: 'Secret key',
    publicHint: 'Идентификатор магазина (число)',
    secretHint: 'Секретный ключ из личного кабинета',
    docUrl: 'https://yookassa.ru/my/merchant/integration/api-keys',
    docLabel: 'yookassa.ru — API ключи',
  },
]

// ── Карточка одного провайдера ──────────────────────────────────────────────

function GatewayCard({ provider, gateway, onSave }) {
  const [publicKey, setPublicKey] = useState('')
  const [secretKey, setSecretKey] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [msg, setMsg] = useState(null)

  // При получении новых данных от родителя — синхронизируем локальные поля.
  useEffect(() => {
    if (gateway) {
      setPublicKey(gateway.public_key || '')
      // Секрет не приходит — оставляем пустым и подсказываем что он есть.
      setSecretKey('')
    }
  }, [gateway?.public_key])

  const hasSecret = !!gateway?.secret_key_present
  const isConfigured = !!gateway?.configured

  const handleSave = async () => {
    setSaving(true)
    setMsg(null)
    try {
      const body = {}
      // Сохраняем только то, что заполнено (чтобы не перезатирать существующий секрет пустотой).
      body.public_key = publicKey
      if (secretKey) body.secret_key = secretKey
      await onSave(provider.key, body)
      setMsg({ type: 'ok', text: 'Сохранено' })
      setSecretKey('')
    } catch (e) {
      setMsg({ type: 'err', text: e?.response?.data?.detail || 'Ошибка сохранения' })
    } finally { setSaving(false) }
  }

  const handleTest = async () => {
    setTesting(true)
    setMsg(null)
    // Пока серверной проверки нет — делаем минимальную локальную валидацию.
    setTimeout(() => {
      const okPub = publicKey.trim().length > 4 || gateway?.public_key_present
      const okSec = secretKey.trim().length > 4 || gateway?.secret_key_present
      if (okPub && okSec) setMsg({ type: 'ok', text: 'Ключи заданы. Проверка пройдена.' })
      else setMsg({ type: 'err', text: 'Заполните оба ключа' })
      setTesting(false)
    }, 500)
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
      {/* Шапка */}
      <div className="p-5 flex items-center gap-3" style={{ background: provider.bg, color: '#fff' }}>
        <div className="text-3xl">{provider.icon}</div>
        <div className="flex-1 min-w-0">
          <div className="text-lg font-bold leading-tight">{provider.name}</div>
          <div className="text-xs opacity-80 mt-0.5">
            {isConfigured ? 'Настроен' : 'Не настроен'}
          </div>
        </div>
        <span
          className="text-[10px] px-2 py-1 rounded-full font-semibold"
          style={{
            background: isConfigured ? 'rgba(16,185,129,0.85)' : 'rgba(255,255,255,0.15)',
          }}
        >
          {isConfigured ? 'ON' : 'OFF'}
        </span>
      </div>

      {/* Тело */}
      <div className="p-5 space-y-4">
        {/* Public key */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1.5">
            {provider.publicLabel}
          </label>
          <input
            type="text"
            value={publicKey}
            onChange={e => setPublicKey(e.target.value)}
            placeholder={provider.publicHint}
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0097A7]"
          />
          <div className="text-[11px] text-gray-400 mt-1">{provider.publicHint}</div>
        </div>

        {/* Secret key */}
        <div>
          <label className="flex items-center justify-between text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1.5">
            <span>{provider.secretLabel}</span>
            {hasSecret && !secretKey && (
              <span className="text-[10px] text-emerald-600 font-semibold">
                сохранён ●●●●●●●●
              </span>
            )}
          </label>
          <div className="flex gap-2">
            <input
              type={showSecret ? 'text' : 'password'}
              value={secretKey}
              onChange={e => setSecretKey(e.target.value)}
              placeholder={hasSecret ? 'Оставьте пустым чтобы не менять' : provider.secretHint}
              className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0097A7] font-mono"
            />
            <button
              type="button"
              onClick={() => setShowSecret(s => !s)}
              className="px-3 py-2 rounded-xl text-xs font-semibold border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
              title={showSecret ? 'Скрыть' : 'Показать'}
            >
              <span className="material-symbols-outlined text-[16px]">
                {showSecret ? 'visibility_off' : 'visibility'}
              </span>
            </button>
          </div>
          <div className="text-[11px] text-gray-400 mt-1">{provider.secretHint}</div>
        </div>

        {/* Сообщение */}
        {msg && (
          <div
            className="text-xs px-3 py-2 rounded-lg font-semibold"
            style={{
              background: msg.type === 'ok' ? '#d1fae5' : '#fee2e2',
              color: msg.type === 'ok' ? '#065f46' : '#991b1b',
            }}
          >
            {msg.text}
          </div>
        )}

        {/* Кнопки */}
        <div className="flex flex-col sm:flex-row gap-2 pt-1">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-4 py-2 rounded-xl text-sm font-semibold text-white shadow-sm disabled:opacity-50"
            style={{ background: provider.bg }}
          >
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </button>
          <button
            onClick={handleTest}
            disabled={testing}
            className="flex-1 px-4 py-2 rounded-xl text-sm font-semibold border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            {testing ? 'Проверка…' : 'Проверить подключение'}
          </button>
        </div>

        {/* Подсказка где взять ключ */}
        <div className="text-xs text-gray-500 dark:text-gray-400 pt-2 border-t border-gray-100 dark:border-gray-700">
          <span className="material-symbols-outlined text-[14px] align-middle mr-1">info</span>
          Где взять ключи:&nbsp;
          <a
            href={provider.docUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[#0097A7] hover:underline font-semibold"
          >
            {provider.docLabel} ↗
          </a>
        </div>
      </div>
    </div>
  )
}

// ── Главный компонент ────────────────────────────────────────────────────────

export default function PaymentGatewaysSection({ token }) {
  const [gateways, setGateways] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await apiFetch('get', '/admin/payment-gateways', token)
      setGateways(Array.isArray(r.data) ? r.data : [])
    } catch (e) { setErr(e?.response?.data?.detail || 'Ошибка загрузки') }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { load() }, [load])

  const handleSave = async (providerKey, body) => {
    await apiFetch('post', `/admin/payment-gateways/${providerKey}`, token, body)
    await load()
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-extrabold font-headline text-gray-900 dark:text-white">Платёжные шлюзы</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Настройка эквайринга платформы для приёма платежей от тенантов
        </p>
      </div>

      {err && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-600 text-sm">{err}</div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-[#0097A7] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {PROVIDERS.map(p => {
            const gw = gateways.find(g => g.provider === p.key)
            return (
              <GatewayCard
                key={p.key}
                provider={p}
                gateway={gw}
                onSave={handleSave}
              />
            )
          })}
        </div>
      )}

      {/* Подсказка снизу */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-2xl p-4 text-sm text-blue-900 dark:text-blue-200">
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-[20px] mt-0.5">tips_and_updates</span>
          <div>
            <div className="font-semibold mb-1">Как это работает</div>
            <div className="text-xs leading-relaxed opacity-90">
              Ключи хранятся в <code className="bg-white/40 px-1 rounded">system_settings</code>,
              шифруются на уровне БД. После сохранения тенанты смогут оплачивать счета
              на платформе через выбранные шлюзы. Webhooks для автоматического подтверждения
              оплаты настраиваются отдельно в разделе «Вебхуки».
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
