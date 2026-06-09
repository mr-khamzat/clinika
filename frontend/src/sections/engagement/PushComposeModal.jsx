/**
 * PushComposeModal.jsx — создание/планирование push-кампании.
 *
 * Props:
 *   token,
 *   initial: { title, body, segment_id, patient_ids, template_id, kind, suggestion_ids } — пресет
 *   onClose, onCreated(campaign)
 */
import { useEffect, useState, useCallback } from 'react'
import { API_BASE } from '../../config'

function apiFetch(token, path, opts = {}) {
  return fetch(API_BASE + path, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  })
}

const VARS = [
  { key: 'patient_first_name', label: 'Имя' },
  { key: 'patient_name',       label: 'Полное имя' },
  { key: 'clinic_name',        label: 'Клиника' },
  { key: 'branch_phone',       label: 'Тел. филиала' },
  { key: 'branch_address',     label: 'Адрес' },
  { key: 'doctor_name',        label: 'Имя врача' },
  { key: 'service_name',       label: 'Услуга' },
  { key: 'city',               label: 'Город' },
]

export default function PushComposeModal({ token, initial, onClose, onCreated }) {
  const init = initial || {}
  const [title, setTitle] = useState(init.title || '')
  const [body, setBody]   = useState(init.body || '')
  const [bodyB, setBodyB] = useState(init.body_b || '')
  const [abEnabled, setAbEnabled] = useState(!!init.ab_enabled)
  const [scheduled, setScheduled] = useState(false)
  const [scheduleAt, setScheduleAt] = useState('')

  const [segments, setSegments] = useState([])
  const [segmentId, setSegmentId] = useState(init.segment_id || '')
  const [patientIds] = useState(init.patient_ids || [])

  const [templates, setTemplates] = useState([])
  const [templateId, setTemplateId] = useState(init.template_id || '')
  const [templateBId, setTemplateBId] = useState(init.template_b_id || '')

  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [okMsg, setOkMsg] = useState('')

  useEffect(() => {
    apiFetch(token, '/engagement/segments')
      .then(r => r.ok ? r.json() : null)
      .then(d => setSegments(d?.items || d || []))
      .catch(() => {})
    apiFetch(token, '/engagement/templates')
      .then(r => r.ok ? r.json() : null)
      .then(d => setTemplates(d?.items || d || []))
      .catch(() => {})
  }, [token])

  // Если выбрали шаблон — подгружаем title+body
  useEffect(() => {
    if (!templateId) return
    const t = templates.find(x => String(x.id) === String(templateId))
    if (t) {
      if (!title) setTitle(t.title || '')
      if (!body)  setBody(t.body || '')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, templates])

  // Real-time preview через /ads/substitute-preview (если есть) — иначе локальная подстановка-заглушка
  const refreshPreview = useCallback(async () => {
    if (!body) { setPreview(''); return }
    try {
      const r = await apiFetch(token, `/ads/substitute-preview`, {
        method: 'POST', body: JSON.stringify({ text: body })
      })
      if (r.ok) {
        const d = await r.json()
        setPreview(d?.preview || d?.text || body)
        return
      }
    } catch {}
    // fallback — placeholder заменяется на «псевдо-имя»
    setPreview(body
      .replace(/\{\{\s*patient_first_name\s*\}\}/g, 'Анна')
      .replace(/\{\{\s*patient_name\s*\}\}/g, 'Анна Иванова')
      .replace(/\{\{\s*clinic_name\s*\}\}/g, 'Клиника')
      .replace(/\{\{\s*\w+\s*\}\}/g, '…'))
  }, [token, body])

  useEffect(() => {
    const t = setTimeout(refreshPreview, 300)
    return () => clearTimeout(t)
  }, [refreshPreview])

  function insertVar(varName, target = 'A') {
    const placeholder = `{{${varName}}}`
    if (target === 'A') setBody(b => (b || '') + placeholder)
    else setBodyB(b => (b || '') + placeholder)
  }

  function buildPayload() {
    const payload = {
      title: title.trim(),
      body: body.trim(),
      template_id: templateId || null,
    }
    if (segmentId) payload.segment_id = Number(segmentId)
    if (patientIds.length) payload.patient_ids = patientIds
    if (abEnabled && bodyB.trim()) {
      payload.ab_enabled = true
      payload.body_b = bodyB.trim()
      if (templateBId) payload.template_b_id = templateBId
    }
    if (scheduled && scheduleAt) payload.scheduled_at = new Date(scheduleAt).toISOString()
    if (init.suggestion_ids) payload.suggestion_ids = init.suggestion_ids
    return payload
  }

  async function submit(action) {
    if (!title.trim()) { setErr('Введите заголовок'); return }
    if (!body.trim())  { setErr('Введите текст'); return }
    setErr(''); setBusy(true)
    try {
      const r = await apiFetch(token, `/engagement/campaigns`, {
        method: 'POST', body: JSON.stringify(buildPayload())
      })
      if (!r.ok) { setErr('Ошибка создания кампании'); return }
      const camp = await r.json()
      if (action === 'send_now') {
        await apiFetch(token, `/engagement/campaigns/${camp.id}/send`, { method: 'POST' })
        setOkMsg('Кампания отправлена')
      } else if (action === 'schedule') {
        await apiFetch(token, `/engagement/campaigns/${camp.id}/schedule`, {
          method: 'POST', body: JSON.stringify({ scheduled_at: new Date(scheduleAt).toISOString() })
        })
        setOkMsg('Запланирована')
      } else {
        setOkMsg('Сохранено как черновик')
      }
      if (onCreated) onCreated(camp)
      setTimeout(() => onClose && onClose(), 700)
    } finally { setBusy(false) }
  }

  const audience = patientIds.length
    ? `${patientIds.length} выбранных пациентов`
    : (segmentId ? (segments.find(s => String(s.id) === String(segmentId))?.name || `Сегмент #${segmentId}`) : 'Все opt-in')

  return (
    <div className="fixed inset-0 bg-black/50 z-[1000] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-5xl max-h-[94vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between sticky top-0 bg-white dark:bg-gray-800 z-10">
          <div>
            <h2 className="font-bold text-gray-900 dark:text-white text-lg">Новая push-кампания</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">Аудитория: <b>{audience}</b></p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 p-6">
          {/* Левая — форма */}
          <div className="lg:col-span-2 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Сегмент</label>
                <select value={segmentId} onChange={e => setSegmentId(e.target.value)}
                  disabled={patientIds.length > 0}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm disabled:opacity-50">
                  <option value="">— все opt-in пациенты —</option>
                  {segments.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                {patientIds.length > 0 && (
                  <div className="text-[10px] text-gray-400 mt-0.5">Используется список выбранных пациентов</div>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Шаблон</label>
                <select value={templateId} onChange={e => setTemplateId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm">
                  <option value="">— без шаблона —</option>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.title || t.name}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Заголовок</label>
              <input value={title} onChange={e => setTitle(e.target.value)}
                placeholder="Скидка 20% на УЗИ" maxLength={120}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm" />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-gray-500 uppercase">Текст {abEnabled ? '(вариант A)' : ''}</label>
                <div className="text-[10px] text-gray-400">{body.length}/300</div>
              </div>
              <textarea rows={3} value={body} onChange={e => setBody(e.target.value)} maxLength={300}
                placeholder="Здравствуйте, {{patient_first_name}}! …"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm" />
              <div className="flex flex-wrap gap-1 mt-1">
                {VARS.map(v => (
                  <button key={v.key} onClick={() => insertVar(v.key, 'A')}
                    className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-[10px] font-semibold text-gray-600 dark:text-gray-300 hover:bg-cyan-100 dark:hover:bg-cyan-900/40">
                    +{v.label}
                  </button>
                ))}
              </div>
            </div>

            {/* A/B toggle */}
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 mt-3">
              <input type="checkbox" checked={abEnabled} onChange={e => setAbEnabled(e.target.checked)}
                className="h-4 w-4 rounded text-cyan-600" />
              A/B-тест
            </label>

            {abEnabled && (
              <div className="bg-violet-50 dark:bg-violet-900/20 rounded-xl p-3 border border-violet-200 dark:border-violet-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-violet-700 dark:text-violet-300">Вариант B</span>
                  <span className="text-[10px] text-gray-400">{bodyB.length}/300</span>
                </div>
                <textarea rows={2} value={bodyB} onChange={e => setBodyB(e.target.value)} maxLength={300}
                  className="w-full px-3 py-2 rounded-lg border border-violet-200 dark:border-violet-700 bg-white dark:bg-gray-900 text-sm" />
                <div className="flex flex-wrap gap-1">
                  {VARS.map(v => (
                    <button key={v.key} onClick={() => insertVar(v.key, 'B')}
                      className="px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/40 text-[10px] font-semibold text-violet-700 dark:text-violet-300 hover:bg-violet-200">
                      +{v.label}
                    </button>
                  ))}
                </div>
                <div>
                  <label className="text-xs text-violet-700 dark:text-violet-300">Шаблон B (опц.)</label>
                  <select value={templateBId} onChange={e => setTemplateBId(e.target.value)}
                    className="w-full px-2 py-1 rounded-lg border border-violet-200 dark:border-violet-700 bg-white dark:bg-gray-900 text-sm">
                    <option value="">— без шаблона —</option>
                    {templates.map(t => <option key={t.id} value={t.id}>{t.title || t.name}</option>)}
                  </select>
                </div>
              </div>
            )}

            {/* Schedule toggle */}
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 mt-2">
              <input type="checkbox" checked={scheduled} onChange={e => setScheduled(e.target.checked)}
                className="h-4 w-4 rounded text-cyan-600" />
              Запланировать на конкретное время
            </label>
            {scheduled && (
              <input type="datetime-local" value={scheduleAt} onChange={e => setScheduleAt(e.target.value)}
                className="w-full md:w-72 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm" />
            )}

            {err && <div className="px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm">{err}</div>}
            {okMsg && <div className="px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-sm">{okMsg}</div>}

            <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-100 dark:border-gray-700">
              <button onClick={() => submit('draft')} disabled={busy}
                className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm flex items-center gap-1">
                <span className="material-symbols-outlined text-base">save</span>Сохранить как draft
              </button>
              {scheduled ? (
                <button onClick={() => submit('schedule')} disabled={busy || !scheduleAt}
                  className="px-4 py-2 rounded-lg bg-amber-500 text-white hover:bg-amber-600 text-sm flex items-center gap-1 disabled:opacity-50">
                  <span className="material-symbols-outlined text-base">schedule</span>Запланировать
                </button>
              ) : (
                <button onClick={() => submit('send_now')} disabled={busy}
                  className="px-4 py-2 rounded-lg bg-cyan-600 text-white hover:bg-cyan-700 text-sm flex items-center gap-1 disabled:opacity-50 ml-auto">
                  <span className="material-symbols-outlined text-base">send</span>Отправить сейчас
                </button>
              )}
            </div>
          </div>

          {/* Правая — Preview */}
          <div className="space-y-3">
            <div className="sticky top-20">
              <div className="text-[10px] font-bold uppercase text-gray-500 mb-2">Предпросмотр на устройстве</div>
              <div className="bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-900 dark:to-gray-700 rounded-2xl p-3 shadow-inner">
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-3 border border-gray-100 dark:border-gray-700">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-teal-600 flex items-center justify-center text-white text-xs font-bold">К</div>
                    <div className="flex-1">
                      <div className="text-[11px] font-bold text-gray-700 dark:text-gray-200">Клиника</div>
                      <div className="text-[9px] text-gray-400">сейчас</div>
                    </div>
                  </div>
                  <div className="text-sm font-bold text-gray-900 dark:text-white">{title || '— заголовок —'}</div>
                  <div className="text-xs text-gray-700 dark:text-gray-300 mt-1 whitespace-pre-wrap">{preview || body || '— текст —'}</div>
                </div>
              </div>

              {abEnabled && (
                <>
                  <div className="text-[10px] font-bold uppercase text-violet-600 mt-3 mb-2">Вариант B</div>
                  <div className="bg-gradient-to-br from-violet-100 to-violet-200 dark:from-violet-900/40 dark:to-violet-700/40 rounded-2xl p-3 shadow-inner">
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-3 border border-gray-100 dark:border-gray-700">
                      <div className="text-sm font-bold text-gray-900 dark:text-white">{title || '— заголовок —'}</div>
                      <div className="text-xs text-gray-700 dark:text-gray-300 mt-1 whitespace-pre-wrap">{bodyB || '— вариант B —'}</div>
                    </div>
                  </div>
                </>
              )}

              <div className="mt-3 text-[10px] text-gray-400 leading-relaxed">
                Подстановки <code>{`{{patient_first_name}}`}</code> заменяются на данные пациента при отправке.
                Тихие часы пациента соблюдаются автоматически.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
