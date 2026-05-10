/**
 * ========================================
 * БЛОК: ManagerMultiClinicView (Глава 4 — Manager productivity)
 * ========================================
 * Панорамный обзор всех клиник, к которым у менеджера есть доступ.
 *
 * Источник: GET /manager/multi-clinic-overview
 *
 * Раздел скрыт у менеджеров с 1 клиникой — App.jsx + _ManagerShell делают
 * фильтрацию пункта меню по is_multi (флаг приходит в ответе).
 *
 * Каждая клиника — карточка с метриками и алёртами.
 * ========================================
 */
import { useEffect, useState } from 'react'
import api from '../api'
import { Card, Button, EmptyState } from '../design'

const ALERT_LABELS = {
  overtime:     { label: 'Переработка',    color: 'oklch(0.65 0.22 25)', icon: 'priority_high' },
  no_registrar: { label: 'Нет регистратора', color: 'oklch(0.74 0.13 95)', icon: 'group_off' },
  idle_long:    { label: 'Простой >2ч',    color: 'oklch(0.72 0.16 250)', icon: 'pause_circle' },
}

export default function ManagerMultiClinicView() {
  const [data, setData] = useState({ clinics: [], is_multi: true })
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const r = await api.get('/manager/multi-clinic-overview')
      setData(r.data || { clinics: [], is_multi: false })
    } catch {
      setData({ clinics: [], is_multi: false })
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 32, color: 'var(--fg-3)' }}>Загрузка…</div>
  }
  if (!data.clinics || data.clinics.length === 0) {
    return <EmptyState title="Нет клиник" subtitle="Доступные клиники появятся здесь" />
  }

  return (
    <div>
      <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--fg-3)' }}>
        Live-снимок всех клиник, обновлено{' '}
        <button
          onClick={load}
          style={{
            background: 'none', border: 'none', color: 'var(--accent)',
            cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: 0,
          }}
        >обновить</button>
      </div>

      <div style={{
        display: 'grid', gap: 12,
        gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
      }}>
        {data.clinics.map(c => (
          <ClinicCard key={c.id} clinic={c} onSwitch={() => {
            // Сохраняем выбранную клинику в localStorage (используется ClinicScopeSelector)
            localStorage.setItem('clinika_active_clinic_id', c.id)
            window.dispatchEvent(new Event('clinika-active-clinic-changed'))
          }} />
        ))}
      </div>
    </div>
  )
}

function ClinicCard({ clinic, onSwitch }) {
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: 'var(--accent-soft)', color: 'var(--accent)',
          display: 'grid', placeItems: 'center',
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>domain</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {clinic.name}
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>{clinic.city || '—'}</div>
        </div>
      </div>

      {/* Сегодняшние метрики */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <Mini label="Всего" value={clinic.today?.appointments_count || 0} />
        <Mini label="Завершено" value={clinic.today?.completed_count || 0} accent="oklch(0.68 0.18 145)" />
        <Mini label="Ожидают" value={clinic.today?.pending_count || 0} accent="oklch(0.74 0.13 95)" />
      </div>

      {/* Врачи онлайн */}
      <div style={{ fontSize: 11, color: 'var(--fg-3)', marginBottom: 6 }}>
        Врачи на сегодня ({clinic.online_doctors?.length || 0}):
      </div>
      {clinic.online_doctors?.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
          {clinic.online_doctors.slice(0, 5).map(d => (
            <span key={d.id} title={`${d.full_name} — ${d.today_load} приёмов`} style={{
              padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600,
              background: d.today_load > 10 ? 'oklch(0.65 0.22 25)' : 'var(--bg-2)',
              color: d.today_load > 10 ? 'white' : 'var(--fg-3)',
            }}>
              {d.full_name.split(' ').slice(0, 2).join(' ')} · {d.today_load}
            </span>
          ))}
          {clinic.online_doctors.length > 5 && (
            <span style={{ fontSize: 10, color: 'var(--fg-3)' }}>+{clinic.online_doctors.length - 5}</span>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--fg-3)', marginBottom: 8 }}>—</div>
      )}

      {/* Алёрты */}
      {clinic.alerts?.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {clinic.alerts.map(a => {
            const meta = ALERT_LABELS[a] || { label: a, color: 'var(--fg-3)', icon: 'info' }
            return (
              <span key={a} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '4px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600,
                background: meta.color, color: 'white',
              }}>
                <span className="material-symbols-outlined" style={{ fontSize: 12 }}>{meta.icon}</span>
                {meta.label}
              </span>
            )
          })}
        </div>
      )}

      {/* Последняя активность */}
      <div style={{ fontSize: 10, color: 'var(--fg-3)' }}>
        Последняя активность: {clinic.last_activity
          ? new Date(clinic.last_activity).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
          : '—'}
      </div>

      <div style={{ marginTop: 10 }}>
        <Button size="sm" variant="secondary" onClick={onSwitch}>Перейти →</Button>
      </div>
    </Card>
  )
}

function Mini({ label, value, accent }) {
  return (
    <div style={{
      flex: 1, padding: '6px 8px', background: 'var(--bg-1)',
      border: '1px solid var(--border)', borderRadius: 8, textAlign: 'center',
    }}>
      <div style={{ fontSize: 10, color: 'var(--fg-3)', fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: accent || 'var(--fg)' }}>{value}</div>
    </div>
  )
}
