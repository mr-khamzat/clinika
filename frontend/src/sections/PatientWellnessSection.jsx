/**
 * ========================================
 * БЛОК: PatientWellnessSection — wellness-партнёры пациента (Глава 10)
 * ========================================
 * Используется внутри PatientCabinet.jsx (вкладка «Wellness партнёры»).
 *
 * API:
 *   GET  /patient/wellness/partners?t={sessionToken}
 *     → [{ id, name, category, description, logo_url, discount_text,
 *          min_subscription_plan, promo_code, link_url, locked?:bool }]
 *   POST /patient/wellness/partners/{id}/click?t={sessionToken}
 *     → { link_url, promo_code }
 *
 * UX:
 *   • Категории-табы (CategoryTabs) с бейджами-счётчиками
 *   • Премиум-сетка 3 колонки (desktop) / 1 (mobile)
 *   • Если у пациента нет нужной подписки — карточка с замком
 *   • Клик «Подробнее»:
 *       - POST /click → возьмёт promo_code в clipboard, откроет link_url
 * ========================================
 */
import { useEffect, useState, useCallback, useMemo } from 'react'
import axios from 'axios'
import { API_BASE } from '../config'
import PartnerCard from '../components/wellness/PartnerCard'
import CategoryTabs from '../components/wellness/CategoryTabs'

const SESSION_KEY = 'clinika_patient_session'

function HintBlock({ icon, tone = 'info', title, sub }) {
  const palettes = {
    info:    { bg: '#e0f2fe', border: '#bae6fd', text: '#0c4a6e', icon: '#0369a1' },
    warn:    { bg: '#fef3c7', border: '#fde68a', text: '#92400e', icon: '#92400e' },
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

function CardSkeleton() {
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: '#fff', border: '1px solid #e2e8f0' }}>
      <div style={{ height: 96, background: '#f1f5f9' }} className="animate-pulse" />
      <div className="p-4 space-y-2">
        <div className="h-4 rounded animate-pulse" style={{ background: '#f1f5f9', width: '60%' }} />
        <div className="h-3 rounded animate-pulse" style={{ background: '#f1f5f9' }} />
        <div className="h-9 rounded-xl animate-pulse mt-3" style={{ background: '#e2e8f0' }} />
      </div>
    </div>
  )
}

async function copyToClipboard(text) {
  if (!text) return false
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
    const ta = document.createElement('textarea')
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch { return false }
}

export default function PatientWellnessSection({ sessionToken: sessionTokenProp }) {
  const sessionToken = sessionTokenProp || (typeof window !== 'undefined' ? localStorage.getItem(SESSION_KEY) : null)
  const [items, setItems]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [cat, setCat]         = useState('all')
  const [toast, setToast]     = useState(null)  // { text, kind }

  const load = useCallback(async () => {
    if (!sessionToken) { setLoading(false); setError('no_session'); return }
    setLoading(true)
    setError(null)
    try {
      const r = await axios.get(`${API_BASE}/patient/wellness/partners`, { params: { t: sessionToken } })
      const arr = Array.isArray(r.data) ? r.data : (r.data?.partners || [])
      // Sort: разблокированные сверху, затем по sort_order
      arr.sort((a, b) => {
        const la = a.locked ? 1 : 0, lb = b.locked ? 1 : 0
        if (la !== lb) return la - lb
        return (a.sort_order ?? 999) - (b.sort_order ?? 999)
      })
      setItems(arr)
    } catch (e) {
      const status = e?.response?.status
      if (status === 402) setError('module_off')
      else setError('load')
    } finally {
      setLoading(false)
    }
  }, [sessionToken])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    if (cat === 'all') return items
    return items.filter(it => String(it.category || 'other').toLowerCase() === cat)
  }, [items, cat])

  const counts = useMemo(() => {
    const c = { all: items.length }
    for (const it of items) {
      const k = String(it.category || 'other').toLowerCase()
      c[k] = (c[k] || 0) + 1
    }
    return c
  }, [items])

  const flashToast = (text, kind = 'success') => {
    setToast({ text, kind })
    setTimeout(() => setToast(null), 3500)
  }

  const onOpen = async (partner) => {
    try {
      const r = await axios.post(
        `${API_BASE}/patient/wellness/partners/${partner.id}/click`,
        null,
        { params: { t: sessionToken } }
      )
      const link = r.data?.link_url || partner.link_url
      const promo = r.data?.promo_code || partner.promo_code
      if (promo) {
        const ok = await copyToClipboard(promo)
        flashToast(ok ? `Промокод ${promo} скопирован` : `Промокод: ${promo}`, 'success')
      }
      if (link) {
        // Открываем в новой вкладке. На мобильных PWA — попап-блокеры допустимы (toast виден).
        window.open(link, '_blank', 'noopener,noreferrer')
      }
    } catch (e) {
      const detail = e?.response?.data?.detail
      flashToast(detail || 'Не удалось открыть партнёра', 'error')
    }
  }

  if (error === 'module_off') {
    return (
      <HintBlock
        icon="lock" tone="warn"
        title="Wellness-партнёры пока недоступны"
        sub="Клиника подключит модуль партнёрской программы, и здесь появятся скидки."
      />
    )
  }
  if (error === 'no_session') {
    return (
      <HintBlock
        icon="login" tone="info"
        title="Войдите в кабинет"
        sub="Чтобы получить скидки партнёров, авторизуйтесь по коду из СМС или Telegram."
      />
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold" style={{ color: '#0f172a' }}>Партнёры и привилегии</h2>
        <p className="text-xs" style={{ color: '#64748b' }}>
          Эксклюзивные скидки для пациентов клиники: фитнес, спа, питание, психология
        </p>
      </div>

      <CategoryTabs value={cat} onChange={setCat} counts={counts} />

      {loading && (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          <CardSkeleton /><CardSkeleton /><CardSkeleton />
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <HintBlock
          icon="spa" tone="info"
          title="В этой категории пока пусто"
          sub="Клиника добавит партнёров — вернитесь позже или выберите другую категорию."
        />
      )}

      {!loading && filtered.length > 0 && (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {filtered.map(p => (
            <PartnerCard key={p.id} partner={p} locked={!!p.locked} onOpen={onOpen} />
          ))}
        </div>
      )}

      {/* Локальный toast (промокод скопирован) */}
      {toast && (
        <div
          className="fixed left-1/2 transform -translate-x-1/2 z-50"
          style={{
            bottom: 96,
            background: toast.kind === 'error' ? '#b91c1c' : '#0f172a',
            color: '#fff',
            padding: '10px 18px',
            borderRadius: 999,
            fontSize: 13, fontWeight: 600,
            boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
          }}
        >
          {toast.text}
        </div>
      )}
    </div>
  )
}
