/**
 * ========================================
 * Pre-visit Briefing Panel (Глава 6, фича 1)
 * ========================================
 * AI-сводка для врача перед предстоящим приёмом:
 *   - История болезней (до 5 последних диагнозов)
 *   - Аллергии
 *   - Последние витальные показатели
 *   - Жалобы (notes текущего приёма)
 *   - AI-рекомендации (attention | investigate | caution)
 *
 * Источник данных: GET /doctor/appointments/{id}/briefing
 * Кеш на сервере (Redis 1 час). Кнопка «Перегенерировать» — refresh=1.
 *
 * Источники подсвечиваются tooltip'ом (data-tooltip).
 * Skeleton-loader при первом fetch.
 * ========================================
 */
import { useState, useEffect, useCallback } from 'react'
import api from '../../api'
import { Card, Chip, Button, EmptyState } from '../../design'

const REC_STYLE = {
  attention:   { label: 'Внимание',     color: '#b45309', bg: '#fef3c7' },
  caution:     { label: 'Осторожно',    color: '#b91c1c', bg: '#fee2e2' },
  investigate: { label: 'Исследовать',  color: '#0369a1', bg: '#dbeafe' },
}

function Skel({ h = 14, w = '100%' }) {
  return (
    <div
      style={{
        height: h,
        width: w,
        borderRadius: 6,
        background:
          'linear-gradient(90deg, var(--bg-2) 0%, var(--bg-3, #ececec) 50%, var(--bg-2) 100%)',
        backgroundSize: '200% 100%',
        animation: 'briefing-shimmer 1.4s infinite linear',
      }}
    />
  )
}

function Section({ title, source, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          fontSize: 11.5,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--fg-3)',
          marginBottom: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
        title={source ? `Источник: ${source}` : undefined}
      >
        <span>{title}</span>
        {source && (
          <span
            style={{
              fontSize: 9,
              padding: '1px 5px',
              border: '1px solid var(--line)',
              borderRadius: 4,
              color: 'var(--fg-3)',
              textTransform: 'lowercase',
            }}
          >
            {source}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}

export default function DoctorBriefingPanel({ appointmentId, onClose }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefr] = useState(false)
  const [error, setError]     = useState(null)
  const [complaintsDraft, setComplaintsDraft] = useState('')
  const [savingNotes, setSavingNotes]         = useState(false)
  const [noteError, setNoteError]             = useState('')

  const load = useCallback(
    async (refresh = false) => {
      if (!appointmentId) return
      setError(null)
      if (refresh) setRefr(true)
      else setLoading(true)
      try {
        const r = await api.get(
          `/doctor/appointments/${appointmentId}/briefing` + (refresh ? '?refresh=1' : ''),
        )
        setData(r.data)
      } catch (e) {
        setError(e?.response?.data?.detail || 'Не удалось загрузить briefing')
      } finally {
        setLoading(false)
        setRefr(false)
      }
    },
    [appointmentId],
  )

  useEffect(() => {
    load(false)
  }, [load])

  useEffect(() => {
    if (data) setComplaintsDraft(data.complaints || '')
  }, [data])

  const saveComplaints = useCallback(async () => {
    if (!appointmentId) return
    const next = complaintsDraft.trim()
    if (next === (data?.complaints || '').trim()) return
    setSavingNotes(true)
    setNoteError('')
    try {
      await api.patch(`/appointments/${appointmentId}`, { notes: next })
      setData(d => (d ? { ...d, complaints: next } : d))
      load(true)
    } catch (e) {
      setNoteError(e?.response?.data?.detail || 'Не удалось сохранить жалобы')
    } finally {
      setSavingNotes(false)
    }
  }, [appointmentId, complaintsDraft, data, load])

  if (loading) {
    return (
      <Card>
        <style>
          {`@keyframes briefing-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}
        </style>
        <Card.Header>
          <Card.Title>Pre-visit briefing</Card.Title>
          <Card.Subtitle>AI собирает данные пациента…</Card.Subtitle>
        </Card.Header>
        <div className="flex flex-col gap-2">
          <Skel h={18} w="60%" />
          <Skel h={12} w="92%" />
          <Skel h={12} w="86%" />
          <Skel h={12} w="74%" />
          <div style={{ height: 6 }} />
          <Skel h={42} w="100%" />
          <Skel h={42} w="100%" />
        </div>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <EmptyState
          title="Ошибка briefing"
          message={error}
          action={<Button onClick={() => load(true)}>Повторить</Button>}
        />
      </Card>
    )
  }

  if (!data) return null

  const p = data.patient || {}
  const provider = data.ai_provider || 'rule-based'

  return (
    <Card>
      <Card.Header>
        <div className="flex-1 min-w-0">
          <Card.Title>Pre-visit briefing</Card.Title>
          <Card.Subtitle>
            {p.full_name || '—'} {p.age ? `· ${p.age} лет` : ''}
            {' · '}
            <span style={{ color: provider === 'rule-based' ? 'var(--fg-3)' : 'var(--accent)' }}>
              {provider === 'claude' ? 'AI (Claude)' : provider === 'gemini' ? 'AI (Gemini)' : 'rule-based'}
            </span>
            {data.from_cache && <span style={{ marginLeft: 6, fontSize: 11 }}>· из кеша</span>}
          </Card.Subtitle>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => load(true)} disabled={refreshing}>
            {refreshing ? 'Обновляю…' : 'Перегенерировать'}
          </Button>
          {onClose && (
            <Button size="sm" variant="ghost" onClick={onClose}>
              Закрыть
            </Button>
          )}
        </div>
      </Card.Header>

      {/* Витальные */}
      <Section title="Витальные показатели" source="patient_vitals">
        {(() => {
          const v = data.vitals_last || {}
          const items = []
          if (v.weight != null) items.push(['Вес', `${v.weight} кг`])
          if (v.height != null) items.push(['Рост', `${v.height} см`])
          if (v.bp)             items.push(['АД', `${v.bp} мм рт.ст.`])
          if (v.pulse != null)  items.push(['Пульс', `${v.pulse} уд/мин`])
          if (v.temperature != null) items.push(['Температура', `${v.temperature} °C`])
          if (v.spo2 != null)   items.push(['SpO2', `${v.spo2} %`])
          if (items.length === 0) {
            return <div style={{ color: 'var(--fg-3)', fontSize: 12 }}>Нет данных</div>
          }
          return (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {items.map(([k, val]) => (
                <div
                  key={k}
                  style={{
                    padding: '8px 10px',
                    background: 'var(--bg-2)',
                    borderRadius: 8,
                  }}
                >
                  <div style={{ fontSize: 10.5, color: 'var(--fg-3)', textTransform: 'uppercase' }}>
                    {k}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>{val}</div>
                </div>
              ))}
            </div>
          )
        })()}
      </Section>

      {/* Аллергии */}
      <Section title="Аллергии" source="patient_allergies">
        {data.allergies && data.allergies.length ? (
          <div className="flex flex-wrap gap-2">
            {data.allergies.map((a, i) => (
              <Chip key={i} variant="bad">
                {a}
              </Chip>
            ))}
          </div>
        ) : (
          <div style={{ color: 'var(--fg-3)', fontSize: 12 }}>Не зафиксированы</div>
        )}
      </Section>

      {/* История */}
      <Section title="История диагнозов" source="patient_diagnoses">
        {data.history && data.history.length ? (
          <div className="flex flex-col gap-2">
            {data.history.map((h, i) => (
              <div
                key={i}
                style={{
                  padding: '10px 12px',
                  background: 'var(--bg-2)',
                  borderRadius: 8,
                  display: 'flex',
                  gap: 10,
                  alignItems: 'flex-start',
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--fg-3)',
                    minWidth: 80,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {h.date || '—'}
                </div>
                <div className="flex-1 min-w-0">
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>
                    {h.diagnosis} {h.icd10 ? `(${h.icd10})` : ''}
                  </div>
                  {h.summary && (
                    <div style={{ fontSize: 12, color: 'var(--fg-2)', marginTop: 3 }}>
                      {h.summary}
                    </div>
                  )}
                </div>
                {h.is_chronic && <Chip variant="warn">хронич.</Chip>}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ color: 'var(--fg-3)', fontSize: 12 }}>Нет записей в медкарте</div>
        )}
      </Section>

      {/* Жалобы — редактируемое поле, сохраняем в appointments.notes */}
      <Section title="Жалобы по текущей записи" source="appointments.notes">
        <textarea
          value={complaintsDraft}
          onChange={e => setComplaintsDraft(e.target.value)}
          onBlur={saveComplaints}
          placeholder="Опишите жалобы пациента. Сохранится автоматически при выходе из поля."
          rows={3}
          disabled={savingNotes}
          style={{
            width: '100%',
            padding: '10px 12px',
            background: 'var(--bg-2)',
            borderRadius: 8,
            fontSize: 13,
            color: 'var(--fg)',
            border: '1px solid var(--line)',
            outline: 'none',
            resize: 'vertical',
            minHeight: 70,
            fontFamily: 'inherit',
          }}
        />
        <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: 'var(--fg-3)' }}>
          <span>{savingNotes ? 'Сохраняю…' : 'После сохранения нажмите «Перегенерировать», чтобы обновить AI-рекомендации.'}</span>
          {noteError && <span style={{ color: '#b91c1c' }}>{noteError}</span>}
        </div>
      </Section>

      {/* AI-рекомендации */}
      <Section title="AI-рекомендации" source={provider}>
        {data.ai_recommendations && data.ai_recommendations.length ? (
          <div className="flex flex-col gap-2">
            {data.ai_recommendations.map((r, i) => {
              const st = REC_STYLE[r.type] || REC_STYLE.attention
              return (
                <div
                  key={i}
                  style={{
                    padding: '10px 12px',
                    background: st.bg,
                    color: st.color,
                    borderRadius: 8,
                    fontSize: 13,
                    display: 'flex',
                    gap: 8,
                  }}
                >
                  <span style={{ fontWeight: 700, minWidth: 90 }}>{st.label}:</span>
                  <span>{r.text}</span>
                </div>
              )
            })}
          </div>
        ) : (
          <div style={{ color: 'var(--fg-3)', fontSize: 12 }}>—</div>
        )}
      </Section>
    </Card>
  )
}
