import { useEffect, useState, useMemo } from 'react'
import { partnerOffersApi } from '../../api/partnerOffers'

// ─────────────────────────────────────────────────────────────────────
// PartnerOfferPicker — выбор услуги из партнёрского прайса другой клиники
// франшизы. Используется в CreateReferralWizard (режим external).
// API: partnerOffersApi.listForClinic(clinicId) — список офферов (Task 7).
// ─────────────────────────────────────────────────────────────────────
export default function PartnerOfferPicker({ clinicId, value, onChange }) {
  const [offers, setOffers] = useState([])
  const [search, setSearch] = useState('')
  const [activeCat, setActiveCat] = useState(null)

  useEffect(() => {
    if (!clinicId) return
    partnerOffersApi.listForClinic(clinicId).then(setOffers).catch(() => setOffers([]))
  }, [clinicId])

  // ─── БЛОК: Сборка списка категорий с счётчиками ───
  const cats = useMemo(() => {
    const m = new Map()
    offers.forEach(o => {
      const key = o.category_id || '__none__'
      const name = o.category_name || 'Без категории'
      if (!m.has(key)) m.set(key, { id: key, name, count: 0 })
      m.get(key).count++
    })
    return [...m.values()]
  }, [offers])

  // ─── БЛОК: Видимый набор — фильтр по категории и поиску ───
  const visible = offers.filter(o =>
    (!activeCat || (o.category_id || '__none__') === activeCat) &&
    (!search || o.service_name.toLowerCase().includes(search.toLowerCase()))
  )

  if (!clinicId) return <div className="text-gray-500">Сначала выберите клинику.</div>
  if (offers.length === 0) return <div className="text-gray-500">У выбранной клиники пока нет партнёрского прайса.</div>

  return (
    <div className="grid grid-cols-[200px_1fr] gap-4">
      <aside>
        <div className={`cursor-pointer p-2 rounded ${!activeCat ? 'bg-blue-50 font-medium' : ''}`} onClick={() => setActiveCat(null)}>
          Все ({offers.length})
        </div>
        {cats.map(c => (
          <div
            key={c.id}
            className={`cursor-pointer p-2 rounded ${activeCat === c.id ? 'bg-blue-50 font-medium' : ''}`}
            onClick={() => setActiveCat(c.id)}
          >
            {c.name} ({c.count})
          </div>
        ))}
      </aside>
      <div>
        <input
          className="border rounded px-3 py-2 w-full mb-3"
          placeholder="Поиск…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="space-y-2 max-h-[500px] overflow-y-auto">
          {visible.map(o => (
            <label
              key={o.id}
              className={`flex items-center gap-3 p-3 border rounded cursor-pointer hover:bg-gray-50 ${value === o.service_id ? 'border-blue-600 bg-blue-50' : ''}`}
            >
              <input
                type="radio"
                name="partnerOffer"
                checked={value === o.service_id}
                onChange={() => onChange(o.service_id, o)}
              />
              <div className="flex-1">
                <div className="font-medium">{o.service_name}</div>
                <div className="text-sm text-gray-500">{o.service_code}</div>
              </div>
              <div className="text-right">
                <div>{o.price_override ?? o.service_original_price ?? '—'} ₽</div>
                <div className="text-sm text-green-600 font-semibold">💰 +{o.payout_amount} ₽</div>
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}
