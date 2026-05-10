/**
 * ========================================
 * БЛОК: <SuperAdminUsersSection> — список пользователей платформы
 * ========================================
 * Доступно только super_admin. Источник: GET /admin/users?role=...
 *
 * Главное действие: кнопка «👁 Войти как» рядом с каждым franchise_owner / manager.
 * При клике — открывается <ImpersonateModal>, после подтверждения происходит
 * полный hard redirect в кабинет тенанта с новым JWT (см. ImpersonateModal.jsx).
 * ========================================
 */
import { useEffect, useMemo, useState } from 'react'
import api from '../api'
import ImpersonateModal from '../components/ImpersonateModal'

const ROLE_FILTERS = [
  { v: '',                label: 'Все' },
  { v: 'franchise_owner', label: 'Владельцы франшиз' },
  { v: 'manager',         label: 'Руководители' },
  { v: 'reg',             label: 'Регистраторы' },
  { v: 'doctor',          label: 'Врачи' },
  { v: 'recruiter',       label: 'Менеджеры найма' },
  { v: 'patient',         label: 'Пациенты' },
]

const ROLE_LABELS = {
  super_admin: 'Владелец платформы',
  franchise_owner: 'Владелец франшизы',
  manager: 'Руководитель',
  doctor: 'Врач',
  reg: 'Регистратор',
  nurse: 'Медсестра',
  recruiter: 'Менеджер найма',
  partner_doctor: 'Врач-партнёр',
  visiting_doctor: 'Выездной врач',
  patient: 'Пациент',
}

const ROLE_BADGE = {
  super_admin:     { bg: 'rgba(220, 38, 38, 0.10)',  fg: '#b91c1c' },
  franchise_owner: { bg: 'rgba(124, 58, 237, 0.10)', fg: '#6d28d9' },
  manager:         { bg: 'rgba(37, 99, 235, 0.10)',  fg: '#1d4ed8' },
  doctor:          { bg: 'rgba(5, 150, 105, 0.10)',  fg: '#047857' },
  reg:             { bg: 'rgba(217, 119, 6, 0.10)',  fg: '#b45309' },
  patient:         { bg: 'rgba(75, 85, 99, 0.10)',   fg: '#4b5563' },
}

// Роли, в которые «правомочно» входить через impersonation.
// super_admin исключён — это запрещено на бекенде (403).
const ALLOWED_ROLES_TO_IMPERSONATE = new Set([
  'franchise_owner', 'manager', 'reg', 'doctor', 'nurse',
  'recruiter', 'partner_doctor', 'visiting_doctor', 'patient',
])

export default function SuperAdminUsersSection() {
  const [users, setUsers]     = useState([])
  const [role, setRole]       = useState('franchise_owner')
  const [search, setSearch]   = useState('')
  const [loading, setLoading] = useState(true)
  const [err, setErr]         = useState('')
  const [target, setTarget]   = useState(null)  // user → открываем модалку

  useEffect(() => {
    let on = true
    setLoading(true); setErr('')
    const params = role ? { role } : {}
    api.get('/admin/users', { params })
      .then(r => { if (on) setUsers(Array.isArray(r.data) ? r.data : []) })
      .catch(e => { if (on) setErr(e?.response?.data?.detail || 'Ошибка загрузки') })
      .finally(() => { if (on) setLoading(false) })
    return () => { on = false }
  }, [role])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return users
    return users.filter(u =>
      (u.full_name || '').toLowerCase().includes(q) ||
      (u.username || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q) ||
      (u.phone_number || '').toLowerCase().includes(q)
    )
  }, [users, search])

  return (
    <div>
      {/* Header + фильтры */}
      <div style={{
        display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12,
        marginBottom: 16,
      }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
          {ROLE_FILTERS.map(f => (
            <button key={f.v}
              onClick={() => setRole(f.v)}
              style={{
                padding: '6px 12px', borderRadius: 8,
                fontSize: 12, fontWeight: 600,
                background: role === f.v ? 'var(--accent, #0097A7)' : 'var(--bg-2, #f3f4f6)',
                color: role === f.v ? '#fff' : 'var(--fg-2, #4b5563)',
                border: '1px solid ' + (role === f.v ? 'transparent' : 'var(--border, #e5e7eb)'),
                cursor: 'pointer',
                transition: 'all 120ms',
              }}>
              {f.label}
            </button>
          ))}
        </div>

        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Поиск по имени, логину, email…"
          style={{
            padding: '8px 12px', borderRadius: 8, fontSize: 13,
            border: '1px solid var(--border, #d1d5db)',
            background: 'var(--bg, #fff)', color: 'var(--fg, #111827)',
            minWidth: 240,
          }}
        />
      </div>

      <div style={{
        background: 'rgba(220, 38, 38, 0.06)',
        border: '1px solid rgba(220, 38, 38, 0.18)',
        borderRadius: 10, padding: '10px 14px',
        marginBottom: 14, fontSize: 12.5, color: 'var(--fg-2, #6b7280)',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#b91c1c' }}>visibility</span>
        <span>
          <strong>Войти как</strong> — короткая 30-минутная сессия от имени выбранного пользователя.
          Все ваши действия будут записаны в audit-журнал с привязкой к вашему ID
          (RFC 8693, claim <code style={{ background: 'rgba(0,0,0,0.05)', padding: '0 4px', borderRadius: 3 }}>act</code>).
        </span>
      </div>

      {loading && <div style={{ padding: 32, textAlign: 'center', color: 'var(--fg-3, #9ca3af)' }}>Загрузка…</div>}
      {err && (
        <div style={{
          padding: 14, borderRadius: 10,
          background: 'rgba(220,38,38,0.08)', color: '#b91c1c',
          border: '1px solid rgba(220,38,38,0.2)', fontSize: 13,
        }}>{err}</div>
      )}

      {!loading && !err && (
        <div style={{
          background: 'var(--bg, #fff)', borderRadius: 12,
          border: '1px solid var(--border, #e5e7eb)', overflow: 'hidden',
        }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--bg-2, #f9fafb)' }}>
                  {['Пользователь', 'Роль', 'Email / Телефон', 'Тенант', 'Действия'].map(h => (
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
                {filtered.map(u => {
                  const canImp = ALLOWED_ROLES_TO_IMPERSONATE.has(u.role)
                  const badge = ROLE_BADGE[u.role] || { bg: 'var(--bg-2)', fg: 'var(--fg-2)' }
                  return (
                    <tr key={u.id} style={{ borderBottom: '1px solid var(--border, #f3f4f6)' }}>
                      <td style={{ padding: '12px 14px' }}>
                        <div style={{ fontWeight: 600, color: 'var(--fg, #111827)' }}>
                          {u.full_name || '—'}
                        </div>
                        {u.username && (
                          <div style={{ fontSize: 11, color: 'var(--fg-3, #9ca3af)', marginTop: 2, fontFamily: 'ui-monospace, Menlo, monospace' }}>
                            @{u.username}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <span style={{
                          padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 600,
                          background: badge.bg, color: badge.fg,
                        }}>
                          {ROLE_LABELS[u.role] || u.role}
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px', color: 'var(--fg-2, #6b7280)' }}>
                        <div>{u.email || '—'}</div>
                        {u.phone_number && (
                          <div style={{ fontSize: 11, color: 'var(--fg-3, #9ca3af)', marginTop: 2 }}>
                            {u.phone_number}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, color: 'var(--fg-3, #9ca3af)' }}>
                        {u.tenant_id ? String(u.tenant_id).slice(0, 8) + '…' : '—'}
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        {canImp ? (
                          <button
                            onClick={() => setTarget(u)}
                            style={{
                              padding: '6px 12px', borderRadius: 8,
                              background: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
                              color: '#fff', border: 'none', fontSize: 12, fontWeight: 600,
                              cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5,
                              boxShadow: '0 1px 4px rgba(220, 38, 38, 0.3)',
                              transition: 'transform 100ms',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)' }}
                            onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)' }}
                            title="Войти как этот пользователь"
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>visibility</span>
                            Войти как
                          </button>
                        ) : (
                          <span style={{ fontSize: 11, color: 'var(--fg-3, #9ca3af)' }}>—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: 36, textAlign: 'center', color: 'var(--fg-3, #9ca3af)' }}>
                    Пусто.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Модалка подтверждения impersonation */}
      {target && <ImpersonateModal user={target} onClose={() => setTarget(null)} />}
    </div>
  )
}
