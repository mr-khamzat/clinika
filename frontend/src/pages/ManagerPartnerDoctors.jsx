/**
 * ========================================
 * БЛОК: ManagerPartnerDoctors — врачи-партнёры сети
 * ========================================
 * Раздел в кабинете руководителя: видны
 *   1) Заявки на привлечение (DoctorRequest, статусы pending/approved/rejected)
 *      — рекрутер подал заявку, manager утверждает / отказывает.
 *   2) Уже принятые врачи-партнёры (User.role = PARTNER_DOCTOR).
 *
 * Бэкенд:
 *   GET    /admins/doctor-requests              — список заявок
 *   POST   /admins/doctor-requests/{id}/approve — утвердить (создаёт PARTNER_DOCTOR)
 *   POST   /admins/doctor-requests/{id}/reject  — отклонить
 *   GET    /manager/all-partner-doctors         — список одобренных партнёров
 *   PATCH  /manager/recruiter-doctors/{id}/toggle-active — блокировка
 *   DELETE /manager/all-external-doctors/{id}   — удаление (работает для partner_doctor тоже)
 * ========================================
 */
import { useState, useEffect } from 'react'
import api from '../api'
import { Card, Chip, Button, Avatar, EmptyState } from '../design'
import ManagerShell from './_ManagerShell'

const TABS = [
  { key: 'pending', label: 'Заявки рекрутеров', icon: 'pending_actions' },
  { key: 'partners', label: 'Действующие партнёры', icon: 'handshake' },
]

function formatDate(d) {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return '—' }
}

// ════════════════ Заявки рекрутеров (DoctorRequest) ════════════════
function DoctorRequestsTab() {
  const [requests, setRequests] = useState([])
  const [loading, setLoading]   = useState(true)
  const [busy, setBusy]         = useState(null)
  const [statusFilter, setStatusFilter] = useState('pending')

  const load = async () => {
    setLoading(true)
    try {
      const params = statusFilter === 'all' ? {} : { status_filter: statusFilter }
      const r = await api.get('/admins/doctor-requests', { params })
      setRequests(Array.isArray(r.data) ? r.data : [])
    } catch (_) { setRequests([]) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [statusFilter])

  const approve = async (req) => {
    if (!window.confirm(`Утвердить заявку на врача "${req.doctor_name}"?\nБудет создан аккаунт партнёра.`)) return
    setBusy(req.id)
    try {
      const r = await api.post(`/admins/doctor-requests/${req.id}/approve`)
      const cred = r.data
      alert(
        `Заявка утверждена.\n` +
        `Логин: ${cred.username}\n` +
        `Временный пароль: ${cred.temp_password}\n\n` +
        `Передайте врачу для входа.`
      )
      await load()
    } catch (e) {
      alert('Ошибка: ' + (e?.response?.data?.detail || e.message))
    } finally { setBusy(null) }
  }

  const reject = async (req) => {
    if (!window.confirm(`Отклонить заявку на врача "${req.doctor_name}"?`)) return
    setBusy(req.id)
    try {
      await api.post(`/admins/doctor-requests/${req.id}/reject`)
      await load()
    } catch (e) {
      alert('Ошибка: ' + (e?.response?.data?.detail || e.message))
    } finally { setBusy(null) }
  }

  const filterChips = [
    { key: 'pending',  label: 'На рассмотрении' },
    { key: 'approved', label: 'Утверждённые' },
    { key: 'rejected', label: 'Отклонённые' },
    { key: 'all',      label: 'Все' },
  ]

  return (
    <>
      {/* ─── Фильтр по статусу ─── */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {filterChips.map(c => (
          <button
            key={c.key}
            onClick={() => setStatusFilter(c.key)}
            style={{
              padding: '6px 12px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              border: '1px solid var(--border)',
              background: statusFilter === c.key ? 'var(--accent)' : 'var(--surface)',
              color: statusFilter === c.key ? 'white' : 'var(--fg-2)',
              transition: 'all 0.15s',
            }}
          >
            {c.label}
          </button>
        ))}
      </div>

      {loading ? (
        <Card>
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 rounded-full animate-spin" style={{ border: '3px solid var(--accent-soft)', borderTopColor: 'var(--accent)' }} />
          </div>
        </Card>
      ) : requests.length === 0 ? (
        <Card>
          <EmptyState
            icon={<span className="material-symbols-outlined" style={{ fontSize: 28, fontVariationSettings: "'FILL' 1" }}>inbox</span>}
            title="Заявок нет"
            message={
              statusFilter === 'pending'
                ? 'Когда рекрутер подаст заявку на нового врача-партнёра, она появится здесь.'
                : 'В этой категории заявок не найдено.'
            }
          />
        </Card>
      ) : (
        <div className="grid gap-3">
          {requests.map(req => (
            <Card key={req.id}>
              <div className="flex justify-between items-start gap-3 mb-3 flex-wrap">
                <div className="flex items-start gap-3 min-w-0">
                  <Avatar name={req.doctor_name} size="md" />
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate" style={{ color: 'var(--fg)' }}>{req.doctor_name}</div>
                    {req.specialization && (
                      <div className="text-xs font-medium mt-0.5" style={{ color: 'var(--accent)' }}>
                        {req.specialization}
                      </div>
                    )}
                  </div>
                </div>
                <Chip
                  variant={req.status === 'approved' ? 'good' : req.status === 'rejected' ? 'bad' : 'warning'}
                  dot
                >
                  {req.status === 'pending' ? 'На рассмотрении' :
                   req.status === 'approved' ? 'Утверждена' :
                   req.status === 'rejected' ? 'Отклонена' : req.status}
                </Chip>
              </div>

              <div className="grid gap-2 mb-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
                {[
                  { label: 'Телефон',     value: req.phone },
                  { label: 'Клиника',     value: req.clinic_name },
                  { label: 'Специальность', value: req.specialization },
                  { label: 'Рекрутер',    value: req.manager_name },
                ].filter(f => f.value).map(f => (
                  <div key={f.label} style={{ background: 'var(--bg-1)', borderRadius: 9, padding: '7px 10px' }}>
                    <div style={{ fontSize: 10, color: 'var(--fg-4)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                      {f.label}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--fg)', fontWeight: 500 }}>{f.value}</div>
                  </div>
                ))}
              </div>

              {req.notes && (
                <div className="text-xs mb-3 p-2.5" style={{ background: 'var(--bg-1)', borderRadius: 9, color: 'var(--fg-2)' }}>
                  <span style={{ color: 'var(--fg-4)', fontWeight: 700 }}>Комментарий: </span>
                  {req.notes}
                </div>
              )}

              <div className="flex flex-wrap gap-2 items-center pt-3" style={{ borderTop: '1px solid var(--line)' }}>
                {req.status === 'pending' && (
                  <>
                    <Button variant="primary" size="sm" disabled={busy === req.id} onClick={() => approve(req)}>
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>check_circle</span>
                      {busy === req.id ? '…' : 'Утвердить'}
                    </Button>
                    <Button variant="secondary" size="sm" disabled={busy === req.id} onClick={() => reject(req)}>
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>cancel</span>
                      Отклонить
                    </Button>
                  </>
                )}
                <span className="ml-auto text-[11px]" style={{ color: 'var(--fg-4)' }}>
                  {formatDate(req.created_at)}
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}

// ════════════════ Действующие партнёры (PARTNER_DOCTOR) ════════════════
function PartnerDoctorsTab() {
  const [doctors, setDoctors] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [busy, setBusy]       = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const r = await api.get('/manager/all-partner-doctors')
      setDoctors(Array.isArray(r.data) ? r.data : [])
    } catch (_) { setDoctors([]) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const toggleActive = async (doc) => {
    setBusy(doc.id)
    try {
      await api.patch(`/manager/recruiter-doctors/${doc.id}/toggle-active`)
      await load()
    } catch (e) {
      alert('Ошибка: ' + (e?.response?.data?.detail || e.message))
    } finally { setBusy(null) }
  }

  const remove = async (doc) => {
    if (!window.confirm(`Удалить врача-партнёра "${doc.full_name}"?`)) return
    setBusy(doc.id)
    try {
      await api.delete(`/manager/all-external-doctors/${doc.id}`)
      await load()
    } catch (e) {
      alert('Ошибка: ' + (e?.response?.data?.detail || e.message))
    } finally { setBusy(null) }
  }

  const filtered = doctors.filter(d => {
    if (!search) return true
    const q = search.toLowerCase()
    return [d.full_name, d.username, d.specialization, d.phone_number].some(v => v && v.toLowerCase().includes(q))
  })

  return (
    <>
      <div
        className="flex items-center gap-2 mb-4"
        style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', padding: '10px 14px',
        }}
      >
        <span className="material-symbols-outlined" style={{ color: 'var(--fg-3)', fontSize: 18 }}>search</span>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Поиск по имени, логину, специализации…"
          className="flex-1 text-sm outline-none bg-transparent"
          style={{ color: 'var(--fg)' }}
        />
        {search && (
          <button onClick={() => setSearch('')} style={{ background: 'transparent', color: 'var(--fg-3)', fontSize: 16 }}>✕</button>
        )}
      </div>

      {loading ? (
        <Card>
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 rounded-full animate-spin" style={{ border: '3px solid var(--accent-soft)', borderTopColor: 'var(--accent)' }} />
          </div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<span className="material-symbols-outlined" style={{ fontSize: 28, fontVariationSettings: "'FILL' 1" }}>handshake</span>}
            title={search ? 'Ничего не найдено' : 'Нет действующих партнёров'}
            message={search ? 'Попробуйте изменить запрос.' : 'Партнёры появятся здесь после утверждения заявок рекрутеров (вкладка «Заявки рекрутеров»).'}
          />
        </Card>
      ) : (
        <div className="grid gap-3">
          {filtered.map(doc => (
            <Card
              key={doc.id}
              style={{
                opacity: doc.is_active ? 1 : 0.78,
                borderColor: doc.is_active ? 'var(--border)' : 'var(--bad-soft)',
              }}
            >
              <div className="flex justify-between items-start gap-3 mb-3 flex-wrap">
                <div className="flex items-start gap-3 min-w-0">
                  <Avatar name={doc.full_name} size="md" />
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate" style={{ color: 'var(--fg)' }}>{doc.full_name}</div>
                    {doc.specialization && (
                      <div className="text-xs font-medium mt-0.5" style={{ color: 'var(--accent)' }}>
                        {doc.specialization}
                      </div>
                    )}
                  </div>
                </div>
                <Chip variant={doc.is_active ? 'good' : 'bad'} dot>
                  {doc.is_active ? 'Активен' : 'Заблокирован'}
                </Chip>
              </div>

              <div className="grid gap-2 mb-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
                {[
                  { label: 'Логин',   value: doc.username,     mono: true },
                  { label: 'Телефон', value: doc.phone_number },
                  { label: 'Email',   value: doc.email },
                  { label: 'Адрес',   value: doc.address },
                  { label: 'Рекрутер', value: doc.recruiter_name },
                ].filter(f => f.value).map(f => (
                  <div key={f.label} style={{ background: 'var(--bg-1)', borderRadius: 9, padding: '7px 10px' }}>
                    <div style={{ fontSize: 10, color: 'var(--fg-4)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>
                      {f.label}
                    </div>
                    <div
                      className="text-xs break-all"
                      style={{
                        color: 'var(--fg)',
                        fontFamily: f.mono ? 'SF Mono, Consolas, monospace' : 'inherit',
                        fontWeight: f.mono ? 600 : 500,
                      }}
                    >{f.value}</div>
                  </div>
                ))}
              </div>

              {doc.clinics?.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {doc.clinics.map(c => (
                    <Chip key={c.id} variant="accent">{c.name}</Chip>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap gap-2 items-center pt-3" style={{ borderTop: '1px solid var(--line)' }}>
                <Button
                  variant={doc.is_active ? 'secondary' : 'primary'} size="sm"
                  onClick={() => toggleActive(doc)} disabled={busy === doc.id}
                >
                  {busy === doc.id ? '…' : (doc.is_active ? 'Заблокировать' : 'Активировать')}
                </Button>
                <Button
                  variant="secondary" size="sm"
                  onClick={() => remove(doc)} disabled={busy === doc.id}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span>
                  Удалить
                </Button>
                <span className="ml-auto text-[11px]" style={{ color: 'var(--fg-4)' }}>
                  {formatDate(doc.created_at)}
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}

// ════════════════ Главный компонент с вкладками ════════════════
export default function ManagerPartnerDoctors() {
  const [tab, setTab] = useState('pending')

  return (
    <ManagerShell
      active="partners"
      title="Врачи-партнёры"
      subtitle="Заявки рекрутеров и действующие партнёры сети"
      icon="handshake"
    >
      {/* ─── Tabs ─── */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {TABS.map(t => {
          const isActive = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                padding: '8px 14px',
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                border: '1px solid var(--border)',
                background: isActive ? 'var(--accent-soft)' : 'var(--surface)',
                color: isActive ? 'var(--accent)' : 'var(--fg-2)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16, fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0" }}>
                {t.icon}
              </span>
              {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'pending'  && <DoctorRequestsTab />}
      {tab === 'partners' && <PartnerDoctorsTab />}
    </ManagerShell>
  )
}
