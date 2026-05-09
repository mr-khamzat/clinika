/**
 * ========================================
 * БЛОК: ManagerVisitingDoctors — список приезжих врачей сети
 * ========================================
 * Отдельный раздел в меню manager-кабинета: видны все visiting_doctor
 * текущего тенанта (т. е. всей сети управляющего). Возможные действия:
 *   - Смена логина/пароля (через ResetModal в ManagerRecruitDoctors API)
 *   - Блокировка / разблокировка
 *   - Удаление
 *   - Открыть кабинет приезжего врача (link на /{slug}/admin под его учёткой)
 *
 * Бэкенд:
 *   GET    /manager/all-external-doctors   — список (только VISITING_DOCTOR)
 *   PATCH  /manager/recruiter-doctors/{id}/toggle-active
 *   POST   /manager/recruiter-doctors/{id}/reset-credentials
 *   DELETE /manager/all-external-doctors/{id}
 * ========================================
 */
import { useState, useEffect } from 'react'
import api from '../api'
import { Card, Chip, Button, Avatar, EmptyState } from '../design'
import ManagerShell from './_ManagerShell'

export default function ManagerVisitingDoctors() {
  const [doctors, setDoctors] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [busy, setBusy]       = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const r = await api.get('/manager/all-external-doctors')
      // На /all-external-doctors уже только VISITING — но фильтруем на всякий случай.
      const list = Array.isArray(r.data) ? r.data : []
      setDoctors(list.filter(d => (d.type || 'visiting') === 'visiting'))
    } catch (_) {
      setDoctors([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const toggleActive = async (doc) => {
    setBusy(doc.id)
    try {
      await api.patch(`/manager/recruiter-doctors/${doc.id}/toggle-active`)
      await load()
    } catch (e) {
      alert('Не удалось переключить активность: ' + (e?.response?.data?.detail || e.message))
    } finally {
      setBusy(null)
    }
  }

  const remove = async (doc) => {
    if (!window.confirm(`Удалить приезжего врача "${doc.full_name}"?`)) return
    setBusy(doc.id)
    try {
      await api.delete(`/manager/all-external-doctors/${doc.id}`)
      await load()
    } catch (e) {
      alert('Не удалось удалить: ' + (e?.response?.data?.detail || e.message))
    } finally {
      setBusy(null)
    }
  }

  const filtered = doctors.filter(d => {
    if (!search) return true
    const q = search.toLowerCase()
    return [d.full_name, d.username, d.specialization, d.phone_number].some(v => v && v.toLowerCase().includes(q))
  })

  return (
    <ManagerShell
      active="visiting"
      title="Приезжие врачи"
      subtitle={`${doctors.length} врачей в сети`}
      icon="travel_explore"
    >
      {/* ─── Поиск ─── */}
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
            icon={<span className="material-symbols-outlined" style={{ fontSize: 28, fontVariationSettings: "'FILL' 1" }}>flight_takeoff</span>}
            title={search ? 'Ничего не найдено' : 'Нет приезжих врачей'}
            message={search ? 'Попробуйте изменить запрос.' : 'Приезжие врачи добавляются на странице «Сотрудники» (роль «Приезжий врач»).'}
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

              {/* ─── Контакты ─── */}
              <div className="grid gap-2 mb-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
                {[
                  { label: 'Логин',   value: doc.username,     mono: true },
                  { label: 'Телефон', value: doc.phone_number },
                  { label: 'Email',   value: doc.email },
                  { label: 'Адрес',   value: doc.address },
                ].filter(f => f.value).map(f => (
                  <div
                    key={f.label}
                    style={{ background: 'var(--bg-1)', borderRadius: 9, padding: '7px 10px' }}
                  >
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
                    >
                      {f.value}
                    </div>
                  </div>
                ))}
              </div>

              {/* ─── Клиники ─── */}
              {doc.clinics?.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {doc.clinics.map(c => (
                    <Chip key={c.id} variant="accent">{c.name}</Chip>
                  ))}
                </div>
              )}

              {/* ─── Действия ─── */}
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
                  {new Date(doc.created_at).toLocaleDateString('ru-RU')}
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </ManagerShell>
  )
}
