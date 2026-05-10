/**
 * ========================================
 * БЛОК: ManagerKanbanSchedule (Глава 4 — Manager productivity)
 * ========================================
 * Kanban-доска расписания по 4 статусам:
 *   scheduled · confirmed · in_progress · completed
 *
 * Возможности:
 *   • Drag & drop карточек (нативный HTML5 DnD) → PATCH /manager/appointments/{id}/status
 *   • Фильтр по клинике (доступен franchise_owner / super_admin) и врачу
 *   • Polling раз в 30 секунд (без WS — чтобы не зависеть от внешней инфраструктуры)
 *   • Mobile: горизонтальный скролл колонок (snap по колонкам)
 *   • Кнопка переключения «День · Неделя · Kanban» в шапке
 * ========================================
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import api from '../api'
import { Card, Button, Tabs, EmptyState } from '../design'
import { useToast } from '../design'

// ─── Статусы колонок (порядок и метки) ────────────────────────────────────
const COLS = [
  { key: 'scheduled',   label: 'Запланировано', icon: 'event',       accent: 'oklch(0.74 0.13 95)' },
  { key: 'confirmed',   label: 'Подтверждено',  icon: 'verified',    accent: 'oklch(0.72 0.16 250)' },
  { key: 'in_progress', label: 'На приёме',     icon: 'pace',        accent: 'oklch(0.72 0.18 60)' },
  { key: 'completed',   label: 'Завершено',     icon: 'check_circle',accent: 'oklch(0.68 0.18 145)' },
]

// Цвет полоски по приоритету
const PRIO_COLORS = {
  normal: 'transparent',
  high:   'oklch(0.74 0.16 75)',
  urgent: 'oklch(0.65 0.22 25)',
}

export default function ManagerKanbanSchedule({ onSwitchView }) {
  const toast = useToast()
  const [data, setData] = useState({ columns: { scheduled:[], confirmed:[], in_progress:[], completed:[] }, doctors: [] })
  const [clinics, setClinics] = useState([])
  const [filter, setFilter] = useState({ clinic_id: '', doctor_id: '', date_from: '', date_to: '' })
  const [loading, setLoading] = useState(true)
  const [dragId, setDragId] = useState(null)
  const pollTimer = useRef(null)

  // ─── Загрузка списка клиник для селектора ─────────────────────────────
  useEffect(() => {
    api.get('/manager/clinics-accessible')
      .then(r => setClinics(Array.isArray(r.data) ? r.data : []))
      .catch(() => setClinics([]))
  }, [])

  // ─── Загрузка Kanban ──────────────────────────────────────────────────
  const load = async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const params = {}
      if (filter.clinic_id) params.clinic_id = filter.clinic_id
      if (filter.doctor_id) params.doctor_id = filter.doctor_id
      if (filter.date_from) params.date_from = filter.date_from
      if (filter.date_to)   params.date_to   = filter.date_to
      const r = await api.get('/manager/appointments/kanban', { params })
      setData(r.data || { columns: {}, doctors: [] })
    } catch (e) {
      if (!silent) toast?.error?.('Не удалось загрузить Kanban')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // Polling каждые 30 сек
    if (pollTimer.current) clearInterval(pollTimer.current)
    pollTimer.current = setInterval(() => load(true), 30000)
    return () => { if (pollTimer.current) clearInterval(pollTimer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.clinic_id, filter.doctor_id, filter.date_from, filter.date_to])

  // ─── DnD: dragstart, drop ─────────────────────────────────────────────
  const onDragStart = (e, card) => {
    setDragId(card.id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', card.id)
  }
  const onDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }
  const onDrop = async (e, targetStatus) => {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/plain') || dragId
    setDragId(null)
    if (!id) return
    // Локально перемещаем (оптимистично)
    let source = null
    const next = { ...data, columns: { ...data.columns } }
    for (const key of Object.keys(next.columns)) {
      const idx = next.columns[key].findIndex(c => c.id === id)
      if (idx >= 0) {
        source = key
        const [card] = next.columns[key].splice(idx, 1)
        card.status = targetStatus
        next.columns[targetStatus] = [...(next.columns[targetStatus] || []), card]
        break
      }
    }
    if (source === targetStatus) return
    setData(next)
    // Отправляем на сервер
    try {
      await api.patch(`/manager/appointments/${id}/status`, { status: targetStatus })
      toast?.success?.(`Перенесено: ${labelOf(targetStatus)}`)
    } catch (err) {
      toast?.error?.('Не удалось обновить статус')
      load()  // rollback через перезагрузку
    }
  }

  const labelOf = (k) => (COLS.find(c => c.key === k)?.label) || k

  // ─── UI ───────────────────────────────────────────────────────────────
  return (
    <div>
      {/* ─── Toolbar: фильтры + переключатель режимов ─── */}
      <div
        style={{
          display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center',
          marginBottom: 12, padding: 12, background: 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: 'var(--radius)',
        }}
      >
        {clinics.length > 1 && (
          <select
            value={filter.clinic_id}
            onChange={e => setFilter(f => ({ ...f, clinic_id: e.target.value }))}
            style={selectStyle}
          >
            <option value="">Все клиники</option>
            {clinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <select
          value={filter.doctor_id}
          onChange={e => setFilter(f => ({ ...f, doctor_id: e.target.value }))}
          style={selectStyle}
        >
          <option value="">Все врачи</option>
          {data.doctors.map(d => (
            <option key={d.id} value={d.id}>{d.full_name}{d.specialty ? ` · ${d.specialty}` : ''}</option>
          ))}
        </select>
        <input
          type="date" value={filter.date_from}
          onChange={e => setFilter(f => ({ ...f, date_from: e.target.value }))}
          style={selectStyle}
        />
        <input
          type="date" value={filter.date_to}
          onChange={e => setFilter(f => ({ ...f, date_to: e.target.value }))}
          style={selectStyle}
        />
        <Button size="sm" variant="secondary" onClick={() => load()}>Обновить</Button>
        <div style={{ flex: 1 }} />
        {onSwitchView && (
          <Tabs
            items={[
              { id: 'calendar', label: 'День' },
              { id: 'week',     label: 'Неделя' },
              { id: 'kanban',   label: 'Kanban' },
            ]}
            value="kanban"
            onChange={onSwitchView}
          />
        )}
      </div>

      {/* ─── Kanban grid ─── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(280px, 1fr))',
          gap: 12,
          overflowX: 'auto',
          paddingBottom: 8,
        }}
      >
        {COLS.map(col => {
          const items = data.columns?.[col.key] || []
          return (
            <div
              key={col.key}
              onDragOver={onDragOver}
              onDrop={(e) => onDrop(e, col.key)}
              style={{
                background: 'var(--bg-1)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                padding: 10,
                minWidth: 280,
                display: 'flex', flexDirection: 'column', gap: 8,
                minHeight: 200,
              }}
            >
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                paddingBottom: 8, borderBottom: '1px solid var(--border)',
              }}>
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 18, color: col.accent }}
                >{col.icon}</span>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{col.label}</span>
                <span style={{
                  marginLeft: 'auto', fontSize: 11, fontWeight: 600,
                  background: 'var(--bg-2)', color: 'var(--fg-3)',
                  padding: '2px 8px', borderRadius: 999,
                }}>{items.length}</span>
              </div>

              {loading && items.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--fg-3)', textAlign: 'center', padding: 20 }}>
                  Загрузка…
                </div>
              ) : items.length === 0 ? (
                <div style={{ fontSize: 11, color: 'var(--fg-3)', textAlign: 'center', padding: 16, opacity: 0.7 }}>
                  Пусто
                </div>
              ) : (
                items.map(card => (
                  <div
                    key={card.id}
                    draggable
                    onDragStart={(e) => onDragStart(e, card)}
                    title="Перетащите карточку в другую колонку для смены статуса"
                    style={{
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 10,
                      padding: 10,
                      cursor: 'grab',
                      borderLeft: `3px solid ${PRIO_COLORS[card.priority] || 'transparent'}`,
                      boxShadow: dragId === card.id ? '0 6px 20px rgba(0,0,0,.15)' : 'var(--shadow-sm)',
                      opacity: dragId === card.id ? 0.6 : 1,
                      transition: 'opacity .15s',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                      {card.patient_name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>
                      {card.doctor_name}{card.doctor_specialty ? ` · ${card.doctor_specialty}` : ''}
                    </div>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      fontSize: 11, color: 'var(--fg-2)', marginTop: 6,
                    }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 13 }}>schedule</span>
                      <span>{card.date} · {card.start_time}–{card.end_time}</span>
                    </div>
                    {card.price != null && (
                      <div style={{
                        marginTop: 6, fontSize: 11, fontWeight: 600,
                        color: 'var(--accent)',
                      }}>
                        {Number(card.price).toLocaleString('ru-RU')} ₽
                      </div>
                    )}
                    {card.priority && card.priority !== 'normal' && (
                      <div style={{
                        marginTop: 6, display: 'inline-block', padding: '2px 8px',
                        borderRadius: 999, fontSize: 10, fontWeight: 600,
                        background: PRIO_COLORS[card.priority], color: 'white',
                      }}>
                        {card.priority === 'urgent' ? 'СРОЧНО' : 'ВАЖНО'}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const selectStyle = {
  height: 32, padding: '0 8px', fontSize: 12,
  background: 'var(--bg-2)', color: 'var(--fg)',
  border: '1px solid var(--border)', borderRadius: 8,
}
