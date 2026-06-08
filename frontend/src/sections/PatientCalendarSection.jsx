/**
 * ========================================
 * БЛОК: PatientCalendarSection — премиум-календарь пациента (Глава 9)
 * ========================================
 * Используется в PatientCabinet.jsx (вкладка «Календарь»).
 *
 * API:
 *   GET    /patient/calendar/upcoming                → [{id, datetime, clinic_name, doctor_name, service_name, address}]
 *   POST   /patient/calendar/issue-token             → {token, feed_url}
 *   GET    /patient/calendar/tokens                  → [{id, created_at, revoked_at}]
 *   POST   /patient/calendar/tokens/{id}/revoke      → revoke
 *
 * UX:
 *   - Hero-карточка ближайшего приёма (UpcomingCard highlight)
 *   - Список следующих приёмов
 *   - Секция «Подписка в Google/Apple Calendar»: issue-token, copy URL, deeplink
 *   - Список активных токенов с возможностью revoke
 * ========================================
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import axios from 'axios'
import { API_BASE } from '../config'
import { useToast } from '../design'
import UpcomingCard from '../components/calendar/UpcomingCard'

const SESSION_KEY = 'clinika_patient_session'

// ── Утилиты ──────────────────────────────────────────────────────────────────
function fmtRu(iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  catch { return iso }
}

function buildAbsoluteFeedUrl(feedUrl) {
  if (!feedUrl) return ''
  if (/^https?:\/\//i.test(feedUrl)) return feedUrl
  // Относительный путь — клеим к origin
  if (typeof window === 'undefined') return feedUrl
  if (feedUrl.startsWith('/api/')) {
    // API_BASE может уже содержать /api
    const apiBaseClean = String(API_BASE).replace(/\/api$/, '').replace(/\/$/, '')
    return apiBaseClean + feedUrl
  }
  const base = String(API_BASE).replace(/\/$/, '')
  return base + (feedUrl.startsWith('/') ? feedUrl : '/' + feedUrl)
}

function buildGoogleSubscribeUrl(feedUrlHttps) {
  // Google Calendar требует https URL без webcal://
  // https://calendar.google.com/calendar/r?cid=URL
  return 'https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(feedUrlHttps)
}
function buildWebcalUrl(feedUrlHttps) {
  return feedUrlHttps.replace(/^https?:\/\//i, 'webcal://')
}

// ── Главный компонент ────────────────────────────────────────────────────────
export default function PatientCalendarSection({ sessionToken: sessionTokenProp }) {
  const sessionToken = sessionTokenProp || (typeof window !== 'undefined' ? localStorage.getItem(SESSION_KEY) : null)
  const { toast } = useToast() || {}

  const [upcoming, setUpcoming] = useState([])
  const [loadingUpc, setLoadingUpc] = useState(true)
  const [errUpc, setErrUpc] = useState('')

  const [tokens, setTokens] = useState([])
  const [loadingTok, setLoadingTok] = useState(true)
  const [issuing, setIssuing] = useState(false)
  const [issued, setIssued] = useState(null)   // {token, feed_url}

  const params = useMemo(() => ({ t: sessionToken }), [sessionToken])

  // ── Fetch upcoming ────────────────────────────────────────────────────────
  const loadUpcoming = useCallback(async () => {
    if (!sessionToken) return
    try {
      const r = await axios.get(`${API_BASE}/patient/calendar/upcoming`, { params })
      const list = Array.isArray(r.data) ? r.data : (r.data?.items || [])
      setUpcoming(list)
      setErrUpc('')
    } catch (e) {
      setErrUpc(e?.response?.data?.detail || 'Не удалось загрузить расписание')
    } finally {
      setLoadingUpc(false)
    }
  }, [sessionToken, params])

  const loadTokens = useCallback(async () => {
    if (!sessionToken) return
    try {
      const r = await axios.get(`${API_BASE}/patient/calendar/tokens`, { params })
      const list = Array.isArray(r.data) ? r.data : (r.data?.items || [])
      setTokens(list)
    } catch {
      // 404 — нет токенов, не критично
      setTokens([])
    } finally {
      setLoadingTok(false)
    }
  }, [sessionToken, params])

  useEffect(() => { loadUpcoming() }, [loadUpcoming])
  useEffect(() => { loadTokens() }, [loadTokens])

  // ── Issue token ───────────────────────────────────────────────────────────
  const issueToken = async () => {
    setIssuing(true)
    try {
      const r = await axios.post(`${API_BASE}/patient/calendar/issue-token`, {}, { params })
      setIssued(r.data || null)
      toast?.('Ссылка подписки готова', 'success')
      loadTokens()
    } catch (e) {
      toast?.(e?.response?.data?.detail || 'Не удалось выпустить ссылку', 'error')
    }
    setIssuing(false)
  }

  // ── Revoke ────────────────────────────────────────────────────────────────
  const revoke = async (id) => {
    if (!confirm('Отозвать ссылку? Подписка перестанет работать.')) return
    try {
      await axios.post(`${API_BASE}/patient/calendar/tokens/${id}/revoke`, {}, { params })
      toast?.('Ссылка отозвана', 'success')
      loadTokens()
      if (issued && issued.id === id) setIssued(null)
    } catch (e) {
      toast?.(e?.response?.data?.detail || 'Не удалось отозвать', 'error')
    }
  }

  // ── Copy ───────────────────────────────────────────────────────────────────
  const copy = async (text) => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      toast?.('Скопировано', 'success')
    } catch {
      // fallback
      const ta = document.createElement('textarea')
      ta.value = text; document.body.appendChild(ta); ta.select()
      try { document.execCommand('copy') } catch {}
      document.body.removeChild(ta)
      toast?.('Скопировано', 'success')
    }
  }

  // ── Сортировка и hero ─────────────────────────────────────────────────────
  const sorted = useMemo(() => {
    return [...upcoming]
      .filter(a => a?.datetime)
      .sort((a, b) => new Date(a.datetime) - new Date(b.datetime))
  }, [upcoming])
  const hero = sorted[0]
  const rest = sorted.slice(1)

  const feedAbs = issued ? buildAbsoluteFeedUrl(issued.feed_url) : ''
  const googleUrl = feedAbs ? buildGoogleSubscribeUrl(feedAbs) : ''
  const webcalUrl = feedAbs ? buildWebcalUrl(feedAbs) : ''

  if (!sessionToken) {
    return (
      <div className="px-4 py-8 text-center" style={{ color: 'var(--fg-2, #475569)' }}>
        Войдите в кабинет, чтобы открыть календарь
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* ── Hero / Empty ── */}
      {loadingUpc && (
        <div className="rounded-2xl p-6 text-center" style={{ background: 'var(--surface, #fff)', border: '1px solid var(--border, #e2e8f0)' }}>
          <span style={{ color: 'var(--fg-3, #94a3b8)', fontSize: 13 }}>Загрузка расписания…</span>
        </div>
      )}
      {!loadingUpc && errUpc && (
        <div className="rounded-2xl p-4" style={{ background: '#fee2e2', color: '#991b1b', fontSize: 13 }}>{errUpc}</div>
      )}
      {!loadingUpc && !errUpc && !hero && (
        <div className="rounded-2xl p-6 text-center" style={{ background: 'var(--surface, #fff)', border: '1px solid var(--border, #e2e8f0)' }}>
          <div className="grid place-items-center mx-auto mb-3" style={{ width: 64, height: 64, borderRadius: 20, background: 'linear-gradient(135deg, #e0f7fa, #b2ebf2)' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 32, color: '#00838F', fontVariationSettings: "'FILL' 1" }}>event_available</span>
          </div>
          <div className="font-bold" style={{ fontSize: 15, color: 'var(--fg, #0F172A)' }}>Нет предстоящих приёмов</div>
          <div className="mt-1" style={{ fontSize: 13, color: 'var(--fg-2, #475569)' }}>Запишитесь на приём — он появится здесь</div>
        </div>
      )}
      {!loadingUpc && hero && (
        <UpcomingCard apt={hero} highlight />
      )}

      {/* ── Остальные приёмы ── */}
      {rest.length > 0 && (
        <div>
          <div className="px-1 mb-2 flex items-center justify-between">
            <div className="font-bold" style={{ fontSize: 13.5, color: 'var(--fg-2, #475569)' }}>
              Далее ({rest.length})
            </div>
          </div>
          <div className="space-y-2">
            {rest.map(a => <UpcomingCard key={a.id} apt={a} />)}
          </div>
        </div>
      )}

      {/* ── Subscribe to calendar ── */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: 'var(--surface, #fff)', border: '1px solid var(--border, #e2e8f0)' }}
      >
        <div className="p-4 border-b" style={{ borderColor: 'var(--border, #e2e8f0)' }}>
          <div className="flex items-center gap-2">
            <span className="grid place-items-center" style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #e0f7fa, #ede7f6)', color: '#00838F' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 20, fontVariationSettings: "'FILL' 1" }}>sync_alt</span>
            </span>
            <div className="flex-1 min-w-0">
              <div className="font-bold" style={{ fontSize: 14, color: 'var(--fg, #0F172A)' }}>Подписка на календарь</div>
              <div className="truncate" style={{ fontSize: 12, color: 'var(--fg-3, #94a3b8)' }}>
                Google Calendar / Apple Calendar / Outlook — автообновление
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 space-y-3">
          {!issued && (
            <button
              onClick={issueToken}
              disabled={issuing}
              className="w-full py-3 rounded-xl font-semibold text-white disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, #0097A7, #0A2342)', fontSize: 14, boxShadow: '0 4px 14px rgba(0,151,167,.3)' }}
            >
              {issuing ? 'Создаём ссылку…' : 'Получить ссылку подписки'}
            </button>
          )}

          {issued && (
            <>
              <div className="rounded-xl p-3" style={{ background: 'var(--bg-1, #f8fafc)', border: '1px solid var(--border, #e2e8f0)' }}>
                <div style={{ fontSize: 11, color: 'var(--fg-3, #94a3b8)', fontWeight: 600 }}>URL подписки</div>
                <div
                  className="mt-1 break-all"
                  style={{ fontSize: 12, fontFamily: 'ui-monospace, monospace', color: 'var(--fg, #0F172A)' }}
                >
                  {feedAbs}
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => copy(feedAbs)}
                    className="flex-1 py-2 rounded-lg font-semibold"
                    style={{ background: 'var(--bg, #fff)', color: 'var(--fg-2, #475569)', border: '1px solid var(--border, #e2e8f0)', fontSize: 12 }}
                  >
                    <span className="material-symbols-outlined align-middle" style={{ fontSize: 14, marginRight: 4 }}>content_copy</span>
                    Копировать
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <a
                  href={googleUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold"
                  style={{ background: '#1a73e8', color: '#fff', fontSize: 13, textDecoration: 'none', boxShadow: '0 4px 12px rgba(26,115,232,.25)' }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>calendar_month</span>
                  Google Calendar
                </a>
                <a
                  href={webcalUrl}
                  className="flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold"
                  style={{ background: '#000', color: '#fff', fontSize: 13, textDecoration: 'none', boxShadow: '0 4px 12px rgba(0,0,0,.25)' }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>calendar_add_on</span>
                  Apple / Outlook
                </a>
              </div>

              <div className="rounded-xl p-3" style={{ background: 'rgba(0,151,167,.06)', border: '1px solid rgba(0,151,167,.18)' }}>
                <div className="flex items-start gap-2">
                  <span className="material-symbols-outlined flex-shrink-0" style={{ fontSize: 18, color: '#00838F', marginTop: 1 }}>info</span>
                  <div style={{ fontSize: 12, color: 'var(--fg-2, #475569)', lineHeight: 1.45 }}>
                    После добавления Google Calendar обновит данные в течение нескольких часов.
                    Apple/Outlook — в течение часа. Ссылка персональная — не передавайте её.
                  </div>
                </div>
              </div>

              <button
                onClick={() => setIssued(null)}
                className="w-full py-2 rounded-xl"
                style={{ background: 'transparent', color: 'var(--fg-3, #94a3b8)', fontSize: 12 }}
              >
                Скрыть
              </button>
            </>
          )}

          {/* Список активных токенов */}
          {!loadingTok && tokens.length > 0 && (
            <div className="pt-2">
              <div className="font-semibold mb-2" style={{ fontSize: 12, color: 'var(--fg-2, #475569)' }}>
                Активные ссылки ({tokens.filter(t => !t.revoked_at).length})
              </div>
              <div className="space-y-1.5">
                {tokens.map(t => (
                  <div
                    key={t.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg"
                    style={{
                      background: t.revoked_at ? 'rgba(148,163,184,.08)' : 'var(--bg-1, #f8fafc)',
                      border: '1px solid var(--border, #e2e8f0)',
                      opacity: t.revoked_at ? 0.55 : 1,
                    }}
                  >
                    <span className="material-symbols-outlined flex-shrink-0" style={{ fontSize: 18, color: 'var(--fg-3, #94a3b8)' }}>
                      {t.revoked_at ? 'link_off' : 'link'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="truncate" style={{ fontSize: 12.5, color: 'var(--fg, #0F172A)', fontWeight: 600 }}>
                        Ссылка #{t.id}
                      </div>
                      <div className="truncate" style={{ fontSize: 11, color: 'var(--fg-3, #94a3b8)' }}>
                        Создана {fmtRu(t.created_at)}
                        {t.revoked_at && ` · отозвана ${fmtRu(t.revoked_at)}`}
                      </div>
                    </div>
                    {!t.revoked_at && (
                      <button
                        onClick={() => revoke(t.id)}
                        className="flex-shrink-0 px-2 py-1 rounded-lg font-semibold"
                        style={{ background: '#fee2e2', color: '#991b1b', fontSize: 11 }}
                      >
                        Отозвать
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
