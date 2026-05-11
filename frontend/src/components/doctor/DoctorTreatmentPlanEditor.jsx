/**
 * ========================================
 * Treatment Plan Editor (Глава 6, фича 2)
 * ========================================
 * Модал для генерации и редактирования плана лечения:
 *   1) Форма ввода: диагноз, симптомы, подход (conservative|active)
 *   2) После генерации (POST /doctor/appointments/{id}/generate-plan)
 *      — редактируемые секции (цель, этапы, назначения, диагностика,
 *      follow-ups, образ жизни, тревожные симптомы)
 *   3) Действия: Сохранить черновик, Утвердить план, Архивировать,
 *      Скопировать в карту (POST /doctor/treatment-plans/{id}/copy-to-medcard)
 *
 * Используется в DoctorLayout и других кабинетах доктора.
 * ========================================
 */
import { useState, useCallback } from 'react'
import api from '../../api'
import { Card, Button, Chip } from '../../design'

function AutoSizeText({ value, onChange, placeholder, rows = 2 }) {
  return (
    <textarea
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      style={{
        width: '100%',
        padding: '8px 10px',
        border: '1px solid var(--line)',
        borderRadius: 6,
        fontSize: 13,
        fontFamily: 'inherit',
        background: 'var(--bg)',
        color: 'var(--fg)',
        resize: 'vertical',
        minHeight: 30 + rows * 16,
      }}
    />
  )
}

function ListEditor({ items, fields, onChange, addLabel = '+ Добавить' }) {
  const update = (idx, key, val) => {
    const next = [...items]
    next[idx] = { ...next[idx], [key]: val }
    onChange(next)
  }
  const remove = (idx) => onChange(items.filter((_, i) => i !== idx))
  const add = () =>
    onChange([...items, fields.reduce((a, f) => ({ ...a, [f.key]: '' }), {})])

  return (
    <div className="flex flex-col gap-2">
      {items.map((it, idx) => (
        <div
          key={idx}
          style={{
            padding: 10,
            border: '1px solid var(--line)',
            borderRadius: 8,
            background: 'var(--bg-2)',
            position: 'relative',
          }}
        >
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: `repeat(${fields.length}, 1fr)` }}
          >
            {fields.map((f) => (
              <div key={f.key}>
                <div style={{ fontSize: 10.5, color: 'var(--fg-3)', marginBottom: 3 }}>
                  {f.label}
                </div>
                <AutoSizeText
                  value={it[f.key]}
                  onChange={(v) => update(idx, f.key, v)}
                  placeholder={f.placeholder || ''}
                  rows={f.rows || 1}
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => remove(idx)}
            style={{
              position: 'absolute',
              top: 6,
              right: 8,
              fontSize: 11,
              color: 'var(--danger, #b00020)',
              background: 'transparent',
              border: 0,
              cursor: 'pointer',
            }}
          >
            удалить
          </button>
        </div>
      ))}
      <Button variant="ghost" size="sm" onClick={add}>
        {addLabel}
      </Button>
    </div>
  )
}

function SimpleList({ items, onChange, placeholder }) {
  return (
    <div className="flex flex-col gap-2">
      {items.map((it, idx) => (
        <div key={idx} className="flex gap-2 items-center">
          <input
            value={it}
            onChange={(e) => {
              const next = [...items]
              next[idx] = e.target.value
              onChange(next)
            }}
            placeholder={placeholder}
            style={{
              flex: 1,
              padding: '6px 10px',
              border: '1px solid var(--line)',
              borderRadius: 6,
              fontSize: 13,
              background: 'var(--bg)',
              color: 'var(--fg)',
            }}
          />
          <button
            type="button"
            onClick={() => onChange(items.filter((_, i) => i !== idx))}
            style={{ fontSize: 11, color: 'var(--danger, #b00020)', background: 'transparent', border: 0, cursor: 'pointer' }}
          >
            x
          </button>
        </div>
      ))}
      <Button variant="ghost" size="sm" onClick={() => onChange([...items, ''])}>
        + добавить пункт
      </Button>
    </div>
  )
}

export default function DoctorTreatmentPlanEditor({
  appointmentId,
  initialPlan = null,
  onSaved,
  onClose,
}) {
  // step 1 — генерация; step 2 — редактирование
  const [step, setStep]     = useState(initialPlan ? 'edit' : 'gen')
  const [diagnosis, setDg]  = useState('')
  const [symptoms, setSm]   = useState('')
  const [approach, setAp]   = useState('conservative')
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState(null)
  const [plan, setPlan]     = useState(initialPlan)
  const [payload, setPayload] = useState(initialPlan?.payload || null)

  const generate = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await api.post(`/doctor/appointments/${appointmentId}/generate-plan`, {
        diagnosis,
        symptoms,
        preferred_approach: approach,
      })
      setPlan(r.data)
      setPayload(r.data.payload || {})
      setStep('edit')
    } catch (e) {
      setError(e?.response?.data?.detail || 'Не удалось сгенерировать план')
    } finally {
      setBusy(false)
    }
  }, [appointmentId, diagnosis, symptoms, approach])

  const save = useCallback(
    async (newStatus = null) => {
      if (!plan) return
      setBusy(true)
      setError(null)
      try {
        const body = { payload }
        if (newStatus) body.status = newStatus
        const r = await api.patch(`/doctor/treatment-plans/${plan.id}`, body)
        setPlan(r.data)
        setPayload(r.data.payload || {})
        if (onSaved) onSaved(r.data)
      } catch (e) {
        setError(e?.response?.data?.detail || 'Не удалось сохранить')
      } finally {
        setBusy(false)
      }
    },
    [plan, payload, onSaved],
  )

  const copyToMedcard = useCallback(async () => {
    if (!plan) return
    setBusy(true)
    setError(null)
    try {
      await api.post(`/doctor/treatment-plans/${plan.id}/copy-to-medcard`)
      alert('План скопирован в карту пациента (раздел «Рекомендации»)')
    } catch (e) {
      setError(e?.response?.data?.detail || 'Не удалось скопировать')
    } finally {
      setBusy(false)
    }
  }, [plan])

  // ─── Render: step 1 — генерация ────────────────────────────────────
  if (step === 'gen') {
    return (
      <Card>
        <Card.Header>
          <Card.Title>Генерация плана лечения</Card.Title>
          <Card.Subtitle>AI создаст структурированный план — вы сможете отредактировать</Card.Subtitle>
        </Card.Header>

        <div className="flex flex-col gap-3">
          <div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 3 }}>Диагноз</div>
            <input
              value={diagnosis}
              onChange={(e) => setDg(e.target.value)}
              placeholder="Например: ОРВИ, артериальная гипертензия"
              style={{
                width: '100%',
                padding: '8px 10px',
                border: '1px solid var(--line)',
                borderRadius: 6,
                fontSize: 13,
                background: 'var(--bg)',
                color: 'var(--fg)',
              }}
            />
          </div>

          <div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 3 }}>
              Симптомы / жалобы
            </div>
            <AutoSizeText
              value={symptoms}
              onChange={setSm}
              placeholder="Кашель, насморк, температура 37.8…"
              rows={3}
            />
          </div>

          <div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 6 }}>Подход</div>
            <div className="flex gap-2">
              <Chip
                variant={approach === 'conservative' ? 'accent' : 'default'}
                onClick={() => setAp('conservative')}
                style={{ cursor: 'pointer' }}
              >
                Консервативный
              </Chip>
              <Chip
                variant={approach === 'active' ? 'accent' : 'default'}
                onClick={() => setAp('active')}
                style={{ cursor: 'pointer' }}
              >
                Активный
              </Chip>
            </div>
          </div>

          {error && <div style={{ color: 'var(--danger, #b00020)', fontSize: 12 }}>{error}</div>}

          <div className="flex gap-2 justify-end mt-2">
            {onClose && (
              <Button variant="ghost" onClick={onClose}>
                Отмена
              </Button>
            )}
            <Button onClick={generate} disabled={busy}>
              {busy ? 'Генерирую…' : 'Сгенерировать'}
            </Button>
          </div>
        </div>
      </Card>
    )
  }

  // ─── Render: step 2 — редактирование ───────────────────────────────
  const pl = payload || {}
  const set = (k, v) => setPayload({ ...pl, [k]: v })

  return (
    <Card>
      <Card.Header>
        <div className="flex-1 min-w-0">
          <Card.Title>План лечения · черновик</Card.Title>
          <Card.Subtitle>
            {plan?.status === 'approved' ? 'Утверждён · ' : ''}
            {plan?.ai_provider === 'gemini' ? 'AI Gemini' : 'rule-based'}
            {' · '}
            {plan?.created_at ? new Date(plan.created_at).toLocaleString('ru') : ''}
          </Card.Subtitle>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => save()} disabled={busy}>
            Сохранить
          </Button>
          {plan?.status !== 'approved' && (
            <Button size="sm" onClick={() => save('approved')} disabled={busy}>
              Утвердить
            </Button>
          )}
          {plan?.status === 'approved' && (
            <Button size="sm" variant="ghost" onClick={() => save('archived')} disabled={busy}>
              Архив
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={copyToMedcard} disabled={busy}>
            В карту
          </Button>
          {onClose && (
            <Button size="sm" variant="ghost" onClick={onClose}>
              Закрыть
            </Button>
          )}
        </div>
      </Card.Header>

      {error && (
        <div style={{ color: 'var(--danger, #b00020)', fontSize: 12, marginBottom: 8 }}>
          {error}
        </div>
      )}

      <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 4 }}>Цель лечения</div>
      <AutoSizeText value={pl.goal} onChange={(v) => set('goal', v)} rows={2} />

      <div style={{ height: 14 }} />
      <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 4 }}>Этапы</div>
      <ListEditor
        items={pl.stages || []}
        onChange={(v) => set('stages', v)}
        fields={[
          { key: 'title', label: 'Название этапа', placeholder: 'Краткосрочный…' },
          { key: 'description', label: 'Описание', rows: 2 },
          { key: 'horizon', label: 'short|long' },
        ]}
        addLabel="+ Добавить этап"
      />

      <div style={{ height: 14 }} />
      <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 4 }}>
        Назначения (рекомендации)
      </div>
      <ListEditor
        items={pl.medications || []}
        onChange={(v) => set('medications', v)}
        fields={[
          { key: 'name', label: 'Препарат' },
          { key: 'dose', label: 'Доза' },
          { key: 'duration', label: 'Длительность' },
          { key: 'notes', label: 'Примечание', rows: 2 },
        ]}
        addLabel="+ Добавить препарат"
      />

      <div style={{ height: 14 }} />
      <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 4 }}>Диагностика</div>
      <ListEditor
        items={pl.diagnostics || []}
        onChange={(v) => set('diagnostics', v)}
        fields={[
          { key: 'name', label: 'Исследование' },
          { key: 'purpose', label: 'Цель' },
        ]}
        addLabel="+ Добавить исследование"
      />

      <div style={{ height: 14 }} />
      <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 4 }}>Контрольные визиты</div>
      <ListEditor
        items={pl.follow_ups || []}
        onChange={(v) => set('follow_ups', v)}
        fields={[
          { key: 'after_days', label: 'Через дней' },
          { key: 'purpose', label: 'Цель', rows: 2 },
        ]}
        addLabel="+ Добавить контроль"
      />

      <div style={{ height: 14 }} />
      <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 4 }}>Образ жизни</div>
      <SimpleList
        items={pl.lifestyle || []}
        onChange={(v) => set('lifestyle', v)}
        placeholder="Например: сбалансированное питание"
      />

      <div style={{ height: 14 }} />
      <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 4 }}>Тревожные симптомы (red flags)</div>
      <SimpleList
        items={pl.red_flags || []}
        onChange={(v) => set('red_flags', v)}
        placeholder="Резкое ухудшение состояния…"
      />
    </Card>
  )
}
