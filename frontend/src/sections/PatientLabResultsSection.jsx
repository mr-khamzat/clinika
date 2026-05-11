/**
 * ========================================
 * БЛОК: PatientLabResultsSection — результаты анализов пациента (Глава 10)
 * ========================================
 * Используется внутри PatientCabinet.jsx (вкладка «Анализы»).
 *
 * API:
 *   GET /patient/lab-results?t={sessionToken}
 *     → [{ id, date, provider_name, doctor_name, test_codes:[],
 *          results:[{test_code,test_name,value,unit,ref_range,flagged}],
 *          status:'delivered'|... }]
 *     | 402 если модуль lab_integration не активен.
 *
 * UX:
 *   • Карточки заявок (status='delivered' / 'results_ready' включаем),
 *     развёртываются по клику → таблица результатов.
 *   • Кнопка «Скачать PDF» (заглушка-toast если backend не отдал).
 * ========================================
 */
import { useEffect, useState, useCallback } from 'react'
import axios from 'axios'
import { API_BASE } from '../config'
import LabResultsTable from '../components/lab/LabResultsTable'

const SESSION_KEY = 'clinika_patient_session'

function fmtDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch { return iso }
}

function CardSkeleton() {
  return (
    <div className="rounded-2xl animate-pulse" style={{ background: '#f1f5f9', height: 96 }} />
  )
}

function HintBlock({ icon, tone = 'info', title, sub }) {
  const palettes = {
    info:    { bg: '#e0f2fe', border: '#bae6fd', text: '#0c4a6e', icon: '#0369a1' },
    warn:    { bg: '#fef3c7', border: '#fde68a', text: '#92400e', icon: '#92400e' },
    success: { bg: '#dcfce7', border: '#bbf7d0', text: '#14532d', icon: '#15803d' },
  }
  const c = palettes[tone] || palettes.info
  return (
    <div className="rounded-2xl p-6 text-center" style={{ background: c.bg, border: `1px solid ${c.border}` }}>
      <span className="material-symbols-outlined text-3xl mb-2 block" style={{ color: c.icon }}>{icon}</span>
      <p className="text-sm font-semibold" style={{ color: c.text }}>{title}</p>
      {sub && <p className="text-xs mt-1" style={{ color: c.text }}>{sub}</p>}
    </div>
  )
}

export default function PatientLabResultsSection({ sessionToken: sessionTokenProp }) {
  const sessionToken = sessionTokenProp || (typeof window !== 'undefined' ? localStorage.getItem(SESSION_KEY) : null)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState(null)

  const load = useCallback(async () => {
    if (!sessionToken) { setLoading(false); setError('no_session'); return }
    setLoading(true)
    setError(null)
    try {
      const r = await axios.get(`${API_BASE}/patient/lab-results`, { params: { t: sessionToken } })
      const arr = Array.isArray(r.data) ? r.data : (r.data?.results || [])
      // Показываем только готовые/доставленные пациенту
      const visible = arr.filter(o => ['delivered','results_ready'].includes(String(o.status || '').toLowerCase()) || o.results?.length)
      setItems(visible)
    } catch (e) {
      const status = e?.response?.status
      if (status === 402) setError('module_off')
      else setError('load')
    } finally {
      setLoading(false)
    }
  }, [sessionToken])

  useEffect(() => { load() }, [load])

  const downloadPdf = async (order) => {
    try {
      const r = await axios.get(`${API_BASE}/patient/lab-results/${order.id}/pdf`, {
        params: { t: sessionToken },
        responseType: 'blob',
      })
      const blob = new Blob([r.data], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `lab-${order.id}.pdf`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {
      alert('PDF пока недоступен — попросите врача или регистратора прислать результаты.')
    }
  }

  if (error === 'module_off') {
    return (
      <HintBlock
        icon="lock" tone="warn"
        title="Модуль анализов не подключён"
        sub="Клиника пока не активировала интеграцию с лабораторией."
      />
    )
  }
  if (error === 'no_session') {
    return (
      <HintBlock
        icon="login" tone="info"
        title="Войдите в кабинет"
        sub="Чтобы увидеть свои анализы, авторизуйтесь по коду из СМС или Telegram."
      />
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="text-lg font-bold" style={{ color: '#0f172a' }}>Результаты анализов</h2>
          <p className="text-xs" style={{ color: '#64748b' }}>
            Полученные из лабораторий результаты — всегда под рукой
          </p>
        </div>
      </div>

      {loading && (
        <div className="space-y-2">
          <CardSkeleton /><CardSkeleton /><CardSkeleton />
        </div>
      )}

      {!loading && items.length === 0 && (
        <HintBlock
          icon="biotech" tone="info"
          title="Результатов пока нет"
          sub="Когда лаборатория обработает анализы, они появятся здесь автоматически."
        />
      )}

      {!loading && items.length > 0 && (
        <div className="space-y-3">
          {items.map(o => {
            const isOpen = expanded === o.id
            const tests = Array.isArray(o.test_codes) ? o.test_codes : (o.tests || [])
            const flaggedCount = Array.isArray(o.results)
              ? o.results.filter(r => r.flagged).length
              : 0
            return (
              <div
                key={o.id}
                className="rounded-2xl overflow-hidden transition-all"
                style={{ background: '#fff', border: '1px solid #e2e8f0' }}
              >
                <button
                  onClick={() => setExpanded(isOpen ? null : o.id)}
                  className="w-full text-left transition-colors hover:bg-gray-50"
                  style={{ padding: '14px 16px' }}
                >
                  <div className="flex items-center justify-between gap-3 mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="inline-grid place-items-center flex-shrink-0"
                        style={{
                          width: 36, height: 36, borderRadius: 10,
                          background: flaggedCount > 0 ? '#fef2f2' : '#dcfce7',
                          color: flaggedCount > 0 ? '#b91c1c' : '#166534',
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 20, fontVariationSettings: "'FILL' 1" }}>
                          biotech
                        </span>
                      </span>
                      <div className="min-w-0">
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
                          {o.provider_name || 'Лаборатория'}
                        </div>
                        <div style={{ fontSize: 11.5, color: '#64748b' }}>
                          {fmtDate(o.date || o.created_at)}
                          {o.doctor_name ? ` · врач ${o.doctor_name}` : ''}
                        </div>
                      </div>
                    </div>
                    {flaggedCount > 0 ? (
                      <span
                        style={{
                          padding: '3px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700,
                          background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {flaggedCount} отклонение
                      </span>
                    ) : (
                      <span
                        style={{
                          padding: '3px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700,
                          background: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        В норме
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {tests.slice(0, 5).map(t => (
                      <span key={t} style={{
                        fontSize: 10.5, padding: '2px 7px', borderRadius: 999,
                        background: '#f1f5f9', color: '#475569', fontWeight: 600,
                      }}>{t}</span>
                    ))}
                    {tests.length > 5 && (
                      <span style={{ fontSize: 10.5, color: '#94a3b8' }}>+{tests.length - 5}</span>
                    )}
                  </div>
                </button>

                {isOpen && (
                  <div className="px-4 pb-4">
                    <LabResultsTable results={Array.isArray(o.results) ? o.results : []} />
                    <div className="flex items-center justify-end pt-3">
                      <button
                        onClick={() => downloadPdf(o)}
                        className="inline-flex items-center gap-1.5 rounded-xl transition-all active:scale-95"
                        style={{
                          padding: '8px 14px',
                          background: 'linear-gradient(135deg, #0ea5e9, #0369a1)',
                          color: '#fff', fontSize: 12.5, fontWeight: 700,
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>download</span>
                        Скачать PDF
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
