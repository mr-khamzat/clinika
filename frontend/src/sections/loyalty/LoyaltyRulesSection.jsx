/**
 * LoyaltyRulesSection — правила автоматического начисления баллов.
 *
 * Типы правил:
 *   visit       — за каждую запись/визит (бонус фикс. или %)
 *   referral    — за приведённого пациента (партнёр/реклама)
 *   birthday    — фикс. бонус в день рождения пациента
 *   specialist  — за визит к узкому специалисту (фильтр в conditions)
 *
 * API:
 *   GET    /loyalty/rules
 *   POST   /loyalty/rules
 *   PATCH  /loyalty/rules/{id}
 *   DELETE /loyalty/rules/{id}
 */
import { useState, useEffect, useCallback } from 'react'
import api from '../../api'
import { useToast } from '../../design'

const apiFetch = (m, url, _t, d) => api({ method: m, url, data: d })

const RULE_TYPES = [
  { id: 'visit',      label: 'За запись/визит',          icon: 'event_available' },
  { id: 'referral',   label: 'За реферала',              icon: 'group_add' },
  { id: 'birthday',   label: 'День рождения',            icon: 'cake' },
  { id: 'specialist', label: 'Визит к узкому спец-ту',   icon: 'medical_services' },
]
const TYPE_LABEL = Object.fromEntries(RULE_TYPES.map(t => [t.id, t.label]))
const TYPE_ICON  = Object.fromEntries(RULE_TYPES.map(t => [t.id, t.icon]))

const EMPTY_FORM = {
  name: '',
  rule_type: 'visit',
  bonus_amount: 0,
  bonus_pct: 0,
  is_active: true,
  valid_from: '',
  valid_until: '',
  conditions: '',  // JSON string
}

export default function LoyaltyRulesSection({ token }) {
  const [rules, setRules] = useState(null)
  const [err, setErr] = useState('')
  const [needPay, setNeedPay] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()

  const load = useCallback(async () => {
    setErr(''); setNeedPay(false)
    try {
      const r = await apiFetch('get', '/loyalty/rules', token)
      setRules(Array.isArray(r.data) ? r.data : [])
    } catch (e) {
      const code = e?.response?.status
      if (code === 402) setNeedPay(true)
      else setErr(e?.response?.data?.detail || 'Ошибка загрузки правил')
      setRules([])
    }
  }, [token])

  useEffect(() => { load() }, [load])

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setShowForm(true) }
  const openEdit = (rule) => {
    setEditing(rule)
    setForm({
      name: rule.name,
      rule_type: rule.rule_type,
      bonus_amount: rule.bonus_amount,
      bonus_pct: Number(rule.bonus_pct),
      is_active: rule.is_active,
      valid_from: rule.valid_from ? rule.valid_from.slice(0, 16) : '',
      valid_until: rule.valid_until ? rule.valid_until.slice(0, 16) : '',
      conditions: rule.conditions ? JSON.stringify(rule.conditions, null, 2) : '',
    })
    setShowForm(true)
  }

  const submit = async () => {
    setSaving(true)
    try {
      let conditions = null
      if (form.conditions?.trim()) {
        try { conditions = JSON.parse(form.conditions) }
        catch { toast({ kind: 'error', text: '«Условия» — некорректный JSON' }); setSaving(false); return }
      }
      const body = {
        name: form.name.trim(),
        rule_type: form.rule_type,
        bonus_amount: Number(form.bonus_amount) || 0,
        bonus_pct: Number(form.bonus_pct) || 0,
        is_active: !!form.is_active,
        valid_from: form.valid_from ? new Date(form.valid_from).toISOString() : null,
        valid_until: form.valid_until ? new Date(form.valid_until).toISOString() : null,
        conditions,
      }
      if (editing) {
        await apiFetch('patch', `/loyalty/rules/${editing.id}`, token, body)
        toast({ kind: 'success', text: 'Правило обновлено' })
      } else {
        await apiFetch('post', '/loyalty/rules', token, body)
        toast({ kind: 'success', text: 'Правило создано' })
      }
      setShowForm(false); await load()
    } catch (e) {
      toast({ kind: 'error', text: e?.response?.data?.detail || 'Ошибка сохранения' })
    } finally { setSaving(false) }
  }

  const onDelete = async (rule) => {
    if (!confirm(`Удалить правило «${rule.name}»?`)) return
    try {
      await apiFetch('delete', `/loyalty/rules/${rule.id}`, token)
      toast({ kind: 'success', text: 'Правило удалено' })
      await load()
    } catch (e) {
      toast({ kind: 'error', text: e?.response?.data?.detail || 'Ошибка удаления' })
    }
  }

  if (needPay) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
        Подключите модуль <code>loyalty_pro</code> в каталоге.
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">{rules === null ? 'Загрузка…' : `Правил: ${rules.length}`}</div>
        <button onClick={openCreate} className="bg-[#0097A7] hover:bg-[#00838F] text-white px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[18px]">add</span>
          Новое правило
        </button>
      </div>

      {err && <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-600 text-sm">{err}</div>}

      {rules === null ? (
        <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-[#0097A7] border-t-transparent rounded-full animate-spin" /></div>
      ) : rules.length === 0 ? (
        <div className="bg-gray-50 dark:bg-gray-800/50 border border-dashed border-gray-200 dark:border-gray-700 rounded-2xl p-10 text-center">
          <span className="material-symbols-outlined text-[40px] text-gray-400 mb-2">rule</span>
          <div className="text-base font-semibold text-gray-700 dark:text-gray-200 mb-1">Правил пока нет</div>
          <div className="text-sm text-gray-500 mb-4">
            Например: «За каждый визит +50 баллов» или «День рождения +500».
          </div>
          <button onClick={openCreate} className="bg-[#0097A7] hover:bg-[#00838F] text-white px-4 py-2 rounded-xl text-sm font-semibold">
            Создать правило
          </button>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/40 text-gray-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left">Название</th>
                <th className="px-4 py-3 text-left">Тип</th>
                <th className="px-4 py-3 text-right">Бонус</th>
                <th className="px-4 py-3 text-center">Активно</th>
                <th className="px-4 py-3 text-left">Период</th>
                <th className="px-4 py-3 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {rules.map(r => (
                <tr key={r.id} className="border-t border-gray-100 dark:border-gray-700">
                  <td className="px-4 py-3 text-gray-900 dark:text-white font-medium">{r.name}</td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[16px] text-[#0097A7]">{TYPE_ICON[r.rule_type] || 'rule'}</span>
                      {TYPE_LABEL[r.rule_type] || r.rule_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">
                    {r.bonus_amount > 0 && <span>+{r.bonus_amount} б.</span>}
                    {Number(r.bonus_pct) > 0 && <span className="ml-1 text-xs text-gray-400">({r.bonus_pct}%)</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {r.is_active ? (
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-700">да</span>
                    ) : (
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500">нет</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {r.valid_from ? new Date(r.valid_from).toLocaleDateString('ru') : '—'}
                    {' – '}
                    {r.valid_until ? new Date(r.valid_until).toLocaleDateString('ru') : '∞'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openEdit(r)} className="text-[#0097A7] hover:underline text-xs font-semibold mr-3">Изменить</button>
                    <button onClick={() => onDelete(r)} className="text-red-500 hover:underline text-xs font-semibold">Удалить</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-xl shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <div className="text-lg font-bold">{editing ? 'Редактирование правила' : 'Новое правило'}</div>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-700">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Название</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 text-sm"
                  placeholder="Например: «Визит к стоматологу +100 баллов»" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Тип правила</label>
                <select value={form.rule_type} onChange={e => setForm(f => ({ ...f, rule_type: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 text-sm">
                  {RULE_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Бонус (баллы)</label>
                  <input type="number" min="0" value={form.bonus_amount} onChange={e => setForm(f => ({ ...f, bonus_amount: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Или процент (%)</label>
                  <input type="number" min="0" max="100" step="0.5" value={form.bonus_pct} onChange={e => setForm(f => ({ ...f, bonus_pct: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Действует с</label>
                  <input type="datetime-local" value={form.valid_from} onChange={e => setForm(f => ({ ...f, valid_from: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Действует до</label>
                  <input type="datetime-local" value={form.valid_until} onChange={e => setForm(f => ({ ...f, valid_until: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Условия (JSON, необязательно)</label>
                <textarea rows={3} value={form.conditions} onChange={e => setForm(f => ({ ...f, conditions: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 text-sm font-mono"
                  placeholder='{"service_ids":[1,2], "doctor_ids":[3]}' />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                Активно (применять автоматически)
              </label>
            </div>
            <div className="px-5 py-3 bg-gray-50 dark:bg-gray-900/40 rounded-b-2xl flex justify-end gap-2">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg text-sm font-semibold border border-gray-200 dark:border-gray-700">Отмена</button>
              <button onClick={submit} disabled={saving || !form.name.trim()} className="bg-[#0097A7] hover:bg-[#00838F] disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-semibold">
                {saving ? 'Сохранение…' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
