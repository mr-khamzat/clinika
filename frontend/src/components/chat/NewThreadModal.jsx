/**
 * ========================================
 * БЛОК: NewThreadModal — создание нового треда чата (Глава 9)
 * ========================================
 * Пациент выбирает клинику из своей истории, тему (опционально) и пишет
 * первое сообщение. POST /patient/chat/threads → callback с новым тредом.
 *
 * Props:
 *   open       — bool
 *   onClose    — () => void
 *   onCreated  — (thread) => void   // вернёт созданный thread с id
 *   sessionToken — токен пациента
 *   clinics    — [{ id, name }]    список клиник, где у пациента есть история
 *   busy       — bool (опц.) — глобальный busy state снаружи
 *   apiBase    — base URL API
 * ========================================
 */
import { useState, useEffect } from 'react'
import axios from 'axios'

export default function NewThreadModal({ open, onClose, onCreated, sessionToken, clinics = [], apiBase }) {
  const [clinicId, setClinicId] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!open) {
      setClinicId(''); setSubject(''); setBody(''); setErr('')
    } else if (clinics.length === 1) {
      setClinicId(String(clinics[0].id))
    }
  }, [open, clinics])

  if (!open) return null

  const submit = async (e) => {
    e?.preventDefault?.()
    setErr('')
    if (!clinicId) { setErr('Выберите клинику'); return }
    if (!body.trim()) { setErr('Напишите сообщение'); return }
    setBusy(true)
    try {
      const r = await axios.post(
        `${apiBase}/patient/chat/threads`,
        {
          clinic_id: String(clinicId),
          subject: subject.trim() || null,
          initial_message: body.trim(),
        },
        { params: { t: sessionToken } }
      )
      onCreated?.(r.data)
    } catch (e) {
      const code = e?.response?.status
      if (code === 402) setErr('Превышен лимит чатов. Подключите подписку «Здоровье+»')
      else {
        const d = e?.response?.data?.detail
        let msg = 'Не удалось создать чат'
        if (typeof d === 'string') msg = d
        else if (Array.isArray(d)) msg = d.map(x => x?.msg || x?.loc?.join('.') || JSON.stringify(x)).join('; ')
        else if (d && typeof d === 'object') msg = d.msg || JSON.stringify(d)
        setErr(msg)
      }
    }
    setBusy(false)
  }

  return (
    <div
      className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center"
      style={{ background: 'rgba(15,23,42,.55)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl overflow-hidden"
        style={{ background: '#ffffff', color: '#0f172a', boxShadow: '0 20px 60px rgba(0,0,0,.35)' }}
      >
        <div className="px-5 py-4 flex items-center justify-between border-b" style={{ borderColor: 'var(--border, #e2e8f0)' }}>
          <div>
            <div className="font-bold" style={{ fontSize: 16, color: 'var(--fg, #0F172A)' }}>Новый чат с клиникой</div>
            <div style={{ fontSize: 12, color: 'var(--fg-3, #94a3b8)' }}>Поддержка ответит в течение рабочего дня</div>
          </div>
          <button
            onClick={onClose}
            className="grid place-items-center"
            style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--bg-1, #f1f5f9)', color: 'var(--fg-2, #475569)' }}
            aria-label="Закрыть"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>close</span>
          </button>
        </div>

        <form onSubmit={submit} className="px-5 py-4 space-y-4">
          {/* Клиника */}
          <div>
            <label className="block mb-1.5 font-semibold" style={{ fontSize: 12, color: 'var(--fg-2, #475569)' }}>Клиника</label>
            {clinics.length === 0 ? (
              <div className="rounded-xl px-3 py-2 text-sm" style={{ background: '#fef3c7', color: '#92400e' }}>
                Не найдено клиник с историей. Сначала запишитесь на приём.
              </div>
            ) : (
              <select
                value={clinicId}
                onChange={(e) => setClinicId(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl outline-none"
                style={{ background: 'var(--bg-1, #f8fafc)', border: '1px solid var(--border, #e2e8f0)', fontSize: 14, color: 'var(--fg, #0F172A)' }}
              >
                <option value="">— выберите клинику —</option>
                {clinics.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Тема */}
          <div>
            <label className="block mb-1.5 font-semibold" style={{ fontSize: 12, color: 'var(--fg-2, #475569)' }}>Тема (необязательно)</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="например: уточнение анализов"
              maxLength={120}
              className="w-full px-3 py-2.5 rounded-xl outline-none"
              style={{ background: 'var(--bg-1, #f8fafc)', border: '1px solid var(--border, #e2e8f0)', fontSize: 14 }}
            />
          </div>

          {/* Первое сообщение */}
          <div>
            <label className="block mb-1.5 font-semibold" style={{ fontSize: 12, color: 'var(--fg-2, #475569)' }}>Сообщение</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Опишите вопрос..."
              rows={4}
              maxLength={2000}
              className="w-full px-3 py-2.5 rounded-xl outline-none resize-y"
              style={{ background: 'var(--bg-1, #f8fafc)', border: '1px solid var(--border, #e2e8f0)', fontSize: 14, minHeight: 96 }}
            />
            <div className="text-right mt-1" style={{ fontSize: 11, color: 'var(--fg-3, #94a3b8)' }}>{body.length}/2000</div>
          </div>

          {err && (
            <div className="rounded-xl px-3 py-2" style={{ background: '#fee2e2', color: '#991b1b', fontSize: 13 }}>
              {err}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl font-semibold"
              style={{ background: 'var(--bg-1, #f1f5f9)', color: 'var(--fg-2, #475569)', fontSize: 14 }}
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={busy || clinics.length === 0}
              className="flex-1 py-2.5 rounded-xl font-semibold text-white disabled:opacity-50"
              style={{
                background: 'linear-gradient(135deg, #0097A7, #0A2342)',
                fontSize: 14, boxShadow: '0 4px 14px rgba(0,151,167,.3)',
              }}
            >
              {busy ? 'Отправляем…' : 'Отправить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
