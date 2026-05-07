/**
 * ========================================
 * БЛОК: ClinicScopeSelector — селектор клиники для аналитики
 * ========================================
 * Поведение:
 *   • clinics.length <= 1 → рендерится только лейбл «Клиника: <name>»
 *     (без выпадающего select).
 *   • clinics.length > 1  → select с переключением.
 *   • Опция «Все клиники» добавляется только если allowAll=true (manager без
 *     user.clinic_id или franchise_owner).
 *
 * Используется в LtvAnalyticsSection и ManagerAnalytics-page.
 * ========================================
 */
import { useMemo } from 'react'

export default function ClinicScopeSelector({
  clinics = [],
  selectedId = '',
  onChange,
  allowAll = false,
  className = '',
}) {
  const single = clinics.length <= 1
  const currentName = useMemo(() => {
    if (!selectedId) return 'Все клиники'
    const c = clinics.find((x) => x.id === selectedId)
    return c?.name || '—'
  }, [clinics, selectedId])

  // Один вариант — статичный label без выпадашки
  if (single) {
    const only = clinics[0]
    return (
      <div
        className={className}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderRadius: 10,
          background: 'var(--bg-1)',
          border: '1px solid var(--border)',
          fontSize: 13,
          color: 'var(--fg-2)',
        }}
        title={only?.name || ''}
      >
        <span
          className="material-symbols-outlined"
          style={{ fontSize: 18, color: 'var(--accent)', fontVariationSettings: "'FILL' 1" }}
        >
          business
        </span>
        <span style={{ color: 'var(--fg-3)' }}>Клиника:</span>
        <span style={{ color: 'var(--fg)', fontWeight: 600 }}>
          {only?.name || '—'}
        </span>
      </div>
    )
  }

  // Несколько клиник — select
  return (
    <div
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px 6px 12px',
        borderRadius: 10,
        background: 'var(--bg-1)',
        border: '1px solid var(--border)',
      }}
    >
      <span
        className="material-symbols-outlined"
        style={{ fontSize: 18, color: 'var(--accent)', fontVariationSettings: "'FILL' 1" }}
      >
        business
      </span>
      <span style={{ color: 'var(--fg-3)', fontSize: 13 }}>Клиника:</span>
      <select
        value={selectedId}
        onChange={(e) => onChange?.(e.target.value)}
        style={{
          appearance: 'none',
          WebkitAppearance: 'none',
          background: 'transparent',
          border: 'none',
          color: 'var(--fg)',
          fontWeight: 600,
          fontSize: 13,
          cursor: 'pointer',
          paddingRight: 16,
          maxWidth: 240,
        }}
        title={currentName}
      >
        {allowAll && <option value="">Все клиники</option>}
        {clinics.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  )
}
