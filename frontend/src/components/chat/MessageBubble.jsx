/**
 * ========================================
 * БЛОК: MessageBubble — пузырь сообщения чата (Глава 9)
 * ========================================
 * Используется в PatientChatSection.jsx и ClinicChatSection.jsx.
 *
 * Props:
 *   message       — { id, sender_type, sender_name, body, attachments,
 *                     created_at, read_at, reactions?: [{emoji,count,by_me}] }
 *   isOwn         — bool: сообщение собственное (отображается справа)
 *   showAvatar    — bool: показывать аватар отправителя (для не-собственных)
 *   onReact       — (messageId, emoji) => void: toggle реакции (если задан, показываем UI)
 * ========================================
 */
import { useMemo, useState } from 'react'
import MarkdownText from './MarkdownText'

const QUICK_REACTIONS = ['👍', '❤️', '✅', '🙏', '😂', '🔥']

function fmtTime(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch { return '' }
}

function avatarColor(name) {
  const palette = ['#0097A7', '#1565C0', '#7b1fa2', '#2e7d32', '#e65100', '#c2185b']
  let h = 0
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
  return palette[Math.abs(h) % palette.length]
}

function isImage(att) {
  const u = att?.url || att?.file_url || ''
  return /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(u) || (att?.mime || '').startsWith('image/')
}

function fileIconName(att) {
  const u = (att?.url || '').toLowerCase()
  if (u.endsWith('.pdf')) return 'picture_as_pdf'
  if (/\.(docx?|odt|rtf)$/i.test(u)) return 'description'
  if (/\.(xlsx?|csv|ods)$/i.test(u)) return 'table_chart'
  if (/\.(zip|rar|7z|tar|gz)$/i.test(u)) return 'folder_zip'
  return 'attach_file'
}

export default function MessageBubble({ message, isOwn, showAvatar = true, onReact }) {
  const isSystem = message.sender_type === 'system' || message.sender_type === 'bot'
  const name = message.sender_name || (isOwn ? 'Вы' : 'Клиника')
  const color = useMemo(() => avatarColor(name), [name])
  const initials = (name || '?').split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase()
  const atts = Array.isArray(message.attachments) ? message.attachments : []
  const reactions = Array.isArray(message.reactions) ? message.reactions : []
  const [pickerOpen, setPickerOpen] = useState(false)

  // Системное сообщение — серая пилюля по центру
  if (isSystem) {
    return (
      <div className="flex justify-center my-2 msg-in">
        <div
          className="px-3 py-1.5 rounded-full"
          style={{
            background: 'rgba(148,163,184,.12)',
            color: 'var(--fg-3, #64748b)',
            fontSize: 11.5,
            maxWidth: '85%',
            textAlign: 'center',
          }}
        >
          {message.body}
        </div>
      </div>
    )
  }

  return (
    <div
      className="flex msg-in"
      style={{ justifyContent: isOwn ? 'flex-end' : 'flex-start', gap: 8, margin: '6px 0' }}
    >
      {!isOwn && (
        <div style={{ width: 32, flexShrink: 0 }}>
          {showAvatar && (
            <div
              className="grid place-items-center font-bold text-white"
              style={{
                width: 32, height: 32, borderRadius: 10,
                background: `linear-gradient(135deg, ${color}, ${color}AA)`,
                fontSize: 11,
              }}
              aria-hidden
            >
              {initials}
            </div>
          )}
        </div>
      )}
      <div style={{ maxWidth: '78%', minWidth: 0 }}>
        {!isOwn && showAvatar && (
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-2, #475569)', marginBottom: 2, paddingLeft: 4 }}>
            {name}
          </div>
        )}
        <div
          className="px-3 py-2"
          style={{
            borderRadius: 16,
            borderTopLeftRadius: !isOwn ? 4 : 16,
            borderTopRightRadius: isOwn ? 4 : 16,
            background: isOwn
              ? 'linear-gradient(135deg, #0097A7, #0A2342)'
              : 'var(--bg-1, #fff)',
            color: isOwn ? '#fff' : 'var(--fg, #0F172A)',
            boxShadow: isOwn ? '0 2px 10px rgba(0,151,167,.25)' : '0 1px 4px rgba(15,23,42,.08)',
            border: isOwn ? '1px solid rgba(255,255,255,.12)' : '1px solid var(--border, #e2e8f0)',
            fontSize: 14, lineHeight: 1.45, wordBreak: 'break-word', whiteSpace: 'pre-wrap',
          }}
        >
          {/* Текст (с Markdown) */}
          {message.body && (
            <div style={{ color: isOwn ? '#fff' : 'var(--fg, #0F172A)' }}>
              <MarkdownText>{message.body}</MarkdownText>
            </div>
          )}

          {/* Вложения */}
          {atts.length > 0 && (
            <div className="mt-2 space-y-2">
              {atts.map((att, i) => isImage(att) ? (
                <a
                  key={i}
                  href={att.url || att.file_url}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-xl overflow-hidden"
                  style={{ maxWidth: 240 }}
                >
                  <img
                    src={att.url || att.file_url}
                    alt={att.name || 'image'}
                    loading="lazy"
                    style={{ width: '100%', display: 'block', maxHeight: 240, objectFit: 'cover' }}
                  />
                </a>
              ) : (
                <a
                  key={i}
                  href={att.url || att.file_url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
                  style={{
                    background: isOwn ? 'rgba(255,255,255,.15)' : 'rgba(15,23,42,.05)',
                    color: isOwn ? '#fff' : 'var(--fg, #0F172A)',
                    fontSize: 13,
                    textDecoration: 'none',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 20 }}>{fileIconName(att)}</span>
                  <span className="truncate">{att.name || att.file_name || 'Файл'}</span>
                </a>
              ))}
            </div>
          )}

          {/* Время + статус прочтения */}
          <div
            className="flex items-center gap-1"
            style={{
              fontSize: 10.5,
              opacity: 0.7,
              marginTop: 4,
              justifyContent: isOwn ? 'flex-end' : 'flex-start',
              color: isOwn ? 'rgba(255,255,255,.85)' : 'var(--fg-3, #94a3b8)',
            }}
          >
            <span>{fmtTime(message.created_at)}</span>
            {isOwn && (
              <span className="material-symbols-outlined" style={{ fontSize: 12 }}>
                {message.read_at ? 'done_all' : 'done'}
              </span>
            )}
          </div>
        </div>

        {/* Реакции (под бабблом) */}
        {(reactions.length > 0 || onReact) && (
          <div
            className="flex items-center gap-1 flex-wrap relative"
            style={{
              marginTop: 4,
              justifyContent: isOwn ? 'flex-end' : 'flex-start',
              paddingLeft: isOwn ? 0 : 4,
              paddingRight: isOwn ? 4 : 0,
            }}
          >
            {reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                onClick={() => onReact?.(message.id, r.emoji)}
                title={r.by_me ? 'Убрать вашу реакцию' : 'Добавить реакцию'}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  padding: '2px 7px',
                  borderRadius: 10,
                  fontSize: 12,
                  background: r.by_me ? 'rgba(0,151,167,.18)' : 'var(--bg-1, #f1f5f9)',
                  border: `1px solid ${r.by_me ? 'rgba(0,151,167,.5)' : 'var(--border, #e2e8f0)'}`,
                  cursor: 'pointer',
                  color: 'var(--fg, #0F172A)',
                }}
              >
                <span style={{ fontSize: 13, lineHeight: 1 }}>{r.emoji}</span>
                <span style={{ fontSize: 11, fontWeight: 600 }}>{r.count}</span>
              </button>
            ))}
            {onReact && (
              <button
                type="button"
                onClick={() => setPickerOpen(v => !v)}
                title="Добавить реакцию"
                aria-label="Добавить реакцию"
                style={{
                  display: 'inline-grid',
                  placeItems: 'center',
                  width: 22, height: 22,
                  borderRadius: 8,
                  background: 'var(--bg-1, #f1f5f9)',
                  border: '1px solid var(--border, #e2e8f0)',
                  cursor: 'pointer',
                  color: 'var(--fg-3, #94a3b8)',
                  fontSize: 12,
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>add_reaction</span>
              </button>
            )}
            {pickerOpen && (
              <div
                onMouseLeave={() => setPickerOpen(false)}
                style={{
                  position: 'absolute',
                  top: '100%', marginTop: 4,
                  [isOwn ? 'right' : 'left']: 0,
                  background: 'var(--surface, #fff)',
                  border: '1px solid var(--border, #e2e8f0)',
                  borderRadius: 12,
                  padding: 4,
                  display: 'flex',
                  gap: 2,
                  boxShadow: '0 6px 20px rgba(15,23,42,.12)',
                  zIndex: 10,
                }}
              >
                {QUICK_REACTIONS.map(e => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => { onReact?.(message.id, e); setPickerOpen(false) }}
                    style={{
                      width: 32, height: 32,
                      borderRadius: 8,
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 18,
                    }}
                  >
                    {e}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
