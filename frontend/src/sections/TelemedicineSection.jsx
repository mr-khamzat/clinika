/**
 * ========================================
 * БЛОК: TelemedicineSection — раздел /admin/telemedicine
 * ========================================
 * Список телемед-сессий + KPI + детальный просмотр (чат, рецепты, метрики).
 *
 * Источники:
 *   GET  /telemed/sessions               — список сессий
 *   GET  /telemed/sessions/{id}          — детали + чат
 *   GET  /telemed/sessions/{id}/messages — история сообщений
 *   GET  /telemed/sessions/{id}/prescriptions — рецепты
 *
 * Гейтинг по модулю telemedicine — выполняется на уровне AdminLayout.visibleNav.
 * ========================================
 */
import { useEffect, useMemo, useState } from 'react'
import api from '../api'
import { Card, KpiRow, KpiCard, Button, Chip, Modal, EmptyState } from '../design'
import TelemedRoomModal from '../components/telemed/TelemedRoomModal'

const STATUS_INFO = {
  scheduled: { l: 'Запланирован',  c: 'default' },
  active:    { l: 'В эфире',       c: 'accent'  },
  completed: { l: 'Завершён',      c: 'good'    },
  cancelled: { l: 'Отменён',       c: 'bad'     },
  no_show:   { l: 'Не пришёл',     c: 'warn'    },
}

function fmtDate(s) {
  if (!s) return '—'
  try {
    const d = new Date(s)
    return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch { return s }
}

function fmtDuration(seconds) {
  if (!seconds) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function TelemedicineSection({ token }) {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading]   = useState(false)
  const [err, setErr]           = useState('')

  const [filterStatus, setFilterStatus] = useState('')
  const [filterDoctor, setFilterDoctor] = useState('')
  const [filterDate, setFilterDate]     = useState('')

  const [detail, setDetail]       = useState(null)        // выбранная сессия (объект)
  const [detailMsgs, setDetailMsgs] = useState([])
  const [detailRx, setDetailRx]   = useState([])
  const [roomSessionId, setRoomSessionId] = useState(null) // открыть видео-комнату

  const load = async () => {
    setLoading(true)
    setErr('')
    try {
      const r = await api.get('/telemed/sessions')
      const list = Array.isArray(r.data) ? r.data : (r.data?.items || [])
      setSessions(list)
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Не удалось загрузить список сессий')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  // ─── KPI ───
  const kpi = useMemo(() => {
    const now = Date.now()
    const weekAgo = now - 7 * 24 * 3600 * 1000
    let active = 0, week = 0, totalDur = 0, durCount = 0, noShow = 0, weekTotal = 0
    for (const s of sessions) {
      if (s.status === 'active') active++
      const ts = new Date(s.scheduled_at || s.created_at || 0).getTime()
      if (ts >= weekAgo) {
        weekTotal++
        if (s.status === 'completed') week++
        if (s.status === 'no_show') noShow++
      }
      if (s.duration_seconds) {
        totalDur += s.duration_seconds
        durCount++
      }
    }
    return {
      active,
      week,
      avgDur: durCount ? Math.round(totalDur / durCount) : 0,
      noShowPct: weekTotal ? Math.round((noShow / weekTotal) * 100) : 0,
    }
  }, [sessions])

  // ─── Фильтры ───
  const doctorOptions = useMemo(() => {
    const set = new Map()
    for (const s of sessions) {
      const id = s.doctor_id
      const name = s.doctor_name || s.doctor?.full_name || `#${id}`
      if (id) set.set(String(id), name)
    }
    return [...set.entries()].map(([id, name]) => ({ id, name }))
  }, [sessions])

  const filtered = useMemo(() => {
    return sessions.filter(s => {
      if (filterStatus && s.status !== filterStatus) return false
      if (filterDoctor && String(s.doctor_id) !== filterDoctor) return false
      if (filterDate) {
        const ts = (s.scheduled_at || s.created_at || '').slice(0, 10)
        if (ts !== filterDate) return false
      }
      return true
    })
  }, [sessions, filterStatus, filterDoctor, filterDate])

  // ─── Открытие деталей ───
  const openDetail = async (s) => {
    setDetail(s)
    setDetailMsgs([])
    setDetailRx([])
    try {
      const [ms, rx] = await Promise.all([
        api.get(`/telemed/sessions/${s.id}/messages`).catch(() => ({ data: [] })),
        api.get(`/telemed/sessions/${s.id}/prescriptions`).catch(() => ({ data: [] })),
      ])
      setDetailMsgs(Array.isArray(ms.data) ? ms.data : [])
      setDetailRx(Array.isArray(rx.data) ? rx.data : [])
    } catch {}
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-extrabold text-gray-900 dark:text-white flex items-center gap-2">
          <span className="material-symbols-outlined text-[#0097A7]" style={{ fontVariationSettings: "'FILL' 1" }}>
            video_call
          </span>
          Телемедицина
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Сессии телемед-приёмов, история чатов и электронные рецепты
        </p>
      </div>

      {/* KPI */}
      <KpiRow>
        <KpiCard label="Активных сейчас" value={kpi.active} accent="accent" icon="videocam" />
        <KpiCard label="За неделю" value={kpi.week} icon="calendar_month" />
        <KpiCard label="Средняя длительность" value={kpi.avgDur ? fmtDuration(kpi.avgDur) : '—'} icon="schedule" />
        <KpiCard label="No-show, %" value={`${kpi.noShowPct}%`} accent={kpi.noShowPct > 20 ? 'bad' : 'default'} icon="event_busy" />
      </KpiRow>

      {/* Фильтры */}
      <Card>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--fg-3)' }}>Статус</label>
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="rounded-xl px-3 py-2 text-sm"
              style={{ border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg)' }}
            >
              <option value="">Все</option>
              {Object.entries(STATUS_INFO).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--fg-3)' }}>Врач</label>
            <select
              value={filterDoctor}
              onChange={e => setFilterDoctor(e.target.value)}
              className="rounded-xl px-3 py-2 text-sm"
              style={{ border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg)' }}
            >
              <option value="">Все</option>
              {doctorOptions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--fg-3)' }}>Дата</label>
            <input
              type="date"
              value={filterDate}
              onChange={e => setFilterDate(e.target.value)}
              className="rounded-xl px-3 py-2 text-sm"
              style={{ border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg)' }}
            />
          </div>
          <div className="ml-auto">
            <Button variant="secondary" onClick={load}>
              <span className="material-symbols-outlined text-base mr-1">refresh</span>
              Обновить
            </Button>
          </div>
        </div>
      </Card>

      {/* Таблица */}
      <Card>
        {err && (
          <div className="mb-3 text-xs px-3 py-2 rounded-xl"
            style={{ background: 'var(--bad-soft, rgba(244,63,94,0.08))', color: 'var(--bad, #9f1239)' }}>{err}</div>
        )}
        {loading ? (
          <div className="flex justify-center py-10">
            <div className="w-8 h-8 border-4 border-[#0097A7] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState icon="video_call" title="Сессий пока нет"
            description="Создайте телемед-приём в расписании врача — он появится здесь" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: 'var(--fg-3)' }}>
                  <th className="text-left py-2 px-2 font-semibold">Дата</th>
                  <th className="text-left py-2 px-2 font-semibold">Врач</th>
                  <th className="text-left py-2 px-2 font-semibold">Пациент</th>
                  <th className="text-left py-2 px-2 font-semibold">Статус</th>
                  <th className="text-left py-2 px-2 font-semibold">Длительность</th>
                  <th className="text-right py-2 px-2 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => {
                  const st = STATUS_INFO[s.status] || { l: s.status, c: 'default' }
                  return (
                    <tr key={s.id}
                      className="cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
                      onClick={() => openDetail(s)}
                      style={{ borderTop: '1px solid var(--border)' }}>
                      <td className="py-2 px-2 tabular-nums">{fmtDate(s.scheduled_at || s.created_at)}</td>
                      <td className="py-2 px-2">{s.doctor_name || s.doctor?.full_name || `#${s.doctor_id}`}</td>
                      <td className="py-2 px-2">{s.patient_name || s.patient?.full_name || s.patient_phone || '—'}</td>
                      <td className="py-2 px-2"><Chip variant={st.c}>{st.l}</Chip></td>
                      <td className="py-2 px-2 tabular-nums">{fmtDuration(s.duration_seconds)}</td>
                      <td className="py-2 px-2 text-right">
                        {(s.status === 'scheduled' || s.status === 'active') && (
                          <Button
                            variant="primary"
                            onClick={(e) => { e.stopPropagation(); setRoomSessionId(s.id) }}
                          >
                            {s.status === 'active' ? 'Войти' : 'Начать'}
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Детали сессии */}
      {detail && (
        <Modal open onClose={() => setDetail(null)} title="Сессия телемед-приёма">
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <DetailField label="Дата" value={fmtDate(detail.scheduled_at || detail.created_at)} />
              <DetailField label="Статус" value={(STATUS_INFO[detail.status] || {}).l || detail.status} />
              <DetailField label="Врач" value={detail.doctor_name || detail.doctor?.full_name || `#${detail.doctor_id}`} />
              <DetailField label="Пациент" value={detail.patient_name || detail.patient_phone || '—'} />
              <DetailField label="Длительность" value={fmtDuration(detail.duration_seconds)} />
              <DetailField label="Запись разрешена" value={detail.recording_enabled ? 'Да' : 'Нет'} />
            </div>

            {/* История чата */}
            <div>
              <div className="font-semibold mb-2 flex items-center gap-2">
                <span className="material-symbols-outlined text-base">chat</span>
                История чата ({detailMsgs.length})
              </div>
              <div className="rounded-xl p-3 max-h-60 overflow-y-auto space-y-1.5"
                style={{ background: 'var(--surface-2, rgba(0,0,0,0.03))' }}>
                {detailMsgs.length === 0 ? (
                  <div className="text-xs" style={{ color: 'var(--fg-3)' }}>Сообщений нет</div>
                ) : detailMsgs.map((m, idx) => (
                  <div key={m.id || idx} className="text-xs">
                    <span className="font-semibold mr-1.5">{m.sender_role === 'patient' ? 'Пациент:' : 'Врач:'}</span>
                    <span>{m.text}</span>
                    {m.file_url && (
                      <a href={m.file_url} target="_blank" rel="noopener noreferrer"
                         className="ml-1.5 underline" style={{ color: 'var(--accent, #0097A7)' }}>
                        {m.file_name || 'файл'}
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Рецепты */}
            <div>
              <div className="font-semibold mb-2 flex items-center gap-2">
                <span className="material-symbols-outlined text-base">prescriptions</span>
                Рецепты ({detailRx.length})
              </div>
              {detailRx.length === 0 ? (
                <div className="text-xs" style={{ color: 'var(--fg-3)' }}>Рецепты не выписывались</div>
              ) : (
                <div className="space-y-2">
                  {detailRx.map((rx, idx) => (
                    <div key={rx.id || idx} className="rounded-xl p-3 text-xs whitespace-pre-wrap"
                      style={{ background: 'var(--surface-2, rgba(0,0,0,0.03))' }}>
                      <div className="text-[10px] mb-1" style={{ color: 'var(--fg-3)' }}>
                        {fmtDate(rx.created_at)}
                      </div>
                      {rx.content}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-2">
              <Button variant="secondary" onClick={() => setDetail(null)} className="flex-1">Закрыть</Button>
              {(detail.status === 'scheduled' || detail.status === 'active') && (
                <Button variant="primary" className="flex-1"
                  onClick={() => { setRoomSessionId(detail.id); setDetail(null) }}>
                  {detail.status === 'active' ? 'Войти в комнату' : 'Начать приём'}
                </Button>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* Видео-комната */}
      {roomSessionId && (
        <TelemedRoomModal
          sessionId={roomSessionId}
          onClose={() => { setRoomSessionId(null); load() }}
        />
      )}
    </div>
  )
}

function DetailField({ label, value }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--fg-3)' }}>{label}</div>
      <div className="text-sm mt-0.5" style={{ color: 'var(--fg)' }}>{value || '—'}</div>
    </div>
  )
}
