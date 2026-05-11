// ============================================================================
// AddMemberModal — модал добавления родственника в семейную группу
// ============================================================================
//
// POST /patient/family/invite
//   body: { full_name, phone, relation, birth_date }
//   resp: { member_id, patient_id?, status:'added'|'pending_invite', invite_token? }
//
// Если backend нашёл пациента по телефону → status='added', токен не нужен.
// Если пациента нет → status='pending_invite' + invite_token,
// показываем deep-link для родственника.
// ============================================================================

import { useState, useMemo } from 'react'
import axios from 'axios'
import { API_BASE } from '../../config'
import { useToast } from '../../design'

const SESSION_KEY = 'clinika_patient_session'

// ── Маска +7 (XXX) XXX-XX-XX ────────────────────────────────────────────────
function formatPhone(raw) {
  const d = String(raw || '').replace(/\D/g, '')
  // Берём максимум 11 цифр; нормализуем первую к 7
  const digits = (d.startsWith('8') ? '7' + d.slice(1) : (d.startsWith('7') ? d : (d ? '7' + d : ''))).slice(0, 11)
  if (!digits) return ''
  let out = '+7'
  if (digits.length > 1) out += ' (' + digits.slice(1, 4)
  if (digits.length >= 4) out += ')'
  if (digits.length >= 5) out += ' ' + digits.slice(4, 7)
  if (digits.length >= 8) out += '-' + digits.slice(7, 9)
  if (digits.length >= 10) out += '-' + digits.slice(9, 11)
  return out
}

function phoneDigits(masked) {
  return String(masked || '').replace(/\D/g, '')
}

// ── Списки select-ов для даты рождения ──────────────────────────────────────
const MONTHS_RU = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек']
const RELATIONS = [
  { v: 'spouse',  l: 'Супруг(а)' },
  { v: 'child',   l: 'Ребёнок'   },
  { v: 'father',  l: 'Отец'      },
  { v: 'mother',  l: 'Мать'      },
  { v: 'parent',  l: 'Родитель'  },
  { v: 'brother', l: 'Брат'      },
  { v: 'sister',  l: 'Сестра'    },
  { v: 'other',   l: 'Другое'    },
]

// ── Основной компонент ──────────────────────────────────────────────────────
export default function AddMemberModal({ onClose, onAdded, sessionToken }) {
  const { toast } = useToast()
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [relation, setRelation] = useState('child')
  // Дата рождения — три select-а (день/месяц/год). Год по умолчанию 2000.
  const [day, setDay] = useState('')
  const [month, setMonth] = useState('')
  const [year, setYear] = useState('')
  const [busy, setBusy] = useState(false)
  const [inviteResult, setInviteResult] = useState(null) // {invite_token, link}

  const token = sessionToken || (typeof window !== 'undefined' ? localStorage.getItem(SESSION_KEY) : null)

  const years = useMemo(() => {
    const cur = new Date().getFullYear()
    const arr = []
    for (let y = cur; y >= cur - 120; y--) arr.push(y)
    return arr
  }, [])

  const days = useMemo(() => {
    const dim = month && year ? new Date(Number(year), Number(month), 0).getDate() : 31
    return Array.from({ length: dim }, (_, i) => i + 1)
  }, [month, year])

  const canSubmit = fullName.trim().length >= 2 && phoneDigits(phone).length === 11 && !busy

  const buildBirthDate = () => {
    if (!day || !month || !year) return null
    const dd = String(day).padStart(2, '0')
    const mm = String(month).padStart(2, '0')
    return `${year}-${mm}-${dd}`
  }

  const submit = async (e) => {
    e?.preventDefault?.()
    if (!canSubmit) return
    setBusy(true)
    try {
      const body = {
        full_name: fullName.trim(),
        phone: '+' + phoneDigits(phone),
        relation,
      }
      const bd = buildBirthDate()
      if (bd) body.birth_date = bd

      const r = await axios.post(`${API_BASE}/patient/family/invite`, body, { params: { t: token } })
      const status = r.data?.status

      if (status === 'pending_invite' && r.data?.invite_token) {
        const link = `${window.location.origin}/family/accept?token=${r.data.invite_token}`
        setInviteResult({ token: r.data.invite_token, link })
        // НЕ закрываем — пользователю надо показать ссылку.
      } else {
        toast('Родственник добавлен', 'success')
        onAdded && onAdded(r.data)
      }
    } catch (e) {
      const detail = e.response?.data?.detail
      toast(typeof detail === 'string' ? detail : 'Не удалось добавить', 'error')
    } finally {
      setBusy(false)
    }
  }

  const copyLink = async () => {
    if (!inviteResult?.link) return
    try {
      await navigator.clipboard.writeText(inviteResult.link)
      toast('Ссылка скопирована', 'success')
    } catch {
      toast('Скопируйте вручную', 'warn')
    }
  }

  // ── Modal layout (своя реализация — лёгкая, без зависимостей DS-modal) ──
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center px-0 md:px-4 py-0 md:py-4"
         style={{ background: 'rgba(15,23,42,.5)', backdropFilter: 'blur(4px)' }}
         onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
           className="bg-white rounded-t-3xl md:rounded-3xl w-full md:max-w-md shadow-2xl max-h-[92vh] overflow-y-auto"
           style={{ animation: 'familySlideUp .3s cubic-bezier(.22,1,.36,1)' }}>
        <style>{`@keyframes familySlideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}`}</style>

        {/* Header */}
        <div className="sticky top-0 bg-white px-5 pt-5 pb-3 border-b border-gray-100 flex items-center gap-3 z-10">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
               style={{ background: 'linear-gradient(135deg,#EC4899,#8B5CF6)' }}>
            <span className="material-symbols-outlined text-white">person_add</span>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-extrabold text-base" style={{ color: '#0A2342' }}>Новый родственник</h3>
            <p className="text-[11px] text-gray-500">Добавьте человека в семейную группу</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Body */}
        {!inviteResult ? (
          <form onSubmit={submit} className="px-5 py-4 space-y-4">
            {/* ФИО */}
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">ФИО *</label>
              <input
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="Иванов Иван Иванович"
                autoFocus
                className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm outline-none focus:border-cyan-500"
              />
            </div>

            {/* Телефон */}
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">Телефон *</label>
              <input
                value={phone}
                onChange={e => setPhone(formatPhone(e.target.value))}
                onFocus={() => { if (!phone) setPhone('+7 (') }}
                placeholder="+7 (___) ___-__-__"
                inputMode="tel"
                className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm outline-none focus:border-cyan-500"
              />
              <p className="text-[11px] text-gray-400 mt-1">
                Если человек уже зарегистрирован — добавится сразу. Иначе создадим приглашение.
              </p>
            </div>

            {/* Дата рождения */}
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">Дата рождения</label>
              <div className="grid grid-cols-3 gap-2">
                <select
                  value={day}
                  onChange={e => setDay(e.target.value)}
                  className="px-2 py-2.5 rounded-xl border border-gray-200 text-sm outline-none focus:border-cyan-500 bg-white">
                  <option value="">День</option>
                  {days.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
                <select
                  value={month}
                  onChange={e => setMonth(e.target.value)}
                  className="px-2 py-2.5 rounded-xl border border-gray-200 text-sm outline-none focus:border-cyan-500 bg-white">
                  <option value="">Месяц</option>
                  {MONTHS_RU.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
                <select
                  value={year}
                  onChange={e => setYear(e.target.value)}
                  className="px-2 py-2.5 rounded-xl border border-gray-200 text-sm outline-none focus:border-cyan-500 bg-white">
                  <option value="">Год</option>
                  {years.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </div>

            {/* Отношение */}
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">Кем приходится *</label>
              <select
                value={relation}
                onChange={e => setRelation(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm outline-none focus:border-cyan-500 bg-white">
                {RELATIONS.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
              </select>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full py-3 rounded-xl font-bold text-white text-sm transition-all active:scale-95 disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg,#0097A7,#0A2342)' }}>
              {busy ? 'Добавляем…' : 'Добавить в семью'}
            </button>
          </form>
        ) : (
          // ── Результат: pending_invite — показываем ссылку ──
          <div className="px-5 py-5 space-y-4 text-center">
            <div className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center"
                 style={{ background: 'linear-gradient(135deg,#10B981,#059669)' }}>
              <span className="material-symbols-outlined text-white text-3xl">link</span>
            </div>
            <div>
              <h4 className="font-bold text-base mb-1" style={{ color: '#0A2342' }}>
                Приглашение готово
              </h4>
              <p className="text-xs text-gray-500 leading-relaxed">
                Поделитесь ссылкой с родственником — он сможет открыть её,
                войти в свой кабинет и присоединиться к семье.
              </p>
            </div>

            <div className="bg-gray-50 rounded-xl p-3 text-left">
              <p className="text-[11px] font-semibold text-gray-500 mb-1">Ссылка</p>
              <p className="text-xs break-all font-mono" style={{ color: '#0A2342' }}>
                {inviteResult.link}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={copyLink}
                className="py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95"
                style={{ background: '#E0F2FE', color: '#0369A1' }}>
                <span className="material-symbols-outlined text-base align-middle mr-1">content_copy</span>
                Копировать
              </button>
              <button
                onClick={() => { onAdded && onAdded(); onClose() }}
                className="py-2.5 rounded-xl text-sm font-bold text-white transition-all active:scale-95"
                style={{ background: 'linear-gradient(135deg,#0097A7,#0A2342)' }}>
                Готово
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
