/**
 * FeaturesToggleList — фиксированный список привилегий тарифа подписки.
 *
 * Используется внутри PlanEditorModal. Управляет объектом features:
 *   {
 *     unlimited_chat: bool,
 *     discount_percent: 0..50,
 *     family_members_allowed: 0..10,
 *     telemedicine_unlimited: bool,
 *     priority_booking: bool,
 *     monthly_supply: bool,
 *   }
 */
import { memo } from 'react'

const TOGGLE_FIELDS = [
  { key: 'unlimited_chat',          icon: 'chat',              label: 'Безлимитный чат с врачом' },
  { key: 'telemedicine_unlimited',  icon: 'videocam',          label: 'Безлимитная телемедицина' },
  { key: 'priority_booking',        icon: 'flash_on',          label: 'Приоритет записи' },
  { key: 'monthly_supply',          icon: 'inventory_2',       label: 'Ежемесячный расходник' },
]

function Row({ children }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 12px',
        borderRadius: 10,
        background: 'var(--bg-2, rgba(0,0,0,.02))',
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  )
}

function Toggle({ value, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      style={{
        width: 44,
        height: 24,
        borderRadius: 12,
        border: 0,
        position: 'relative',
        cursor: 'pointer',
        background: value ? '#10b981' : '#cbd5e1',
        transition: 'background .2s',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: value ? 22 : 2,
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,.2)',
          transition: 'left .2s',
        }}
      />
    </button>
  )
}

function FeaturesToggleList({ value, onChange }) {
  const features = value || {}
  const set = (k, v) => onChange({ ...features, [k]: v })

  return (
    <div>
      {TOGGLE_FIELDS.map(f => (
        <Row key={f.key}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 20, color: 'var(--fg-2)' }}>{f.icon}</span>
            <span style={{ fontSize: 14, color: 'var(--fg)' }}>{f.label}</span>
          </div>
          <Toggle value={!!features[f.key]} onChange={v => set(f.key, v)} />
        </Row>
      ))}

      {/* Скидка на приёмы — slider 0-50% */}
      <Row>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 20, color: 'var(--fg-2)' }}>percent</span>
          <span style={{ fontSize: 14, color: 'var(--fg)' }}>Скидка на приёмы</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="range"
            min={0} max={50} step={1}
            value={features.discount_percent ?? 0}
            onChange={e => set('discount_percent', Number(e.target.value))}
            style={{ width: 100 }}
          />
          <span style={{ minWidth: 32, textAlign: 'right', fontFeatureSettings: '"tnum"', fontSize: 13, fontWeight: 600 }}>
            {features.discount_percent ?? 0}%
          </span>
        </div>
      </Row>

      {/* Кол-во членов семьи */}
      <Row>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 20, color: 'var(--fg-2)' }}>family_restroom</span>
          <span style={{ fontSize: 14, color: 'var(--fg)' }}>Членов семьи в подписке</span>
        </div>
        <input
          type="number"
          min={0} max={10}
          value={features.family_members_allowed ?? 1}
          onChange={e => set('family_members_allowed', Math.max(0, Math.min(10, Number(e.target.value) || 0)))}
          style={{
            width: 64, padding: '6px 8px', textAlign: 'center',
            border: '1px solid var(--line)', borderRadius: 8, background: 'var(--bg)',
            fontSize: 13, fontWeight: 600,
          }}
        />
      </Row>
    </div>
  )
}

export default memo(FeaturesToggleList)
