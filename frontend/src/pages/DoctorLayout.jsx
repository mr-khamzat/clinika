/**
 * ========================================
 * Личный кабинет врача · Premium Redesign
 * ========================================
 * Дизайн-система: design-preview-2 (light theme, teal accent).
 * Эталон: /frontend/public/design2/doctor.html
 *
 * Бизнес-логика API не изменена:
 *   GET /my-doctor                          — карточка врача
 *   GET /appointments?doctor_id=...&limit=  — записи
 *   GET /manager/referrals/?limit=          — направления
 *
 * Структура:
 *   Sidebar (desktop) — профиль, навигация по 9 секциям
 *   Top header (mobile) — бургер + название секции
 *   Mobile bottom nav — основные 5 секций
 *
 * Секции (route):
 *   today      — KPI дня + список приёмов сегодня
 *   schedule   — WeekScheduleSection (уже premium)
 *   patients   — мои пациенты (карточная сетка)
 *   referrals  — направления (рабочая)
 *   appointments — все записи (рабочая)
 *   earnings   — заработок и KPI (визуал-каркас + EmptyState)
 *   rating     — рейтинг и отзывы (визуал-каркас)
 *   time       — отпуск, замены, график (визуал-каркас)
 *   chat       — чат с пациентами (EmptyState — функция в разработке)
 *
 * Все секции используют дизайн-токены через CSS-переменные,
 * базовые компоненты из ../design.
 * ========================================
 */
import { useState, useEffect, useMemo } from 'react'
import api from '../api'
import {
  Page,
  PageHeader,
  Card,
  KpiCard,
  KpiRow,
  Chip,
  Button,
  Tabs,
  Avatar,
  EmptyState,
  Sparkline,
  useToast,
} from '../design'
import WeekScheduleSection from '../sections/scheduling/WeekScheduleSection'
// Единый хук переключения темы (общий для всех кабинетов)
import useTheme from '../lib/useTheme'
// W3: глобальный поиск Cmd+K и центр уведомлений
import CommandPalette from '../components/CommandPalette'
import NotificationsBell from '../components/NotificationsBell'

// ─────────────────────────────────────────────────────────────────────
// Утилиты
// ─────────────────────────────────────────────────────────────────────
// Унификация: единый axios-инстанс с auto-Bearer + auto-refresh.
function apiFetch(m, u, _t, d) { return api({ method: m, url: u, data: d }) }

function pluralize(n, forms) {
  // forms: ['приём', 'приёма', 'приёмов']
  const abs = Math.abs(n) % 100
  const n1 = abs % 10
  if (abs > 10 && abs < 20) return forms[2]
  if (n1 > 1 && n1 < 5) return forms[1]
  if (n1 === 1) return forms[0]
  return forms[2]
}

function formatTodayRu(d = new Date()) {
  return d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })
}

function Spinner() {
  return (
    <div className="flex justify-center py-16">
      <div
        className="w-8 h-8 rounded-full border-2 animate-spin"
        style={{ borderColor: 'var(--accent-line)', borderTopColor: 'var(--accent)' }}
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Навигация
// ─────────────────────────────────────────────────────────────────────
const NAV = [
  { id: 'today',        label: 'Сегодня',        icon: 'today',           group: 'work' },
  { id: 'schedule',     label: 'Расписание',     icon: 'calendar_month',  group: 'work' },
  { id: 'appointments', label: 'Записи',         icon: 'event_note',      group: 'work' },
  { id: 'patients',     label: 'Мои пациенты',   icon: 'group',           group: 'work' },
  { id: 'referrals',    label: 'Направления',    icon: 'assignment',      group: 'work' },
  { id: 'chat',         label: 'Чат',            icon: 'chat_bubble',     group: 'work' },
  { id: 'earnings',     label: 'Заработок',      icon: 'payments',        group: 'cabinet' },
  { id: 'rating',       label: 'Рейтинг',        icon: 'star',            group: 'cabinet' },
  { id: 'time',         label: 'Время и отпуск', icon: 'schedule',        group: 'cabinet' },
]

// Mobile bottom nav: только 5 самых частых
const MOBILE_NAV = ['today', 'schedule', 'appointments', 'patients', 'chat']

// ─────────────────────────────────────────────────────────────────────
// Микрокомпоненты
// ─────────────────────────────────────────────────────────────────────
function MIcon({ name, fill = false, size = 18, color }) {
  return (
    <span
      className="material-symbols-outlined"
      style={{
        fontSize: size,
        color,
        fontVariationSettings: fill ? "'FILL' 1" : "'FILL' 0",
        lineHeight: 1,
      }}
    >
      {name}
    </span>
  )
}

function SectionHeader({ title, subtitle, actions }) {
  return <PageHeader title={title} subtitle={subtitle} actions={actions} />
}

function RowKV({ label, value }) {
  return (
    <div className="flex items-center justify-between" style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
      <span style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>{label}</span>
      <b style={{ fontSize: 13, color: 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>{value}</b>
    </div>
  )
}

function Hint({ icon, title, subtitle }) {
  return (
    <div className="flex items-center gap-3" style={{ padding: '8px 10px', background: 'var(--bg-1)', borderRadius: 9, border: '1px solid var(--border)' }}>
      <span
        className="grid place-items-center flex-shrink-0"
        style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--accent-soft)', color: 'var(--accent)' }}
      >
        <MIcon name={icon} size={16} fill />
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-semibold truncate" style={{ fontSize: 12.5, color: 'var(--fg)' }}>{title}</div>
        <div className="truncate" style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>{subtitle}</div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// TODAY · сегодняшний день врача
// ─────────────────────────────────────────────────────────────────────
function TodayPage({ token, doctorId, doctorInfo }) {
  const [apts, setApts] = useState([])
  const [weekApts, setWeekApts] = useState([])         // W4: для Quick Stats — приёмы за неделю
  const [loading, setLoading] = useState(true)
  const [reloadTick, setReloadTick] = useState(0)
  const { toast } = useToast()

  useEffect(() => {
    if (!doctorId) { setLoading(false); return }
    const today = new Date().toISOString().slice(0, 10)
    setLoading(true)
    apiFetch('get', `/appointments?doctor_id=${doctorId}&date=${today}&limit=50`, token)
      .then(r => setApts(Array.isArray(r.data) ? r.data : r.data?.appointments || []))
      .catch(() => setApts([]))
      .finally(() => setLoading(false))

    // ===== БЛОК (W4): загрузка приёмов за 7 дней для Quick Stats =====
    const wk = new Date(); wk.setDate(wk.getDate() - 6)
    const wkStart = wk.toISOString().slice(0, 10)
    apiFetch('get', `/appointments?doctor_id=${doctorId}&date_from=${wkStart}&date_to=${today}&limit=200`, token)
      .then(r => setWeekApts(Array.isArray(r.data) ? r.data : r.data?.appointments || []))
      .catch(() => setWeekApts([]))
  }, [token, doctorId, reloadTick])

  // ===== БЛОК: обновление расписания без перезагрузки страницы =====
  const handleRefresh = () => {
    setReloadTick(t => t + 1)
    toast('Расписание обновлено', 'success', 2500)
  }

  const STATUS = {
    pending:   { l: 'ожидает',     v: 'default' },
    confirmed: { l: 'подтверждён', v: 'accent'  },
    completed: { l: 'закрыт',      v: 'good'    },
    cancelled: { l: 'отменён',     v: 'bad'     },
    no_show:   { l: 'не пришёл',   v: 'warn'    },
  }

  // Метрики
  const total = apts.length
  const done = apts.filter(a => a.status === 'completed').length
  const cancelled = apts.filter(a => a.status === 'cancelled' || a.status === 'no_show').length
  const upcoming = total - done - cancelled

  // Текущее ближайшее (первое незавершённое)
  const next = apts.find(a => a.status !== 'completed' && a.status !== 'cancelled' && a.status !== 'no_show')

  const todayStr = formatTodayRu()
  const nowTime = new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })

  return (
    <>
      <SectionHeader
        title={`Расписание на ${todayStr.replace(/^./, c => c.toUpperCase())}`}
        subtitle={
          loading
            ? 'загрузка…'
            : total === 0
              ? 'Сегодня записей нет — отдохните или закройте отчётность'
              : `${done} из ${total} ${pluralize(total, ['приём завершён', 'приёма завершено', 'приёмов завершено'])}${next ? ` · ближайший — ${next.patient_name || '—'}` : ''}`
        }
        actions={
          <Button variant="secondary" size="sm" leftIcon={<MIcon name="refresh" size={15} />} onClick={handleRefresh}>
            обновить
          </Button>
        }
      />

      {/* Quick Stats (W4): мини-KPI блок сверху — день/неделя/оценка/доход */}
      <KpiRow cols={4} className="mb-3">
        <KpiCard label="Приёмов сегодня" value={total} trend="flat" />
        <KpiCard label="Этой недели"     value={weekApts.length} trend="up" />
        <KpiCard label="Средняя оценка"  value={doctorInfo?.avg_rating ? `★ ${Number(doctorInfo.avg_rating).toFixed(1)}` : '—'} trend="flat" />
        <KpiCard label="Доход месяца"    value={doctorInfo?.month_income != null ? `${Number(doctorInfo.month_income).toLocaleString('ru-RU')} ₽` : '—'} trend="up" />
      </KpiRow>

      {/* KPI (детальные) */}
      <KpiRow cols={4} className="mb-5">
        <KpiCard label="Запланировано" value={total} delta={`${pluralize(total, ['приём', 'приёма', 'приёмов'])}`} trend="flat" />
        <KpiCard label="Завершено" value={done} delta={done > 0 ? `+${done * 30} мин` : '—'} trend="up" />
        <KpiCard label="Отменено / неявка" value={cancelled} delta={cancelled === 0 ? 'нет' : 'учтено'} trend={cancelled === 0 ? 'flat' : 'down'} />
        <KpiCard label="Осталось приёмов" value={upcoming} delta={upcoming > 0 ? 'к выполнению' : 'всё закрыто'} trend={upcoming > 0 ? 'up' : 'flat'} />
      </KpiRow>

      {/* Двухколоночная сетка */}
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        {/* Расписание дня */}
        <Card>
          <Card.Header>
            <div>
              <Card.Title>Расписание дня</Card.Title>
              <Card.Subtitle>пациенты, статусы, длительность</Card.Subtitle>
            </div>
            <Chip variant="accent" dot>сейчас {nowTime}</Chip>
          </Card.Header>

          {loading && <Spinner />}
          {!loading && apts.length === 0 && (
            <EmptyState
              icon={<MIcon name="event_busy" size={28} />}
              title="Свободный день"
              message="На сегодня записей нет."
            />
          )}
          {!loading && apts.length > 0 && (
            <div className="flex flex-col gap-2">
              {apts.map(a => {
                const st = STATUS[a.status] || { l: a.status, v: 'default' }
                const isNow = a === next
                return (
                  <div
                    key={a.id}
                    className="grid items-center gap-3 transition-colors"
                    style={{
                      gridTemplateColumns: '70px 1fr auto',
                      padding: '12px 14px',
                      background: isNow ? 'var(--accent-soft)' : 'var(--surface)',
                      border: '1px solid ' + (isNow ? 'var(--accent-line)' : 'var(--border)'),
                      borderLeft: isNow ? '3px solid var(--accent)' : '1px solid var(--border)',
                      borderRadius: '10px',
                      opacity: a.status === 'completed' ? 0.7 : a.status === 'cancelled' ? 0.45 : 1,
                    }}
                  >
                    <div>
                      <div className="font-semibold" style={{ fontSize: 13.5, color: 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>
                        {a.appointment_time || '—'}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>{a.duration_minutes || 30} мин</div>
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold truncate" style={{ fontSize: 13.5, color: 'var(--fg)' }}>
                        {a.patient_name || '— свободно —'}
                      </div>
                      <div className="truncate" style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 2 }}>
                        {[a.service_name, a.patient_phone].filter(Boolean).join(' · ') || ''}
                      </div>
                    </div>
                    <div className="flex-shrink-0">
                      {isNow
                        ? <Chip variant="accent" dot>идёт</Chip>
                        : <Chip variant={st.v}>{st.l}</Chip>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        {/* Сводка + уведомления */}
        <div className="flex flex-col gap-4">
          <Card>
            <Card.Header>
              <Card.Title>Сводка по дню</Card.Title>
            </Card.Header>
            <div className="flex justify-center" style={{ padding: '4px 0 12px' }}>
              <svg width="120" height="120" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="50" fill="none" stroke="var(--bg-2)" strokeWidth="14" />
                <circle
                  cx="60" cy="60" r="50" fill="none"
                  stroke="var(--accent)" strokeWidth="14"
                  strokeDasharray={`${total > 0 ? (done / total) * 314 : 0} 314`}
                  transform="rotate(-90 60 60)"
                  strokeLinecap="round"
                />
                <text x="60" y="62" textAnchor="middle" fontSize="22" fontWeight="700" fill="var(--fg)">
                  {total > 0 ? Math.round((done / total) * 100) : 0}%
                </text>
                <text x="60" y="78" textAnchor="middle" fontSize="10" fill="var(--fg-3)">прогресс</text>
              </svg>
            </div>
            <div className="flex flex-col">
              <RowKV label="Приёмов сегодня" value={total} />
              <RowKV label="Закрыто" value={done} />
              <RowKV label="В работе" value={upcoming} />
              <RowKV label="Отменено" value={cancelled} />
            </div>
          </Card>

          <Card>
            <Card.Header>
              <Card.Title>Подсказки</Card.Title>
            </Card.Header>
            <div className="flex flex-col gap-2.5">
              <Hint icon="chat_bubble" title="Чат с пациентами" subtitle="связь по 152-ФЗ" />
              <Hint icon="badge" title="Профиль и отзывы" subtitle="карточка на витрине клиники" />
              <Hint icon="payments" title="К выплате" subtitle="расчётный лист 14 числа" />
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────
// SCHEDULE · уже premium (внешний компонент)
// ─────────────────────────────────────────────────────────────────────
function SchedulePage({ token, doctorId, doctorName }) {
  return (
    <WeekScheduleSection
      token={token}
      mode="self"
      selfDoctorId={doctorId}
      selfDoctorName={doctorName}
    />
  )
}

// ─────────────────────────────────────────────────────────────────────
// APPOINTMENTS · все записи
// ─────────────────────────────────────────────────────────────────────
function AppointmentsPage({ token, doctorId }) {
  const [apts, setApts] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    apiFetch('get', `/appointments?doctor_id=${doctorId}&limit=100`, token)
      .then(r => setApts(Array.isArray(r.data) ? r.data : r.data?.appointments || []))
      .catch(() => setApts([]))
      .finally(() => setLoading(false))
  }, [token, doctorId])

  const STATUS = {
    pending:   { l: 'Ожидает',     v: 'default' },
    confirmed: { l: 'Подтверждён', v: 'accent'  },
    completed: { l: 'Завершён',    v: 'good'    },
    cancelled: { l: 'Отменён',     v: 'bad'     },
    no_show:   { l: 'Не пришёл',   v: 'warn'    },
  }

  const filtered = useMemo(() => {
    if (filter === 'all') return apts
    if (filter === 'upcoming') return apts.filter(a => a.status === 'pending' || a.status === 'confirmed')
    if (filter === 'done') return apts.filter(a => a.status === 'completed')
    if (filter === 'cancelled') return apts.filter(a => a.status === 'cancelled' || a.status === 'no_show')
    return apts
  }, [apts, filter])

  const tabs = [
    { id: 'all',       label: 'Все',          badge: apts.length },
    { id: 'upcoming',  label: 'Предстоящие',  badge: apts.filter(a => a.status === 'pending' || a.status === 'confirmed').length },
    { id: 'done',      label: 'Завершённые',  badge: apts.filter(a => a.status === 'completed').length },
    { id: 'cancelled', label: 'Отменённые',   badge: apts.filter(a => a.status === 'cancelled' || a.status === 'no_show').length },
  ]

  return (
    <>
      <SectionHeader
        title="Записи"
        subtitle={`${apts.length} ${pluralize(apts.length, ['запись', 'записи', 'записей'])} в журнале`}
      />
      <div className="mb-4 overflow-x-auto -mx-4 md:mx-0 px-4 md:px-0">
        <Tabs items={tabs} value={filter} onChange={setFilter} />
      </div>

      {loading && <Spinner />}
      {!loading && filtered.length === 0 && (
        <EmptyState
          icon={<MIcon name="event_note" size={28} />}
          title="Записей не найдено"
          message="Попробуйте сменить фильтр или перейти в раздел «Расписание»."
        />
      )}
      {!loading && filtered.length > 0 && (
        <Card padded={false}>
          <div className="flex flex-col">
            {filtered.map((a, i) => {
              const st = STATUS[a.status] || { l: a.status, v: 'default' }
              return (
                <div
                  key={a.id}
                  className="flex items-center gap-3"
                  style={{
                    padding: '14px 16px',
                    borderBottom: i === filtered.length - 1 ? 'none' : '1px solid var(--line)',
                  }}
                >
                  <Avatar name={a.patient_name || '?'} size="md" />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate" style={{ fontSize: 13.5, color: 'var(--fg)' }}>
                      {a.patient_name || '—'}
                    </div>
                    <div className="truncate" style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 2 }}>
                      {[a.service_name, a.patient_phone].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 hidden sm:block">
                    <div style={{ fontSize: 12, color: 'var(--fg-2)', fontVariantNumeric: 'tabular-nums' }}>
                      {a.appointment_date}
                    </div>
                    <div className="font-semibold" style={{ fontSize: 13, color: 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>
                      {a.appointment_time}
                    </div>
                  </div>
                  <Chip variant={st.v} className="flex-shrink-0">{st.l}</Chip>
                </div>
              )
            })}
          </div>
        </Card>
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────
// REFERRALS
// ─────────────────────────────────────────────────────────────────────
function ReferralsPage({ token }) {
  const [refs, setRefs] = useState([])
  const [loading, setLoading] = useState(true)
  const { toast } = useToast()

  useEffect(() => {
    apiFetch('get', '/manager/referrals/?limit=50', token)
      .then(r => setRefs(Array.isArray(r.data) ? r.data : r.data?.referrals || []))
      .catch(() => setRefs([]))
      .finally(() => setLoading(false))
  }, [token])

  const STATUS = {
    created:          { l: 'Активно',  v: 'accent'  },
    confirmed:        { l: 'Выполнено',v: 'good'    },
    expired:          { l: 'Истекло',  v: 'default' },
    cancelled:        { l: 'Отменено', v: 'bad'     },
    cancel_requested: { l: 'На отмене',v: 'warn'    },
  }

  const visible = refs.slice(0, 50)

  return (
    <>
      <SectionHeader
        title="Направления"
        subtitle={`${refs.length} ${pluralize(refs.length, ['направление', 'направления', 'направлений'])} в журнале`}
        actions={
          // TODO: открывать <Modal> с формой создания направления (Этап 5+)
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<MIcon name="add" size={15} />}
            onClick={() => toast('Создание направлений — в разработке', 'info', 3000)}
          >
            новое направление
          </Button>
        }
      />

      {loading && <Spinner />}
      {!loading && refs.length === 0 && (
        <EmptyState
          icon={<MIcon name="assignment" size={28} />}
          title="Направлений нет"
          message="Здесь появятся направления, выписанные коллегам по сети."
        />
      )}
      {!loading && refs.length > 0 && (
        <Card padded={false}>
          <div className="flex flex-col">
            {visible.map((r, i) => {
              const st = STATUS[r.status] || { l: r.status, v: 'default' }
              return (
                <div
                  key={r.id}
                  className="flex items-center gap-3"
                  style={{
                    padding: '14px 16px',
                    borderBottom: i === visible.length - 1 ? 'none' : '1px solid var(--line)',
                  }}
                >
                  <span
                    className="grid place-items-center flex-shrink-0"
                    style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--accent-soft)', color: 'var(--accent)' }}
                  >
                    <MIcon name="assignment" size={18} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate" style={{ fontSize: 13.5, color: 'var(--fg)' }}>
                      {r.patient_name}
                    </div>
                    <div className="truncate" style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 2 }}>
                      {[r.service_name, r.to_clinic_name].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 hidden sm:block">
                    <div style={{ fontSize: 11.5, color: 'var(--fg-3)', fontVariantNumeric: 'tabular-nums' }}>
                      {r.created_at ? new Date(r.created_at).toLocaleDateString('ru') : ''}
                    </div>
                  </div>
                  <Chip variant={st.v} className="flex-shrink-0">{st.l}</Chip>
                </div>
              )
            })}
          </div>
        </Card>
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────
// PATIENTS · мои пациенты (визуальный каркас на основе истории приёмов)
// ─────────────────────────────────────────────────────────────────────
function PatientsPage({ token, doctorId }) {
  const [apts, setApts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!doctorId) { setLoading(false); return }
    apiFetch('get', `/appointments?doctor_id=${doctorId}&limit=200`, token)
      .then(r => setApts(Array.isArray(r.data) ? r.data : r.data?.appointments || []))
      .catch(() => setApts([]))
      .finally(() => setLoading(false))
  }, [token, doctorId])

  // Группировка по пациенту (по телефону или имени)
  const patients = useMemo(() => {
    const map = new Map()
    for (const a of apts) {
      const key = a.patient_phone || a.patient_name || `id-${a.id}`
      if (!map.has(key)) {
        map.set(key, {
          name: a.patient_name || '—',
          phone: a.patient_phone || '',
          visits: 0,
          last: a.appointment_date || '',
        })
      }
      const p = map.get(key)
      p.visits += 1
      if (a.appointment_date && (!p.last || a.appointment_date > p.last)) p.last = a.appointment_date
    }
    return Array.from(map.values()).sort((a, b) => (b.last || '').localeCompare(a.last || ''))
  }, [apts])

  return (
    <>
      <SectionHeader
        title="Мои пациенты"
        subtitle={`${patients.length} ${pluralize(patients.length, ['пациент', 'пациента', 'пациентов'])} в наблюдении`}
      />

      {loading && <Spinner />}
      {!loading && patients.length === 0 && (
        <EmptyState
          icon={<MIcon name="group" size={28} />}
          title="Пациенты пока не появлялись"
          message="После проведённых приёмов они появятся здесь автоматически."
        />
      )}
      {!loading && patients.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {patients.slice(0, 60).map((p, i) => (
            <Card key={i}>
              <div className="flex items-center gap-3 mb-3">
                <Avatar name={p.name} size="lg" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate" style={{ fontSize: 14, color: 'var(--fg)' }}>{p.name}</div>
                  <div className="truncate" style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 2 }}>
                    {p.phone || '—'}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between" style={{ padding: '8px 0', borderTop: '1px solid var(--line)' }}>
                <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>Визитов</span>
                <b style={{ fontSize: 13, color: 'var(--fg)' }}>{p.visits}</b>
              </div>
              <div className="flex items-center justify-between" style={{ padding: '8px 0', borderTop: '1px solid var(--line)' }}>
                <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>Последний</span>
                <b style={{ fontSize: 13, color: 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>{p.last || '—'}</b>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────
// EARNINGS · заработок (визуальный каркас, данные-плейсхолдер)
// ─────────────────────────────────────────────────────────────────────
function EarningsPage() {
  const months = [218000, 245000, 268000, 298000, 312000]
  return (
    <>
      <SectionHeader
        title="Заработок и KPI"
        subtitle="Расчёт по приёмам и бонусам · функция в разработке"
        actions={<Chip variant="warn">скоро</Chip>}
      />

      <KpiRow cols={4} className="mb-5">
        <KpiCard label="К выплате" value="—" delta="14 числа" trend="flat" />
        <KpiCard label="Средний чек" value="—" delta="" trend="flat" />
        <KpiCard label="Приёмов в месяце" value="—" delta="" trend="flat" />
        <KpiCard label="Бонус по KPI" value="—" delta="за NPS" trend="flat" />
      </KpiRow>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <Card.Header>
            <div>
              <Card.Title>Динамика по месяцам</Card.Title>
              <Card.Subtitle>пример визуала · реальные данные подключаются</Card.Subtitle>
            </div>
          </Card.Header>
          <div className="flex justify-center" style={{ padding: '8px 0' }}>
            <Sparkline data={months} width={460} height={120} strokeWidth={2.4} />
          </div>
          <div className="grid grid-cols-5 gap-1 mt-2">
            {['Янв', 'Фев', 'Мар', 'Апр', 'Май'].map(m => (
              <div key={m} className="text-center" style={{ fontSize: 11, color: 'var(--fg-3)' }}>{m}</div>
            ))}
          </div>
        </Card>
        <Card>
          <Card.Header>
            <Card.Title>Структура дохода</Card.Title>
          </Card.Header>
          <EmptyState
            icon={<MIcon name="payments" size={28} />}
            title="Подключение в разработке"
            message="Скоро здесь появится разбивка: очные приёмы, видео, бонусы, доплата за стаж."
          />
        </Card>
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────
// RATING
// ─────────────────────────────────────────────────────────────────────
function RatingPage() {
  return (
    <>
      <SectionHeader
        title="Рейтинг и отзывы"
        subtitle="Оценки пациентов и NPS · функция в разработке"
        actions={<Chip variant="warn">скоро</Chip>}
      />

      <KpiRow cols={4} className="mb-5">
        <KpiCard label="Средняя оценка" value="—" delta="по 5★" trend="flat" />
        <KpiCard label="NPS" value="—" delta="" trend="flat" />
        <KpiCard label="Отзывов за месяц" value="—" delta="" trend="flat" />
        <KpiCard label="Время ответа в чате" value="—" delta="мин" trend="flat" />
      </KpiRow>

      <Card>
        <Card.Header>
          <Card.Title>Отзывы пациентов</Card.Title>
        </Card.Header>
        <EmptyState
          icon={<MIcon name="reviews" size={28} />}
          title="Раздел в разработке"
          message="Здесь появятся отзывы, распределение оценок и темы благодарностей."
        />
      </Card>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────
// TIME · отпуск, замены
// ─────────────────────────────────────────────────────────────────────
function TimePage() {
  return (
    <>
      <SectionHeader
        title="Время и отпуск"
        subtitle="Заявки, замены, сверхурочные · функция в разработке"
        actions={<Chip variant="warn">скоро</Chip>}
      />

      <KpiRow cols={4} className="mb-5">
        <KpiCard label="Отработано в месяце" value="—" delta="ч" trend="flat" />
        <KpiCard label="Отпуск в году" value="—" delta="дней" trend="flat" />
        <KpiCard label="Сверхурочные" value="—" delta="ч" trend="flat" />
        <KpiCard label="Активных заявок" value="—" delta="" trend="flat" />
      </KpiRow>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <Card.Header>
            <Card.Title>Заявки и согласования</Card.Title>
          </Card.Header>
          <EmptyState
            icon={<MIcon name="event_available" size={28} />}
            title="Заявки появятся здесь"
            message="Отпуск, больничные, замены и согласования."
          />
        </Card>
        <Card>
          <Card.Header>
            <Card.Title>График по дням недели</Card.Title>
          </Card.Header>
          <EmptyState
            icon={<MIcon name="schedule" size={28} />}
            title="Постоянный график"
            message="Будет показываться план рабочих часов на каждый день."
          />
        </Card>
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────
// CHAT
// ─────────────────────────────────────────────────────────────────────
function ChatPage() {
  return (
    <>
      <SectionHeader
        title="Чат с пациентами"
        subtitle="Защищённый канал по 152-ФЗ · функция в разработке"
        actions={<Chip variant="warn">скоро</Chip>}
      />
      <Card>
        <EmptyState
          icon={<MIcon name="chat_bubble" size={28} />}
          title="Чат будет здесь"
          message="Сообщения от пациентов, уточнение терапии, поддержка по 152-ФЗ."
        />
      </Card>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────
// NavItem — один пункт боковой навигации
// minHeight 44px — соблюдаем mobile tap target (WCAG 2.5.5)
// ─────────────────────────────────────────────────────────────────────
function NavItem({ item, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2.5 transition-colors w-full"
      style={{
        padding: '10px 10px',
        minHeight: 44,
        borderRadius: 8,
        fontSize: 13,
        textAlign: 'left',
        background: active ? 'var(--accent-soft)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--fg-2)',
        fontWeight: active ? 600 : 500,
      }}
    >
      <MIcon name={item.icon} size={16} fill={active} />
      <span>{item.label}</span>
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────
// КОРНЕВОЙ КОМПОНЕНТ
// ─────────────────────────────────────────────────────────────────────
export default function DoctorLayout({ adminToken, user, onLogout }) {
  const [route, setRoute] = useState('today')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [doctorInfo, setDoctorInfo] = useState(null)
  // Единый переключатель темы (синхронизация с другими кабинетами)
  const { isDark, toggle: toggleTheme } = useTheme()

  useEffect(() => {
    apiFetch('get', '/my-doctor', adminToken).then(r => setDoctorInfo(r.data)).catch(() => {})
  }, [adminToken])

  const doctorId = doctorInfo?.id
  const userName = user?.full_name || 'Врач'
  const todayStr = formatTodayRu()
  const activeNav = NAV.find(n => n.id === route) || NAV[0]

  // Защита: если кабинет не привязан, доступны только некоторые секции
  const needBinding = !doctorId
  const allowedWithoutBinding = new Set(['referrals', 'earnings', 'rating', 'time', 'chat'])

  const renderRoute = () => {
    if (needBinding && !allowedWithoutBinding.has(route)) {
      return (
        <Card>
          <EmptyState
            icon={<MIcon name="link_off" size={28} />}
            title="Кабинет не привязан"
            message="Привяжите учётную запись врача через администратора клиники, чтобы получить доступ к расписанию и приёмам."
          />
        </Card>
      )
    }

    switch (route) {
      case 'today':        return <TodayPage token={adminToken} doctorId={doctorId} doctorInfo={doctorInfo} />
      case 'schedule':     return <SchedulePage token={adminToken} doctorId={doctorId} doctorName={doctorInfo?.full_name || userName} />
      case 'appointments': return <AppointmentsPage token={adminToken} doctorId={doctorId} />
      case 'referrals':    return <ReferralsPage token={adminToken} />
      case 'patients':     return <PatientsPage token={adminToken} doctorId={doctorId} />
      case 'earnings':     return <EarningsPage />
      case 'rating':       return <RatingPage />
      case 'time':         return <TimePage />
      case 'chat':         return <ChatPage />
      default:             return null
    }
  }

  // Группировка sidebar
  const navWork = NAV.filter(n => n.group === 'work')
  const navCabinet = NAV.filter(n => n.group === 'cabinet')

  return (
    <Page>
      <div className="grid min-h-screen" style={{ gridTemplateColumns: 'auto 1fr' }}>

        {/* SIDEBAR DESKTOP */}
        <aside
          className="hidden md:flex flex-col sticky top-0 h-screen"
          style={{
            width: 240,
            background: 'var(--bg-1)',
            borderRight: '1px solid var(--border)',
            padding: '18px 12px',
          }}
        >
          {/* Бренд */}
          <div className="flex items-center gap-2.5" style={{ padding: '4px 10px 14px' }}>
            <span
              className="grid place-items-center font-bold"
              style={{
                width: 32, height: 32, borderRadius: 9,
                background: 'linear-gradient(140deg, var(--accent), var(--accent-2))',
                color: '#fff', fontSize: 14,
                boxShadow: '0 4px 12px var(--accent-soft)',
              }}
            >
              ✚
            </span>
            <div className="flex-1 min-w-0">
              <div className="font-semibold truncate" style={{ fontSize: 14, color: 'var(--fg)', letterSpacing: '-0.01em' }}>
                КлиникСеть
              </div>
              <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>кабинет врача</div>
            </div>
          </div>

          {/* Профиль */}
          <div
            className="flex items-center gap-3"
            style={{
              padding: 12,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              marginBottom: 6,
            }}
          >
            <Avatar name={userName} size="md" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold truncate" style={{ fontSize: 12.5, color: 'var(--fg)' }}>{userName}</div>
              <div className="truncate" style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                {doctorInfo?.specialty || 'врач'}
              </div>
            </div>
          </div>

          {/* Навигация */}
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', color: 'var(--fg-4)', textTransform: 'uppercase', padding: '12px 10px 4px' }}>
            Работа
          </div>
          <nav className="flex flex-col gap-0.5">
            {navWork.map(n => <NavItem key={n.id} item={n} active={route === n.id} onClick={() => setRoute(n.id)} />)}
          </nav>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', color: 'var(--fg-4)', textTransform: 'uppercase', padding: '12px 10px 4px' }}>
            Кабинет
          </div>
          <nav className="flex flex-col gap-0.5">
            {navCabinet.map(n => <NavItem key={n.id} item={n} active={route === n.id} onClick={() => setRoute(n.id)} />)}
          </nav>

          {/* Footer: дата + выход */}
          <div className="mt-auto" style={{ paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <div className="flex items-center gap-2" style={{ padding: '6px 10px', fontSize: 11, color: 'var(--fg-3)' }}>
              <MIcon name="event" size={14} />
              <span style={{ textTransform: 'capitalize' }}>{todayStr}</span>
            </div>
            <button
              onClick={onLogout}
              className="w-full flex items-center gap-2.5 transition-colors hover:opacity-80"
              style={{
                padding: '10px 10px',
                minHeight: 44,
                borderRadius: 8,
                fontSize: 12.5,
                color: 'var(--fg-3)',
                background: 'transparent',
              }}
            >
              <MIcon name="logout" size={15} />
              Выйти
            </button>
          </div>
        </aside>

        {/* MAIN */}
        <div className="flex flex-col min-w-0">

          {/* MOBILE HEADER */}
          <header
            className="md:hidden sticky top-0 flex items-center gap-3"
            style={{
              padding: '12px 16px',
              background: 'oklch(1 0 0 / 0.92)',
              borderBottom: '1px solid var(--border)',
              backdropFilter: 'blur(12px)',
              zIndex: 30,
            }}
          >
            <button
              onClick={() => setSidebarOpen(true)}
              aria-label="Открыть меню"
              className="grid place-items-center flex-shrink-0"
              style={{
                width: 44, height: 44, borderRadius: 10,
                background: 'var(--bg-1)', border: '1px solid var(--border)', color: 'var(--fg-2)',
              }}
            >
              <MIcon name="menu" size={20} />
            </button>
            <div className="flex-1 min-w-0">
              <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', color: 'var(--accent)', textTransform: 'uppercase' }}>
                {doctorInfo?.specialty || 'кабинет врача'}
              </div>
              <div className="font-semibold truncate" style={{ fontSize: 15, color: 'var(--fg)' }}>
                {activeNav.label}
              </div>
            </div>
            {/* Переключатель темы (mobile) */}
            <button
              onClick={toggleTheme}
              aria-label="Тема"
              title={isDark ? 'Светлая тема' : 'Тёмная тема'}
              className="grid place-items-center flex-shrink-0"
              style={{
                width: 40, height: 40, borderRadius: 10,
                background: 'var(--bg-1)', border: '1px solid var(--border)',
                color: 'var(--fg-2)', cursor: 'pointer',
              }}
            >
              <MIcon name={isDark ? 'light_mode' : 'dark_mode'} size={18} />
            </button>
            <Avatar name={userName} size="md" />
          </header>

          {/* DESKTOP TOPBAR */}
          <header
            className="hidden md:flex items-center gap-3 sticky top-0"
            style={{
              padding: '12px 24px',
              background: 'oklch(1 0 0 / 0.85)',
              borderBottom: '1px solid var(--border)',
              backdropFilter: 'blur(20px)',
              zIndex: 10,
            }}
          >
            <div className="flex-1 min-w-0">
              <div style={{ fontSize: 11, color: 'var(--fg-3)', textTransform: 'capitalize' }}>{todayStr}</div>
              <div className="font-semibold" style={{ fontSize: 16, color: 'var(--fg)', letterSpacing: '-0.01em' }}>
                {activeNav.label}
              </div>
            </div>
            <Chip variant="default" dot>{userName}</Chip>
            {/* W3: центр уведомлений (общий dropdown) */}
            <NotificationsBell size={36} variant="square" />
            {/* Переключатель темы — единый хук useTheme */}
            <button
              onClick={toggleTheme}
              aria-label="Тема"
              title={isDark ? 'Светлая тема' : 'Тёмная тема'}
              className="grid place-items-center"
              style={{
                width: 36, height: 36, borderRadius: 10,
                background: 'var(--bg-1)', border: '1px solid var(--border)',
                color: 'var(--fg-2)', cursor: 'pointer',
              }}
            >
              <MIcon name={isDark ? 'light_mode' : 'dark_mode'} size={18} />
            </button>
            <Button variant="secondary" size="sm" onClick={onLogout} leftIcon={<MIcon name="logout" size={14} />}>
              Выйти
            </Button>
          </header>

          {/* CONTENT */}
          <div
            className="flex-1"
            style={{
              padding: '20px 16px 96px',
              overflowX: 'hidden',
            }}
          >
            <div className="max-w-7xl mx-auto md:px-2">
              {renderRoute()}
            </div>
          </div>
        </div>
      </div>

      {/* MOBILE SIDEBAR DRAWER */}
      {sidebarOpen && (
        <>
          <div
            className="md:hidden fixed inset-0"
            style={{ background: 'rgba(0,0,0,0.3)', zIndex: 50 }}
            onClick={() => setSidebarOpen(false)}
          />
          <aside
            className="md:hidden fixed top-0 left-0 h-full flex flex-col"
            style={{
              width: 280, background: 'var(--bg-1)', zIndex: 60,
              padding: '18px 12px', borderRight: '1px solid var(--border)',
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            <div className="flex items-center justify-between mb-3" style={{ padding: '0 6px' }}>
              <div className="flex items-center gap-2.5">
                <span
                  className="grid place-items-center font-bold"
                  style={{
                    width: 32, height: 32, borderRadius: 9,
                    background: 'linear-gradient(140deg, var(--accent), var(--accent-2))',
                    color: '#fff', fontSize: 14,
                  }}
                >✚</span>
                <div>
                  <div className="font-semibold" style={{ fontSize: 14, color: 'var(--fg)' }}>КлиникСеть</div>
                  <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>кабинет врача</div>
                </div>
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                aria-label="Закрыть меню"
                className="grid place-items-center flex-shrink-0"
                style={{ width: 44, height: 44, borderRadius: 10, color: 'var(--fg-3)' }}
              >
                <MIcon name="close" size={20} />
              </button>
            </div>

            {/* Профиль */}
            <div
              className="flex items-center gap-3"
              style={{
                padding: 12, background: 'var(--surface)',
                border: '1px solid var(--border)', borderRadius: 10, marginBottom: 6,
              }}
            >
              <Avatar name={userName} size="md" />
              <div className="min-w-0 flex-1">
                <div className="font-semibold truncate" style={{ fontSize: 13, color: 'var(--fg)' }}>{userName}</div>
                <div className="truncate" style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                  {doctorInfo?.specialty || 'врач'}
                </div>
              </div>
            </div>

            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', color: 'var(--fg-4)', textTransform: 'uppercase', padding: '12px 10px 4px' }}>
              Работа
            </div>
            <nav className="flex flex-col gap-0.5">
              {navWork.map(n => (
                <NavItem key={n.id} item={n} active={route === n.id} onClick={() => { setRoute(n.id); setSidebarOpen(false) }} />
              ))}
            </nav>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', color: 'var(--fg-4)', textTransform: 'uppercase', padding: '12px 10px 4px' }}>
              Кабинет
            </div>
            <nav className="flex flex-col gap-0.5">
              {navCabinet.map(n => (
                <NavItem key={n.id} item={n} active={route === n.id} onClick={() => { setRoute(n.id); setSidebarOpen(false) }} />
              ))}
            </nav>

            <div className="mt-auto" style={{ paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              <button
                onClick={onLogout}
                className="w-full flex items-center gap-2.5"
                style={{
                  padding: '12px 12px',
                  minHeight: 48,
                  borderRadius: 9,
                  fontSize: 13, color: 'var(--fg-2)', background: 'var(--bg-2)',
                }}
              >
                <MIcon name="logout" size={16} />
                Выйти
              </button>
            </div>
          </aside>
        </>
      )}

      {/* MOBILE BOTTOM NAV */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 flex"
        style={{
          background: 'oklch(1 0 0 / 0.95)',
          borderTop: '1px solid var(--border)',
          backdropFilter: 'blur(20px)',
          paddingBottom: 'env(safe-area-inset-bottom)',
          boxShadow: '0 -8px 32px oklch(0.18 0.014 220 / 0.08)',
          zIndex: 40,
        }}
      >
        {MOBILE_NAV.map(id => {
          const n = NAV.find(x => x.id === id)
          if (!n) return null
          const active = route === n.id
          return (
            <button
              key={n.id}
              onClick={() => setRoute(n.id)}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 relative"
              style={{ padding: '10px 0', minHeight: 56 }}
            >
              {active && (
                <span
                  className="absolute top-0 left-1/2 -translate-x-1/2"
                  style={{ width: 32, height: 2, borderRadius: 999, background: 'var(--accent)' }}
                />
              )}
              <MIcon
                name={n.icon}
                size={22}
                fill={active}
                color={active ? 'var(--accent)' : 'var(--fg-3)'}
              />
              <span
                className="font-semibold"
                style={{ fontSize: 10, color: active ? 'var(--accent)' : 'var(--fg-3)', lineHeight: 1 }}
              >
                {n.label}
              </span>
            </button>
          )
        })}
      </nav>
      {/* W3: глобальный поиск Cmd+K — слушает hotkey на window */}
      <CommandPalette />
    </Page>
  )
}
