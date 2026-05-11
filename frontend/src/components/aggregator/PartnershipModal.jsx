/**
 * ========================================
 * БЛОК: PartnershipModal — модал создания/редактирования партнёрства (Глава 10)
 * ========================================
 * Использует Modal/Button из дизайн-системы.
 *
 * Для нового партнёрства — POST /admin/aggregator/partnerships возвращает
 * объект с plaintext api_key, который показывается ОДИН РАЗ в отдельном
 * <ApiKeyDisplayModal>. Здесь же только форма и валидация.
 *
 * Props:
 *   - open: bool
 *   - initial: объект для редактирования или null
 *   - onClose()
 *   - onSaved(result) — для create передаётся ответ POST (с api_key);
 *                       для edit — null
 * ========================================
 */
import { useEffect, useState } from 'react'
import api from '../../api'
import { useToast, Modal, Button } from '../../design'

// Preset partner-codes — синхронизировано с backend admin_aggregator router.
// Если бекенд не валидирует — пользователь может выбрать «Другой» и ввести своё.
const PARTNER_PRESETS = [
  { value: 'docdoc',         label: 'DocDoc'         },
  { value: 'prodoctorov',    label: 'ПроДокторов'    },
  { value: 'yandex_health',  label: 'Яндекс.Здоровье'},
  { value: 'sberhealth',     label: 'СберЗдоровье'   },
  { value: 'other',          label: 'Другой агрегатор' },
]

const EMPTY = {
  partner_name: 'docdoc',
  partner_name_custom: '',
  commission_pct: 10,
  status: 'active',
}

function Field({ label, children, hint }) {
  return (
    <div>
      <label className="block mb-1" style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </label>
      {children}
      {hint && (
        <div className="mt-1 text-[11px]" style={{ color: '#94a3b8' }}>{hint}</div>
      )}
    </div>
  )
}

export default function PartnershipModal({ open, initial, onClose, onSaved }) {
  const isEdit = !!initial
  const { toast } = useToast()
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (initial) {
      // Если partner_name среди пресетов — кладём в select, иначе → «other» + custom
      const isPreset = PARTNER_PRESETS.some(p => p.value === initial.partner_name && p.value !== 'other')
      setForm({
        partner_name: isPreset ? initial.partner_name : 'other',
        partner_name_custom: isPreset ? '' : (initial.partner_name || ''),
        commission_pct: Number(initial.commission_pct || 10),
        status: initial.status || 'active',
      })
    } else {
      setForm(EMPTY)
    }
  }, [initial, open])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async () => {
    const isOther = form.partner_name === 'other'
    const finalName = isOther ? form.partner_name_custom.trim() : form.partner_name
    if (!finalName) {
      toast({ kind: 'error', text: 'Введите название партнёра' })
      return
    }
    const pct = Number(form.commission_pct)
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      toast({ kind: 'error', text: 'Комиссия должна быть 0–100%' })
      return
    }
    setBusy(true)
    try {
      if (isEdit) {
        await api.patch(`/admin/aggregator/partnerships/${initial.id}`, {
          commission_pct: pct,
          status: form.status,
        })
        toast({ kind: 'success', text: 'Партнёрство обновлено' })
        onSaved && onSaved(null)
      } else {
        const r = await api.post('/admin/aggregator/partnerships', {
          partner_name: finalName,
          commission_pct: pct,
        })
        toast({ kind: 'success', text: 'Партнёрство создано' })
        // Передаём наверх ответ — там покажется api_key
        onSaved && onSaved(r.data)
      }
      onClose && onClose()
    } catch (e) {
      toast({ kind: 'error', text: e?.response?.data?.detail || 'Не удалось сохранить' })
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null
  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Редактирование партнёрства' : 'Подключить партнёра-агрегатор'} size="md">
      <div className="flex flex-col gap-3" style={{ minWidth: 320 }}>
        {!isEdit && (
          <>
            <Field label="Партнёр-агрегатор">
              <select
                value={form.partner_name}
                onChange={e => set('partner_name', e.target.value)}
                className="w-full rounded-xl"
                style={{ padding: '9px 12px', border: '1px solid #e2e8f0', fontSize: 13, background: '#fff', outline: 'none' }}
              >
                {PARTNER_PRESETS.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </Field>

            {form.partner_name === 'other' && (
              <Field label="Название партнёра*">
                <input
                  value={form.partner_name_custom}
                  onChange={e => set('partner_name_custom', e.target.value)}
                  placeholder="my_aggregator"
                  className="w-full rounded-xl"
                  style={{ padding: '9px 12px', border: '1px solid #e2e8f0', fontSize: 13, outline: 'none' }}
                />
              </Field>
            )}
          </>
        )}

        {isEdit && (
          <div
            className="rounded-xl p-3 text-xs"
            style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#475569' }}
          >
            Партнёр: <b style={{ color: '#0f172a' }}>{initial.partner_name}</b>
            <div className="mt-1 text-[11px]" style={{ color: '#94a3b8' }}>
              Имя партнёра нельзя изменить — оно зашито в API-ключе.
            </div>
          </div>
        )}

        <Field
          label="Комиссия партнёра, %"
          hint="Сколько процентов от стоимости приёма платится партнёру при completed-лиде"
        >
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="0"
              max="50"
              step="0.5"
              value={form.commission_pct}
              onChange={e => set('commission_pct', e.target.value)}
              className="flex-1"
              style={{ accentColor: '#0097A7' }}
            />
            <input
              type="number"
              min="0"
              max="100"
              step="0.5"
              value={form.commission_pct}
              onChange={e => set('commission_pct', e.target.value)}
              className="rounded-lg text-center"
              style={{ width: 76, padding: '8px 10px', border: '1px solid #e2e8f0', fontSize: 13, outline: 'none', fontVariantNumeric: 'tabular-nums' }}
            />
            <span className="text-sm font-bold" style={{ color: '#0097A7' }}>%</span>
          </div>
        </Field>

        {isEdit && (
          <Field label="Статус">
            <select
              value={form.status}
              onChange={e => set('status', e.target.value)}
              className="w-full rounded-xl"
              style={{ padding: '9px 12px', border: '1px solid #e2e8f0', fontSize: 13, background: '#fff', outline: 'none' }}
            >
              <option value="active">Активно (принимаем лиды)</option>
              <option value="suspended">Приостановлено</option>
            </select>
          </Field>
        )}

        {!isEdit && (
          <div
            className="rounded-xl p-3 text-[11.5px] leading-relaxed"
            style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}
          >
            <b>После создания</b> сгенерируется API-ключ. Он будет показан <b>один раз</b>.
            Скопируйте и передайте партнёру — повторно прочитать ключ из системы будет нельзя.
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-3" style={{ borderTop: '1px solid #f1f5f9' }}>
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? 'Сохраняем…' : (isEdit ? 'Сохранить' : 'Создать партнёрство')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
