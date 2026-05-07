/**
 * ========================================
 * БЛОК: PaymentSettingsSection — настройка интернет-эквайринга клиники
 * ========================================
 * Модуль: online_payments_pro
 *
 * UI:
 *   - Selectbox шлюза (Юкасса/Т-Банк/Сбер/CloudPayments/Robokassa)
 *   - shop_id, secret_key (password), is_test_mode, is_active
 *   - Кнопка «Сохранить» → PUT /clinics/{id}/payment-config
 *   - InfoHint с описанием каждого шлюза + ссылка на документацию
 *   - Бейдж «В разработке» если адаптер ещё не реализован (501)
 *
 * Использование:
 *   <PaymentSettingsSection token={token} clinicId={clinicId} />
 *
 * Подключается в кабинеты Manager / FranchiseOwner.
 * ========================================
 */
import { useEffect, useState, useCallback } from 'react'
import axios from 'axios'
import { API_BASE } from '../../config'

// ─── Список поддерживаемых шлюзов ──────────────────────────────────────────
const GATEWAYS = [
  {
    key: 'yookassa',
    name: 'ЮKassa',
    icon: '🏦',
    color: '#5b8def',
    docUrl: 'https://yookassa.ru/developers/api',
    docLabel: 'yookassa.ru — API',
    publicLabel: 'Shop ID',
    publicHint: 'Идентификатор магазина (число)',
    secretLabel: 'Секретный ключ',
    secretHint: 'Из личного кабинета → API ключи',
    description:
      'ЮKassa — приём карт, СБП, Apple/Google Pay. Комиссия от 2.8%. Чеки 54-ФЗ автоматически.',
  },
  {
    key: 'tinkoff',
    name: 'Т-Банк',
    icon: '💛',
    color: '#ffdd2d',
    docUrl: 'https://www.tinkoff.ru/kassa/develop/api/',
    docLabel: 'tinkoff.ru/kassa — API',
    publicLabel: 'Terminal Key',
    publicHint: 'Идентификатор терминала Т-Банк',
    secretLabel: 'Password',
    secretHint: 'Пароль терминала из ЛК Т-Банк',
    description:
      'Т-Банк (Tinkoff) — высокая надёжность, низкая комиссия для бизнес-клиентов банка.',
  },
  {
    key: 'sber',
    name: 'Сбер',
    icon: '🟢',
    color: '#21a038',
    docUrl: 'https://securepayments.sberbank.ru/wiki/doku.php',
    docLabel: 'securepayments.sberbank.ru/wiki',
    publicLabel: 'userName',
    publicHint: 'Логин магазина в Сбер-эквайринге',
    secretLabel: 'password',
    secretHint: 'Пароль магазина (или API-token)',
    description:
      'Сбер Эквайринг — REST API, поддержка СБП, Mir Pay, рекуррентных платежей.',
  },
  {
    key: 'cloudpayments',
    name: 'CloudPayments',
    icon: '☁️',
    color: '#0066ff',
    docUrl: 'https://developers.cloudpayments.ru/',
    docLabel: 'developers.cloudpayments.ru',
    publicLabel: 'Public ID',
    publicHint: 'pk_xxx из ЛК CloudPayments',
    secretLabel: 'API Secret',
    secretHint: 'Секретный API-ключ',
    description:
      'CloudPayments — виджет на сайте, удобен для быстрой интеграции.',
  },
  {
    key: 'robokassa',
    name: 'Robokassa',
    icon: '🤖',
    color: '#ff6633',
    docUrl: 'https://docs.robokassa.ru/',
    docLabel: 'docs.robokassa.ru',
    publicLabel: 'Merchant Login',
    publicHint: 'Логин магазина в Robokassa',
    secretLabel: 'Password #1',
    secretHint: 'Первый пароль магазина',
    description:
      'Robokassa — простая интеграция через redirect, поддержка десятков способов оплаты.',
  },
]

const authH = (token) => ({ Authorization: `Bearer ${token}` })

// ─── Главный компонент ─────────────────────────────────────────────────────

export default function PaymentSettingsSection({ token, clinicId, showToast }) {
  const [selectedGateway, setSelectedGateway] = useState('yookassa')
  const [configs, setConfigs] = useState([])
  const [available, setAvailable] = useState([])
  const [shopId, setShopId] = useState('')
  const [secretKey, setSecretKey] = useState('')
  const [isTestMode, setIsTestMode] = useState(true)
  const [isActive, setIsActive] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const _toast = (kind, msg) => {
    if (typeof showToast === 'function') showToast(kind, msg)
  }

  const load = useCallback(async () => {
    if (!clinicId) return
    setLoading(true)
    setErr('')
    try {
      const r = await axios.get(`${API_BASE}/clinics/${clinicId}/payment-config`, {
        headers: authH(token),
      })
      setConfigs(r.data?.configs || [])
      setAvailable(r.data?.available_gateways || [])
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Ошибка загрузки конфигов')
    } finally {
      setLoading(false)
    }
  }, [clinicId, token])

  useEffect(() => {
    load()
  }, [load])

  // При смене выбранного шлюза — подставить уже сохранённый конфиг
  useEffect(() => {
    const c = configs.find((x) => x.gateway === selectedGateway)
    if (c) {
      setShopId(c.shop_id || '')
      setSecretKey('')
      setIsTestMode(!!c.is_test_mode)
      setIsActive(!!c.is_active)
    } else {
      setShopId('')
      setSecretKey('')
      setIsTestMode(true)
      setIsActive(true)
    }
  }, [selectedGateway, configs])

  const handleSave = async () => {
    if (!shopId.trim()) {
      _toast('error', 'Заполните shop_id')
      return
    }
    setSaving(true)
    try {
      const body = {
        gateway: selectedGateway,
        shop_id: shopId.trim(),
        is_active: isActive,
        is_test_mode: isTestMode,
        config: {},
      }
      if (secretKey.trim()) body.secret_key = secretKey.trim()
      await axios.put(`${API_BASE}/clinics/${clinicId}/payment-config`, body, {
        headers: authH(token),
      })
      _toast('success', 'Настройки шлюза сохранены')
      setSecretKey('')
      await load()
    } catch (e) {
      const msg = e?.response?.data?.detail || 'Ошибка сохранения'
      _toast('error', msg)
      setErr(msg)
    } finally {
      setSaving(false)
    }
  }

  const current = GATEWAYS.find((g) => g.key === selectedGateway)
  const savedCfg = configs.find((x) => x.gateway === selectedGateway)
  const isImplemented = available.includes(selectedGateway)

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-extrabold text-gray-900 dark:text-white">
          Настройка онлайн-оплаты
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          Подключите интернет-эквайринг — пациенты смогут оплачивать визиты картой онлайн.
        </p>
      </div>

      {err && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-600 text-sm">
          {err}
        </div>
      )}

      {/* Selectbox */}
      <div>
        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1.5">
          Платёжный шлюз
        </label>
        <select
          value={selectedGateway}
          onChange={(e) => setSelectedGateway(e.target.value)}
          className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0097A7]"
        >
          {GATEWAYS.map((g) => (
            <option key={g.key} value={g.key}>
              {g.icon} {g.name}
            </option>
          ))}
        </select>
      </div>

      {/* Карточка выбранного шлюза */}
      {current && (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div
            className="px-5 py-4 flex items-center gap-3"
            style={{ background: current.color, color: '#fff' }}
          >
            <span className="text-2xl">{current.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="text-lg font-bold">{current.name}</div>
              <div className="text-xs opacity-90">
                {savedCfg ? 'Настроен' : 'Не настроен'}
                {savedCfg && savedCfg.is_test_mode ? ' · TEST' : ''}
              </div>
            </div>
            {!isImplemented && (
              <span
                className="text-[10px] px-2 py-1 rounded-full font-bold uppercase"
                style={{ background: 'rgba(0,0,0,0.25)' }}
                title="Адаптер ещё не реализован — только настройка, реальные платежи появятся позже"
              >
                В разработке
              </span>
            )}
          </div>

          <div className="p-5 space-y-4 bg-white dark:bg-gray-800">
            {/* Описание */}
            <div className="text-sm text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
              <span className="material-symbols-outlined text-[16px] align-middle mr-1">
                info
              </span>
              {current.description}
            </div>

            {/* shop_id */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1.5">
                {current.publicLabel}
              </label>
              <input
                type="text"
                value={shopId}
                onChange={(e) => setShopId(e.target.value)}
                placeholder={current.publicHint}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0097A7]"
              />
              <div className="text-[11px] text-gray-400 mt-1">{current.publicHint}</div>
            </div>

            {/* secret_key */}
            <div>
              <label className="flex items-center justify-between text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1.5">
                <span>{current.secretLabel}</span>
                {savedCfg?.secret_key_present && !secretKey && (
                  <span className="text-[10px] text-emerald-600 font-semibold">
                    сохранён ●●●●●●●●
                  </span>
                )}
              </label>
              <input
                type="password"
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                placeholder={
                  savedCfg?.secret_key_present
                    ? 'Оставьте пустым чтобы не менять'
                    : current.secretHint
                }
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-mono bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0097A7]"
              />
              <div className="text-[11px] text-gray-400 mt-1">{current.secretHint}</div>
            </div>

            {/* Чекбоксы */}
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={isTestMode}
                  onChange={(e) => setIsTestMode(e.target.checked)}
                  className="w-4 h-4"
                />
                Тестовый режим
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="w-4 h-4"
                />
                Активен (принимает платежи)
              </label>
            </div>

            {/* Кнопка */}
            <div className="flex flex-col sm:flex-row gap-2 pt-2">
              <button
                onClick={handleSave}
                disabled={saving || loading}
                className="flex-1 px-4 py-2 rounded-xl text-sm font-semibold text-white shadow-sm disabled:opacity-50"
                style={{ background: current.color }}
              >
                {saving ? 'Сохраняем…' : 'Сохранить'}
              </button>
              <a
                href={current.docUrl}
                target="_blank"
                rel="noreferrer"
                className="flex-1 px-4 py-2 rounded-xl text-sm font-semibold border border-gray-200 dark:border-gray-700 text-center hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                {current.docLabel} ↗
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
