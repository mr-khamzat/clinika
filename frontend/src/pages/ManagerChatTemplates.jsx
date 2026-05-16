/**
 * Manager: CRUD страница шаблонов чата.
 * Route: /manager/chat-templates
 */
import { useEffect, useState } from 'react'
import api from '../api'
import { useToast } from '../design'
import ManagerShell from './_ManagerShell'

export default function ManagerChatTemplates() {
  const { toast } = useToast() || {}
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState(null)  // null = none, {} = new, {id,...} = edit

  const load = async () => {
    setLoading(true)
    try {
      const r = await api.get('/chat/templates', { params: { limit: 100 } })
      setItems(r.data?.templates || [])
    } catch { setItems([]) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const save = async () => {
    if (!edit?.shortcut?.trim() || !edit?.title?.trim() || !edit?.body?.trim()) {
      toast?.('Все поля обязательны', 'error'); return
    }
    const payload = {
      shortcut: edit.shortcut.trim(),
      title: edit.title.trim(),
      body: edit.body,
      category: edit.category || null,
      is_global: !!edit.is_global,
    }
    try {
      if (edit.id) await api.put(`/chat/templates/${edit.id}`, payload)
      else await api.post('/chat/templates', payload)
      toast?.('Сохранено', 'success')
      setEdit(null); load()
    } catch (e) {
      toast?.(e?.response?.data?.detail || 'Ошибка', 'error')
    }
  }
  const del = async (id) => {
    if (!confirm('Удалить шаблон?')) return
    try { await api.delete(`/chat/templates/${id}`); toast?.('Удалено', 'success'); load() }
    catch (e) { toast?.(e?.response?.data?.detail || 'Ошибка', 'error') }
  }

  return (
    <ManagerShell active="chat-templates" title="Шаблоны ответов" icon="dynamic_form">
      <div className="flex justify-end mb-3">
        <button onClick={() => setEdit({ shortcut: '', title: '', body: '', category: '', is_global: false })}
                className="px-4 py-2 rounded-xl font-semibold text-white"
                style={{ background: 'linear-gradient(135deg, #0097A7, #0A2342)' }}>
          + Новый шаблон
        </button>
      </div>
      {loading ? (
        <div className="text-center py-12" style={{ color: 'var(--fg-3)' }}>Загрузка…</div>
      ) : items.length === 0 ? (
        <div className="text-center py-12" style={{ color: 'var(--fg-3)' }}>Нет шаблонов</div>
      ) : (
        <div className="grid gap-2">
          {items.map(t => (
            <div key={t.id} className="p-3 rounded-2xl flex items-start gap-3"
                 style={{ background: 'var(--surface, #fff)', border: '1px solid var(--border, #e2e8f0)' }}>
              <code style={{ fontSize: 12, padding: '4px 8px', borderRadius: 8,
                             background: 'var(--bg-1, #f1f5f9)', color: 'var(--accent, #0097A7)',
                             alignSelf: 'flex-start' }}>/{t.shortcut}</code>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span style={{ fontWeight: 700 }}>{t.title}</span>
                  {t.is_global && (
                    <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 999,
                                   background: 'rgba(14,165,233,.15)', color: '#0369a1' }}>общий</span>
                  )}
                  <span style={{ fontSize: 11, color: 'var(--fg-3)', marginLeft: 'auto' }}>
                    использован: {t.usage_count}
                  </span>
                </div>
                <div className="truncate mt-1" style={{ fontSize: 13, color: 'var(--fg-2)' }}>{t.body}</div>
              </div>
              <div className="flex flex-col gap-1">
                <button onClick={() => setEdit({ ...t })}
                        className="px-2 py-1 rounded-lg" style={{ background: 'var(--bg-1)', fontSize: 12 }}>
                  Изменить
                </button>
                <button onClick={() => del(t.id)}
                        className="px-2 py-1 rounded-lg" style={{ background: '#fee2e2', color: '#991b1b', fontSize: 12 }}>
                  Удалить
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Модал редактирования */}
      {edit && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4"
             style={{ background: 'rgba(15,23,42,.55)' }} onClick={() => setEdit(null)}>
          <div onClick={e => e.stopPropagation()}
               className="w-full max-w-md rounded-3xl overflow-hidden p-5 space-y-3"
               style={{ background: 'var(--bg, #fff)' }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>
              {edit.id ? 'Изменить шаблон' : 'Новый шаблон'}
            </div>
            <input placeholder="shortcut (анализы, цены)" value={edit.shortcut || ''}
                   onChange={e => setEdit({ ...edit, shortcut: e.target.value })}
                   className="w-full px-3 py-2 rounded-xl outline-none"
                   style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}/>
            <input placeholder="Название" value={edit.title || ''}
                   onChange={e => setEdit({ ...edit, title: e.target.value })}
                   className="w-full px-3 py-2 rounded-xl outline-none"
                   style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}/>
            <textarea placeholder="Текст ответа…" rows={5} value={edit.body || ''}
                      onChange={e => setEdit({ ...edit, body: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl outline-none resize-none"
                      style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}/>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={!!edit.is_global}
                     onChange={e => setEdit({ ...edit, is_global: e.target.checked })}/>
              Общий для всей клиники
            </label>
            <div className="flex gap-2">
              <button onClick={() => setEdit(null)}
                      className="flex-1 py-2.5 rounded-xl"
                      style={{ background: 'var(--bg-1)' }}>Отмена</button>
              <button onClick={save}
                      className="flex-1 py-2.5 rounded-xl text-white font-semibold"
                      style={{ background: 'linear-gradient(135deg, #0097A7, #0A2342)' }}>
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </ManagerShell>
  )
}
