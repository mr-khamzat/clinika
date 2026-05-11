/**
 * ========================================
 * БЛОК: ApiKeyDisplayModal — показ API-ключа партнёрства ОДИН РАЗ (Глава 10)
 * ========================================
 * После POST /admin/aggregator/partnerships бэкенд возвращает plaintext api_key.
 * Этот компонент:
 *   1. Показывает ключ моноширинным шрифтом
 *   2. Кнопка «Скопировать» (clipboard + визуальный feedback)
 *   3. Обратный отсчёт «Этот ключ больше не будет показан»
 *   4. Чекбокс подтверждения «Я скопировал ключ» — без него нельзя закрыть
 *
 * Props:
 *   - open: bool
 *   - apiKey: string | null
 *   - partnerName: string — для контекста
 *   - onClose()
 * ========================================
 */
import { useEffect, useState } from 'react'
import { Modal, Button, useToast } from '../../design'

export default function ApiKeyDisplayModal({ open, apiKey, partnerName, onClose }) {
  const { toast } = useToast()
  const [copied, setCopied] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [counter, setCounter] = useState(0)

  // При открытии — сбрасываем состояние и стартуем визуальный счётчик "секунд от открытия"
  useEffect(() => {
    if (!open) return
    setCopied(false)
    setConfirmed(false)
    setCounter(0)
    const t = setInterval(() => setCounter(c => c + 1), 1000)
    return () => clearInterval(t)
  }, [open, apiKey])

  const copy = async () => {
    if (!apiKey) return
    try {
      await navigator.clipboard.writeText(apiKey)
      setCopied(true)
      toast({ kind: 'success', text: 'API-ключ скопирован' })
      setTimeout(() => setCopied(false), 2500)
    } catch {
      toast({ kind: 'error', text: 'Не удалось скопировать. Выделите и скопируйте вручную.' })
    }
  }

  const tryClose = () => {
    if (!confirmed) {
      toast({ kind: 'error', text: 'Подтвердите, что вы скопировали ключ' })
      return
    }
    onClose && onClose()
  }

  if (!open || !apiKey) return null

  return (
    <Modal
      open={open}
      onClose={tryClose}
      title="API-ключ партнёрства"
      size="md"
      hideCloseButton
    >
      <div className="flex flex-col gap-4" style={{ minWidth: 320, maxWidth: 540 }}>
        {/* Предупреждение */}
        <div
          className="rounded-xl p-4 flex items-start gap-3"
          style={{
            background: 'linear-gradient(180deg, #1f2937 0%, #0f172a 100%)',
            color: '#fff',
          }}
        >
          <span
            className="material-symbols-outlined flex-shrink-0"
            style={{ fontSize: 26, color: '#fbbf24' }}
          >shield_lock</span>
          <div className="min-w-0">
            <div className="font-bold mb-1" style={{ fontSize: 13.5 }}>
              Ключ для партнёра «{partnerName || '—'}»
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.5, color: '#cbd5e1' }}>
              Передайте ключ агрегатору. После закрытия этого окна
              <b style={{ color: '#fbbf24' }}> ключ больше не будет показан</b> — мы храним
              только хеш для проверки запросов.
            </div>
          </div>
        </div>

        {/* Сам ключ */}
        <div>
          <div
            className="font-bold uppercase mb-2"
            style={{ fontSize: 10.5, color: '#94a3b8', letterSpacing: '0.08em' }}
          >API key</div>
          <div
            className="rounded-xl p-3 flex items-center gap-2"
            style={{
              background: '#0f172a',
              border: '1px solid #1e293b',
            }}
          >
            <code
              className="flex-1 break-all select-all"
              style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 13,
                color: '#a7f3d0',
                lineHeight: 1.5,
              }}
            >{apiKey}</code>
            <button
              onClick={copy}
              className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-transform active:scale-95"
              style={{
                background: copied ? '#15803d' : '#0097A7',
                color: '#fff',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                {copied ? 'check' : 'content_copy'}
              </span>
              {copied ? 'Скопировано' : 'Скопировать'}
            </button>
          </div>
        </div>

        {/* Таймер-индикатор */}
        <div
          className="rounded-xl p-3 flex items-center gap-3"
          style={{ background: '#fef3c7', border: '1px solid #fde68a' }}
        >
          <span
            className="material-symbols-outlined flex-shrink-0"
            style={{ fontSize: 22, color: '#92400e' }}
          >hourglass_top</span>
          <div className="flex-1 min-w-0">
            <div className="font-bold" style={{ fontSize: 12, color: '#92400e' }}>
              Открыто {counter} сек назад
            </div>
            <div style={{ fontSize: 11, color: '#92400e' }}>
              Этот ключ больше не будет показан — скопируйте сейчас.
            </div>
          </div>
        </div>

        {/* Подтверждение */}
        <label
          className="flex items-start gap-3 rounded-xl p-3 cursor-pointer transition-all"
          style={{
            background: confirmed ? '#f0fdf4' : '#f8fafc',
            border: '1px solid ' + (confirmed ? '#86efac' : '#e2e8f0'),
          }}
        >
          <input
            type="checkbox"
            checked={confirmed}
            onChange={e => setConfirmed(e.target.checked)}
            style={{ width: 18, height: 18, accentColor: '#15803d', marginTop: 2 }}
          />
          <span style={{ fontSize: 13, color: '#0f172a', fontWeight: 600, lineHeight: 1.4 }}>
            Я скопировал ключ и понимаю, что повторно его получить нельзя
          </span>
        </label>

        <div className="flex items-center justify-end pt-2" style={{ borderTop: '1px solid #f1f5f9' }}>
          <Button onClick={tryClose} disabled={!confirmed}>
            Закрыть и забыть ключ
          </Button>
        </div>
      </div>
    </Modal>
  )
}
