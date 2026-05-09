/**
 * ========================================
 * БЛОК: CrossClinicDirectorySection — справочник сотрудников всех клиник сети
 * ========================================
 * Назначение:
 *   Регистратор/менеджер клиники A видит сотрудников всех связанных клиник
 *   (один tenant у managers / одна франшиза у franchise_owner) и может
 *   позвонить любому из них прямо из справочника.
 *
 * API:
 *   GET /calls/directory?role&search → { clinics: [...], users: [...] }
 *
 * Запуск звонка:
 *   dispatchEvent(new CustomEvent('clinika:start-call', {
 *     detail: { user_id, full_name, call_type }
 *   }))
 *   — обрабатывается в CallWidget.jsx (слушатель добавлен).
 *
 * Группировка: по клинике (с tenant_name + статус контракта если cross-tenant).
 * Фильтры: роль, поиск по ФИО, активная клиника, режим звонка (audio/video).
 * ========================================
 */
import { useEffect, useMemo, useState } from 'react'
import api from '../api'
import {
  Card, Button, Chip, EmptyState, useToast, InfoHint,
} from '../design'

// ── Локальный icon helper ───────────────────────────────────────────────────
function Icon({ name, size = 18, fill = 0, style = {} }) {
  return (
    <span
      className="material-symbols-outlined"
      style={{
        fontSize: size,
        fontVariationSettings: `'FILL' ${fill}, 'wght' 500, 'opsz' 24`,
        lineHeight: 1,
        display: 'inline-flex',
        ...style,
      }}
    >{name}</span>
  )
}

const ROLE_LABEL = {
  super_admin:     'Платформа',
  franchise_owner: 'Владелец франшизы',
  manager:         'Управляющий',
  reg:             'Регистратор',
  nurse:           'Медсестра',
  doctor:          'Врач',
  recruiter:       'Рекрутер',
  partner_doctor:  'Партнёрский врач',
  visiting_doctor: 'Приходящий врач',
}

const ROLE_TONE = {
  manager:         'accent',
  franchise_owner: 'warn',
  doctor:          'good',
  reg:             'default',
  nurse:           'default',
  recruiter:       'default',
}

const ROLE_FILTER_OPTIONS = [
  { value: '',          label: 'Все роли' },
  { value: 'manager',   label: 'Управляющие' },
  { value: 'reg',       label: 'Регистраторы' },
  { value: 'doctor',    label: 'Врачи' },
  { value: 'nurse',     label: 'Медсёстры' },
  { value: 'recruiter', label: 'Рекрутеры' },
  { value: 'franchise_owner', label: 'Владельцы франшизы' },
]

const HINT = (
  <div style={{ fontSize: 13, lineHeight: 1.5 }}>
    <b>Сотрудники сети</b> — единый справочник всех управляющих, врачей,
    регистраторов и медсестёр клиник, входящих в ваш тенант или франшизу.
    <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
      <li><b>Позвонить</b> — запускает WebRTC-звонок через виджет звонков
      (требует подключённый модуль телефонии).</li>
      <li>Метка <b>«Из другой клиники»</b> показывает, что собеседник
      работает в другом филиале сети.</li>
      <li>Доступность аудио/видео определяется правилами раздела «Звонки».</li>
    </ul>
  </div>
)

export default function CrossClinicDirectorySection({ adminToken }) {
  const { toast } = useToast()
  const [data, setData]         = useState({ clinics: [], users: [] })
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [role, setRole]         = useState('')
  const [clinicId, setClinicId] = useState('')
  const [callType, setCallType] = useState('audio')
  const [callCaps, setCallCaps] = useState({ audio: false, video: false, enabled: false })

  // Загрузка возможностей звонков (audio/video) — для UX (показываем,
  // что не подключено, и блокируем кнопку).
  useEffect(() => {
    api.get('/presence/can-call').then(r => setCallCaps(r.data || {})).catch(() => {})
  }, [])

  const reload = async () => {
    setLoading(true)
    try {
      const params = {}
      if (role) params.role = role
      if (search.trim()) params.search = search.trim()
      const r = await api.get('/calls/directory', { params })
      setData(r.data || { clinics: [], users: [] })
    } catch (e) {
      toast?.('Не удалось загрузить справочник: ' + (e?.response?.data?.detail || e.message), 'error')
      setData({ clinics: [], users: [] })
    } finally {
      setLoading(false)
    }
  }

  // Перезагрузка при смене роль/поиск (с дебаунсом для поиска)
  useEffect(() => {
    const t = setTimeout(reload, search ? 350 : 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, search])

  // ── Группировка по клиникам ─────────────────────────────────────────────
  const grouped = useMemo(() => {
    const byClinic = new Map()
    // Сначала клиники без сотрудников — чтобы не пропадали из UI
    for (const c of data.clinics || []) {
      byClinic.set(c.id, { clinic: c, users: [] })
    }
    // «Без клиники» — отдельная виртуальная группа
    const NO_CLINIC = '__no_clinic__'
    byClinic.set(NO_CLINIC, {
      clinic: { id: NO_CLINIC, name: 'Без клиники (центр)', tenant_name: '', contract_type: null },
      users: [],
    })

    for (const u of data.users || []) {
      const cid = u.clinic_id || NO_CLINIC
      if (!byClinic.has(cid)) {
        // На всякий: пользователь без клиники в clinics list — кладём в NO_CLINIC
        byClinic.get(NO_CLINIC).users.push(u)
      } else {
        byClinic.get(cid).users.push(u)
      }
    }

    // Применяем фильтр по клинике (если задан)
    let groups = Array.from(byClinic.values()).filter(g => g.users.length > 0)
    if (clinicId) groups = groups.filter(g => g.clinic.id === clinicId)
    return groups
  }, [data, clinicId])

  // ── Действие: позвонить ─────────────────────────────────────────────────
  const callUser = (u) => {
    if (callType === 'video' && !callCaps.video) {
      toast?.('Видеозвонки не подключены — обратитесь к администратору', 'error')
      return
    }
    if (callType === 'audio' && !callCaps.audio) {
      toast?.('Аудиозвонки не подключены — обратитесь к администратору', 'error')
      return
    }
    // Бросаем событие — CallWidget слушает clinika:start-call и инициирует
    // звонок (он же проверит call rules через WS-сигналинг).
    window.dispatchEvent(new CustomEvent('clinika:start-call', {
      detail: {
        user_id: u.user_id,
        full_name: u.full_name,
        call_type: callType,
      },
    }))
    toast?.(`Вызов: ${u.full_name}`, 'info')
  }

  // ── Render ──────────────────────────────────────────────────────────────
  const totalUsers = (data.users || []).length

  return (
    <div className="flex flex-col gap-4">
      {/* ─── Заголовок + InfoHint ─── */}
      <div className="flex items-center gap-2 flex-wrap">
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--fg)' }}>Сотрудники сети</div>
        <InfoHint>{HINT}</InfoHint>
        <div className="flex-1" />
        <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>
          Найдено: <b style={{ color: 'var(--fg)' }}>{totalUsers}</b>
        </div>
        <Button variant="ghost" leftIcon={<Icon name="refresh" size={16} />} onClick={reload}>
          Обновить
        </Button>
      </div>

      {/* ─── Предупреждение, если телефония не подключена ─── */}
      {!callCaps.enabled && (
        <Card>
          <div style={{ padding: 12, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <Icon name="warning" size={20} style={{ color: 'var(--warn)' }} />
            <div style={{ fontSize: 13, color: 'var(--fg-2)', lineHeight: 1.5 }}>
              <b>Модули звонков не подключены к вашему тенанту.</b>{' '}
              Справочник доступен в режиме просмотра, но кнопка «Позвонить» работать не будет.
              Подключите модуль <b>«Базовая телефония»</b>, <b>«Аудио между клиниками»</b>{' '}
              или <b>«Видеозвонки»</b> в разделе «Модули».
            </div>
          </div>
        </Card>
      )}

      {/* ─── Фильтры ─── */}
      <Card>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            padding: 4,
          }}
        >
          {/* Поиск */}
          <div style={{ flex: '1 1 220px', minWidth: 200 }}>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по ФИО…"
              style={{
                width: '100%', padding: '8px 12px',
                background: 'var(--bg-1)', color: 'var(--fg)',
                border: '1px solid var(--border)', borderRadius: 8, fontSize: 13,
              }}
            />
          </div>
          {/* Роль */}
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            style={{
              padding: '8px 12px',
              background: 'var(--bg-1)', color: 'var(--fg)',
              border: '1px solid var(--border)', borderRadius: 8, fontSize: 13,
            }}
          >
            {ROLE_FILTER_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {/* Клиника */}
          {(data.clinics || []).length > 0 && (
            <select
              value={clinicId}
              onChange={(e) => setClinicId(e.target.value)}
              style={{
                padding: '8px 12px',
                background: 'var(--bg-1)', color: 'var(--fg)',
                border: '1px solid var(--border)', borderRadius: 8, fontSize: 13,
              }}
            >
              <option value="">Все клиники</option>
              {data.clinics.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.is_self_clinic ? ' (моя)' : ''}
                </option>
              ))}
            </select>
          )}
          {/* Режим звонка */}
          <div
            style={{
              display: 'inline-flex', borderRadius: 8, overflow: 'hidden',
              border: '1px solid var(--border)',
            }}
          >
            <button
              onClick={() => setCallType('audio')}
              disabled={!callCaps.audio}
              title={callCaps.audio ? 'Аудиозвонок' : 'Аудио не подключено'}
              style={{
                padding: '6px 12px', fontSize: 13, cursor: callCaps.audio ? 'pointer' : 'not-allowed',
                background: callType === 'audio' ? 'var(--accent)' : 'var(--bg-1)',
                color: callType === 'audio' ? '#fff' : 'var(--fg-2)',
                border: 'none', display: 'inline-flex', alignItems: 'center', gap: 6,
                opacity: callCaps.audio ? 1 : 0.5,
              }}
            >
              <Icon name="call" size={14} /> Аудио
            </button>
            <button
              onClick={() => setCallType('video')}
              disabled={!callCaps.video}
              title={callCaps.video ? 'Видеозвонок' : 'Видео не подключено'}
              style={{
                padding: '6px 12px', fontSize: 13, cursor: callCaps.video ? 'pointer' : 'not-allowed',
                background: callType === 'video' ? 'var(--accent)' : 'var(--bg-1)',
                color: callType === 'video' ? '#fff' : 'var(--fg-2)',
                border: 'none', display: 'inline-flex', alignItems: 'center', gap: 6,
                opacity: callCaps.video ? 1 : 0.5,
              }}
            >
              <Icon name="videocam" size={14} /> Видео
            </button>
          </div>
        </div>
      </Card>

      {/* ─── Тело: список групп по клиникам ─── */}
      {loading ? (
        <Card>
          <div style={{ padding: 24, color: 'var(--fg-3)' }}>Загрузка…</div>
        </Card>
      ) : grouped.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Icon name="group_off" size={28} />}
            title="Никого не нашли"
            message="Попробуйте сбросить фильтры или подключите ещё клиники к франшизе."
          />
        </Card>
      ) : (
        grouped.map(group => (
          <ClinicGroup
            key={group.clinic.id}
            clinic={group.clinic}
            users={group.users}
            onCall={callUser}
            callsEnabled={callCaps.enabled}
          />
        ))
      )}
    </div>
  )
}

// ── Карточка-группа: одна клиника + её сотрудники ───────────────────────────
function ClinicGroup({ clinic, users, onCall, callsEnabled }) {
  const contractTone = clinic.contract_type
    ? (clinic.contract_type === 'royalty' ? 'accent'
       : clinic.contract_type === 'per_referral' ? 'good' : 'warn')
    : null
  const contractText = clinic.contract_type === 'royalty' ? '% с выручки'
    : clinic.contract_type === 'per_referral' ? '₽ за направление'
    : clinic.contract_type === 'hybrid' ? 'Гибрид % + ₽'
    : null

  return (
    <Card padded={false}>
      {/* Шапка клиники */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          background: 'var(--bg-1)',
        }}
      >
        <Icon name="local_hospital" size={18} style={{ color: 'var(--accent)' }} />
        <div style={{ fontWeight: 700, color: 'var(--fg)', fontSize: 14 }}>{clinic.name}</div>
        {clinic.is_self_clinic && <Chip variant="accent">Моя клиника</Chip>}
        {clinic.tenant_name && (
          <span style={{ fontSize: 12, color: 'var(--fg-4)' }}>· {clinic.tenant_name}</span>
        )}
        {contractText && <Chip variant={contractTone}>{contractText}</Chip>}
        {clinic.partner_status && clinic.partner_status !== 'active' && (
          <Chip variant={clinic.partner_status === 'paused' ? 'warn' : 'bad'}>
            {clinic.partner_status === 'paused' ? 'На паузе' : 'Расторгнут'}
          </Chip>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>{users.length} чел.</span>
      </div>

      {/* Таблица сотрудников */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--fg-3)' }}>
              <th style={{ textAlign: 'left',  padding: '10px 16px', fontWeight: 600 }}>Сотрудник</th>
              <th style={{ textAlign: 'left',  padding: '10px 16px', fontWeight: 600 }}>Роль</th>
              <th style={{ textAlign: 'left',  padding: '10px 16px', fontWeight: 600 }}>Телефон</th>
              <th style={{ textAlign: 'right', padding: '10px 16px', fontWeight: 600 }}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => {
              const tone = ROLE_TONE[u.role] || 'default'
              return (
                <tr key={u.user_id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 16px' }}>
                    <div style={{ fontWeight: 600, color: 'var(--fg)' }}>{u.full_name}</div>
                    {(u.is_cross_tenant || u.is_cross_clinic) && (
                      <div style={{ fontSize: 11, color: 'var(--fg-4)', marginTop: 2 }}>
                        {u.is_cross_tenant ? 'Из другой клиники сети' : 'Из другой клиники'}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '10px 16px' }}>
                    <Chip variant={tone}>{ROLE_LABEL[u.role] || u.role}</Chip>
                  </td>
                  <td style={{ padding: '10px 16px', color: 'var(--fg-3)', fontVariantNumeric: 'tabular-nums' }}>
                    {u.phone || '—'}
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                    <Button
                      variant="primary"
                      size="sm"
                      leftIcon={<Icon name="call" size={14} />}
                      onClick={() => onCall(u)}
                      disabled={!callsEnabled}
                      title={callsEnabled ? 'Позвонить' : 'Звонки не подключены'}
                    >
                      Позвонить
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
