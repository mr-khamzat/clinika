// ============================================================================
// AcceptInviteModal — приём invite-token и присоединение к чужой семье
// ============================================================================
//
// POST /patient/family/accept-invite { token } → { group_id, name, joined:true }
//
// Используется на онбординге, когда у пользователя ещё нет своей группы,
// но есть приглашение от родственника.
// ============================================================================

import { useState, useEffect } from 'react'
import axios from 'axios'
import { API_BASE } from '../../config'
import { useToast } from '../../design'

const SESSION_KEY = 'clinika_patient_session'

export default function AcceptInviteModal({ onClose, onJoined, sessionToken }) {
  const { toast } = useToast()
  const [tokenValue, setTokenValue] = useState('')
  const [busy, setBusy] = useState(false)

  const token = sessionToken || (typeof window !== 'undefined' ? localStorage.getItem(SESSION_KEY) : null)

  // Автоподтягивание токена из URL ?token=... (deep-link сценарий)
  useEffect(() => {
    try {
      const url = new URL(window.location.href)
      const t = url.searchParams.get('token') || url.searchParams.get('invite_token')
      if (t) setTokenValue(t)
    } catch {}
  }, [])

  const submit = async (e) => {
    e?.preventDefault?.()
    const t = tokenValue.trim()
    if (!t) return
    setBusy(true)
    try {
      const r = await axios.post(`${API_BASE}/patient/family/accept-invite`, { token: t }, { params: { t: token } })
      toast('Вы присоединились к семье', 'success')
      onJoined && onJoined(r.data || {})
      onClose && onClose()
    } catch (e) {
      const detail = e.response?.data?.detail
      toast(typeof detail === 'string' ? detail : 'Не удалось принять приглашение', 'error')
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center px-0 md:px-4 py-0 md:py-4"
         style={{ background: 'rgba(15,23,42,.5)', backdropFilter: 'blur(4px)' }}
         onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
           className="bg-white rounded-t-3xl md:rounded-3xl w-full md:max-w-sm shadow-2xl"
           style={{ animation: 'familySlideUp .3s cubic-bezier(.22,1,.36,1)' }}>
        <style>{`@keyframes familySlideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}`}</style>

        <div className="px-5 pt-5 pb-3 border-b border-gray-100 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
               style={{ background: 'linear-gradient(135deg,#10B981,#059669)' }}>
            <span className="material-symbols-outlined text-white">mail</span>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-extrabold text-base" style={{ color: '#0A2342' }}>Приглашение в семью</h3>
            <p className="text-[11px] text-gray-500">Введите токен из ссылки</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <form onSubmit={submit} className="px-5 py-4 space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">Invite-токен</label>
            <input
              value={tokenValue}
              onChange={e => setTokenValue(e.target.value)}
              autoFocus
              placeholder="Вставьте токен из ссылки"
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm font-mono outline-none focus:border-cyan-500"
            />
            <p className="text-[11px] text-gray-400 mt-1">
              Токен можно скопировать из ссылки, которую вам прислал родственник
              (после «?token=…»).
            </p>
          </div>

          <button
            type="submit"
            disabled={!tokenValue.trim() || busy}
            className="w-full py-3 rounded-xl font-bold text-white text-sm transition-all active:scale-95 disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg,#10B981,#059669)' }}>
            {busy ? 'Проверяем…' : 'Присоединиться'}
          </button>
        </form>
      </div>
    </div>
  )
}
