/**
 * ========================================
 * КОМПОНЕНТ: SuccessReceipt — финальный шаг успешной активации
 * ========================================
 * Используется в ManagerSubscriptionCashSection (Step 5 wizard'а).
 *
 * Props:
 *   patient     — выбранный пациент {full_name, phone}
 *   planTitle   — название тарифа (рус)
 *   expiresAt   — ISO-дата окончания
 *   receiptUrl  — URL квитанции (PDF)
 *   discountWarning — строка-предупреждение от backend (если есть)
 *   onReset     — «Активировать ещё» (сброс мастера в начало)
 *   onTelegram  — «Отправить в Telegram» (опц., если backend поддерживает)
 * ========================================
 */
function fmtDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('ru-RU', {
      day: '2-digit', month: 'long', year: 'numeric',
    })
  } catch { return iso }
}

export default function SuccessReceipt({
  patient,
  planTitle,
  expiresAt,
  receiptUrl,
  discountWarning,
  onReset,
  onTelegram,
}) {
  const handlePrintReceipt = () => {
    if (!receiptUrl) return
    window.open(receiptUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="flex flex-col items-center text-center py-6">
      {/* ─── Большая галка ─── */}
      <div
        className="inline-grid place-items-center mb-5 relative"
        style={{
          width: 120, height: 120, borderRadius: '50%',
          background: 'linear-gradient(135deg, #10B981, #059669)',
          boxShadow: '0 18px 56px rgba(16,185,129,.4)',
          animation: 'successPop .5s cubic-bezier(.34,1.56,.64,1)',
        }}
      >
        <span
          className="material-symbols-outlined"
          style={{
            fontSize: 72, color: '#fff', fontVariationSettings: "'FILL' 1",
            animation: 'checkDraw .6s ease-out .2s both',
          }}
        >
          check
        </span>
        {/* Конфетти-блики */}
        <div
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            background: 'radial-gradient(circle at 20% 25%, rgba(255,255,255,.3) 0%, transparent 40%)',
          }}
        />
      </div>

      {/* ─── Заголовок ─── */}
      <h2
        className="font-extrabold mb-2"
        style={{
          fontSize: 28, letterSpacing: '-0.02em', color: 'var(--fg)',
          lineHeight: 1.15,
        }}
      >
        Тариф активирован!
      </h2>
      <p
        style={{
          fontSize: 15.5, color: 'var(--fg-2)', maxWidth: 460,
          lineHeight: 1.5, marginBottom: 8,
        }}
      >
        Подписка <span style={{ fontWeight: 700, color: '#7C3AED' }}>{planTitle || '—'}</span> для
        <span style={{ fontWeight: 700, color: 'var(--fg)' }}> {patient?.full_name || '—'}</span> действует
        до <span style={{ fontWeight: 700, color: 'var(--fg)' }}>{fmtDate(expiresAt)}</span>.
      </p>
      {patient?.phone && (
        <p style={{ fontSize: 13.5, color: 'var(--fg-3)' }}>{patient.phone}</p>
      )}

      {/* ─── Discount warning (если backend вернул) ─── */}
      {discountWarning && (
        <div
          className="mt-4 max-w-[460px] px-4 py-3 rounded-xl flex items-start gap-2"
          style={{
            background: 'rgba(245,158,11,.10)',
            border: '1px solid rgba(245,158,11,.35)',
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#92400E' }}>info</span>
          <div style={{ fontSize: 12.5, color: '#92400E', lineHeight: 1.5, textAlign: 'left' }}>
            {discountWarning}
          </div>
        </div>
      )}

      {/* ─── 3 кнопки действий ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-8 w-full max-w-[640px]">
        <button
          onClick={handlePrintReceipt}
          disabled={!receiptUrl}
          className="flex flex-col items-center justify-center gap-2 py-5 rounded-2xl transition-all hover:scale-[1.02]"
          style={{
            background: 'var(--surface)',
            border: '1.5px solid var(--border)',
            color: receiptUrl ? 'var(--fg)' : 'var(--fg-4)',
            cursor: receiptUrl ? 'pointer' : 'not-allowed',
            opacity: receiptUrl ? 1 : 0.6,
            boxShadow: '0 4px 14px rgba(0,0,0,.04)',
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 28, color: '#0EA5E9', fontVariationSettings: "'FILL' 1" }}
          >
            receipt_long
          </span>
          <span style={{ fontSize: 13.5, fontWeight: 700 }}>Печать квитанции</span>
        </button>

        {onTelegram && (
          <button
            onClick={onTelegram}
            className="flex flex-col items-center justify-center gap-2 py-5 rounded-2xl transition-all hover:scale-[1.02]"
            style={{
              background: 'var(--surface)',
              border: '1.5px solid var(--border)',
              color: 'var(--fg)',
              cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(0,0,0,.04)',
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 28, color: '#229ED9', fontVariationSettings: "'FILL' 1" }}
            >
              send
            </span>
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>В Telegram</span>
          </button>
        )}

        <button
          onClick={onReset}
          className="flex flex-col items-center justify-center gap-2 py-5 rounded-2xl transition-all hover:scale-[1.02]"
          style={{
            background: 'linear-gradient(135deg, #F59E0B, #7C3AED)',
            border: 'none',
            color: '#fff',
            cursor: 'pointer',
            boxShadow: '0 8px 24px rgba(124,58,237,.32)',
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 28, color: '#fff', fontVariationSettings: "'FILL' 1" }}
          >
            add_circle
          </span>
          <span style={{ fontSize: 13.5, fontWeight: 700 }}>Активировать ещё</span>
        </button>
      </div>

      <style>{`
        @keyframes successPop {
          0%   { transform: scale(.3); opacity: 0; }
          60%  { transform: scale(1.1); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes checkDraw {
          from { transform: scale(.5); opacity: 0; }
          to   { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  )
}
