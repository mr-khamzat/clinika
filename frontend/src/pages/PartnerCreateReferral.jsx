/**
 * ========================================
 * БЛОК: Партнёр — Главный дашборд + Запись пациента
 * ========================================
 * Упрощённая форма для партнёров. Клиника зафиксирована (своя),
 * партнёр выбирает только услугу и вводит данные пациента.
 *
 * Режимы:
 *   - 'dashboard' — главный экран с бенто-статами и кнопками
 *   - 'history'   — список последних направлений партнёра
 *   - 'create'    — форма создания нового направления
 *
 * Отличие от CreateReferral.jsx:
 *   - Нет выбора клиники (to_clinic = user.clinic_id)
 *   - Нет from_clinic (партнёр не из клиники)
 *   - Нет расписания / записи на дату (опционально добавить позже)
 * ========================================
 */
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getMyClinicServices, createReferral, getReferrals } from '../api'
import useAuthStore from '../store/auth'

// Статусы направлений
const STATUS_CONFIG = {
  created:          { label: 'Создано',      pill: 'bg-[#dae5ff] text-[#1565c0]' },
  confirmed:        { label: 'Подтверждено', pill: 'bg-[#dcfce7] text-[#166534]' },
  expired:          { label: 'Истекло',      pill: 'bg-[#eceef0] text-[#727783]' },
  cancel_requested: { label: 'На отмене',    pill: 'bg-orange-100 text-orange-700' },
  cancelled:        { label: 'Отменено',     pill: 'bg-red-100 text-[#ba1a1a]' },
}

function StatusPill({ status }) {
  const cfg = STATUS_CONFIG[status] || { label: status, pill: 'bg-gray-100 text-gray-500' }
  return (
    <span className={`text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap ${cfg.pill}`}>
      {cfg.label}
    </span>
  )
}

// Карточка недавнего направления (в дашборде и истории)
function MiniReferralCard({ referral }) {
  const nav = useNavigate()
  const dateStr = new Date(referral.created_at).toLocaleDateString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  })
  return (
    <div
      className="bg-white rounded-2xl p-4 cursor-pointer hover:bg-[#f7f9fb] active:bg-[#f2f4f6] transition-colors" style={{boxShadow:"0 4px 16px rgba(25,28,30,0.05)"}}
      onClick={() => nav(`/qr/${referral.id}`)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-[#191c1e] text-sm truncate">
            {referral.service_name || 'Услуга'}
          </p>
          <p className="text-xs text-[#727783] mt-0.5 truncate">
            {referral.to_clinic_name || 'Клиника'} · {referral.patient_phone}
          </p>
          <div className="flex items-center gap-1.5 mt-1.5">
            <span className="material-symbols-outlined text-sm text-gray-400 leading-none">calendar_today</span>
            <span className="text-xs text-[#727783]">{dateStr}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          <StatusPill status={referral.status} />
          {referral.bonus_amount > 0 && (
            <span className="text-xs font-bold text-[#166634]">
              +{referral.bonus_amount} Б
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

export default function PartnerCreateReferral() {
  const { user } = useAuthStore()
  const nav = useNavigate()

  // Режим экрана
  const [mode, setMode] = useState('dashboard') // 'dashboard' | 'history' | 'create'

  // ─── Состояние: список услуг клиники ───
  const [services, setServices] = useState([])
  const [loadingServices, setLoadingServices] = useState(true)

  // ─── Состояние: история направлений ───
  const [referrals, setReferrals] = useState([])
  const [loadingReferrals, setLoadingReferrals] = useState(true)

  // ─── Состояние: форма создания ───
  const [form, setForm] = useState({
    patient_phone: '',
    patient_name: '',
    service_id: '',
    notes: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // ─── Загрузка услуг и направлений ───
  useEffect(() => {
    if (!user?.clinic_id) return
    getMyClinicServices(user.clinic_id)
      .then(r => setServices(Array.isArray(r.data) ? r.data : []))
      .catch(() => setServices([]))
      .finally(() => setLoadingServices(false))

    getReferrals()
      .then(r => setReferrals(Array.isArray(r.data) ? r.data : []))
      .catch(() => setReferrals([]))
      .finally(() => setLoadingReferrals(false))
  }, [user?.clinic_id])

  // ─── Обработка отправки формы ───
  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.service_id) { setError('Выберите услугу'); return }
    if (!form.patient_phone) { setError('Введите телефон пациента'); return }

    setLoading(true)
    setError('')
    try {
      const payload = {
        to_clinic_id: user.clinic_id,   // Партнёр всегда направляет в свою клинику
        service_id: form.service_id,
        patient_phone: form.patient_phone,
        notes: form.notes || (form.patient_name ? `Пациент: ${form.patient_name}` : null),
      }
      const res = await createReferral(payload)
      nav(`/qr/${res.data.id}`)
    } catch (err) {
      setError(err.response?.data?.detail || 'Ошибка создания направления')
    } finally {
      setLoading(false)
    }
  }

  const selectedService = services.find(s => s.id === form.service_id)
  const submitDisabled = loading || !form.service_id || !form.patient_phone

  // Подсчёт статистики
  const totalReferrals = referrals.length
  const totalBonuses = referrals.reduce((sum, r) => sum + (r.bonus_amount || 0), 0)
  const recentReferrals = referrals.slice(0, 5)

  // ─── Экран "История направлений" ───
  if (mode === 'history') return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      <header className="sticky top-0 z-30 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-b border-gray-100 dark:border-slate-800 px-5 py-3">
        <div className="max-w-md mx-auto flex items-center gap-3">
          <button
            onClick={() => setMode('dashboard')}
            className="w-9 h-9 rounded-xl bg-gray-100 dark:bg-slate-800 flex items-center justify-center"
          >
            <span className="material-symbols-outlined text-gray-600 dark:text-gray-300 text-xl">arrow_back</span>
          </button>
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">История направлений</h1>
        </div>
      </header>

      <div className="max-w-md mx-auto px-4 pt-5 pb-10 space-y-3">
        {loadingReferrals ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-[3px] border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : referrals.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-slate-800 flex items-center justify-center mb-4">
              <span className="material-symbols-outlined text-4xl text-gray-300 dark:text-gray-600">inbox</span>
            </div>
            <p className="text-gray-400 dark:text-gray-600 text-base font-medium">Направлений пока нет</p>
          </div>
        ) : (
          referrals.map(r => <MiniReferralCard key={r.id} referral={r} />)
        )}
      </div>
    </div>
  )

  // ─── Экран "Создание направления" ───
  if (mode === 'create') return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      <header className="sticky top-0 z-30 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-b border-gray-100 dark:border-slate-800 px-5 py-3">
        <div className="max-w-md mx-auto flex items-center gap-3">
          <button
            onClick={() => { setMode('dashboard'); setError(''); setForm({ patient_phone: '', patient_name: '', service_id: '', notes: '' }) }}
            className="w-9 h-9 rounded-xl bg-gray-100 dark:bg-slate-800 flex items-center justify-center"
          >
            <span className="material-symbols-outlined text-gray-600 dark:text-gray-300 text-xl">arrow_back</span>
          </button>
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">Новое направление</h1>
        </div>
      </header>

      <div className="max-w-md mx-auto px-4 pt-5 pb-10">

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-4 mb-5">
            <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">

          {/* ─── Телефон пациента ─── */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-gray-100 dark:border-slate-700">
            <label className="block text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">
              Телефон пациента <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xl pointer-events-none">phone</span>
              <input
                required
                type="tel"
                placeholder="+7 900 000-00-00"
                value={form.patient_phone}
                onChange={e => setForm(f => ({ ...f, patient_phone: e.target.value }))}
                className="w-full h-12 pl-11 pr-4 bg-gray-50 dark:bg-slate-700 text-gray-900 dark:text-white rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition placeholder-gray-400 dark:placeholder-gray-600"
              />
            </div>
          </div>

          {/* ─── ФИО пациента ─── */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-gray-100 dark:border-slate-700">
            <label className="block text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">
              ФИО пациента <span className="text-gray-400 font-normal text-xs normal-case">(необязательно)</span>
            </label>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xl pointer-events-none">person</span>
              <input
                type="text"
                placeholder="Иванов Иван Иванович"
                value={form.patient_name}
                onChange={e => setForm(f => ({ ...f, patient_name: e.target.value }))}
                className="w-full h-12 pl-11 pr-4 bg-gray-50 dark:bg-slate-700 text-gray-900 dark:text-white rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition placeholder-gray-400 dark:placeholder-gray-600"
              />
            </div>
          </div>

          {/* ─── Выбор услуги ─── */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-gray-100 dark:border-slate-700">
            <label className="block text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">
              Услуга <span className="text-red-500">*</span>
            </label>
            {loadingServices ? (
              <div className="flex items-center justify-center py-6">
                <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
              </div>
            ) : services.length === 0 ? (
              <div className="text-sm text-gray-400 py-4 text-center bg-gray-50 dark:bg-slate-700 rounded-xl">
                Нет доступных услуг
              </div>
            ) : (
              <div className="space-y-2">
                {services.map(s => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, service_id: s.id }))}
                    className={`w-full text-left p-3.5 rounded-xl border-2 transition-all ${
                      form.service_id === s.id
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-600'
                        : 'border-gray-100 dark:border-slate-600 bg-gray-50 dark:bg-slate-700 hover:border-blue-200 dark:hover:border-blue-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                          form.service_id === s.id
                            ? 'bg-blue-100 dark:bg-blue-900/40'
                            : 'bg-white dark:bg-slate-600'
                        }`}>
                          <span className={`material-symbols-outlined text-base ${
                            form.service_id === s.id
                              ? 'text-blue-600 dark:text-blue-400'
                              : 'text-gray-400 dark:text-gray-400'
                          }`}>medical_services</span>
                        </div>
                        <span className="text-sm font-medium text-gray-800 dark:text-white truncate">{s.name}</span>
                      </div>
                      {s.bonus_amount > 0 && (
                        <span className="text-sm font-bold text-green-600 dark:text-green-400 ml-2 flex-shrink-0">
                          +{s.bonus_amount} Б
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Бонус за выбранную услугу */}
          {selectedService && selectedService.bonus_amount > 0 && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-2xl p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-green-100 dark:bg-green-900/40 flex items-center justify-center flex-shrink-0">
                <span className="material-symbols-outlined text-green-600 dark:text-green-400 text-xl">account_balance_wallet</span>
              </div>
              <div>
                <p className="text-xs text-[#727783]">Ваш бонус за направление</p>
                <p className="text-lg font-bold text-green-600 dark:text-green-400">+{selectedService.bonus_amount} Б</p>
              </div>
            </div>
          )}

          {/* ─── Кнопка отправки ─── */}
          <button
            type="submit"
            disabled={submitDisabled}
            className="w-full h-14 bg-gradient-to-br from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white rounded-2xl flex items-center justify-center gap-3 font-semibold text-base uppercase tracking-wide disabled:opacity-50 transition shadow-lg shadow-blue-200 dark:shadow-blue-900/30"
          >
            <span className="material-symbols-outlined text-2xl">send</span>
            {loading ? 'Создание...' : 'Создать направление'}
          </button>
        </form>
      </div>
    </div>
  )

  // ─── Главный экран дашборда ───
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
          <span className="text-xs font-semibold bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 px-3 py-1 rounded-full">
            Партнёр
          </span>
        </div>
      </header>

      <div className="max-w-md mx-auto px-4 pt-6 pb-10">

        {/* Приветствие */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Здравствуйте, {user?.full_name || user?.username || 'Партнёр'}!
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Добро пожаловать в личный кабинет
          </p>
        </div>

        {/* Бенто-статы 2x1 */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          {/* Направлений */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 border border-gray-100 dark:border-slate-700">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
                <span className="material-symbols-outlined text-blue-600 dark:text-blue-400 text-lg">group</span>
              </div>
            </div>
            <p className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">
              Направлений
            </p>
            <p className="text-3xl font-bold text-gray-900 dark:text-white">
              {loadingReferrals ? '—' : totalReferrals}
            </p>
            <p className="text-[10px] text-green-500 mt-1">Всего за всё время</p>
          </div>

          {/* Бонусы */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 border border-gray-100 dark:border-slate-700">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-xl bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
                <span className="material-symbols-outlined text-green-600 dark:text-green-400 text-lg">account_balance_wallet</span>
              </div>
            </div>
            <p className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">
              Бонусы
            </p>
            <p className="text-3xl font-bold text-gray-900 dark:text-white">
              {loadingReferrals ? '—' : `${totalBonuses} Б`}
            </p>
            <p className="text-[10px] text-green-500 mt-1">Начислено итого</p>
          </div>
        </div>

        {/* Большая кнопка создания */}
        <button
          onClick={() => setMode('create')}
          className="w-full h-16 bg-gradient-to-br from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white rounded-2xl flex items-center justify-center gap-3 font-semibold uppercase tracking-wide shadow-lg shadow-blue-200 dark:shadow-blue-900/30 transition mb-3"
        >
          <span className="material-symbols-outlined text-2xl">add_circle</span>
          <span className="text-base">Новое направление</span>
        </button>

        {/* Кнопка истории */}
        <button
          onClick={() => setMode('history')}
          className="w-full h-14 border-2 border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400 rounded-2xl flex items-center justify-center gap-3 font-semibold transition hover:bg-blue-50 dark:hover:bg-blue-900/20 mb-6"
        >
          <span className="material-symbols-outlined text-xl">history</span>
          <span>История направлений</span>
        </button>

        {/* Последние направления */}
        {!loadingReferrals && recentReferrals.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-bold text-gray-900 dark:text-white">Последние направления</h2>
              <button
                onClick={() => setMode('history')}
                className="text-xs text-blue-600 dark:text-blue-400 font-medium"
              >
                Все →
              </button>
            </div>
            <div className="space-y-3">
              {recentReferrals.map(r => (
                <MiniReferralCard key={r.id} referral={r} />
              ))}
            </div>
          </div>
        )}

        {/* Пустое состояние */}
        {!loadingReferrals && referrals.length === 0 && (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-slate-800 flex items-center justify-center mb-4">
              <span className="material-symbols-outlined text-4xl text-gray-300 dark:text-gray-600">inbox</span>
            </div>
            <p className="text-gray-400 dark:text-gray-600 text-sm font-medium">Направлений пока нет</p>
            <p className="text-gray-300 dark:text-gray-700 text-xs mt-1">
              Нажмите «Новое направление» чтобы начать
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
