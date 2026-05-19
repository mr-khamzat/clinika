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
import CreateChannelModal from '../components/staff/CreateChannelModal'
import ChannelSettingsModal from '../components/staff/ChannelSettingsModal'
import PinnedMessagesModal from '../components/staff/PinnedMessagesModal'
import MentionAutocomplete from '../components/staff/MentionAutocomplete'
import CreatePollModal from '../components/staff/CreatePollModal'
import GlobalSearchBox from '../components/staff/GlobalSearchBox'

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
  // Вкладка сайдбара: 'chats' — список комнат, 'contacts' — все сотрудники для быстрого DM
  const [sidebarTab, setSidebarTab] = useState('chats')
  const [contactSearch, setContactSearch] = useState('')
  const [searchContact, setSearchContact] = useState('')
  const [collapsedContactGroups, setCollapsedContactGroups] = useState(() => new Set())
  const [plusMenuOpen, setPlusMenuOpen] = useState(false)
  const [createGroupOpen, setCreateGroupOpen] = useState(false)
  const [createBroadcastOpen, setCreateBroadcastOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [convMenuOpen, setConvMenuOpen] = useState(false)
  const [addMembersOpen, setAddMembersOpen] = useState(false)
  const [groupInfoOpen, setGroupInfoOpen] = useState(false)
  const [ctxMenu, setCtxMenu] = useState(null) // { x, y, items: [{label, onClick, danger}] }
  const [onlineUsers, setOnlineUsers] = useState(new Set())
  const [typingUsers, setTypingUsers] = useState({}) // {room_id: Set<user_id>}
  const [me, setMe] = useState(null)
  const [filePolicy, setFilePolicy] = useState({ max_size_mb: 50, ttl_hours: 48 })
  const [uploadingFile, setUploadingFile] = useState(null) // {progress, name}
  // Slack-fundament: каналы / pinned / mentions
  const [createChannelOpen, setCreateChannelOpen] = useState(false)
  const [channelSettingsOpen, setChannelSettingsOpen] = useState(false)
  const [pinnedOpen, setPinnedOpen] = useState(false)
  const [unreadMentions, setUnreadMentions] = useState({}) // {room_id: count}
  const [mentionQuery, setMentionQuery] = useState(null)
  const [reactPickerFor, setReactPickerFor] = useState(null) // id сообщения с открытым picker'ом
  // Threads (reply): {id, body_preview, sender_name}
  const [replyingTo, setReplyingTo] = useState(null)
  // Polls
  const [createPollOpen, setCreatePollOpen] = useState(false)
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
        // Авто-открытие DM из ?dm=<user_id> — переход из других страниц (например, «Чат» в карточке сотрудника)
        try {
          const sp = new URLSearchParams(window.location.search)
          const dmId = sp.get("dm")
          if (dmId) {
            const { data: room } = await api.post("/staff-chat/rooms/direct", { user_id: dmId })
            setRooms((prev) => {
              const exists = prev.some((r) => r.id === room.id)
              return exists ? prev.map((r) => r.id === room.id ? { ...r, ...room } : r) : [room, ...prev]
            })
            // Полная инициализация комнаты (как в openRoom) — иначе показывает «Выберите чат»
            try {
              const [{ data: details }, { data: msgs }] = await Promise.all([
                api.get(`/staff-chat/rooms/${room.id}`),
                api.get(`/staff-chat/rooms/${room.id}/messages`),
              ])
              setActiveRoomId(room.id)
              setMembers(details.members || [])
              setMessages(msgs.messages || [])
              api.post(`/staff-chat/rooms/${room.id}/read`).catch(() => {})
            } catch (loadErr) {
              console.warn("dm room load failed", loadErr)
              setActiveRoomId(room.id)
            }
            // Чистим URL чтобы при reload не открывалось повторно
            const cleanUrl = window.location.pathname + window.location.hash
            history.replaceState(null, "", cleanUrl)
          }
        } catch (err) {
          console.warn("dm autostart failed", err)
        }
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

  // ── Unread mentions (badge "@" в sidebar) ───────────────────────────────
  useEffect(() => {
    let alive = true
    async function loadMentions() {
      try {
        const { data } = await api.get('/staff-chat/mentions/unread')
        if (!alive) return
        const map = {}
        for (const it of (data?.rooms || [])) {
          if (it.room_id != null) map[it.room_id] = it.mention_count || 0
        }
        setUnreadMentions(map)
      } catch {
        // endpoint может ещё не быть реализован на бэкенде — молчим
      }
    }
    loadMentions()
    const tid = setInterval(loadMentions, 30000)
    return () => { alive = false; clearInterval(tid) }
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


  // ── Slack-fundament: reactions / pin helpers ─────────────────────────────
  // Быстрые реакции в picker'е (как Slack/Discord)
  const QUICK_REACTIONS = ['👍', '❤️', '✅', '🙏', '😂', '🔥']

  // Перезагрузка сообщений текущей активной комнаты (после toggle reaction / pin)
  async function refetchMessages() {
    if (!activeRoomId) return
    try {
      const { data } = await api.get(`/staff-chat/rooms/${activeRoomId}/messages`)
      setMessages(data.messages || [])
    } catch (e) {
      // тихо — UI остаётся в текущем состоянии
    }
  }

  // Toggle реакции (бэк сам решает add/remove)
  async function toggleReaction(msg, emoji) {
    try {
      await api.post(`/staff-chat/messages/${msg.id}/reactions`, { emoji })
      await refetchMessages()
    } catch (e) {
      alert('Не удалось поставить реакцию: ' + (e?.response?.data?.detail || e.message))
    }
  }

  // Pin / unpin сообщения
  async function togglePin(msg) {
    try {
      await api.post(`/staff-chat/messages/${msg.id}/pin`)
      await refetchMessages()
    } catch (e) {
      alert('Не удалось закрепить: ' + (e?.response?.data?.detail || e.message))
    }
  }

  // Может ли текущий user закреплять сообщения в активной комнате?
  // (admin в группе/канале или manager+ роль)
  const canPin = useMemo(() => {
    if (!me || !activeRoomId) return false
    const room = rooms.find((r) => r.id === activeRoomId)
    if (!room) return false
    if (room.type === 'direct') return true // в DM любой участник может закрепить
    const myMember = (room.members || members).find((m) => m.id === me.id)
    if (myMember?.member_role === 'admin') return true
    // По-возможности проверяем глобальную роль (manager+)
    const role = me.role || me.user_role
    if (role && ['admin', 'manager', 'owner', 'superadmin'].includes(String(role).toLowerCase())) return true
    return false
  }, [me, activeRoomId, rooms, members])

  // Подсветка @username внутри текста сообщения
  function highlightMentions(text) {
    if (!text) return text
    const parts = String(text).split(/(@[A-Za-zА-Яа-я0-9_]{2,30})/g)
    return parts.map((part, i) =>
      /^@[A-Za-zА-Яа-я0-9_]/.test(part)
        ? <span key={i} style={{ color: 'var(--accent, #0097A7)', fontWeight: 600 }}>{part}</span>
        : part
    )
  }

  // ── Context menus (Telegram-style ПКМ) ──────────────────────────────────
  function openMsgContextMenu(e, msg, isMine) {
    const items = []
    if (msg.body) {
      items.push({ label: 'Копировать', icon: '📋', onClick: () => { navigator.clipboard?.writeText(msg.body) } })
    }
    // Pin/unpin — для тех у кого есть права
    if (!msg.deleted_at && canPin) {
      items.push({
        label: msg.pinned_at ? 'Открепить' : 'Закрепить',
        icon: '📌',
        onClick: () => togglePin(msg),
      })
    }
    if (isMine && !msg.deleted_at) {
      items.push({ label: 'Удалить', icon: '🗑', danger: true, onClick: async () => {
        if (!confirm('Удалить сообщение?')) return
        try { await api.delete(`/staff-chat/messages/${msg.id}`) } catch (er) { alert('Не удалось удалить') }
      }})
    }
    if (items.length === 0) return
    setCtxMenu({ x: e.clientX, y: e.clientY, items })
  }
  function openRoomContextMenu(e, room) {
    const peerId = room.type === 'direct' ? room.members.find((m) => me && m.id !== me.id)?.id : null
    const isMyAdmin = (room.type === 'group' || room.type === 'broadcast') &&
      room.members?.some((m) => me && m.id === me.id && m.member_role === 'admin')
    const items = [
      { label: 'Открыть', icon: '💬', onClick: () => openRoom(room.id) },
    ]
    if (isMyAdmin) {
      items.push({ label: 'Переименовать', icon: '✏️', onClick: () => renameRoom(room) })
      items.push({ label: 'Удалить группу', icon: '🗑', danger: true, onClick: () => deleteRoom(room) })
    }
    setCtxMenu({ x: e.clientX, y: e.clientY, items })
  }

  // ── Group management actions ──────────────────────────────────────────────
  async function createGroup({ name, member_ids, broadcast }) {
    try {
      await api.post('/admin/chat/groups', { name, member_ids, broadcast })
      setCreateGroupOpen(false); setCreateBroadcastOpen(false)
      const { data } = await api.get('/staff-chat/rooms')
      setRooms(data.rooms || [])
    } catch (e) {
      alert('Ошибка создания: ' + (e?.response?.data?.detail || e.message))
    }
  }

  async function renameRoom(room) {
    const newName = prompt('Новое название:', room.name || '')
    if (!newName || newName.trim() === room.name) return
    try {
      await api.patch(`/admin/chat/groups/${room.id}`, { name: newName.trim() })
      setRooms((prev) => prev.map((r) => r.id === room.id ? { ...r, name: newName.trim() } : r))
    } catch (e) {
      alert('Ошибка: ' + (e?.response?.data?.detail || e.message))
    }
  }

  async function deleteRoom(room) {
    if (!confirm(`Удалить «${room.name}» полностью?\nВсе сообщения и файлы будут удалены безвозвратно.`)) return
    try {
      await api.delete(`/admin/chat/groups/${room.id}`)
      setRooms((prev) => prev.filter((r) => r.id !== room.id))
      if (activeRoomId === room.id) { setActiveRoomId(null); setMessages([]); setMembers([]) }
      setConvMenuOpen(false)
    } catch (e) {
      alert('Ошибка: ' + (e?.response?.data?.detail || e.message))
    }
  }

  async function addRoomMembers(room, user_ids) {
    try {
      await api.post(`/admin/chat/groups/${room.id}/members`, { user_ids })
      setAddMembersOpen(false)
      const { data: details } = await api.get(`/staff-chat/rooms/${room.id}`)
      setMembers(details.members || [])
    } catch (e) {
      alert('Ошибка: ' + (e?.response?.data?.detail || e.message))
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
      setUnreadMentions((prev) => { if (!(roomId in prev)) return prev; const n = { ...prev }; delete n[roomId]; return n })
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
      const payload = { body, attachments }
      if (replyingTo?.id) payload.reply_to_id = replyingTo.id
      const { data: msg } = await api.post(`/staff-chat/rooms/${activeRoomId}/messages`, payload)
      setDraft('')
      setReplyingTo(null)
      // Сообщение вернётся также через WS, но для мгновенного отклика — добавляем сразу
      setMessages((prev) => prev.some((x) => x.id === msg.id) ? prev : [...prev, msg])
      scrollToBottom()
      composerRef.current?.focus()
    } catch (e) {
      alert('Не удалось отправить: ' + (e?.response?.data?.detail || e.message))
    }
  }

  // ── Прокрутка к конкретному сообщению (для thread-цитат и поиска) ─────────
  function scrollToMessage(msgId) {
    if (!msgId) return
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-msg-id="${msgId}"]`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.classList.add('sc-msg-highlight')
        setTimeout(() => el.classList.remove('sc-msg-highlight'), 1800)
      }
    })
  }

  // ── Открыть комнату и проскроллить к сообщению (для global search) ───────
  async function openRoomAndScrollTo(roomId, msgId) {
    if (!roomId) return
    if (roomId !== activeRoomId) {
      await openRoom(roomId)
    }
    setTimeout(() => scrollToMessage(msgId), 250)
  }

  // ── Голосование в опросе ────────────────────────────────────────────────
  async function votePoll(poll, optionId) {
    if (!poll?.id || !optionId) return
    try {
      // Оптимистичный апдейт: обновляем локальное состояние сразу
      setMessages((prev) => prev.map((m) => {
        if (!m.poll || m.poll.id !== poll.id) return m
        const multi = !!m.poll.multi_select
        const options = (m.poll.options || []).map((opt) => {
          const wasMine = !!opt.voted_by_me
          if (opt.id === optionId) {
            const newMine = !wasMine
            return {
              ...opt,
              voted_by_me: newMine,
              votes_count: Math.max(0, (opt.votes_count || 0) + (newMine ? 1 : -1)),
            }
          }
          // В single-select снимаем галки с остальных
          if (!multi && wasMine) {
            return { ...opt, voted_by_me: false, votes_count: Math.max(0, (opt.votes_count || 0) - 1) }
          }
          return opt
        })
        return { ...m, poll: { ...m.poll, options } }
      }))
      const { data } = await api.post(`/staff-chat/polls/${poll.id}/vote`, { option_id: optionId })
      // Sync с серверным состоянием
      if (data?.poll) {
        setMessages((prev) => prev.map((m) => (m.poll && m.poll.id === poll.id ? { ...m, poll: data.poll } : m)))
      }
    } catch (e) {
      alert('Не удалось проголосовать: ' + (e?.response?.data?.detail || e.message))
      // Перезагрузим сообщения чтобы откатить оптимистичный апдейт
      await refetchMessages()
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
          <div className="sc-side-tabs">
            <button
              className={'sc-side-tab' + (sidebarTab === 'chats' ? ' is-active' : '')}
              onClick={() => setSidebarTab('chats')}
              type="button"
            >Чаты</button>
            <button
              className={'sc-side-tab' + (sidebarTab === 'contacts' ? ' is-active' : '')}
              onClick={() => setSidebarTab('contacts')}
              type="button"
            >Контакты</button>
          </div>
          <div className="sc-header-actions">
            <GlobalSearchBox
              onPick={(r) => {
                if (r?.room_id) openRoomAndScrollTo(r.room_id, r.message_id)
              }}
            />
            <button className="sc-icon-btn" title="Настройки чата" onClick={() => setSettingsOpen(true)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3h.1a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8v.1a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>
              </svg>
            </button>
            <div className="sc-plus-wrap">
              <button className="sc-icon-btn" title="Новый чат / группа" onClick={() => setPlusMenuOpen(!plusMenuOpen)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
              </button>
              {plusMenuOpen && (
                <>
                  <div className="sc-menu-overlay" onClick={() => setPlusMenuOpen(false)} />
                  <div className="sc-menu">
                    <button className="sc-menu-item" onClick={() => { setPlusMenuOpen(false); setShowNewChat(true) }}>
                      <span>💬</span> Новый чат
                    </button>
                    <button className="sc-menu-item" onClick={() => { setPlusMenuOpen(false); setCreateGroupOpen(true) }}>
                      <span>👥</span> Новая группа
                    </button>
                    <button className="sc-menu-item" onClick={() => { setPlusMenuOpen(false); setCreateBroadcastOpen(true) }}>
                      <span>📢</span> Broadcast-канал
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {sidebarTab === 'contacts' ? (
          <>
            <input
              className="sc-input sc-search sc-contact-search"
              placeholder="Поиск сотрудника…"
              value={contactSearch}
              onChange={(e) => setContactSearch(e.target.value)}
            />
            <div className="sc-rooms">
              {(() => {
                const q = contactSearch.toLowerCase().trim()
                const groups = (contacts.groups || [])
                  .map((g) => ({
                    ...g,
                    users: (g.users || []).filter((u) => !q || (u.name || '').toLowerCase().includes(q)),
                  }))
                  .filter((g) => g.users.length > 0)
                if (groups.length === 0) {
                  return (
                    <div className="sc-empty">
                      <div className="sc-empty-icon">👥</div>
                      <div className="sc-empty-title">{q ? 'Никого не найдено' : 'Контактов пока нет'}</div>
                      <div className="sc-empty-sub">{q ? 'Попробуйте изменить запрос.' : 'Сотрудники тенанта появятся здесь автоматически.'}</div>
                    </div>
                  )
                }
                // Группировка по тенанту видна только если контакты приходят
                // из нескольких тенантов (super_admin/franchise_owner). В одном
                // тенанте — оставляем плоский список клиник как раньше.
                const tenantIds = new Set(groups.map(g => g.tenant_id).filter(Boolean))
                const showTenantHeader = tenantIds.size > 1
                const toggleGroup = (key) => {
                  setCollapsedContactGroups(prev => {
                    const n = new Set(prev)
                    if (n.has(key)) n.delete(key); else n.add(key)
                    return n
                  })
                }
                const renderGroup = (g) => {
                  const key = g.clinic_id || g.label
                  const collapsed = collapsedContactGroups.has(key)
                  return (
                    <div key={key} className="sc-contact-group">
                      <button
                        type="button"
                        className={'sc-contact-group-label sc-contact-group-toggle' + (collapsed ? ' is-collapsed' : '')}
                        onClick={() => toggleGroup(key)}
                      >
                        <span className="sc-contact-group-caret">{collapsed ? '▶' : '▼'}</span>
                        <span className="sc-contact-group-name">{g.label}</span>
                        <span className="sc-contact-group-count">{g.users.length}</span>
                      </button>
                      {!collapsed && g.users.map((u) => (
                        <button
                          key={u.id}
                          className="sc-contact-row sc-contact-clickable"
                          type="button"
                          onClick={() => startDirectChat(u.id)}
                          title={`Открыть чат с ${u.name}`}
                        >
                          <Avatar name={u.name} id={u.id} size={40} online={onlineUsers.has(u.id)} />
                          <div className="sc-contact-body">
                            <div className="sc-contact-name">{u.name}</div>
                            <div className="sc-contact-role">{ROLE_LABELS[u.role] || u.role}</div>
                          </div>
                          <span className="sc-contact-arrow">›</span>
                        </button>
                      ))}
                    </div>
                  )
                }
                if (!showTenantHeader) {
                  return groups.map(renderGroup)
                }
                // Группируем по tenant_id
                const byTenant = {}
                for (const g of groups) {
                  const tid = g.tenant_id || '__no_tenant__'
                  if (!byTenant[tid]) byTenant[tid] = { tenant_name: g.tenant_name || 'Без сети', groups: [] }
                  byTenant[tid].groups.push(g)
                }
                const tenantOrder = Object.keys(byTenant).sort((a, b) => (byTenant[a].tenant_name || '').localeCompare(byTenant[b].tenant_name || ''))
                return tenantOrder.map((tid) => {
                  const tKey = `tenant:${tid}`
                  const tCollapsed = collapsedContactGroups.has(tKey)
                  const t = byTenant[tid]
                  const totalUsers = t.groups.reduce((s, g) => s + g.users.length, 0)
                  return (
                    <div key={tKey} className="sc-contact-tenant">
                      <button
                        type="button"
                        className={'sc-contact-tenant-label' + (tCollapsed ? ' is-collapsed' : '')}
                        onClick={() => toggleGroup(tKey)}
                      >
                        <span className="sc-contact-group-caret">{tCollapsed ? '▶' : '▼'}</span>
                        <span className="sc-contact-tenant-name">🏥 {t.tenant_name}</span>
                        <span className="sc-contact-group-count">{totalUsers}</span>
                      </button>
                      {!tCollapsed && t.groups.map(renderGroup)}
                    </div>
                  )
                })
              })()}
            </div>
          </>
        ) : (
        <div className="sc-rooms">
          {rooms.length === 0 && (
            <div className="sc-empty">
              <div className="sc-empty-icon">💬</div>
              <div className="sc-empty-title">Нет чатов</div>
              <div className="sc-empty-sub">Начните диалог с сотрудником сети — кнопка «+» вверху.</div>
            </div>
          )}
          {(() => {
            // Slack-style split: Каналы (channel/group/broadcast) сверху, DM ниже
            const channels = rooms.filter((r) => r.type === 'channel' || r.type === 'group' || r.type === 'broadcast')
            const dms = rooms.filter((r) => r.type === 'direct')
            const renderRoom = (r) => {
              const isActive = r.id === activeRoomId
              const peerId = r.type === 'direct' ? r.members.find((m) => me && m.id !== me.id)?.id : null
              const isOnline = peerId ? onlineUsers.has(peerId) : false
              const hasMention = (unreadMentions[r.id] || 0) > 0
              return (
                <button
                  key={r.id}
                  onClick={() => openRoom(r.id)}
                  onContextMenu={(e) => { e.preventDefault(); openRoomContextMenu(e, r) }}
                  className={'sc-room' + (isActive ? ' is-active' : '')}
                >
                  <Avatar name={r.name} id={peerId || r.id} size={42} online={isOnline} />
                  <div className="sc-room-body">
                    <div className="sc-room-row">
                      <span className="sc-room-name">
                        {r.type === 'channel' && <span style={{ color: 'var(--sc-fg-3)', marginRight: 4 }}>#</span>}
                        {r.type === 'group' && <span style={{ marginRight: 4 }}>🔒</span>}
                        {r.name || 'Без названия'}
                      </span>
                      <span className="sc-room-time">
                        {peerId && onlineUsers.has(peerId) && <span className="sc-room-online" title="В сети">●</span>}
                        {formatTime(r.last_message_at)}
                      </span>
                    </div>
                    <div className="sc-room-row">
                      <span className="sc-room-preview">
                        {r.last_message
                          ? (r.last_message.deleted_at ? <em>удалено</em> :
                              (r.last_message.body || (r.last_message.attachments?.length ? '📎 файл' : '')))
                          : <em style={{ color: 'var(--sc-fg-3)' }}>Нет сообщений</em>}
                      </span>
                      <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                        {hasMention && (
                          <span
                            title={`Упоминаний: ${unreadMentions[r.id]}`}
                            style={{
                              fontSize: 10,
                              padding: '2px 6px',
                              borderRadius: 999,
                              background: 'rgba(0,151,167,.18)',
                              color: 'var(--accent, #0097A7)',
                              fontWeight: 700,
                            }}
                          >
                            @
                          </span>
                        )}
                        {r.unread > 0 && <span className="sc-unread">{r.unread > 99 ? '99+' : r.unread}</span>}
                      </span>
                    </div>
                  </div>
                </button>
              )
            }
            return (
              <>
                <div className="sc-sec-header">
                  <span className="sc-sec-title">Каналы ({channels.length})</span>
                  <button
                    onClick={() => setCreateChannelOpen(true)}
                    className="sc-sec-add"
                    aria-label="Создать канал"
                    title="Создать канал"
                  >
                    +
                  </button>
                </div>
                {channels.map(renderRoom)}
                <div className="sc-sec-header" style={{ marginTop: 8 }}>
                  <span className="sc-sec-title">Direct messages ({dms.length})</span>
                </div>
                {dms.map(renderRoom)}
              </>
            )
          })()}
        </div>
        )}
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
            <header className="sc-conv-header sc-conv-header-clickable"
              onClick={() => setGroupInfoOpen(true)}
              title="Открыть информацию"
            >
              <Avatar name={activeRoom.name} id={peer?.id || activeRoom.id} size={40} online={peerOnline} />
              <div className="sc-conv-head-body">
                <div className="sc-conv-head-name">{activeRoom.name}</div>
                <div className="sc-conv-head-sub">
                  {activeTyping
                    ? <span style={{ color: 'oklch(0.62 0.18 200)' }}>{activeTyping} печатает…</span>
                    : (peer ? (peerOnline ? <span style={{ color: 'oklch(0.55 0.18 145)' }}>● в сети</span> : 'был(а) недавно') : `Участников: ${members.length}`)}
                </div>
              </div>
              {(() => {
                const pinnedCount = (messages || []).filter((mm) => mm.pinned_at).length
                if (pinnedCount === 0) return null
                return (
                  <button
                    onClick={(e) => { e.stopPropagation(); setPinnedOpen(true) }}
                    className="sc-pinned-badge"
                    title="Открыть закреплённые сообщения"
                  >
                    📌 {pinnedCount}
                  </button>
                )
              })()}
              {/* Кнопка настроек канала — только для channel/group/broadcast (не для DM) */}
              {(activeRoom.type === 'channel' || activeRoom.type === 'group' || activeRoom.type === 'broadcast') && (
                <button
                  onClick={(e) => { e.stopPropagation(); setChannelSettingsOpen(true) }}
                  className="sc-icon-btn"
                  title="Настройки канала"
                  style={{ marginLeft: 6 }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3h.1a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8v.1a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>
                  </svg>
                </button>
              )}
              <svg className="sc-conv-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
            </header>

            <div className="sc-messages">
              {messages.map((m, idx) => {
                const mine = me && m.sender_id === me.id
                const sender = members.find((x) => x.id === m.sender_id)
                const showSender = !mine && (idx === 0 || messages[idx - 1].sender_id !== m.sender_id)
                return (
                  <div key={m.id} data-msg-id={m.id} className={'sc-msg-row' + (mine ? ' is-mine' : '')}>
                    {!mine && (
                      <div className="sc-msg-avatar">
                        {showSender ? <Avatar name={sender?.name || '?'} id={m.sender_id} size={32} /> : <div style={{ width: 32 }} />}
                      </div>
                    )}
                    <div className={'sc-msg-bubble' + (mine ? ' is-mine' : '') + (m.pinned_at ? ' is-pinned' : '')} onContextMenu={(e) => { e.preventDefault(); openMsgContextMenu(e, m, mine) }}>
                      {showSender && !mine && <div className="sc-msg-sender">{sender?.name || 'Сотрудник'}</div>}
                      {m.pinned_at && (
                        <div className="sc-msg-pin-badge" title="Закреплено">
                          <span style={{ fontSize: 11, color: '#B45309', fontWeight: 700 }}>📌 закреплено</span>
                        </div>
                      )}
                      {/* Цитата ответа (thread) — серая полоса сверху, клик ведёт к оригиналу */}
                      {m.reply_to && (
                        <button
                          type="button"
                          className="sc-msg-quote"
                          onClick={(e) => { e.stopPropagation(); scrollToMessage(m.reply_to.id || m.reply_to_id) }}
                          title="Перейти к оригиналу"
                        >
                          <span className="sc-msg-quote-author">
                            {m.reply_to.sender_name || members.find((x) => x.id === m.reply_to.sender_id)?.name || 'Сотрудник'}
                          </span>
                          <span className="sc-msg-quote-body">
                            {(m.reply_to.body_preview || m.reply_to.body || '📎 файл').slice(0, 120)}
                          </span>
                        </button>
                      )}
                      {m.deleted_at ? (
                        <div className="sc-msg-deleted"><em>сообщение удалено</em></div>
                      ) : (
                        <>
                          {m.body && <div className="sc-msg-body" style={{ whiteSpace: 'pre-wrap' }}>{highlightMentions(m.body)}</div>}
                          {/* Опрос (poll) — компактный список вариантов с прогресс-барами */}
                          {m.poll && (() => {
                            const poll = m.poll
                            const options = poll.options || []
                            const totalVotes = options.reduce((s, o) => s + (o.votes_count || 0), 0)
                            const closed = poll.closed_at || (poll.closes_at && new Date(poll.closes_at) < new Date())
                            return (
                              <div className="sc-poll" onClick={(e) => e.stopPropagation()}>
                                <div className="sc-poll-q">{poll.question}</div>
                                {poll.multi_select && (
                                  <div className="sc-poll-hint">Можно выбрать несколько</div>
                                )}
                                {options.map((opt) => {
                                  const pct = totalVotes > 0 ? Math.round(((opt.votes_count || 0) / totalVotes) * 100) : 0
                                  const mineVoted = !!opt.voted_by_me
                                  return (
                                    <button
                                      key={opt.id}
                                      type="button"
                                      disabled={closed}
                                      onClick={() => votePoll(poll, opt.id)}
                                      className={'sc-poll-option' + (mineVoted ? ' is-mine' : '') + (closed ? ' is-closed' : '')}
                                      title={closed ? 'Опрос закрыт' : (mineVoted ? 'Убрать голос' : 'Проголосовать')}
                                    >
                                      <span className="sc-poll-bar" style={{ width: pct + '%' }} />
                                      <span className="sc-poll-label">
                                        <span className="sc-poll-check">{mineVoted ? '☑' : '☐'}</span>
                                        {opt.label}
                                      </span>
                                      <span className="sc-poll-pct">{pct}% · {opt.votes_count || 0}</span>
                                    </button>
                                  )
                                })}
                                <div className="sc-poll-meta">
                                  Голосов: {totalVotes}
                                  {closed && <span> · закрыт</span>}
                                  {!closed && poll.closes_at && (
                                    <span> · до {new Date(poll.closes_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                                  )}
                                </div>
                              </div>
                            )
                          })()}
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
                      {/* Reactions bar (Slack-style) */}
                      {!m.deleted_at && (
                        <div className="sc-msg-reactions" style={{ position: 'relative' }}>
                          {(m.reactions || []).map((r) => {
                            const mineHere = !!r.mine || !!r.by_me
                            return (
                              <button
                                key={r.emoji}
                                onClick={(e) => { e.stopPropagation(); toggleReaction(m, r.emoji) }}
                                className={'sc-reaction-chip' + (mineHere ? ' is-mine' : '')}
                                title={mineHere ? 'Убрать реакцию' : `Поставить ${r.emoji}`}
                              >
                                <span>{r.emoji}</span>
                                <span className="sc-reaction-count">{r.count || 1}</span>
                              </button>
                            )
                          })}
                          <button
                            onClick={(e) => { e.stopPropagation(); setReactPickerFor((cur) => cur === m.id ? null : m.id) }}
                            className="sc-reaction-add"
                            title="Добавить реакцию"
                            aria-label="Добавить реакцию"
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 14, verticalAlign: 'middle' }}>add_reaction</span>
                            {!(m.reactions || []).length && <span style={{ fontSize: 12, marginLeft: 4 }}>+</span>}
                          </button>
                          {/* Кнопка «Ответить» — открывает thread reply preview над composer */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setReplyingTo({
                                id: m.id,
                                body_preview: (m.body || (m.attachments?.length ? '📎 файл' : (m.poll ? '📊 опрос' : ''))).slice(0, 140),
                                sender_name: sender?.name || (mine ? 'Вы' : 'Сотрудник'),
                              })
                              requestAnimationFrame(() => composerRef.current?.focus())
                            }}
                            className="sc-reaction-add sc-reply-btn"
                            title="Ответить"
                            aria-label="Ответить"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <polyline points="9 17 4 12 9 7"/>
                              <path d="M20 18v-2a4 4 0 00-4-4H4"/>
                            </svg>
                          </button>
                          {reactPickerFor === m.id && (
                            <>
                              <div
                                onClick={() => setReactPickerFor(null)}
                                style={{ position: 'fixed', inset: 0, zIndex: 40 }}
                              />
                              <div
                                onClick={(e) => e.stopPropagation()}
                                className="sc-reaction-picker"
                                style={{
                                  position: 'absolute',
                                  bottom: '100%',
                                  [mine ? 'right' : 'left']: 0,
                                  marginBottom: 6,
                                  background: 'var(--sc-surface, #fff)',
                                  border: '1px solid var(--sc-border, rgba(0,0,0,.08))',
                                  borderRadius: 999,
                                  padding: '6px 8px',
                                  boxShadow: '0 8px 24px rgba(15,23,42,.18)',
                                  display: 'inline-flex',
                                  gap: 4,
                                  zIndex: 50,
                                }}
                              >
                                {QUICK_REACTIONS.map((emoji) => (
                                  <button
                                    key={emoji}
                                    onClick={(e) => { e.stopPropagation(); setReactPickerFor(null); toggleReaction(m, emoji) }}
                                    style={{
                                      width: 30, height: 30, borderRadius: 999,
                                      background: 'transparent', border: 0, cursor: 'pointer',
                                      fontSize: 18,
                                    }}
                                    title={emoji}
                                  >
                                    {emoji}
                                  </button>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
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
              {replyingTo && (
                <div className="sc-reply-preview">
                  <div className="sc-reply-preview-bar" />
                  <div className="sc-reply-preview-body">
                    <div className="sc-reply-preview-author">↩ Ответ: {replyingTo.sender_name}</div>
                    <div className="sc-reply-preview-text">{replyingTo.body_preview}</div>
                  </div>
                  <button
                    type="button"
                    className="sc-reply-preview-close"
                    onClick={() => setReplyingTo(null)}
                    title="Отменить ответ"
                    aria-label="Отменить ответ"
                  >×</button>
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
                <button
                  type="button"
                  className="sc-icon-btn sc-attach-btn"
                  onClick={() => setCreatePollOpen(true)}
                  title="Создать опрос"
                  aria-label="Создать опрос"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="6" y1="20" x2="6" y2="12"/>
                    <line x1="12" y1="20" x2="12" y2="4"/>
                    <line x1="18" y1="20" x2="18" y2="8"/>
                  </svg>
                </button>
                <textarea
                  ref={composerRef}
                  className="sc-input"
                  rows={1}
                  placeholder="Написать сообщение…"
                  value={draft}
                  onChange={(e) => {
                    const v = e.target.value
                    setDraft(v)
                    sendTyping()
                    // @-trigger: '@' в начале или после пробела/переноса; пустой query тоже валиден
                    const m = v.match(/(?:^|\s)@([A-Za-zА-Яа-я0-9_]*)$/)
                    if (m) setMentionQuery(m[1])
                    else setMentionQuery(null)
                  }}
                  onKeyDown={(e) => {
                    // Не отправляем сообщение, пока открыт mention picker — Enter уходит ему
                    if (mentionQuery != null && (e.key === 'Enter' || e.key === 'Tab' || e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Escape')) {
                      return
                    }
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      sendMessage()
                    }
                  }}
                />
                <MentionAutocomplete
                  query={mentionQuery}
                  onClose={() => setMentionQuery(null)}
                  onPick={(u) => {
                    const handle = u.username || u.full_name || u.name || 'user'
                    setDraft((d) => d.replace(/(^|\s)@([A-Za-zА-Яа-я0-9_]*)$/, (full, prefix) => `${prefix}@${handle} `))
                    setMentionQuery(null)
                    // Возвращаем фокус в textarea
                    requestAnimationFrame(() => composerRef.current?.focus())
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

      {/* GROUP INFO panel (Telegram-style slide-in) */}
      {groupInfoOpen && activeRoom && (
        <GroupInfoPanel
          room={activeRoom}
          members={members}
          me={me}
          onlineUsers={onlineUsers}
          onClose={() => setGroupInfoOpen(false)}
          onRename={() => renameRoom(activeRoom)}
          onAddMembers={() => { setGroupInfoOpen(false); setAddMembersOpen(true) }}
          onDelete={() => { deleteRoom(activeRoom); setGroupInfoOpen(false) }}
          onRemoveMember={async (memberId) => {
            if (!confirm('Удалить участника из группы?')) return
            try {
              await api.delete(`/admin/chat/groups/${activeRoom.id}/members/${memberId}`)
              const { data } = await api.get(`/staff-chat/rooms/${activeRoom.id}`)
              setMembers(data.members || [])
            } catch (e) { alert('Ошибка: ' + (e?.response?.data?.detail || e.message)) }
          }}
        />
      )}

      {/* CONTEXT MENU */}
      {ctxMenu && (
        <>
          <div className="sc-ctx-overlay" onClick={() => setCtxMenu(null)} onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null) }} />
          <div className="sc-ctx-menu" style={{ left: Math.min(ctxMenu.x, window.innerWidth - 220), top: Math.min(ctxMenu.y, window.innerHeight - 60 - ctxMenu.items.length * 38) }}>
            {ctxMenu.items.map((it, idx) => (
              <button key={idx} className={'sc-ctx-item' + (it.danger ? ' is-danger' : '')}
                onClick={() => { setCtxMenu(null); it.onClick() }}>
                <span className="sc-ctx-icon">{it.icon}</span>
                <span>{it.label}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* SETTINGS MODAL */}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}

      {/* CREATE POLL MODAL */}
      <CreatePollModal
        open={createPollOpen && !!activeRoomId}
        roomId={activeRoomId}
        onClose={() => setCreatePollOpen(false)}
        onCreated={() => { setCreatePollOpen(false); refetchMessages() }}
      />

      {/* CREATE GROUP / BROADCAST MODAL */}
      {(createGroupOpen || createBroadcastOpen) && (
        <CreateGroupModal
          broadcast={createBroadcastOpen}
          contacts={contacts}
          onlineUsers={onlineUsers}
          onClose={() => { setCreateGroupOpen(false); setCreateBroadcastOpen(false) }}
          onSubmit={createGroup}
        />
      )}

      {/* CREATE CHANNEL MODAL (Slack-style) */}
      <CreateChannelModal
        open={createChannelOpen}
        onClose={() => setCreateChannelOpen(false)}
        clinicId={me?.clinic_id || null}
        onCreated={(room) => {
          // Добавляем созданную комнату в список и сразу открываем
          setRooms((prev) => prev.some((x) => x.id === room.id) ? prev : [room, ...prev])
          if (room?.id) openRoom(room.id)
        }}
      />

      {/* CHANNEL SETTINGS MODAL (rename / delete) */}
      <ChannelSettingsModal
        open={channelSettingsOpen}
        room={activeRoom}
        canEdit={canPin}
        onClose={() => setChannelSettingsOpen(false)}
        onUpdated={(room) => {
          setRooms((prev) => prev.map((r) => (r.id === room.id ? { ...r, ...room } : r)))
        }}
        onDeleted={(roomId) => {
          setRooms((prev) => prev.filter((r) => r.id !== roomId))
          if (activeRoomId === roomId) { setActiveRoomId(null); setMessages([]); setMembers([]) }
        }}
      />

      {/* PINNED MESSAGES MODAL */}
      <PinnedMessagesModal
        open={pinnedOpen}
        onClose={() => setPinnedOpen(false)}
        roomId={activeRoomId}
      />

      {/* ADD MEMBERS MODAL */}
      {addMembersOpen && activeRoom && (
        <AddMembersModal
          room={activeRoom}
          members={members}
          contacts={contacts}
          onlineUsers={onlineUsers}
          onClose={() => setAddMembersOpen(false)}
          onSubmit={(ids) => addRoomMembers(activeRoom, ids)}
        />
      )}

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
                        <div className="sc-contact-meta">
                          <span className="sc-contact-role">{ROLE_LABELS[u.role] || u.role}</span>
                          <span className={'sc-status-pill ' + (onlineUsers.has(u.id) ? 'is-online' : 'is-offline')}>
                            <span className="sc-status-dot" />
                            {onlineUsers.has(u.id) ? 'В сети' : 'Не в сети'}
                          </span>
                        </div>
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

function GroupInfoPanel({ room, members, me, onlineUsers, onClose, onRename, onAddMembers, onDelete, onRemoveMember }) {
  const myMember = members.find((m) => me && m.id === me.id)
  const isAdmin = myMember?.member_role === 'admin'
  const isGroup = room.type === 'group' || room.type === 'broadcast'
  const peer = !isGroup ? members.find((m) => me && m.id !== me.id) : null
  return (
    <>
      <div className="sc-panel-overlay" onClick={onClose} />
      <aside className="sc-info-panel">
        <header className="sc-info-head">
          <button className="sc-icon-btn" onClick={onClose} title="Закрыть">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>
          </button>
          <div className="sc-info-head-title">{isGroup ? 'Информация о группе' : 'Профиль'}</div>
        </header>
        <div className="sc-info-hero">
          <Avatar name={room.name} id={peer?.id || room.id} size={104} online={peer ? onlineUsers.has(peer.id) : false} />
          <div className="sc-info-title">{room.name}</div>
          <div className="sc-info-sub">
            {isGroup
              ? `${members.length} участник(а) · ${room.type === 'broadcast' ? 'broadcast-канал' : 'групповой чат'}`
              : (peer && onlineUsers.has(peer.id) ? <span style={{ color: 'oklch(0.55 0.18 145)' }}>● в сети</span> : 'был(а) недавно')}
          </div>
        </div>

        {isGroup && isAdmin && (
          <div className="sc-info-actions">
            <button className="sc-info-action" onClick={onRename}>
              <span className="sc-info-action-ic">✏️</span>
              <span>Переименовать</span>
            </button>
            <button className="sc-info-action" onClick={onAddMembers}>
              <span className="sc-info-action-ic">➕</span>
              <span>Добавить участников</span>
            </button>
          </div>
        )}

        {isGroup && (
          <div className="sc-info-members">
            <div className="sc-info-section-title">{members.length} участник(а)</div>
            {members.map((m) => (
              <div key={m.id} className="sc-info-member">
                <Avatar name={m.name} id={m.id} size={40} online={onlineUsers.has(m.id)} />
                <div className="sc-info-member-body">
                  <div className="sc-info-member-name">{m.name}</div>
                  <div className="sc-info-member-role">
                    {m.member_role === 'admin' && <span className="sc-info-tag">admin</span>}
                    {ROLE_LABELS[m.role] || m.role}
                  </div>
                </div>
                {isAdmin && m.id !== me?.id && m.member_role !== 'admin' && (
                  <button className="sc-info-rm" onClick={() => onRemoveMember(m.id)} title="Удалить">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {isGroup && isAdmin && (
          <button className="sc-info-danger" onClick={onDelete}>
            🗑 Удалить группу
          </button>
        )}
      </aside>
    </>
  )
}

function SettingsModal({ onClose }) {
  const [s, setS] = useState(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    api.get('/admin/chat-settings').then((r) => setS(r.data)).catch(() => setS({ _err: true }))
  }, [])
  async function update(field, value) {
    setSaving(true)
    try {
      const { data } = await api.put('/admin/chat-settings', { [field]: value })
      setS(data)
    } catch (e) {
      alert('Не удалось сохранить: ' + (e?.response?.data?.detail || e.message))
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="sc-modal-backdrop" onClick={onClose}>
      <div className="sc-modal sc-modal-wide" onClick={(e) => e.stopPropagation()}>
        <header className="sc-modal-head">
          <div className="sc-modal-title">⚙️ Настройки чата</div>
          <button className="sc-icon-btn" onClick={onClose}>×</button>
        </header>
        <div className="sc-modal-body">
          {!s && <div style={{ padding: 24, textAlign: 'center', color: 'var(--sc-fg-3)' }}>Загрузка…</div>}
          {s && s._err && <div style={{ padding: 24, textAlign: 'center', color: '#dc2626' }}>Нет доступа к настройкам</div>}
          {s && !s._err && (
            <>
              <div className="sc-set-section">
                <h4>📎 Файлы</h4>
                <div className="sc-set-row">
                  <div>
                    <div className="sc-set-label">Срок хранения файлов</div>
                    <div className="sc-set-hint">Через сколько часов файлы автоматически удаляются</div>
                  </div>
                  <select disabled={saving} value={s.file_ttl_hours} onChange={(e) => update('file_ttl_hours', Number(e.target.value))} className="sc-select">
                    <option value={24}>24 часа</option>
                    <option value={48}>48 часов</option>
                    <option value={72}>72 часа (3 дня)</option>
                    <option value={168}>7 дней</option>
                    <option value={720}>30 дней</option>
                  </select>
                </div>
                <div className="sc-set-row">
                  <div>
                    <div className="sc-set-label">Максимальный размер</div>
                    <div className="sc-set-hint">Лимит на один файл</div>
                  </div>
                  <select disabled={saving} value={s.max_file_mb} onChange={(e) => update('max_file_mb', Number(e.target.value))} className="sc-select">
                    <option value={10}>10 МБ</option>
                    <option value={25}>25 МБ</option>
                    <option value={50}>50 МБ</option>
                    <option value={100}>100 МБ</option>
                    <option value={500}>500 МБ</option>
                  </select>
                </div>
              </div>
              <div className="sc-set-section">
                <h4>🌐 Inter-clinic</h4>
                <ToggleRow label="Чат между клиниками одной франшизы" value={s.inter_clinic_allowed}
                  onChange={(v) => update('inter_clinic_allowed', v)} disabled={saving} />
              </div>
              <div className="sc-set-section">
                <h4>📲 Telegram-уведомления</h4>
                <ToggleRow label="Главный switch" hint="Без этого никаких TG-нотификаций" value={s.tg_notifications_enabled}
                  onChange={(v) => update('tg_notifications_enabled', v)} disabled={saving} />
                <ToggleRow label="Уведомлять super_admin" value={s.tg_notify_super_admin}
                  onChange={(v) => update('tg_notify_super_admin', v)} disabled={saving || !s.tg_notifications_enabled} />
                <ToggleRow label="Уведомлять владельца сети" value={s.tg_notify_franchise_owner}
                  onChange={(v) => update('tg_notify_franchise_owner', v)} disabled={saving || !s.tg_notifications_enabled} />
                <ToggleRow label="Пациентские чаты в TG" value={s.patient_chat_tg_enabled}
                  onChange={(v) => update('patient_chat_tg_enabled', v)} disabled={saving || !s.tg_notifications_enabled} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ToggleRow({ label, hint, value, onChange, disabled }) {
  return (
    <div className={'sc-set-row sc-toggle-row' + (disabled ? ' is-disabled' : '')}>
      <div>
        <div className="sc-set-label">{label}</div>
        {hint && <div className="sc-set-hint">{hint}</div>}
      </div>
      <button type="button" disabled={disabled} onClick={() => onChange(!value)}
        className={'sc-tg ' + (value ? 'is-on' : '')}>
        <span className="sc-tg-thumb" />
      </button>
    </div>
  )
}

function CreateGroupModal({ broadcast, contacts, onlineUsers, onClose, onSubmit }) {
  const [name, setName] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [search, setSearch] = useState('')
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return contacts.groups
      .map((g) => ({ ...g, users: g.users.filter((u) => !q || (u.name || '').toLowerCase().includes(q)) }))
      .filter((g) => g.users.length > 0)
  }, [contacts.groups, search])
  function toggle(id) {
    const s = new Set(selected)
    if (s.has(id)) s.delete(id); else s.add(id)
    setSelected(s)
  }
  return (
    <div className="sc-modal-backdrop" onClick={onClose}>
      <div className="sc-modal" onClick={(e) => e.stopPropagation()}>
        <header className="sc-modal-head">
          <div className="sc-modal-title">{broadcast ? '📢 Новый broadcast-канал' : '👥 Новая группа'}</div>
          <button className="sc-icon-btn" onClick={onClose}>×</button>
        </header>
        <input className="sc-input sc-search" placeholder="Название" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <input className="sc-input sc-search" placeholder="Поиск участников…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="sc-modal-body">
          {filtered.map((g) => (
            <div key={g.clinic_id || g.label} className="sc-contact-group">
              <div className="sc-contact-group-label">{g.label}</div>
              {g.users.map((u) => (
                <label key={u.id} className={'sc-contact-row sc-pick ' + (selected.has(u.id) ? 'is-picked' : '')}
                  onClick={(e) => { if (e.target.tagName !== 'INPUT') toggle(u.id) }}>
                  <input type="checkbox" checked={selected.has(u.id)} readOnly />
                  <Avatar name={u.name} id={u.id} size={32} online={onlineUsers.has(u.id)} />
                  <div className="sc-contact-body">
                    <div className="sc-contact-name">{u.name}</div>
                    <div className="sc-contact-role">{ROLE_LABELS[u.role] || u.role}</div>
                  </div>
                </label>
              ))}
            </div>
          ))}
        </div>
        <footer className="sc-modal-foot">
          <span style={{ fontSize: 12, color: 'var(--sc-fg-3)', marginRight: 'auto' }}>{selected.size} выбрано</span>
          <button className="sc-btn-ghost" onClick={onClose}>Отмена</button>
          <button className="sc-btn-primary" disabled={!name.trim() || selected.size === 0}
            onClick={() => onSubmit({ name: name.trim(), member_ids: Array.from(selected), broadcast })}>
            Создать
          </button>
        </footer>
      </div>
    </div>
  )
}

function AddMembersModal({ room, members, contacts, onlineUsers, onClose, onSubmit }) {
  const existingIds = useMemo(() => new Set(members.map((m) => m.id)), [members])
  const [selected, setSelected] = useState(new Set())
  const [search, setSearch] = useState('')
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return contacts.groups
      .map((g) => ({ ...g, users: g.users.filter((u) => !existingIds.has(u.id) && (!q || (u.name || '').toLowerCase().includes(q))) }))
      .filter((g) => g.users.length > 0)
  }, [contacts.groups, search, existingIds])
  function toggle(id) {
    const s = new Set(selected)
    if (s.has(id)) s.delete(id); else s.add(id)
    setSelected(s)
  }
  return (
    <div className="sc-modal-backdrop" onClick={onClose}>
      <div className="sc-modal" onClick={(e) => e.stopPropagation()}>
        <header className="sc-modal-head">
          <div className="sc-modal-title">Добавить в «{room.name}»</div>
          <button className="sc-icon-btn" onClick={onClose}>×</button>
        </header>
        <input className="sc-input sc-search" placeholder="Поиск…" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
        <div className="sc-modal-body">
          {filtered.map((g) => (
            <div key={g.clinic_id || g.label} className="sc-contact-group">
              <div className="sc-contact-group-label">{g.label}</div>
              {g.users.map((u) => (
                <label key={u.id} className={'sc-contact-row sc-pick ' + (selected.has(u.id) ? 'is-picked' : '')}
                  onClick={(e) => { if (e.target.tagName !== 'INPUT') toggle(u.id) }}>
                  <input type="checkbox" checked={selected.has(u.id)} readOnly />
                  <Avatar name={u.name} id={u.id} size={32} online={onlineUsers.has(u.id)} />
                  <div className="sc-contact-body">
                    <div className="sc-contact-name">{u.name}</div>
                    <div className="sc-contact-role">{ROLE_LABELS[u.role] || u.role}</div>
                  </div>
                </label>
              ))}
            </div>
          ))}
        </div>
        <footer className="sc-modal-foot">
          <button className="sc-btn-ghost" onClick={onClose}>Отмена</button>
          <button className="sc-btn-primary" disabled={selected.size === 0}
            onClick={() => onSubmit(Array.from(selected))}>
            Добавить {selected.size}
          </button>
        </footer>
      </div>
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
.sc-side-tabs { display: flex; gap: 4px; background: var(--sc-bg-2, #f3f5f8); border-radius: 999px; padding: 3px; }
.sc-side-tab {
  flex: 1; padding: 7px 14px; border: 0; background: transparent;
  border-radius: 999px; cursor: pointer; font-weight: 600; font-size: 13px;
  color: var(--sc-fg-3, #6b7280); transition: background 120ms, color 120ms;
}
.sc-side-tab.is-active {
  background: var(--sc-surface, #ffffff); color: var(--sc-fg, #111827);
  box-shadow: 0 1px 2px rgba(0,0,0,0.08);
}
.sc-contact-search { margin: 0 12px 8px; width: calc(100% - 24px); }
.sc-contact-clickable {
  width: 100%; text-align: left; border: 0; background: transparent;
  cursor: pointer; padding: 10px 12px; border-radius: 10px;
  display: flex; align-items: center; gap: 10px;
  transition: background 120ms;
}
.sc-contact-clickable:hover { background: var(--sc-bg-2, #f3f5f8); }
.sc-contact-arrow { margin-left: auto; color: var(--sc-fg-3, #9ca3af); font-size: 20px; }

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
.sc-sec-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 10px 4px;
}
.sc-sec-title {
  font-size: 11px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.05em; color: var(--sc-fg-3, #6b7280);
}
.sc-sec-add {
  width: 22px; height: 22px; border-radius: 6px;
  background: var(--sc-bg-2, #f3f5f8); color: var(--sc-fg-2, #374151);
  border: 0; cursor: pointer; display: grid; place-items: center;
  font-size: 16px; line-height: 1; transition: background 120ms;
}
.sc-sec-add:hover { background: var(--sc-bg-3, #e5e7eb); }
.sc-msg-bubble.is-pinned {
  box-shadow: inset 3px 0 0 #F59E0B;
}
.sc-msg-pin-badge {
  margin-bottom: 4px; padding: 2px 6px;
  background: rgba(245, 158, 11, 0.12);
  border-radius: 6px; display: inline-block;
}
.sc-msg-reactions {
  display: flex; flex-wrap: wrap; gap: 4px;
  margin-top: 6px;
}
.sc-reaction-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: 999px;
  background: var(--sc-bg-2, #f3f5f8);
  border: 1px solid var(--sc-border, rgba(0,0,0,.08));
  font-size: 12px; cursor: pointer; line-height: 1.4;
  transition: background 120ms, transform 80ms;
}
.sc-reaction-chip:hover { background: var(--sc-bg-3, #e5e7eb); }
.sc-reaction-chip:active { transform: scale(0.96); }
.sc-reaction-chip.is-mine {
  background: rgba(0,151,167,0.12);
  border-color: rgba(0,151,167,0.4);
  color: #0097A7;
  font-weight: 600;
}
.sc-reaction-count { font-size: 11px; font-weight: 600; }
.sc-reaction-add {
  display: inline-flex; align-items: center;
  padding: 2px 8px; border-radius: 999px;
  background: transparent; border: 1px dashed var(--sc-border, rgba(0,0,0,.18));
  color: var(--sc-fg-3, #6b7280); cursor: pointer; font-size: 12px;
  opacity: 0.6; transition: opacity 120ms, background 120ms;
}
.sc-msg-bubble:hover .sc-reaction-add { opacity: 1; }
.sc-reaction-add:hover { background: var(--sc-bg-2, #f3f5f8); }
.sc-pinned-badge {
  margin-left: auto; margin-right: 4px;
  padding: 4px 10px; border-radius: 999px;
  background: rgba(245, 158, 11, 0.12);
  color: #B45309; font-size: 12px; font-weight: 600;
  border: 0; cursor: pointer;
  display: inline-flex; align-items: center; gap: 4px;
}
.sc-pinned-badge:hover { background: rgba(245, 158, 11, 0.22); }
.sc-mention-hl { color: var(--accent, #0097A7); font-weight: 600; }
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
.sc-composer-row { display: flex; gap: 8px; align-items: flex-end; position: relative; }
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
.sc-contact-group-toggle {
  display: flex; align-items: center; gap: 8px;
  width: 100%; background: transparent; border: none; cursor: pointer;
  text-align: left; user-select: none;
}
.sc-contact-group-toggle:hover { color: var(--sc-fg-1); }
.sc-contact-group-caret { font-size: 9px; opacity: 0.6; width: 10px; display: inline-block; }
.sc-contact-group-name { flex: 1; }
.sc-contact-group-count {
  font-size: 10.5px; padding: 1px 6px; border-radius: 8px;
  background: var(--sc-bg); color: var(--sc-fg-3); font-weight: 600;
  text-transform: none; letter-spacing: 0;
}
.sc-contact-tenant { margin-bottom: 16px; }
.sc-contact-tenant-label {
  display: flex; align-items: center; gap: 8px;
  width: 100%; padding: 10px 14px 6px;
  font-size: 12.5px; font-weight: 700;
  color: var(--sc-fg-1);
  background: transparent; border: none; cursor: pointer;
  text-align: left; user-select: none;
  border-bottom: 1px solid var(--sc-border); margin-bottom: 4px;
}
.sc-contact-tenant-label:hover { background: var(--sc-bg); }
.sc-contact-tenant-name { flex: 1; }
.sc-contact-tenant .sc-contact-group { padding-left: 10px; }
.sc-contact-row {
  display: flex; gap: 12px; align-items: center;
  width: 100%; padding: 8px 14px;
  background: transparent; border: none; cursor: pointer;
  text-align: left; border-radius: 10px; color: inherit;
  transition: background 0.15s;
}
.sc-contact-row:hover { background: var(--sc-bg); }
.sc-header-actions { display: flex; gap: 4px; }
.sc-plus-wrap { position: relative; }
.sc-menu-overlay { position: fixed; inset: 0; z-index: 1; }
.sc-menu {
  position: absolute; top: 100%; right: 0; margin-top: 4px;
  background: var(--sc-bg-alt); border: 1px solid var(--sc-border);
  border-radius: 12px; box-shadow: 0 12px 32px -8px oklch(0.2 0.02 250 / 0.2);
  min-width: 220px; padding: 6px; z-index: 2;
  animation: scFadeIn 0.12s ease;
}
.sc-menu-right { right: 0; left: auto; }
.sc-menu-item {
  display: flex; align-items: center; gap: 10px;
  width: 100%; padding: 9px 12px; border-radius: 8px;
  background: transparent; border: none; cursor: pointer;
  font: inherit; font-size: 14px; color: var(--sc-fg); text-align: left;
}
.sc-menu-item:hover { background: var(--sc-bg); }
.sc-menu-item.sc-menu-danger { color: oklch(0.55 0.2 25); }
.sc-menu-item.sc-menu-danger:hover { background: oklch(0.95 0.04 25); }
.sc-modal-wide { width: min(620px, 95vw); }
.sc-btn-primary {
  padding: 9px 16px; background: var(--sc-accent); color: white;
  border: none; border-radius: 10px; font: inherit; font-size: 14px; font-weight: 600;
  cursor: pointer;
}
.sc-btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
.sc-btn-ghost {
  padding: 9px 16px; background: transparent; color: var(--sc-fg-2);
  border: 1px solid var(--sc-border); border-radius: 10px;
  font: inherit; font-size: 14px; cursor: pointer;
}
.sc-modal-foot { padding: 12px 18px 16px; display: flex; gap: 8px; align-items: center; justify-content: flex-end; border-top: 1px solid var(--sc-border); }
.sc-pick.is-picked { background: var(--sc-accent-soft); }
.sc-set-section { padding: 16px 20px 8px; border-bottom: 1px solid var(--sc-border); }
.sc-set-section:last-child { border-bottom: none; }
.sc-set-section h4 { font-size: 14px; font-weight: 600; margin: 0 0 12px; color: var(--sc-fg-2); }
.sc-set-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; gap: 16px; }
.sc-set-label { font-size: 14px; font-weight: 500; color: var(--sc-fg); }
.sc-set-hint { font-size: 12px; color: var(--sc-fg-3); margin-top: 2px; }
.sc-select {
  padding: 6px 12px; border: 1px solid var(--sc-border); border-radius: 8px;
  background: var(--sc-bg-alt); color: var(--sc-fg); font: inherit; font-size: 13px;
  cursor: pointer;
}
.sc-toggle-row.is-disabled { opacity: 0.5; }
.sc-tg {
  width: 44px; height: 24px; border-radius: 999px;
  border: none; background: var(--sc-border); cursor: pointer; position: relative;
  transition: background 0.2s; flex-shrink: 0;
}
.sc-tg.is-on { background: var(--sc-accent); }
.sc-tg-thumb {
  position: absolute; top: 2px; left: 2px;
  width: 20px; height: 20px; border-radius: 50%; background: white;
  transition: transform 0.2s;
}
.sc-tg.is-on .sc-tg-thumb { transform: translateX(20px); }

/* GROUP INFO PANEL (Telegram-style slide-in) */
.sc-conv-header-clickable { cursor: pointer; transition: background 0.15s; }
.sc-conv-header-clickable:hover { background: var(--sc-bg); }
.sc-conv-chevron { color: var(--sc-fg-3); margin-left: 4px; flex-shrink: 0; opacity: 0.6; }
.sc-panel-overlay {
  position: fixed; inset: 0; background: oklch(0.2 0.02 250 / 0.25);
  z-index: 50; backdrop-filter: blur(2px);
  animation: scFadeIn 0.15s ease;
}
.sc-info-panel {
  position: fixed; top: 0; right: 0; bottom: 0;
  width: 380px; max-width: 100vw;
  background: var(--sc-bg-alt);
  z-index: 51; display: flex; flex-direction: column;
  box-shadow: -20px 0 60px -20px oklch(0.2 0.02 250 / 0.3);
  animation: scSlideInRight 0.22s ease;
  overflow-y: auto;
}
@keyframes scSlideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
.sc-info-head {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--sc-border);
  position: sticky; top: 0; background: var(--sc-bg-alt); z-index: 1;
}
.sc-info-head-title { font-size: 15px; font-weight: 600; }
.sc-info-hero {
  padding: 28px 24px 20px;
  display: flex; flex-direction: column; align-items: center;
  border-bottom: 1px solid var(--sc-border);
}
.sc-info-title { font-size: 20px; font-weight: 600; margin-top: 14px; text-align: center; letter-spacing: -0.01em; }
.sc-info-sub { font-size: 13px; color: var(--sc-fg-3); margin-top: 4px; }
.sc-info-actions {
  display: flex; gap: 8px; padding: 12px 16px;
  border-bottom: 1px solid var(--sc-border);
}
.sc-info-action {
  flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 12px 8px; border-radius: 12px;
  background: var(--sc-bg); border: 1px solid var(--sc-border); cursor: pointer;
  font: inherit; font-size: 12px; color: var(--sc-fg);
  transition: background 0.15s, border-color 0.15s;
}
.sc-info-action:hover { background: var(--sc-accent-soft); border-color: var(--sc-accent); color: var(--sc-accent); }
.sc-info-action-ic { font-size: 22px; }
.sc-info-section-title { padding: 12px 20px 8px; font-size: 12px; font-weight: 600; color: var(--sc-fg-3); text-transform: uppercase; letter-spacing: 0.05em; }
.sc-info-members { padding: 4px 8px 16px; }
.sc-info-member {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 12px; border-radius: 12px;
}
.sc-info-member:hover { background: var(--sc-bg); }
.sc-info-member-body { flex: 1; min-width: 0; }
.sc-info-member-name { font-size: 14px; font-weight: 500; }
.sc-info-member-role { font-size: 12px; color: var(--sc-fg-3); margin-top: 2px; display: flex; gap: 6px; align-items: center; }
.sc-info-tag {
  background: var(--sc-accent); color: white;
  padding: 1px 6px; border-radius: 4px;
  font-size: 10px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
}
.sc-info-rm {
  width: 30px; height: 30px; border-radius: 8px;
  background: transparent; border: 1px solid var(--sc-border); color: var(--sc-fg-3);
  cursor: pointer; display: grid; place-items: center;
}
.sc-info-rm:hover { background: oklch(0.95 0.04 25); color: oklch(0.55 0.2 25); border-color: oklch(0.85 0.12 25); }
.sc-info-danger {
  margin: 16px; padding: 12px 16px;
  background: oklch(0.95 0.04 25); color: oklch(0.55 0.2 25);
  border: 1px solid oklch(0.88 0.08 25);
  border-radius: 12px; font: inherit; font-size: 14px; font-weight: 600;
  cursor: pointer;
}
.sc-info-danger:hover { background: oklch(0.92 0.06 25); }

/* CONTEXT MENU (right-click) */
.sc-ctx-overlay { position: fixed; inset: 0; z-index: 60; }
.sc-ctx-menu {
  position: fixed; z-index: 61;
  background: var(--sc-bg-alt); border: 1px solid var(--sc-border);
  border-radius: 12px; padding: 6px; min-width: 180px;
  box-shadow: 0 12px 32px -8px oklch(0.2 0.02 250 / 0.25);
  animation: scFadeIn 0.1s ease;
}
.sc-ctx-item {
  display: flex; align-items: center; gap: 10px;
  width: 100%; padding: 8px 12px; border-radius: 8px;
  background: transparent; border: none; cursor: pointer;
  font: inherit; font-size: 13.5px; color: var(--sc-fg); text-align: left;
}
.sc-ctx-item:hover { background: var(--sc-bg); }
.sc-ctx-item.is-danger { color: oklch(0.55 0.2 25); }
.sc-ctx-item.is-danger:hover { background: oklch(0.95 0.04 25); }
.sc-ctx-icon { width: 18px; display: inline-grid; place-items: center; }
.sc-contact-body { flex: 1; min-width: 0; }
.sc-contact-name { font-size: 14.5px; font-weight: 500; color: var(--sc-fg); }
.sc-contact-role { font-size: 12px; color: var(--sc-fg-3); margin-top: 1px; }
.sc-contact-meta {
  display: flex; align-items: center; gap: 8px;
  margin-top: 2px;
  flex-wrap: wrap;
}
.sc-status-pill {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 2px 8px; border-radius: 999px;
  font-size: 11px; font-weight: 600;
  letter-spacing: 0.01em;
}
.sc-status-pill.is-online {
  background: color-mix(in oklch, oklch(0.65 0.18 145) 14%, transparent);
  color: oklch(0.55 0.18 145);
}
.sc-status-pill.is-offline {
  background: var(--sc-bg);
  color: var(--sc-fg-3);
}
.sc-status-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
}
.sc-room-online {
  color: oklch(0.55 0.18 145);
  font-size: 10px;
  margin-right: 4px;
  vertical-align: middle;
}

/* Threads (reply quote) */
.sc-msg-quote {
  display: flex; flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 6px 10px;
  margin-bottom: 6px;
  background: rgba(15,23,42,.05);
  border-left: 3px solid var(--sc-accent, #0097A7);
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  width: 100%;
  border-top: 0; border-right: 0; border-bottom: 0;
  transition: background 120ms;
}
.sc-msg-quote:hover { background: rgba(15,23,42,.09); }
.sc-msg-bubble.is-mine .sc-msg-quote {
  background: rgba(255,255,255,.18);
  border-left-color: rgba(255,255,255,.6);
}
.sc-msg-bubble.is-mine .sc-msg-quote:hover { background: rgba(255,255,255,.28); }
.sc-msg-quote-author {
  font-size: 11.5px; font-weight: 700;
  color: var(--sc-accent, #0097A7);
}
.sc-msg-bubble.is-mine .sc-msg-quote-author { color: rgba(255,255,255,.95); }
.sc-msg-quote-body {
  font-size: 12.5px;
  color: var(--sc-fg-2, #374151);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 100%;
}
.sc-msg-bubble.is-mine .sc-msg-quote-body { color: rgba(255,255,255,.88); }

.sc-reply-btn { margin-left: 4px; }

/* Reply preview над composer */
.sc-reply-preview {
  display: flex; gap: 10px; align-items: stretch;
  padding: 8px 12px;
  background: var(--sc-bg, #f6f6f8);
  border: 1px solid var(--sc-border, rgba(0,0,0,.08));
  border-radius: 12px;
  margin-bottom: 8px;
}
.sc-reply-preview-bar {
  width: 3px; flex-shrink: 0;
  background: var(--sc-accent, #0097A7);
  border-radius: 2px;
}
.sc-reply-preview-body { flex: 1; min-width: 0; }
.sc-reply-preview-author {
  font-size: 12px; font-weight: 700;
  color: var(--sc-accent, #0097A7);
}
.sc-reply-preview-text {
  font-size: 12.5px; color: var(--sc-fg-2, #374151);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  margin-top: 2px;
}
.sc-reply-preview-close {
  background: transparent; border: 0; cursor: pointer;
  color: var(--sc-fg-3, #6b7280); font-size: 20px;
  width: 28px; height: 28px; line-height: 1;
  border-radius: 8px; align-self: center;
}
.sc-reply-preview-close:hover { background: var(--sc-bg-2, #e5e7eb); }

/* Polls */
.sc-poll {
  margin-top: 8px;
  padding: 8px 10px;
  background: rgba(15,23,42,.04);
  border-radius: 10px;
  display: flex; flex-direction: column; gap: 6px;
}
.sc-msg-bubble.is-mine .sc-poll { background: rgba(255,255,255,.14); }
.sc-poll-q {
  font-size: 13.5px; font-weight: 700;
  color: var(--sc-fg, #0F172A);
}
.sc-msg-bubble.is-mine .sc-poll-q { color: rgba(255,255,255,.98); }
.sc-poll-hint {
  font-size: 11px; color: var(--sc-fg-3, #6b7280);
}
.sc-msg-bubble.is-mine .sc-poll-hint { color: rgba(255,255,255,.7); }
.sc-poll-option {
  position: relative;
  display: flex; align-items: center; gap: 8px;
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid var(--sc-border, rgba(0,0,0,.08));
  background: var(--sc-surface, #fff);
  color: var(--sc-fg, #0F172A);
  cursor: pointer;
  font-size: 13px;
  overflow: hidden;
  text-align: left;
  transition: border-color 120ms, transform 80ms;
}
.sc-poll-option:hover:not(:disabled) { border-color: var(--sc-accent, #0097A7); }
.sc-poll-option:active:not(:disabled) { transform: scale(0.99); }
.sc-poll-option.is-mine {
  border-color: var(--sc-accent, #0097A7);
  background: rgba(0,151,167,.08);
}
.sc-poll-option.is-closed { cursor: not-allowed; opacity: 0.7; }
.sc-poll-bar {
  position: absolute; left: 0; top: 0; bottom: 0;
  background: rgba(0,151,167,.16);
  border-radius: 8px;
  transition: width 220ms ease;
  z-index: 0;
}
.sc-poll-option.is-mine .sc-poll-bar { background: rgba(0,151,167,.28); }
.sc-poll-label {
  position: relative; z-index: 1;
  flex: 1; min-width: 0;
  display: flex; align-items: center; gap: 6px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.sc-poll-check {
  font-size: 14px; flex-shrink: 0;
  color: var(--sc-accent, #0097A7);
}
.sc-poll-pct {
  position: relative; z-index: 1;
  font-size: 11.5px; font-weight: 600;
  color: var(--sc-fg-3, #6b7280);
  flex-shrink: 0;
}
.sc-poll-meta {
  font-size: 11px; color: var(--sc-fg-3, #6b7280);
  margin-top: 2px;
}
.sc-msg-bubble.is-mine .sc-poll-meta { color: rgba(255,255,255,.7); }

/* Highlight: подсветка сообщения после scroll-к-цитате/поиску */
@keyframes scMsgHighlight {
  0% { background-color: rgba(245, 158, 11, 0.22); }
  100% { background-color: transparent; }
}
.sc-msg-highlight .sc-msg-bubble {
  animation: scMsgHighlight 1.6s ease-out;
}

/* Mobile */
@media (max-width: 760px) {
  .sc-root { grid-template-columns: 1fr; }
  .sc-root:has(.sc-conv-header) .sc-sidebar { display: none; }
}
`
