/**
 * SmsTemplatesSection — CRUD шаблонов SMS-рассылок.
 *
 * API:
 *   GET    /sms/templates
 *   POST   /sms/templates
 *   PATCH  /sms/templates/{id}
 *   DELETE /sms/templates/{id}   (soft)
 *
 * Особенности:
 *   - Live-preview справа: подстановка demo-значений переменных.
 *   - Подсчёт длины (160 латиница / 70 кириллица) и число SMS-сегментов.
 *   - Popover «Вставить переменную»: {{patient_name}}, {{date}}, {{clinic}}.
 *   - 402 Payment Required → CTA «Подключить модуль sms_marketing».
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import api from '../../api'
import { useToast } from '../../design'

const apiFetch = (m, url, _t, d) => api({ method: m, url, data: d })

// ── Доступные переменные для шаблона ───────────────────────────────────────
const VARIABLES = [
  { tag: '{{patient_name}}', label: 'Имя пациента',   demo: 'Иван' },
  { tag: '{{date}}',         label: 'Дата визита',    demo: '12.06' },
  { tag: '{{clinic}}',       label: 'Название клиники', demo: 'КлиникСеть' },
  { tag: '{{phone}}',        label: 'Телефон клиники', demo: '+7 800 000-00-00' },
  { tag: '{{discount}}',     label: 'Скидка %',       demo: '15' },
]

const EMPTY_FORM = { name: '', body: '', is_active: true }

// ── Утилиты длины SMS ──────────────────────────────────────────────────────
// Кириллица отправляется в UCS-2 (70 знаков на сегмент, 67 при concat),
// латиница — в GSM-7 (160 знаков, 153 при concat).
function detectEncoding(text) {
  // eslint-disable-next-line no-control-regex
  const isCyrillic = /[А-яЁё]/.test(text)
  return isCyrillic ? 'ucs2' : 'gsm7'
}
function smsSegments(text) {
  if (!text) return { len: 0, segs: 0, max: 160, encoding: 'gsm7' }
  const enc = detectEncoding(text)
  const len = text.length
  if (enc === 'ucs2') {
    const max = 70
    const segMax = len > 70 ? 67 : 70
    return { len, segs: len ? Math.ceil(len / segMax) : 0, max, encoding: 'ucs2' }
  }
  const max = 160
  const segMax = len > 160 ? 153 : 160
  return { len, segs: len ? Math.ceil(len / segMax) : 0, max, encoding: 'gsm7' }
}

// ── Подстановка demo-значений для preview ──────────────────────────────────
function renderPreview(body) {
  let out = body || ''
  for (const v of VARIABLES) {
    out = out.split(v.tag).join(v.demo)
  }
  return out
}

// ── Извлечь переменные, использованные в шаблоне ───────────────────────────
function usedVariables(body) {
  if (!body) return []
  const found = []
  for (const v of VARIABLES) {
    if (body.includes(v.tag)) found.push(v.tag)
  }
  return found
}

export default function SmsTemplatesSection({ token }) {
  const [items, setItems] = useState(null)
  const [err, setErr] = useState('')
  const [needPay, setNeedPay] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing]   = useState(null)
  const [form, setForm]         = useState(EMPTY_FORM)
  const [saving, setSaving]     = useState(false)
  const [showVarMenu, setShowVarMenu] = useState(false)
  const { toast } = useToast()

  const load = useCallback(async () => {
    setErr(''); setNeedPay(false)
    try {
      const r = await apiFetch('get', '/sms/templates', token)
      setItems(Array.isArray(r.data) ? r.data : [])
    } catch (e) {
      const code = e?.response?.status
      if (code === 402) setNeedPay(true)
      else setErr(e?.response?.data?.detail || 'Ошибка загрузки шаблонов')
      setItems([])
    }
  }, [token])

  useEffect(() => { load() }, [load])

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
    setShowVarMenu(false)
  }
  const openEdit = (tpl) => {
    setEditing(tpl)
    setForm({
      name: tpl.name || '',
      body: tpl.body || '',
      is_active: tpl.is_active !== false,
    })
    setShowForm(true)
    setShowVarMenu(false)
  }

  const insertVar = (tag) => {
    setForm(f => ({ ...f, body: (f.body || '') + tag }))
    setShowVarMenu(false)
  }

  const submit = async () => {
    if (!form.name.trim() || !form.body.trim()) {
      toast({ kind: 'error', text: 'Заполните название и текст шаблона' }); return
    }
    setSaving(true)
    try {
      const body = {
        name: form.name.trim(),
        body: form.body,
        is_active: !!form.is_active,
      }
      if (editing) {
        await apiFetch('patch', `/sms/templates/${editing.id}`, token, body)
        toast({ kind: 'success', text: 'Шаблон обновлён' })
      } else {
        await apiFetch('post', '/sms/templates', token, body)
        toast({ kind: 'success', text: 'Шаблон создан' })
      }
      setShowForm(false)
      await load()
    } catch (e) {
      toast({ kind: 'error', text: e?.response?.data?.detail || 'Ошибка сохранения' })
    } finally {
      setSaving(false)
    }
  }

  const onDelete = async (tpl) => {
    if (!confirm(`Удалить шаблон «${tpl.name}»?`)) return
    try {
      await apiFetch('delete', `/sms/templates/${tpl.id}`, token)
      toast({ kind: 'success', text: 'Шаблон удалён' })
      await load()
    } catch (e) {
      toast({ kind: 'error', text: e?.response?.data?.detail || 'Ошибка удаления' })
    }
  }

  const toggleActive = async (tpl) => {
    try {
      await apiFetch('patch', `/sms/templates/${tpl.id}`, token, { is_active: !tpl.is_active })
      await load()
    } catch (e) {
      toast({ kind: 'error', text: e?.response?.data?.detail || 'Ошибка изменения статуса' })
    }
  }

  const seg = useMemo(() => smsSegments(form.body), [form.body])
  const preview = useMemo(() => renderPreview(form.body), [form.body])

  if (needPay) {
    return (
      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-6 text-center">
        <span className="material-symbols-outlined text-[40px] text-amber-500 mb-2">sms</span>
        <div className="text-lg font-bold text-amber-900 dark:text-amber-200 mb-1">Модуль не подключён</div>
        <div className="text-sm text-amber-700 dark:text-amber-300 mb-4">
          Чтобы пользоваться SMS-маркетингом, подключите модуль <code className="bg-amber-100 dark:bg-amber-900/40 px-1 rounded">sms_marketing</code> (1&nbsp;990&nbsp;₽/мес).
        </div>
        <a href="../admin/modules_catalog" className="inline-block bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-xl text-sm font-semibold">
          Перейти в каталог модулей
        </a>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">
          {items === null ? 'Загрузка…' : `Шаблонов: ${items.length}`}
        </div>
        <button
          onClick={openCreate}
          className="bg-[#0097A7] hover:bg-[#00838F] text-white px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-1.5"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          Новый шаблон
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
          <span className="material-symbols-outlined text-[40px] text-gray-400 mb-2">sms</span>
          <div className="text-base font-semibold text-gray-700 dark:text-gray-200 mb-1">Шаблонов пока нет</div>
          <div className="text-sm text-gray-500 mb-4">Создайте первый шаблон — например, «Напоминание о визите»</div>
          <button onClick={openCreate} className="bg-[#0097A7] hover:bg-[#00838F] text-white px-4 py-2 rounded-xl text-sm font-semibold">
            Создать шаблон
          </button>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden border border-gray-100 dark:border-gray-700 admin-resp-table-wrap">
          <table className="admin-resp-table w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/40 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Название</th>
                <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Текст</th>
                <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Переменные</th>
                <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Создан</th>
                <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Активен</th>
                <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 text-right">Действия</th>
              </tr>
            </thead>
            <tbody>
              {items.map(t => {
                const vars = usedVariables(t.body)
                return (
                  <tr key={t.id} className="border-t border-gray-100 dark:border-gray-700">
                    <td data-label="Название" className="px-4 py-3 font-semibold text-gray-900 dark:text-white">{t.name}</td>
                    <td data-label="Текст" className="px-4 py-3 text-gray-600 dark:text-gray-300 max-w-md">
                      <div className="truncate" title={t.body}>{t.body}</div>
                    </td>
                    <td data-label="Переменные" className="px-4 py-3">
                      <div className="flex flex-wrap gap-1 justify-end md:justify-start">
                        {vars.length === 0 ? (
                          <span className="text-xs text-gray-400">—</span>
                        ) : vars.map(v => (
                          <span key={v} className="text-[10px] font-mono bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">{v}</span>
                        ))}
                      </div>
                    </td>
                    <td data-label="Создан" className="px-4 py-3 text-xs text-gray-500">
                      {t.created_at ? new Date(t.created_at).toLocaleDateString('ru') : '—'}
                    </td>
                    <td data-label="Активен" className="px-4 py-3">
                      <button
                        onClick={() => toggleActive(t)}
                        className={`admin-tap-44 inline-flex items-center gap-1 text-xs font-semibold px-3 py-2 rounded-full ${
                          t.is_active
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                            : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                        }`}
                      >
                        <span className="material-symbols-outlined text-[14px]">
                          {t.is_active ? 'check_circle' : 'pause_circle'}
                        </span>
                        {t.is_active ? 'Активен' : 'Пауза'}
                      </button>
                    </td>
                    <td data-label="Действия" className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => openEdit(t)} className="admin-tap-44 text-[#0097A7] hover:underline text-xs font-semibold mr-3 px-2 py-2">Изменить</button>
                      <button onClick={() => onDelete(t)} className="admin-tap-44 text-red-500 hover:underline text-xs font-semibold px-2 py-2">Удалить</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-3xl shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between sticky top-0 bg-white dark:bg-gray-800 z-10">
              <div className="text-lg font-bold text-gray-900 dark:text-white">
                {editing ? 'Редактирование шаблона' : 'Новый шаблон'}
              </div>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-700">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Левая колонка — форма */}
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Название</label>
                  <input
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Напоминание о визите"
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 dark:text-white text-sm"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400">Текст SMS</label>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setShowVarMenu(v => !v)}
                        className="text-xs font-semibold text-[#0097A7] hover:underline flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-[14px]">add_circle</span>
                        Вставить переменную
                      </button>
                      {showVarMenu && (
                        <div className="absolute right-0 top-6 z-20 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg w-64 py-1">
                          {VARIABLES.map(v => (
                            <button
                              key={v.tag}
                              type="button"
                              onClick={() => insertVar(v.tag)}
                              className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-between gap-2"
                            >
                              <span className="text-xs text-gray-600 dark:text-gray-300">{v.label}</span>
                              <code className="text-[11px] font-mono text-[#0097A7]">{v.tag}</code>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <textarea
                    rows={6}
                    value={form.body}
                    onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                    placeholder="Здравствуйте, {{patient_name}}! Напоминаем о визите {{date}} в {{clinic}}."
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 dark:text-white text-sm font-mono"
                  />
                  <div className="flex items-center justify-between mt-1.5 text-[11px] text-gray-500">
                    <span>
                      {seg.encoding === 'ucs2' ? 'Кириллица (UCS-2)' : 'Латиница (GSM-7)'}
                    </span>
                    <span className={seg.segs > 3 ? 'text-amber-600 font-semibold' : ''}>
                      {seg.len} симв. · {seg.segs} SMS-сегмент(ов) · max {seg.max}/сегмент
                    </span>
                  </div>
                </div>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!!form.is_active}
                    onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                  />
                  <span className="text-gray-700 dark:text-gray-300">Активный шаблон</span>
                </label>
              </div>

              {/* Правая колонка — preview + переменные */}
              <div className="space-y-4">
                <div>
                  <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Live-preview</div>
                  <div className="bg-gray-50 dark:bg-gray-900 rounded-2xl p-4 border border-gray-100 dark:border-gray-700">
                    <div className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-900 dark:text-emerald-100 rounded-2xl rounded-bl-md px-4 py-3 text-sm whitespace-pre-wrap break-words shadow-sm max-w-full">
                      {preview || <span className="italic text-gray-400">Пустое сообщение</span>}
                    </div>
                    <div className="text-[10px] text-gray-400 mt-2 text-right">
                      Подставлены demo-значения переменных
                    </div>
                  </div>
                </div>

                <div>
                  <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Доступные переменные</div>
                  <div className="space-y-1.5">
                    {VARIABLES.map(v => (
                      <div key={v.tag} className="flex items-center justify-between text-xs bg-gray-50 dark:bg-gray-900/40 px-3 py-1.5 rounded-lg">
                        <span className="text-gray-600 dark:text-gray-300">{v.label}</span>
                        <code className="font-mono text-[#0097A7]">{v.tag}</code>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="px-5 py-3 bg-gray-50 dark:bg-gray-900/40 rounded-b-2xl flex justify-end gap-2 sticky bottom-0">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg text-sm font-semibold border border-gray-200 dark:border-gray-700">
                Отмена
              </button>
              <button onClick={submit} disabled={saving || !form.name.trim() || !form.body.trim()} className="bg-[#0097A7] hover:bg-[#00838F] disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-semibold">
                {saving ? 'Сохранение…' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
