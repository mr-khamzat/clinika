import { useEffect, useState, useMemo } from 'react'
import api from '../../api'

// ─────────────────────────────────────────────────────────────────────
// InternalServicePicker — выбор услуги из собственного каталога клиники.
// Используется в CreateReferralWizard (режим internal).
// API: GET /manager/services/?for_referrals=true — каталог "своих" услуг текущей клиники.
// ─────────────────────────────────────────────────────────────────────
export default function InternalServicePicker({ value, onChange }) {
  const [services, setServices] = useState([])
  const [search, setSearch] = useState('')
  const [activeCat, setActiveCat] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    api.get('/manager/services/', { params: { limit: 5000, for_referrals: true } })
      .then(r => {
        setServices(r.data?.items || r.data || [])
        setLoading(false)
      })
      .catch(() => {
        setServices([])
        setLoading(false)
      })
  }, [])

  // ─── БЛОК: Категории (по полю service.category) ───
  const cats = useMemo(() => {
    const m = new Map()
    services.forEach(s => {
      const key = s.category || '__none__'
      if (!m.has(key)) m.set(key, { name: s.category || 'Без категории', count: 0 })
      m.get(key).count++
    })
    return [...m.entries()].map(([k, v]) => ({ id: k, ...v }))
  }, [services])

  // ─── БЛОК: Фильтр + лимит 500 для производительности ───
  const visible = useMemo(() => services.filter(s =>
    (!activeCat || (s.category || '__none__') === activeCat) &&
    (!search || (s.name || '').toLowerCase().includes(search.toLowerCase()))
  ).slice(0, 500), [services, activeCat, search])

  if (loading) return <div>Загрузка каталога…</div>

  return (
    <div className="grid grid-cols-[260px_1fr] gap-4">
      <aside className="max-h-[500px] overflow-y-auto">
        <div className={`cursor-pointer p-2 rounded text-sm ${!activeCat ? 'bg-blue-50 font-medium' : ''}`} onClick={() => setActiveCat(null)}>
          Все ({services.length})
        </div>
        {cats.sort((a, b) => b.count - a.count).map(c => (
          <div
            key={c.id}
            className={`cursor-pointer p-2 rounded text-sm ${activeCat === c.id ? 'bg-blue-50 font-medium' : ''}`}
            onClick={() => setActiveCat(c.id)}
          >
            {c.name} ({c.count})
          </div>
        ))}
      </aside>
      <div>
        <input
          className="border rounded px-3 py-2 w-full mb-3"
          placeholder="Поиск услуги…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="space-y-1 max-h-[500px] overflow-y-auto">
          {visible.map(s => (
            <label
              key={s.id}
              className={`flex items-center gap-3 p-2 border rounded cursor-pointer hover:bg-gray-50 ${value === s.id ? 'border-blue-600 bg-blue-50' : ''}`}
            >
              <input
                type="radio"
                name="internalSvc"
                checked={value === s.id}
                onChange={() => onChange(s.id, s)}
              />
              <div className="flex-1">
                {s.name} <span className="text-xs text-gray-400">{s.code}</span>
              </div>
              <div className="text-sm">{s.price ?? s.original_price ?? '—'} ₽</div>
            </label>
          ))}
        </div>
        {services.length > visible.length && (
          <div className="text-xs text-gray-400 mt-2">
            Показано {visible.length} из {services.length} — уточните поиск.
          </div>
        )}
      </div>
    </div>
  )
}
