import { useState, useEffect } from 'react'
import axios from 'axios'
import { API_BASE } from '../config'

function authH(token) { return { Authorization: `Bearer ${token}` } }

const ACT_STATUS = {
  draft: { label: 'Черновик', color: '#9e9e9e' },
  generated: { label: 'Сформирован', color: '#1976d2' },
  sent: { label: 'Отправлен', color: '#0097A7' },
  signed: { label: 'Подписан', color: '#4caf50' },
  paid: { label: 'Оплачен', color: '#2e7d32' },
  overdue: { label: 'Просрочен', color: '#e53935' },
}

export default function AccountantCabinet({ adminToken, user, onLogout }) {
  const [activeTab, setActiveTab] = useState('acts')
  const [acts, setActs] = useState([])
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [signModal, setSignModal] = useState(null)
  const [signerName, setSignerName] = useState(user?.full_name || '')
  const [msg, setMsg] = useState('')

  useEffect(() => { loadData() }, [activeTab])

  async function loadData() {
    setLoading(true)
    try {
      if (activeTab === 'acts') {
        const r = await axios.get(`${API_BASE}/acts/`, { headers: authH(adminToken) })
        setActs(r.data)
      } else if (activeTab === 'invoices') {
        const r = await axios.get(`${API_BASE}/billing/invoices`, { headers: authH(adminToken) })
        setInvoices(r.data?.invoices || r.data || [])
      }
    } catch {}
    setLoading(false)
  }

  async function signAct(actNumber) {
    if (!signerName.trim()) { setMsg('Введите ФИО подписанта'); return }
    try {
      await axios.post(`${API_BASE}/acts/${actNumber}/sign`,
        { signer_name: signerName },
        { headers: authH(adminToken) }
      )
      setSignModal(null)
      setMsg('Акт подписан ✓')
      await loadData()
    } catch (e) {
      setMsg('Ошибка: ' + (e.response?.data?.detail || e.message))
    }
    setTimeout(() => setMsg(''), 4000)
  }

  const TABS = [
    { id: 'acts', label: 'Акты', icon: 'receipt_long' },
    { id: 'invoices', label: 'Счета', icon: 'description' },
  ]

  return (
    <div className="min-h-screen bg-[#f7f9fb] font-sans">
      <header className="bg-[#1a2232] text-white flex items-center gap-3 px-6 py-4 shadow-lg">
        <div className="w-10 h-10 rounded-full bg-teal-600 flex items-center justify-center font-bold text-lg">
          {(user?.full_name || 'A')[0].toUpperCase()}
        </div>
        <div className="flex-1">
          <div className="font-bold text-base leading-tight">{user?.full_name || 'Бухгалтер'}</div>
          <div className="text-[11px] text-slate-400 uppercase tracking-widest">Accountant</div>
        </div>
        <button onClick={onLogout}
          className="text-slate-400 hover:text-white transition flex items-center gap-1 text-sm">
          <span className="material-symbols-outlined text-lg">logout</span>
          Выйти
        </button>
      </header>

      <div className="bg-white border-b border-gray-200 px-6 flex gap-1">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition ${
              activeTab === t.id
                ? 'border-teal-600 text-teal-600'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}>
            <span className="material-symbols-outlined text-lg">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {msg && (
        <div className={`mx-6 mt-4 px-4 py-3 rounded-xl text-sm ${msg.startsWith('Ошибка') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {msg}
        </div>
      )}

      <main className="max-w-5xl mx-auto p-6">
        {loading && (
          <div className="flex justify-center py-16">
            <div className="w-10 h-10 border-4 border-teal-600 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && activeTab === 'acts' && (
          <div>
            <h2 className="text-xl font-bold text-gray-800 mb-4">Акты оказанных услуг</h2>
            {acts.length === 0 && <p className="text-gray-400 text-sm">Актов нет.</p>}
            <div className="flex flex-col gap-3">
              {acts.map(a => {
                const st = ACT_STATUS[a.act_status] || { label: a.act_status, color: '#888' }
                return (
                  <div key={a.id} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 flex items-center gap-4">
                    <div className="flex-1">
                      <div className="font-bold text-gray-800">{a.act_number || a.invoice_number}</div>
                      <div className="text-xs text-gray-400 mt-1">
                        {a.legal_entity_name || '—'} &nbsp;·&nbsp;
                        {a.period_start ? new Date(a.period_start).toLocaleDateString('ru') : '?'} — {a.period_end ? new Date(a.period_end).toLocaleDateString('ru') : '?'}
                        &nbsp;·&nbsp; до {a.due_date ? new Date(a.due_date).toLocaleDateString('ru') : '?'}
                      </div>
                      {a.notes && <div className="text-xs text-gray-500 mt-1">{a.notes}</div>}
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-gray-800 text-lg">{Number(a.total || a.amount || 0).toLocaleString('ru')} ₽</div>
                      <span className="inline-block px-2.5 py-1 rounded-full text-xs font-semibold mt-1"
                        style={{ background: st.color + '22', color: st.color }}>
                        {st.label}
                      </span>
                    </div>
                    {['generated', 'sent'].includes(a.act_status) && (
                      <button onClick={() => { setSignModal(a.act_number); setSignerName(user?.full_name || '') }}
                        className="px-4 py-2 bg-blue-50 text-blue-700 rounded-xl text-sm font-semibold hover:bg-blue-100 transition">
                        Подписать
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {!loading && activeTab === 'invoices' && (
          <div>
            <h2 className="text-xl font-bold text-gray-800 mb-4">Счета</h2>
            {invoices.length === 0 && <p className="text-gray-400 text-sm">Счетов нет.</p>}
            <div className="flex flex-col gap-3">
              {invoices.map(inv => (
                <div key={inv.id} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 flex items-center gap-4">
                  <div className="flex-1">
                    <div className="font-bold text-gray-800">{inv.invoice_number}</div>
                    <div className="text-xs text-gray-400 mt-1">
                      {inv.period_start ? new Date(inv.period_start).toLocaleDateString('ru') : '?'} — {inv.period_end ? new Date(inv.period_end).toLocaleDateString('ru') : '?'}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-gray-800 text-lg">{Number(inv.amount || 0).toLocaleString('ru')} ₽</div>
                    <span className="inline-block px-2.5 py-1 rounded-full text-xs font-semibold mt-1 bg-gray-100 text-gray-500">
                      {inv.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Sign modal */}
      {signModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h3 className="text-lg font-bold text-gray-800 mb-4">Подписать акт {signModal}</h3>
            <label className="block text-sm font-medium text-gray-600 mb-1">ФИО подписанта</label>
            <input value={signerName} onChange={e => setSignerName(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm mb-4"
              placeholder="Иванов Иван Иванович" />
            <div className="flex gap-3 justify-end">
              <button onClick={() => setSignModal(null)}
                className="px-4 py-2 bg-gray-100 text-gray-600 rounded-xl text-sm">Отмена</button>
              <button onClick={() => signAct(signModal)}
                className="px-4 py-2 bg-teal-600 text-white rounded-xl text-sm font-semibold">Подписать</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
