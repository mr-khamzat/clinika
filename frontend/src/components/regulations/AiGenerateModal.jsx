// ============================================================
// AiGenerateModal — модалка генерации шаблона регламента через AI.
// POST /admin/regulations/ai-generate  body: {topic, role, language, existing_steps?}
// Возвращает { title, description, category, steps:[] }
// При ошибке backend может вернуть rule-based ответ + badge "AI недоступен".
//
// Props:
//   open                    — boolean
//   onClose                 — () => void
//   onInsert(steps, mode)   — mode: 'replace' | 'append'
//   onApplyMeta(meta)       — опционально подменить title/desc/category
//   existingSteps           — текущий список шагов (для контекста модели)
//   defaultRole             — роль "для кого", если уже выбрана в sidebar
// ============================================================
import { useState } from 'react'
import api from '../../api'
import { useToast } from '../../design'

// Список ролей — синхронизирован с RegulationBuilderSection.
const ROLES = [
  { value: 'manager',   label: 'Управляющая клиники' },
  { value: 'reg',       label: 'Регистратура' },
  { value: 'doctor',    label: 'Врач' },
  { value: 'nurse',     label: 'Медсестра' },
  { value: 'recruiter', label: 'Рекрутер' },
  { value: 'admin',     label: 'Администратор клиники' },
  { value: 'franchise_owner', label: 'Владелец франшизы' },
]

export default function AiGenerateModal({
  open,
  onClose,
  onInsert,
  onApplyMeta,
  existingSteps = [],
  defaultRole = 'reg',
}) {
  const { toast } = useToast()
  const [topic, setTopic] = useState('')
  const [role, setRole] = useState(defaultRole || 'reg')
  const [context, setContext] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)   // { title, description, category, steps, _fallback? }
  const [insertMode, setInsertMode] = useState('append') // 'append' | 'replace'

  if (!open) return null

  // ── Сгенерировать ──────────────────────────────────────────
  async function generate() {
    if (!topic.trim()) {
      toast('Укажите тему регламента', 'warn')
      return
    }
    setBusy(true)
    setResult(null)
    try {
      const r = await api.post('/admin/regulations/ai-generate', {
        topic: topic.trim(),
        role,
        language: 'ru',
        // Бэк может использовать существующие шаги как контекст,
        // чтобы не дублировать формулировки.
        existing_steps: existingSteps.slice(0, 20).map(s => ({ type: s.type, content: s.content })),
        context: context.trim() || undefined,
      })
      setResult(r.data || null)
      if (!r.data || !Array.isArray(r.data.steps) || r.data.steps.length === 0) {
        toast('AI вернул пустой результат', 'warn')
      }
    } catch (e) {
      toast('Ошибка AI-генерации: ' + (e?.response?.data?.detail || e.message), 'error')
    }
    setBusy(false)
  }

  // ── Вставить в редактор ────────────────────────────────────
  function insert() {
    if (!result || !Array.isArray(result.steps)) return
    onInsert?.(result.steps, insertMode)
    if (onApplyMeta && (result.title || result.description || result.category)) {
      onApplyMeta({
        title: result.title,
        description: result.description,
        category: result.category,
      })
    }
    onClose?.()
  }

  return (
    <div className="reg-backdrop" onClick={onClose}>
      <div className="reg-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620 }}>
        <h3>
          <span className="material-symbols-outlined" style={{ verticalAlign: 'middle', marginRight: 6, color: '#7c3aed' }}>
            auto_awesome
          </span>
          AI-генерация регламента
        </h3>
        <p className="reg-modal-sub">
          Опишите тему — модель предложит структуру (шаги, чек-листы, действия).
          Вы сможете отредактировать результат перед сохранением.
        </p>

        {/* Форма ввода */}
        {!result && (
          <>
            <div className="reg-field">
              <h4>Тема регламента</h4>
              <input
                className="reg-input"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Например: Приём первичного пациента"
                autoFocus
              />
            </div>
            <div className="reg-field">
              <h4>Для кого</h4>
              <select className="reg-select" value={role} onChange={(e) => setRole(e.target.value)}>
                {ROLES.map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
            <div className="reg-field">
              <h4>Контекст (необязательно)</h4>
              <textarea
                className="reg-textarea"
                rows={3}
                value={context}
                onChange={(e) => setContext(e.target.value)}
                placeholder="Особенности клиники, специфика процесса…"
              />
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
              <button className="reg-tool-btn" onClick={onClose} disabled={busy}>Отмена</button>
              <button className="reg-tool-btn reg-ai" onClick={generate} disabled={busy}>
                <span className="material-symbols-outlined">
                  {busy ? 'progress_activity' : 'auto_awesome'}
                </span>
                {busy ? 'Генерирую…' : 'Сгенерировать'}
              </button>
            </div>
          </>
        )}

        {/* Превью результата */}
        {result && (
          <>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: '#1f2937' }}>
                {result.title || 'Без названия'}
                {result._fallback || result.fallback ? (
                  <span className="reg-ai-badge">
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>cloud_off</span>
                    AI недоступен, шаблон
                  </span>
                ) : null}
              </div>
              {result.description && (
                <div style={{ color: '#6b7280', fontSize: 13, marginTop: 4 }}>{result.description}</div>
              )}
              {result.category && (
                <div style={{ marginTop: 6 }}>
                  <span className="reg-chip reg-chip-draft">{result.category}</span>
                </div>
              )}
            </div>

            <div style={{
              border: '1px solid #ececec',
              borderRadius: 12,
              padding: 10,
              maxHeight: '40vh',
              overflow: 'auto',
              background: '#fafafa',
            }}>
              {(result.steps || []).map((s, i) => (
                <div key={i} style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'flex-start',
                  padding: '6px 4px',
                  borderBottom: '1px solid #f0f0f0',
                }}>
                  <span style={{
                    fontSize: 11,
                    background: '#eef2ff',
                    color: '#4338ca',
                    padding: '2px 6px',
                    borderRadius: 6,
                    flexShrink: 0,
                  }}>
                    {s.type || 'text'}
                  </span>
                  <span style={{ fontSize: 13, color: '#374151', whiteSpace: 'pre-wrap' }}>
                    {s.content}
                    {s.required ? ' *' : ''}
                  </span>
                </div>
              ))}
              {(!result.steps || result.steps.length === 0) && (
                <div style={{ color: '#9ca3af', fontSize: 13, padding: 8 }}>
                  Шагов нет — попробуйте уточнить тему.
                </div>
              )}
            </div>

            <div className="reg-field" style={{ marginTop: 14 }}>
              <h4>Как вставить</h4>
              <label className="reg-checkrow">
                <input
                  type="radio"
                  name="reg-ai-mode"
                  checked={insertMode === 'append'}
                  onChange={() => setInsertMode('append')}
                />
                Добавить в конец списка
              </label>
              <label className="reg-checkrow">
                <input
                  type="radio"
                  name="reg-ai-mode"
                  checked={insertMode === 'replace'}
                  onChange={() => setInsertMode('replace')}
                />
                Заменить текущие шаги
              </label>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 8 }}>
              <button className="reg-tool-btn" onClick={() => setResult(null)} disabled={busy}>
                <span className="material-symbols-outlined">refresh</span>
                Перегенерировать
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="reg-tool-btn" onClick={onClose}>Отмена</button>
                <button className="reg-tool-btn reg-ai" onClick={insert}>
                  <span className="material-symbols-outlined">playlist_add</span>
                  Вставить в редактор
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
