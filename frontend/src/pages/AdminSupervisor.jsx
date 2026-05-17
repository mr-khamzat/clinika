/**
 * ========================================
 * БЛОК: AdminSupervisor — мониторинг сервисов платформы
 * ========================================
 * Только super_admin. Раскрывает /admin/supervisor/status:
 *   - карточки 6 сервисов (backend / db / redis / frontend / prometheus / grafana)
 *   - sparkline CPU / RAM / Disk (последние 10 значений, in-memory)
 *   - таблица последних 20 ошибок (audit_entries.level='error')
 *   - кнопки «Перезапустить» для backend и frontend (с подтверждением)
 *
 * Auto-refresh: 10 секунд. История метрик хранится в state (10 точек).
 * Маршрут: /admin/supervisor (см. App.jsx, блок super_admin).
 * ========================================
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import api from '../api'

// ── Палитра статусов ─────────────────────────────────────────────────────
const STATUS_META = {
  healthy:  { label: 'OK',         color: '#16a34a', bg: 'rgba(22, 163, 74, 0.10)',  dot: '#16a34a' },
  degraded: { label: 'Деградация', color: '#d97706', bg: 'rgba(217, 119, 6, 0.10)',  dot: '#d97706' },
  down:     { label: 'Недоступен', color: '#dc2626', bg: 'rgba(220, 38, 38, 0.10)',  dot: '#dc2626' },
  unknown:  { label: 'Неизвестно', color: '#64748b', bg: 'rgba(100, 116, 139, 0.10)', dot: '#94a3b8' },
}

// Можно перезапустить только бэкенд/фронт (whitelist на бекенде).
const RESTARTABLE = new Set(['backend', 'frontend'])

// Подписи сервисов на русском.
const SERVICE_LABELS = {
  backend:    'Backend (FastAPI)',
  db:         'PostgreSQL',
  redis:      'Redis',
  frontend:   'Frontend (nginx)',
  prometheus: 'Prometheus',
  grafana:    'Grafana',
}

// ── Утилиты форматирования ───────────────────────────────────────────────
function fmtUptime(sec) {
  if (sec == null) return '—'
  const s = Number(sec)
  if (!Number.isFinite(s) || s < 0) return '—'
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}д ${h}ч`
  if (h > 0) return `${h}ч ${m}м`
  return `${m}м`
}

function fmtTime(iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString('ru-RU') } catch { return iso }
}

// ── Sparkline (inline SVG, без зависимостей) ────────────────────────────
function Sparkline({ points, color = '#0ea5e9', height = 36, width = 140 }) {
  const arr = (points || []).filter(v => v != null && Number.isFinite(v))
  if (arr.length < 2) {
    return (
      <div style={{ height, width, display: 'flex', alignItems: 'center',
                    justifyContent: 'center', color: '#94a3b8', fontSize: 11 }}>
        нет данных
      </div>
    )
  }
  const max = Math.max(...arr, 100) // CPU/RAM/disk — проценты 0..100
  const min = 0
  const range = max - min || 1
  const step = width / (arr.length - 1)
  const path = arr.map((v, i) => {
    const x = i * step
    const y = height - ((v - min) / range) * height
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
  }).join(' ')
  const last = arr[arr.length - 1]
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <path d={path} fill="none" stroke={color} strokeWidth="2" />
      <circle cx={width} cy={height - ((last - min) / range) * height} r="2.5" fill={color} />
    </svg>
  )
}

// ── Карточка сервиса ────────────────────────────────────────────────────
function ServiceCard({ service, onRestart, busy }) {
  const meta = STATUS_META[service.status] || STATUS_META.unknown
  const canRestart = RESTARTABLE.has(service.name)

  return (
    <div style={{
      background: '#fff',
      border: '1px solid #e2e8f0',
      borderRadius: 12,
      padding: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: '#0f172a' }}>
          {SERVICE_LABELS[service.name] || service.name}
        </div>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: meta.bg, color: meta.color,
          padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600,
        }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: meta.dot }} />
          {meta.label}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 12, color: '#475569' }}>
        {service.version != null && (
          <div><span style={{ color: '#94a3b8' }}>Версия:</span> {service.version || '—'}</div>
        )}
        {service.uptime_sec != null && (
          <div><span style={{ color: '#94a3b8' }}>Uptime:</span> {fmtUptime(service.uptime_sec)}</div>
        )}
        {service.connections != null && (
          <div><span style={{ color: '#94a3b8' }}>Соединений:</span> {service.connections}</div>
        )}
        {service.size_mb != null && (
          <div><span style={{ color: '#94a3b8' }}>Размер:</span> {service.size_mb} MB</div>
        )}
        {service.memory_mb != null && (
          <div><span style={{ color: '#94a3b8' }}>Память:</span> {service.memory_mb} MB</div>
        )}
        {service.keys != null && (
          <div><span style={{ color: '#94a3b8' }}>Ключей:</span> {service.keys}</div>
        )}
        {service.http_code != null && (
          <div><span style={{ color: '#94a3b8' }}>HTTP:</span> {service.http_code}</div>
        )}
        {service.error && (
          <div style={{ gridColumn: '1 / -1', color: '#dc2626', fontSize: 11,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {service.error}
          </div>
        )}
      </div>

      {canRestart && (
        <button
          onClick={() => onRestart(service.name)}
          disabled={busy}
          style={{
            marginTop: 4,
            background: busy ? '#e2e8f0' : '#fff',
            border: '1px solid #cbd5e1',
            borderRadius: 8,
            padding: '6px 10px',
            fontSize: 12,
            fontWeight: 500,
            color: '#334155',
            cursor: busy ? 'not-allowed' : 'pointer',
          }}
        >
          {busy ? 'Перезапуск…' : 'Перезапустить'}
        </button>
      )}
    </div>
  )
}

// ── Главная страница ────────────────────────────────────────────────────
export default function AdminSupervisor() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [history, setHistory] = useState({ cpu: [], ram: [], disk: [] })
  const [busyService, setBusyService] = useState('')
  const timerRef = useRef(null)

  const load = async () => {
    try {
      const r = await api.get('/admin/supervisor/status')
      setData(r.data || null)
      setError('')
      // Накапливаем 10 точек метрик для sparkline.
      const sys = r.data?.system || {}
      setHistory(prev => ({
        cpu:  [...prev.cpu,  sys.cpu_pct  ?? null].slice(-10),
        ram:  [...prev.ram,  sys.ram_pct  ?? null].slice(-10),
        disk: [...prev.disk, sys.disk_pct ?? null].slice(-10),
      }))
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }

  // Первая загрузка + интервал 10 секунд.
  useEffect(() => {
    load()
    timerRef.current = setInterval(load, 10_000)
    return () => clearInterval(timerRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleRestart = async (svc) => {
    const ok = window.confirm(
      `Перезапустить сервис «${SERVICE_LABELS[svc] || svc}»?\n\n` +
      `Backend: будет короткий downtime (~5 сек), Docker автоматически поднимет контейнер.\n` +
      `Frontend: эндпоинт вернёт инструкцию для оператора (docker compose restart).`
    )
    if (!ok) return
    setBusyService(svc)
    try {
      const r = await api.post('/admin/supervisor/restart', { service: svc, confirm: true })
      const action = r.data?.action || 'ok'
      if (action === 'manual_required') {
        alert(`Требуется ручной рестарт:\n${r.data?.hint || ''}`)
      } else {
        alert(`Сервис ${svc}: ${action}`)
      }
    } catch (e) {
      alert(`Ошибка: ${e?.response?.data?.detail || e?.message || 'unknown'}`)
    } finally {
      setBusyService('')
      // Через секунду подёргаем статус.
      setTimeout(load, 1500)
    }
  }

  const services = data?.services || []
  const recentErrors = data?.recent_errors || []
  const system = data?.system || {}

  // Сводная плашка «всё ок / есть проблемы».
  const overall = useMemo(() => {
    if (!services.length) return { color: '#94a3b8', label: 'нет данных' }
    if (services.some(s => s.status === 'down'))    return { color: '#dc2626', label: 'Есть недоступные' }
    if (services.some(s => s.status === 'degraded')) return { color: '#d97706', label: 'Деградация' }
    if (services.some(s => s.status === 'unknown'))  return { color: '#64748b', label: 'Частично неизвестно' }
    return { color: '#16a34a', label: 'Все сервисы здоровы' }
  }, [services])

  return (
    <div style={{ padding: '20px 24px', maxWidth: 1280, margin: '0 auto', background: '#f6f7fa', minHeight: '100vh' }}>
      {/* Заголовок */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#0f172a' }}>
            Supervisor — мониторинг сервисов
          </h1>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
            Снимок состояния платформы · auto-refresh каждые 10 секунд
          </div>
        </div>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          background: '#fff', border: '1px solid #e2e8f0', borderRadius: 999,
          padding: '6px 14px', fontSize: 13, fontWeight: 600, color: overall.color,
        }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: overall.color }} />
          {overall.label}
        </div>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b',
                      padding: 12, borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Карточки сервисов */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: 14,
        marginBottom: 22,
      }}>
        {loading && !services.length
          ? Array.from({ length: 6 }).map((_, i) => (
              <div key={i} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12,
                                     height: 130, opacity: 0.5 }} />
            ))
          : services.map(s => (
              <ServiceCard
                key={s.name}
                service={s}
                onRestart={handleRestart}
                busy={busyService === s.name}
              />
            ))
        }
      </div>

      {/* Системные метрики + sparkline */}
      <div style={{
        background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 18, marginBottom: 22,
      }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 12px', color: '#0f172a' }}>
          Ресурсы сервера (последние 10 точек, шаг 10 сек)
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          <Metric label="CPU"  value={system.cpu_pct}  points={history.cpu}  color="#0ea5e9" />
          <Metric label="RAM"  value={system.ram_pct}  points={history.ram}  color="#8b5cf6" />
          <Metric label="Disk" value={system.disk_pct} points={history.disk} color="#f59e0b" />
        </div>
      </div>

      {/* Последние ошибки */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 18 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 12px', color: '#0f172a' }}>
          Последние ошибки (audit_entries, level=error)
        </h2>
        {recentErrors.length === 0 ? (
          <div style={{ fontSize: 13, color: '#94a3b8', padding: '12px 0' }}>
            За последний период ошибок не зафиксировано.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ padding: '8px 6px', width: 170 }}>Время</th>
                  <th style={{ padding: '8px 6px', width: 80 }}>Уровень</th>
                  <th style={{ padding: '8px 6px' }}>Сообщение</th>
                </tr>
              </thead>
              <tbody>
                {recentErrors.map((e, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '8px 6px', color: '#475569', fontFamily: 'monospace' }}>
                      {fmtTime(e.ts)}
                    </td>
                    <td style={{ padding: '8px 6px' }}>
                      <span style={{
                        background: 'rgba(220, 38, 38, 0.10)', color: '#dc2626',
                        padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600,
                      }}>{e.level || 'ERROR'}</span>
                    </td>
                    <td style={{ padding: '8px 6px', color: '#0f172a',
                                 wordBreak: 'break-word' }}>{e.msg || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data?.timestamp && (
        <div style={{ textAlign: 'right', color: '#94a3b8', fontSize: 11, marginTop: 12 }}>
          Обновлено: {fmtTime(data.timestamp)}
        </div>
      )}
    </div>
  )
}

// ── Маленький компонент-метрика ────────────────────────────────────────
function Metric({ label, value, points, color }) {
  const display = value == null ? '—' : `${value}%`
  return (
    <div style={{
      border: '1px solid #f1f5f9', borderRadius: 10, padding: 12,
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ fontSize: 12, color: '#64748b' }}>{label}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#0f172a' }}>{display}</div>
        <Sparkline points={points} color={color} />
      </div>
    </div>
  )
}
