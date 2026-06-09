/**
 * ========================================
 * БЛОК: FranchiseModuleGapsSection — «Остатки модулей»
 * ========================================
 * Gap-анализ платных модулей по клиникам сети:
 *   - Заголовок с total potential revenue (упущенная MRR)
 *   - Топ-5 модулей которых не хватает чаще всего
 *   - Список клиник, у каждой свернутый список непосвящённых модулей
 *   - Кнопка «Push recommendation» на каждую клинику
 *
 * Backend:
 *   GET  /franchise-owner/module-gaps
 *   GET  /franchise-owner/module-gaps/summary
 *   POST /franchise-owner/module-gaps/push-recommendation
 * ========================================
 */
import { useEffect, useState, useCallback } from 'react'
import api from '../api'
import { Card, Button, Chip, EmptyState, Skeleton, useToast } from '../design'


const fmtRub = (v) =>
  new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 })
    .format(Math.round(v || 0))


export default function FranchiseModuleGapsSection() {
  const { showToast } = useToast?.() || { showToast: () => {} }

  const [summary, setSummary] = useState(null)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState({})  // tenant_id → bool
  const [pushing, setPushing] = useState({})    // tenant_id → bool

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [s, l] = await Promise.all([
        api.get('/franchise-owner/module-gaps/summary'),
        api.get('/franchise-owner/module-gaps'),
      ])
      setSummary(s.data)
      setItems(l.data?.items || [])
    } catch (e) {
      const msg = e?.response?.data?.detail || 'Не удалось загрузить остатки модулей'
      setError(msg)
      showToast?.({ type: 'error', message: msg })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handlePush = async (tenantId, moduleKey) => {
    setPushing((p) => ({ ...p, [tenantId]: true }))
    try {
      await api.post('/franchise-owner/module-gaps/push-recommendation', {
        tenant_id: tenantId,
        module_key: moduleKey || null,
      })
      showToast?.({ type: 'success', message: 'Рекомендация отправлена' })
    } catch (e) {
      const msg = e?.response?.data?.detail || 'Не удалось отправить рекомендацию'
      showToast?.({ type: 'error', message: msg })
    } finally {
      setPushing((p) => ({ ...p, [tenantId]: false }))
    }
  }

  if (loading) return <Skeleton height={400} />
  if (error) return <EmptyState title="Ошибка" description={error} />

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* ── Total potential revenue ─────────────────────────────────── */}
      {summary && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
            <div>
              <div style={{ fontSize: 13, opacity: 0.7 }}>Упущенная MRR (Potential Revenue)</div>
              <div style={{ fontSize: 32, fontWeight: 700 }}>
                {fmtRub(summary.total_potential_revenue || 0)}
              </div>
              <div style={{ fontSize: 13, opacity: 0.7, marginTop: 4 }}>
                Клиник с пропусками: <b>{summary.clinics_with_gaps}</b> из <b>{summary.total_clinics}</b>
              </div>
            </div>
            <Button variant="ghost" onClick={load}>Обновить</Button>
          </div>
        </Card>
      )}

      {/* ── Top missing modules ─────────────────────────────────────── */}
      {summary?.top_missing_modules?.length > 0 && (
        <Card>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Чаще всего не подключены</div>
          <div style={{ display: 'grid', gap: 8 }}>
            {summary.top_missing_modules.map((m) => (
              <div
                key={m.key}
                style={{
                  display: 'grid', gridTemplateColumns: '1fr 100px 120px 140px',
                  gap: 10, alignItems: 'center',
                  padding: '8px 10px',
                  background: 'var(--ks-bg-subtle, #f6f7f9)', borderRadius: 6,
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{m.name}</div>
                  <div style={{ fontSize: 12, opacity: 0.6 }}>{m.category}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <Chip>{m.missing_clinics_count} клиник</Chip>
                </div>
                <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>
                  {fmtRub(m.monthly_price_rub)}/мес
                </div>
                <div style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  +{fmtRub(m.potential_revenue)}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Per-clinic list ─────────────────────────────────────────── */}
      <div style={{ display: 'grid', gap: 8 }}>
        {items.length === 0 ? (
          <EmptyState title="Все клиники подключили все модули" description="" />
        ) : (
          items.map((row) => {
            const isOpen = !!expanded[row.tenant_id]
            return (
              <Card key={row.tenant_id}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontWeight: 600 }}>{row.clinic_name}</div>
                    <div style={{ fontSize: 12, opacity: 0.6 }}>{row.tenant_name}</div>
                  </div>
                  <Chip>{row.missing_count} пропущено</Chip>
                  <div style={{ fontWeight: 600, minWidth: 140, textAlign: 'right' }}>
                    +{fmtRub(row.potential_revenue)}/мес
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() => setExpanded((p) => ({ ...p, [row.tenant_id]: !isOpen }))}
                  >
                    {isOpen ? 'Скрыть' : 'Показать'}
                  </Button>
                  <Button
                    onClick={() => handlePush(row.tenant_id, null)}
                    disabled={!!pushing[row.tenant_id] || row.missing_count === 0}
                  >
                    {pushing[row.tenant_id] ? 'Отправка…' : 'Push recommendation'}
                  </Button>
                </div>

                {isOpen && row.missing_modules?.length > 0 && (
                  <div style={{ display: 'grid', gap: 6, marginTop: 12 }}>
                    {row.missing_modules.map((m) => (
                      <div
                        key={m.key}
                        style={{
                          display: 'grid', gridTemplateColumns: '1fr 110px 140px 110px', gap: 10,
                          alignItems: 'center', padding: '6px 10px',
                          background: 'var(--ks-bg-subtle, #f6f7f9)', borderRadius: 6,
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 500 }}>{m.name}</div>
                          <div style={{ fontSize: 11, opacity: 0.6 }}>{m.category}</div>
                        </div>
                        <Chip>{m.category}</Chip>
                        <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {fmtRub(m.monthly_price_rub)}/мес
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <Button
                            variant="ghost"
                            onClick={() => handlePush(row.tenant_id, m.key)}
                            disabled={!!pushing[row.tenant_id]}
                          >
                            Push
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}
