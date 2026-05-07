/**
 * ============================================================================
 * БЛОК: PermissionsMatrixSection — UI матрица прав «Роли и права»
 * ============================================================================
 * Этап 8 ROADMAP — RBAC как данные.
 *
 * Использование:
 *   <PermissionsMatrixSection token={adminToken} />              — для franchise_owner
 *   <PermissionsMatrixSection token={adminToken} mode="admin" /> — для super_admin
 *     (показывает селектор тенанта, редактирует overrides выбранного тенанта)
 *
 * Что делает:
 *   • GET /permissions/matrix?tenant_id=…       — таблица effective прав по ролям
 *   • GET /permissions/actions                  — список всех action'ов (заголовки колонок)
 *   • PUT /permissions/override                 — сохранить переопределения для роли
 *       (super_admin шлёт target_tenant_id в body)
 *   • DELETE /permissions/override/{role}?tenant_id=… — сбросить override роли к дефолту
 *
 * Логика:
 *   1. Зеркалим ответ /matrix в локальный editable state (drafts).
 *   2. Чекбокс отражает effective. Если состояние отличается от default —
 *      ячейка подсвечена var(--accent-soft) (это override).
 *   3. Кнопка «Сохранить» собирает только реально отличающиеся от default
 *      action'ы и шлёт PUT с этой картой.
 *   4. Кнопка «Сбросить» делает DELETE — чистая дефолтная матрица.
 *   5. Toast вместо alert для всех уведомлений.
 * ============================================================================
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import api from '../api'
import { Card, Button, useToast } from '../design'

// Понятные подписи ролей для UI (мапим roleId → название)
const ROLE_LABELS = {
  manager:         'Администратор сети',
  doctor:          'Врач',
  reg:             'Регистратор',
  nurse:           'Медсестра',
  recruiter:       'Рекрутер',
  partner_doctor:  'Врач-партнёр',
  visiting_doctor: 'Приходящий врач',
}

// Группировка action'ов по ресурсам (всё что до ":") — для UX, чтобы
// длинная таблица читалась.
function groupActions(actions) {
  const groups = {}
  for (const a of actions) {
    const [resource] = a.split(':')
    if (!groups[resource]) groups[resource] = []
    groups[resource].push(a)
  }
  return groups
}

const RESOURCE_LABELS = {
  referrals:  'Направления',
  bonuses:    'Бонусы',
  staff:      'Сотрудники',
  clinics:    'Клиники',
  services:   'Услуги',
  reports:    'Отчёты',
  settings:   'Настройки',
  analytics:  'Аналитика',
  audit:      'Аудит',
  ledger:     'Реестр',
  billing:    'Биллинг',
  scheduling: 'Расписание',
  partners:   'Партнёры',
  discounts:  'Скидки',
  consent:    'Согласия',
}

export default function PermissionsMatrixSection({ token, mode }) {
  const isAdminMode = mode === 'admin'
  const { toast } = useToast()
  const [actions, setActions] = useState([])
  const [rows, setRows] = useState([])         // [{role, default[], overrides{}, effective[]}]
  const [drafts, setDrafts] = useState({})     // {role: {action: bool}} — текущее состояние чекбоксов (effective)
  const [defaults, setDefaults] = useState({}) // {role: Set<action>} — дефолт от бэкенда
  const [loading, setLoading] = useState(true)
  const [savingRole, setSavingRole] = useState(null)
  // ── Селектор тенанта для super_admin ──
  const [tenants, setTenants] = useState([])         // [{id, name, slug}]
  const [tenantId, setTenantId] = useState('')      // выбранный uuid (только в admin-режиме)

  // ── Загрузка списка тенантов (только в admin-режиме) ──
  useEffect(() => {
    if (!isAdminMode) return
    let aborted = false
    api.get('/admin/tenants')
      .then(r => {
        if (aborted) return
        const list = Array.isArray(r.data) ? r.data : []
        setTenants(list)
        if (list.length && !tenantId) setTenantId(list[0].id)
      })
      .catch(() => {
        if (!aborted) toast('Не удалось загрузить список тенантов', 'error')
      })
    return () => { aborted = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdminMode])

  // ── Загрузка матрицы ──
  // В admin-режиме обязательно нужен tenantId (иначе матрица будет «дефолт»).
  const load = useCallback(async () => {
    if (isAdminMode && !tenantId) {
      // Тенант ещё не выбран — не дёргаем API
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const params = isAdminMode && tenantId ? { tenant_id: tenantId } : {}
      const r = await api.get('/permissions/matrix', { params })
      const data = r.data
      setActions(data.actions || [])
      setRows(data.roles || [])

      // Заполняем drafts — текущее «effective» состояние чекбоксов
      const d = {}
      const def = {}
      for (const row of data.roles || []) {
        const eff = new Set(row.effective || [])
        const defSet = new Set(row.default || [])
        def[row.role] = defSet
        d[row.role] = {}
        for (const a of data.actions || []) {
          d[row.role][a] = eff.has(a)
        }
      }
      setDrafts(d)
      setDefaults(def)
    } catch (e) {
      toast(e?.response?.data?.detail || 'Не удалось загрузить матрицу прав', 'error')
    } finally {
      setLoading(false)
    }
  }, [toast, isAdminMode, tenantId])

  useEffect(() => { load() }, [load])

  // ── Toggle чекбокса ──
  const toggle = (role, action) => {
    setDrafts(prev => ({
      ...prev,
      [role]: { ...prev[role], [action]: !prev[role]?.[action] },
    }))
  }

  // ── Diff drafts vs defaults для роли → карта permissions для override ──
  const buildOverridePayload = (role) => {
    const def = defaults[role] || new Set()
    const draft = drafts[role] || {}
    const out = {}
    for (const action of actions) {
      const wantAllow = !!draft[action]
      const isDefault = def.has(action)
      if (wantAllow !== isDefault) {
        out[action] = wantAllow
      }
    }
    return out
  }

  // ── Сохранение overrides одной роли ──
  const saveRole = async (role) => {
    if (isAdminMode && !tenantId) {
      toast('Выберите тенанта', 'error')
      return
    }
    setSavingRole(role)
    try {
      const permissions = buildOverridePayload(role)
      const body = { role, permissions }
      if (isAdminMode && tenantId) body.target_tenant_id = tenantId
      await api.put('/permissions/override', body)
      toast(`Права роли «${ROLE_LABELS[role] || role}» сохранены`, 'success')
      await load()
    } catch (e) {
      toast(e?.response?.data?.detail || 'Не удалось сохранить', 'error')
    } finally {
      setSavingRole(null)
    }
  }

  // ── Сброс роли к дефолту ──
  const resetRole = async (role) => {
    if (isAdminMode && !tenantId) {
      toast('Выберите тенанта', 'error')
      return
    }
    setSavingRole(role)
    try {
      const params = isAdminMode && tenantId ? { tenant_id: tenantId } : {}
      await api.delete(`/permissions/override/${role}`, { params })
      toast(`Права роли «${ROLE_LABELS[role] || role}» сброшены к дефолту`, 'success')
      await load()
    } catch (e) {
      toast(e?.response?.data?.detail || 'Не удалось сбросить', 'error')
    } finally {
      setSavingRole(null)
    }
  }

  // ── Группировка action'ов для отрисовки ──
  const grouped = useMemo(() => groupActions(actions), [actions])

  // ── Селектор тенанта (только в admin-режиме) ──
  const tenantSelector = isAdminMode ? (
    <Card style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 13, fontWeight: 600 }}>Тенант:</label>
        <select
          value={tenantId}
          onChange={e => setTenantId(e.target.value)}
          style={{
            padding: '8px 12px',
            border: '1px solid var(--border, #e5e7eb)',
            borderRadius: 8,
            background: 'var(--surface, #fff)',
            fontSize: 13,
            minWidth: 240,
          }}
        >
          {tenants.length === 0 && <option value="">— нет тенантов —</option>}
          {tenants.map(t => (
            <option key={t.id} value={t.id}>
              {t.name} {t.slug ? `(${t.slug})` : ''}
            </option>
          ))}
        </select>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          super_admin редактирует overrides выбранного тенанта.
        </span>
      </div>
    </Card>
  ) : null

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {tenantSelector}
        <Card style={{ padding: 24 }}>
          <div style={{ color: 'var(--text-muted)' }}>Загрузка матрицы прав…</div>
        </Card>
      </div>
    )
  }

  // В admin-режиме без выбранного тенанта — пустое состояние
  if (isAdminMode && !tenantId) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {tenantSelector}
        <Card style={{ padding: 24 }}>
          <div style={{ color: 'var(--text-muted)' }}>Выберите тенанта для редактирования матрицы прав.</div>
        </Card>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {tenantSelector}
      <Card style={{ padding: 16 }}>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Матрица прав определяет, что разрешено каждой роли. По умолчанию права
          захардкожены в коде (ROLE_PERMISSIONS), но вы можете переопределить их
          {isAdminMode ? ' для выбранного тенанта' : ' для своего тенанта'}.
          Ячейки с переопределением подсвечены — они отличаются от системного
          дефолта. Кнопка «Сбросить» возвращает роль к дефолтным правам
          (удаляет все override).
        </div>
      </Card>

      {/* Один большой scrollable wrapper, чтобы таблица не ломала layout */}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={thSticky}>Действие</th>
                {rows.map(r => (
                  <th key={r.role} style={thRole}>
                    <div style={{ fontWeight: 600 }}>{ROLE_LABELS[r.role] || r.role}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>
                      {r.role}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(grouped).map(([resource, acts]) => (
                <>
                  <tr key={`grp-${resource}`}>
                    <td colSpan={rows.length + 1} style={tdGroup}>
                      {RESOURCE_LABELS[resource] || resource}
                    </td>
                  </tr>
                  {acts.map(action => (
                    <tr key={action}>
                      <td style={tdAction}>{action}</td>
                      {rows.map(r => {
                        const isOverride = (r.overrides && action in r.overrides)
                        const checked = !!drafts[r.role]?.[action]
                        return (
                          <td
                            key={r.role + action}
                            style={{
                              ...tdCheck,
                              background: isOverride ? 'var(--accent-soft, rgba(124,58,237,.12))' : 'transparent',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggle(r.role, action)}
                              style={{ cursor: 'pointer', width: 16, height: 16 }}
                            />
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </>
              ))}
              {/* Строка действий — сохранить / сбросить по каждой роли */}
              <tr>
                <td style={{ ...tdAction, fontWeight: 600 }}>Управление</td>
                {rows.map(r => (
                  <td key={`act-${r.role}`} style={{ ...tdCheck, padding: 8 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => saveRole(r.role)}
                        disabled={savingRole === r.role}
                      >
                        {savingRole === r.role ? '...' : 'Сохранить'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => resetRole(r.role)}
                        disabled={savingRole === r.role}
                      >
                        Сбросить
                      </Button>
                    </div>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

// ── Inline-стили (компактнее чем CSS-модуль для одной таблицы) ──
const thSticky = {
  position: 'sticky',
  left: 0,
  background: 'var(--surface, #fff)',
  textAlign: 'left',
  padding: '12px 16px',
  borderBottom: '1px solid var(--border, #e5e7eb)',
  fontWeight: 600,
  zIndex: 1,
}
const thRole = {
  textAlign: 'center',
  padding: '12px 8px',
  borderBottom: '1px solid var(--border, #e5e7eb)',
  minWidth: 120,
}
const tdAction = {
  padding: '8px 16px',
  borderBottom: '1px solid var(--border-soft, #f3f4f6)',
  fontFamily: 'monospace',
  fontSize: 12,
  whiteSpace: 'nowrap',
  position: 'sticky',
  left: 0,
  background: 'var(--surface, #fff)',
}
const tdCheck = {
  textAlign: 'center',
  padding: '6px 8px',
  borderBottom: '1px solid var(--border-soft, #f3f4f6)',
}
const tdGroup = {
  padding: '8px 16px',
  background: 'var(--surface-muted, #f9fafb)',
  fontWeight: 700,
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  color: 'var(--text-muted, #6b7280)',
  borderTop: '1px solid var(--border, #e5e7eb)',
  borderBottom: '1px solid var(--border, #e5e7eb)',
}
