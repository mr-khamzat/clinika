/**
 * ========================================
 * БЛОК: Вкладка "Категории" партнёрского прайса
 * ========================================
 * - Список категорий клиники-владельца
 * - Добавление / переключение активности / удаление
 * - При удалении связанные офферы остаются (category_id обнуляется на бэке).
 * ========================================
 */
import { useState, useEffect } from 'react'
import { partnerCategoriesApi } from '../../api/partnerOffers'

export default function PartnerCategoriesTab() {
  const [cats, setCats] = useState([])
  const [name, setName] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    try {
      setLoading(true)
      const data = await partnerCategoriesApi.list()
      setCats(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e.response?.data?.detail || 'Не удалось загрузить категории')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const add = async () => {
    if (!name.trim()) return
    try {
      await partnerCategoriesApi.create({ name: name.trim() })
      setName('')
      setError(null)
      await load()
    } catch (e) {
      setError(e.response?.data?.detail || 'Ошибка создания категории')
    }
  }

  const toggle = async (cat) => {
    try {
      await partnerCategoriesApi.update(cat.id, { is_active: !cat.is_active })
      await load()
    } catch (e) {
      setError(e.response?.data?.detail || 'Ошибка обновления')
    }
  }

  const remove = async (id) => {
    if (!window.confirm('Удалить категорию? Связанные офферы останутся без категории.')) return
    try {
      await partnerCategoriesApi.remove(id)
      await load()
    } catch (e) {
      setError(e.response?.data?.detail || 'Ошибка удаления')
    }
  }

  return (
    <div className="p-4">
      <div className="flex gap-2 mb-4">
        <input
          className="border rounded px-3 py-2 flex-1"
          placeholder="Название категории (напр., Премиум-анализы)"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
        />
        <button
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded disabled:opacity-50"
          onClick={add}
          disabled={!name.trim()}
        >
          + Категория
        </button>
      </div>
      {error && <div className="text-red-600 mb-2 text-sm">{error}</div>}
      {loading && cats.length === 0 ? (
        <div className="text-gray-500 text-sm py-4">Загрузка…</div>
      ) : cats.length === 0 ? (
        <div className="text-gray-500 text-sm py-4">Категорий пока нет.</div>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="text-left text-sm text-gray-500">
              <th className="py-2">Название</th>
              <th className="py-2 w-24">Активна</th>
              <th className="py-2 w-20">Действия</th>
            </tr>
          </thead>
          <tbody>
            {cats.map(c => (
              <tr key={c.id} className="border-t">
                <td className="py-2">{c.name}</td>
                <td className="py-2">
                  <input
                    type="checkbox"
                    checked={!!c.is_active}
                    onChange={() => toggle(c)}
                  />
                </td>
                <td className="py-2">
                  <button
                    className="text-red-600 hover:text-red-800"
                    onClick={() => remove(c.id)}
                    title="Удалить"
                  >
                    Удалить
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
