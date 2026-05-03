import { useState, useEffect } from 'react'
import axios from 'axios'
import { API_BASE } from '../config'

function authH(t) { return { Authorization: `Bearer ${t}` } }

const ACT_STATUS = {
  draft:     { label: 'Черновик',    bg: '#f5f5f5', c: '#757575' },
  generated: { label: 'Сформирован', bg: '#e3f2fd', c: '#1565c0' },
  sent:      { label: 'Отправлен',   bg: '#e0f7fa', c: '#006064' },
  signed:    { label: 'Подписан',    bg: '#e8f5e9', c: '#2e7d32' },
  paid:      { label: 'Оплачен',     bg: '#e8f5e9', c: '#1b5e20' },
  overdue:   { label: 'Просрочен',   bg: '#fce4ec', c: '#b71c1c' },
}

function Spinner() {
  return (
    <div className="flex justify-center py-16">
      <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
        style={{ borderColor: '#0097A7', borderTopColor: 'transparent' }} />
    </div>
  )
}

export default function AccountantCabinet({ adminToken, user, onLogout }) {
  const [tab, setTab] = useState('acts')
  const [acts, setActs] = useState([])
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [signModal, setSignModal] = useState(null)
  const [signerName, setSignerName] = useState(user?.full_name || '')
  const [msg, setMsg] = useState('')

  const userName = user?.full_name || 'Бухгалтер'
  const userInit = userName[0].toUpperCase()

  useEffect(() => {
    setLoading(true)
    const load = tab === 'acts'
      ? axios.get(`${API_BASE}/acts/`, { headers: authH(adminToken) }).then(r => setActs(r.data))
      : axios.get(`${API_BASE}/billing/invoices`, { headers: authH(adminToken) }).then(r => setInvoices(r.data?.invoices || r.data || []))
    load.catch(() => {}).finally(() => setLoading(false))
  }, [tab, adminToken])

  async function signAct(actNumber) {
    if (!signerName.trim()) { setMsg('Введите ФИО подписанта'); return }
    try {
      await axios.post(`${API_BASE}/acts/${actNumber}/sign`, { signer_name: signerName }, { headers: authH(adminToken) })
      setSignModal(null); setMsg('✓ Акт подписан')
      const r = await axios.get(`${API_BASE}/acts/`, { headers: authH(adminToken) })
      setActs(r.data)
    } catch (e) { setMsg('Ошибка: ' + (e.response?.data?.detail || e.message)) }
    setTimeout(() => setMsg(''), 4000)
  }

  const TABS = [
    { id: 'acts',     label: 'Акты',  icon: 'receipt_long' },
    { id: 'invoices', label: 'Счета', icon: 'description' },
  ]
  const activeTab = TABS.find(t => t.id === tab)

  return (
    <div className="min-h-screen font-sans flex flex-col" style={{ background: '#F0F4F8' }}>

      {/* HEADER */}
      <header className="sticky top-0 z-20 flex items-center gap-3 px-5 py-3.5 border-b border-white/10"
        style={{ background: 'linear-gradient(135deg,#0a1628,#0d2040)', backdropFilter: 'blur(12px)' }}>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: '#90caf9' }}>КлиникСеть</div>
          <div className="text-white font-bold text-base leading-tight">{activeTab?.label}</div>
        </div>
        <button onClick={onLogout}
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(255,255,255,0.08)' }}>
          <span className="material-symbols-outlined text-[18px] text-white">logout</span>
        </button>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
          style={{ background: 'linear-gradient(135deg,#1565c0,#0097A7)' }}>
          {userInit}
        </div>
      </header>

      {/* USER CARD */}
      <div className="px-4 py-4" style={{ background: 'linear-gradient(135deg,#0a1628,#0d2040)' }}>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-lg font-bold text-white flex-shrink-0"
            style={{ background: 'linear-gradient(135deg,#1565c0,#0097A7)' }}>
            {userInit}
          </div>
          <div>
            <div className="text-white font-bold">{userName}</div>
            <div className="text-[11px] mt-0.5" style={{ color: '#90caf9' }}>Бухгалтер</div>
          </div>
        </div>
      </div>

      {/* TABS */}
      <div className="px-4 py-3 flex gap-2">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all"
            style={tab === t.id
              ? { background: 'linear-gradient(135deg,#1565c0,#0097A7)', color: '#fff', boxShadow: '0 4px 12px rgba(21,101,192,0.3)' }
              : { background: '#fff', color: '#6b7280', border: '1px solid #e5e7eb' }}>
            <span className="material-symbols-outlined text-[18px]"
              style={{ fontVariationSettings: tab === t.id ? "'FILL' 1" : "'FILL' 0" }}>
              {t.icon}
            </span>
            {t.label}
          </button>
        ))}
      </div>

      {/* MSG */}
      {msg && (
        <div className="mx-4 mb-2 px-4 py-3 rounded-2xl text-sm font-medium"
          style={msg.startsWith('✓')
            ? { background: '#e8f5e9', color: '#2e7d32', border: '1px solid #c8e6c9' }
            : { background: '#fce4ec', color: '#c62828', border: '1px solid #f8bbd0' }}>
          {msg}
        </div>
      )}

      {/* CONTENT */}
      <main className="flex-1 px-4 pb-8">
        {loading ? <Spinner /> : null}

        {/* ACTS */}
        {!loading && tab === 'acts' && (
          <div className="space-y-3">
            {acts.length === 0 ? (
              <div className="flex flex-col items-center py-16 gap-3">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(21,101,192,0.08)' }}>
                  <span className="material-symbols-outlined text-3xl" style={{ color: '#1565c0' }}>receipt_long</span>
                </div>
                <p className="text-gray-400 text-sm">Актов нет</p>
              </div>
            ) : acts.map(a => {
              const st = ACT_STATUS[a.act_status] || { label: a.act_status, bg: '#f5f5f5', c: '#616161' }
              const canSign = ['generated', 'sent'].includes(a.act_status)
              return (
                <div key={a.id} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-gray-900">{a.act_number || a.invoice_number}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{a.legal_entity_name || '—'}</div>
                    </div>
                    <span className="text-[11px] font-bold px-2.5 py-1 rounded-full flex-shrink-0"
                      style={{ background: st.bg, color: st.c }}>
                      {st.label}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xl font-extrabold text-gray-900">{Number(a.total || a.amount || 0).toLocaleString('ru')} ₽</div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {a.period_start ? new Date(a.period_start).toLocaleDateString('ru') : '?'} — {a.period_end ? new Date(a.period_end).toLocaleDateString('ru') : '?'}
                        {a.due_date && ` · до ${new Date(a.due_date).toLocaleDateString('ru')}`}
                      </div>
                    </div>
                    {canSign && (
                      <button onClick={() => { setSignModal(a.act_number); setSignerName(user?.full_name || '') }}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white"
                        style={{ background: 'linear-gradient(135deg,#1565c0,#0097A7)' }}>
                        <span className="material-symbols-outlined text-[16px]">draw</span>
                        Подписать
                      </button>
                    )}
                  </div>
                  {a.notes && <div className="mt-2 text-xs text-gray-500 pt-2 border-t border-gray-50">{a.notes}</div>}
                </div>
              )
            })}
          </div>
        )}

        {/* INVOICES */}
        {!loading && tab === 'invoices' && (
          <div className="space-y-3">
            {invoices.length === 0 ? (
              <div className="flex flex-col items-center py-16 gap-3">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(0,151,167,0.08)' }}>
                  <span className="material-symbols-outlined text-3xl" style={{ color: '#0097A7' }}>description</span>
                </div>
                <p className="text-gray-400 text-sm">Счетов нет</p>
              </div>
            ) : invoices.map(inv => (
              <div key={inv.id} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-gray-900">{inv.invoice_number}</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {inv.period_start ? new Date(inv.period_start).toLocaleDateString('ru') : '?'} — {inv.period_end ? new Date(inv.period_end).toLocaleDateString('ru') : '?'}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xl font-extrabold text-gray-900">{Number(inv.amount || 0).toLocaleString('ru')} ₽</div>
                  <span className="inline-block text-[11px] font-bold px-2.5 py-0.5 rounded-full mt-1"
                    style={{ background: '#f5f5f5', color: '#757575' }}>{inv.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* SIGN MODAL */}
      {signModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSignModal(null)} />
          <div className="relative w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl p-6 shadow-2xl"
            style={{ background: '#fff' }}>
            <div className="w-10 h-1 rounded-full bg-gray-200 mx-auto mb-5 sm:hidden" />
            <h3 className="text-lg font-bold text-gray-900 mb-1">Подписать акт</h3>
            <p className="text-sm text-gray-400 mb-4">{signModal}</p>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">ФИО подписанта</label>
            <input value={signerName} onChange={e => setSignerName(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm mb-5 focus:outline-none focus:border-blue-400"
              placeholder="Иванов Иван Иванович" />
            <div className="flex gap-3">
              <button onClick={() => setSignModal(null)}
                className="flex-1 py-3 rounded-xl text-sm font-semibold text-gray-600 border border-gray-200">
                Отмена
              </button>
              <button onClick={() => signAct(signModal)}
                className="flex-1 py-3 rounded-xl text-sm font-semibold text-white shadow-sm"
                style={{ background: 'linear-gradient(135deg,#1565c0,#0097A7)' }}>
                Подписать
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
