/**
 * ========================================
 * AdminFeatureFlags — управление фичами платформы (super_admin)
 * ========================================
 * Раздел отображает все feature-flags платформы и позволяет:
 *   - создавать / редактировать / удалять флаги
 *   - управлять tenant-overrides через боковой drawer
 *   - менять стратегию раскатки (all / tenants / percentage / ab_test)
 *
 * Связан с router'ом /admin/feature-flags (см. backend/app/routers/admin_feature_flags.py).
 * Маршрут /admin/feature-flags регистрируется в AdminLayout/AdminRoot отдельно.
 * ========================================
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '../api'
import { Card, Button, Chip, Tabs, EmptyState } from '../design'

// ── Локальные константы ─────────────────────────────────────────────────────

const STRATEGY_LABELS = {
  all:        'Все тенанты',
  tenants:    'Только выбранные',
  percentage: 'Процент тенантов',
  ab_test:    'A/B-тест',
}

const STRATEGY_TONES = {
  all:        'success',
  tenants:    'neutral',
  percentage: 'info',
  ab_test:    'warning',
}

const EMPTY_FORM = {
  key: '',
  name: '',
  description: '',
  default_enabled: false,
  rollout_strategy: 'all',
  rollout_value: null,
  percentage: 50,
  variants: [
    { name: 'A', weight: 50 },
    { name: 'B', weight: 50 },
  ],
}

// ── Утилиты ────────────────────────────────────────────────────────────────

function buildRolloutValue(form) {
  if (form.rollout_strategy === 'percentage') {
    return { percentage: Number(form.percentage) }
  }
  if (form.rollout_strategy === 'ab_test') {
    const obj = {}
    for (const v of form.variants) {
      if (v.name) obj[v.name] = Number(v.weight) || 0
    }
    return { variants: obj }
  }
  return null
}

function formFromFlag(flag) {
  const base = { ...EMPTY_FORM, ...flag }
  if (flag.rollout_strategy === 'percentage' && flag.rollout_value) {
    base.percentage = flag.rollout_value.percentage ?? 50
  }
  if (flag.rollout_strategy === 'ab_test' && flag.rollout_value?.variants) {
    base.variants = Object.entries(flag.rollout_value.variants).map(
      ([name, weight]) => ({ name, weight })
    )
  }
  return base
}

// ── Корневой компонент ─────────────────────────────────────────────────────

export default function AdminFeatureFlags() {
  const [flags, setFlags] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null)   // { mode: 'create'|'edit', form }
  const [drawerFlag, setDrawerFlag] = useState(null) // флаг открытый в drawer-е

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/admin/feature-flags/')
      setFlags(data || [])
      setError(null)
    } catch (e) {
      setError(e?.response?.data?.detail || 'Не удалось загрузить флаги')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  const onSave = useCallback(async (form, mode) => {
    const body = {
      name: form.name,
      description: form.description || null,
      default_enabled: !!form.default_enabled,
      rollout_strategy: form.rollout_strategy,
      rollout_value: buildRolloutValue(form),
    }
    if (mode === 'create') body.key = form.key
    try {
      if (mode === 'create') {
        await api.post('/admin/feature-flags/', body)
      } else {
        await api.patch(`/admin/feature-flags/${encodeURIComponent(form.key)}`, body)
      }
      setEditing(null)
      await reload()
    } catch (e) {
      const detail = e?.response?.data?.detail || 'Ошибка сохранения'
      alert(typeof detail === 'string' ? detail : JSON.stringify(detail))
    }
  }, [reload])

  const onDelete = useCallback(async (flag) => {
    if (!window.confirm(`Удалить флаг «${flag.name}»? Это снесёт все overrides.`)) return
    try {
      await api.delete(`/admin/feature-flags/${encodeURIComponent(flag.key)}`)
      await reload()
    } catch (e) {
      alert(e?.response?.data?.detail || 'Ошибка удаления')
    }
  }, [reload])

  // ── Рендеринг ─────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '24px 16px', maxWidth: 1180, margin: '0 auto' }}>
      <header style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
        gap: 12, marginBottom: 20,
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: '#0f172a' }}>
            Feature Flags
          </h1>
          <div style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>
            Управление фичами платформы и A/B-экспериментами
          </div>
        </div>
        <Button onClick={() => setEditing({ mode: 'create', form: { ...EMPTY_FORM } })}>
          + Создать флаг
        </Button>
      </header>

      {loading && <Card><div style={{ padding: 16, color: '#64748b' }}>Загрузка…</div></Card>}

      {error && !loading && (
        <Card>
          <div style={{ padding: 16, color: '#dc2626' }}>{error}</div>
        </Card>
      )}

      {!loading && !error && flags.length === 0 && (
        <EmptyState
          title="Пока ни одной фичи"
          description="Создайте первый флаг чтобы управлять раскаткой функционала."
        />
      )}

      {!loading && !error && flags.length > 0 && (
        <FlagsTable
          flags={flags}
          onEdit={(f) => setEditing({ mode: 'edit', form: formFromFlag(f) })}
          onDelete={onDelete}
          onOpenTenants={(f) => setDrawerFlag(f)}
        />
      )}

      {editing && (
        <FlagFormModal
          mode={editing.mode}
          initial={editing.form}
          onCancel={() => setEditing(null)}
          onSave={(form) => onSave(form, editing.mode)}
        />
      )}

      {drawerFlag && (
        <TenantOverridesDrawer
          flag={drawerFlag}
          onClose={() => { setDrawerFlag(null); reload() }}
        />
      )}
    </div>
  )
}

// ── Таблица флагов ─────────────────────────────────────────────────────────

function FlagsTable({ flags, onEdit, onDelete, onOpenTenants }) {
  return (
    <Card>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f8fafc' }}>
              {['Ключ', 'Название', 'Стратегия', 'Дефолт', 'Тенантов', 'Действия']
                .map((h) => (
                  <th key={h} style={cellHeader}>{h}</th>
                ))}
            </tr>
          </thead>
          <tbody>
            {flags.map((f) => (
              <tr key={f.id} style={{ borderTop: '1px solid #e2e8f0' }}>
                <td style={cellMono}>{f.key}</td>
                <td style={cell}>
                  <div style={{ fontWeight: 600, color: '#0f172a' }}>{f.name}</div>
                  {f.description && (
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                      {f.description}
                    </div>
                  )}
                </td>
                <td style={cell}>
                  <Chip tone={STRATEGY_TONES[f.rollout_strategy] || 'neutral'}>
                    {STRATEGY_LABELS[f.rollout_strategy] || f.rollout_strategy}
                  </Chip>
                  {f.rollout_strategy === 'percentage' && f.rollout_value?.percentage != null && (
                    <span style={{ marginLeft: 8, fontSize: 12, color: '#64748b' }}>
                      {f.rollout_value.percentage}%
                    </span>
                  )}
                </td>
                <td style={cell}>
                  <Chip tone={f.default_enabled ? 'success' : 'neutral'}>
                    {f.default_enabled ? 'ON' : 'OFF'}
                  </Chip>
                </td>
                <td style={cell}>{f.overrides_count ?? 0}</td>
                <td style={cell}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Button size="sm" variant="ghost" onClick={() => onOpenTenants(f)}>
                      Тенанты
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onEdit(f)}>
                      Изм.
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onDelete(f)}>
                      Удалить
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

const cellHeader = {
  textAlign: 'left',
  padding: '12px 14px',
  fontSize: 12,
  fontWeight: 600,
  color: '#475569',
  textTransform: 'uppercase',
  letterSpacing: 0.3,
}
const cell = { padding: '12px 14px', fontSize: 14, color: '#0f172a', verticalAlign: 'top' }
const cellMono = { ...cell, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 }

// ── Модалка создания/редактирования ────────────────────────────────────────

function FlagFormModal({ mode, initial, onCancel, onSave }) {
  const [form, setForm] = useState(initial)

  const update = (patch) => setForm((s) => ({ ...s, ...patch }))

  const isCreate = mode === 'create'

  return (
    <Overlay onClick={onCancel}>
      <div style={modalBox} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: 0, fontSize: 20 }}>
          {isCreate ? 'Новый флаг' : `Редактирование: ${initial.key}`}
        </h2>

        <Field label="Ключ (snake_case)" disabled={!isCreate}>
          <input
            value={form.key}
            disabled={!isCreate}
            onChange={(e) => update({ key: e.target.value })}
            style={inputStyle}
            placeholder="new_dashboard"
          />
        </Field>

        <Field label="Название">
          <input
            value={form.name}
            onChange={(e) => update({ name: e.target.value })}
            style={inputStyle}
            placeholder="Новый дашборд"
          />
        </Field>

        <Field label="Описание">
          <textarea
            value={form.description || ''}
            onChange={(e) => update({ description: e.target.value })}
            rows={3}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </Field>

        <Field label="Стратегия раскатки">
          <select
            value={form.rollout_strategy}
            onChange={(e) => update({ rollout_strategy: e.target.value })}
            style={inputStyle}
          >
            {Object.entries(STRATEGY_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </Field>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <input
            type="checkbox"
            checked={!!form.default_enabled}
            onChange={(e) => update({ default_enabled: e.target.checked })}
          />
          <span style={{ fontSize: 14 }}>Включён по умолчанию (для стратегии «Все»)</span>
        </label>

        {form.rollout_strategy === 'percentage' && (
          <Field label="Процент тенантов (0–100)">
            <input
              type="number"
              min={0}
              max={100}
              value={form.percentage}
              onChange={(e) => update({ percentage: Number(e.target.value) })}
              style={inputStyle}
            />
          </Field>
        )}

        {form.rollout_strategy === 'ab_test' && (
          <Field label="Варианты (имя + вес)">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {form.variants.map((v, i) => (
                <div key={i} style={{ display: 'flex', gap: 6 }}>
                  <input
                    value={v.name}
                    onChange={(e) => {
                      const next = [...form.variants]
                      next[i] = { ...next[i], name: e.target.value }
                      update({ variants: next })
                    }}
                    style={{ ...inputStyle, flex: 1 }}
                    placeholder="A"
                  />
                  <input
                    type="number"
                    min={0}
                    value={v.weight}
                    onChange={(e) => {
                      const next = [...form.variants]
                      next[i] = { ...next[i], weight: Number(e.target.value) }
                      update({ variants: next })
                    }}
                    style={{ ...inputStyle, width: 100 }}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => update({
                      variants: form.variants.filter((_, j) => j !== i),
                    })}
                  >×</Button>
                </div>
              ))}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => update({
                  variants: [...form.variants, { name: '', weight: 0 }],
                })}
              >
                + Добавить вариант
              </Button>
            </div>
          </Field>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <Button variant="ghost" onClick={onCancel}>Отмена</Button>
          <Button onClick={() => onSave(form)}>
            {isCreate ? 'Создать' : 'Сохранить'}
          </Button>
        </div>
      </div>
    </Overlay>
  )
}

// ── Drawer overrides ───────────────────────────────────────────────────────

function TenantOverridesDrawer({ flag, onClose }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [newTenantId, setNewTenantId] = useState('')
  const [newEnabled, setNewEnabled] = useState(true)
  const [newVariant, setNewVariant] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get(`/admin/feature-flags/${encodeURIComponent(flag.key)}/tenants`)
      setItems(data || [])
    } catch (e) {
      alert(e?.response?.data?.detail || 'Не удалось загрузить overrides')
    } finally {
      setLoading(false)
    }
  }, [flag.key])

  useEffect(() => { reload() }, [reload])

  const setOverride = async (tenant_id, enabled, variant) => {
    try {
      await api.put(
        `/admin/feature-flags/${encodeURIComponent(flag.key)}/tenants/${tenant_id}`,
        { enabled, variant: variant || null },
      )
      await reload()
    } catch (e) {
      alert(e?.response?.data?.detail || 'Ошибка сохранения override')
    }
  }

  const removeOverride = async (tenant_id) => {
    if (!window.confirm('Снять override для этого тенанта?')) return
    try {
      await api.delete(`/admin/feature-flags/${encodeURIComponent(flag.key)}/tenants/${tenant_id}`)
      await reload()
    } catch (e) {
      alert(e?.response?.data?.detail || 'Ошибка удаления override')
    }
  }

  return (
    <Overlay onClick={onClose}>
      <div style={drawerBox} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 12, color: '#64748b' }}>Overrides для флага</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{flag.key}</div>
          </div>
          <Button variant="ghost" onClick={onClose}>Закрыть</Button>
        </div>

        <div style={{ marginTop: 12, padding: 12, background: '#f8fafc', borderRadius: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
            Добавить override
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <input
              placeholder="tenant_id (UUID)"
              value={newTenantId}
              onChange={(e) => setNewTenantId(e.target.value)}
              style={{ ...inputStyle, flex: '1 1 220px' }}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="checkbox"
                checked={newEnabled}
                onChange={(e) => setNewEnabled(e.target.checked)}
              />
              <span style={{ fontSize: 13 }}>enabled</span>
            </label>
            <input
              placeholder="variant (опц.)"
              value={newVariant}
              onChange={(e) => setNewVariant(e.target.value)}
              style={{ ...inputStyle, width: 140 }}
            />
            <Button
              size="sm"
              onClick={() => {
                if (!newTenantId) { alert('Укажите tenant_id'); return }
                setOverride(newTenantId.trim(), newEnabled, newVariant.trim())
                setNewTenantId(''); setNewVariant('')
              }}
            >Добавить</Button>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          {loading && <div style={{ color: '#64748b' }}>Загрузка…</div>}
          {!loading && items.length === 0 && (
            <EmptyState title="Пока нет overrides" />
          )}
          {!loading && items.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  {['Тенант', 'Статус', 'Variant', ''].map((h) => (
                    <th key={h} style={cellHeader}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} style={{ borderTop: '1px solid #e2e8f0' }}>
                    <td style={cell}>
                      <div style={{ fontWeight: 600 }}>{it.tenant_name || '—'}</div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>
                        {it.tenant_slug || it.tenant_id}
                      </div>
                    </td>
                    <td style={cell}>
                      <Chip tone={it.enabled ? 'success' : 'neutral'}>
                        {it.enabled ? 'ON' : 'OFF'}
                      </Chip>
                    </td>
                    <td style={cell}>{it.variant || '—'}</td>
                    <td style={cell}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setOverride(it.tenant_id, !it.enabled, it.variant)}
                        >
                          Переключить
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => removeOverride(it.tenant_id)}
                        >
                          Снять
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Overlay>
  )
}

// ── Локальные UI-примитивы ─────────────────────────────────────────────────

function Overlay({ children, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
        display: 'flex', justifyContent: 'flex-end', alignItems: 'stretch',
        zIndex: 1000,
      }}
    >
      {children}
    </div>
  )
}

const modalBox = {
  background: '#fff', borderRadius: 12, padding: 24, width: '100%',
  maxWidth: 540, margin: 'auto', boxShadow: '0 16px 48px rgba(15,23,42,0.25)',
  display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '90vh',
  overflowY: 'auto',
}

const drawerBox = {
  background: '#fff', width: '100%', maxWidth: 640, height: '100%',
  boxShadow: '-16px 0 48px rgba(15,23,42,0.25)', padding: 24,
  overflowY: 'auto',
}

const inputStyle = {
  width: '100%', padding: '8px 12px', fontSize: 14, border: '1px solid #cbd5e1',
  borderRadius: 8, background: '#fff', color: '#0f172a', boxSizing: 'border-box',
}

function Field({ label, children, disabled }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, opacity: disabled ? 0.6 : 1 }}>
      <span style={{ fontSize: 12, color: '#475569', fontWeight: 600 }}>{label}</span>
      {children}
    </div>
  )
}
