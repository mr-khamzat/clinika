/**
 * PriceCalculatorDrawer — multi-select услуг + расчёт скидки по подписке + отправка в чат.
 *
 * Открывается из thread'а в ClinicChatSection.
 * Делает POST /clinic/chat/threads/{threadId}/price-quote (live-расчёт при изменении выбора)
 * и POST /clinic/chat/threads/{threadId}/send-quote (отправка карточки пациенту).
 *
 * Подключение делает главный агент (не трогаем ClinicChatSection здесь, чтобы избежать
 * мерж-конфликтов с другими параллельными правками).
 */
import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import api from '../../api'

export default function PriceCalculatorDrawer({ open, onClose, threadId, clinicId, onSent }) {
  const [services, setServices] = useState([])
  const [picked, setPicked] = useState([]) // массив service_id
  const [search, setSearch] = useState('')
  const [quote, setQuote] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [loadingServices, setLoadingServices] = useState(false)

  // Загружаем услуги клиники при открытии
  useEffect(() => {
    if (!open || !clinicId) return
    setLoadingServices(true)
    setErr(null)
    api.get('/clinics/' + clinicId + '/services')
      .then(r => {
        const data = Array.isArray(r.data) ? r.data : (r.data?.items || [])
        setServices(data)
      })
      .catch(() => setServices([]))
      .finally(() => setLoadingServices(false))
    setPicked([])
    setQuote(null)
  }, [open, clinicId])

  // Пересчёт стоимости при изменении выбранных услуг
  useEffect(() => {
    if (!open || !threadId) return
    if (picked.length === 0) {
      setQuote(null)
      return
    }
    let cancelled = false
    api.post('/clinic/chat/threads/' + threadId + '/price-quote', { service_ids: picked })
      .then(r => { if (!cancelled) setQuote(r.data) })
      .catch(e => {
        if (!cancelled) setErr(e.response?.data?.detail || 'Ошибка расчёта')
      })
    return () => { cancelled = true }
  }, [picked, threadId, open])

  const filtered = useMemo(() => {
    const q = (search || '').trim().toLowerCase()
    if (!q) return services.slice(0, 200)
    return services
      .filter(s => (s.name || '').toLowerCase().includes(q) || (s.code || '').toLowerCase().includes(q))
      .slice(0, 200)
  }, [services, search])

  if (!open) return null

  const toggle = (id) => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])

  const send = async () => {
    if (picked.length === 0) return
    setBusy(true)
    setErr(null)
    try {
      await api.post('/clinic/chat/threads/' + threadId + '/send-quote', { service_ids: picked })
      onSent?.()
      onClose?.()
    } catch (e) {
      setErr(e.response?.data?.detail || 'Не удалось отправить')
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 flex items-stretch justify-end" style={{ zIndex: 1500 }}>
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(15,23,42,.55)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      />
      <div
        className="relative w-full h-full overflow-hidden shadow-2xl flex flex-col"
        style={{ background: '#ffffff', color: '#0f172a', maxWidth: 720 }}
      >
        {/* Шапка */}
        <div
          style={{
            background: 'linear-gradient(135deg, #0097A7, #0A2342)',
            color: '#fff',
            padding: '18px 24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>🧮 Калькулятор стоимости</div>
            <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>
              Выбери услуги — пациент увидит карточку с итогом
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 38, height: 38, borderRadius: 10,
              background: 'rgba(255,255,255,.15)', color: '#fff',
              fontSize: 22, border: 'none', cursor: 'pointer',
            }}
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>

        {/* Body — список услуг */}
        <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск услуги…"
            style={{
              width: '100%', padding: '12px 14px', borderRadius: 12,
              border: '1px solid #cbd5e1', background: '#fff', color: '#0f172a',
              fontSize: 15, marginBottom: 12, outline: 'none',
            }}
          />
          {loadingServices && (
            <div style={{ textAlign: 'center', color: '#64748b', padding: 20 }}>Загружаем услуги…</div>
          )}
          {!loadingServices && filtered.length === 0 && (
            <div style={{ textAlign: 'center', color: '#94a3b8', padding: 20, fontSize: 14 }}>
              {services.length === 0 ? 'Нет услуг в клинике' : 'Ничего не найдено'}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filtered.map(s => {
              const isPicked = picked.includes(s.id)
              return (
                <label
                  key={s.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 12px', borderRadius: 10,
                    background: isPicked ? '#ecfeff' : '#f8fafc',
                    border: '1px solid ' + (isPicked ? '#06b6d4' : '#e2e8f0'),
                    cursor: 'pointer',
                    transition: 'background .15s',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isPicked}
                    onChange={() => toggle(s.id)}
                    style={{ width: 18, height: 18, cursor: 'pointer' }}
                  />
                  <div style={{ flex: 1, fontSize: 14, color: '#0f172a' }}>
                    {s.name}
                    {s.category && (
                      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                        {s.category}
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>
                    {Number(s.price || 0)} ₽
                  </div>
                </label>
              )
            })}
          </div>
        </div>

        {/* Итог по quote */}
        {quote && (
          <div style={{ borderTop: '1px solid #e2e8f0', padding: 16, background: '#f8fafc' }}>
            {quote.subscription_plan_name && (
              <div
                style={{
                  marginBottom: 10, padding: 8,
                  background: '#ecfdf5', border: '1px solid #16a34a',
                  borderRadius: 8, fontSize: 13, color: '#166534',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                <span>✓</span>
                <span>Пациент с подпиской «{quote.subscription_plan_name}» — скидка применена</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: '#475569', marginBottom: 4 }}>
              <span>Сумма ({quote.items.length} {quote.items.length === 1 ? 'услуга' : 'услуг'}):</span>
              <span>{quote.subtotal} ₽</span>
            </div>
            {quote.discount_total > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: '#16a34a', marginBottom: 4 }}>
                <span>Скидка по подписке:</span>
                <span>−{quote.discount_total} ₽</span>
              </div>
            )}
            <div
              style={{
                display: 'flex', justifyContent: 'space-between',
                fontSize: 18, fontWeight: 700, color: '#0f172a',
                marginTop: 8, paddingTop: 8, borderTop: '1px dashed #cbd5e1',
              }}
            >
              <span>Итого:</span>
              <span style={{ color: '#0097A7' }}>{quote.total} ₽</span>
            </div>
            {quote.expires_in_hours > 0 && (
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6, textAlign: 'right' }}>
                Расчёт действителен {quote.expires_in_hours}ч
              </div>
            )}
          </div>
        )}

        {err && (
          <div style={{ padding: 12, background: '#fee2e2', color: '#991b1b', margin: 16, borderRadius: 8, fontSize: 13 }}>
            {err}
          </div>
        )}

        {/* Footer — кнопки */}
        <div
          style={{
            borderTop: '1px solid #e2e8f0',
            padding: 16,
            display: 'flex',
            gap: 10,
            background: '#fff',
          }}
        >
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: 14, borderRadius: 12,
              background: '#f1f5f9', color: '#475569',
              fontWeight: 600, border: 'none', cursor: 'pointer',
              fontSize: 14,
            }}
          >
            Отмена
          </button>
          <button
            onClick={send}
            disabled={busy || picked.length === 0}
            style={{
              flex: 2, padding: 14, borderRadius: 12,
              background: (busy || picked.length === 0)
                ? '#cbd5e1'
                : 'linear-gradient(135deg, #0097A7, #0A2342)',
              color: '#fff', fontWeight: 700, fontSize: 15,
              border: 'none',
              cursor: (busy || picked.length === 0) ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? 'Отправка…' : `Отправить пациенту${picked.length ? ` (${picked.length})` : ''}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
