/**
 * BenefitsBulletEditor — редактор списка строк-привилегий, которые
 * пациент видит на карточке тарифа.
 *
 * Props: { value: string[], onChange: (string[]) => void }
 */
import { memo, useState } from 'react'

function BenefitsBulletEditor({ value, onChange }) {
  const items = Array.isArray(value) ? value : []
  const [draft, setDraft] = useState('')

  const add = () => {
    const v = draft.trim()
    if (!v) return
    onChange([...items, v])
    setDraft('')
  }

  const update = (idx, v) => {
    const next = items.slice()
    next[idx] = v
    onChange(next)
  }

  const remove = (idx) => {
    onChange(items.filter((_, i) => i !== idx))
  }

  const move = (idx, dir) => {
    const next = items.slice()
    const target = idx + dir
    if (target < 0 || target >= next.length) return
    ;[next[idx], next[target]] = [next[target], next[idx]]
    onChange(next)
  }

  return (
    <div>
      {items.length === 0 && (
        <div style={{ padding: 12, textAlign: 'center', fontSize: 13, color: 'var(--fg-2)', fontStyle: 'italic' }}>
          Список пуст. Добавьте первую привилегию ниже.
        </div>
      )}
      {items.map((item, idx) => (
        <div key={idx} style={{
          display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6,
          padding: '6px 8px', background: 'var(--bg-2, rgba(0,0,0,.02))', borderRadius: 8,
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#10b981' }}>check_circle</span>
          <input
            type="text"
            value={item}
            onChange={e => update(idx, e.target.value)}
            placeholder="Текст привилегии"
            style={{
              flex: 1, border: 0, background: 'transparent', outline: 'none',
              fontSize: 13, color: 'var(--fg)',
            }}
          />
          <button
            type="button" onClick={() => move(idx, -1)} disabled={idx === 0}
            title="Вверх"
            style={{ border: 0, background: 'transparent', cursor: idx === 0 ? 'default' : 'pointer', padding: 2, opacity: idx === 0 ? 0.3 : 0.7 }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>arrow_upward</span>
          </button>
          <button
            type="button" onClick={() => move(idx, +1)} disabled={idx === items.length - 1}
            title="Вниз"
            style={{ border: 0, background: 'transparent', cursor: idx === items.length - 1 ? 'default' : 'pointer', padding: 2, opacity: idx === items.length - 1 ? 0.3 : 0.7 }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>arrow_downward</span>
          </button>
          <button
            type="button" onClick={() => remove(idx)}
            title="Удалить"
            style={{ border: 0, background: 'transparent', cursor: 'pointer', padding: 2, color: '#ef4444' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>delete</span>
          </button>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <input
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder="Добавить привилегию и нажать Enter"
          style={{
            flex: 1, padding: '8px 10px',
            border: '1px solid var(--line)', borderRadius: 8,
            background: 'var(--bg)', fontSize: 13, color: 'var(--fg)',
          }}
        />
        <button
          type="button" onClick={add}
          style={{
            padding: '8px 14px', border: 0, borderRadius: 8,
            background: 'var(--brand, #0097A7)', color: '#fff', fontWeight: 600,
            cursor: 'pointer', fontSize: 13,
          }}
        >
          + Добавить
        </button>
      </div>
    </div>
  )
}

export default memo(BenefitsBulletEditor)
