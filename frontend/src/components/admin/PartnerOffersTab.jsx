/**
 * ========================================
 * БЛОК: Вкладка "Услуги в прайсе" партнёрского прайса
 * ========================================
 * - Таблица офферов клиники-владельца (свой прайс).
 * - Inline-редактирование категории / price_override / payout / активности.
 * - Модалка массового добавления услуг из каталога МИС (manager/services/).
 * ========================================
 */
import { useState, useEffect } from 'react'
import { partnerOffersApi, partnerCategoriesApi } from '../../api/partnerOffers'
import api from '../../api'

export default function PartnerOffersTab() {
  const [offers, setOffers] = useState([])
  const [cats, setCats] = useState([])
  const [showAddModal, setShowAddModal] = useState(false)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    try {
      setLoading(true)
      const [offersData, catsData] = await Promise.all([
        partnerOffersApi.listMy(true),
        partnerCategoriesApi.list(),
      ])
      setOffers(Array.isArray(offersData) ? offersData : [])
      setCats(Array.isArray(catsData) ? catsData : [])
    } catch (e) {
      setError(e.response?.data?.detail || 'Не удалось загрузить прайс')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const updateOffer = async (id, patch) => {
    try {
      await partnerOffersApi.update(id, patch)
      setError(null)
      await load()
    } catch (e) {
      setError(e.response?.data?.detail || 'Ошибка обновления оффера')
    }
  }

  const removeOffer = async (id) => {
    if (!window.confirm('Удалить оффер?')) return
    try {
      await partnerOffersApi.remove(id)
      await load()
    } catch (e) {
      setError(e.response?.data?.detail || 'Ошибка удаления')
    }
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <button
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
          onClick={() => setShowAddModal(true)}
        >
          + Добавить услуги в прайс
        </button>
        {loading && <span className="text-sm text-gray-400">Загрузка…</span>}
      </div>
      {error && <div className="text-red-600 mb-2 text-sm">{error}</div>}
      {offers.length === 0 && !loading ? (
        <div className="text-gray-500 text-sm py-4">В партнёрском прайсе пока нет услуг.</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500">
              <th className="py-2">Услуга</th>
              <th className="py-2">Категория</th>
              <th className="py-2 w-24">Цена МИС</th>
              <th className="py-2 w-28">Цена override</th>
              <th className="py-2 w-28">Выплата ₽</th>
              <th className="py-2 w-20">Активна</th>
              <th className="py-2 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {offers.map(o => (
              <tr key={o.id} className="border-t align-middle">
                <td className="py-2">
                  <div>{o.service_name}</div>
                  {o.service_code && (
                    <div className="text-xs text-gray-400">{o.service_code}</div>
                  )}
                </td>
                <td className="py-2">
                  <select
                    className="border rounded px-2 py-1"
                    value={o.category_id || ''}
                    onChange={e => updateOffer(o.id, { category_id: e.target.value || null })}
                  >
                    <option value="">— без категории —</option>
                    {cats.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </td>
                <td className="py-2 text-gray-500">
                  {o.service_original_price ?? '—'}
                </td>
                <td className="py-2">
                  <input
                    type="number"
                    step="0.01"
                    defaultValue={o.price_override ?? ''}
                    className="border rounded px-2 py-1 w-24"
                    onBlur={e => {
                      const v = e.target.value
                      const next = v === '' ? null : Number(v)
                      if (next === (o.price_override ?? null)) return
                      updateOffer(o.id, { price_override: next })
                    }}
                  />
                </td>
                <td className="py-2">
                  <input
                    type="number"
                    step="0.01"
                    defaultValue={o.payout_amount}
                    className="border rounded px-2 py-1 w-24"
                    onBlur={e => {
                      const next = Number(e.target.value)
                      if (Number.isNaN(next) || next === Number(o.payout_amount)) return
                      updateOffer(o.id, { payout_amount: next })
                    }}
                  />
                </td>
                <td className="py-2">
                  <input
                    type="checkbox"
                    checked={!!o.is_active}
                    onChange={() => updateOffer(o.id, { is_active: !o.is_active })}
                  />
                </td>
                <td className="py-2">
                  <button
                    className="text-red-600 hover:text-red-800"
                    onClick={() => removeOffer(o.id)}
                  >
                    Удалить
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {showAddModal && (
        <BulkAddOfferModal
          cats={cats}
          onClose={() => setShowAddModal(false)}
          onAdded={load}
        />
      )}
    </div>
  )
}

/**
 * Модалка массового добавления услуг в партнёрский прайс.
 * Источник каталога — /manager/services/ (с фильтром search и tenant-isolation).
 */
function BulkAddOfferModal({ cats, onClose, onAdded }) {
  const [search, setSearch] = useState('')
  const [services, setServices] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [payout, setPayout] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const r = await api.get('/manager/services/', { params: { search } })
        // /manager/services/ возвращает массив объектов напрямую
        setServices(Array.isArray(r.data) ? r.data : (r.data?.items || []))
      } catch (e) {
        setError(e.response?.data?.detail || 'Не удалось загрузить каталог МИС')
      }
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  const toggleSel = (id) => {
    const ns = new Set(selected)
    if (ns.has(id)) ns.delete(id)
    else ns.add(id)
    setSelected(ns)
  }

  const submit = async () => {
    if (!selected.size || !payout) return
    try {
      setSubmitting(true)
      setError(null)
      await partnerOffersApi.createBulk({
        service_ids: [...selected],
        payout_amount: Number(payout),
        category_id: categoryId || null,
      })
      onAdded()
      onClose()
    } catch (e) {
      setError(e.response?.data?.detail || 'Ошибка массового добавления')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-[700px] max-w-[95vw] max-h-[85vh] flex flex-col p-4 shadow-xl">
        <h3 className="text-lg font-semibold mb-3">Добавить услуги в партнёрский прайс</h3>
        <input
          className="border rounded px-3 py-2 mb-3"
          placeholder="Поиск по каталогу МИС…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="flex gap-2 mb-3">
          <input
            type="number"
            step="0.01"
            placeholder="Выплата ₽ (для всех выбранных)"
            className="border rounded px-3 py-2 flex-1"
            value={payout}
            onChange={e => setPayout(e.target.value)}
          />
          <select
            className="border rounded px-3 py-2 flex-1"
            value={categoryId}
            onChange={e => setCategoryId(e.target.value)}
          >
            <option value="">— без категории —</option>
            {cats.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        {error && <div className="text-red-600 mb-2 text-sm">{error}</div>}
        <div className="flex-1 overflow-y-auto border rounded mb-3">
          {services.length === 0 ? (
            <div className="text-gray-500 text-sm p-4">Услуг по запросу нет.</div>
          ) : services.map(s => (
            <label
              key={s.id}
              className="flex items-center gap-2 p-2 border-b hover:bg-gray-50 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.has(s.id)}
                onChange={() => toggleSel(s.id)}
              />
              <span className="flex-1">{s.name}</span>
              <span className="text-sm text-gray-500">{s.category}</span>
              <span className="text-sm">{s.price ?? s.original_price ?? '—'} ₽</span>
            </label>
          ))}
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-500">Выбрано: {selected.size}</span>
          <div className="flex gap-2">
            <button className="px-4 py-2" onClick={onClose} disabled={submitting}>
              Отмена
            </button>
            <button
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded disabled:opacity-50"
              disabled={!selected.size || !payout || submitting}
              onClick={submit}
            >
              {submitting ? 'Добавляем…' : 'Добавить'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
