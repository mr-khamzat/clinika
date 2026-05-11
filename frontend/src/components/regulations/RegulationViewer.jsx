/**
 * ========================================
 * <RegulationViewer> — премиум-просмотр одного регламента
 * ========================================
 * Глава 7 — Регламент-конструктор. Сторона читателя.
 *
 * Загружает GET /regulations/{id} и рисует:
 *   - Хедер: title, версия, дата публикации, категория, кнопка «Назад»
 *   - Description в стилизованном блоке
 *   - Шаги (content):
 *       text     — параграф
 *       checkbox — интерактивный (state локально, отправляется в complete)
 *       action   — выделенный блок с иконкой
 *       file     — кнопка «Открыть документ» (пока заглушка)
 *   - Если ещё не прочитано → внизу кнопка «Подтвердить ознакомление» → <SignatureModal>
 *   - Если уже прочитано     → плашка «✓ Подтверждено DD.MM.YYYY»
 *
 * Props:
 *   regulationId — id регламента
 *   onBack       — fn(): возврат к списку
 *   user         — текущий user (для подстановки ФИО в подпись)
 *
 * Формат content (один элемент массива):
 *   { type: 'text',     content: 'string' }
 *   { type: 'checkbox', label: 'string', required?: bool }
 *   { type: 'action',   title: 'string', content: 'string', icon?: 'string' }
 *   { type: 'file',     title: 'string', url?: 'string',    file_id?: any }
 * ========================================
 */
import { useEffect, useState, useMemo, useCallback } from 'react'
import api from '../../api'
import { Card, Button, Chip, EmptyState, useToast } from '../../design'
import SignatureModal from './SignatureModal'

const CATEGORY_LABELS = {
  general:       'Общий',
  hr:            'Кадры',
  finance:       'Финансы',
  medical:       'Медицинский',
  reception:     'Регистратура',
  safety:        'Безопасность',
  it:            'IT / Информбезопасность',
  service:       'Сервис',
  legal:         'Юридический',
}

function fmtDate(d) {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch {
    return String(d)
  }
}
function fmtDateLong(d) {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })
  } catch {
    return String(d)
  }
}

function StepText({ step }) {
  const text = step?.content || step?.text || ''
  if (!text) return null
  return (
    <div
      style={{
        padding: '14px 16px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        fontSize: 14,
        lineHeight: 1.6,
        color: 'var(--fg)',
        whiteSpace: 'pre-wrap',
      }}
    >
      {text}
    </div>
  )
}

function StepCheckbox({ step, idx, checked, onChange }) {
  const label = step?.label || step?.content || step?.text || `Пункт ${idx + 1}`
  const required = !!step?.required
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '12px 14px',
        background: checked ? 'var(--good-soft, #ecfdf5)' : 'var(--bg-1)',
        border: '1px solid',
        borderColor: checked ? 'var(--good, #16a34a)' : 'var(--border)',
        borderRadius: 12,
        cursor: 'pointer',
        transition: 'background 120ms ease, border-color 120ms ease',
      }}
    >
      <input
        type="checkbox"
        checked={!!checked}
        onChange={e => onChange(e.target.checked)}
        style={{
          marginTop: 2,
          width: 18,
          height: 18,
          accentColor: 'var(--accent)',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      />
      <span style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--fg)' }}>
        {label}
        {required && (
          <span style={{ color: 'var(--bad, #dc2626)', marginLeft: 4, fontWeight: 700 }}>*</span>
        )}
      </span>
    </label>
  )
}

function StepAction({ step }) {
  const title = step?.title || 'Действие'
  const content = step?.content || step?.text || ''
  const icon = step?.icon || 'bolt'
  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        padding: '14px 16px',
        background: 'var(--accent-soft)',
        border: '1px solid var(--accent, #0ea5e9)',
        borderRadius: 12,
      }}
    >
      <span
        className="material-symbols-outlined"
        style={{
          flexShrink: 0,
          fontSize: 24,
          color: 'var(--accent)',
          fontVariationSettings: "'FILL' 1",
        }}
      >
        {icon}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--fg)', marginBottom: 4 }}>
          {title}
        </div>
        {content && (
          <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--fg-2)', whiteSpace: 'pre-wrap' }}>
            {content}
          </div>
        )}
      </div>
    </div>
  )
}

function StepFile({ step }) {
  const title = step?.title || step?.label || 'Документ'
  const url = step?.url || step?.file_url || null
  const fileId = step?.file_id || step?.id || null
  const disabled = !url && !fileId

  function open() {
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
    // Если только file_id — пока заглушка, file storage реализация ниже по дорожной карте
  }

  return (
    <button
      type="button"
      onClick={open}
      disabled={disabled}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 14px',
        background: 'var(--surface)',
        border: '1px dashed var(--border)',
        borderRadius: 12,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        width: '100%',
        textAlign: 'left',
      }}
    >
      <span
        className="material-symbols-outlined"
        style={{
          fontSize: 22,
          color: 'var(--accent)',
          fontVariationSettings: "'FILL' 1",
          flexShrink: 0,
        }}
      >
        attach_file
      </span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>
        {title}
      </span>
      <span
        className="material-symbols-outlined"
        style={{ fontSize: 18, color: 'var(--fg-3)', flexShrink: 0 }}
      >
        {disabled ? 'lock' : 'open_in_new'}
      </span>
    </button>
  )
}

export default function RegulationViewer({ regulationId, onBack, user }) {
  const { toast } = useToast()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [checkboxesState, setCheckboxesState] = useState({})
  const [signOpen, setSignOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const r = await api.get(`/regulations/${regulationId}`)
      setData(r.data || null)
      // Сбрасываем локальный state чекбоксов после перезагрузки
      setCheckboxesState({})
    } catch (e) {
      const status = e?.response?.status
      if (status === 404) setError('Регламент не найден или вам не назначен')
      else if (status === 401 || status === 403) setError('Нет доступа к этому регламенту')
      else setError(e?.response?.data?.detail || e?.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [regulationId])

  useEffect(() => { load() }, [load])

  const content = useMemo(() => {
    const v = data?.current_version
    return Array.isArray(v?.content) ? v.content : []
  }, [data])

  // Собираем список required-чекбоксов для проверки в SignatureModal
  const requiredCheckboxes = useMemo(() => {
    return content
      .map((step, idx) => {
        if (step?.type !== 'checkbox') return null
        if (!step?.required) return null
        return {
          key: `cb_${idx}`,
          label: step?.label || step?.content || step?.text || `Пункт ${idx + 1}`,
        }
      })
      .filter(Boolean)
  }, [content])

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <div
          style={{
            display: 'inline-block',
            width: 32,
            height: 32,
            border: '3px solid var(--border)',
            borderTopColor: 'var(--accent)',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <div style={{ marginTop: 12, fontSize: 13, color: 'var(--fg-3)' }}>Загрузка регламента…</div>
      </div>
    )
  }

  if (error) {
    return (
      <Card>
        <EmptyState
          icon={<span className="material-symbols-outlined text-3xl" style={{ color: 'var(--bad, #dc2626)' }}>error</span>}
          title="Ошибка"
          message={error}
        />
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
          <Button variant="ghost" onClick={onBack}>Назад к списку</Button>
        </div>
      </Card>
    )
  }

  if (!data) {
    return (
      <Card>
        <EmptyState
          icon={<span className="material-symbols-outlined text-3xl">rule</span>}
          title="Регламент не найден"
          message="Возможно, он отозван или вам больше не назначен."
        />
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
          <Button variant="ghost" onClick={onBack}>Назад</Button>
        </div>
      </Card>
    )
  }

  const version = data.current_version || {}
  const alreadyCompleted = !!data.already_completed
  const completedAt = data.completed_at || data.completion?.completed_at || version?.completed_at || null
  const catLabel = CATEGORY_LABELS[data.category] || data.category || 'Без категории'

  function handleToggleCheckbox(idx, checked) {
    setCheckboxesState(prev => ({ ...prev, [`cb_${idx}`]: checked }))
  }

  function handleCompleted() {
    // Перезагружаем данные, чтобы получить already_completed=true
    load()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Хедер с кнопкой назад */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          type="button"
          onClick={onBack}
          aria-label="Назад"
          style={{
            width: 36, height: 36, borderRadius: 9,
            background: 'var(--bg-1)',
            border: '1px solid var(--border)',
            color: 'var(--fg-2)',
            display: 'inline-grid',
            placeItems: 'center',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>arrow_back</span>
        </button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Chip variant="default">{catLabel}</Chip>
            <Chip variant="accent">v{version.version_number ?? '?'}</Chip>
            {version.published_at && (
              <span style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>
                опубликовано {fmtDate(version.published_at)}
              </span>
            )}
          </div>
          <h2
            style={{
              margin: '6px 0 0',
              fontSize: 19,
              fontWeight: 700,
              color: 'var(--fg)',
              letterSpacing: '-0.01em',
              lineHeight: 1.25,
            }}
          >
            {data.title}
          </h2>
        </div>
      </div>

      {/* Description */}
      {data.description && (
        <div
          style={{
            padding: '14px 16px',
            background: 'var(--bg-1)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            fontSize: 13.5,
            lineHeight: 1.6,
            color: 'var(--fg-2)',
            whiteSpace: 'pre-wrap',
          }}
        >
          {data.description}
        </div>
      )}

      {/* Контент шагов */}
      {content.length === 0 ? (
        <Card>
          <EmptyState
            icon={<span className="material-symbols-outlined text-3xl">draft</span>}
            title="Регламент пуст"
            message="В текущей версии нет содержимого."
          />
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {content.map((step, idx) => {
            const type = step?.type || 'text'
            const cbKey = `cb_${idx}`
            return (
              <div key={idx}>
                {type === 'text'     && <StepText step={step} />}
                {type === 'checkbox' && (
                  <StepCheckbox
                    step={step}
                    idx={idx}
                    checked={!!checkboxesState[cbKey]}
                    onChange={v => handleToggleCheckbox(idx, v)}
                  />
                )}
                {type === 'action'   && <StepAction step={step} />}
                {type === 'file'     && <StepFile step={step} />}
                {!['text', 'checkbox', 'action', 'file'].includes(type) && (
                  <div
                    style={{
                      padding: '12px 14px',
                      background: 'var(--bg-1)',
                      border: '1px dashed var(--border)',
                      borderRadius: 10,
                      fontSize: 12.5,
                      color: 'var(--fg-3)',
                    }}
                  >
                    Неизвестный тип шага: <code>{type}</code>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Низ: либо «уже подтверждено», либо кнопка подтвердить */}
      <div style={{ marginTop: 8 }}>
        {alreadyCompleted ? (
          <div
            style={{
              padding: '14px 16px',
              background: 'var(--good-soft, #ecfdf5)',
              border: '1px solid var(--good, #16a34a)',
              borderRadius: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 24, color: 'var(--good, #16a34a)', fontVariationSettings: "'FILL' 1" }}
            >
              verified
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--fg)' }}>
                Подтверждено
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>
                Вы ознакомились с этой версией регламента{completedAt ? ` ${fmtDateLong(completedAt)}` : ''}.
              </div>
            </div>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              gap: 10,
              justifyContent: 'flex-end',
              padding: '10px 0',
              flexWrap: 'wrap',
            }}
          >
            <Button variant="ghost" onClick={onBack}>Назад</Button>
            <Button
              variant="primary"
              onClick={() => setSignOpen(true)}
            >
              Подтвердить ознакомление
            </Button>
          </div>
        )}
      </div>

      <SignatureModal
        open={signOpen}
        onClose={() => setSignOpen(false)}
        regulationId={data.id}
        regulationTitle={data.title}
        checkboxesState={checkboxesState}
        requiredCheckboxes={requiredCheckboxes}
        defaultFullName={user?.full_name || ''}
        onComplete={handleCompleted}
      />
    </div>
  )
}
