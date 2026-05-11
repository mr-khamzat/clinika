/**
 * ========================================
 * БЛОК: DoctorLabOrdersSection — заявки врача на лабораторные анализы (Глава 10)
 * ========================================
 * Используется внутри DoctorLayout (пункт «Анализы»).
 *
 * API (backend-агент уточнит финальные пути):
 *   GET  /doctor/lab-orders?patient_id=&status=  — список заявок врача
 *   GET  /doctor/lab-orders/{id}/results         — результаты конкретной заявки
 *   POST /doctor/lab-orders                      — создать заявку
 *   GET  /admin/lab/providers                    — список провайдеров (для формы)
 *
 * UX:
 *   • Top-bar: фильтр по статусу + кнопка «+ Новая заявка»
 *   • Таблица: Пациент / Лаборатория / Анализы / Статус / Дата
 *   • Клик по строке → модал с результатами и кнопкой «Скачать PDF»
 * ========================================
 */
import { useEffect, useState, useCallback, useMemo, lazy, Suspense } from 'react'
import api from '../api'
import { Card, Button, Chip, Tabs, EmptyState, Modal, useToast, Skeleton } from '../design'
import LabResultsTable from '../components/lab/LabResultsTable'

const LabOrderForm = lazy(() => import('../components/lab/LabOrderForm'))

// Цветовые карты статусов (Глава 10).
const STATUS_META = {
  created:        { l: 'Создана',         v: 'default' },
  sent:           { l: 'Отправлена',      v: 'accent'  },
  in_progress:    { l: 'В работе',        v: 'accent'  },
  results_ready:  { l: 'Готовы',          v: 'good'    },
  delivered:      { l: 'Доставлены',      v: 'default' },
  error:          { l: 'Ошибка',          v: 'bad'     },
  cancelled:      { l: 'Отменена',        v: 'warn'    },
}

function fmtDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch { return iso }
}

function MIcon({ name, size = 18, fill = false }) {
  return (
    <span
      className="material-symbols-outlined"
      style={{ fontSize: size, lineHeight: 1, fontVariationSettings: fill ? "'FILL' 1" : "'FILL' 0" }}
    >
      {name}
    </span>
  )
}

export default function DoctorLabOrdersSection() {
  const { toast } = useToast()
  const [orders, setOrders] = useState([])
  const [providers, setProviders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all')
  const [formOpen, setFormOpen] = useState(false)

  // Модал результатов
  const [detailOrder, setDetailOrder] = useState(null)
  const [detailResults, setDetailResults] = useState(null)
  const [detailBusy, setDetailBusy] = useState(false)

  const loadOrders = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await api.get('/doctor/lab-orders')
      setOrders(Array.isArray(r.data) ? r.data : (r.data?.orders || []))
    } catch (e) {
      if (e?.response?.status === 402) setError('module_off')
      else setError('load')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadProviders = useCallback(async () => {
    try {
      const r = await api.get('/admin/lab/providers')
      setProviders(Array.isArray(r.data) ? r.data : (r.data?.providers || []))
    } catch {
      setProviders([])
    }
  }, [])

  useEffect(() => { loadOrders(); loadProviders() }, [loadOrders, loadProviders])

  const tabs = useMemo(() => {
    const count = (st) => orders.filter(o => o.status === st).length
    return [
      { id: 'all',           label: 'Все',          badge: orders.length },
      { id: 'in_progress',   label: 'В работе',     badge: count('in_progress') + count('sent') + count('created') },
      { id: 'results_ready', label: 'Готовы',       badge: count('results_ready') },
      { id: 'delivered',     label: 'Архив',        badge: count('delivered') },
      { id: 'error',         label: 'Ошибки',       badge: count('error') },
    ]
  }, [orders])

  const filteredOrders = useMemo(() => {
    if (filter === 'all') return orders
    if (filter === 'in_progress') return orders.filter(o => ['in_progress','sent','created'].includes(o.status))
    return orders.filter(o => o.status === filter)
  }, [orders, filter])

  const openDetail = async (order) => {
    setDetailOrder(order)
    setDetailResults(null)
    if (!['results_ready','delivered'].includes(order.status)) return
    setDetailBusy(true)
    try {
      const r = await api.get(`/doctor/lab-orders/${order.id}/results`)
      setDetailResults(Array.isArray(r.data) ? r.data : (r.data?.results || []))
    } catch (e) {
      toast({ kind: 'error', text: e?.response?.data?.detail || 'Не удалось загрузить результаты' })
      setDetailResults([])
    } finally {
      setDetailBusy(false)
    }
  }

  const closeDetail = () => { setDetailOrder(null); setDetailResults(null) }

  const downloadPdf = async () => {
    if (!detailOrder) return
    try {
      const r = await api.get(`/doctor/lab-orders/${detailOrder.id}/pdf`, { responseType: 'blob' })
      const blob = new Blob([r.data], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `lab-order-${detailOrder.id}.pdf`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {
      toast({ kind: 'info', text: 'PDF пока недоступен' })
    }
  }

  // ── 402: модуль не подключён ───────────────────────────────────────────────
  if (error === 'module_off') {
    return (
      <div className="rounded-2xl p-6 text-center" style={{ background: '#fef3c7', border: '1px solid #fde68a' }}>
        <span className="material-symbols-outlined text-3xl mb-2 block" style={{ color: '#92400e' }}>lock</span>
        <p className="text-sm font-semibold" style={{ color: '#92400e' }}>
          Модуль лабораторных интеграций не подключён.
        </p>
        <p className="text-xs mt-1" style={{ color: '#92400e' }}>
          Попросите управляющего подключить модуль <code>lab_integration</code> в «Маркетплейс модулей».
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--fg, #0f172a)', letterSpacing: '-0.01em' }}>
            Лабораторные анализы
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-3, #64748b)', marginTop: 2 }}>
            Заявки на анализы и получение результатов через подключённые лаборатории
          </div>
        </div>
        <Button
          onClick={() => setFormOpen(true)}
          leftIcon={<MIcon name="add" size={16} />}
          disabled={providers.length === 0}
        >
          Новая заявка
        </Button>
      </div>

      {/* ── Tabs фильтр ── */}
      <div className="overflow-x-auto -mx-2 px-2">
        <Tabs items={tabs} value={filter} onChange={setFilter} />
      </div>

      {/* ── List ── */}
      {loading && (
        <div className="flex flex-col gap-2">
          {[0,1,2].map(i => <Skeleton key={i} height={56} />)}
        </div>
      )}

      {!loading && filteredOrders.length === 0 && (
        <Card>
          <EmptyState
            icon={<MIcon name="biotech" size={28} />}
            title="Заявок пока нет"
            message={
              providers.length === 0
                ? 'Подключите хотя бы одну лабораторию через управляющего, чтобы создать первую заявку.'
                : 'Создайте первую заявку — кнопка «Новая заявка» сверху справа.'
            }
          />
        </Card>
      )}

      {!loading && filteredOrders.length > 0 && (
        <Card padded={false}>
          {/* Desktop таблица */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full" style={{ fontSize: 13, borderCollapse: 'collapse' }}>
              <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <tr style={{ textTransform: 'uppercase', fontSize: 10.5, letterSpacing: '0.06em', color: '#64748b' }}>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Пациент</th>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Лаборатория</th>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Анализы</th>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600 }}>Статус</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600 }}>Дата</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((o, i) => {
                  const st = STATUS_META[o.status] || { l: o.status || '—', v: 'default' }
                  const tests = Array.isArray(o.test_codes) ? o.test_codes : (o.tests || [])
                  return (
                    <tr
                      key={o.id}
                      onClick={() => openDetail(o)}
                      className="cursor-pointer transition-colors hover:bg-gray-50"
                      style={{ borderBottom: i === filteredOrders.length - 1 ? 'none' : '1px solid #f1f5f9' }}
                    >
                      <td style={{ padding: '12px 14px', color: '#0f172a', fontWeight: 600 }}>
                        {o.patient_name || `id ${o.patient_id}` || '—'}
                      </td>
                      <td style={{ padding: '12px 14px', color: '#475569' }}>
                        {o.provider_name || '—'}
                      </td>
                      <td style={{ padding: '12px 14px', color: '#475569' }}>
                        <span style={{
                          display: 'inline-flex', gap: 4, flexWrap: 'wrap',
                          maxWidth: 280,
                        }}>
                          {tests.slice(0, 3).map(t => (
                            <span key={t} style={{
                              fontSize: 11, padding: '2px 7px', borderRadius: 999,
                              background: '#f1f5f9', color: '#475569', fontWeight: 600,
                            }}>{t}</span>
                          ))}
                          {tests.length > 3 && (
                            <span style={{ fontSize: 11, color: '#94a3b8' }}>+{tests.length - 3}</span>
                          )}
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <Chip variant={st.v}>{st.l}</Chip>
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', color: '#64748b', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtDate(o.created_at)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile list */}
          <div className="md:hidden flex flex-col">
            {filteredOrders.map((o, i) => {
              const st = STATUS_META[o.status] || { l: o.status || '—', v: 'default' }
              const tests = Array.isArray(o.test_codes) ? o.test_codes : (o.tests || [])
              return (
                <button
                  key={o.id}
                  onClick={() => openDetail(o)}
                  className="text-left transition-colors active:bg-gray-50"
                  style={{
                    padding: '12px 14px',
                    borderBottom: i === filteredOrders.length - 1 ? 'none' : '1px solid #f1f5f9',
                  }}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: '#0f172a' }}>
                      {o.patient_name || `id ${o.patient_id}` || '—'}
                    </div>
                    <Chip variant={st.v}>{st.l}</Chip>
                  </div>
                  <div style={{ fontSize: 11.5, color: '#64748b' }}>
                    {o.provider_name || '—'} · {fmtDate(o.created_at)}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {tests.slice(0, 4).map(t => (
                      <span key={t} style={{
                        fontSize: 10.5, padding: '2px 7px', borderRadius: 999,
                        background: '#f1f5f9', color: '#475569', fontWeight: 600,
                      }}>{t}</span>
                    ))}
                    {tests.length > 4 && (
                      <span style={{ fontSize: 10.5, color: '#94a3b8' }}>+{tests.length - 4}</span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </Card>
      )}

      {/* ── Modal: создание ── */}
      {formOpen && (
        <Suspense fallback={null}>
          <LabOrderForm
            open={formOpen}
            providers={providers}
            api={api}
            onClose={() => setFormOpen(false)}
            onCreated={() => { setFormOpen(false); loadOrders() }}
          />
        </Suspense>
      )}

      {/* ── Modal: детали ── */}
      {detailOrder && (
        <Modal open={!!detailOrder} onClose={closeDetail} title={`Заявка #${detailOrder.id}`} size="lg">
          <div className="flex flex-col gap-3" style={{ minWidth: 320 }}>
            <div className="grid grid-cols-2 gap-3" style={{ fontSize: 13 }}>
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Пациент</div>
                <div style={{ color: '#0f172a', fontWeight: 600, marginTop: 2 }}>{detailOrder.patient_name || '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Лаборатория</div>
                <div style={{ color: '#0f172a', fontWeight: 600, marginTop: 2 }}>{detailOrder.provider_name || '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Статус</div>
                <div className="mt-1">
                  <Chip variant={(STATUS_META[detailOrder.status] || {}).v || 'default'}>
                    {(STATUS_META[detailOrder.status] || {}).l || detailOrder.status}
                  </Chip>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Создана</div>
                <div style={{ color: '#0f172a', fontWeight: 600, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
                  {fmtDate(detailOrder.created_at)}
                </div>
              </div>
            </div>

            {detailOrder.notes && (
              <div className="rounded-xl" style={{ padding: 10, background: '#f8fafc', border: '1px solid #e2e8f0', fontSize: 12.5, color: '#475569' }}>
                <b style={{ color: '#0f172a' }}>Комментарий: </b>{detailOrder.notes}
              </div>
            )}

            {detailBusy && (
              <div className="flex flex-col gap-2">
                {[0,1,2].map(i => <Skeleton key={i} height={36} />)}
              </div>
            )}

            {!detailBusy && detailResults && (
              <>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>Результаты</div>
                <LabResultsTable results={detailResults} />
              </>
            )}

            {!detailBusy && !detailResults && !['results_ready','delivered'].includes(detailOrder.status) && (
              <div className="rounded-xl p-4 text-center" style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af', fontSize: 13 }}>
                Лаборатория ещё не передала результаты. Мы пришлём уведомление, когда они будут готовы.
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2" style={{ borderTop: '1px solid #f1f5f9' }}>
              {['results_ready','delivered'].includes(detailOrder.status) && (
                <Button variant="secondary" onClick={downloadPdf} leftIcon={<MIcon name="download" size={15} />}>
                  Скачать PDF
                </Button>
              )}
              <Button variant="ghost" onClick={closeDetail}>Закрыть</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
