// ============================================================================
// PatientFamilySection — Глава 8 КлиникСеть: Семейный профиль пациента
// ============================================================================
//
// Раздел «Семья» в кабинете пациента. Позволяет:
//   • создать семейную группу (Onboarding)
//   • присоединиться к существующей по invite-token
//   • добавлять родственников (auto-add по найденному телефону или pending invite)
//   • управлять разрешениями (видеть записи / записывать / платить)
//   • переключать активный контекст (смотреть кабинет родственника)
//
// API (фиксированный контракт с backend-агентом):
//   GET    /patient/family
//   POST   /patient/family                   {name}
//   POST   /patient/family/invite            {full_name, phone, relation, birth_date}
//   POST   /patient/family/accept-invite     {token}
//   PATCH  /patient/family/members/{id}      {relation?, can_*?}
//   DELETE /patient/family/members/{id}
//   GET    /patient/family/switch-context/{patient_id}
//   PATCH  /patient/family (новый,) — переименование группы (best-effort)
//
// Все запросы идут через session_token (как в остальных секциях кабинета),
// токен передаётся в query-param ?t={session}.
// ============================================================================

import { useEffect, useState, useCallback, useMemo } from 'react'
import axios from 'axios'
import { API_BASE } from '../config'
import { useToast } from '../design'
import FamilyMemberCard from '../components/family/FamilyMemberCard'
import AddMemberModal from '../components/family/AddMemberModal'
import AcceptInviteModal from '../components/family/AcceptInviteModal'

const SESSION_KEY = 'clinika_patient_session'
const ACTIVE_KEY = 'family_active_patient' // sessionStorage

// ── Скелет загрузки списка членов семьи ──────────────────────────────────────
function FamilySkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 animate-pulse">
      {[1, 2, 3].map(i => (
        <div key={i} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 h-44" />
      ))}
    </div>
  )
}

// ── Onboarding (нет ещё группы) ──────────────────────────────────────────────
function FamilyOnboarding({ onCreate, onJoin, busy }) {
  const [showJoin, setShowJoin] = useState(false)
  const [name, setName] = useState('')

  return (
    <div className="max-w-md mx-auto px-4 py-8 text-center">
      <div className="w-20 h-20 rounded-3xl mx-auto mb-5 flex items-center justify-center"
           style={{ background: 'linear-gradient(135deg,#EC4899,#8B5CF6)', boxShadow: '0 10px 30px -10px rgba(139,92,246,.5)' }}>
        <span className="material-symbols-outlined text-white text-5xl"
              style={{ fontVariationSettings: "'FILL' 1" }}>
          family_restroom
        </span>
      </div>
      <h2 className="text-xl font-extrabold mb-2" style={{ color: '#0A2342' }}>
        Семейная группа
      </h2>
      <p className="text-sm text-gray-500 leading-relaxed mb-6">
        Создайте семейную группу, чтобы вести записи нескольких пациентов в одном кабинете —
        себя, детей и пожилых родственников.
      </p>

      <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 mb-3 text-left">
        <label className="text-xs font-semibold text-gray-500 mb-1 block">Название семьи (необязательно)</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Например, Семья Ивановых"
          className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:border-cyan-500"
        />
        <button
          onClick={() => onCreate(name.trim() || 'Моя семья')}
          disabled={busy}
          className="mt-3 w-full py-3 rounded-xl font-bold text-white text-sm transition-all active:scale-95 disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg,#0097A7,#0A2342)' }}>
          <span className="material-symbols-outlined text-base align-middle mr-1.5">add</span>
          Создать семью
        </button>
      </div>

      <button
        onClick={() => setShowJoin(true)}
        className="text-sm font-semibold py-2"
        style={{ color: '#1565C0' }}>
        У меня есть приглашение
      </button>

      {showJoin && (
        <AcceptInviteModal
          onClose={() => setShowJoin(false)}
          onJoined={onJoin}
        />
      )}
    </div>
  )
}

// ── Главный компонент раздела ────────────────────────────────────────────────
export default function PatientFamilySection({ sessionToken, ownerName, onContextChanged }) {
  const { toast } = useToast()
  const [family, setFamily] = useState(null)          // {group_id, name, members:[]}
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [renameMode, setRenameMode] = useState(false)
  const [renameValue, setRenameValue] = useState('')

  const token = sessionToken || (typeof window !== 'undefined' ? localStorage.getItem(SESSION_KEY) : null)

  // ── Загрузка состояния группы ──
  const load = useCallback(async () => {
    if (!token) { setLoading(false); setFamily(null); return }
    setLoading(true); setError('')
    try {
      const r = await axios.get(`${API_BASE}/patient/family`, { params: { t: token } })
      // Контракт: либо {group_id, name, members:[...]}, либо 404 → нет группы.
      // Защита: legacy-эндпоинт возвращал массив — игнорируем такой ответ как «нет группы».
      if (r.data && typeof r.data === 'object' && !Array.isArray(r.data) && r.data.group_id) {
        setFamily(r.data)
      } else {
        setFamily(null)
      }
    } catch (e) {
      const status = e.response?.status
      if (status === 404) {
        setFamily(null) // нет группы — это нормальное состояние, покажем Onboarding
      } else if (status === 402) {
        setError('module_required')
      } else {
        setError('Не удалось загрузить семейный профиль')
        setFamily(null)
      }
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  // ── Создание новой группы ──
  const handleCreate = async (name) => {
    setBusy(true)
    try {
      await axios.post(`${API_BASE}/patient/family`, { name }, { params: { t: token } })
      toast('Семейная группа создана', 'success')
      await load()
    } catch (e) {
      const detail = e.response?.data?.detail
      toast(typeof detail === 'string' ? detail : 'Не удалось создать группу', 'error')
    } finally { setBusy(false) }
  }

  // ── Принятие invite ──
  const handleJoined = async (data) => {
    toast(`Вы присоединились к семье «${data?.name || ''}»`, 'success')
    await load()
  }

  // ── Добавление родственника ──
  const handleMemberAdded = async () => {
    setShowAdd(false)
    await load()
  }

  // ── Изменение разрешения (PATCH) ──
  const handlePermChange = async (memberId, field, value) => {
    try {
      const r = await axios.patch(
        `${API_BASE}/patient/family/members/${memberId}`,
        { [field]: value },
        { params: { t: token } }
      )
      // Обновляем локально без полного релоада — UX отзывчивее
      setFamily(prev => prev ? {
        ...prev,
        members: prev.members.map(m => m.member_id === memberId ? { ...m, ...(r.data || {}), [field]: value } : m),
      } : prev)
    } catch (e) {
      toast('Не удалось обновить разрешение', 'error')
      await load()
    }
  }

  // ── Изменение relation ──
  const handleRelationChange = async (memberId, relation) => {
    try {
      await axios.patch(
        `${API_BASE}/patient/family/members/${memberId}`,
        { relation },
        { params: { t: token } }
      )
      setFamily(prev => prev ? {
        ...prev,
        members: prev.members.map(m => m.member_id === memberId ? { ...m, relation } : m),
      } : prev)
    } catch {
      toast('Не удалось обновить родство', 'error')
    }
  }

  // ── Удаление члена ──
  const handleRemove = async (memberId) => {
    if (!window.confirm('Удалить этого родственника из семьи? Доступ к его записям будет отозван.')) return
    try {
      await axios.delete(`${API_BASE}/patient/family/members/${memberId}`, { params: { t: token } })
      toast('Удалён', 'success')
      await load()
    } catch (e) {
      const detail = e.response?.data?.detail
      toast(typeof detail === 'string' ? detail : 'Не удалось удалить', 'error')
    }
  }

  // ── Переключение контекста (стать родственником) ──
  const handleSwitch = async (member) => {
    try {
      const r = await axios.get(`${API_BASE}/patient/family/switch-context/${member.patient_id}`, { params: { t: token } })
      const ctx = {
        patient_id: r.data.patient_id || member.patient_id,
        full_name: r.data.full_name || member.full_name,
        member_id: member.member_id,
        is_self: !!member.is_self,
        switched_at: Date.now(),
      }
      try { sessionStorage.setItem(ACTIVE_KEY, JSON.stringify(ctx)) } catch {}
      // Уведомляем остальные секции
      try { window.dispatchEvent(new CustomEvent('patient:context-changed', { detail: ctx })) } catch {}
      if (typeof onContextChanged === 'function') onContextChanged(ctx)
      toast(`Контекст переключён на ${ctx.full_name}`, 'success')
    } catch (e) {
      toast('Не удалось переключить контекст', 'error')
    }
  }

  // ── Переименование группы ──
  const handleRename = async () => {
    const newName = renameValue.trim()
    if (!newName || newName === family?.name) {
      setRenameMode(false); return
    }
    try {
      // Контракт не описывает PATCH /patient/family, но мы посылаем best-effort —
      // backend-агент может реализовать. При неудаче — silent: имя не меняем.
      await axios.patch(`${API_BASE}/patient/family`, { name: newName }, { params: { t: token } })
      setFamily(prev => prev ? { ...prev, name: newName } : prev)
      toast('Название обновлено', 'success')
    } catch {
      toast('Не удалось переименовать', 'error')
    } finally {
      setRenameMode(false)
    }
  }

  // ── Render ──
  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-5">
        <div className="h-8 w-40 rounded-lg bg-gray-200 animate-pulse mb-4" />
        <FamilySkeleton />
      </div>
    )
  }

  if (error === 'module_required') {
    return (
      <div className="max-w-md mx-auto px-4 py-10 text-center">
        <span className="material-symbols-outlined text-5xl text-gray-300">lock</span>
        <p className="mt-3 text-sm text-gray-500">
          Эта функция требует подключения модуля. Свяжитесь с клиникой.
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-md mx-auto px-4 py-10 text-center">
        <span className="material-symbols-outlined text-5xl text-rose-300">error_outline</span>
        <p className="mt-3 text-sm text-gray-500">{error}</p>
        <button onClick={load} className="mt-4 text-sm font-semibold" style={{ color: '#1565C0' }}>
          Попробовать снова
        </button>
      </div>
    )
  }

  if (!family) {
    return <FamilyOnboarding onCreate={handleCreate} onJoin={handleJoined} busy={busy} />
  }

  const sortedMembers = [...(family.members || [])].sort((a, b) => {
    // self всегда сверху
    if (a.is_self && !b.is_self) return -1
    if (!a.is_self && b.is_self) return 1
    return new Date(a.added_at || 0) - new Date(b.added_at || 0)
  })

  return (
    <div className="max-w-2xl mx-auto px-4 py-5">
      {/* ── Хедер группы ── */}
      <div className="flex items-center justify-between mb-5">
        <div className="min-w-0 flex-1">
          {renameMode ? (
            <div className="flex items-center gap-2">
              <input
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter') handleRename()
                  if (e.key === 'Escape') setRenameMode(false)
                }}
                className="px-3 py-1.5 rounded-lg border border-gray-300 text-base font-bold outline-none focus:border-cyan-500 flex-1"
                style={{ color: '#0A2342' }}
              />
              <button onClick={handleRename} className="text-sm font-bold text-emerald-600">OK</button>
              <button onClick={() => setRenameMode(false)} className="text-sm font-bold text-gray-400">×</button>
            </div>
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <span className="material-symbols-outlined text-2xl flex-shrink-0"
                    style={{ color: '#EC4899', fontVariationSettings: "'FILL' 1" }}>
                family_restroom
              </span>
              <h2 className="text-lg font-extrabold truncate" style={{ color: '#0A2342' }}>
                {family.name || 'Моя семья'}
              </h2>
              <button
                onClick={() => { setRenameValue(family.name || ''); setRenameMode(true) }}
                className="text-gray-400 hover:text-gray-600 p-1"
                title="Переименовать">
                <span className="material-symbols-outlined text-base">edit</span>
              </button>
            </div>
          )}
          <p className="text-xs text-gray-500 mt-0.5 ml-9">{sortedMembers.length} {sortedMembers.length === 1 ? 'участник' : 'участника(-ов)'}</p>
        </div>
      </div>

      {/* ── Сетка карточек ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {sortedMembers.map(m => (
          <FamilyMemberCard
            key={m.member_id}
            member={m}
            onPermChange={(field, value) => handlePermChange(m.member_id, field, value)}
            onRelationChange={(rel) => handleRelationChange(m.member_id, rel)}
            onSwitch={() => handleSwitch(m)}
            onRemove={() => handleRemove(m.member_id)}
          />
        ))}

        {/* Карточка-кнопка «+ Добавить родственника» */}
        <button
          onClick={() => setShowAdd(true)}
          className="rounded-2xl p-4 border-2 border-dashed border-gray-300 hover:border-cyan-400 hover:bg-cyan-50/30 transition-all flex flex-col items-center justify-center gap-2 min-h-[176px] text-gray-400 hover:text-cyan-600">
          <span className="material-symbols-outlined text-4xl">person_add</span>
          <span className="text-sm font-semibold">Добавить родственника</span>
        </button>
      </div>

      {/* ── Модалы ── */}
      {showAdd && (
        <AddMemberModal
          onClose={() => setShowAdd(false)}
          onAdded={handleMemberAdded}
          sessionToken={token}
        />
      )}
    </div>
  )
}
