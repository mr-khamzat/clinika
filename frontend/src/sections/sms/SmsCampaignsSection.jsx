/**
 * SmsCampaignsSection — список кампаний и 4-шаговый wizard создания.
 *
 * API:
 *   GET    /sms/campaigns
 *   POST   /sms/campaigns
 *   POST   /sms/campaigns/{id}/preview  → { total_recipients, sample_phones[] }
 *   POST   /sms/campaigns/{id}/launch
 *   POST   /sms/campaigns/{id}/cancel
 *   GET    /sms/campaigns/{id}/messages?status=
 *
 * Wizard (4 шага):
 *   1) Шаблон — выбор существующего или создание inline.
 *   2) Аудитория — radio (sleeping_30d / sleeping_90d / specific_segment / custom_phones / all_patients).
 *   3) Расписание — «сейчас» / «запланировать» (datetime) / повтор.
 *   4) Подтверждение — summary + «Запустить».
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import api from '../../api'
import { useToast } from '../../design'

const apiFetch = (m, url, _t, d) => api({ method: m, url, data: d })

const STATUS_BADGES = {
  draft:     { label: 'Черновик',  cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' },
  scheduled: { label: 'Запланирована', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  sending:   { label: 'Отправка',  cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 animate-pulse' },
  sent:      { label: 'Отправлена', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  failed:    { label: 'Ошибка',    cls: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300' },
  cancelled: { label: 'Отменена',  cls: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' },
}

const AUDIENCES = [
  { id: 'sleeping_30d',    label: 'Спящие 30 дней',  hint: 'Не были в клинике 30+ дней' },
  { id: 'sleeping_90d',    label: 'Спящие 90 дней',  hint: 'Не были в клинике 90+ дней' },
  { id: 'specific_segment', label: 'Конкретный сегмент', hint: 'По тиру лояльности / услугам / датам' },
  { id: 'custom_phones',   label: 'Свой список',      hint: 'Список +7XXX по строке' },
  { id: 'all_patients',    label: 'Все пациенты',     hint: 'Вся база (осторожно!)' },
]

function fmtDt(s) {
  if (!s) return '—'
  try { return new Date(s).toLocaleString('ru', { dateStyle: 'short', timeStyle: 'short' }) }
  catch { return s }
}

// ── Главный компонент: список кампаний + wizard ────────────────────────────
export default function SmsCampaignsSection({ token }) {
  const [items, setItems] = useState(null)
  const [err, setErr] = useState('')
  const [needPay, setNeedPay] = useState(false)
  const [showWizard, setShowWizard] = useState(false)
  const [detailsId, setDetailsId] = useState(null)
  const { toast } = useToast()

  const load = useCallback(async () => {
    setErr(''); setNeedPay(false)
    try {
      const r = await apiFetch('get', '/sms/campaigns', token)
      setItems(Array.isArray(r.data) ? r.data : [])
    } catch (e) {
      const code = e?.response?.status
      if (code === 402) setNeedPay(true)
      else setErr(e?.response?.data?.detail || 'Ошибка загрузки кампаний')
      setItems([])
    }
  }, [token])

  useEffect(() => { load() }, [load])

  const onCancel = async (c) => {
    if (!confirm(`Отменить кампанию «${c.name}»?`)) return
    try {
      await apiFetch('post', `/sms/campaigns/${c.id}/cancel`, token)
      toast({ kind: 'success', text: 'Кампания отменена' })
      await load()
    } catch (e) {
      toast({ kind: 'error', text: e?.response?.data?.detail || 'Ошибка отмены' })
    }
  }

  if (needPay) {
    return (
      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-6 text-center">
        <span className="material-symbols-outlined text-[40px] text-amber-500 mb-2">campaign</span>
        <div className="text-lg font-bold text-amber-900 dark:text-amber-200 mb-1">Модуль не подключён</div>
        <div className="text-sm text-amber-700 dark:text-amber-300 mb-4">
          Подключите модуль <code className="bg-amber-100 dark:bg-amber-900/40 px-1 rounded">sms_marketing</code> (1&nbsp;990&nbsp;₽/мес).
        </div>
        <a href="../admin/modules_catalog" className="inline-block bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-xl text-sm font-semibold">
          Перейти в каталог модулей
        </a>
      </div>
    )
  }

  if (detailsId) {
    return <CampaignDetails token={token} campaignId={detailsId} onBack={() => { setDetailsId(null); load() }} />
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">
          {items === null ? 'Загрузка…' : `Кампаний: ${items.length}`}
        </div>
        <button
          onClick={() => setShowWizard(true)}
          className="bg-[#0097A7] hover:bg-[#00838F] text-white px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-1.5"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          Создать кампанию
        </button>
      </div>

      {err && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-600 text-sm">{err}</div>
      )}

      {items === null ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-[#0097A7] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="bg-gray-50 dark:bg-gray-800/50 border border-dashed border-gray-200 dark:border-gray-700 rounded-2xl p-10 text-center">
          <span className="material-symbols-outlined text-[40px] text-gray-400 mb-2">campaign</span>
          <div className="text-base font-semibold text-gray-700 dark:text-gray-200 mb-1">Кампаний пока нет</div>
          <div className="text-sm text-gray-500 mb-4">Создайте первую рассылку — например, спящим за 30 дней</div>
          <button onClick={() => setShowWizard(true)} className="bg-[#0097A7] hover:bg-[#00838F] text-white px-4 py-2 rounded-xl text-sm font-semibold">
            Создать кампанию
          </button>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden border border-gray-100 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/40 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Название</th>
                <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Шаблон</th>
                <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Аудитория</th>
                <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Прогресс</th>
                <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Статус</th>
                <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Запуск</th>
                <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 text-right">Действия</th>
              </tr>
            </thead>
            <tbody>
              {items.map(c => {
                const total = c.total_recipients || 0
                const sent = c.sent_count || 0
                const pct = total ? Math.round(sent / total * 100) : 0
                const badge = STATUS_BADGES[c.status] || STATUS_BADGES.draft
                return (
                  <tr key={c.id} className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50/60 dark:hover:bg-gray-900/30 cursor-pointer" onClick={() => setDetailsId(c.id)}>
                    <td className="px-4 py-3 font-semibold text-gray-900 dark:text-white">{c.name || '—'}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{c.template_name || '—'}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{AUDIENCES.find(a => a.id === c.audience_type)?.label || c.audience_type || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="text-xs text-gray-600 dark:text-gray-300 mb-1">{sent} / {total}</div>
                      <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div className="h-full bg-[#0097A7]" style={{ width: `${pct}%` }} />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex text-xs font-semibold px-2 py-0.5 rounded-full ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{fmtDt(c.scheduled_at || c.created_at)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      <button onClick={() => setDetailsId(c.id)} className="text-[#0097A7] hover:underline text-xs font-semibold mr-3">Детали</button>
                      {(c.status === 'scheduled' || c.status === 'sending') && (
                        <button onClick={() => onCancel(c)} className="text-red-500 hover:underline text-xs font-semibold">Отменить</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showWizard && (
        <CampaignWizard
          token={token}
          onClose={() => setShowWizard(false)}
          onCreated={(id) => { setShowWizard(false); setDetailsId(id); load() }}
        />
      )}
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// Wizard — 4 шага
// ───────────────────────────────────────────────────────────────────────────
function CampaignWizard({ token, onClose, onCreated }) {
  const [step, setStep] = useState(1)
  const { toast } = useToast()

  // Состояние формы
  const [name, setName] = useState('')
  const [templates, setTemplates] = useState([])
  const [templateId, setTemplateId] = useState('')
  const [inlineTemplate, setInlineTemplate] = useState({ name: '', body: '' })
  const [createNewTpl, setCreateNewTpl] = useState(false)

  const [audience, setAudience] = useState('sleeping_30d')
  const [segmentFilters, setSegmentFilters] = useState({ tier: '', service: '', dateFrom: '', dateTo: '' })
  const [customPhones, setCustomPhones] = useState('')

  const [scheduleType, setScheduleType] = useState('now') // now | later
  const [scheduledAt, setScheduledAt] = useState('')
  const [repeatEvery, setRepeatEvery] = useState(0) // 0 = без повтора

  const [previewData, setPreviewData] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Загрузка шаблонов
  useEffect(() => {
    apiFetch('get', '/sms/templates', token)
      .then(r => setTemplates(Array.isArray(r.data) ? r.data.filter(t => t.is_active !== false) : []))
      .catch(() => setTemplates([]))
  }, [token])

  // Помощник: построение payload кампании из формы.
  const buildCampaignPayload = () => {
    const payload = {
      name: name.trim() || `Кампания ${new Date().toLocaleDateString('ru')}`,
      audience_type: audience,
    }
    if (createNewTpl) {
      payload.template = {
        name: inlineTemplate.name.trim() || payload.name,
        body: inlineTemplate.body,
      }
    } else {
      payload.template_id = templateId ? Number(templateId) : null
    }
    if (audience === 'specific_segment') {
      payload.segment_filters = {
        tier: segmentFilters.tier || null,
        service: segmentFilters.service || null,
        date_from: segmentFilters.dateFrom || null,
        date_to: segmentFilters.dateTo || null,
      }
    }
    if (audience === 'custom_phones') {
      const phones = customPhones.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
      payload.custom_phones = phones
    }
    if (scheduleType === 'later' && scheduledAt) {
      payload.scheduled_at = new Date(scheduledAt).toISOString()
    }
    if (repeatEvery > 0) {
      payload.repeat_every_days = repeatEvery
    }
    return payload
  }

  // Шаг 2 → POST /preview через временное создание (создаём draft, делаем preview).
  // Backend контракт: POST /sms/campaigns/{id}/preview. Создаём draft заранее.
  const doPreview = async () => {
    setPreviewLoading(true)
    setPreviewData(null)
    try {
      // 1) Создать draft
      const created = await apiFetch('post', '/sms/campaigns', token, buildCampaignPayload())
      const id = created.data?.id
      if (!id) throw new Error('Не удалось создать черновик кампании')
      // 2) Preview
      const r = await apiFetch('post', `/sms/campaigns/${id}/preview`, token)
      setPreviewData({ ...r.data, draftId: id })
    } catch (e) {
      toast({ kind: 'error', text: e?.response?.data?.detail || e.message || 'Ошибка предпросмотра' })
    } finally {
      setPreviewLoading(false)
    }
  }

  // Шаг 4 — Запуск. Если уже есть draftId из preview — используем его, иначе создаём.
  const launch = async () => {
    setSubmitting(true)
    try {
      let id = previewData?.draftId
      if (!id) {
        const created = await apiFetch('post', '/sms/campaigns', token, buildCampaignPayload())
        id = created.data?.id
      }
      if (!id) throw new Error('Не удалось создать кампанию')
      await apiFetch('post', `/sms/campaigns/${id}/launch`, token)
      toast({ kind: 'success', text: 'Кампания запущена' })
      onCreated(id)
    } catch (e) {
      toast({ kind: 'error', text: e?.response?.data?.detail || e.message || 'Ошибка запуска' })
    } finally {
      setSubmitting(false)
    }
  }

  const canNext = useMemo(() => {
    if (step === 1) {
      if (createNewTpl) return inlineTemplate.name.trim() && inlineTemplate.body.trim()
      return !!templateId
    }
    if (step === 2) {
      if (audience === 'custom_phones') return customPhones.trim().length > 0
      return true
    }
    if (step === 3) {
      if (scheduleType === 'later') return !!scheduledAt
      return true
    }
    return true
  }, [step, createNewTpl, templateId, inlineTemplate, audience, customPhones, scheduleType, scheduledAt])

  const Stepper = () => (
    <div className="flex items-center gap-2 mb-5">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="flex-1 flex items-center gap-2">
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
            i === step ? 'bg-[#0097A7] text-white' : i < step ? 'bg-emerald-500 text-white' : 'bg-gray-200 text-gray-500'
          }`}>
            {i < step ? <span className="material-symbols-outlined text-[16px]">check</span> : i}
          </div>
          <div className={`text-xs font-semibold ${i === step ? 'text-gray-900 dark:text-white' : 'text-gray-400'}`}>
            {['Шаблон', 'Аудитория', 'Расписание', 'Подтверждение'][i - 1]}
          </div>
          {i < 4 && <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />}
        </div>
      ))}
    </div>
  )

  const tplObj = templates.find(t => String(t.id) === String(templateId))

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between sticky top-0 bg-white dark:bg-gray-800 z-10">
          <div className="text-lg font-bold text-gray-900 dark:text-white">Новая SMS-кампания</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="p-5">
          <Stepper />

          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Название кампании</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Возврат спящих апрель"
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 dark:text-white text-sm mb-5"
            />
          </div>

          {/* ── Шаг 1: Шаблон ─────────────────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setCreateNewTpl(false)}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold border ${!createNewTpl ? 'bg-[#0097A7] text-white border-[#0097A7]' : 'border-gray-200 dark:border-gray-700 text-gray-600'}`}
                >
                  Существующий
                </button>
                <button
                  onClick={() => setCreateNewTpl(true)}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold border ${createNewTpl ? 'bg-[#0097A7] text-white border-[#0097A7]' : 'border-gray-200 dark:border-gray-700 text-gray-600'}`}
                >
                  Создать новый
                </button>
              </div>

              {!createNewTpl ? (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Шаблон</label>
                  <select
                    value={templateId}
                    onChange={e => setTemplateId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 dark:text-white text-sm"
                  >
                    <option value="">— выберите шаблон —</option>
                    {templates.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                  {tplObj && (
                    <div className="mt-3 bg-gray-50 dark:bg-gray-900/40 rounded-xl p-3 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                      {tplObj.body}
                    </div>
                  )}
                  {templates.length === 0 && (
                    <div className="mt-2 text-xs text-amber-600">
                      Шаблонов пока нет — переключитесь на «Создать новый» или добавьте шаблон во вкладке «Шаблоны».
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Название шаблона</label>
                    <input
                      value={inlineTemplate.name}
                      onChange={e => setInlineTemplate(t => ({ ...t, name: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 dark:text-white text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Текст SMS</label>
                    <textarea
                      rows={5}
                      value={inlineTemplate.body}
                      onChange={e => setInlineTemplate(t => ({ ...t, body: e.target.value }))}
                      placeholder="Здравствуйте, {{patient_name}}! Скучаем по Вам..."
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 dark:text-white text-sm font-mono"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Шаг 2: Аудитория ──────────────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-3">
              {AUDIENCES.map(a => (
                <label
                  key={a.id}
                  className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer ${
                    audience === a.id ? 'border-[#0097A7] bg-cyan-50 dark:bg-cyan-900/10' : 'border-gray-200 dark:border-gray-700'
                  }`}
                >
                  <input
                    type="radio"
                    name="audience"
                    checked={audience === a.id}
                    onChange={() => setAudience(a.id)}
                    className="mt-1 accent-[#0097A7]"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">{a.label}</div>
                    <div className="text-xs text-gray-500">{a.hint}</div>
                  </div>
                </label>
              ))}

              {audience === 'specific_segment' && (
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <input
                    placeholder="Тир (bronze/silver/gold)"
                    value={segmentFilters.tier}
                    onChange={e => setSegmentFilters(s => ({ ...s, tier: e.target.value }))}
                    className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 dark:text-white text-sm"
                  />
                  <input
                    placeholder="Услуга (например, Чистка)"
                    value={segmentFilters.service}
                    onChange={e => setSegmentFilters(s => ({ ...s, service: e.target.value }))}
                    className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 dark:text-white text-sm"
                  />
                  <input
                    type="date"
                    value={segmentFilters.dateFrom}
                    onChange={e => setSegmentFilters(s => ({ ...s, dateFrom: e.target.value }))}
                    className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 dark:text-white text-sm"
                  />
                  <input
                    type="date"
                    value={segmentFilters.dateTo}
                    onChange={e => setSegmentFilters(s => ({ ...s, dateTo: e.target.value }))}
                    className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 dark:text-white text-sm"
                  />
                </div>
              )}

              {audience === 'custom_phones' && (
                <textarea
                  rows={6}
                  value={customPhones}
                  onChange={e => setCustomPhones(e.target.value)}
                  placeholder="+79991234567&#10;+79992345678"
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 dark:text-white text-sm font-mono mt-2"
                />
              )}

              <div className="mt-3">
                <button
                  onClick={doPreview}
                  disabled={previewLoading}
                  className="bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100 px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[16px]">visibility</span>
                  {previewLoading ? 'Считаем…' : 'Предпросмотр'}
                </button>
                {previewData && (
                  <div className="mt-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3">
                    <div className="text-sm font-semibold text-emerald-900 dark:text-emerald-200 mb-1">
                      Получателей: {previewData.total_recipients ?? 0}
                    </div>
                    {Array.isArray(previewData.sample_phones) && previewData.sample_phones.length > 0 && (
                      <div className="text-xs text-emerald-800 dark:text-emerald-300 font-mono">
                        Примеры: {previewData.sample_phones.slice(0, 5).join(', ')}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Шаг 3: Расписание ─────────────────────────────────────── */}
          {step === 3 && (
            <div className="space-y-3">
              <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer ${scheduleType === 'now' ? 'border-[#0097A7] bg-cyan-50 dark:bg-cyan-900/10' : 'border-gray-200 dark:border-gray-700'}`}>
                <input type="radio" name="schedule" checked={scheduleType === 'now'} onChange={() => setScheduleType('now')} className="mt-1 accent-[#0097A7]" />
                <div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-white">Отправить сейчас</div>
                  <div className="text-xs text-gray-500">Запуск произойдёт сразу после подтверждения</div>
                </div>
              </label>

              <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer ${scheduleType === 'later' ? 'border-[#0097A7] bg-cyan-50 dark:bg-cyan-900/10' : 'border-gray-200 dark:border-gray-700'}`}>
                <input type="radio" name="schedule" checked={scheduleType === 'later'} onChange={() => setScheduleType('later')} className="mt-1 accent-[#0097A7]" />
                <div className="flex-1">
                  <div className="text-sm font-semibold text-gray-900 dark:text-white">Запланировать</div>
                  <div className="text-xs text-gray-500 mb-2">Указать дату и время отправки</div>
                  {scheduleType === 'later' && (
                    <input
                      type="datetime-local"
                      value={scheduledAt}
                      onChange={e => setScheduledAt(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 dark:text-white text-sm"
                    />
                  )}
                </div>
              </label>

              <div className="bg-gray-50 dark:bg-gray-900/40 rounded-xl p-3">
                <div className="text-xs font-semibold text-gray-500 mb-1">Повторение (опционально)</div>
                <div className="flex items-center gap-2">
                  <input
                    type="number" min="0" max="365"
                    value={repeatEvery}
                    onChange={e => setRepeatEvery(Number(e.target.value) || 0)}
                    className="w-24 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 dark:text-white text-sm"
                  />
                  <span className="text-sm text-gray-600 dark:text-gray-300">дней (0 = без повтора)</span>
                </div>
              </div>
            </div>
          )}

          {/* ── Шаг 4: Подтверждение ──────────────────────────────────── */}
          {step === 4 && (
            <div className="space-y-3">
              <SummaryRow label="Название" value={name || '—'} />
              <SummaryRow
                label="Шаблон"
                value={createNewTpl ? `(новый) ${inlineTemplate.name}` : (tplObj?.name || '—')}
              />
              <SummaryRow label="Аудитория" value={AUDIENCES.find(a => a.id === audience)?.label || audience} />
              {previewData && (
                <SummaryRow label="Получателей" value={String(previewData.total_recipients ?? '—')} />
              )}
              <SummaryRow
                label="Запуск"
                value={scheduleType === 'now' ? 'Сейчас' : (scheduledAt ? new Date(scheduledAt).toLocaleString('ru') : '—')}
              />
              {repeatEvery > 0 && <SummaryRow label="Повторение" value={`раз в ${repeatEvery} дн.`} />}

              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3 text-xs text-amber-800 dark:text-amber-200 mt-3">
                После запуска отменить отправку уже отправленных сообщений нельзя. Убедитесь в правильности шаблона и аудитории.
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-gray-50 dark:bg-gray-900/40 rounded-b-2xl flex justify-between sticky bottom-0">
          <button
            onClick={() => step > 1 ? setStep(step - 1) : onClose()}
            className="px-4 py-2 rounded-lg text-sm font-semibold border border-gray-200 dark:border-gray-700"
          >
            {step > 1 ? 'Назад' : 'Отмена'}
          </button>
          {step < 4 ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={!canNext}
              className="bg-[#0097A7] hover:bg-[#00838F] disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-semibold"
            >
              Далее
            </button>
          ) : (
            <button
              onClick={launch}
              disabled={submitting}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[16px]">send</span>
              {submitting ? 'Запуск…' : 'Запустить'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function SummaryRow({ label, value }) {
  return (
    <div className="flex items-center justify-between text-sm border-b border-gray-100 dark:border-gray-700 pb-2">
      <span className="text-gray-500">{label}</span>
      <span className="font-semibold text-gray-900 dark:text-white text-right">{value}</span>
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// Детали кампании — прогресс-бар + лог сообщений
// ───────────────────────────────────────────────────────────────────────────
function CampaignDetails({ token, campaignId, onBack }) {
  const [campaign, setCampaign] = useState(null)
  const [messages, setMessages] = useState([])
  const [statusFilter, setStatusFilter] = useState('')
  const [err, setErr] = useState('')
  const { toast } = useToast()

  const load = useCallback(async () => {
    try {
      // Список кампаний — берём всю (бекенд может не иметь GET /sms/campaigns/{id}).
      const all = await apiFetch('get', '/sms/campaigns', token)
      const c = (all.data || []).find(x => x.id === campaignId)
      setCampaign(c || null)
      const params = new URLSearchParams()
      if (statusFilter) params.set('status', statusFilter)
      const m = await apiFetch('get', `/sms/campaigns/${campaignId}/messages?${params.toString()}`, token)
      setMessages(Array.isArray(m.data) ? m.data : [])
    } catch (e) {
      setErr(e?.response?.data?.detail || 'Ошибка загрузки')
    }
  }, [token, campaignId, statusFilter])

  useEffect(() => {
    load()
    const interval = setInterval(load, 5000) // авто-обновление каждые 5с
    return () => clearInterval(interval)
  }, [load])

  const onCancel = async () => {
    if (!confirm('Отменить кампанию?')) return
    try {
      await apiFetch('post', `/sms/campaigns/${campaignId}/cancel`, token)
      toast({ kind: 'success', text: 'Кампания отменена' })
      await load()
    } catch (e) {
      toast({ kind: 'error', text: e?.response?.data?.detail || 'Ошибка отмены' })
    }
  }

  if (!campaign) {
    return (
      <div className="space-y-4">
        <button onClick={onBack} className="text-[#0097A7] hover:underline text-sm flex items-center gap-1">
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          К списку кампаний
        </button>
        {err ? <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-600 text-sm">{err}</div>
             : <div className="text-gray-500">Загрузка…</div>}
      </div>
    )
  }

  const total = campaign.total_recipients || 0
  const sent = campaign.sent_count || 0
  const pct = total ? Math.round(sent / total * 100) : 0
  const badge = STATUS_BADGES[campaign.status] || STATUS_BADGES.draft
  const canCancel = campaign.status === 'scheduled' || campaign.status === 'sending'

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="text-[#0097A7] hover:underline text-sm flex items-center gap-1">
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          К списку
        </button>
        {canCancel && (
          <button onClick={onCancel} className="text-red-500 hover:bg-red-50 px-3 py-1.5 rounded-lg text-sm font-semibold">
            Отменить кампанию
          </button>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 border border-gray-100 dark:border-gray-700">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-xl font-bold text-gray-900 dark:text-white">{campaign.name}</div>
            <div className="text-sm text-gray-500 mt-1">
              Шаблон: {campaign.template_name || '—'} · Аудитория: {AUDIENCES.find(a => a.id === campaign.audience_type)?.label || '—'}
            </div>
          </div>
          <span className={`inline-flex text-xs font-semibold px-3 py-1 rounded-full ${badge.cls}`}>
            {badge.label}
          </span>
        </div>

        <div>
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="text-gray-600 dark:text-gray-300">Прогресс отправки</span>
            <span className="font-bold text-gray-900 dark:text-white">{sent} / {total} ({pct}%)</span>
          </div>
          <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
            <div className="h-full bg-[#0097A7] transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      {/* Messages log */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 border border-gray-100 dark:border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-bold text-gray-900 dark:text-white">Лог сообщений</div>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 dark:text-white text-xs"
          >
            <option value="">Все статусы</option>
            <option value="queued">В очереди</option>
            <option value="sent">Отправлено</option>
            <option value="delivered">Доставлено</option>
            <option value="failed">Ошибка</option>
          </select>
        </div>

        {messages.length === 0 ? (
          <div className="text-sm text-gray-400 italic py-4 text-center">Сообщений пока нет</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-gray-500">
                <tr>
                  <th className="px-2 py-2">Телефон</th>
                  <th className="px-2 py-2">Статус</th>
                  <th className="px-2 py-2">Отправлено</th>
                  <th className="px-2 py-2">Доставлено</th>
                  <th className="px-2 py-2">Ошибка</th>
                </tr>
              </thead>
              <tbody>
                {messages.slice(0, 200).map(m => (
                  <tr key={m.id} className="border-t border-gray-100 dark:border-gray-700">
                    <td className="px-2 py-1.5 font-mono text-xs">{m.phone}</td>
                    <td className="px-2 py-1.5 text-xs">{m.status || '—'}</td>
                    <td className="px-2 py-1.5 text-xs text-gray-500">{fmtDt(m.sent_at)}</td>
                    <td className="px-2 py-1.5 text-xs text-gray-500">{fmtDt(m.delivered_at)}</td>
                    <td className="px-2 py-1.5 text-xs text-red-500">{m.error || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {messages.length > 200 && (
              <div className="text-xs text-gray-400 mt-2 text-center">Показано первые 200 из {messages.length}</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
