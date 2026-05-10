import { useState, useEffect, useCallback } from 'react'
import api from '../api'
import { Modal, Button, useToast } from '../design'

/**
 * MarketplaceAdminEditor — редактор marketplace-полей модуля (super_admin).
 *
 * Открывается из ModulesCatalogSection (кнопка «✨ Витрина» возле модуля).
 * Позволяет редактировать:
 *   - screenshots:        массив URL
 *   - features_list:      массив строк (один пункт = одна строка)
 *   - default_trial_days: число (1-365)
 *   - popular:            boolean
 *   - setup_complexity:   easy / medium / hard
 *   - monthly_price_demo: float
 *
 * Эндпоинт: PATCH /admin/modules/{key}/marketplace
 */
export default function MarketplaceAdminEditor({ moduleKey, onClose, onSaved }) {
  const [data, setData] = useState(null)
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()

  const load = useCallback(async () => {
    try {
      const r = await api.get('/admin/modules')
      const m = (r.data || []).find(x => x.key === moduleKey)
      if (!m) {
        toast('Модуль не найден', 'error')
        onClose()
        return
      }
      setData({
        screenshots:        (m.screenshots || []).join('\n'),
        features_list:      (m.features_list || []).join('\n'),
        default_trial_days: m.default_trial_days || 14,
        popular:            !!m.popular,
        setup_complexity:   m.setup_complexity || 'easy',
        monthly_price_demo: m.monthly_price_demo ?? '',
      })
    } catch (e) {
      toast('Не удалось загрузить модуль: ' + (e.response?.data?.detail || e.message), 'error')
      onClose()
    }
  }, [moduleKey, toast, onClose])

  useEffect(() => { load() }, [load])

  async function save() {
    if (!data) return
    setSaving(true)
    try {
      const body = {
        screenshots:        data.screenshots.split('\n').map(s => s.trim()).filter(Boolean),
        features_list:      data.features_list.split('\n').map(s => s.trim()).filter(Boolean),
        default_trial_days: Number(data.default_trial_days) || 14,
        popular:            !!data.popular,
        setup_complexity:   data.setup_complexity,
        monthly_price_demo: data.monthly_price_demo === '' ? null : Number(data.monthly_price_demo),
      }
      await api.patch(`/admin/modules/${moduleKey}/marketplace`, body)
      toast('Витрина обновлена', 'success')
      onSaved && onSaved()
      onClose()
    } catch (e) {
      toast('Ошибка сохранения: ' + (e.response?.data?.detail || e.message), 'error')
    }
    setSaving(false)
  }

  if (!data) return null

  return (
    <Modal open onClose={onClose} title={`Витрина модуля: ${moduleKey}`} size="md">
      <div className="space-y-4">
        {/* Скриншоты */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300 mb-1">
            Скриншоты (URL, по одному на строку)
          </label>
          <textarea
            value={data.screenshots}
            onChange={e => setData({ ...data, screenshots: e.target.value })}
            rows={4}
            placeholder="https://cdn.example.com/screen1.png"
            className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Features */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300 mb-1">
            Список фич (по одной на строку)
          </label>
          <textarea
            value={data.features_list}
            onChange={e => setData({ ...data, features_list: e.target.value })}
            rows={5}
            placeholder="Видеозвонки с пациентами&#10;Электронные рецепты&#10;Запись приёма"
            className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Trial / Popular / Complexity / Demo price */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300 mb-1">
              Дней триала по умолчанию
            </label>
            <input
              type="number"
              min={1}
              max={365}
              value={data.default_trial_days}
              onChange={e => setData({ ...data, default_trial_days: e.target.value })}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300 mb-1">
              Сложность подключения
            </label>
            <select
              value={data.setup_complexity}
              onChange={e => setData({ ...data, setup_complexity: e.target.value })}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="easy">Просто</option>
              <option value="medium">Средне</option>
              <option value="hard">Сложно</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300 mb-1">
              Демо-цена «от X ₽/мес»
            </label>
            <input
              type="number"
              min={0}
              step={1}
              value={data.monthly_price_demo}
              onChange={e => setData({ ...data, monthly_price_demo: e.target.value })}
              placeholder="990"
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-[10px] text-gray-400 mt-0.5">Используется если основная цена = 0</p>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={data.popular}
                onChange={e => setData({ ...data, popular: e.target.checked })}
                className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                Badge «Популярно»
              </span>
            </label>
          </div>
        </div>

        <div className="flex gap-2 pt-2 border-t border-gray-100 dark:border-gray-700">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Отмена</Button>
          <Button variant="primary" onClick={save} disabled={saving} className="flex-1">
            {saving ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
