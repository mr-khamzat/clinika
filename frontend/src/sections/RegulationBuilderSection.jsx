// ============================================================
// RegulationBuilderSection — конструктор регламента.
// URL-контракт: ?reg=<id> или ?reg=new (или prop regulationId).
// Доступ: franchise_owner, super_admin.
//
// Layout: 2 колонки
//   • Слева 320px — метаданные (title/desc/category/roles) + версии + действия
//   • Справа — конструктор шагов с панелью добавления + AI
//
// Шаги: {order, type:'text'|'checkbox'|'action'|'file', content, required}.
// Сохранение draft:  POST /admin/regulations (новый)  ИЛИ
//                    POST /admin/regulations/{id}/versions (новая draft версия).
// Публикация:        POST /admin/regulations/{id}/versions/{version_id}/publish.
// Метаданные:        PATCH /admin/regulations/{id}.
// ============================================================
import { useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react'
import api from '../api'
import { useToast, useConfirm } from '../design'
import StepEditor from '../components/regulations/StepEditor'
import VersionsTimeline from '../components/regulations/VersionsTimeline'
import './regulations.css'

const AiGenerateModal = lazy(() => import('../components/regulations/AiGenerateModal'))

// Категории + кастомная.
const CATEGORIES = [
  'Регистратура',
  'Врачи',
  'Менеджмент',
  'Финансы',
  'Маркетинг',
  'Технические',
  'Качество',
  'HR',
  'Прочее',
]

// Роли — выровнены с AiGenerateModal и системными ролями Клиники.
const ROLES = [
  { value: 'manager',         label: 'Управляющая' },
  { value: 'reg',             label: 'Регистратура' },
  { value: 'doctor',          label: 'Врачи' },
  { value: 'nurse',           label: 'Медсёстры' },
  { value: 'recruiter',       label: 'Рекрутер' },
  { value: 'admin',           label: 'Администратор клиники' },
  { value: 'franchise_owner', label: 'Владелец франшизы' },
]

// Утилиты ────────────────────────────────────────────────────
function newStep(type = 'text') {
  return {
    // временный фронт-айди, бэк выдаст реальный при сохранении
    _tmpId: Math.random().toString(36).slice(2),
    type,
    content: '',
    required: type === 'checkbox' || type === 'action',
  }
}

function reorder(arr) {
  return arr.map((s, i) => ({ ...s, order: i }))
}

function getRegIdFromUrl() {
  try {
    const url = new URL(window.location.href)
    const v = url.searchParams.get('reg')
    if (!v || v === 'new') return null
    return v
  } catch { return null }
}

export default function RegulationBuilderSection({ regulationId: propId, onBack }) {
  const { toast } = useToast()
  const { confirm, ConfirmHost } = useConfirm()

  // ── id из props или query ─────────────────────────────────
  const [id, setId] = useState(propId ?? getRegIdFromUrl())

  // ── Метаданные ────────────────────────────────────────────
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('Прочее')
  const [customCategory, setCustomCategory] = useState('')
  const [assignedRoles, setAssignedRoles] = useState([])
  const [status, setStatus] = useState('draft')

  // ── Версии ────────────────────────────────────────────────
  const [versions, setVersions] = useState([])
  const [currentVersionId, setCurrentVersionId] = useState(null)
  const [changelog, setChangelog] = useState('')

  // ── Шаги ──────────────────────────────────────────────────
  const [steps, setSteps] = useState([])

  // ── UI-состояние ─────────────────────────────────────────
  const [loading, setLoading] = useState(!!id)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [dirty, setDirty] = useState(false)

  // ── Drag-and-drop state ──────────────────────────────────
  const dragIdx = useRef(null)
  const [dragOverIdx, setDragOverIdx] = useState(null)

  // ── Загрузка при наличии id ──────────────────────────────
  useEffect(() => {
    if (!id) {
      setLoading(false)
      return
    }
    let cancel = false
    setLoading(true)
    api.get(`/admin/regulations/${id}`)
      .then(r => {
        if (cancel) return
        const d = r.data || {}
        setTitle(d.title || '')
        setDescription(d.description || '')
        // Если категория не в списке — считаем custom
        if (d.category && !CATEGORIES.includes(d.category)) {
          setCategory('__custom__')
          setCustomCategory(d.category)
        } else {
          setCategory(d.category || 'Прочее')
        }
        setAssignedRoles(Array.isArray(d.assigned_roles) ? d.assigned_roles : [])
        setStatus(d.status || 'draft')
        setVersions(d.versions || [])
        setCurrentVersionId(d.current_version_id || null)
        const content = Array.isArray(d.current_version_content) ? d.current_version_content : []
        setSteps(reorder(content.map(s => ({
          _tmpId: Math.random().toString(36).slice(2),
          type: s.type || 'text',
          content: s.content || '',
          required: !!s.required,
        }))))
        setDirty(false)
      })
      .catch(e => {
        toast('Не удалось загрузить регламент: ' + (e?.response?.data?.detail || e.message), 'error')
      })
      .finally(() => { if (!cancel) setLoading(false) })
    return () => { cancel = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // ── Эффективная категория ────────────────────────────────
  const effectiveCategory = useMemo(() => (
    category === '__custom__' ? (customCategory || '').trim() : category
  ), [category, customCategory])

  // ── Шаги: операции ───────────────────────────────────────
  function addStep(type) {
    setSteps(s => reorder([...s, newStep(type)]))
    setDirty(true)
  }
  function updateStep(idx, patch) {
    setSteps(s => s.map((st, i) => i === idx ? { ...st, ...patch } : st))
    setDirty(true)
  }
  function deleteStep(idx) {
    setSteps(s => reorder(s.filter((_, i) => i !== idx)))
    setDirty(true)
  }
  function moveStep(idx, delta) {
    setSteps(s => {
      const target = idx + delta
      if (target < 0 || target >= s.length) return s
      const copy = s.slice()
      const [m] = copy.splice(idx, 1)
      copy.splice(target, 0, m)
      return reorder(copy)
    })
    setDirty(true)
  }

  // ── DnD-обработчики (нативный HTML5) ─────────────────────
  function makeDragHandlers(idx) {
    return {
      onDragStart: (e) => {
        dragIdx.current = idx
        e.dataTransfer.effectAllowed = 'move'
        try { e.dataTransfer.setData('text/plain', String(idx)) } catch {}
      },
      onDragOver: (e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        if (dragOverIdx !== idx) setDragOverIdx(idx)
      },
      onDragLeave: () => {
        if (dragOverIdx === idx) setDragOverIdx(null)
      },
      onDrop: (e) => {
        e.preventDefault()
        const from = dragIdx.current
        const to = idx
        dragIdx.current = null
        setDragOverIdx(null)
        if (from == null || from === to) return
        setSteps(s => {
          const copy = s.slice()
          const [m] = copy.splice(from, 1)
          copy.splice(to, 0, m)
          return reorder(copy)
        })
        setDirty(true)
      },
      onDragEnd: () => {
        dragIdx.current = null
        setDragOverIdx(null)
      },
      isDragOver: dragOverIdx === idx,
    }
  }

  // ── Сериализация шагов для бэка ──────────────────────────
  function serializeSteps() {
    return steps.map((s, i) => ({
      order: i,
      type: s.type,
      content: s.content || '',
      required: !!s.required,
    }))
  }

  // ── Валидация ────────────────────────────────────────────
  function validate() {
    if (!title.trim()) { toast('Укажите название регламента', 'warn'); return false }
    if (!effectiveCategory) { toast('Укажите категорию', 'warn'); return false }
    if (!steps.length) { toast('Добавьте хотя бы один шаг', 'warn'); return false }
    if (steps.some(s => !(s.content || '').trim())) {
      toast('Все шаги должны быть заполнены', 'warn')
      return false
    }
    return true
  }

  // ── Сохранить черновик ───────────────────────────────────
  // Если регламент новый — POST /admin/regulations c initial_steps.
  // Если уже существует — POST /admin/regulations/{id}/versions (новый draft).
  // А также PATCH метаданных, если они менялись.
  async function saveDraft() {
    if (!validate()) return
    setSaving(true)
    try {
      const payloadMeta = {
        title: title.trim(),
        description: description.trim(),
        category: effectiveCategory,
        assigned_roles: assignedRoles,
      }
      if (!id) {
        // Новый регламент: единым запросом
        const r = await api.post('/admin/regulations', {
          ...payloadMeta,
          initial_steps: serializeSteps(),
        })
        const newId = r.data?.id
        if (newId) {
          setId(String(newId))
          // обновим query, чтобы рефреш страницы оставлял на редактировании
          try {
            const url = new URL(window.location.href)
            url.searchParams.set('reg', String(newId))
            window.history.replaceState({}, '', url.toString())
          } catch {}
          // подгрузим версии
          await refetchOne(newId)
        }
        toast('Черновик создан', 'success')
      } else {
        // Существующий: метаданные + новая draft-версия
        await api.patch(`/admin/regulations/${id}`, payloadMeta)
        await api.post(`/admin/regulations/${id}/versions`, {
          content: serializeSteps(),
          changelog: changelog.trim() || undefined,
        })
        setChangelog('')
        await refetchOne(id)
        toast('Сохранено как черновик', 'success')
      }
      setDirty(false)
    } catch (e) {
      toast('Ошибка сохранения: ' + (e?.response?.data?.detail || e.message), 'error')
    }
    setSaving(false)
  }

  // ── Опубликовать новую версию ───────────────────────────
  async function publishNew() {
    if (!validate()) return
    if (!(await confirm('Опубликовать новую версию? Сотрудникам нужно будет её прочесть.', { okText: 'Опубликовать' }))) return
    setPublishing(true)
    try {
      let regId = id
      if (!regId) {
        // создаём новый регламент с initial_steps
        const r = await api.post('/admin/regulations', {
          title: title.trim(),
          description: description.trim(),
          category: effectiveCategory,
          assigned_roles: assignedRoles,
          initial_steps: serializeSteps(),
        })
        regId = String(r.data?.id || '')
        if (regId) {
          setId(regId)
          try {
            const url = new URL(window.location.href)
            url.searchParams.set('reg', regId)
            window.history.replaceState({}, '', url.toString())
          } catch {}
        }
      } else {
        await api.patch(`/admin/regulations/${id}`, {
          title: title.trim(),
          description: description.trim(),
          category: effectiveCategory,
          assigned_roles: assignedRoles,
        })
      }
      // создаём draft-версию
      const v = await api.post(`/admin/regulations/${regId}/versions`, {
        content: serializeSteps(),
        changelog: changelog.trim() || undefined,
      })
      const vid = v.data?.id
      if (!vid) throw new Error('Сервер не вернул id новой версии')
      // публикуем
      await api.post(`/admin/regulations/${regId}/versions/${vid}/publish`)
      setChangelog('')
      await refetchOne(regId)
      setDirty(false)
      toast('Версия опубликована', 'success')
    } catch (e) {
      toast('Не удалось опубликовать: ' + (e?.response?.data?.detail || e.message), 'error')
    }
    setPublishing(false)
  }

  // ── Опубликовать конкретную draft-версию (из таймлайна) ──
  async function publishVersion(versionId) {
    if (!id) return
    if (!(await confirm('Опубликовать эту версию?', { okText: 'Опубликовать' }))) return
    try {
      await api.post(`/admin/regulations/${id}/versions/${versionId}/publish`)
      toast('Версия опубликована', 'success')
      await refetchOne(id)
    } catch (e) {
      toast('Ошибка публикации: ' + (e?.response?.data?.detail || e.message), 'error')
    }
  }

  // ── Откат на старую опубликованную версию ────────────────
  // Создаёт новую draft на основе указанной версии — публикация делается отдельно.
  async function rollbackVersion(versionId) {
    if (!id) return
    if (!(await confirm('Создать новую draft-версию из выбранной?', { okText: 'Откатиться' }))) return
    try {
      // Загружаем подробности — нужен content
      const r = await api.get(`/admin/regulations/${id}`)
      // Бэк может вернуть массив версий с content, либо нужен отдельный endpoint.
      // Используем уже знакомый GET /admin/regulations/{id} — он отдаёт current_version_content
      // только для current. Поэтому полагаемся на специальный sub-route, если бэк его реализовал.
      let content = null
      try {
        const rv = await api.get(`/admin/regulations/${id}/versions/${versionId}`)
        content = Array.isArray(rv.data?.content) ? rv.data.content : null
      } catch {/* ignore – fallback ниже */}
      if (!content) {
        // Fallback: попросим бэк сделать копию серверной стороной
        await api.post(`/admin/regulations/${id}/versions/${versionId}/rollback`).catch(() => {})
        await refetchOne(id)
        toast('Создана draft-версия из выбранной', 'success')
        return
      }
      await api.post(`/admin/regulations/${id}/versions`, {
        content,
        changelog: 'Откат к версии #' + versionId,
      })
      await refetchOne(id)
      toast('Создана draft-версия из выбранной', 'success')
    } catch (e) {
      toast('Ошибка отката: ' + (e?.response?.data?.detail || e.message), 'error')
    }
  }

  // ── Просмотр старой версии (заполняет правую колонку read-only-подобно) ──
  async function previewVersion(versionId) {
    if (!id) return
    try {
      const rv = await api.get(`/admin/regulations/${id}/versions/${versionId}`)
      const content = Array.isArray(rv.data?.content) ? rv.data.content : []
      // Подменим шаги, пометим dirty=false как «предпросмотр»
      setSteps(reorder(content.map(s => ({
        _tmpId: Math.random().toString(36).slice(2),
        type: s.type || 'text',
        content: s.content || '',
        required: !!s.required,
      }))))
      toast(`Загружена v${rv.data?.version_number || ''} для просмотра`, 'info')
    } catch (e) {
      toast('Не удалось загрузить версию: ' + (e?.response?.data?.detail || e.message), 'error')
    }
  }

  // ── Помощник: перезагрузить ──────────────────────────────
  async function refetchOne(regId) {
    try {
      const r = await api.get(`/admin/regulations/${regId}`)
      const d = r.data || {}
      setVersions(d.versions || [])
      setCurrentVersionId(d.current_version_id || null)
      setStatus(d.status || 'draft')
    } catch {/* ignore */}
  }

  // ── AI: вставить результат в редактор ────────────────────
  function applyAiSteps(aiSteps, mode) {
    const cleaned = (aiSteps || []).map(s => ({
      _tmpId: Math.random().toString(36).slice(2),
      type: s.type || 'text',
      content: s.content || '',
      required: !!s.required,
    }))
    setSteps(prev => reorder(mode === 'replace' ? cleaned : [...prev, ...cleaned]))
    setDirty(true)
  }
  function applyAiMeta(meta) {
    if (!meta) return
    if (meta.title && !title.trim()) setTitle(meta.title)
    if (meta.description && !description.trim()) setDescription(meta.description)
    if (meta.category && CATEGORIES.includes(meta.category)) setCategory(meta.category)
    setDirty(true)
  }

  // ── Скелетон при загрузке ────────────────────────────────
  if (loading) {
    return (
      <div style={{ padding: 16 }}>
        <div className="reg-skel" style={{ height: 28, width: '40%', marginBottom: 14 }} />
        <div className="reg-builder-shell">
          <div className="reg-side">
            <div className="reg-skel" style={{ height: 20, marginBottom: 10 }} />
            <div className="reg-skel" style={{ height: 36, marginBottom: 10 }} />
            <div className="reg-skel" style={{ height: 72, marginBottom: 10 }} />
            <div className="reg-skel" style={{ height: 36, marginBottom: 10 }} />
            <div className="reg-skel" style={{ height: 120 }} />
          </div>
          <div className="reg-main">
            <div className="reg-skel" style={{ height: 36, width: 360, marginBottom: 12 }} />
            {[0,1,2].map(i => (
              <div key={i} className="reg-skel" style={{ height: 60, marginBottom: 10 }} />
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ── Render ───────────────────────────────────────────────
  return (
    <div style={{ padding: 16 }}>
      {ConfirmHost}

      {/* Заголовок */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {onBack && (
            <button className="reg-icon-btn" onClick={onBack} title="Назад">
              <span className="material-symbols-outlined">arrow_back</span>
            </button>
          )}
          <div>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#1f2937' }}>
              {id ? 'Редактирование регламента' : 'Новый регламент'}
            </h2>
            <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 13 }}>
              Конструктор SOP. Версии и публикация — в правой части блока «Метаданные».
            </p>
          </div>
          {dirty && (
            <span className="reg-chip reg-chip-draft" style={{ marginLeft: 8 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>edit</span>
              Есть несохранённые изменения
            </span>
          )}
          {status && (
            <span className={`reg-chip reg-chip-${status}`}>{status}</span>
          )}
        </div>
      </div>

      <div className="reg-builder-shell">
        {/* ───────── Sidebar: метаданные ───────── */}
        <aside className="reg-side">
          <div className="reg-field">
            <h4>Название</h4>
            <input
              className="reg-input"
              value={title}
              onChange={(e) => { setTitle(e.target.value); setDirty(true) }}
              placeholder="Например: Приём первичного пациента"
            />
          </div>
          <div className="reg-field">
            <h4>Описание</h4>
            <textarea
              className="reg-textarea"
              rows={3}
              value={description}
              onChange={(e) => { setDescription(e.target.value); setDirty(true) }}
              placeholder="Коротко, зачем нужен этот регламент"
            />
          </div>
          <div className="reg-field">
            <h4>Категория</h4>
            <select
              className="reg-select"
              value={category}
              onChange={(e) => { setCategory(e.target.value); setDirty(true) }}
            >
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              <option value="__custom__">Своя категория…</option>
            </select>
            {category === '__custom__' && (
              <input
                className="reg-input"
                style={{ marginTop: 6 }}
                value={customCategory}
                onChange={(e) => { setCustomCategory(e.target.value); setDirty(true) }}
                placeholder="Введите название категории"
              />
            )}
          </div>
          <div className="reg-field">
            <h4>Назначить ролям</h4>
            {ROLES.map(r => (
              <label key={r.value} className="reg-checkrow">
                <input
                  type="checkbox"
                  checked={assignedRoles.includes(r.value)}
                  onChange={(e) => {
                    setDirty(true)
                    setAssignedRoles(prev => e.target.checked
                      ? [...new Set([...prev, r.value])]
                      : prev.filter(x => x !== r.value))
                  }}
                />
                {r.label}
              </label>
            ))}
          </div>

          <div className="reg-field">
            <h4>Changelog (для новой версии)</h4>
            <textarea
              className="reg-textarea"
              rows={2}
              value={changelog}
              onChange={(e) => setChangelog(e.target.value)}
              placeholder="Что изменилось"
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
            <button className="reg-tool-btn" onClick={saveDraft} disabled={saving || publishing}>
              <span className="material-symbols-outlined">save</span>
              {saving ? 'Сохраняю…' : 'Сохранить черновик'}
            </button>
            <button className="reg-tool-btn reg-ai" onClick={publishNew} disabled={saving || publishing}>
              <span className="material-symbols-outlined">rocket_launch</span>
              {publishing ? 'Публикую…' : 'Опубликовать новую версию'}
            </button>
          </div>

          {/* Версии */}
          {id && (
            <div style={{ marginTop: 18 }}>
              <h4 style={{ marginBottom: 8 }}>Версии</h4>
              <VersionsTimeline
                versions={versions}
                currentVersionId={currentVersionId}
                onPreview={previewVersion}
                onPublish={publishVersion}
                onRollback={rollbackVersion}
              />
            </div>
          )}
        </aside>

        {/* ───────── Main: конструктор шагов ───────── */}
        <main className="reg-main">
          <div className="reg-toolbar">
            <button className="reg-tool-btn" onClick={() => addStep('text')}>
              <span className="material-symbols-outlined">subject</span>
              Текст
            </button>
            <button className="reg-tool-btn" onClick={() => addStep('checkbox')}>
              <span className="material-symbols-outlined">check_box</span>
              Чек-бокс
            </button>
            <button className="reg-tool-btn" onClick={() => addStep('action')}>
              <span className="material-symbols-outlined">bolt</span>
              Действие
            </button>
            <button className="reg-tool-btn" onClick={() => addStep('file')}>
              <span className="material-symbols-outlined">attach_file</span>
              Файл
            </button>
            <div style={{ flex: 1 }} />
            <button className="reg-tool-btn reg-ai" onClick={() => setAiOpen(true)}>
              <span className="material-symbols-outlined">auto_awesome</span>
              AI-генерация
            </button>
          </div>

          {steps.length === 0 ? (
            <div style={{
              border: '2px dashed #e5e7eb',
              borderRadius: 12,
              padding: 36,
              textAlign: 'center',
              color: '#9ca3af',
            }}>
              <div className="material-symbols-outlined" style={{ fontSize: 32, marginBottom: 6 }}>list_alt</div>
              <div>Добавьте первый шаг — это может быть текст, чек-бокс, действие или файл.</div>
              <div style={{ marginTop: 10, fontSize: 12 }}>Или нажмите <b>AI-генерация</b>, чтобы получить готовый шаблон.</div>
            </div>
          ) : (
            steps.map((s, i) => (
              <StepEditor
                key={s._tmpId || i}
                step={s}
                index={i}
                onChange={(patch) => updateStep(i, patch)}
                onDelete={() => deleteStep(i)}
                onMoveUp={() => moveStep(i, -1)}
                onMoveDown={() => moveStep(i, +1)}
                isFirst={i === 0}
                isLast={i === steps.length - 1}
                dragHandlers={makeDragHandlers(i)}
              />
            ))
          )}
        </main>
      </div>

      {/* AI-модал */}
      {aiOpen && (
        <Suspense fallback={null}>
          <AiGenerateModal
            open
            onClose={() => setAiOpen(false)}
            onInsert={applyAiSteps}
            onApplyMeta={applyAiMeta}
            existingSteps={steps}
            defaultRole={assignedRoles[0] || 'reg'}
          />
        </Suspense>
      )}
    </div>
  )
}
