/**
 * CreateReferralDrawer — inline-форма создания направления прямо из чата.
 * Не требует перехода на другую страницу.
 */
import { useState, useEffect } from 'react'
import api from '../../api'

export default function CreateReferralDrawer({ open, onClose, threadId, clinicId, patientPhone, patientName, onCreated }) {
  const [type, setType] = useState('service')
  const [services, setServices] = useState([])
  const [doctors, setDoctors] = useState([])
  const [serviceId, setServiceId] = useState('')
  const [doctorId, setDoctorId] = useState('')
  const [labTests, setLabTests] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(null)

  useEffect(() => {
    if (!open) {
      setType('service'); setServiceId(''); setDoctorId(''); setLabTests(''); setNotes(''); setErr(''); setDone(null)
      return
    }
    // Загружаем услуги и врачей клиники
    api.get('/clinics/' + clinicId + '/services')
      .then(r => setServices(Array.isArray(r.data) ? r.data : (r.data?.items || [])))
      .catch(() => setServices([]))
    api.get('/doctors', { params: { clinic_id: clinicId } })
      .then(r => setDoctors(Array.isArray(r.data) ? r.data : (r.data?.items || [])))
      .catch(() => setDoctors([]))
  }, [open, clinicId])

  if (!open) return null

  const submit = async () => {
    setErr('')
    if (type === 'service' && !serviceId) { setErr('Выберите услугу'); return }
    if (type === 'doctor' && !doctorId) { setErr('Выберите врача'); return }
    if (type === 'lab' && !labTests.trim()) { setErr('Укажите анализы'); return }
    setBusy(true)
    try {
      const payload = {
        to_clinic_id: clinicId,
        patient_phone: patientPhone,
        patient_name: patientName || null,
        referral_type: type,
        notes: notes.trim() || null,
      }
      if (type === 'service') payload.service_id = serviceId
      if (type === 'doctor') payload.target_doctor_id = doctorId
      if (type === 'lab') payload.lab_tests = labTests.trim()
      const r = await api.post('/referrals/', payload)
      setDone(r.data)
      onCreated?.(r.data)
    } catch (e) {
      const d = e?.response?.data?.detail
      let m = 'Не удалось создать направление'
      if (typeof d === 'string') m = d
      else if (Array.isArray(d)) m = d.map(x => x?.msg || JSON.stringify(x)).join('; ')
      setErr(m)
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center"
         style={{ background: 'rgba(15,23,42,.55)', backdropFilter: 'blur(4px)' }}
         onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
           className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl overflow-hidden"
           style={{ background: 'var(--sc-surface, var(--bg, #fff))', color: 'var(--sc-fg, #0f172a)', boxShadow: '0 20px 60px rgba(0,0,0,.35)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        <div className="px-5 py-4 flex items-center justify-between border-b" style={{ borderColor: 'var(--sc-border, #e5e7eb)' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Создать направление</div>
            <div style={{ fontSize: 12, color: 'var(--sc-fg-3, #94a3b8)', marginTop: 2 }}>{patientName || patientPhone}</div>
          </div>
          <button onClick={onClose} style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--sc-bg, #f1f5f9)', display: 'grid', placeItems: 'center' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>close</span>
          </button>
        </div>

        {done ? (
          <div style={{ padding: 24, textAlign: 'center', overflow: 'auto' }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--sc-accent, #0097A7)', marginBottom: 12 }}>✓ Направление создано</div>
            <div style={{ fontSize: 14, marginBottom: 16 }}>Код для пациента:</div>
            <div style={{ fontSize: 40, fontWeight: 700, fontFamily: 'monospace', color: '#16a34a', marginBottom: 16 }}>{done.short_code || '—'}</div>
            <div style={{ fontSize: 12, color: 'var(--sc-fg-3, #94a3b8)' }}>Telegram-link/WhatsApp пациенту отправлены автоматически</div>
            <button onClick={onClose} style={{ marginTop: 20, padding: '12px 24px', background: 'var(--sc-accent, #0097A7)', color: '#fff', borderRadius: 10, fontWeight: 600 }}>Закрыть</button>
          </div>
        ) : (
          <div style={{ padding: 20, overflow: 'auto', flex: 1 }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
              {[['service','Услуга'],['doctor','Врач'],['lab','Анализы']].map(([k, l]) => (
                <button key={k} onClick={() => setType(k)} style={{
                  flex: 1, padding: '8px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                  background: type === k ? 'var(--sc-accent-soft, #ecfeff)' : 'transparent',
                  color: type === k ? 'var(--sc-accent, #0097A7)' : 'var(--sc-fg-2, #475569)',
                  border: '1px solid ' + (type === k ? 'var(--sc-accent, #0097A7)' : 'var(--sc-border, #e2e8f0)'),
                }}>{l}</button>
              ))}
            </div>

            {type === 'service' && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--sc-fg-2, #475569)', display: 'block', marginBottom: 6 }}>Услуга</label>
                <select value={serviceId} onChange={e => setServiceId(e.target.value)} style={{ width: '100%', padding: 10, borderRadius: 10, border: '1px solid var(--sc-border, #e2e8f0)', background: 'var(--sc-bg-alt, #fff)', color: 'var(--sc-fg, #0f172a)', fontSize: 14 }}>
                  <option value="">— выберите услугу —</option>
                  {services.map(s => <option key={s.id} value={s.id}>{s.name} {s.price ? '· ' + s.price + ' ₽' : ''}</option>)}
                </select>
              </div>
            )}
            {type === 'doctor' && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--sc-fg-2, #475569)', display: 'block', marginBottom: 6 }}>Врач</label>
                <select value={doctorId} onChange={e => setDoctorId(e.target.value)} style={{ width: '100%', padding: 10, borderRadius: 10, border: '1px solid var(--sc-border, #e2e8f0)', background: 'var(--sc-bg-alt, #fff)', color: 'var(--sc-fg, #0f172a)', fontSize: 14 }}>
                  <option value="">— выберите врача —</option>
                  {doctors.map(d => <option key={d.id} value={d.id}>{d.full_name} {d.specialty ? '· ' + d.specialty : ''}</option>)}
                </select>
              </div>
            )}
            {type === 'lab' && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--sc-fg-2, #475569)', display: 'block', marginBottom: 6 }}>Анализы</label>
                <textarea value={labTests} onChange={e => setLabTests(e.target.value)} placeholder="ОАК, биохимия, гормоны…" rows={3} style={{ width: '100%', padding: 10, borderRadius: 10, border: '1px solid var(--sc-border, #e2e8f0)', background: 'var(--sc-bg-alt, #fff)', color: 'var(--sc-fg, #0f172a)', fontSize: 14, resize: 'vertical' }} />
              </div>
            )}

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--sc-fg-2, #475569)', display: 'block', marginBottom: 6 }}>Комментарий (опционально)</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ width: '100%', padding: 10, borderRadius: 10, border: '1px solid var(--sc-border, #e2e8f0)', background: 'var(--sc-bg-alt, #fff)', color: 'var(--sc-fg, #0f172a)', fontSize: 14, resize: 'vertical' }} />
            </div>

            {err && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 8, fontSize: 13, marginBottom: 16 }}>{err}</div>}

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={onClose} style={{ flex: 1, padding: 12, borderRadius: 10, background: 'var(--sc-bg, #f1f5f9)', color: 'var(--sc-fg-2, #475569)', fontWeight: 600 }}>Отмена</button>
              <button onClick={submit} disabled={busy} style={{ flex: 1, padding: 12, borderRadius: 10, background: 'var(--sc-accent, #0097A7)', color: '#fff', fontWeight: 600, opacity: busy ? 0.5 : 1 }}>{busy ? 'Создание…' : 'Создать'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
