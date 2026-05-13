/**
 * ========================================
 * БЛОК: ChatRoles — управление группами и broadcast-каналами (Phase 3)
 * ========================================
 * Создание кастомных групп, добавление участников, broadcast-каналы.
 * ========================================
 */
import { useEffect, useMemo, useState } from 'react'
import api from '../api'

export default function ChatRoles() {
  const [groups, setGroups] = useState([])
  const [contacts, setContacts] = useState({ groups: [] })
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [showAdd, setShowAdd] = useState(null) // room object
  const [toast, setToast] = useState('')

  useEffect(() => {
    document.title = 'Группы чатов — КлиникСеть'
    loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [g, c] = await Promise.all([
        api.get('/admin/chat/groups'),
        api.get('/staff-chat/contacts'),
      ])
      setGroups(g.data.groups || [])
      setContacts(c.data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  function flash(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 2000)
  }

  async function createGroup({ name, member_ids, broadcast }) {
    try {
      await api.post('/admin/chat/groups', { name, member_ids, broadcast })
      flash(broadcast ? 'Broadcast-канал создан' : 'Группа создана')
      setShowCreate(false)
      await loadAll()
    } catch (e) {
      alert('Ошибка создания: ' + (e?.response?.data?.detail || e.message))
    }
  }

  async function addMembers(room, user_ids) {
    try {
      await api.post(`/admin/chat/groups/${room.id}/members`, { user_ids })
      flash(`Добавлено ${user_ids.length} участника(ов)`)
      setShowAdd(null)
      await loadAll()
    } catch (e) {
      alert('Ошибка: ' + (e?.response?.data?.detail || e.message))
    }
  }

  async function removeMember(room, user_id) {
    if (!confirm('Удалить участника из группы?')) return
    try {
      await api.delete(`/admin/chat/groups/${room.id}/members/${user_id}`)
      flash('Участник удалён')
      await loadAll()
    } catch (e) {
      alert('Ошибка: ' + (e?.response?.data?.detail || e.message))
    }
  }

  return (
    <div className="cr-root">
      <style>{CR_CSS}</style>
      <header className="cr-head">
        <div>
          <h1 className="cr-title">Группы и broadcast-каналы</h1>
          <p className="cr-sub">Создавайте групповые чаты для команды или каналы для объявлений</p>
        </div>
        {toast && <div className="cr-toast">{toast}</div>}
        <button className="cr-btn-primary" onClick={() => setShowCreate(true)}>
          + Новая группа
        </button>
      </header>

      <section className="cr-grid">
        {loading && <div className="cr-loading">Загрузка…</div>}
        {!loading && groups.length === 0 && (
          <div className="cr-empty">
            <div className="cr-empty-icon">👥</div>
            <div className="cr-empty-title">Пока нет групп</div>
            <div className="cr-empty-sub">Создайте первую групп-чат или broadcast-канал</div>
            <button className="cr-btn-primary" style={{ marginTop: 16 }} onClick={() => setShowCreate(true)}>
              Создать первую группу
            </button>
          </div>
        )}
        {!loading && groups.map((g) => (
          <div key={g.id} className="cr-group">
            <div className="cr-group-head">
              <div>
                <div className="cr-group-name">
                  {g.type === 'broadcast' ? '📢 ' : '👥 '}{g.name}
                </div>
                <div className="cr-group-meta">{g.members_count} участников · {g.type === 'broadcast' ? 'канал (только админ пишет)' : 'групповой чат'}</div>
              </div>
              {g.is_admin && (
                <button className="cr-btn-ghost" onClick={() => setShowAdd(g)} title="Добавить участников">+</button>
              )}
            </div>
            <div className="cr-members">
              {g.members.map((m) => (
                <div key={m.id} className={'cr-member ' + (m.member_role === 'admin' ? 'is-admin' : '')}>
                  <span className="cr-member-name">{m.name}</span>
                  {m.member_role === 'admin' && <span className="cr-tag">admin</span>}
                  {g.is_admin && m.member_role !== 'admin' && (
                    <button className="cr-member-del" onClick={() => removeMember(g, m.id)} title="Удалить">×</button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      {showCreate && <CreateGroupModal contacts={contacts} onClose={() => setShowCreate(false)} onSubmit={createGroup} />}
      {showAdd && <AddMembersModal room={showAdd} contacts={contacts} onClose={() => setShowAdd(null)} onSubmit={(ids) => addMembers(showAdd, ids)} />}
    </div>
  )
}

function CreateGroupModal({ contacts, onClose, onSubmit }) {
  const [name, setName] = useState('')
  const [broadcast, setBroadcast] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return contacts.groups
    return contacts.groups
      .map((g) => ({ ...g, users: g.users.filter((u) => (u.name || '').toLowerCase().includes(q)) }))
      .filter((g) => g.users.length > 0)
  }, [contacts.groups, search])

  function toggle(id) {
    const s = new Set(selected)
    if (s.has(id)) s.delete(id); else s.add(id)
    setSelected(s)
  }

  return (
    <div className="cr-modal-bg" onClick={onClose}>
      <div className="cr-modal" onClick={(e) => e.stopPropagation()}>
        <header className="cr-modal-head">
          <div className="cr-modal-title">{broadcast ? 'Новый broadcast-канал' : 'Новая группа'}</div>
          <button className="cr-icon-btn" onClick={onClose}>×</button>
        </header>
        <div className="cr-modal-body">
          <input className="cr-input" placeholder="Название группы" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <label className="cr-bcast">
            <input type="checkbox" checked={broadcast} onChange={(e) => setBroadcast(e.target.checked)} />
            Broadcast-канал — только админ может писать, остальные читают
          </label>
          <input className="cr-input cr-search" placeholder="Поиск участников…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="cr-contacts">
            {filtered.map((g) => (
              <div key={g.clinic_id || g.label}>
                <div className="cr-clinic-label">{g.label}</div>
                {g.users.map((u) => (
                  <label key={u.id} className={'cr-pick ' + (selected.has(u.id) ? 'is-picked' : '')}>
                    <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggle(u.id)} />
                    <span>{u.name}</span>
                    <span className="cr-role">{u.role}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
          <div className="cr-summary">{selected.size} выбрано</div>
        </div>
        <footer className="cr-modal-foot">
          <button className="cr-btn-ghost" onClick={onClose}>Отмена</button>
          <button className="cr-btn-primary" disabled={!name.trim() || selected.size === 0}
            onClick={() => onSubmit({ name: name.trim(), member_ids: Array.from(selected), broadcast })}>
            Создать
          </button>
        </footer>
      </div>
    </div>
  )
}

function AddMembersModal({ room, contacts, onClose, onSubmit }) {
  const existingIds = new Set(room.members.map((m) => m.id))
  const [selected, setSelected] = useState(new Set())
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return contacts.groups
      .map((g) => ({ ...g, users: g.users.filter((u) => !existingIds.has(u.id) && (!q || (u.name || '').toLowerCase().includes(q))) }))
      .filter((g) => g.users.length > 0)
  }, [contacts.groups, search])

  function toggle(id) {
    const s = new Set(selected)
    if (s.has(id)) s.delete(id); else s.add(id)
    setSelected(s)
  }

  return (
    <div className="cr-modal-bg" onClick={onClose}>
      <div className="cr-modal" onClick={(e) => e.stopPropagation()}>
        <header className="cr-modal-head">
          <div className="cr-modal-title">Добавить в «{room.name}»</div>
          <button className="cr-icon-btn" onClick={onClose}>×</button>
        </header>
        <div className="cr-modal-body">
          <input className="cr-input cr-search" placeholder="Поиск…" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
          <div className="cr-contacts">
            {filtered.map((g) => (
              <div key={g.clinic_id || g.label}>
                <div className="cr-clinic-label">{g.label}</div>
                {g.users.map((u) => (
                  <label key={u.id} className={'cr-pick ' + (selected.has(u.id) ? 'is-picked' : '')}>
                    <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggle(u.id)} />
                    <span>{u.name}</span>
                    <span className="cr-role">{u.role}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        </div>
        <footer className="cr-modal-foot">
          <button className="cr-btn-ghost" onClick={onClose}>Отмена</button>
          <button className="cr-btn-primary" disabled={selected.size === 0}
            onClick={() => onSubmit(Array.from(selected))}>
            Добавить {selected.size}
          </button>
        </footer>
      </div>
    </div>
  )
}

const CR_CSS = `
.cr-root {
  --cr-bg: oklch(0.99 0.005 250);
  --cr-surface: #ffffff;
  --cr-border: oklch(0.92 0.005 250);
  --cr-fg: oklch(0.2 0.02 250);
  --cr-fg-2: oklch(0.45 0.02 250);
  --cr-fg-3: oklch(0.6 0.015 250);
  --cr-accent: oklch(0.55 0.18 230);
  --cr-accent-soft: oklch(0.95 0.04 230);
  background: var(--cr-bg);
  min-height: 100vh;
  padding: 24px 16px;
  font-family: "Golos Text", "Inter", system-ui, sans-serif;
  color: var(--cr-fg);
}
.cr-head { max-width: 1080px; margin: 0 auto 24px; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.cr-title { font-size: 24px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 4px; }
.cr-sub { font-size: 14px; color: var(--cr-fg-2); margin: 0; }
.cr-grid { max-width: 1080px; margin: 0 auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
.cr-loading { padding: 40px; text-align: center; color: var(--cr-fg-3); grid-column: 1/-1; }
.cr-empty { grid-column: 1/-1; padding: 60px; text-align: center; background: var(--cr-surface); border: 1px solid var(--cr-border); border-radius: 16px; }
.cr-empty-icon { font-size: 48px; margin-bottom: 12px; opacity: 0.5; }
.cr-empty-title { font-size: 18px; font-weight: 600; margin-bottom: 4px; }
.cr-empty-sub { font-size: 14px; color: var(--cr-fg-3); }
.cr-group {
  background: var(--cr-surface);
  border: 1px solid var(--cr-border);
  border-radius: 14px;
  padding: 16px;
  box-shadow: 0 2px 8px -2px oklch(0.2 0.02 250 / 0.04);
}
.cr-group-head { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 12px; }
.cr-group-name { font-size: 15px; font-weight: 600; }
.cr-group-meta { font-size: 12px; color: var(--cr-fg-3); margin-top: 2px; }
.cr-members { display: flex; flex-direction: column; gap: 4px; max-height: 240px; overflow-y: auto; }
.cr-member {
  display: flex; align-items: center; gap: 8px; padding: 6px 8px;
  border-radius: 8px; font-size: 13px;
}
.cr-member.is-admin { background: var(--cr-accent-soft); }
.cr-member-name { flex: 1; }
.cr-tag {
  padding: 1px 6px; border-radius: 4px;
  background: var(--cr-accent); color: white;
  font-size: 10px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
}
.cr-member-del { background: transparent; border: none; color: var(--cr-fg-3); cursor: pointer; font-size: 16px; padding: 0 4px; }
.cr-member-del:hover { color: oklch(0.55 0.2 25); }
.cr-toast {
  background: oklch(0.65 0.18 145); color: white; padding: 8px 14px; border-radius: 10px;
  font-size: 13px; font-weight: 600;
  position: fixed; top: 16px; right: 16px; z-index: 200;
}

.cr-btn-primary {
  padding: 9px 16px; background: var(--cr-accent); color: white;
  border: none; border-radius: 10px; font: inherit; font-size: 14px; font-weight: 600;
  cursor: pointer; transition: background 0.15s;
}
.cr-btn-primary:hover:not(:disabled) { background: color-mix(in oklch, var(--cr-accent) 90%, black); }
.cr-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.cr-btn-ghost {
  padding: 9px 16px; background: transparent; color: var(--cr-fg-2);
  border: 1px solid var(--cr-border); border-radius: 10px; font: inherit; font-size: 14px; cursor: pointer;
}
.cr-btn-ghost:hover { background: var(--cr-bg); }
.cr-icon-btn { background: transparent; border: none; font-size: 22px; cursor: pointer; color: var(--cr-fg-3); }
.cr-modal-bg { position: fixed; inset: 0; background: oklch(0.2 0.02 250 / 0.4); backdrop-filter: blur(4px); display: grid; place-items: center; z-index: 100; }
.cr-modal {
  background: var(--cr-surface); border-radius: 16px; width: min(560px, 92vw); max-height: 85vh;
  display: flex; flex-direction: column;
  box-shadow: 0 20px 60px -20px oklch(0.2 0.02 250 / 0.4);
}
.cr-modal-head { display: flex; justify-content: space-between; align-items: center; padding: 18px 22px 8px; }
.cr-modal-title { font-size: 18px; font-weight: 600; }
.cr-modal-body { flex: 1; padding: 8px 22px 16px; overflow-y: auto; }
.cr-modal-foot { padding: 14px 22px; display: flex; gap: 8px; justify-content: flex-end; border-top: 1px solid var(--cr-border); }
.cr-input {
  width: 100%; padding: 10px 14px;
  border: 1px solid var(--cr-border); border-radius: 12px;
  font: inherit; font-size: 14px; background: var(--cr-bg);
  margin: 8px 0; outline: none;
}
.cr-input:focus { border-color: var(--cr-accent); }
.cr-bcast { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; color: var(--cr-fg-2); margin: 8px 0; padding: 8px 12px; background: var(--cr-bg); border-radius: 10px; cursor: pointer; }
.cr-search { margin-top: 16px; }
.cr-contacts { max-height: 320px; overflow-y: auto; margin-top: 8px; }
.cr-clinic-label { font-size: 11px; font-weight: 600; color: var(--cr-fg-3); text-transform: uppercase; letter-spacing: 0.05em; padding: 8px 4px 4px; }
.cr-pick {
  display: flex; align-items: center; gap: 10px; padding: 8px 12px; cursor: pointer;
  border-radius: 10px; transition: background 0.1s; font-size: 13.5px;
}
.cr-pick:hover { background: var(--cr-bg); }
.cr-pick.is-picked { background: var(--cr-accent-soft); }
.cr-role { font-size: 11px; color: var(--cr-fg-3); margin-left: auto; }
.cr-summary { font-size: 12px; color: var(--cr-fg-3); padding: 8px 4px 0; }
`
