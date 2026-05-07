// База знаний AI (FAQ) — secция для AdminLayout (super_admin) и FranchiseOwnerCabinet.
// Перед обращением к LLM patient_chat_ai пытается найти ответ здесь — экономит токены.
import { useState, useEffect, useCallback, useRef } from 'react'
import axios from 'axios'
import { API_BASE } from '../config'
import { useToast, useConfirm } from '../design'

const ACCENT = '#7c3aed'

function authH(token) { return { Authorization: `Bearer ${token}` } }

function truncate(s, n) {
  if (!s) return ''
  s = String(s)
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

// ── Форма создания/редактирования ────────────────────────────────────────────
function EntryForm({ initial, onCancel, onSave }) {
  const [form, setForm] = useState(() => ({
    question: initial?.question || '',
    answer: initial?.answer || '',
    keywords: initial?.keywords || '',
    priority: initial?.priority ?? 5,
    is_active: initial?.is_active ?? true,
  }))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function submit() {
    if (!form.question.trim() || !form.answer.trim()) {
      setErr('Заполните вопрос и ответ')
      return
    }
    setBusy(true); setErr('')
    try {
      await onSave(form)
    } catch (e) {
      setErr(e?.response?.data?.detail || e.message || 'Ошибка')
    }
    setBusy(false)
  }

  return (
    <div className="bg-white rounded-2xl p-4 mb-4" style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.05)' }}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-gray-800">
          {initial?.id ? 'Редактировать запись' : 'Новая запись FAQ'}
        </h3>
        <button onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-700">Отмена</button>
      </div>

      {err && <div className="text-xs text-red-600 mb-2">{err}</div>}

      <div className="space-y-3">
        <div>
          <label className="text-xs font-semibold text-gray-500 mb-1 block">Вопрос</label>
          <input
            value={form.question}
            onChange={e => set('question', e.target.value)}
            placeholder="Например: Какие у вас часы работы?"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-500 mb-1 block">Ответ</label>
          <textarea
            value={form.answer}
            onChange={e => set('answer', e.target.value)}
            rows={5}
            placeholder="Текст готового ответа для AI-ассистента"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-y"
          />
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-500 mb-1 block">
            Ключевые слова <span className="text-gray-400 font-normal">(через запятую — для поиска)</span>
          </label>
          <input
            value={form.keywords}
            onChange={e => set('keywords', e.target.value)}
            placeholder="часы, работа, расписание, режим"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-gray-500">Приоритет (1–10)</label>
            <input
              type="number" min={1} max={10}
              value={form.priority}
              onChange={e => set('priority', Math.max(1, Math.min(10, +e.target.value || 5)))}
              className="w-16 px-2 py-1 border border-gray-200 rounded-lg text-sm text-center"
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox" checked={!!form.is_active}
              onChange={e => set('is_active', e.target.checked)}
              className="w-4 h-4 accent-purple-600"
            />
            <span className="text-xs font-semibold text-gray-600">Активно</span>
          </label>
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={submit} disabled={busy}
            className="px-4 py-2 rounded-xl text-white font-semibold text-sm disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)' }}
          >
            {busy ? 'Сохранение…' : 'Сохранить'}
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-xl bg-gray-100 text-gray-600 text-sm font-medium"
          >
            Отмена
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Карточка / строка таблицы ────────────────────────────────────────────────
function EntryCard({ entry, onEdit, onDelete }) {
  const keywords = (entry.keywords || '').split(',').map(s => s.trim()).filter(Boolean)
  return (
    <div className="bg-white rounded-2xl p-4" style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.05)' }}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <h4 className="font-bold text-gray-800 text-sm leading-snug flex-1 min-w-0">
          {entry.question}
        </h4>
        <div className="flex items-center gap-1 flex-shrink-0">
          {entry.tenant_id == null && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 font-semibold uppercase">
              Платформа
            </span>
          )}
          {!entry.is_active && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-semibold uppercase">
              off
            </span>
          )}
        </div>
      </div>

      <p className="text-xs text-gray-600 leading-relaxed mb-2.5">
        {truncate(entry.answer, 220)}
      </p>

      {keywords.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2.5">
          {keywords.slice(0, 8).map((k, i) => (
            <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 font-medium">
              {k}
            </span>
          ))}
          {keywords.length > 8 && (
            <span className="text-[10px] px-2 py-0.5 text-gray-400">+{keywords.length - 8}</span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-gray-100">
        <div className="flex items-center gap-3 text-[11px] text-gray-500">
          <span title="Приоритет" className="flex items-center gap-1">
            <span className="material-symbols-outlined text-sm">priority_high</span>
            {entry.priority}
          </span>
          <span title="Использований (hits)" className="flex items-center gap-1">
            <span className="material-symbols-outlined text-sm">trending_up</span>
            {entry.hits || 0}
          </span>
          {entry.updated_at && (
            <span className="text-gray-400">
              {new Date(entry.updated_at).toLocaleDateString('ru-RU')}
            </span>
          )}
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => onEdit(entry)}
            className="px-2.5 py-1 rounded-lg bg-purple-50 text-purple-700 text-xs font-medium flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-sm">edit</span>
            Изменить
          </button>
          <button
            onClick={() => onDelete(entry)}
            className="px-2 py-1 rounded-lg bg-red-50 text-red-600 text-xs font-medium"
            title="Удалить"
          >
            <span className="material-symbols-outlined text-sm">delete</span>
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Главная секция ───────────────────────────────────────────────────────────
export default function AIKnowledgeSection({ token }) {
  // Замена alert/confirm на Toast и Modal
  const { toast } = useToast()
  const { confirm, ConfirmHost } = useConfirm()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [editing, setEditing] = useState(null)   // null | 'new' | object
  const [stats, setStats] = useState(null)
  const fileInputRef = useRef(null)
  const [importMsg, setImportMsg] = useState('')
  const [importBusy, setImportBusy] = useState(false)

  // 300ms debounce поиска
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = { limit: 200 }
      if (debounced) params.q = debounced
      const r = await axios.get(`${API_BASE}/ai/knowledge`, {
        headers: authH(token), params,
      })
      setItems(Array.isArray(r.data) ? r.data : [])
    } catch {
      setItems([])
    }
    setLoading(false)
  }, [token, debounced])

  const loadStats = useCallback(async () => {
    try {
      const r = await axios.get(`${API_BASE}/ai/knowledge/stats`, {
        headers: authH(token), params: { limit: 5 },
      })
      setStats(r.data || null)
    } catch { setStats(null) }
  }, [token])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadStats() }, [loadStats])

  async function saveEntry(form) {
    if (editing && editing !== 'new' && editing.id) {
      await axios.patch(`${API_BASE}/ai/knowledge/${editing.id}`, form, { headers: authH(token) })
    } else {
      await axios.post(`${API_BASE}/ai/knowledge`, form, { headers: authH(token) })
    }
    setEditing(null)
    await load()
    await loadStats()
  }

  async function deleteEntry(entry) {
    if (!(await confirm(`Удалить запись «${truncate(entry.question, 50)}»?`, { danger: true, okText: 'Удалить' }))) return
    try {
      await axios.delete(`${API_BASE}/ai/knowledge/${entry.id}`, { headers: authH(token) })
      await load(); await loadStats()
    } catch (e) {
      toast(e?.response?.data?.detail || 'Не удалось удалить', 'error')
    }
  }

  async function handleFile(ev) {
    const file = ev.target.files?.[0]
    if (!file) return
    setImportBusy(true); setImportMsg('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await axios.post(`${API_BASE}/ai/knowledge/import`, fd, {
        headers: { ...authH(token), 'Content-Type': 'multipart/form-data' },
      })
      setImportMsg(`Импортировано: ${r.data?.imported ?? 0} из ${r.data?.received ?? 0}`)
      await load(); await loadStats()
    } catch (e) {
      setImportMsg('Ошибка импорта: ' + (e?.response?.data?.detail || e.message))
    }
    setImportBusy(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    setTimeout(() => setImportMsg(''), 5000)
  }

  return (
    <div className="space-y-4 px-1">
      {/* Хост Modal-подтверждения */}
      <ConfirmHost />
      {/* Заголовок + статистика */}
      <div className="bg-white rounded-2xl p-4" style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.05)' }}>
        <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-gray-800 text-base mb-1 flex items-center gap-2">
              <span className="material-symbols-outlined" style={{ color: ACCENT, fontVariationSettings: "'FILL' 1" }}>
                library_books
              </span>
              База знаний AI
            </h2>
            <p className="text-xs text-gray-500 leading-relaxed">
              FAQ для AI-ассистента: ответы на типовые вопросы пациентов
              отдаются мгновенно, без обращения к LLM. Экономит токены и ускоряет ответ.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importBusy}
              className="px-3 py-2 rounded-xl bg-gray-100 text-gray-700 text-xs font-semibold flex items-center gap-1 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-base">upload_file</span>
              {importBusy ? 'Импорт…' : 'Импорт CSV/JSON'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.json"
              onChange={handleFile}
              style={{ display: 'none' }}
            />
            <button
              onClick={() => setEditing('new')}
              className="px-3 py-2 rounded-xl text-white text-xs font-semibold flex items-center gap-1"
              style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)' }}
            >
              <span className="material-symbols-outlined text-base">add</span>
              Добавить
            </button>
          </div>
        </div>

        {importMsg && (
          <div className={`text-xs px-3 py-2 rounded-lg mb-2 ${importMsg.startsWith('Ошибка') ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
            {importMsg}
          </div>
        )}

        {stats && (
          <div className="grid grid-cols-3 gap-2 mt-3">
            <div className="rounded-xl p-3" style={{ background: '#f5f3ff' }}>
              <div className="text-[10px] uppercase tracking-wider text-purple-700 font-semibold mb-1">Записей</div>
              <div className="text-lg font-bold text-gray-800">{items.length}</div>
            </div>
            <div className="rounded-xl p-3" style={{ background: '#ecfdf5' }}>
              <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold mb-1">Использований</div>
              <div className="text-lg font-bold text-gray-800">{stats.total_hits || 0}</div>
            </div>
            <div className="rounded-xl p-3" style={{ background: '#fffbeb' }}>
              <div className="text-[10px] uppercase tracking-wider text-amber-700 font-semibold mb-1">Сэкон. токенов</div>
              <div className="text-lg font-bold text-gray-800">{stats.estimated_tokens_saved || 0}</div>
            </div>
          </div>
        )}
      </div>

      {/* Поиск */}
      <div className="bg-white rounded-2xl px-3 py-2 flex items-center gap-2" style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.05)' }}>
        <span className="material-symbols-outlined text-gray-400">search</span>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Поиск по вопросу или ключевым словам…"
          className="flex-1 px-1 py-1.5 text-sm focus:outline-none bg-transparent"
        />
        {search && (
          <button onClick={() => setSearch('')} className="text-gray-400 hover:text-gray-600">
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        )}
      </div>

      {/* Форма (новая или редактирование) */}
      {editing && (
        <EntryForm
          initial={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onSave={saveEntry}
        />
      )}

      {/* Список */}
      {loading ? (
        <div className="flex justify-center py-10">
          <div className="w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 text-center" style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.05)' }}>
          <span className="material-symbols-outlined text-5xl text-gray-300 block mb-2" style={{ fontVariationSettings: "'FILL' 1" }}>
            library_books
          </span>
          <p className="text-gray-400 text-sm mb-3">
            {debounced ? 'Ничего не найдено' : 'База знаний пуста — добавьте первую запись'}
          </p>
          {!debounced && (
            <button
              onClick={() => setEditing('new')}
              className="px-4 py-2 rounded-xl text-white text-sm font-semibold inline-flex items-center gap-1"
              style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)' }}
            >
              <span className="material-symbols-outlined text-base">add</span>
              Добавить запись
            </button>
          )}
        </div>
      ) : (
        // На мобильных — карточки в один столбец, на больших — сетка 2 колонки
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {items.map(it => (
            <EntryCard
              key={it.id}
              entry={it}
              onEdit={(e) => setEditing(e)}
              onDelete={deleteEntry}
            />
          ))}
        </div>
      )}
    </div>
  )
}
