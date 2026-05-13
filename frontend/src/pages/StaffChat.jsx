/**
 * ========================================
 * БЛОК: StaffChat — страница чата сотрудник↔сотрудник
 * ========================================
 * Премиум двухпанельный layout:
 *   ┌─ Sidebar ─┐ ┌─ Conversation ─────────────────┐
 *   │  Rooms    │ │  Header (peer name + status)   │
 *   │  Search   │ │  Messages thread (virtualized) │
 *   │  +Chat    │ │  Composer (text + 50MB files)  │
 *   └───────────┘ └────────────────────────────────┘
 *
 * Real-time через WebSocket: новые сообщения, typing, presence.
 * Файлы хранятся 48 часов (предупреждение в composer).
 * ========================================
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import api from '../api'
import { API_BASE, SLUG } from '../config'

// Палитра аватаров — детерминированно генерируется из user_id
const AVATAR_COLORS = [
  'oklch(0.65 0.18 25)',   // red-orange
  'oklch(0.62 0.18 280)',  // purple
  'oklch(0.6 0.18 200)',   // cyan
  'oklch(0.65 0.18 145)',  // green
  'oklch(0.65 0.18 60)',   // amber
  'oklch(0.62 0.18 320)',  // pink
  'oklch(0.6 0.18 240)',   // blue
  'oklch(0.6 0.16 100)',   // olive
]

function avatarColor(id) {
  if (!id) return AVATAR_COLORS[0]
  let h = 0
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h) + id.charCodeAt(i)
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}

function initials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return parts[0].slice(0, 2).toUpperCase()
}

function Avatar({ name, id, size = 36, online = false }) {
  return (
    <div
      style={{
        width: size, height: size,
        borderRadius: '50%',
        background: avatarColor(id),
        color: '#fff',
        display: 'grid', placeItems: 'center',
        fontWeight: 600, fontSize: size * 0.4,
        letterSpacing: '-0.02em',
        flexShrink: 0,
        position: 'relative',
        userSelect: 'none',
      }}
      title={name}
    >
      {initials(name)}
      {online && (
        <span style={{
          position: 'absolute', right: -1, bottom: -1,
          width: Math.max(10, size * 0.28), height: Math.max(10, size * 0.28),
          borderRadius: '50%',
          background: 'oklch(0.65 0.18 145)',
          border: '2px solid var(--sc-bg, #fff)',
          boxSizing: 'content-box',
        }} />
      )}
    </div>
  )
}

function formatTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  const diff = (now - d) / 86400000
  if (diff < 7) return d.toLocaleDateString('ru-RU', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

function formatBytes(n) {
  if (n < 1024) return n + ' Б'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' КБ'
  return (n / 1024 / 1024).toFixed(1) + ' МБ'
}

function isEmbedded() {
  try {
    const u = new URL(window.location.href)
    return u.searchParams.get('embed') === 'calls' || window.self !== window.top
  } catch { return false }
}

// ── Главный компонент ───────────────────────────────────────────────────────
export default function StaffChat() {
  const embed = isEmbedded()
  const [rooms, setRooms] = useState([])
  const [contacts, setContacts] = useState({ groups: [], total: 0 })
  const [activeRoomId, setActiveRoomId] = useState(null)
  const [messages, setMessages] = useState([])
  const [members, setMembers] = useState([])
  const [draft, setDraft] = useState('')
  const [showNewChat, setShowNewChat] = useState(false)
  const [searchContact, setSearchContact] = useState('')
  const [onlineUsers, setOnlineUsers] = useState(new Set())
  const [typingUsers, setTypingUsers] = useState({}) // {room_id: Set<user_id>}
  const [me, setMe] = useState(null)
  const [filePolicy, setFilePolicy] = useState({ max_size_mb: 50, ttl_hours: 48 })
  const [uploadingFile, setUploadingFile] = useState(null) // {progress, name}
  const wsRef = useRef(null)
  const wsRetryRef = useRef(0)
  const messagesEndRef = useRef(null)
  const composerRef = useRef(null)
  const typingTimers = useRef({})

  // ── Загрузка профиля + комнат + контактов ────────────────────────────────
  useEffect(() => {
    if (embed) document.documentElement.style.background = 'var(--sc-bg, #0f1115)'
    document.title = 'Чаты КлиникСеть'
    // Принимаем JWT из URL hash (Calls пробрасывает токен из electron-store).
    // Hash не уходит в логи сервера; сразу очищаем адресную строку для безопасности.
    try {
      if (window.location.hash && window.location.hash.length > 1) {
        const params = new URLSearchParams(window.location.hash.slice(1))
        const at = params.get('access_token')
        const rt = params.get('refresh_token')
        if (at) {
          // SLUG = '' для /staff-chat — пишем оба ключа на случай разных ролей
          localStorage.setItem('clinika_admin_token_' + SLUG, at)
          localStorage.setItem('clinika_token_' + SLUG, at)
          if (rt) {
            localStorage.setItem('clinika_admin_refresh_token_' + SLUG, rt)
            localStorage.setItem('clinika_refresh_token_' + SLUG, rt)
          }
          history.replaceState(null, '', window.location.pathname + window.location.search)
        }
      }
    } catch {}
    ;(async () => {
      try {
        const [meRes, roomsRes, contactsRes, polRes] = await Promise.all([
          api.get('/staff-chat/me'),
          api.get('/staff-chat/rooms'),
          api.get('/staff-chat/contacts'),
          api.get('/staff-chat/files/policy'),
        ])
        setMe(meRes.data)
        setRooms(roomsRes.data.rooms || [])
        setContacts(contactsRes.data)
        setFilePolicy(polRes.data)
      } catch (e) {
        console.error('staff-chat init failed:', e)
      }
    })()
  }, [embed])

  // ── WebSocket connection ─────────────────────────────────────────────────
  useEffect(() => {
    let alive = true
    function connect() {
      if (!alive) return
      const tokenKey = window.location.pathname.startsWith('/admin') ? 'clinika_admin_token_' + SLUG : 'clinika_token_' + SLUG
      const token = localStorage.getItem(tokenKey) || localStorage.getItem('clinika_admin_token_' + SLUG) || localStorage.getItem('clinika_token_' + SLUG)
      if (!token) return
      const wsProto = location.protocol === 'https:' ? 'wss' : 'ws'
      const url = `${wsProto}://${location.host}${API_BASE}/staff-chat/ws?token=${encodeURIComponent(token)}`
      const ws = new WebSocket(url)
      wsRef.current = ws
      ws.onopen = () => { wsRetryRef.current = 0 }
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data)
          handleWsEvent(msg)
        } catch {}
      }
      ws.onclose = () => {
        wsRef.current = null
        if (!alive) return
        const delay = Math.min(15000, 1000 * Math.pow(2, wsRetryRef.current++))
        setTimeout(connect, delay)
      }
      ws.onerror = () => { try { ws.close() } catch {} }
    }
    connect()
    return () => { alive = false; try { wsRef.current?.close() } catch {} }
  }, [])

  // ── Загрузка presence (кто сейчас онлайн) ───────────────────────────────
  useEffect(() => {
    let alive = true
    async function tick() {
      try {
        const { data } = await api.get('/staff-chat/presence')
        if (alive) setOnlineUsers(new Set(data.online || []))
      } catch {}
    }
    tick()
    const id = setInterval(tick, 30000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  // ── Обработка WS-событий ────────────────────────────────────────────────
  const handleWsEvent = useCallback((msg) => {
    if (msg.type === 'message:new') {
      const m = msg.data
      // Обновляем список комнат — last_message + порядок
      setRooms((prev) => {
        const idx = prev.findIndex((r) => r.id === m.room_id)
        if (idx < 0) {
          // Новая комната — перезагрузим список
          api.get('/staff-chat/rooms').then(({ data }) => setRooms(data.rooms || []))
          return prev
        }
        const updated = { ...prev[idx], last_message: m, last_message_at: m.created_at }
        if (m.room_id !== activeRoomId) updated.unread = (updated.unread || 0) + 1
        const arr = [updated, ...prev.filter((_, i) => i !== idx)]
        return arr
      })
      if (m.room_id === activeRoomId) {
        setMessages((prev) => prev.some((x) => x.id === m.id) ? prev : [...prev, m])
        scrollToBottom()
        // помечаем прочитанным
        api.post(`/staff-chat/rooms/${m.room_id}/read`).catch(() => {})
      }
    } else if (msg.type === 'message:deleted') {
      const { id, room_id } = msg.data
      if (room_id === activeRoomId) {
        setMessages((prev) => prev.map((x) => x.id === id ? { ...x, deleted_at: new Date().toISOString(), body: '' } : x))
      }
    } else if (msg.type === 'read') {
      // TODO: read receipts UI
    } else if (msg.type === 'typing') {
      const { room_id, user_id } = msg.data
      setTypingUsers((prev) => {
        const set = new Set(prev[room_id] || [])
        set.add(user_id)
        return { ...prev, [room_id]: set }
      })
      clearTimeout(typingTimers.current[`${room_id}:${user_id}`])
      typingTimers.current[`${room_id}:${user_id}`] = setTimeout(() => {
        setTypingUsers((prev) => {
          const set = new Set(prev[room_id] || [])
          set.delete(user_id)
          return { ...prev, [room_id]: set }
        })
      }, 3500)
    } else if (msg.type === 'presence') {
      const { user_id, online } = msg.data
      setOnlineUsers((prev) => {
        const s = new Set(prev)
        if (online) s.add(user_id); else s.delete(user_id)
        return s
      })
    }
  }, [activeRoomId])

  async function downloadAttachment(a) {
    try {
      const resp = await api.get(a.url, { responseType: 'blob' })
      const blob = new Blob([resp.data], { type: a.mime || 'application/octet-stream' })
      const objUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objUrl
      link.download = a.filename || 'file'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      setTimeout(() => URL.revokeObjectURL(objUrl), 1500)
    } catch (e) {
      alert('Не удалось скачать файл: ' + (e?.response?.status === 410 ? 'срок хранения истёк (48 ч)' : 'нет доступа или сервер недоступен'))
    }
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ block: 'end' })
    })
  }

  // ── Открытие комнаты ─────────────────────────────────────────────────────
  async function openRoom(roomId) {
    setActiveRoomId(roomId)
    setMessages([])
    setMembers([])
    try {
      const [{ data: details }, { data: msgs }] = await Promise.all([
        api.get(`/staff-chat/rooms/${roomId}`),
        api.get(`/staff-chat/rooms/${roomId}/messages`),
      ])
      setMembers(details.members || [])
      setMessages(msgs.messages || [])
      // Сбросить unread
      setRooms((prev) => prev.map((r) => r.id === roomId ? { ...r, unread: 0 } : r))
      api.post(`/staff-chat/rooms/${roomId}/read`).catch(() => {})
      scrollToBottom()
      composerRef.current?.focus()
    } catch (e) {
      console.error(e)
    }
  }

  // ── Старт нового direct-чата ─────────────────────────────────────────────
  async function startDirectChat(userId) {
    try {
      const { data: room } = await api.post('/staff-chat/rooms/direct', { user_id: userId })
      setShowNewChat(false)
      setSearchContact('')
      // Обновим список комнат и откроем
      setRooms((prev) => {
        const exists = prev.some((r) => r.id === room.id)
        return exists ? prev : [room, ...prev]
      })
      await openRoom(room.id)
    } catch (e) {
      alert('Не удалось открыть чат: ' + (e?.response?.data?.detail || e.message))
    }
  }

  // ── Отправка сообщения ───────────────────────────────────────────────────
  async function sendMessage(attachments = null) {
    if (!activeRoomId) return
    const body = draft.trim()
    if (!body && !attachments) return
    try {
      const { data: msg } = await api.post(`/staff-chat/rooms/${activeRoomId}/messages`, {
        body, attachments,
      })
      setDraft('')
      // Сообщение вернётся также через WS, но для мгновенного отклика — добавляем сразу
      setMessages((prev) => prev.some((x) => x.id === msg.id) ? prev : [...prev, msg])
      scrollToBottom()
      composerRef.current?.focus()
    } catch (e) {
      alert('Не удалось отправить: ' + (e?.response?.data?.detail || e.message))
    }
  }

  // ── Загрузка файла + отправка ────────────────────────────────────────────
  async function uploadFile(file) {
    if (!activeRoomId || !file) return
    if (file.size > filePolicy.max_size_mb * 1024 * 1024) {
      alert(`Файл больше ${filePolicy.max_size_mb} МБ`)
      return
    }
    setUploadingFile({ name: file.name, progress: 0 })
    try {
      const form = new FormData()
      form.append('file', file)
      const { data: meta } = await api.post(`/staff-chat/rooms/${activeRoomId}/files`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          if (e.total) setUploadingFile({ name: file.name, progress: Math.round(e.loaded / e.total * 100) })
        },
      })
      await sendMessage([{
        id: meta.id, filename: meta.filename, mime: meta.mime,
        size: meta.size, url: meta.url, expires_at: meta.expires_at,
      }])
    } catch (e) {
      alert('Ошибка загрузки: ' + (e?.response?.data?.detail || e.message))
    } finally {
      setUploadingFile(null)
    }
  }

  // ── Typing indicator ─────────────────────────────────────────────────────
  function sendTyping() {
    if (!activeRoomId || !wsRef.current || wsRef.current.readyState !== 1) return
    try { wsRef.current.send(JSON.stringify({ type: 'typing', room_id: activeRoomId })) } catch {}
  }

  // ── Memo: активная комната + участники ──────────────────────────────────
  const activeRoom = useMemo(() => rooms.find((r) => r.id === activeRoomId), [rooms, activeRoomId])
  const peer = useMemo(() => {
    if (!activeRoom || activeRoom.type !== 'direct') return null
    return members.find((m) => me && m.id !== me.id) || null
  }, [activeRoom, members, me])
  const peerOnline = peer ? onlineUsers.has(peer.id) : false
  const activeTyping = useMemo(() => {
    if (!activeRoomId) return null
    const set = typingUsers[activeRoomId]
    if (!set || !set.size) return null
    return Array.from(set).map((uid) => members.find((m) => m.id === uid)?.name || 'Кто-то').slice(0, 2).join(', ')
  }, [activeRoomId, typingUsers, members])

  // ── Фильтр контактов ────────────────────────────────────────────────────
  const filteredGroups = useMemo(() => {
    const q = searchContact.toLowerCase().trim()
    if (!q) return contacts.groups
    return contacts.groups
      .map((g) => ({ ...g, users: g.users.filter((u) => (u.name || '').toLowerCase().includes(q)) }))
      .filter((g) => g.users.length > 0)
  }, [contacts.groups, searchContact])

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className={'sc-root' + (embed ? ' sc-embed' : '')}>
      <style>{STAFF_CHAT_CSS}</style>

      {/* SIDEBAR */}
      <aside className="sc-sidebar">
        <header className="sc-side-header">
          <div className="sc-side-title">Чаты</div>
          <button className="sc-icon-btn" title="Новый чат" onClick={() => setShowNewChat(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
          </button>
        </header>

        <div className="sc-rooms">
          {rooms.length === 0 && (
            <div className="sc-empty">
              <div className="sc-empty-icon">💬</div>
              <div className="sc-empty-title">Нет чатов</div>
              <div className="sc-empty-sub">Начните диалог с сотрудником сети — кнопка «+» вверху.</div>
            </div>
          )}
          {rooms.map((r) => {
            const isActive = r.id === activeRoomId
            const peerId = r.type === 'direct' ? r.members.find((m) => me && m.id !== me.id)?.id : null
            const isOnline = peerId ? onlineUsers.has(peerId) : false
            return (
              <button
                key={r.id}
                onClick={() => openRoom(r.id)}
                className={'sc-room' + (isActive ? ' is-active' : '')}
              >
                <Avatar name={r.name} id={peerId || r.id} size={42} online={isOnline} />
                <div className="sc-room-body">
                  <div className="sc-room-row">
                    <span className="sc-room-name">{r.name || 'Без названия'}</span>
                    <span className="sc-room-time">{formatTime(r.last_message_at)}</span>
                  </div>
                  <div className="sc-room-row">
                    <span className="sc-room-preview">
                      {r.last_message
                        ? (r.last_message.deleted_at ? <em>удалено</em> :
                            (r.last_message.body || (r.last_message.attachments?.length ? '📎 файл' : '')))
                        : <em style={{ color: 'var(--sc-fg-3)' }}>Нет сообщений</em>}
                    </span>
                    {r.unread > 0 && <span className="sc-unread">{r.unread > 99 ? '99+' : r.unread}</span>}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </aside>

      {/* CONVERSATION */}
      <main className="sc-conv">
        {!activeRoom ? (
          <div className="sc-conv-empty">
            <div className="sc-conv-empty-art">
              <svg width="120" height="120" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 11.5a8.4 8.4 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.4 8.4 0 01-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 1116.1-3.8z"/>
              </svg>
            </div>
            <div className="sc-conv-empty-title">Выберите чат</div>
            <div className="sc-conv-empty-sub">Сообщения с коллегами вашей сети — внутренние, защищённые, без сторонних мессенджеров.</div>
          </div>
        ) : (
          <>
            <header className="sc-conv-header">
              <Avatar name={activeRoom.name} id={peer?.id || activeRoom.id} size={40} online={peerOnline} />
              <div className="sc-conv-head-body">
                <div className="sc-conv-head-name">{activeRoom.name}</div>
                <div className="sc-conv-head-sub">
                  {activeTyping
                    ? <span style={{ color: 'oklch(0.62 0.18 200)' }}>{activeTyping} печатает…</span>
                    : (peer ? (peerOnline ? <span style={{ color: 'oklch(0.55 0.18 145)' }}>● в сети</span> : 'был(а) недавно') : `Участников: ${members.length}`)}
                </div>
              </div>
            </header>

            <div className="sc-messages">
              {messages.map((m, idx) => {
                const mine = me && m.sender_id === me.id
                const sender = members.find((x) => x.id === m.sender_id)
                const showSender = !mine && (idx === 0 || messages[idx - 1].sender_id !== m.sender_id)
                return (
                  <div key={m.id} className={'sc-msg-row' + (mine ? ' is-mine' : '')}>
                    {!mine && (
                      <div className="sc-msg-avatar">
                        {showSender ? <Avatar name={sender?.name || '?'} id={m.sender_id} size={32} /> : <div style={{ width: 32 }} />}
                      </div>
                    )}
                    <div className={'sc-msg-bubble' + (mine ? ' is-mine' : '')}>
                      {showSender && !mine && <div className="sc-msg-sender">{sender?.name || 'Сотрудник'}</div>}
                      {m.deleted_at ? (
                        <div className="sc-msg-deleted"><em>сообщение удалено</em></div>
                      ) : (
                        <>
                          {m.body && <div className="sc-msg-body">{m.body}</div>}
                          {m.attachments?.map((a) => (
                            <a key={a.id || a.url} href={a.url} onClick={(e) => { e.preventDefault(); downloadAttachment(a) }} className="sc-attach" role="button" title="Кликните чтобы скачать файл на ПК">
                              <span className="sc-attach-icon">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/>
                                </svg>
                              </span>
                              <span className="sc-attach-meta">
                                <span className="sc-attach-name">{a.filename}</span>
                                <span className="sc-attach-size">{formatBytes(a.size)} · TTL 48ч</span>
                              </span>
                              <span className="sc-attach-dl" aria-hidden="true" title="Скачать">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                                  <polyline points="7 10 12 15 17 10"/>
                                  <line x1="12" y1="15" x2="12" y2="3"/>
                                </svg>
                              </span>
                            </a>
                          ))}
                        </>
                      )}
                      <div className="sc-msg-time">{formatTime(m.created_at)}</div>
                    </div>
                  </div>
                )
              })}
              <div ref={messagesEndRef} />
            </div>

            <footer className="sc-composer">
              {uploadingFile && (
                <div className="sc-upload-bar">
                  Загрузка {uploadingFile.name} — {uploadingFile.progress}%
                </div>
              )}
              <div className="sc-composer-row">
                <label className="sc-icon-btn sc-attach-btn" title={`Прикрепить файл (до ${filePolicy.max_size_mb} МБ, хранится ${filePolicy.ttl_hours} часов)`}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.4 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
                  </svg>
                  <input
                    type="file"
                    style={{ display: 'none' }}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = '' }}
                  />
                </label>
                <textarea
                  ref={composerRef}
                  className="sc-input"
                  rows={1}
                  placeholder="Написать сообщение…"
                  value={draft}
                  onChange={(e) => { setDraft(e.target.value); sendTyping() }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      sendMessage()
                    }
                  }}
                />
                <button
                  className="sc-send-btn"
                  onClick={() => sendMessage()}
                  disabled={!draft.trim()}
                  title="Отправить (Enter)"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>
                  </svg>
                </button>
              </div>
              <div className="sc-composer-hint">
                Enter — отправить, Shift+Enter — новая строка · Файлы до {filePolicy.max_size_mb} МБ, хранятся {filePolicy.ttl_hours} часов
              </div>
            </footer>
          </>
        )}
      </main>

      {/* NEW CHAT MODAL */}
      {showNewChat && (
        <div className="sc-modal-backdrop" onClick={() => setShowNewChat(false)}>
          <div className="sc-modal" onClick={(e) => e.stopPropagation()}>
            <header className="sc-modal-head">
              <div className="sc-modal-title">Новый чат</div>
              <button className="sc-icon-btn" onClick={() => setShowNewChat(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>
              </button>
            </header>
            <input
              className="sc-input sc-search"
              placeholder="Поиск по сотрудникам…"
              value={searchContact}
              onChange={(e) => setSearchContact(e.target.value)}
              autoFocus
            />
            <div className="sc-modal-body">
              {filteredGroups.length === 0 && (
                <div className="sc-empty" style={{ padding: '24px 0' }}>
                  <div className="sc-empty-sub">Никого не найдено</div>
                </div>
              )}
              {filteredGroups.map((g) => (
                <div key={g.clinic_id || g.label} className="sc-contact-group">
                  <div className="sc-contact-group-label">{g.label}</div>
                  {g.users.map((u) => (
                    <button key={u.id} className="sc-contact-row" onClick={() => startDirectChat(u.id)}>
                      <Avatar name={u.name} id={u.id} size={36} online={onlineUsers.has(u.id)} />
                      <div className="sc-contact-body">
                        <div className="sc-contact-name">{u.name}</div>
                        <div className="sc-contact-role">{ROLE_LABELS[u.role] || u.role}</div>
                      </div>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const ROLE_LABELS = {
  super_admin: 'Платформа',
  franchise_owner: 'Владелец сети',
  admin: 'Управляющий клиники',
  manager: 'Управляющий',
  doctor: 'Врач',
  reg: 'Регистратор',
  nurse: 'Медсестра',
  recruiter: 'Рекрутер',
  partner_doctor: 'Партнёрский врач',
  visiting_doctor: 'Приглашённый врач',
}

const STAFF_CHAT_CSS = `
.sc-root {
  --sc-bg: #f5f6f8;
  --sc-bg-alt: #ffffff;
  --sc-surface: #ffffff;
  --sc-border: oklch(0.92 0.005 250);
  --sc-fg: oklch(0.2 0.02 250);
  --sc-fg-2: oklch(0.45 0.02 250);
  --sc-fg-3: oklch(0.6 0.015 250);
  --sc-accent: oklch(0.55 0.18 230);
  --sc-accent-soft: oklch(0.95 0.04 230);
  --sc-mine-bg: oklch(0.95 0.05 230);
  --sc-mine-fg: oklch(0.25 0.1 230);
  --sc-peer-bg: oklch(0.97 0.002 250);
  --sc-shadow-md: 0 4px 16px -8px oklch(0.2 0.02 250 / 0.15);
  display: grid;
  grid-template-columns: 360px 1fr;
  height: 100vh;
  background: var(--sc-bg);
  color: var(--sc-fg);
  font-family: "Golos Text", "Inter", system-ui, sans-serif;
  overflow: hidden;
}
.sc-root.sc-embed { height: 100vh; }

@media (prefers-color-scheme: dark) {
  .sc-root {
    --sc-bg: oklch(0.16 0.01 250);
    --sc-bg-alt: oklch(0.19 0.012 250);
    --sc-surface: oklch(0.21 0.012 250);
    --sc-border: oklch(0.28 0.012 250);
    --sc-fg: oklch(0.95 0.01 250);
    --sc-fg-2: oklch(0.75 0.012 250);
    --sc-fg-3: oklch(0.6 0.015 250);
    --sc-accent: oklch(0.7 0.18 230);
    --sc-accent-soft: oklch(0.3 0.05 230);
    --sc-mine-bg: oklch(0.32 0.08 230);
    --sc-mine-fg: oklch(0.95 0.03 230);
    --sc-peer-bg: oklch(0.24 0.01 250);
  }
}

/* SIDEBAR */
.sc-sidebar {
  background: var(--sc-bg-alt);
  border-right: 1px solid var(--sc-border);
  display: flex; flex-direction: column;
  overflow: hidden;
}
.sc-side-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 20px 14px;
  border-bottom: 1px solid var(--sc-border);
}
.sc-side-title { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; }
.sc-icon-btn {
  width: 36px; height: 36px; border-radius: 10px;
  background: transparent; border: none; cursor: pointer;
  display: grid; place-items: center;
  color: var(--sc-fg-2);
  transition: background 0.15s, color 0.15s;
}
.sc-icon-btn:hover { background: var(--sc-accent-soft); color: var(--sc-accent); }
.sc-rooms { flex: 1; overflow-y: auto; padding: 8px 8px 16px; }
.sc-room {
  display: flex; gap: 12px;
  width: 100%;
  padding: 10px 12px;
  background: transparent; border: none; cursor: pointer;
  border-radius: 12px;
  text-align: left;
  transition: background 0.15s;
  color: inherit;
}
.sc-room:hover { background: var(--sc-bg); }
.sc-room.is-active { background: var(--sc-accent-soft); }
.sc-room-body { flex: 1; min-width: 0; }
.sc-room-row { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
.sc-room-name { font-weight: 600; font-size: 15px; color: var(--sc-fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sc-room-time { font-size: 11px; color: var(--sc-fg-3); flex-shrink: 0; }
.sc-room-preview { font-size: 13px; color: var(--sc-fg-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.sc-unread {
  background: var(--sc-accent); color: white;
  font-size: 11px; font-weight: 700; padding: 2px 7px; border-radius: 999px;
  min-width: 20px; text-align: center;
}

.sc-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 48px 24px; text-align: center; color: var(--sc-fg-3);
}
.sc-empty-icon { font-size: 40px; margin-bottom: 12px; opacity: 0.6; }
.sc-empty-title { font-weight: 600; font-size: 15px; color: var(--sc-fg-2); margin-bottom: 4px; }
.sc-empty-sub { font-size: 13px; line-height: 1.5; }

/* CONVERSATION */
.sc-conv { display: flex; flex-direction: column; background: var(--sc-bg); overflow: hidden; }
.sc-conv-empty {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 32px; text-align: center;
}
.sc-conv-empty-art { color: var(--sc-fg-3); opacity: 0.3; margin-bottom: 24px; }
.sc-conv-empty-title { font-size: 22px; font-weight: 600; margin-bottom: 8px; color: var(--sc-fg); }
.sc-conv-empty-sub { font-size: 14px; color: var(--sc-fg-2); max-width: 400px; line-height: 1.55; }

.sc-conv-header {
  display: flex; align-items: center; gap: 14px;
  padding: 14px 24px;
  background: var(--sc-bg-alt);
  border-bottom: 1px solid var(--sc-border);
  flex-shrink: 0;
}
.sc-conv-head-body { flex: 1; min-width: 0; }
.sc-conv-head-name { font-weight: 600; font-size: 16px; color: var(--sc-fg); }
.sc-conv-head-sub { font-size: 12.5px; color: var(--sc-fg-3); margin-top: 1px; }

.sc-messages { flex: 1; overflow-y: auto; padding: 24px; display: flex; flex-direction: column; gap: 4px; }
.sc-msg-row { display: flex; gap: 8px; align-items: flex-end; }
.sc-msg-row.is-mine { justify-content: flex-end; }
.sc-msg-avatar { width: 32px; flex-shrink: 0; }
.sc-msg-bubble {
  max-width: 62%;
  padding: 9px 13px 8px;
  border-radius: 16px;
  background: var(--sc-peer-bg);
  color: var(--sc-fg);
  font-size: 14.5px;
  line-height: 1.45;
  border-bottom-left-radius: 4px;
  position: relative;
  word-wrap: break-word;
  word-break: break-word;
  box-shadow: 0 1px 1px oklch(0.2 0.02 250 / 0.06);
}
.sc-msg-bubble.is-mine {
  background: var(--sc-mine-bg);
  color: var(--sc-mine-fg);
  border-bottom-right-radius: 4px;
  border-bottom-left-radius: 16px;
}
.sc-msg-sender { font-size: 12px; font-weight: 600; color: var(--sc-accent); margin-bottom: 3px; }
.sc-msg-body { white-space: pre-wrap; }
.sc-msg-time {
  font-size: 10.5px; color: var(--sc-fg-3);
  margin-top: 3px; text-align: right;
  opacity: 0.85;
}
.sc-msg-deleted em { color: var(--sc-fg-3); font-style: italic; }

.sc-attach {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px;
  background: var(--sc-bg-alt);
  border: 1px solid var(--sc-border);
  border-radius: 10px;
  margin-top: 4px;
  text-decoration: none; color: inherit;
  transition: border-color 0.15s, transform 0.15s;
}
.sc-attach:hover { border-color: var(--sc-accent); transform: translateY(-1px); }
.sc-attach-icon {
  width: 32px; height: 32px; border-radius: 8px;
  background: var(--sc-accent-soft); color: var(--sc-accent);
  display: grid; place-items: center;
  flex-shrink: 0;
}
.sc-attach-meta { display: flex; flex-direction: column; min-width: 0; }
.sc-attach-name { font-size: 13.5px; font-weight: 500; color: var(--sc-fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px; }
.sc-attach-size { font-size: 11px; color: var(--sc-fg-3); margin-top: 1px; }
.sc-attach-dl {
  margin-left: auto;
  width: 32px; height: 32px; border-radius: 8px;
  background: var(--sc-accent); color: white;
  display: grid; place-items: center;
  flex-shrink: 0;
  transition: transform 0.15s, background 0.15s;
}
.sc-attach:hover .sc-attach-dl { transform: scale(1.08); background: color-mix(in oklch, var(--sc-accent) 90%, black); }
.sc-attach { cursor: pointer; }

/* COMPOSER */
.sc-composer {
  background: var(--sc-bg-alt);
  border-top: 1px solid var(--sc-border);
  padding: 12px 20px 14px;
  flex-shrink: 0;
}
.sc-upload-bar {
  background: var(--sc-accent-soft); color: var(--sc-accent);
  font-size: 12.5px; padding: 6px 12px; border-radius: 8px; margin-bottom: 8px;
}
.sc-composer-row { display: flex; gap: 8px; align-items: flex-end; }
.sc-attach-btn { width: 38px; height: 38px; }
.sc-input {
  flex: 1;
  resize: none;
  min-height: 38px; max-height: 160px;
  padding: 9px 14px;
  border: 1px solid var(--sc-border);
  border-radius: 19px;
  background: var(--sc-surface);
  color: var(--sc-fg);
  font: inherit; font-size: 14.5px; line-height: 1.45;
  outline: none;
  transition: border-color 0.15s;
}
.sc-input:focus { border-color: var(--sc-accent); }
.sc-search { border-radius: 12px; margin: 0 20px 8px; }
.sc-send-btn {
  width: 40px; height: 40px; border-radius: 50%;
  background: var(--sc-accent); color: white;
  border: none; cursor: pointer;
  display: grid; place-items: center;
  transition: opacity 0.15s, transform 0.15s;
}
.sc-send-btn:hover:not(:disabled) { transform: scale(1.05); }
.sc-send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.sc-composer-hint { font-size: 11px; color: var(--sc-fg-3); margin-top: 8px; text-align: center; }

/* MODAL */
.sc-modal-backdrop {
  position: fixed; inset: 0;
  background: oklch(0.2 0.02 250 / 0.35);
  backdrop-filter: blur(4px);
  display: grid; place-items: center;
  z-index: 1000;
  animation: scFadeIn 0.15s ease;
}
@keyframes scFadeIn { from { opacity: 0 } to { opacity: 1 } }
.sc-modal {
  background: var(--sc-bg-alt);
  border-radius: 16px;
  width: min(520px, 92vw);
  max-height: 80vh;
  display: flex; flex-direction: column;
  box-shadow: 0 20px 60px -20px oklch(0.2 0.02 250 / 0.4);
  animation: scSlideUp 0.2s ease;
}
@keyframes scSlideUp { from { transform: translateY(20px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
.sc-modal-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px 8px; }
.sc-modal-title { font-size: 18px; font-weight: 600; }
.sc-modal-body { flex: 1; overflow-y: auto; padding: 8px 12px 16px; }
.sc-contact-group { margin-bottom: 12px; }
.sc-contact-group-label {
  padding: 8px 14px 4px; font-size: 11.5px; font-weight: 600;
  color: var(--sc-fg-3); text-transform: uppercase; letter-spacing: 0.05em;
}
.sc-contact-row {
  display: flex; gap: 12px; align-items: center;
  width: 100%; padding: 8px 14px;
  background: transparent; border: none; cursor: pointer;
  text-align: left; border-radius: 10px; color: inherit;
  transition: background 0.15s;
}
.sc-contact-row:hover { background: var(--sc-bg); }
.sc-contact-body { flex: 1; min-width: 0; }
.sc-contact-name { font-size: 14.5px; font-weight: 500; color: var(--sc-fg); }
.sc-contact-role { font-size: 12px; color: var(--sc-fg-3); margin-top: 1px; }

/* Mobile */
@media (max-width: 760px) {
  .sc-root { grid-template-columns: 1fr; }
  .sc-root:has(.sc-conv-header) .sc-sidebar { display: none; }
}
`
