/**
 * ========================================
 * КОМПОНЕНТ: PaymentConfirmStep — подтверждение наличной оплаты
 * ========================================
 * Используется в ManagerSubscriptionCashSection (Step 4 wizard'а).
 *
 * Props:
 *   patient    — выбранный пациент {full_name, phone, ...}
 *   planTitle  — название тарифа (рус)
 *   months     — выбранный период (1|3|6|12)
 *   priceTotal — рассчитанная сумма к получению
 *   amount, setAmount — controlled input (полученное наличными)
 *   note, setNote     — controlled textarea
 *   busy       — boolean (идёт POST)
 *   onActivate — колбек активации
 *   onBack     — назад на предыдущий шаг
 *
 * Особенности:
 *   • Highlight (warning) если discrepancy > 5%
 *   • Большая золотая кнопка «Активировать тариф»
 * ========================================
 */
import { useMemo } from 'react'

export default function PaymentConfirmStep({
  patient,
  planTitle,
  months,
  priceTotal,
  amount,
  setAmount,
  note,
  setNote,
  busy,
  onActivate,
  onBack,
}) {
  // ─── Расчёт расхождения суммы ───
  const diff = useMemo(() => {
    const a = Number(amount || 0)
    if (!a || !priceTotal) return null
    const delta = a - priceTotal
    const pct = priceTotal > 0 ? Math.abs(delta) / priceTotal : 0
    return { delta, pct, warn: pct > 0.05 }
  }, [amount, priceTotal])

  return (
    <div className="space-y-5">
      {/* ─── Сводка заказа ─── */}
      <div
        className="rounded-3xl p-5"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <div className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--fg-3)' }}>
          Сводка
        </div>
        <div className="space-y-2.5">
          <div className="flex justify-between items-center">
            <span style={{ fontSize: 13.5, color: 'var(--fg-3)' }}>Пациент</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>
              {patient?.full_name || '—'}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span style={{ fontSize: 13.5, color: 'var(--fg-3)' }}>Телефон</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>
              {patient?.phone || '—'}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span style={{ fontSize: 13.5, color: 'var(--fg-3)' }}>Тариф</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#7C3AED' }}>{planTitle || '—'}</span>
          </div>
          <div className="flex justify-between items-center">
            <span style={{ fontSize: 13.5, color: 'var(--fg-3)' }}>Период</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>
              {months} {months === 1 ? 'месяц' : months < 5 ? 'месяца' : 'месяцев'}
            </span>
          </div>
          <div
            className="flex justify-between items-center pt-3 mt-3"
            style={{ borderTop: '1px dashed var(--border)' }}
          >
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg)' }}>К получению</span>
            <span
              className="font-extrabold"
              style={{
                fontSize: 24, letterSpacing: '-0.02em',
                background: 'linear-gradient(135deg, #F59E0B, #7C3AED)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              {Number(priceTotal || 0).toLocaleString('ru-RU')} ₽
            </span>
          </div>
        </div>
      </div>

      {/* ─── Input: получено наличными ─── */}
      <div>
        <label
          className="block mb-2"
          style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--fg-3)' }}
        >
          Получено наличными
        </label>
        <div
          className="flex items-center gap-2"
          style={{
            background: 'var(--surface)',
            border: '1.5px solid',
            borderColor: diff?.warn ? '#F59E0B' : 'var(--border)',
            borderRadius: 14,
            padding: '0 16px',
            height: 64,
            boxShadow: diff?.warn ? '0 0 0 4px rgba(245,158,11,.16)' : 'var(--shadow-sm)',
          }}
        >
          <input
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: 26,
              fontWeight: 800,
              letterSpacing: '-0.02em',
              color: 'var(--fg)',
            }}
          />
          <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--fg-3)' }}>₽</span>
        </div>
        {diff?.warn && (
          <div
            className="flex items-start gap-2 mt-2 px-3 py-2 rounded-xl"
            style={{
              background: 'rgba(245,158,11,.10)',
              border: '1px solid rgba(245,158,11,.35)',
            }}
          >
            <span
              className="material-symbols-outlined flex-shrink-0"
              style={{ fontSize: 18, color: '#92400E', marginTop: 1 }}
            >
              warning
            </span>
            <div style={{ fontSize: 12.5, color: '#92400E', lineHeight: 1.5 }}>
              {diff.delta > 0
                ? `Сумма больше расчётной на ${diff.delta.toLocaleString('ru-RU')} ₽ (${Math.round(diff.pct * 100)}%).`
                : `Сумма меньше расчётной на ${Math.abs(diff.delta).toLocaleString('ru-RU')} ₽ (${Math.round(diff.pct * 100)}%). Это будет учтено как скидка.`}
            </div>
          </div>
        )}
      </div>

      {/* ─── Note ─── */}
      <div>
        <label
          className="block mb-2"
          style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--fg-3)' }}
        >
          Комментарий <span style={{ color: 'var(--fg-4)', fontWeight: 600 }}>(опц.)</span>
        </label>
        <textarea
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Например: скидка для постоянного клиента / акция…"
          style={{
            width: '100%',
            background: 'var(--surface)',
            border: '1.5px solid var(--border)',
            borderRadius: 14,
            padding: '12px 16px',
            fontSize: 14,
            color: 'var(--fg)',
            outline: 'none',
            resize: 'vertical',
          }}
        />
      </div>

      {/* ─── Кнопки ─── */}
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={busy}
          className="flex-shrink-0 inline-flex items-center justify-center gap-2 px-5 transition-all hover:scale-[1.01]"
          style={{
            height: 60,
            background: 'var(--surface)',
            border: '1.5px solid var(--border)',
            borderRadius: 14,
            color: 'var(--fg-2)',
            fontWeight: 700,
            fontSize: 14.5,
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>arrow_back</span>
          Назад
        </button>
        <button
          type="button"
          onClick={onActivate}
          disabled={busy || !Number(amount || 0)}
          className="flex-1 inline-flex items-center justify-center gap-2 transition-all hover:scale-[1.01]"
          style={{
            height: 60,
            background: 'linear-gradient(135deg, #F59E0B, #7C3AED)',
            border: 'none',
            borderRadius: 14,
            color: '#fff',
            fontWeight: 800,
            fontSize: 16,
            letterSpacing: 0.3,
            boxShadow: '0 10px 30px rgba(124,58,237,.35)',
            cursor: (busy || !Number(amount || 0)) ? 'not-allowed' : 'pointer',
            opacity: (busy || !Number(amount || 0)) ? 0.7 : 1,
          }}
        >
          {busy ? (
            <>
              <span
                className="inline-block"
                style={{
                  width: 18, height: 18, borderRadius: '50%',
                  border: '2.5px solid #fff', borderTopColor: 'transparent',
                  animation: 'spin .7s linear infinite',
                }}
              />
              Активирую…
            </>
          ) : (
            <>
              <span className="material-symbols-outlined" style={{ fontSize: 22, fontVariationSettings: "'FILL' 1" }}>
                check_circle
              </span>
              Активировать тариф
            </>
          )}
        </button>
      </div>

      <style>{`
        @keyframes spin { from {transform:rotate(0)} to {transform:rotate(360deg)} }
      `}</style>
    </div>
  )
}
