/**
 * ========================================
 * БЛОК: Онлайн-запись пациентов (Patient Portal v2)
 * ========================================
 * 4 шага: выбор врача → дата/время → контакты → успех
 * Публичная страница, авторизация не требуется.
 * ========================================
 */
import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import { API_BASE, SLUG } from '../config'

// ── Константы ──────────────────────────────────────────────────────────────────
const DAYS_RU = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
const MONTHS_RU = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек']

// Цвета бренда
const C = {
  navy:  '#0A2342',
  blue:  '#1565C0',
  teal:  '#0097A7',
  light: '#E3F2FD',
  bg:    '#F5F8FF',
  card:  '#FFFFFF',
  gray:  '#9CA3AF',
  text:  '#1A2B3C',
  muted: '#6B7280',
}

// ── Утилиты ──────────────────────────────────────────────────────────────────
function formatDate(d) {
  return `${d.getDate()} ${MONTHS_RU[d.getMonth()]} ${d.getFullYear()}`
}

function isoDate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function getInitials(name) {
  if (!name) return '?'
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

// ── Спиннер ───────────────────────────────────────────────────────────────────
function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}>
      <div style={{
        width: 36, height: 36,
        border: `3px solid ${C.light}`,
        borderTopColor: C.teal,
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
      }} />
    </div>
  )
}

// ── Чипс специальности ───────────────────────────────────────────────────────
function SpecChip({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 14px',
        borderRadius: 20,
        border: active ? 'none' : `1px solid ${C.blue}`,
        background: active ? C.blue : 'white',
        color: active ? 'white' : C.blue,
        fontSize: 13,
        fontWeight: active ? 600 : 400,
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        transition: 'all .2s',
      }}
    >
      {label}
    </button>
  )
}

// ── Карточка врача (шаг 1) ───────────────────────────────────────────────────
function DoctorCard({ doc, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        background: C.card,
        border: `1px solid #E8EDF4`,
        borderRadius: 16,
        padding: '14px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'transform .15s, box-shadow .15s',
        boxShadow: '0 2px 8px rgba(0,0,0,.04)',
      }}
      onMouseDown={e => e.currentTarget.style.transform = 'scale(.98)'}
      onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
      onTouchStart={e => e.currentTarget.style.transform = 'scale(.98)'}
      onTouchEnd={e => e.currentTarget.style.transform = 'scale(1)'}
    >
      {/* Аватар */}
      {doc.photo_url ? (
        <img
          src={doc.photo_url}
          alt={doc.full_name}
          style={{ width: 52, height: 52, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
        />
      ) : (
        <div style={{
          width: 52, height: 52, borderRadius: '50%', flexShrink: 0,
          background: `linear-gradient(135deg, ${C.blue}, ${C.teal})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'white', fontWeight: 700, fontSize: 18,
        }}>
          {getInitials(doc.full_name)}
        </div>
      )}
      {/* Инфо */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, color: C.text, fontSize: 15, lineHeight: 1.3 }}>
          {doc.full_name}
        </div>
        <div style={{ color: C.teal, fontSize: 13, marginTop: 2 }}>
          {doc.specialty}
        </div>
        <div style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>
          {doc.clinic_name}
        </div>
      </div>
      {/* Стрелка */}
      <div style={{ color: C.gray, fontSize: 20, flexShrink: 0 }}>›</div>
    </button>
  )
}

// ── Шаг 1: Выбор врача ───────────────────────────────────────────────────────
function StepDoctor({ onSelect }) {
  const [doctors, setDoctors] = useState([])
  const [loading, setLoading] = useState(true)
  const [spec, setSpec]       = useState('Все')
  const [error, setError]     = useState(null)

  useEffect(() => {
    axios.get(`${API_BASE}/public/${SLUG}/doctors`)
      .then(r => setDoctors(r.data))
      .catch(() => setError('Не удалось загрузить список врачей'))
      .finally(() => setLoading(false))
  }, [])

  const specs = ['Все', ...Array.from(new Set(doctors.map(d => d.specialty).filter(Boolean)))]
  const filtered = spec === 'Все' ? doctors : doctors.filter(d => d.specialty === spec)

  return (
    <div>
      {/* Заголовок */}
      <div style={{
        background: `linear-gradient(135deg, ${C.navy}, ${C.blue})`,
        padding: '24px 20px 20px',
        borderRadius: '0 0 24px 24px',
        marginBottom: 20,
      }}>
        <div style={{ color: 'rgba(255,255,255,.7)', fontSize: 13, marginBottom: 4 }}>
          Онлайн-запись
        </div>
        <div style={{ color: 'white', fontSize: 22, fontWeight: 700 }}>
          Выберите врача
        </div>
      </div>

      <div style={{ padding: '0 16px' }}>
        {/* Фильтр по специальностям */}
        {!loading && doctors.length > 0 && (
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 12 }}>
            {specs.map(s => (
              <SpecChip key={s} label={s} active={spec === s} onClick={() => setSpec(s)} />
            ))}
          </div>
        )}

        {loading && <Spinner />}

        {error && (
          <div style={{
            background: '#FEF2F2', border: '1px solid #FECACA',
            borderRadius: 12, padding: 16, color: '#991B1B', fontSize: 14, textAlign: 'center',
          }}>
            {error}
          </div>
        )}

        {/* Нет врачей с расписанием */}
        {!loading && !error && filtered.length === 0 && (
          <div style={{
            background: '#F0F9FF', border: '1px solid #BAE6FD',
            borderRadius: 12, padding: 20, textAlign: 'center',
          }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
            <div style={{ color: C.text, fontWeight: 600, marginBottom: 4 }}>
              Расписание не настроено
            </div>
            <div style={{ color: C.muted, fontSize: 13 }}>
              Для записи, пожалуйста, обратитесь по телефону
            </div>
          </div>
        )}

        {/* Список врачей */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(doc => (
            <DoctorCard key={doc.id} doc={doc} onClick={() => onSelect(doc)} />
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Шаг 2: Дата и время ──────────────────────────────────────────────────────
function StepDateTime({ doctor, onBack, onNext }) {
  const today = new Date()
  today.setHours(0,0,0,0)

  // 14 дней: сегодня + 13
  const dates = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    return d
  })

  const [selDate, setSelDate]   = useState(null)
  const [slots, setSlots]       = useState([])
  const [loadSlots, setLoadSlots] = useState(false)
  const [selSlot, setSelSlot]   = useState(null)
  // Кешируем слоты по дате
  const [slotCache, setSlotCache] = useState({})

  const loadDateSlots = useCallback(async (d) => {
    const key = isoDate(d)
    if (slotCache[key] !== undefined) {
      setSlots(slotCache[key])
      return
    }
    setLoadSlots(true)
    try {
      const r = await axios.get(
        `${API_BASE}/public/${SLUG}/doctors/${doctor.id}/slots?date=${key}`
      )
      setSlotCache(prev => ({ ...prev, [key]: r.data }))
      setSlots(r.data)
    } catch {
      setSlots([])
    } finally {
      setLoadSlots(false)
    }
  }, [doctor.id, slotCache])

  const handleDateClick = (d) => {
    setSelDate(d)
    setSelSlot(null)
    loadDateSlots(d)
  }

  // Проверяем есть ли хотя бы один свободный слот на дату (для серого кружка)
  const hasAvailable = (d) => {
    const key = isoDate(d)
    const cached = slotCache[key]
    if (!cached) return true  // не загружено — считаем доступной
    return cached.some(s => s.available)
  }

  const freeSlots = slots.filter(s => s.available)
  const busySlots = slots.filter(s => !s.available)

  return (
    <div>
      {/* Шапка */}
      <div style={{
        background: `linear-gradient(135deg, ${C.navy}, ${C.blue})`,
        padding: '20px 16px',
        borderRadius: '0 0 24px 24px',
        marginBottom: 20,
      }}>
        <button onClick={onBack} style={{
          background: 'rgba(255,255,255,.15)', border: 'none', borderRadius: 10,
          color: 'white', padding: '6px 12px', fontSize: 13, cursor: 'pointer', marginBottom: 10,
        }}>
          ← Назад
        </button>
        <div style={{ color: 'white', fontWeight: 700, fontSize: 16 }}>{doctor.full_name}</div>
        <div style={{ color: 'rgba(255,255,255,.7)', fontSize: 13 }}>{doctor.specialty}</div>
      </div>

      <div style={{ padding: '0 16px' }}>
        <div style={{ fontWeight: 600, color: C.text, marginBottom: 12, fontSize: 15 }}>
          Выберите дату
        </div>

        {/* Горизонтальный скролл дат */}
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, marginBottom: 20 }}>
          {dates.map(d => {
            const key = isoDate(d)
            const isSelected = selDate && isoDate(selDate) === key
            const avail = hasAvailable(d)
            return (
              <button
                key={key}
                onClick={() => handleDateClick(d)}
                style={{
                  flexShrink: 0,
                  width: 52, height: 64,
                  borderRadius: 16,
                  border: isSelected ? 'none' : `1px solid ${avail ? '#CBD5E1' : '#E2E8F0'}`,
                  background: isSelected ? C.blue : (avail ? 'white' : '#F8FAFC'),
                  color: isSelected ? 'white' : (avail ? C.text : C.gray),
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  gap: 2, cursor: 'pointer',
                  transition: 'all .15s',
                  boxShadow: isSelected ? '0 4px 12px rgba(21,101,192,.3)' : 'none',
                }}
              >
                <span style={{ fontSize: 11, opacity: .7 }}>{DAYS_RU[d.getDay()]}</span>
                <span style={{ fontSize: 18, fontWeight: 700 }}>{d.getDate()}</span>
              </button>
            )
          })}
        </div>

        {/* Слоты */}
        {selDate && (
          <>
            <div style={{ fontWeight: 600, color: C.text, marginBottom: 12, fontSize: 15 }}>
              {formatDate(selDate)}
            </div>

            {loadSlots && <Spinner />}

            {!loadSlots && slots.length === 0 && (
              <div style={{
                background: '#F8FAFC', borderRadius: 12, padding: 16,
                color: C.muted, fontSize: 13, textAlign: 'center',
              }}>
                На эту дату нет доступных слотов
              </div>
            )}

            {!loadSlots && slots.length > 0 && (
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 20,
              }}>
                {slots.map(s => {
                  const isSelected = selSlot?.start_time === s.start_time
                  return (
                    <button
                      key={s.start_time}
                      disabled={!s.available}
                      onClick={() => setSelSlot(s)}
                      style={{
                        padding: '10px 4px',
                        borderRadius: 12,
                        border: isSelected ? 'none' : `1px solid ${s.available ? '#CBD5E1' : '#E2E8F0'}`,
                        background: isSelected ? C.blue : (s.available ? 'white' : '#F1F5F9'),
                        color: isSelected ? 'white' : (s.available ? C.text : C.gray),
                        fontSize: 14,
                        fontWeight: isSelected ? 600 : 400,
                        cursor: s.available ? 'pointer' : 'not-allowed',
                        transition: 'all .15s',
                        boxShadow: isSelected ? '0 2px 8px rgba(21,101,192,.25)' : 'none',
                      }}
                      onMouseDown={e => { if(s.available) e.currentTarget.style.transform='scale(.97)' }}
                      onMouseUp={e => { e.currentTarget.style.transform='scale(1)' }}
                      onTouchStart={e => { if(s.available) e.currentTarget.style.transform='scale(.97)' }}
                      onTouchEnd={e => { e.currentTarget.style.transform='scale(1)' }}
                    >
                      {s.start_time}
                    </button>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* Кнопка Далее */}
        <button
          disabled={!selSlot}
          onClick={() => onNext({ date: selDate, slot: selSlot })}
          style={{
            width: '100%',
            padding: '14px',
            borderRadius: 14,
            border: 'none',
            background: selSlot ? `linear-gradient(135deg, ${C.blue}, ${C.teal})` : '#E2E8F0',
            color: selSlot ? 'white' : C.gray,
            fontSize: 16,
            fontWeight: 600,
            cursor: selSlot ? 'pointer' : 'not-allowed',
            transition: 'all .2s',
            boxShadow: selSlot ? '0 4px 14px rgba(0,151,167,.25)' : 'none',
          }}
          onMouseDown={e => { if(selSlot) e.currentTarget.style.transform='scale(.98)' }}
          onMouseUp={e => e.currentTarget.style.transform='scale(1)'}
          onTouchStart={e => { if(selSlot) e.currentTarget.style.transform='scale(.98)' }}
          onTouchEnd={e => e.currentTarget.style.transform='scale(1)'}
        >
          Далее →
        </button>
      </div>
    </div>
  )
}

// ── Шаг 3: Контакты ──────────────────────────────────────────────────────────
function StepContacts({ doctor, dateSlot, onBack, onSuccess }) {
  const [name, setName]     = useState('')
  const [phone, setPhone]   = useState('+7')
  // website_url — honeypot для отсева ботов (скрыт CSS-ом)
  const [website, setWebsite] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState(null)

  const handlePhoneChange = (v) => {
    // Гарантируем начало с +7
    if (!v.startsWith('+7')) {
      setPhone('+7')
      return
    }
    setPhone(v)
  }

  const canSubmit = name.trim().length >= 2 && phone.replace(/\D/g, '').length >= 11

  const handleBook = async () => {
    if (!canSubmit) return
    setLoading(true)
    setError(null)
    try {
      const r = await axios.post(`${API_BASE}/public/${SLUG}/book`, {
        doctor_id: doctor.id,
        appointment_date: isoDate(dateSlot.date),
        start_time: dateSlot.slot.start_time,
        patient_name: name.trim(),
        patient_phone: phone,
        website_url: website,
      })
      onSuccess(r.data)
    } catch (e) {
      const msg = e?.response?.data?.detail
      if (e?.response?.status === 409 || (msg && msg.includes('занят'))) {
        setError('Слот уже занят, выберите другое время')
      } else {
        setError(msg || 'Произошла ошибка. Попробуйте ещё раз.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      {/* Шапка */}
      <div style={{
        background: `linear-gradient(135deg, ${C.navy}, ${C.blue})`,
        padding: '20px 16px',
        borderRadius: '0 0 24px 24px',
        marginBottom: 20,
      }}>
        <button onClick={onBack} style={{
          background: 'rgba(255,255,255,.15)', border: 'none', borderRadius: 10,
          color: 'white', padding: '6px 12px', fontSize: 13, cursor: 'pointer', marginBottom: 10,
        }}>
          ← Назад
        </button>
        <div style={{ color: 'white', fontWeight: 700, fontSize: 16 }}>Ваши данные</div>
      </div>

      <div style={{ padding: '0 16px' }}>
        {/* Honeypot: скрытое поле, заполнят только боты → 403 на бэке */}
        <input
          type="text"
          name="website_url"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={e => setWebsite(e.target.value)}
          style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }}
          aria-hidden="true"
        />
        {/* Резюме записи */}
        <div style={{
          background: `linear-gradient(135deg, rgba(21,101,192,.06), rgba(0,151,167,.06))`,
          border: `1px solid ${C.light}`,
          borderRadius: 14, padding: 14, marginBottom: 20,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              background: `linear-gradient(135deg, ${C.blue}, ${C.teal})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'white', fontWeight: 700, fontSize: 14, flexShrink: 0,
            }}>
              {getInitials(doctor.full_name)}
            </div>
            <div>
              <div style={{ fontWeight: 600, color: C.text, fontSize: 14 }}>{doctor.full_name}</div>
              <div style={{ color: C.muted, fontSize: 12 }}>{doctor.specialty}</div>
            </div>
          </div>
          <div style={{
            display: 'flex', gap: 16, marginTop: 12,
            borderTop: `1px solid rgba(0,0,0,.06)`, paddingTop: 10,
          }}>
            <div>
              <div style={{ color: C.muted, fontSize: 11 }}>Дата</div>
              <div style={{ color: C.text, fontWeight: 600, fontSize: 13 }}>
                {formatDate(dateSlot.date)}
              </div>
            </div>
            <div>
              <div style={{ color: C.muted, fontSize: 11 }}>Время</div>
              <div style={{ color: C.text, fontWeight: 600, fontSize: 13 }}>
                {dateSlot.slot.start_time} – {dateSlot.slot.end_time}
              </div>
            </div>
          </div>
        </div>

        {/* Поля ввода */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
          <div>
            <label style={{ color: C.text, fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 6 }}>
              Ваше имя
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Иван Иванов"
              style={{
                width: '100%', padding: '12px 14px', borderRadius: 12,
                border: `1.5px solid ${name.trim().length >= 2 ? C.teal : '#CBD5E1'}`,
                fontSize: 15, outline: 'none', boxSizing: 'border-box',
                background: 'white', color: C.text,
                transition: 'border-color .2s',
              }}
            />
          </div>
          <div>
            <label style={{ color: C.text, fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 6 }}>
              Телефон
            </label>
            <input
              type="tel"
              value={phone}
              onChange={e => handlePhoneChange(e.target.value)}
              placeholder="+7 900 000-00-00"
              style={{
                width: '100%', padding: '12px 14px', borderRadius: 12,
                border: `1.5px solid ${phone.replace(/\D/g, '').length >= 11 ? C.teal : '#CBD5E1'}`,
                fontSize: 15, outline: 'none', boxSizing: 'border-box',
                background: 'white', color: C.text,
                transition: 'border-color .2s',
              }}
            />
          </div>
        </div>

        {/* Ошибка */}
        {error && (
          <div style={{
            background: '#FEF2F2', border: '1px solid #FECACA',
            borderRadius: 10, padding: 12, color: '#991B1B', fontSize: 13, marginBottom: 12,
          }}>
            {error}
          </div>
        )}

        {/* Кнопка Записаться */}
        <button
          disabled={!canSubmit || loading}
          onClick={handleBook}
          style={{
            width: '100%', padding: '14px', borderRadius: 14, border: 'none',
            background: canSubmit && !loading
              ? `linear-gradient(135deg, ${C.blue}, ${C.teal})` : '#E2E8F0',
            color: canSubmit && !loading ? 'white' : C.gray,
            fontSize: 16, fontWeight: 600,
            cursor: canSubmit && !loading ? 'pointer' : 'not-allowed',
            transition: 'all .2s',
            boxShadow: canSubmit && !loading ? '0 4px 14px rgba(0,151,167,.25)' : 'none',
          }}
          onMouseDown={e => { if(canSubmit && !loading) e.currentTarget.style.transform='scale(.98)' }}
          onMouseUp={e => e.currentTarget.style.transform='scale(1)'}
          onTouchStart={e => { if(canSubmit && !loading) e.currentTarget.style.transform='scale(.98)' }}
          onTouchEnd={e => e.currentTarget.style.transform='scale(1)'}
        >
          {loading ? 'Записываем...' : 'Записаться'}
        </button>
      </div>
    </div>
  )
}

// ── Шаг 4: Успех ─────────────────────────────────────────────────────────────
function StepSuccess({ result, onRepeat }) {
  const [checkAnim, setCheckAnim] = useState(false)

  useEffect(() => {
    // Запускаем анимацию через 100ms
    const t = setTimeout(() => setCheckAnim(true), 100)
    return () => clearTimeout(t)
  }, [])

  return (
    <div style={{ padding: '40px 20px', textAlign: 'center' }}>
      {/* Анимированный чекмарк */}
      <div style={{
        width: 90, height: 90, borderRadius: '50%', margin: '0 auto 20px',
        background: `linear-gradient(135deg, ${C.blue}, ${C.teal})`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 8px 24px rgba(0,151,167,.3)',
        transform: checkAnim ? 'scale(1)' : 'scale(0)',
        transition: 'transform .4s cubic-bezier(.175,.885,.32,1.275)',
      }}>
        <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
          <path
            d="M10 22l8 8 16-16"
            stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"
            strokeDasharray="40"
            strokeDashoffset={checkAnim ? 0 : 40}
            style={{ transition: 'stroke-dashoffset .5s ease .3s' }}
          />
        </svg>
      </div>

      <div style={{ fontWeight: 700, color: C.text, fontSize: 22, marginBottom: 6 }}>
        Вы записаны!
      </div>
      <div style={{ color: C.muted, fontSize: 14, marginBottom: 24 }}>
        {result.doctor_name} · {result.clinic_name}
        <br />
        {result.appointment_date} · {result.start_time} – {result.end_time}
      </div>

      {/* Код записи */}
      <div style={{
        background: `linear-gradient(135deg, ${C.navy}, ${C.blue})`,
        borderRadius: 16, padding: '16px 20px', marginBottom: 20,
        display: 'inline-block', minWidth: 200,
      }}>
        <div style={{ color: 'rgba(255,255,255,.7)', fontSize: 12, marginBottom: 4 }}>
          Код записи
        </div>
        <div style={{ color: 'white', fontSize: 36, fontWeight: 800, letterSpacing: 6 }}>
          {result.short_code}
        </div>
      </div>

      {/* QR-код */}
      {result.qr_code && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ color: C.muted, fontSize: 12, marginBottom: 8 }}>
            Покажите QR на ресепшене
          </div>
          <img
            src={`data:image/png;base64,${result.qr_code}`}
            alt="QR код записи"
            style={{
              width: 160, height: 160, borderRadius: 12,
              border: `2px solid ${C.light}`,
              display: 'inline-block',
            }}
          />
        </div>
      )}

      {/* Кнопки */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button
          onClick={() => {
            window.location.href = result.cabinet_url
          }}
          style={{
            width: '100%', padding: '13px', borderRadius: 14, border: 'none',
            background: `linear-gradient(135deg, ${C.blue}, ${C.teal})`,
            color: 'white', fontSize: 15, fontWeight: 600, cursor: 'pointer',
            boxShadow: '0 4px 14px rgba(0,151,167,.25)',
          }}
          onMouseDown={e => e.currentTarget.style.transform='scale(.98)'}
          onMouseUp={e => e.currentTarget.style.transform='scale(1)'}
          onTouchStart={e => e.currentTarget.style.transform='scale(.98)'}
          onTouchEnd={e => e.currentTarget.style.transform='scale(1)'}
        >
          В личный кабинет
        </button>
        <button
          onClick={onRepeat}
          style={{
            width: '100%', padding: '13px', borderRadius: 14,
            border: `1.5px solid ${C.blue}`, background: 'white',
            color: C.blue, fontSize: 15, fontWeight: 600, cursor: 'pointer',
          }}
          onMouseDown={e => e.currentTarget.style.transform='scale(.98)'}
          onMouseUp={e => e.currentTarget.style.transform='scale(1)'}
          onTouchStart={e => e.currentTarget.style.transform='scale(.98)'}
          onTouchEnd={e => e.currentTarget.style.transform='scale(1)'}
        >
          Записаться ещё раз
        </button>
      </div>
    </div>
  )
}

// ── Главный компонент ─────────────────────────────────────────────────────────
export default function OnlineBooking() {
  const [step, setStep]       = useState(1)  // 1-4
  const [doctor, setDoctor]   = useState(null)
  const [dateSlot, setDateSlot] = useState(null)
  const [result, setResult]   = useState(null)

  const reset = () => {
    setStep(1)
    setDoctor(null)
    setDateSlot(null)
    setResult(null)
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: C.bg,
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
      maxWidth: 480,
      margin: '0 auto',
      position: 'relative',
    }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        * { -webkit-tap-highlight-color: transparent; }
        ::-webkit-scrollbar { height: 0; width: 0; }
      `}</style>

      {/* Индикатор прогресса */}
      {step < 4 && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
          height: 3, background: '#E2E8F0',
          maxWidth: 480, margin: '0 auto',
        }}>
          <div style={{
            height: '100%',
            width: `${(step / 3) * 100}%`,
            background: `linear-gradient(90deg, ${C.blue}, ${C.teal})`,
            transition: 'width .4s ease',
          }} />
        </div>
      )}

      <div style={{ paddingBottom: 40 }}>
        {step === 1 && (
          <StepDoctor
            onSelect={doc => { setDoctor(doc); setStep(2) }}
          />
        )}
        {step === 2 && doctor && (
          <StepDateTime
            doctor={doctor}
            onBack={() => setStep(1)}
            onNext={ds => { setDateSlot(ds); setStep(3) }}
          />
        )}
        {step === 3 && doctor && dateSlot && (
          <StepContacts
            doctor={doctor}
            dateSlot={dateSlot}
            onBack={() => setStep(2)}
            onSuccess={res => { setResult(res); setStep(4) }}
          />
        )}
        {step === 4 && result && (
          <StepSuccess result={result} onRepeat={reset} />
        )}
      </div>
    </div>
  )
}
