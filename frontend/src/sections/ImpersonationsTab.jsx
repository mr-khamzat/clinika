/**
 * ========================================
 * БЛОК: <ImpersonationsTab> — список impersonation-сессий (для super_admin)
 * ========================================
 * Подключается как ещё одна вкладка в <AuditLogSection>.
 * Источник: GET /admin/impersonate/history (только super_admin).
 *
 * Для каждой сессии показываем:
 *   • Кто (actor) + кого (target) + роль target
 *   • Тенант (slug)
 *   • Причина
 *   • Когда начато / завершено / длительность
 *   • IP + город
 *   • Статус (still_active — красная плашка)
 * ========================================
 */
import { useEffect, useState } from 'react'
import api from '../api'

function fmtDate(iso) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleString('ru-RU', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    })
  } catch { return iso }
}

function fmtDuration(sec) {
  if (sec == null) return '—'
  if (sec < 60) return `${sec}с`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m < 60) return `${m}м ${s}с`
  const h = Math.floor(m / 60)
  return `${h}ч ${m % 60}м`
}

const ROLE_LABELS = {
  reg: 'Регистратор', manager: 'Руководитель',
  franchise_owner: 'Владелец франшизы', doctor: 'Врач',
  partner_doctor: 'Врач-партнёр', nurse: 'Медсестра',
  recruiter: 'Менеджер', visiting_doctor: 'Выездной врач',
  patient: 'Пациент',
}

export default function ImpersonationsTab() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [days, setDays] = useState(30)

  useEffect(() => {
    let on = true
    setLoading(true); setErr('')
    api.get('/admin/impersonate/history', { params: { days, limit: 200 } })
      .then(r => { if (on) setItems(Array.isArray(r.data?.items) ? r.data.items : []) })
      .catch(e => { if (on) setErr(e?.response?.data?.detail || 'Не удалось загрузить историю') })
      .finally(() => { if (on) setLoading(false) })
    return () => { on = false }
  }, [days])

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 16, gap: 12, flexWrap: 'wrap',
      }}>
        <div style={{ fontSize: 13, color: 'var(--fg-2, #6b7280)' }}>
          Журнал impersonation-сессий (super_admin → tenant users). Сохраняется
          в основном audit_log как пары событий{' '}
          <code style={{ background: 'var(--bg-2, #f3f4f6)', padding: '2px 6px', borderRadius: 4 }}>
            impersonation.started
          </code> /{' '}
          <code style={{ background: 'var(--bg-2, #f3f4f6)', padding: '2px 6px', borderRadius: 4 }}>
            impersonation.stopped
          </code>.
        </div>
        <select
          value={days}
          onChange={e => setDays(parseInt(e.target.value, 10))}
          style={{
            padding: '6px 10px', borderRadius: 8,
            border: '1px solid var(--border, #d1d5db)',
            background: 'var(--bg, #fff)', color: 'var(--fg, #111827)',
            fontSize: 13,
          }}
        >
          <option value={7}>7 дней</option>
          <option value={30}>30 дней</option>
          <option value={90}>90 дней</option>
          <option value={365}>1 год</option>
        </select>
      </div>

      {loading && <div style={{ padding: 32, textAlign: 'center', color: 'var(--fg-3, #9ca3af)' }}>Загрузка…</div>}
      {err && (
        <div style={{
          padding: 14, borderRadius: 10,
          background: 'rgba(220,38,38,0.08)', color: '#b91c1c',
          border: '1px solid rgba(220,38,38,0.2)', fontSize: 13,
        }}>
          {err}
        </div>
      )}

      {!loading && !err && items.length === 0 && (
        <div style={{
          padding: 36, textAlign: 'center',
          background: 'var(--bg-2, #f9fafb)', borderRadius: 12,
          color: 'var(--fg-3, #6b7280)', fontSize: 14,
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 40, opacity: 0.4, display: 'block', marginBottom: 8 }}>
            visibility_off
          </span>
          За выбранный период impersonation-сессий не было.
        </div>
      )}

      {!loading && items.length > 0 && (
        <div style={{
          background: 'var(--bg, #fff)',
          borderRadius: 12,
          border: '1px solid var(--border, #e5e7eb)',
          overflow: 'hidden',
        }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--bg-2, #f9fafb)' }}>
                  {['Когда', 'Super-admin', 'Цель', 'Тенант', 'Причина', 'Длительность', 'IP / Город', 'Статус'].map(h => (
                    <th key={h} style={{
                      padding: '12px 14px', textAlign: 'left',
                      fontWeight: 600, fontSize: 11, textTransform: 'uppercase',
                      color: 'var(--fg-2, #6b7280)', letterSpacing: 0.4,
                      borderBottom: '1px solid var(--border, #e5e7eb)',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map(s => (
                  <tr key={s.id} style={{ borderBottom: '1px solid var(--border, #f3f4f6)' }}>
                    <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                      <div style={{ fontWeight: 500, color: 'var(--fg, #111827)' }}>{fmtDate(s.started_at)}</div>
                      {s.stopped_at && (
                        <div style={{ fontSize: 11, color: 'var(--fg-3, #9ca3af)', marginTop: 2 }}>
                          до {fmtDate(s.stopped_at)}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ fontWeight: 500 }}>{s.actor_name || '—'}</div>
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ fontWeight: 500 }}>{s.target_name || '—'}</div>
                      <div style={{ fontSize: 11, color: 'var(--fg-3, #9ca3af)', marginTop: 2 }}>
                        {ROLE_LABELS[s.target_role] || s.target_role || '—'}
                        {s.target_username && <span> · @{s.target_username}</span>}
                      </div>
                    </td>
                    <td style={{ padding: '12px 14px', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }}>
                      {s.tenant_slug || '—'}
                    </td>
                    <td style={{ padding: '12px 14px', maxWidth: 280, color: 'var(--fg-2, #6b7280)' }}>
                      {s.reason ? <em>«{s.reason}»</em> : <span style={{ opacity: 0.4 }}>—</span>}
                    </td>
                    <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                      {fmtDuration(s.duration_seconds)}
                    </td>
                    <td style={{ padding: '12px 14px', whiteSpace: 'nowrap', fontSize: 12 }}>
                      <div style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{s.ip_address || '—'}</div>
                      <div style={{ fontSize: 11, color: 'var(--fg-3, #9ca3af)', marginTop: 2 }}>
                        {s.geo_city || s.geo_country || ''}
                      </div>
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      {s.still_active ? (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          padding: '3px 9px', borderRadius: 999,
                          background: 'rgba(220, 38, 38, 0.12)', color: '#b91c1c',
                          fontWeight: 600, fontSize: 11,
                        }}>
                          <span style={{
                            width: 6, height: 6, borderRadius: 999, background: '#dc2626',
                            animation: 'imp-blink 1s infinite',
                          }} />
                          активна
                        </span>
                      ) : (
                        <span style={{
                          padding: '3px 9px', borderRadius: 999,
                          background: 'rgba(16, 185, 129, 0.12)', color: '#047857',
                          fontWeight: 600, fontSize: 11,
                        }}>
                          завершена
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <style>{`
        @keyframes imp-blink { 0%,100% { opacity: 1 } 50% { opacity: 0.3 } }
      `}</style>
    </div>
  )
}
