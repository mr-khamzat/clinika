/**
 * Личный кабинет пациента — публичная страница (без авторизации сотрудника).
 * Открывается по QR-ссылке: /clinika/p/{referral_id}?t={patient_token}
 * Токен сохраняется в localStorage для повторных визитов.
 */
import { useEffect, useState } from 'react'
import axios from 'axios'

const API = '/clinika/api'
const TOKEN_KEY = 'clinika_patient_token'
const REF_KEY = 'clinika_patient_ref'

// Цвета иконок услуг — циклически
const SERVICE_ICON_COLORS = [
  { bg: 'bg-blue-100 dark:bg-blue-900/40', text: 'text-blue-600 dark:text-blue-400' },
  { bg: 'bg-violet-100 dark:bg-violet-900/40', text: 'text-violet-600 dark:text-violet-400' },
  { bg: 'bg-emerald-100 dark:bg-emerald-900/40', text: 'text-emerald-600 dark:text-emerald-400' },
  { bg: 'bg-orange-100 dark:bg-orange-900/40', text: 'text-orange-600 dark:text-orange-400' },
  { bg: 'bg-pink-100 dark:bg-pink-900/40', text: 'text-pink-600 dark:text-pink-400' },
]

const STATUS_CONFIG = {
  created:          { label: 'Создано',       pill: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  confirmed:        { label: 'Подтверждено',  pill: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  expired:          { label: 'Истекло',       pill: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' },
  cancel_requested: { label: 'На отмене',     pill: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300' },
  cancelled:        { label: 'Отменено',      pill: 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400' },
}

function StatusPill({ status }) {
  const cfg = STATUS_CONFIG[status] || { label: status, pill: 'bg-gray-100 text-gray-500' }
  return (
    <span className={`text-xs font-semibold px-3 py-1 rounded-full ${cfg.pill}`}>
      {cfg.label}
    </span>
  )
}

// Карточка направления
function ReferralCardItem({ referral, index, onShowQr }) {
  const color = SERVICE_ICON_COLORS[index % SERVICE_ICON_COLORS.length]
  const dateStr = referral.appointment_at
    ? new Date(referral.appointment_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : new Date(referral.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })

  return (
    <div className="bg-white dark:bg-slate-800 rounded-[1.5rem] p-6 border border-gray-100 dark:border-slate-700 shadow-sm">
      {/* Верх: иконка + статус */}
      <div className="flex items-start justify-between mb-4">
        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${color.bg}`}>
          <span className={`material-symbols-outlined text-2xl ${color.text}`}>
            medical_services
          </span>
        </div>
        <StatusPill status={referral.status} />
      </div>

      {/* Контент */}
      <h3 className="text-xl font-bold text-gray-900 dark:text-white leading-tight mb-1">
        {referral.to_clinic_name || 'Клиника'}
      </h3>
      <p className="text-gray-500 dark:text-gray-400 font-medium text-sm mb-3">
        {referral.service_name}
      </p>

      {/* Дата */}
      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <span className="material-symbols-outlined text-base leading-none">calendar_today</span>
        <span>{dateStr}</span>
      </div>

      {/* Код */}
      {referral.short_code && (
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mt-1">
          <span className="material-symbols-outlined text-base leading-none">tag</span>
          <span>Код: <span className="font-bold text-gray-700 dark:text-gray-300 tracking-widest">{referral.short_code}</span></span>
        </div>
      )}

      {/* Кнопка QR для подтверждённых и активных */}
      {(referral.status === 'confirmed' || referral.status === 'created') && referral.qr_code && (
        <button
          onClick={() => onShowQr(referral.qr_code)}
          className="mt-4 w-full h-11 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-2xl flex items-center justify-center gap-2 font-semibold text-sm border border-blue-100 dark:border-blue-800 transition-colors hover:bg-blue-100 dark:hover:bg-blue-900/40"
        >
          <span className="material-symbols-outlined text-base leading-none">qr_code_2</span>
          Показать QR
        </button>
      )}
    </div>
  )
}

export default function PatientCabinet() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Режим поиска по короткому коду
  const [showCodeSearch, setShowCodeSearch] = useState(false)
  const [codeInput, setCodeInput] = useState('')
  const [phoneInput, setPhoneInput] = useState('')
  const [codeLoading, setCodeLoading] = useState(false)
  const [codeError, setCodeError] = useState('')

  // PWA install prompt
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [showInstall, setShowInstall] = useState(false)

  // Показываем QR на весь экран
  const [fullscreenQr, setFullscreenQr] = useState(null)

  useEffect(() => {
    // PWA: перехватываем beforeinstallprompt
    const handler = (e) => { e.preventDefault(); setDeferredPrompt(e); setShowInstall(true) }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const t = params.get('t')
    const referralId = window.location.pathname.split('/p/')[1]?.split('?')[0]

    if (t && referralId) {
      // Новый токен из QR — сохраняем
      localStorage.setItem(TOKEN_KEY, t)
      localStorage.setItem(REF_KEY, referralId)
      loadData(referralId, t)
    } else {
      // Повторный визит — берём из localStorage
      const savedToken = localStorage.getItem(TOKEN_KEY)
      const savedRef = localStorage.getItem(REF_KEY)
      if (savedToken && savedRef) {
        loadData(savedRef, savedToken)
      } else {
        setLoading(false)
        setShowCodeSearch(true)
      }
    }
  }, [])

  const loadData = async (referralId, token) => {
    setLoading(true)
    setError('')
    try {
      const res = await axios.get(`${API}/patient/${referralId}?t=${token}`)
      setData(res.data)
    } catch (e) {
      const msg = e.response?.data?.detail || 'Ошибка загрузки'
      setError(msg)
      if (e.response?.status === 403) {
        localStorage.removeItem(TOKEN_KEY)
        localStorage.removeItem(REF_KEY)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleCodeSearch = async () => {
    if (!codeInput || !phoneInput) { setCodeError('Введите код и телефон'); return }
    setCodeLoading(true)
    setCodeError('')
    try {
      const res = await axios.post(`${API}/patient/by-code`, { code: parseInt(codeInput), phone: phoneInput })
      const { referral_id, patient_token } = res.data
      localStorage.setItem(TOKEN_KEY, patient_token)
      localStorage.setItem(REF_KEY, referral_id)
      setShowCodeSearch(false)
      await loadData(referral_id, patient_token)
    } catch (e) {
      setCodeError(e.response?.data?.detail || 'Направление не найдено')
    } finally {
      setCodeLoading(false)
    }
  }

  const handleInstall = async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    await deferredPrompt.userChoice
    setDeferredPrompt(null)
    setShowInstall(false)
  }

  // ─── Экран загрузки ───
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-950">
      <div className="text-center">
        <div className="w-14 h-14 rounded-2xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center mx-auto mb-6">
          <span className="material-symbols-outlined text-3xl text-blue-600 dark:text-blue-400 animate-pulse">medical_services</span>
        </div>
        <div className="w-8 h-8 border-[3px] border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
        <p className="text-sm text-gray-400 dark:text-gray-500">Загрузка...</p>
      </div>
    </div>
  )

  // ─── Экран полного QR (для предъявления в клинике) ───
  if (fullscreenQr) return (
    <div
      className="fixed inset-0 bg-white dark:bg-slate-950 flex flex-col items-center justify-center z-50 px-8"
      onClick={() => setFullscreenQr(null)}
    >
      <div className="flex items-center gap-2 mb-8">
        <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center">
          <span className="material-symbols-outlined text-white text-xl">medical_services</span>
        </div>
        <span className="text-blue-600 text-2xl font-bold">Clinika</span>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 text-center">
        Покажите этот QR администратору клиники
      </p>
      <div className="bg-white dark:bg-slate-800 p-4 rounded-3xl shadow-xl border border-gray-100 dark:border-slate-700">
        <img src={`data:image/png;base64,${fullscreenQr}`} alt="QR код" className="w-64 h-64 rounded-xl" />
      </div>
      <p className="text-xs text-gray-400 dark:text-gray-600 mt-8">Нажмите в любом месте чтобы закрыть</p>
    </div>
  )

  // ─── Экран авторизации (поиск по коду) ───
  if (showCodeSearch || error) return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 flex flex-col items-center justify-center px-5">
      {/* Логотип */}
      <div className="mb-8 text-center">
        <div className="w-16 h-16 rounded-full bg-blue-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-200 dark:shadow-blue-900/40">
          <span className="material-symbols-outlined text-white text-3xl">medical_services</span>
        </div>
        <p className="text-blue-600 text-3xl font-bold">Clinika</p>
      </div>

      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white text-center mb-1">
          Войти в личный кабинет
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center mb-8">
          {error ? error : 'Введите код из направления и ваш телефон'}
        </p>

        {/* Поле кода */}
        <div className="mb-4">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-xl pointer-events-none">
              tag
            </span>
            <input
              type="number"
              placeholder="5-значный код"
              value={codeInput}
              onChange={e => setCodeInput(e.target.value)}
              maxLength={5}
              className="w-full h-14 pl-12 pr-4 bg-gray-100 dark:bg-slate-800 text-gray-900 dark:text-white rounded-2xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500 transition placeholder-gray-400 dark:placeholder-gray-600"
            />
          </div>
        </div>

        {/* Поле телефона */}
        <div className="mb-4">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-xl pointer-events-none">
              phone
            </span>
            <input
              type="tel"
              placeholder="+7 900 000-00-00"
              value={phoneInput}
              onChange={e => setPhoneInput(e.target.value)}
              className="w-full h-14 pl-12 pr-4 bg-gray-100 dark:bg-slate-800 text-gray-900 dark:text-white rounded-2xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500 transition placeholder-gray-400 dark:placeholder-gray-600"
            />
          </div>
        </div>

        {codeError && (
          <p className="text-red-500 text-sm text-center mb-4">{codeError}</p>
        )}

        <button
          onClick={handleCodeSearch}
          disabled={codeLoading}
          className="w-full h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-semibold text-base disabled:opacity-60 transition shadow-lg shadow-blue-200 dark:shadow-blue-900/30"
        >
          {codeLoading ? 'Поиск...' : 'Найти направление'}
        </button>
      </div>
    </div>
  )

  if (!data) return null

  const { current, other_referrals, mis_info, patient_name, patient_phone } = data

  // Собираем все направления: текущее + остальные
  const allReferrals = [current, ...(other_referrals || [])]

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">

      {/* Header */}
      <header className="sticky top-0 z-30 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-b border-gray-100 dark:border-slate-800 px-5 py-3">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center">
              <span className="material-symbols-outlined text-white text-lg">medical_services</span>
            </div>
            <span className="text-blue-600 text-lg font-bold">Clinika</span>
          </div>
          <button className="w-9 h-9 rounded-full bg-gray-100 dark:bg-slate-800 flex items-center justify-center">
            <span className="material-symbols-outlined text-gray-600 dark:text-gray-300 text-xl">notifications</span>
          </button>
        </div>
      </header>

      <div className="max-w-md mx-auto px-4 pt-6 pb-10">

        {/* PWA: предложение установить */}
        {showInstall && (
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-4 mb-5 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center flex-shrink-0">
              <span className="material-symbols-outlined text-blue-600 dark:text-blue-400 text-xl">download</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800 dark:text-white">Добавить на экран</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Быстрый доступ к кабинету</p>
            </div>
            <button
              onClick={handleInstall}
              className="bg-blue-600 text-white rounded-xl px-3 py-1.5 text-xs font-semibold flex-shrink-0"
            >
              Добавить
            </button>
            <button
              onClick={() => setShowInstall(false)}
              className="text-gray-400 dark:text-gray-500 text-xl leading-none flex-shrink-0"
            >
              ×
            </button>
          </div>
        )}

        {/* МИС данные пациента */}
        {mis_info && (
          <div className="bg-white dark:bg-slate-800 rounded-[1.5rem] border border-gray-100 dark:border-slate-700 p-5 mb-5">
            <p className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">
              Ваши данные
            </p>
            <p className="text-lg font-bold text-gray-900 dark:text-white mb-0.5">
              {patient_name || patient_phone}
            </p>
            {mis_info.card_number && (
              <p className="text-sm text-gray-500 dark:text-gray-400">Карта МИС № {mis_info.card_number}</p>
            )}
            {mis_info.birth_date && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{mis_info.birth_date}</p>
            )}
            {mis_info.has_account && (
              <div className="mt-3 inline-flex items-center gap-1.5 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 text-xs font-medium px-3 py-1 rounded-full">
                <span className="material-symbols-outlined text-sm leading-none">check_circle</span>
                Зарегистрированы в МИС
              </div>
            )}
          </div>
        )}

        {/* Заголовок секции */}
        <h2 className="text-3xl font-extrabold text-gray-900 dark:text-white mb-4">
          Мои направления
        </h2>

        {/* Поиск по направлениям */}
        <div className="relative mb-5">
          <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-xl pointer-events-none">
            search
          </span>
          <input
            type="text"
            placeholder="Поиск направлений..."
            className="w-full h-14 pl-12 pr-4 bg-gray-100 dark:bg-slate-800 text-gray-900 dark:text-white rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition placeholder-gray-400 dark:placeholder-gray-600"
          />
        </div>

        {/* Сетка карточек */}
        {allReferrals.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-slate-800 flex items-center justify-center mb-4">
              <span className="material-symbols-outlined text-4xl text-gray-300 dark:text-gray-600">inbox</span>
            </div>
            <p className="text-gray-400 dark:text-gray-600 text-base font-medium">У вас пока нет направлений</p>
            <p className="text-gray-300 dark:text-gray-700 text-sm mt-1">Они появятся после визита к партнёру</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {allReferrals.map((r, idx) => (
              <ReferralCardItem
                key={r.id}
                referral={r}
                index={idx}
                onShowQr={setFullscreenQr}
              />
            ))}
          </div>
        )}

        <p className="text-center text-xs text-gray-300 dark:text-gray-700 mt-8">
          КлиникаСеть — система направлений
        </p>
      </div>
    </div>
  )
}
