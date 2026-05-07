/**
 * ========================================
 * БЛОК: Чат техподдержки v2
 * ========================================
 * + Загрузка файлов и фото
 * + Статус оператора (онлайн/оффлайн)
 * + Превью изображений в чате
 * ========================================
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import axios from 'axios'
import useAuthStore from '../store/auth'
import { API_BASE, BASE_PATH, SLUG } from '../config'
import { useToast } from '../design'

export default function SupportChat() {
  const { token } = useAuthStore()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [unread, setUnread] = useState(0)
  const [operatorOnline, setOperatorOnline] = useState(false)
  const [imgPreview, setImgPreview] = useState(null) // полноэкранный просмотр
  const bottomRef = useRef(null)
  const inputRef = useRef(null)
  const fileRef = useRef(null)

  const headers = { Authorization: `Bearer ${token}` }

  const fetchMessages = useCallback(async () => {
    try {
      const res = await axios.get(API_BASE + '/support/messages', { headers })
      setMessages(res.data)
      setUnread(0)
    } catch {}
  }, [token])

  const fetchUnread = useCallback(async () => {
    try {
      const res = await axios.get(API_BASE + '/support/unread', { headers })
      setUnread(res.data.count)
    } catch {}
  }, [token])

  const fetchStatus = useCallback(async () => {
    try {
      const res = await axios.get(API_BASE + '/support/status')
      setOperatorOnline(res.data.operator_online)
    } catch {}
  }, [])

  // Фоновые интервалы
  useEffect(() => {
    if (!token) return
    fetchUnread()
    fetchStatus()
    const unreadId = setInterval(fetchUnread, 30000)
    const statusId = setInterval(fetchStatus, 60000)
    return () => { clearInterval(unreadId); clearInterval(statusId) }
  }, [token])

  // Polling сообщений при открытом чате
  useEffect(() => {
    if (!open || !token) return
    fetchMessages()
    fetchStatus()
    const id = setInterval(fetchMessages, 8000)
    const statusId2 = setInterval(fetchStatus, 30000)
    return () => { clearInterval(id); clearInterval(statusId2) }
  }, [open, token, fetchStatus])

  // Прокрутка вниз
  useEffect(() => {
    if (open) setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }, [messages, open])

  // Фокус при открытии
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100)
  }, [open])

  // Отправить текст
  const handleSend = async (e) => {
    e.preventDefault()
    if (!text.trim() || sending) return
    const t = text.trim()
    setText('')
    setSending(true)
    try {
      await axios.post(API_BASE + '/support/send', { text: t }, { headers })
      await fetchMessages()
    } catch { setText(t) }
    finally { setSending(false) }
  }

  // Загрузить файл
  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    const MAX = 20 * 1024 * 1024
    if (file.size > MAX) {
      toast('Файл слишком большой (макс. 20 МБ)', 'warn')
      return
    }

    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      await axios.post(API_BASE + '/support/upload', form, {
        headers: { ...headers, 'Content-Type': 'multipart/form-data' }
      })
      await fetchMessages()
    } catch (err) {
      toast('Ошибка загрузки файла', 'error')
    } finally {
      setUploading(false)
    }
  }

  const fmt = (iso) => {
    const d = new Date(iso)
    const now = new Date()
    return d.toDateString() === now.toDateString()
      ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  }

  // Рендер содержимого сообщения
  const renderContent = (m) => {
    if (m.file_type === 'image' && m.file_url) {
      return (
        <div>
          <img
            src={m.file_url}
            alt={m.file_name}
            className="max-w-[220px] max-h-[180px] rounded-xl cursor-pointer object-cover"
            onClick={() => setImgPreview(m.file_url)}
            onError={e => { e.target.style.display = 'none' }}
          />
          {m.text && m.text !== m.file_name && (
            <p className="mt-1 text-sm leading-relaxed">{m.text}</p>
          )}
        </div>
      )
    }
    if (m.file_type === 'document' && m.file_url) {
      return (
        <a
          href={m.file_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 hover:opacity-80 transition"
        >
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${m.is_from_user ? 'bg-white/20' : 'bg-blue-50'}`}>
            <span className={`material-symbols-outlined text-lg ${m.is_from_user ? 'text-white' : 'text-blue-600'}`} style={{fontVariationSettings:"'FILL' 1"}}>description</span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate max-w-[160px]">{m.file_name || 'Документ'}</p>
            <p className={`text-xs ${m.is_from_user ? 'text-blue-100' : 'text-gray-400'}`}>Нажмите чтобы открыть</p>
          </div>
        </a>
      )
    }
    return <p className="text-sm leading-relaxed">{m.text}</p>
  }

  if (!token) return null

  return (
    <>
      {/* ─── Плавающая кнопка ─── */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-24 right-4 z-40 w-14 h-14 active:scale-95 text-white rounded-full flex items-center justify-center transition-all duration-150" style={{background:"linear-gradient(135deg,#1565c0,#1e6fe8)",boxShadow:"0 8px 24px rgba(21,101,192,0.35)"}}
        title="Служба поддержки"
      >
        <span className="material-symbols-outlined text-[26px]" style={{fontVariationSettings:"'FILL' 1"}}>support_agent</span>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[20px] h-5 bg-red-500 text-white text-[11px] font-bold rounded-full flex items-center justify-center px-1 shadow">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {/* ─── Диалоговое окно ─── */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-end justify-end sm:justify-end p-0 sm:p-4 sm:pb-24">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm sm:hidden" onClick={() => setOpen(false)} />

          <div className="relative w-full sm:w-[360px] h-[85vh] sm:h-[540px] bg-white sm:rounded-3xl flex flex-col overflow-hidden" style={{boxShadow:"0 24px 64px rgba(25,28,30,0.12),0 0 0 1px rgba(194,198,212,0.3)"}}>

            {/* ─── Шапка ─── */}
            <div className="text-white px-4 py-3.5 flex items-center gap-3 flex-shrink-0" style={{background:"linear-gradient(135deg,#1565c0,#1e6fe8)"}}>
              <div className="relative">
                <div className="w-10 h-10 bg-white/20 rounded-2xl flex items-center justify-center">
                  <span className="material-symbols-outlined text-xl" style={{fontVariationSettings:"'FILL' 1"}}>support_agent</span>
                </div>
                {/* Индикатор онлайн */}
                <span className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-blue-600 ${operatorOnline ? 'bg-emerald-400' : 'bg-gray-400'}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm">Служба поддержки</div>
                <div className={`text-xs flex items-center gap-1 ${operatorOnline ? 'text-emerald-300' : 'text-blue-200'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${operatorOnline ? 'bg-emerald-400' : 'bg-gray-400'}`} />
                  {operatorOnline ? 'Онлайн — ответим быстро' : 'Не в сети — ответим позже'}
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="flex-shrink-0 w-8 h-8 flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 rounded-xl transition"
              >
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
            </div>

            {/* ─── Сообщения ─── */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-[#f7f9fb]">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center py-8">
                  <div className="w-20 h-20 bg-[#dae5ff] rounded-3xl flex items-center justify-center mb-4">
                    <span className="material-symbols-outlined text-[#1565c0] text-4xl" style={{fontVariationSettings:"'FILL' 1"}}>chat_bubble</span>
                  </div>
                  <p className="text-gray-600 dark:text-gray-300 font-medium text-sm">Привет! Чем можем помочь?</p>
                  <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">Можно написать или прикрепить файл</p>
                </div>
              ) : (
                messages.map((m) => (
                  <div key={m.id} className={`flex ${m.is_from_user ? 'justify-end' : 'justify-start'}`}>
                    {!m.is_from_user && (
                      <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mr-2 self-end mb-0.5" style={{background:"linear-gradient(135deg,#1565c0,#1e6fe8)"}}>
                        <span className="material-symbols-outlined text-white text-sm" style={{fontVariationSettings:"'FILL' 1"}}>support_agent</span>
                      </div>
                    )}
                    <div className="max-w-[80%]">
                      <div className={`px-3.5 py-2.5 rounded-2xl ${
                        m.is_from_user
                          ? 'text-white rounded-br-sm' + " style='background:linear-gradient(135deg,#1565c0,#1e6fe8)'"
                          : 'bg-white text-[#191c1e] rounded-bl-sm shadow-sm border border-[#eceef0]'
                      }`}>
                        {renderContent(m)}
                      </div>
                      <div className={`text-[11px] mt-0.5 ${m.is_from_user ? 'text-right text-gray-400' : 'text-gray-400'}`}>
                        {fmt(m.created_at)}
                      </div>
                    </div>
                  </div>
                ))
              )}
              {uploading && (
                <div className="flex justify-end">
                  <div className="text-white px-4 py-2.5 rounded-2xl rounded-br-sm flex items-center gap-2 text-sm" style={{background:"#1565c0CC"}}>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Загрузка...
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* ─── Поле ввода ─── */}
            <form
              onSubmit={handleSend}
              className="flex items-end gap-2 px-3 py-3 border-t border-[#eceef0] bg-white flex-shrink-0"
            >
              {/* Кнопка прикрепить файл */}
              <input
                ref={fileRef}
                type="file"
                accept="image/*,.pdf,.doc,.docx"
                className="hidden"
                onChange={handleFile}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="flex-shrink-0 w-10 h-10 flex items-center justify-center text-[#727783] hover:text-[#1565c0] hover:bg-[#dae5ff] rounded-2xl transition disabled:opacity-40"
                title="Прикрепить файл или фото"
              >
                <span className="material-symbols-outlined text-xl">attach_file</span>
              </button>

              {/* Поле текста */}
              <textarea
                ref={inputRef}
                value={text}
                onChange={(e) => {
                  setText(e.target.value)
                  e.target.style.height = 'auto'
                  e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px'
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSend(e)
                  }
                }}
                placeholder="Написать сообщение..."
                rows={1}
                className="flex-1 bg-[#f2f4f6] rounded-2xl px-4 py-2.5 text-sm outline-none resize-none text-[#191c1e] placeholder-[#727783] leading-5 max-h-24 overflow-y-auto border-2 border-transparent focus:border-[#1565c0]/30 focus:bg-white transition-all"
                style={{ height: '40px' }}
              />

              {/* Кнопка отправить */}
              <button
                type="submit"
                disabled={!text.trim() || sending}
                className="flex-shrink-0 w-10 h-10 disabled:opacity-40 text-white rounded-2xl flex items-center justify-center transition-all active:scale-95" style={{background:"linear-gradient(135deg,#1565c0,#1e6fe8)"}}
              >
                {sending ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <span className="material-symbols-outlined text-xl" style={{fontVariationSettings:"'FILL' 1"}}>send</span>
                )}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ─── Полноэкранный просмотр изображения ─── */}
      {imgPreview && (
        <div
          className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setImgPreview(null)}
        >
          <button
            className="absolute top-4 right-4 text-white/70 hover:text-white"
            onClick={() => setImgPreview(null)}
          >
            <span className="material-symbols-outlined text-3xl">close</span>
          </button>
          <img
            src={imgPreview}
            alt="Просмотр"
            className="max-w-full max-h-full rounded-2xl object-contain"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </>
  )
}
