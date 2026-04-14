import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { getReferrals, getIncomingReferrals } from '../api'
import CancelModal from '../components/CancelModal'

const STATUS_STYLE = {
  created:          'bg-[#dae5ff] text-[#1565c0]',
  confirmed:        'bg-[#dcfce7] text-[#166534]',
  expired:          'bg-[#eceef0] text-[#727783]',
  cancel_requested: 'bg-orange-100 text-orange-700',
  cancelled:        'bg-red-100 text-red-700',
}

const STATUS_LABELS = {
  created:          'Ожидает',
  confirmed:        'Подтверждено',
  expired:          'Истекло',
  cancel_requested: 'На отмене',
  cancelled:        'Отменено',
}

const STATUS_ICON = {
  created:          { bg: 'bg-[#dae5ff]', color: '#1565c0', icon: 'send' },
  confirmed:        { bg: 'bg-[#dcfce7]', color: '#166534', icon: 'check_circle' },
  expired:          { bg: 'bg-[#eceef0]', color: '#727783', icon: 'schedule' },
  cancel_requested: { bg: 'bg-orange-100', color: '#c2410c', icon: 'pending' },
  cancelled:        { bg: 'bg-red-100',    color: '#ba1a1a', icon: 'cancel' },
}

function formatDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatTime(str) {
  if (!str) return ''
  return new Date(str).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

// ─── Карточка одного направления ───
function ReferralCard({ r, onNav, onCancel, isIncoming }) {
  const ic = STATUS_ICON[r.status] || STATUS_ICON.expired

  // Для входящих: иконка другая — стрелка влево
  const incomingIcon = { bg: 'bg-amber-50', color: '#b45309', icon: 'move_to_inbox' }
  const cardIcon = (isIncoming && r.status === 'created') ? incomingIcon : ic

  return (
    <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: '0 4px 16px rgba(25,28,30,0.05)' }}>
      <div onClick={() => onNav(`/qr/${r.id}`)} className="p-4 cursor-pointer">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 ${cardIcon.bg}`}>
              <span className="material-symbols-outlined text-xl" style={{ color: cardIcon.color, fontVariationSettings: "'FILL' 1" }}>
                {cardIcon.icon}
              </span>
            </div>
            <div className="min-w-0">
              {isIncoming ? (
                <>
                  <p className="font-bold text-[#191c1e] text-sm leading-tight">{r.patient_name || r.patient_phone}</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className="text-[11px] text-amber-700 font-semibold bg-amber-50 px-2 py-0.5 rounded-full">
                      из {r.from_clinic_name || 'другой клиники'}
                    </span>
                  </div>
                  <p className="text-xs text-[#727783] truncate mt-0.5">{r.service_name || 'Услуга'}</p>
                </>
              ) : (
                <>
                  <p className="font-bold text-[#191c1e] text-sm leading-tight truncate">
                    {r.to_clinic_name || 'Клиника'}
                  </p>
                  {r.from_clinic_name && r.from_clinic_name !== r.to_clinic_name && (
                    <p className="text-[11px] text-[#727783] mt-0.5">
                      из {r.from_clinic_name}
                    </p>
                  )}
                  <p className="text-xs text-[#727783] truncate mt-0.5">{r.service_name || 'Услуга'}</p>
                </>
              )}
            </div>
          </div>
          <span className={`flex-shrink-0 text-[11px] px-2.5 py-1 rounded-full font-bold uppercase tracking-tight ${STATUS_STYLE[r.status] || 'bg-[#eceef0] text-[#727783]'}`}>
            {STATUS_LABELS[r.status] || r.status}
          </span>
        </div>

        <div className="flex items-center gap-3 mt-3 flex-wrap">
          {r.patient_phone && (
            <div className="flex items-center gap-1 text-[#727783]">
              <span className="material-symbols-outlined" style={{ fontSize: 13 }}>phone</span>
              <span className="text-xs">{r.patient_phone}</span>
            </div>
          )}
          <div className="flex items-center gap-1 text-[#727783]">
            <span className="material-symbols-outlined" style={{ fontSize: 13 }}>calendar_today</span>
            <span className="text-xs">{formatDate(r.created_at)}</span>
          </div>
          {r.appointment_at && (
            <div className="flex items-center gap-1 text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
              <span className="material-symbols-outlined" style={{ fontSize: 12 }}>schedule</span>
              <span className="text-xs font-semibold">{formatDate(r.appointment_at)} {formatTime(r.appointment_at)}</span>
            </div>
          )}
          {!isIncoming && r.bonus_amount > 0 && (
            <span className="text-[#166534] font-bold text-sm ml-auto">+{r.bonus_amount} Б</span>
          )}
        </div>

        {/* Для входящих — подсказка как подтвердить */}
        {isIncoming && r.status === 'created' && (
          <div className="mt-3 bg-amber-50 rounded-xl px-3 py-2 flex items-center gap-2">
            <span className="material-symbols-outlined text-amber-600 text-base" style={{ fontVariationSettings: "'FILL' 1" }}>qr_code_scanner</span>
            <span className="text-xs text-amber-700 font-medium">
              Когда пациент придёт — отсканируйте его QR-код или нажмите для подтверждения
            </span>
          </div>
        )}

        {r.status === 'cancel_requested' && r.cancel_reason && (
          <p className="text-xs text-orange-600 mt-2 flex items-center gap-1">
            <span className="material-symbols-outlined" style={{ fontSize: 13 }}>pending</span>
            На отмене: «{r.cancel_reason}»
          </p>
        )}
      </div>

      {!isIncoming && ['created', 'confirmed'].includes(r.status) && (
        <div className="border-t border-[#f2f4f6] px-4 py-2.5">
          <button onClick={e => { e.stopPropagation(); onCancel(r) }}
            className="w-full text-xs font-semibold text-[#ba1a1a] hover:bg-red-50 rounded-xl py-1.5 transition-colors">
            Запросить отмену
          </button>
        </div>
      )}

      {/* Входящее — кнопка перейти к QR для подтверждения */}
      {isIncoming && r.status === 'created' && (
        <div className="border-t border-[#f2f4f6] px-4 py-2.5">
          <button onClick={() => onNav(`/qr/${r.id}`)}
            className="w-full text-xs font-semibold text-[#1565c0] hover:bg-[#dae5ff] rounded-xl py-1.5 transition-colors flex items-center justify-center gap-1">
            <span className="material-symbols-outlined text-sm">open_in_new</span>
            Открыть направление
          </button>
        </div>
      )}
    </div>
  )
}

export default function History() {
  const [mode, setMode] = useState('outgoing')       // 'outgoing' | 'incoming'
  const [referrals, setReferrals] = useState([])
  const [incoming, setIncoming] = useState([])
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [cancelTarget, setCancelTarget] = useState(null)
  const nav = useNavigate()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [myRes, inRes] = await Promise.all([
        getReferrals(),
        getIncomingReferrals(),
      ])
      setReferrals(myRes.data || [])
      setIncoming(inRes.data || [])
    } catch {}
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const STATUS_FILTERS = [
    ['all',              'Все'],
    ['created',          'Ожидает'],
    ['confirmed',        'Подтверждено'],
    ['expired',          'Истекло'],
    ['cancel_requested', 'На отмене'],
    ['cancelled',        'Отменено'],
  ]

  const activeList = mode === 'outgoing' ? referrals : incoming
  const filtered = filter === 'all' ? activeList : activeList.filter(r => r.status === filter)

  // Счётчик ожидающих входящих (для бейджа)
  const pendingIncoming = incoming.filter(r => r.status === 'created').length

  return (
    <div className="bg-[#f7f9fb] min-h-screen pb-28">
      <div className="px-4 pt-4 space-y-3">

        {/* ── Переключатель режима ── */}
        <div className="flex bg-white rounded-2xl p-1" style={{ boxShadow: '0 2px 8px rgba(25,28,30,0.06)' }}>
          {[
            { key: 'outgoing', label: 'Мои направления', icon: 'send', count: referrals.length },
            { key: 'incoming', label: 'Входящие', icon: 'move_to_inbox', count: pendingIncoming },
          ].map(tab => (
            <button key={tab.key} onClick={() => { setMode(tab.key); setFilter('all') }}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all ${
                mode === tab.key
                  ? 'bg-[#1565c0] text-white shadow-md'
                  : 'text-[#727783]'
              }`}>
              <span className="material-symbols-outlined text-base" style={{ fontVariationSettings: mode === tab.key ? "'FILL' 1" : "'FILL' 0" }}>
                {tab.icon}
              </span>
              {tab.label}
              {tab.count > 0 && (
                <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded-full min-w-[18px] text-center ${
                  mode === tab.key
                    ? 'bg-white/25 text-white'
                    : tab.key === 'incoming' ? 'bg-amber-100 text-amber-700' : 'bg-[#f2f4f6] text-[#727783]'
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Описание входящих ── */}
        {mode === 'incoming' && (
          <div className="bg-amber-50 rounded-2xl px-4 py-3 flex items-start gap-3">
            <span className="material-symbols-outlined text-amber-600 text-xl flex-shrink-0 mt-0.5" style={{ fontVariationSettings: "'FILL' 1" }}>info</span>
            <p className="text-xs text-amber-800 leading-relaxed">
              Здесь отображаются направления из других клиник сети, адресованные вашей клинике. Когда пациент придёт — отсканируйте его QR через раздел «Сканировать».
            </p>
          </div>
        )}

        {/* ── Фильтры по статусу ── */}
        <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {STATUS_FILTERS.map(([val, label]) => {
            const cnt = val === 'all' ? activeList.length : activeList.filter(r => r.status === val).length
            if (cnt === 0 && val !== 'all') return null
            return (
              <button key={val} onClick={() => setFilter(val)}
                className={`flex-shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
                  filter === val
                    ? 'bg-[#1565c0] text-white'
                    : 'bg-white text-[#424752] border border-[#eceef0]'
                }`}
                style={filter === val ? { boxShadow: '0 4px 12px rgba(21,101,192,0.2)' } : {}}>
                {label}
                {cnt > 0 && (
                  <span className={`text-[10px] font-bold rounded-full px-1.5 py-0.5 ${filter === val ? 'bg-white/20 text-white' : 'bg-[#f2f4f6] text-[#727783]'}`}>
                    {cnt}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* ── Контент ── */}
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-[3px] border-[#1565c0] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-16 h-16 bg-[#eceef0] rounded-3xl flex items-center justify-center mb-4">
              <span className="material-symbols-outlined text-[#c2c6d4] text-3xl">
                {mode === 'incoming' ? 'move_to_inbox' : 'description'}
              </span>
            </div>
            <p className="text-[#727783] text-sm font-medium">
              {mode === 'incoming' ? 'Входящих направлений нет' : 'Направлений пока нет'}
            </p>
            {mode === 'incoming' && (
              <p className="text-[#c2c6d4] text-xs mt-1 text-center px-8">
                Сюда попадут направления из других клиник вашей сети
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(r => (
              <ReferralCard
                key={r.id}
                r={r}
                isIncoming={mode === 'incoming'}
                onNav={(path) => nav(path)}
                onCancel={(ref) => setCancelTarget(ref)}
              />
            ))}
          </div>
        )}
      </div>

      {cancelTarget && (
        <CancelModal referral={cancelTarget} onClose={() => setCancelTarget(null)} onDone={() => { setCancelTarget(null); load() }} />
      )}
    </div>
  )
}
