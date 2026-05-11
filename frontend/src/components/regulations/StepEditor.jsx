// ============================================================
// StepEditor — редактор одного шага регламента.
// Используется в конструкторе RegulationBuilderSection.
// Props:
//   step       — { order, type, content, required }
//   onChange   — (patch) => void   (частичное обновление полей)
//   onDelete   — () => void
//   onMoveUp   — () => void
//   onMoveDown — () => void
//   isFirst / isLast — отключают кнопки перемещения
//   dragHandlers — { onDragStart, onDragOver, onDrop, onDragEnd, isDragOver }
// ============================================================
import { useEffect, useRef } from 'react'

// Карта иконок и подписей типов шага.
const TYPE_META = {
  text:     { icon: 'subject',         label: 'Текст' },
  checkbox: { icon: 'check_box',       label: 'Чек-бокс' },
  action:   { icon: 'bolt',            label: 'Действие' },
  file:     { icon: 'attach_file',     label: 'Файл' },
}

export default function StepEditor({
  step,
  index,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
  dragHandlers = {},
}) {
  const meta = TYPE_META[step.type] || TYPE_META.text
  const textareaRef = useRef(null)

  // ── Auto-resize textarea под содержимое ──
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 320) + 'px'
  }, [step.content])

  const placeholderByType = {
    text:     'Опишите контекст или пояснение…',
    checkbox: 'Сформулируйте пункт чек-листа…',
    action:   'Что нужно сделать? (глагол в инфинитиве)',
    file:     'Название документа или ссылка…',
  }

  return (
    <div
      className={`reg-step reg-type-${step.type}${dragHandlers.isDragOver ? ' reg-drag-over' : ''}`}
      draggable
      onDragStart={dragHandlers.onDragStart}
      onDragOver={dragHandlers.onDragOver}
      onDrop={dragHandlers.onDrop}
      onDragEnd={dragHandlers.onDragEnd}
      onDragLeave={dragHandlers.onDragLeave}
    >
      {/* Колонка-ручка: drag + порядковый номер */}
      <div className="reg-step-handle" title="Перетащите для изменения порядка">
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>drag_indicator</span>
        <span style={{ fontSize: 11, color: '#9ca3af' }}>{index + 1}</span>
        <span className="reg-step-icon" title={meta.label} style={{ marginTop: 6 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{meta.icon}</span>
        </span>
      </div>

      {/* Тело: textarea + признаки */}
      <div className="reg-step-body">
        <textarea
          ref={textareaRef}
          className="reg-textarea"
          value={step.content || ''}
          onChange={(e) => onChange({ content: e.target.value })}
          placeholder={placeholderByType[step.type] || placeholderByType.text}
          rows={1}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 13, color: '#6b7280' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={!!step.required}
              onChange={(e) => onChange({ required: e.target.checked })}
            />
            обязательный
          </label>
          {/* Сменить тип шага inline без удаления контента */}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            тип:
            <select
              className="reg-select"
              style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }}
              value={step.type}
              onChange={(e) => onChange({ type: e.target.value })}
            >
              <option value="text">текст</option>
              <option value="checkbox">чек-бокс</option>
              <option value="action">действие</option>
              <option value="file">файл</option>
            </select>
          </label>
        </div>
      </div>

      {/* Управление шагом */}
      <div className="reg-step-controls">
        <button className="reg-icon-btn" onClick={onMoveUp} disabled={isFirst} title="Выше">
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>keyboard_arrow_up</span>
        </button>
        <button className="reg-icon-btn" onClick={onMoveDown} disabled={isLast} title="Ниже">
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>keyboard_arrow_down</span>
        </button>
        <button className="reg-icon-btn danger" onClick={onDelete} title="Удалить шаг">
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>delete</span>
        </button>
      </div>
    </div>
  )
}
