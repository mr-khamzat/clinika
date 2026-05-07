/**
 * ========================================
 * БЛОК: FiscalSettingsSection — настройка ОФД (54-ФЗ)
 * ========================================
 * Модуль: fiscal_54fz_pro
 *
 * UI:
 *   - Selectbox ОФД-провайдера (Платформа/Первый/Такском/Атол.Онлайн)
 *   - inn, api_key (password), is_active
 *   - Кнопка «Сохранить» + «Обновить чеки сейчас» (force pull)
 *   - InfoHint и ссылка на документацию
 *   - Бейдж «В разработке» если адаптер пока заглушка
 *
 * Endpoints:
 *   GET  /clinics/{id}/ofd-config
 *   PUT  /clinics/{id}/ofd-config
 *   POST /clinics/{id}/ofd/pull
 * ========================================
 */
import { useEffect, useState, useCallback } from 'react'
import api from '../../api'

const PROVIDERS = [
  {
    key: 'platforma_ofd',
    name: 'Платформа ОФД',
    icon: '📡',
    color: '#005BFF',
    docUrl: 'https://platformaofd.ru/api-info',
    docLabel: 'platformaofd.ru — API',
    apiKeyHint: 'lkApiKey из ЛК Платформы ОФД',
    description:
      'Платформа ОФД — крупнейший оператор фискальных данных. Стабильное API, push-уведомления.',
  },
  {
    key: 'perv_ofd',
    name: 'Первый ОФД',
    icon: '①',
    color: '#FF7A00',
    docUrl: 'https://www.1-ofd.ru/api/',
    docLabel: '1-ofd.ru — API',
    apiKeyHint: 'API-токен из ЛК Первого ОФД',
    description: 'Первый ОФД — один из старейших операторов, низкие тарифы.',
  },
  {
    key: 'takskom',
    name: 'Такском',
    icon: '📋',
    color: '#1F4E79',
    docUrl: 'https://taxcom.ru/about/news/api-ofd/',
    docLabel: 'taxcom.ru — API',
    apiKeyHint: 'login + password или token из ЛК',
    description:
      'Такском — комплексные решения для бухгалтерии, ОФД, ЭДО, отчётность.',
  },
  {
    key: 'atol_online',
    name: 'Атол.Онлайн',
    icon: '🛒',
    color: '#E60028',
    docUrl: 'https://online.atol.ru/files/API_atol_online_v5.pdf',
    docLabel: 'online.atol.ru — API v5',
    apiKeyHint: 'login + password (getToken)',
    description:
      'Атол.Онлайн — облачные кассы, удобно если нет физической ККТ в клинике.',
  },
]

export default function FiscalSettingsSection({ token, clinicId, showToast }) {
  const [provider, setProvider] = useState('platforma_ofd')
  const [config, setConfig] = useState(null)
  const [available, setAvailable] = useState([])
  const [inn, setInn] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [err, setErr] = useState('')

  const _toast = (kind, msg) => {
    if (typeof showToast === 'function') showToast(kind, msg)
  }

  const load = useCallback(async () => {
    if (!clinicId) return
    setLoading(true)
    setErr('')
    try {
      const r = await api.get(`/clinics/${clinicId}/ofd-config`)
      setConfig(r.data?.config || null)
      setAvailable(r.data?.available_providers || [])
      if (r.data?.config) {
        setProvider(r.data.config.provider)
        setInn(r.data.config.inn || '')
        setIsActive(!!r.data.config.is_active)
      }
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Ошибка загрузки конфига ОФД')
    } finally {
      setLoading(false)
    }
  }, [clinicId])

  useEffect(() => {
    load()
  }, [load])

  const handleSave = async () => {
    if (!inn.trim()) {
      _toast('error', 'Заполните ИНН')
      return
    }
    setSaving(true)
    try {
      const body = {
        provider,
        inn: inn.trim(),
        is_active: isActive,
        config: {},
      }
      if (apiKey.trim()) body.api_key = apiKey.trim()
      await api.put(`/clinics/${clinicId}/ofd-config`, body)
      _toast('success', 'Настройки ОФД сохранены')
      setApiKey('')
      await load()
    } catch (e) {
      const msg = e?.response?.data?.detail || 'Ошибка сохранения'
      _toast('error', msg)
      setErr(msg)
    } finally {
      setSaving(false)
    }
  }

  const handlePull = async () => {
    setPulling(true)
    try {
      const r = await api.post(`/clinics/${clinicId}/ofd/pull`, {})
      _toast(
        'success',
        `Подтянуто чеков: ${r.data?.fetched ?? 0} (новых: ${r.data?.saved ?? 0})`,
      )
    } catch (e) {
      const msg = e?.response?.data?.detail || 'Ошибка pull чеков'
      _toast('error', msg)
    } finally {
      setPulling(false)
    }
  }

  const current = PROVIDERS.find((p) => p.key === provider)
  const isImplemented = available.includes(provider)

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-extrabold text-gray-900 dark:text-white">
          Чеки 54-ФЗ (ОФД)
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          Подключите оператора фискальных данных — платформа автоматически выгружает чеки
          для отчётности и QR-проверки пациентами.
        </p>
      </div>

      {err && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-600 text-sm">
          {err}
        </div>
      )}

      <div>
        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1.5">
          ОФД-провайдер
        </label>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0097A7]"
        >
          {PROVIDERS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.icon} {p.name}
            </option>
          ))}
        </select>
      </div>

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
                {config && config.provider === current.key ? 'Подключён' : 'Не подключён'}
              </div>
            </div>
            {!isImplemented && (
              <span
                className="text-[10px] px-2 py-1 rounded-full font-bold uppercase"
                style={{ background: 'rgba(0,0,0,0.25)' }}
              >
                В разработке
              </span>
            )}
          </div>

          <div className="p-5 space-y-4 bg-white dark:bg-gray-800">
            <div className="text-sm text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
              <span className="material-symbols-outlined text-[16px] align-middle mr-1">
                info
              </span>
              {current.description}
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1.5">
                ИНН клиники
              </label>
              <input
                type="text"
                value={inn}
                onChange={(e) => setInn(e.target.value)}
                placeholder="10 или 12 цифр"
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0097A7]"
              />
            </div>

            <div>
              <label className="flex items-center justify-between text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1.5">
                <span>API-ключ</span>
                {config?.api_key_present && !apiKey && (
                  <span className="text-[10px] text-emerald-600 font-semibold">
                    сохранён ●●●●●●●●
                  </span>
                )}
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  config?.api_key_present
                    ? 'Оставьте пустым чтобы не менять'
                    : current.apiKeyHint
                }
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-mono bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0097A7]"
              />
              <div className="text-[11px] text-gray-400 mt-1">{current.apiKeyHint}</div>
            </div>

            <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="w-4 h-4"
              />
              Активен (выгружать чеки автоматически)
            </div>

            {config?.last_pulled_at && (
              <div className="text-[11px] text-gray-400">
                Последняя выгрузка: {new Date(config.last_pulled_at).toLocaleString('ru')}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2 pt-2">
              <button
                onClick={handleSave}
                disabled={saving || loading}
                className="flex-1 px-4 py-2 rounded-xl text-sm font-semibold text-white shadow-sm disabled:opacity-50"
                style={{ background: current.color }}
              >
                {saving ? 'Сохраняем…' : 'Сохранить'}
              </button>
              <button
                onClick={handlePull}
                disabled={pulling || !config}
                className="flex-1 px-4 py-2 rounded-xl text-sm font-semibold border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                title={!config ? 'Сначала сохраните настройки' : 'Принудительно подтянуть чеки'}
              >
                {pulling ? 'Тянем…' : 'Обновить чеки сейчас'}
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
