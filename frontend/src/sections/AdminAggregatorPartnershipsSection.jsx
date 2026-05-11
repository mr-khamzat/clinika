/**
 * ========================================
 * БЛОК: AdminAggregatorPartnershipsSection — CRUD партнёрств агрегаторов (Глава 10)
 * ========================================
 * Используется в FranchiseOwnerCabinet (super_admin / franchise_owner).
 *
 * API:
 *   GET    /admin/aggregator/partnerships
 *   POST   /admin/aggregator/partnerships  body {partner_name, commission_pct}
 *      → { id, api_key:'plaintext (показать один раз!)', ... }
 *   PATCH  /admin/aggregator/partnerships/{id} body {commission_pct, status}
 *   DELETE /admin/aggregator/partnerships/{id}
 *
 * Создание показывает plaintext api_key в отдельном ApiKeyDisplayModal —
 * после закрытия модала ключ забывается (бэкенд хранит только хеш).
 * ========================================
 */
import { useCallback, useEffect, useState } from 'react'
import api from '../api'
import { useToast } from '../design'
import PartnershipModal from '../components/aggregator/PartnershipModal'
import ApiKeyDisplayModal from '../components/aggregator/ApiKeyDisplayModal'

function fmtDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: 'short', year: '2-digit' })
  } catch { return iso }
}

function moduleOffBlock() {
  return (
    <div className="rounded-2xl p-6 text-center" style={{ background: '#fef3c7', border: '1px solid #fde68a' }}>
      <span className="material-symbols-outlined text-3xl mb-2 block" style={{ color: '#92400e' }}>lock</span>
      <p className="text-sm font-semibold" style={{ color: '#92400e' }}>Модуль агрегаторов не подключён.</p>
      <p className="text-xs mt-1" style={{ color: '#92400e' }}>
        Подключите модуль <code>aggregator_integration</code> в «Маркетплейс модулей».
      </p>
    </div>
  )
}

export default function AdminAggregatorPartnershipsSection() {
  const { toast } = useToast()
  const [items, setItems]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)

  // Модал create/edit
  const [editing, setEditing]   = useState(null)
  const [creating, setCreating] = useState(false)

  // Модал показа api-key (после успешного create)
  const [issuedKey, setIssuedKey] = useState(null)         // { api_key, partner_name }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await api.get('/admin/aggregator/partnerships')
      setItems(Array.isArray(r.data) ? r.data : (r.data?.items || []))
    } catch (e) {
      if (e?.response?.status === 402) setError('module_off')
      else setError('load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const onSaved = (createResult) => {
    // createResult приходит только при создании (с api_key)
    if (createResult && createResult.api_key) {
      setIssuedKey({
        api_key: createResult.api_key,
        partner_name: createResult.partner_name || 'партнёр',
      })
    }
    load()
  }

  const removePartnership = async (id, name) => {
    if (!confirm(`Удалить партнёрство «${name}»? Существующие лиды сохранятся, но новые не будут приниматься.`)) return
    try {
      await api.delete(`/admin/aggregator/partnerships/${id}`)
      toast({ kind: 'success', text: 'Партнёрство удалено' })
      load()
    } catch (e) {
      toast({ kind: 'error', text: e?.response?.data?.detail || 'Не удалось удалить' })
    }
  }

  if (error === 'module_off') return moduleOffBlock()

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs" style={{ color: '#64748b' }}>
          Всего партнёрств: <b style={{ color: '#0f172a' }}>{items.length}</b>
          {items.length > 0 && (
            <> · активных: <b style={{ color: '#15803d' }}>{items.filter(p => p.status === 'active').length}</b></>
          )}
        </div>
        <button
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold text-white transition-all active:scale-95"
          style={{ background: '#0097A7' }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
          Подключить партнёра
        </button>
      </div>

      {loading && (
        <div className="space-y-2">
          {[0,1,2].map(i => <div key={i} className="h-16 rounded-2xl animate-pulse" style={{ background: '#e5e7eb' }} />)}
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="rounded-2xl p-10 text-center" style={{ background: '#f9fafb', border: '1px dashed #e5e7eb' }}>
          <span className="material-symbols-outlined text-4xl mb-2 block" style={{ color: '#9ca3af' }}>handshake</span>
          <p className="text-sm font-semibold text-gray-700">Партнёрств пока нет</p>
          <p className="text-xs text-gray-500 mt-1">
            Подключите DocDoc, ПроДокторов или Яндекс.Здоровье — кнопка справа сверху
          </p>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div
          className="overflow-x-auto rounded-2xl"
          style={{ border: '1px solid #e5e7eb', background: '#fff' }}
        >
          <table className="w-full text-sm">
            <thead style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2 font-semibold">Партнёр</th>
                <th className="px-3 py-2 font-semibold text-right">Комиссия</th>
                <th className="px-3 py-2 font-semibold">Статус</th>
                <th className="px-3 py-2 font-semibold">Создан</th>
                <th className="px-3 py-2 font-semibold text-right">Действия</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p, i) => (
                <tr key={p.id} style={{ borderTop: i === 0 ? 'none' : '1px solid #f1f5f9' }}>
                  <td className="px-3 py-3" style={{ color: '#0f172a' }}>
                    <div className="flex items-center gap-2">
                      <span
                        className="material-symbols-outlined flex-shrink-0"
                        style={{ fontSize: 18, color: '#0097A7' }}
                      >campaign</span>
                      <span className="font-semibold">{p.partner_name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right" style={{ fontVariantNumeric: 'tabular-nums', color: '#0f172a', fontWeight: 600 }}>
                    {Number(p.commission_pct ?? 0).toFixed(1)}%
                  </td>
                  <td className="px-3 py-3">
                    {p.status === 'active' ? (
                      <span style={{ padding: '3px 8px', borderRadius: 999, background: '#dcfce7', color: '#166534', fontSize: 11, fontWeight: 700 }}>
                        Активно
                      </span>
                    ) : p.status === 'suspended' ? (
                      <span style={{ padding: '3px 8px', borderRadius: 999, background: '#fef3c7', color: '#92400e', fontSize: 11, fontWeight: 700 }}>
                        Приостановлено
                      </span>
                    ) : (
                      <span style={{ padding: '3px 8px', borderRadius: 999, background: '#f1f5f9', color: '#64748b', fontSize: 11, fontWeight: 700 }}>
                        {p.status || '—'}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3" style={{ color: '#64748b', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                    {fmtDate(p.created_at)}
                  </td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    <button
                      onClick={() => setEditing(p)}
                      className="text-xs font-semibold mr-1 transition-colors"
                      style={{ color: '#475569', padding: '4px 8px', borderRadius: 8, background: '#f1f5f9' }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => removePartnership(p.id, p.partner_name)}
                      className="text-xs font-semibold transition-colors"
                      style={{ color: '#b91c1c', padding: '4px 8px', borderRadius: 8, background: '#fef2f2' }}
                    >
                      Del
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PartnershipModal
        open={creating || !!editing}
        initial={editing}
        onClose={() => { setCreating(false); setEditing(null) }}
        onSaved={onSaved}
      />

      <ApiKeyDisplayModal
        open={!!issuedKey}
        apiKey={issuedKey?.api_key}
        partnerName={issuedKey?.partner_name}
        onClose={() => setIssuedKey(null)}
      />
    </div>
  )
}
