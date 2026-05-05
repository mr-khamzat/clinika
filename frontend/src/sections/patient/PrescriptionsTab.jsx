// Вкладка "Назначения" в кабинете пациента: лекарства из МИС и локального кэша.
// Карточки с препаратом, дозировкой, частотой и длительностью.
//
// Props: { sessionToken, apiBase }
//
// Эндпоинт:
//   GET /patient/prescriptions  → { items: [...], mis_available: bool, count: int }
import { useEffect, useState, useCallback } from 'react'
import axios from 'axios'

function formatDate(iso) {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })
  } catch { return iso }
}

function PrescriptionCard({ p }) {
  const isLive = p.source === 'mis'
  return (
    <div className="bg-white rounded-3xl p-4"
         style={{ border: '1px solid rgba(0,0,0,.06)', boxShadow: '0 2px 12px rgba(0,0,0,.04)' }}>
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
             style={{ background: '#E0F7FA' }}>
          <span className="material-symbols-outlined text-xl" style={{ color: '#0097A7' }}>medication</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-gray-800 text-sm break-words">{p.drug_name || '—'}</p>
            {!isLive && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md"
                    style={{ background: '#FEF3C7', color: '#92400E' }}>из кэша</span>
            )}
          </div>
          {p.dosage && (
            <p className="text-xs text-gray-700 mt-1">
              <span className="material-symbols-outlined text-[12px] align-middle text-gray-400">scale</span>
              {' '}Дозировка: <span className="font-medium">{p.dosage}</span>
            </p>
          )}
          {p.frequency && (
            <p className="text-xs text-gray-700 mt-1">
              <span className="material-symbols-outlined text-[12px] align-middle text-gray-400">schedule</span>
              {' '}Частота: <span className="font-medium">{p.frequency}</span>
            </p>
          )}
          {p.duration && (
            <p className="text-xs text-gray-700 mt-1">
              <span className="material-symbols-outlined text-[12px] align-middle text-gray-400">timer</span>
              {' '}Длительность: <span className="font-medium">{p.duration}</span>
            </p>
          )}
          <div className="flex items-center gap-2 mt-2 text-[11px] text-gray-500 flex-wrap">
            {p.prescribed_at && <span>{formatDate(p.prescribed_at)}</span>}
            {p.doctor_name && <span>· {p.doctor_name}</span>}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function PrescriptionsTab({ sessionToken, apiBase = '/api' }) {
  const [items, setItems] = useState([])
  const [misAvailable, setMisAvailable] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    if (!sessionToken) { setLoading(false); return }
    setLoading(true); setError(null)
    try {
      const r = await axios.get(`${apiBase}/patient/prescriptions`, {
        params: { session_token: sessionToken, t: sessionToken },
      })
      setItems(Array.isArray(r.data?.items) ? r.data.items : [])
      setMisAvailable(Boolean(r.data?.mis_available))
    } catch {
      setError('Не удалось загрузить назначения')
    } finally {
      setLoading(false)
    }
  }, [sessionToken, apiBase])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div className="space-y-3">
        {[0,1].map(i => (
          <div key={i} className="bg-white rounded-3xl p-5 animate-pulse"
               style={{ border: '1px solid rgba(0,0,0,.06)' }}>
            <div className="h-5 bg-gray-100 rounded w-3/4 mb-2" />
            <div className="h-3 bg-gray-100 rounded w-1/2" />
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white rounded-3xl p-5 text-center"
           style={{ border: '1px solid rgba(0,0,0,.06)' }}>
        <p className="text-sm text-red-500">{error}</p>
        <button onClick={load} className="text-xs text-blue-500 mt-2">Повторить</button>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="bg-white rounded-3xl p-8 text-center"
           style={{ border: '1px solid rgba(0,0,0,.06)', boxShadow: '0 2px 12px rgba(0,0,0,.04)' }}>
        <div className="w-16 h-16 rounded-3xl flex items-center justify-center mx-auto mb-4"
             style={{ background: 'linear-gradient(135deg,#E0F7FA,#B2EBF2)' }}>
          <span className="material-symbols-outlined text-cyan-600 text-3xl">medication</span>
        </div>
        <p className="text-gray-700 font-bold">Назначений пока нет</p>
        <p className="text-gray-400 text-sm mt-1">
          {misAvailable
            ? 'Здесь появятся лекарства, выписанные врачом'
            : 'МИС недоступна — назначения появятся, когда связь восстановится'}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {!misAvailable && items.length > 0 && (
        <div className="bg-amber-50 rounded-2xl p-3 flex items-center gap-2 text-xs text-amber-800"
             style={{ border: '1px solid #FCD34D' }}>
          <span className="material-symbols-outlined text-base">cloud_off</span>
          <span>Показаны данные из кэша. Подключение к МИС временно недоступно.</span>
        </div>
      )}
      {items.map(p => (
        <PrescriptionCard key={`${p.source}-${p.id || p.mis_id || Math.random()}`} p={p} />
      ))}
    </div>
  )
}
