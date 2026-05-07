/**
 * ========================================
 * Кабинет врача-партнёра (PARTNER_DOCTOR)
 * ========================================
 * Этап 5 ROADMAP, кабинет 6/9: миграция UI на design-system.
 * Сохраняем:
 *   - gradient header (премиум-вид, специфичен для кабинета)
 *   - bottom navigation (мобильный паттерн всех кабинетов)
 * Заменяем:
 *   - самописные карточки → <Card>
 *   - KPI-плитки           → <KpiRow> + <KpiCard>
 *   - статус-бейджи        → <Chip>
 *   - пустые состояния     → <EmptyState>
 * Логику и API-вызовы НЕ трогаем — только UI компоненты.
 * ========================================
 */
import { useState, useEffect } from 'react'
import api from '../api'
import { API_BASE, SLUG } from '../config'
// Дизайн-система: Card / KpiCard / KpiRow / Chip / EmptyState
import { Card, KpiCard, KpiRow, Chip, EmptyState } from '../design'

const ACCENT = '#1565C0'
const DARK   = '#0d2040'

const NAV = [
  { key: 'dashboard', label: 'Главная',      icon: 'dashboard'      },
  { key: 'referrals', label: 'Направления',  icon: 'send'           },
  { key: 'schedule',  label: 'Расписание',   icon: 'calendar_today' },
  { key: 'bonuses',   label: 'Бонусы',       icon: 'payments'       },
]

function fmt(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric' })
}

// ─── Маппинг статусов на варианты <Chip> ──────────────────────────
const STATUS_LABEL = { created:'Создано', confirmed:'Подтверждено', expired:'Истекло', cancelled:'Отменено' }
const STATUS_VARIANT = {
  created:   'accent',
  confirmed: 'good',
  expired:   'default',
  cancelled: 'bad',
}
function StatusChip({ status }) {
  const variant = STATUS_VARIANT[status] || 'default'
  return <Chip variant={variant} dot>{STATUS_LABEL[status] || status}</Chip>
}

export default function PartnerDoctorCabinet({ adminToken, user, onLogout }) {
  const [tab, setTab] = useState('dashboard')
  const [referrals, setReferrals] = useState([])
  const [bonuses, setBonuses] = useState([])
  const [income, setIncome] = useState([])

  useEffect(() => {
    if (tab === 'referrals' || tab === 'dashboard') {
      api.get('/referrals').then(r => setReferrals(Array.isArray(r.data) ? r.data : (r.data?.items || []))).catch(() => {})
    }
    if (tab === 'bonuses') {
      api.get('/bonuses').then(r => setBonuses(Array.isArray(r.data) ? r.data : [])).catch(() => {})
      api.get('/visiting/my-income').then(r => setIncome(Array.isArray(r.data) ? r.data : [])).catch(() => {})
    }
  }, [tab])

  const totalIncome  = income.reduce((s, e) => s + parseFloat(e.amount || 0), 0)
  const totalBonuses = bonuses.reduce((s, b) => s + parseFloat(b.amount || 0), 0)
  const confirmed    = referrals.filter(r => r.status === 'confirmed').length

  return (
    <div className="min-h-screen bg-[#f7f9fb]" style={{ fontFamily:"'Inter',sans-serif" }}>

      {/* TODO(design-system): Gradient Header — премиум-вид, оставляем кастомным.
          Перенос на <PageHeader> сломает «брендированную» шапку кабинета. */}
      <div className="relative overflow-hidden px-4 pt-12 pb-6"
        style={{ background:'linear-gradient(135deg,#1565C0 0%,#0097A7 100%)' }}>
        <div className="absolute -top-8 -right-8 w-36 h-36 rounded-full bg-white/5 pointer-events-none" />
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{ background:'rgba(255,255,255,0.18)', backdropFilter:'blur(10px)' }}>
            <span className="material-symbols-outlined text-white text-2xl" style={{ fontVariationSettings:"'FILL' 1" }}>stethoscope</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-base truncate">{user?.full_name}</p>
            <p className="text-white/70 text-xs">Врач-партнёр</p>
          </div>
          {/* Тач-таргет 44×44 минимум */}
          <button onClick={onLogout}
            aria-label="Выйти"
            className="w-11 h-11 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl flex-shrink-0"
            style={{ background:'rgba(255,255,255,0.12)' }}>
            <span className="material-symbols-outlined text-white/80 text-lg">logout</span>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-4 pb-28">

        {/* Dashboard */}
        {tab === 'dashboard' && (
          <div className="space-y-4">
            {/* KPI-сетка — заменяем самописные плитки на <KpiRow>+<KpiCard> */}
            <KpiRow cols={2}>
              <KpiCard label="Направлений"    value={referrals.length} />
              <KpiCard label="Подтверждено"   value={confirmed} />
              <KpiCard label="Бонусы, ₽"      value={Math.round(totalBonuses).toLocaleString('ru')} />
              <KpiCard label="Начислено, ₽"   value={Math.round(totalIncome).toLocaleString('ru')} />
            </KpiRow>
            {referrals.slice(0, 5).length > 0 && (
              <Card>
                <Card.Header>
                  <Card.Title>Последние направления</Card.Title>
                </Card.Header>
                <div className="space-y-2">
                  {referrals.slice(0, 5).map(r => (
                    <div key={r.id} className="flex items-center gap-3 py-2 border-b last:border-b-0" style={{ borderColor:'var(--border)' }}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">{r.to_clinic_name || '—'}</p>
                        <p className="text-xs text-gray-400 truncate">{r.service_name || '—'}</p>
                      </div>
                      <StatusChip status={r.status} />
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        )}

        {/* Направления — список <Card> с <Chip>-статусами */}
        {tab === 'referrals' && (
          <div className="space-y-3">
            {referrals.length === 0 && (
              <Card>
                <EmptyState
                  icon={<span className="material-symbols-outlined text-3xl" style={{ fontVariationSettings:"'FILL' 1" }}>send</span>}
                  title="Нет направлений"
                  message="Здесь появятся ваши созданные направления."
                />
              </Card>
            )}
            {referrals.map(r => (
              <Card key={r.id}>
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background:'#e3f2fd' }}>
                    <span className="material-symbols-outlined text-xl" style={{ color:ACCENT, fontVariationSettings:"'FILL' 1" }}>send</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-800 text-sm truncate">{r.to_clinic_name || '—'}</p>
                    <p className="text-xs text-gray-400 truncate">{r.service_name}</p>
                    {r.short_code && <p className="text-xs text-gray-500 mt-0.5 font-mono">#{r.short_code}</p>}
                  </div>
                  <StatusChip status={r.status} />
                </div>
                <p className="text-xs text-gray-300 mt-2">{fmt(r.created_at)}</p>
              </Card>
            ))}
          </div>
        )}

        {/* Расписание — пустое состояние через <EmptyState> в <Card> */}
        {tab === 'schedule' && (
          <Card>
            <EmptyState
              icon={<span className="material-symbols-outlined text-3xl" style={{ fontVariationSettings:"'FILL' 1" }}>calendar_today</span>}
              title="Расписание назначается"
              message="Расписание ваших приёмов задаёт администратор клиники."
            />
          </Card>
        )}

        {/* Бонусы */}
        {tab === 'bonuses' && (
          <div className="space-y-3">
            {bonuses.length === 0 && income.length === 0 && (
              <Card>
                <EmptyState
                  icon={<span className="material-symbols-outlined text-3xl" style={{ fontVariationSettings:"'FILL' 1" }}>payments</span>}
                  title="Нет начислений"
                  message="Здесь появятся ваши бонусы и доходы."
                />
              </Card>
            )}
            {bonuses.map(b => (
              <Card key={b.id}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background:'#fff8e1' }}>
                    <span className="material-symbols-outlined text-xl" style={{ color:'#d97706', fontVariationSettings:"'FILL' 1" }}>star</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800">Бонус</p>
                    <p className="text-xs text-gray-400">{fmt(b.created_at)}</p>
                  </div>
                  <p className="font-bold text-amber-600 text-base">+{b.amount} ₽</p>
                </div>
              </Card>
            ))}
            {income.map(e => (
              <Card key={e.id}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background:'#e8f5e9' }}>
                    <span className="material-symbols-outlined text-xl" style={{ color:'#16A34A', fontVariationSettings:"'FILL' 1" }}>payments</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800">{e.operation_type}</p>
                    <p className="text-xs text-gray-400">{fmt(e.created_at)}</p>
                  </div>
                  <p className="font-bold text-green-600 text-base">+{e.amount} ₽</p>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* TODO(design-system): Bottom Navigation — мобильный паттерн всех кабинетов,
          оставляем кастомным до появления <BottomNav> в design-system. */}
      <div className="fixed bottom-0 left-0 right-0 z-50"
        style={{ paddingBottom:'env(safe-area-inset-bottom)', background:'rgba(255,255,255,0.95)', backdropFilter:'blur(20px)', borderTop:'1px solid rgba(0,0,0,0.06)' }}>
        <div className="flex">
          {NAV.map(item => (
            <button key={item.key} onClick={() => setTab(item.key)}
              aria-label={item.label}
              className="flex-1 flex flex-col items-center justify-center pt-2 pb-1 min-h-[56px] gap-0.5 relative">
              {tab === item.key && <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full" style={{ background:ACCENT }} />}
              <span className="material-symbols-outlined text-2xl" style={{ color:tab === item.key ? ACCENT : '#9ca3af', fontVariationSettings:tab === item.key ? "'FILL' 1" : "'FILL' 0" }}>{item.icon}</span>
              <span className="text-xs font-semibold" style={{ color:tab === item.key ? ACCENT : '#9ca3af' }}>{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
