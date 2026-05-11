// ============================================================================
// FamilyMemberCard — карточка одного члена семьи
// ============================================================================
//
// Используется в PatientFamilySection.
//
// props:
//   member: {
//     member_id, patient_id, full_name, relation, birth_date?,
//     can_view_records, can_book_appointments, can_manage_payments,
//     is_self, added_at
//   }
//   onPermChange(field, value)  — изменение прав (3 чекбокса)
//   onRelationChange(relation)   — изменение типа родства
//   onSwitch()                   — переключение контекста
//   onRemove()                   — удаление
// ============================================================================

import { useState, useMemo } from 'react'

// ── Каталог типов родства с цветной палитрой ────────────────────────────────
// Цвета подобраны под общую тему PatientCabinet (тёплая, эмоциональная).
const RELATION_META = {
  self:    { label: 'Это вы',  bg: '#E0F2FE', fg: '#0369A1', icon: 'person'             },
  spouse:  { label: 'Супруг',  bg: '#FCE7F3', fg: '#9D174D', icon: 'favorite'           },
  child:   { label: 'Ребёнок', bg: '#FEF3C7', fg: '#92400E', icon: 'child_care'         },
  parent:  { label: 'Родитель',bg: '#DBEAFE', fg: '#1E40AF', icon: 'elderly'            },
  father:  { label: 'Отец',    bg: '#DBEAFE', fg: '#1E40AF', icon: 'man'                },
  mother:  { label: 'Мать',    bg: '#DBEAFE', fg: '#1E40AF', icon: 'woman'              },
  brother: { label: 'Брат',    bg: '#D1FAE5', fg: '#065F46', icon: 'group'              },
  sister:  { label: 'Сестра',  bg: '#D1FAE5', fg: '#065F46', icon: 'group'              },
  other:   { label: 'Другое',  bg: '#E5E7EB', fg: '#374151', icon: 'group'              },
}

const RELATIONS_LIST = ['spouse', 'child', 'parent', 'father', 'mother', 'brother', 'sister', 'other']

function getRelationMeta(rel) {
  return RELATION_META[rel] || RELATION_META.other
}

// ── Возраст из birth_date ────────────────────────────────────────────────────
function computeAge(birthDate) {
  if (!birthDate) return null
  try {
    const d = new Date(birthDate)
    if (isNaN(d.getTime())) return null
    const now = new Date()
    let age = now.getFullYear() - d.getFullYear()
    const m = now.getMonth() - d.getMonth()
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--
    return age
  } catch { return null }
}

function ageLabel(age) {
  if (age == null || age < 0) return ''
  const mod10 = age % 10
  const mod100 = age % 100
  if (mod10 === 1 && mod100 !== 11) return `${age} год`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${age} года`
  return `${age} лет`
}

// ── Инициалы для аватара ────────────────────────────────────────────────────
function initialsOf(name) {
  if (!name) return '?'
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase()
}

// ── Чекбокс с лейблом и иконкой ─────────────────────────────────────────────
function PermRow({ icon, label, checked, disabled, onChange }) {
  return (
    <label className={`flex items-center gap-2 py-1 text-xs select-none ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
      <span className="material-symbols-outlined text-base flex-shrink-0" style={{ color: checked ? '#0097A7' : '#9CA3AF' }}>
        {icon}
      </span>
      <span className="flex-1 truncate" style={{ color: checked ? '#0A2342' : '#6B7280' }}>{label}</span>
      <input
        type="checkbox"
        checked={!!checked}
        disabled={disabled}
        onChange={e => onChange(e.target.checked)}
        className="w-4 h-4 rounded accent-cyan-600"
      />
    </label>
  )
}

// ── Основной компонент карточки ─────────────────────────────────────────────
export default function FamilyMemberCard({ member, onPermChange, onRelationChange, onSwitch, onRemove }) {
  const [relationOpen, setRelationOpen] = useState(false)
  const isSelf = !!member.is_self
  const rel = isSelf ? 'self' : (member.relation || 'other')
  const meta = useMemo(() => getRelationMeta(rel), [rel])
  const age = useMemo(() => computeAge(member.birth_date), [member.birth_date])

  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 hover:shadow-md transition-all flex flex-col gap-3">
      {/* ── Шапка: аватар + ФИО + relation ── */}
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 font-bold text-white"
             style={{ background: `linear-gradient(135deg, ${meta.fg}, ${meta.fg}AA)` }}>
          {initialsOf(member.full_name)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 flex-wrap">
            <p className="font-bold text-sm truncate" style={{ color: '#0A2342' }}>
              {member.full_name || 'Без имени'}
            </p>
            {isSelf && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                    style={{ background: '#E0F2FE', color: '#0369A1' }}>
                Это вы
              </span>
            )}
          </div>
          {/* Relation badge — кликабельный для не-self */}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {isSelf ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full"
                    style={{ background: meta.bg, color: meta.fg }}>
                <span className="material-symbols-outlined text-xs">{meta.icon}</span>
                {meta.label}
              </span>
            ) : (
              <button
                onClick={() => setRelationOpen(o => !o)}
                className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full hover:opacity-80 transition-opacity"
                style={{ background: meta.bg, color: meta.fg }}>
                <span className="material-symbols-outlined text-xs">{meta.icon}</span>
                {meta.label}
                <span className="material-symbols-outlined text-xs ml-0.5">expand_more</span>
              </button>
            )}
            {age != null && (
              <span className="text-[11px] text-gray-500">{ageLabel(age)}</span>
            )}
          </div>

          {/* Список вариантов relation (раскрывается по клику на бейдж) */}
          {relationOpen && !isSelf && (
            <div className="mt-2 flex flex-wrap gap-1">
              {RELATIONS_LIST.map(r => {
                const m = getRelationMeta(r)
                const active = r === rel
                return (
                  <button key={r}
                    onClick={() => { onRelationChange(r); setRelationOpen(false) }}
                    className="text-[10px] font-semibold px-2 py-0.5 rounded-full transition-all"
                    style={{
                      background: active ? m.fg : m.bg,
                      color: active ? '#fff' : m.fg,
                    }}>
                    {m.label}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Разрешения ── */}
      <div className="border-t border-gray-100 pt-2">
        <PermRow
          icon="visibility"
          label="Видеть записи"
          checked={isSelf ? true : !!member.can_view_records}
          disabled={isSelf}
          onChange={(v) => onPermChange('can_view_records', v)}
        />
        <PermRow
          icon="event_available"
          label="Записывать на приём"
          checked={isSelf ? true : !!member.can_book_appointments}
          disabled={isSelf}
          onChange={(v) => onPermChange('can_book_appointments', v)}
        />
        <PermRow
          icon="payments"
          label="Управлять платежами"
          checked={isSelf ? true : !!member.can_manage_payments}
          disabled={isSelf}
          onChange={(v) => onPermChange('can_manage_payments', v)}
        />
      </div>

      {/* ── Действия ── */}
      {!isSelf && (
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={onSwitch}
            className="flex-1 py-2 rounded-xl text-xs font-bold transition-all active:scale-95 flex items-center justify-center gap-1"
            style={{ background: 'linear-gradient(135deg,#0097A7,#0A2342)', color: '#fff' }}>
            <span className="material-symbols-outlined text-base">swap_horiz</span>
            Переключиться
          </button>
          <button
            onClick={onRemove}
            title="Удалить из семьи"
            className="p-2 rounded-xl text-rose-500 hover:bg-rose-50 transition-all">
            <span className="material-symbols-outlined text-lg">delete</span>
          </button>
        </div>
      )}
    </div>
  )
}
