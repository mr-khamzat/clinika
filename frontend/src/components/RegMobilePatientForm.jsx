/**
 * ========================================
 * КОМПОНЕНТ: RegMobilePatientForm — mobile-first форма пациента (Глава 5)
 * ========================================
 * Премиум-форма для регистратора на планшете/телефоне:
 *   • Шаг-индикатор: 1. Контакты → 2. Паспорт → 3. Запись на приём
 *   • Большие input (h:56, fz:18)
 *   • Маска телефона +7 ___ ___-__-__ (вживую)
 *   • Дата рождения: 3 select (день / месяц / год) — стабильно на старых Android
 *   • Авто-поиск дубликатов по телефону:
 *       GET /referrals/patients/search?phone=…
 *   • Согласие 152-ФЗ — обязательный чекбокс
 *   • Опционально: «Отправить SMS с подтверждением записи»
 *   • Кнопки прилипают к низу на mobile (<768)
 *   • Toast-уведомления через useToast
 *
 * Открывается как модал. onClose / onCreated.
 * Если onCreated передан с пациентом — кабинет открывает «Запись на приём».
 * ========================================
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import apiClient from '../api'
import { useToast } from '../design'

const MONTHS_RU = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
]

// Маска +7 ___ ___-__-__
function formatPhone(raw) {
  // Оставляем только цифры
  let d = (raw || '').replace(/\D/g, '')
  // Если ввод начинается с 8 — заменяем на 7
  if (d.startsWith('8')) d = '7' + d.slice(1)
  // Если нет ведущей 7 — добавляем (RU-формат)
  if (d.length > 0 && !d.startsWith('7')) d = '7' + d
  d = d.slice(0, 11)
  if (d.length <= 1) return d ? '+' + d : ''
  const a = d.slice(1, 4)
  const b = d.slice(4, 7)
  const c = d.slice(7, 9)
  const e = d.slice(9, 11)
  let out = '+7'
  if (a) out += ' ' + a
  if (b) out += ' ' + b
  if (c) out += '-' + c
  if (e) out += '-' + e
  return out
}

function digitsOf(s) { return (s || '').replace(/\D/g, '') }

function Icon({ name, size = 18 }) {
  return (
    <span
      className="material-symbols-outlined"
      style={{ fontSize: size, fontVariationSettings: `'FILL' 1`, lineHeight: 1 }}
    >{name}</span>
  )
}

const inputBase = {
  width: '100%',
  height: 56,
  padding: '0 16px',
  fontSize: 18,
  background: 'var(--surface, #fff)',
  color: 'var(--fg, #111)',
  border: '1.5px solid var(--border, #d1d5db)',
  borderRadius: 12,
  outline: 'none',
  transition: 'border-color .12s, box-shadow .12s',
}
const labelBase = {
  display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 6,
  letterSpacing: 0.04, textTransform: 'uppercase', color: 'var(--fg-3, #555)',
}

export default function RegMobilePatientForm({
  open,
  onClose,
  onCreated,        // (patient) => void — например, открыть форму записи
  smsModuleEnabled = false,
}) {
  const { toast } = useToast?.() || { toast: () => {} }
  const [step, setStep] = useState(1)
  const [busy, setBusy] = useState(false)
  const [phoneRaw, setPhoneRaw] = useState('')
  const [lastName, setLastName] = useState('')
  const [firstName, setFirstName] = useState('')
  const [middleName, setMiddleName] = useState('')
  const [day, setDay] = useState('')
  const [month, setMonth] = useState('')
  const [year, setYear] = useState('')
  // Паспорт (необязательный)
  const [passportSeries, setPassportSeries] = useState('')
  const [passportNumber, setPassportNumber] = useState('')
  // Запись (опционально)
  const [bookNow, setBookNow] = useState(false)
  const [smsConfirm, setSmsConfirm] = useState(true)
  const [consent, setConsent] = useState(false)
  // Дубликат
  const [duplicate, setDuplicate] = useState(null)
  const [searchingDup, setSearchingDup] = useState(false)
  const dupTimerRef = useRef(null)

  useEffect(() => {
    if (open) {
      setStep(1); setBusy(false)
      setPhoneRaw(''); setLastName(''); setFirstName(''); setMiddleName('')
      setDay(''); setMonth(''); setYear('')
      setPassportSeries(''); setPassportNumber('')
      setBookNow(false); setSmsConfirm(true); setConsent(false)
      setDuplicate(null); setSearchingDup(false)
    }
  }, [open])

  // Авто-поиск дубликата при вводе телефона
  useEffect(() => {
    if (dupTimerRef.current) clearTimeout(dupTimerRef.current)
    const d = digitsOf(phoneRaw)
    if (d.length < 10) { setDuplicate(null); return }
    setSearchingDup(true)
    dupTimerRef.current = setTimeout(async () => {
      try {
        const res = await apiClient.get('/referrals/patients/search', { params: { phone: phoneRaw, limit: 1 } })
        const arr = res.data?.patients || []
        setDuplicate(arr.length ? arr[0] : null)
      } catch {
        setDuplicate(null)
      } finally {
        setSearchingDup(false)
      }
    }, 400)
    return () => dupTimerRef.current && clearTimeout(dupTimerRef.current)
  }, [phoneRaw])

  const phoneValid = digitsOf(phoneRaw).length === 11
  const fioValid = lastName.trim().length >= 2 && firstName.trim().length >= 2
  const birthValid = day && month !== '' && year

  const fullName = useMemo(() => (
    [lastName, firstName, middleName].map(s => s.trim()).filter(Boolean).join(' ')
  ), [lastName, firstName, middleName])

  const birthDate = useMemo(() => {
    if (!day || month === '' || !year) return ''
    const m = String(Number(month) + 1).padStart(2, '0')
    const d = String(Number(day)).padStart(2, '0')
    return `${year}-${m}-${d}`
  }, [day, month, year])

  // Список годов (от текущего - 100 до текущего)
  const yearOptions = useMemo(() => {
    const cy = new Date().getFullYear()
    return Array.from({ length: 100 }, (_, i) => String(cy - i))
  }, [])

  async function handleSubmit() {
    if (!phoneValid) { toast('Введите корректный телефон', 'error'); return }
    if (!fioValid) { toast('Заполните Фамилию и Имя', 'error'); return }
    if (!consent) { toast('Требуется согласие на обработку персональных данных', 'error'); return }
    setBusy(true)
    try {
      const res = await apiClient.post('/referrals/patients/quick-create', {
        full_name: fullName,
        phone: phoneRaw,
        birth_date: birthDate || null,
        passport: (passportSeries && passportNumber) ? `${passportSeries} ${passportNumber}` : null,
        consent_data_processing: true,
        sms_confirm: smsConfirm && smsModuleEnabled,
        book_now: bookNow,
      })
      const data = res.data || {}
      if (data.duplicate) {
        toast('Пациент уже есть в базе. Открываем карточку.', 'info', 4500)
      } else {
        toast('Пациент сохранён', 'success')
      }
      onCreated?.({
        ...data,
        patient_phone: data.patient_phone || phoneRaw,
        patient_name: data.patient_name || fullName,
        birth_date: birthDate,
        book_now: bookNow,
      })
      onClose?.()
    } catch (e) {
      toast(e?.response?.data?.detail || 'Не удалось сохранить пациента', 'error')
    }
    setBusy(false)
  }

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-label="Регистрация пациента"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 250,
        background: 'oklch(0 0 0 / 0.45)',
        backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'flex-end',
        justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 560,
          height: '94vh',
          background: 'var(--surface, #fff)',
          borderRadius: '20px 20px 0 0',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 -10px 50px oklch(0 0 0 / 0.30)',
        }}
      >
        {/* Header + stepper */}
        <div style={{ padding: '14px 16px 8px', borderBottom: '1px solid var(--border, #eee)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 17, fontWeight: 700 }}>Новый пациент</div>
            <button
              onClick={onClose}
              type="button"
              aria-label="Закрыть"
              style={{
                width: 36, height: 36, borderRadius: 10, border: 0, background: 'var(--bg-2, #f3f4f6)',
                cursor: 'pointer', display: 'grid', placeItems: 'center',
              }}
            ><Icon name="close" size={20} /></button>
          </div>
          {/* Steps */}
          <div style={{ display: 'flex', gap: 6 }}>
            {[1, 2, 3].map(n => (
              <div key={n} style={{ flex: 1 }}>
                <div style={{
                  height: 4, borderRadius: 2,
                  background: step >= n ? 'var(--accent, #0a6e85)' : 'var(--bg-2, #e5e7eb)',
                }} />
                <div style={{ fontSize: 10.5, fontWeight: 600, marginTop: 4, textAlign: 'center', color: step >= n ? 'var(--accent, #0a6e85)' : 'var(--fg-3, #999)' }}>
                  {n === 1 ? 'Контакты' : n === 2 ? 'Паспорт' : 'Запись'}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Content (scrollable) */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 8px' }}>
          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={labelBase}>Телефон *</label>
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phoneRaw}
                  onChange={(e) => setPhoneRaw(formatPhone(e.target.value))}
                  placeholder="+7 ___ ___-__-__"
                  style={{ ...inputBase, fontVariantNumeric: 'tabular-nums' }}
                />
                {searchingDup && (
                  <div style={{ marginTop: 6, fontSize: 12, color: 'var(--fg-3, #999)' }}>Проверяем базу…</div>
                )}
                {duplicate && !searchingDup && (
                  <div style={{
                    marginTop: 8, padding: '10px 12px', borderRadius: 10,
                    background: 'oklch(0.95 0.04 70)', border: '1px solid oklch(0.85 0.07 70)',
                    fontSize: 13, color: 'oklch(0.40 0.10 70)',
                  }}>
                    <div style={{ fontWeight: 700, marginBottom: 2 }}>
                      Пациент уже есть в базе
                    </div>
                    <div>{duplicate.patient_name || duplicate.patient_phone}</div>
                    <button
                      type="button"
                      onClick={() => {
                        onCreated?.({
                          duplicate: true,
                          patient_phone: duplicate.patient_phone,
                          patient_name: duplicate.patient_name,
                          last_referral_id: duplicate.last_referral_id,
                        })
                        onClose?.()
                      }}
                      style={{
                        marginTop: 8, padding: '8px 12px', border: 0, borderRadius: 8,
                        background: 'oklch(0.55 0.13 70)', color: '#fff', fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Открыть карточку
                    </button>
                  </div>
                )}
              </div>

              <div>
                <label style={labelBase}>Фамилия *</label>
                <input
                  type="text"
                  autoCapitalize="words"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Иванов"
                  style={inputBase}
                />
              </div>
              <div>
                <label style={labelBase}>Имя *</label>
                <input
                  type="text"
                  autoCapitalize="words"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Иван"
                  style={inputBase}
                />
              </div>
              <div>
                <label style={labelBase}>Отчество</label>
                <input
                  type="text"
                  autoCapitalize="words"
                  value={middleName}
                  onChange={(e) => setMiddleName(e.target.value)}
                  placeholder="Иванович"
                  style={inputBase}
                />
              </div>

              <div>
                <label style={labelBase}>Дата рождения</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr 1fr', gap: 8 }}>
                  <select
                    value={day}
                    onChange={(e) => setDay(e.target.value)}
                    style={{ ...inputBase, padding: '0 8px' }}
                  >
                    <option value="">День</option>
                    {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                  <select
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                    style={{ ...inputBase, padding: '0 8px' }}
                  >
                    <option value="">Месяц</option>
                    {MONTHS_RU.map((m, i) => (
                      <option key={i} value={i}>{m}</option>
                    ))}
                  </select>
                  <select
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                    style={{ ...inputBase, padding: '0 8px' }}
                  >
                    <option value="">Год</option>
                    {yearOptions.map(y => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 13, color: 'var(--fg-3, #555)', padding: '8px 10px', background: 'var(--bg-2, #f3f4f6)', borderRadius: 8 }}>
                Шаг паспорта необязательный — можно пропустить.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 8 }}>
                <div>
                  <label style={labelBase}>Серия</label>
                  <input
                    type="text" inputMode="numeric" maxLength={4}
                    value={passportSeries}
                    onChange={(e) => setPassportSeries(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="0000"
                    style={inputBase}
                  />
                </div>
                <div>
                  <label style={labelBase}>Номер</label>
                  <input
                    type="text" inputMode="numeric" maxLength={6}
                    value={passportNumber}
                    onChange={(e) => setPassportNumber(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    style={inputBase}
                  />
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <label
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  padding: 12, borderRadius: 12,
                  background: bookNow ? 'var(--accent-soft, oklch(0.62 0.12 195 / 0.10))' : 'var(--bg-2, #f8fafc)',
                  border: `1.5px solid ${bookNow ? 'var(--accent, #0a6e85)' : 'var(--border, #d1d5db)'}`,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={bookNow}
                  onChange={(e) => setBookNow(e.target.checked)}
                  style={{ marginTop: 3, width: 20, height: 20 }}
                />
                <span>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>Сохранить и записать на приём</div>
                  <div style={{ fontSize: 12, color: 'var(--fg-3, #555)', marginTop: 2 }}>
                    После сохранения откроется форма записи
                  </div>
                </span>
              </label>

              {smsModuleEnabled && (
                <label
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                    padding: 12, borderRadius: 12,
                    background: 'var(--bg-2, #f8fafc)',
                    border: '1.5px solid var(--border, #d1d5db)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={smsConfirm}
                    onChange={(e) => setSmsConfirm(e.target.checked)}
                    style={{ marginTop: 3, width: 20, height: 20 }}
                  />
                  <span>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>SMS-подтверждение записи</div>
                    <div style={{ fontSize: 12, color: 'var(--fg-3, #555)', marginTop: 2 }}>
                      Отправим SMS на номер пациента
                    </div>
                  </span>
                </label>
              )}

              <label
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  padding: 12, borderRadius: 12,
                  background: consent ? 'oklch(0.95 0.03 145)' : 'oklch(0.97 0.005 30)',
                  border: `1.5px solid ${consent ? 'oklch(0.55 0.12 145)' : 'oklch(0.82 0.05 30)'}`,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  style={{ marginTop: 3, width: 20, height: 20 }}
                />
                <span>
                  <div style={{ fontWeight: 700, fontSize: 14, color: consent ? 'oklch(0.30 0.12 145)' : 'oklch(0.30 0.10 30)' }}>
                    Согласие на обработку персональных данных *
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--fg-3, #555)', marginTop: 2 }}>
                    В соответствии с 152-ФЗ
                  </div>
                </span>
              </label>
            </div>
          )}
        </div>

        {/* Footer — кнопки прилипают к низу */}
        <div style={{
          padding: '12px 16px calc(12px + env(safe-area-inset-bottom))',
          borderTop: '1px solid var(--border, #eee)',
          display: 'flex', gap: 10,
          background: 'var(--surface, #fff)',
        }}>
          {step > 1 && (
            <button
              type="button"
              onClick={() => setStep(s => Math.max(1, s - 1))}
              disabled={busy}
              style={{
                flex: 1, height: 52, borderRadius: 12, border: '1.5px solid var(--border, #d1d5db)',
                background: 'var(--bg-2, #f3f4f6)', color: 'var(--fg, #111)', fontSize: 15, fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Назад
            </button>
          )}
          {step < 3 && (
            <button
              type="button"
              onClick={() => {
                if (step === 1 && (!phoneValid || !fioValid)) {
                  toast(!phoneValid ? 'Введите корректный телефон' : 'Заполните ФИО', 'error')
                  return
                }
                setStep(s => Math.min(3, s + 1))
              }}
              style={{
                flex: 2, height: 52, borderRadius: 12, border: 0,
                background: 'linear-gradient(135deg, var(--accent, #0a6e85), var(--accent-2, #15808f))',
                color: '#fff', fontSize: 15, fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Далее
            </button>
          )}
          {step === 3 && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={busy || !consent}
              style={{
                flex: 2, height: 52, borderRadius: 12, border: 0,
                background: !consent ? 'oklch(0.75 0.02 200)' :
                  'linear-gradient(135deg, oklch(0.55 0.13 145), oklch(0.45 0.12 150))',
                color: '#fff', fontSize: 15, fontWeight: 700,
                cursor: !consent ? 'not-allowed' : 'pointer',
                opacity: busy ? 0.7 : 1,
              }}
            >
              {busy ? 'Сохраняю…' : (bookNow ? 'Сохранить и записать' : 'Сохранить')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
