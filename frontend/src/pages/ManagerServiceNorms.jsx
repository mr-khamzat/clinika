/**
 * ========================================
 * БЛОК: ManagerServiceNorms — нормативы расходников по услугам
 * ========================================
 * Этап 1 INVENTORY_COST_PLAN (FE-pre).
 *
 * Концепция:
 *   Каждая услуга имеет список (item × quantity) — это нормативный расход
 *   расходников на одно оказание услуги. Используется для авто-списания
 *   при закрытии визита и для расчёта себестоимости.
 *
 * UI:
 *   • Слева — таблица услуг с поиском.
 *   • Клик по услуге — справа панель с её нормативом:
 *       - Список item × qty
 *       - + Добавить позицию
 *       - Удалить / поменять qty
 *       - «Скопировать с другой услуги» → выбор услуги из списка
 *       - «Сохранить» — отправляет весь список одним PUT.
 *
 * API (planned, реализуется параллельно бэкенд-агентом Stage 2+3):
 *   GET  /manager/services/                        — список услуг
 *   GET  /services/{id}/consumables                — нормативы услуги
 *   PUT  /services/{id}/consumables  body=[{item_id, quantity},...]
 *   POST /inventory/norms/copy       body={from_service_id, to_service_id}
 *   GET  /inventory/items                          — справочник
 *
 * Если бэкенд ещё не отдаёт endpoint /consumables — страница не падает,
 * показывает пустой список и работает с ним до сохранения (PUT может вернуть 404 —
 * это нормально и обрабатывается toast'ом).
 * ========================================
 */
import { useEffect, useState, useCallback, useMemo } from 'react'
import api from '../api'
import ManagerShell from './_ManagerShell'
import { Card, Button, EmptyState, Modal, useToast } from '../design'

const INPUT_STYLE = {
  width: '100%', padding: '9px 12px',
  border: '1px solid var(--border)', borderRadius: 10,
  background: 'var(--surface)', color: 'var(--fg)', fontSize: 13.5,
}

function fmtMoney(v) {
  if (v == null || v === '') return '—'
  try { return Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽' }
  catch { return String(v) + ' ₽' }
}

export default function ManagerServiceNorms() {
  const { toast } = useToast()
  const [services, setServices] = useState([])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [norms, setNorms] = useState([])          // [{ item_id, quantity }]
  const [normsLoading, setNormsLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [copyOpen, setCopyOpen] = useState(false)
  const [copyFromId, setCopyFromId] = useState('')

  const itemMap = useMemo(() => {
    const m = {}; for (const it of items) m[it.id] = it; return m
  }, [items])

  const filteredServices = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return services
    return services.filter(s => (s.name && s.name.toLowerCase().includes(q)))
  }, [services, search])

  const selected = useMemo(
    () => services.find(s => s.id === selectedId) || null,
    [services, selectedId]
  )

  // ─── Загрузка справочников ───
  useEffect(() => {
    (async () => {
      setLoading(true)
      try {
        const [r1, r2] = await Promise.all([
          api.get('/manager/services/'),
          api.get('/inventory/items', { params: { limit: 1000 } }),
        ])
        setServices(Array.isArray(r1.data) ? r1.data : (r1.data?.items || []))
        const list = Array.isArray(r2.data) ? r2.data : (r2.data?.items || [])
        setItems(list)
      } catch (e) {
        toast(e?.response?.data?.detail || 'Не удалось загрузить справочники', 'error')
      } finally {
        setLoading(false)
      }
    })()
  }, [toast])

  // ─── Загрузка нормативов при выборе услуги ───
  const loadNorms = useCallback(async (sid) => {
    if (!sid) { setNorms([]); return }
    setNormsLoading(true)
    try {
      const r = await api.get(`/services/${sid}/consumables`)
      const list = Array.isArray(r.data) ? r.data : (r.data?.items || [])
      // Нормализуем: { item_id, quantity }
      const norm = list.map(n => ({
        item_id: n.item_id || n.id,
        quantity: Number(n.quantity ?? n.qty ?? 0),
      })).filter(n => n.item_id)
      setNorms(norm)
    } catch (e) {
      // 404 — нормально (нормативов ещё нет), показываем пустой список без toast'a
      if (e?.response?.status !== 404) {
        toast(e?.response?.data?.detail || 'Не удалось загрузить норматив', 'error')
      }
      setNorms([])
    } finally {
      setNormsLoading(false)
    }
  }, [toast])

  useEffect(() => { loadNorms(selectedId) }, [selectedId, loadNorms])

  // ─── Действия над нормативами ───
  const addRow = () => {
    setNorms([...norms, { item_id: '', quantity: 1 }])
  }
  const removeRow = (idx) => {
    setNorms(norms.filter((_, i) => i !== idx))
  }
  const setRow = (idx, patch) => {
    setNorms(norms.map((n, i) => i === idx ? { ...n, ...patch } : n))
  }

  const save = async () => {
    if (!selectedId) return
    // Валидация: только записи с item_id и quantity > 0
    const valid = norms.filter(n => n.item_id && Number(n.quantity) > 0)
    if (valid.length !== norms.length) {
      toast('Уберите пустые строки или укажите количество > 0', 'error')
      return
    }
    setSaving(true)
    try {
      await api.put(`/services/${selectedId}/consumables`,
        valid.map(n => ({ item_id: n.item_id, quantity: Number(n.quantity) }))
      )
      toast('Норматив сохранён', 'success')
    } catch (e) {
      toast(e?.response?.data?.detail || 'Не удалось сохранить', 'error')
    } finally {
      setSaving(false)
    }
  }

  const copyFrom = async () => {
    if (!copyFromId || !selectedId) return
    try {
      await api.post('/inventory/norms/copy', {
        from_service_id: copyFromId,
        to_service_id: selectedId,
      })
      toast('Норматив скопирован', 'success')
      setCopyOpen(false)
      setCopyFromId('')
      loadNorms(selectedId)
    } catch (e) {
      // Fallback: если copy-endpoint не реализован — копируем на клиенте
      if (e?.response?.status === 404) {
        try {
          const r = await api.get(`/services/${copyFromId}/consumables`)
          const list = Array.isArray(r.data) ? r.data : (r.data?.items || [])
          const norm = list.map(n => ({
            item_id: n.item_id || n.id,
            quantity: Number(n.quantity ?? n.qty ?? 0),
          })).filter(n => n.item_id && n.quantity > 0)
          setNorms(norm)
          toast('Норматив скопирован (нажмите «Сохранить»)', 'success')
          setCopyOpen(false)
          setCopyFromId('')
        } catch {
          toast('Не удалось получить норматив-источник', 'error')
        }
      } else {
        toast(e?.response?.data?.detail || 'Не удалось скопировать', 'error')
      }
    }
  }

  // Подсчёт расчётной себестоимости норматива (если у items есть price/cost_price)
  const totalCost = useMemo(() => {
    let s = 0
    for (const n of norms) {
      const it = itemMap[n.item_id]
      const price = Number(it?.cost_price ?? it?.price ?? 0)
      s += price * Number(n.quantity || 0)
    }
    return s
  }, [norms, itemMap])

  return (
    <ManagerShell
      active="service-norms"
      title="Нормативы услуг"
      subtitle="Расход материалов на одно оказание услуги"
      icon="tune"
    >
      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-3">
        {/* ─── Слева: список услуг ─── */}
        <Card>
          <div className="p-3">
            <div style={{ position: 'relative' }}>
              <span
                className="material-symbols-outlined"
                style={{ position: 'absolute', left: 10, top: 9, fontSize: 18, color: 'var(--fg-3)' }}
              >search</span>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск услуги"
                style={{ ...INPUT_STYLE, padding: '9px 12px 9px 34px' }}
              />
            </div>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-7 h-7 rounded-full animate-spin" style={{ border: '3px solid var(--accent-soft)', borderTopColor: 'var(--accent)' }} />
            </div>
          ) : filteredServices.length === 0 ? (
            <EmptyState
              icon={<span className="material-symbols-outlined" style={{ fontSize: 28 }}>medical_services</span>}
              title="Услуг не найдено"
              message="Уточните поиск или добавьте услуги в разделе настроек."
            />
          ) : (
            <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              {filteredServices.map(s => {
                const isActive = s.id === selectedId
                return (
                  <button
                    key={s.id}
                    onClick={() => setSelectedId(s.id)}
                    className="w-full text-left transition-colors"
                    style={{
                      display: 'block',
                      padding: '10px 14px',
                      borderTop: '1px solid var(--border)',
                      background: isActive ? 'var(--accent-soft)' : 'transparent',
                      color: isActive ? 'var(--accent)' : 'var(--fg)',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontWeight: isActive ? 600 : 500, fontSize: 13.5 }}>{s.name}</div>
                    {s.price != null && (
                      <div style={{ fontSize: 11.5, color: isActive ? 'var(--accent)' : 'var(--fg-3)', marginTop: 2 }}>
                        {fmtMoney(s.price)}{s.category ? ' · ' + s.category : ''}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </Card>

        {/* ─── Справа: редактор норматива ─── */}
        <Card>
          {!selected ? (
            <EmptyState
              icon={<span className="material-symbols-outlined" style={{ fontSize: 28 }}>arrow_back</span>}
              title="Выберите услугу"
              message="Слева в списке выберите услугу, чтобы задать норматив расходников."
            />
          ) : (
            <div className="p-4">
              {/* Шапка услуги */}
              <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                <div>
                  <div style={{ fontSize: 11, color: 'var(--fg-3)', fontWeight: 600, textTransform: 'uppercase' }}>Услуга</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg)' }}>{selected.name}</div>
                  {selected.price != null && (
                    <div style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>Цена: {fmtMoney(selected.price)}</div>
                  )}
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button variant="ghost" size="sm" onClick={() => setCopyOpen(true)}>
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>content_copy</span>
                    Скопировать с другой
                  </Button>
                  <Button variant="primary" onClick={save} disabled={saving || normsLoading}>
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>save</span>
                    {saving ? 'Сохранение...' : 'Сохранить'}
                  </Button>
                </div>
              </div>

              {normsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-7 h-7 rounded-full animate-spin" style={{ border: '3px solid var(--accent-soft)', borderTopColor: 'var(--accent)' }} />
                </div>
              ) : (
                <>
                  {/* Список нормативов */}
                  {norms.length === 0 ? (
                    <div style={{
                      padding: '24px 16px', textAlign: 'center', borderRadius: 10,
                      background: 'var(--bg-1)', border: '1px dashed var(--border)',
                      color: 'var(--fg-3)', fontSize: 13,
                    }}>
                      Норматив пуст. Добавьте позиции, которые расходуются на одно оказание.
                    </div>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                          <tr style={{ background: 'var(--bg-1)' }}>
                            <Th>Номенклатура</Th>
                            <Th style={{ width: 120, textAlign: 'right' }}>Кол-во</Th>
                            <Th style={{ width: 120, textAlign: 'right' }}>Стоимость</Th>
                            <Th style={{ width: 50 }} />
                          </tr>
                        </thead>
                        <tbody>
                          {norms.map((n, idx) => {
                            const it = itemMap[n.item_id]
                            const price = Number(it?.cost_price ?? it?.price ?? 0)
                            const rowSum = price * Number(n.quantity || 0)
                            return (
                              <tr key={idx} style={{ borderTop: '1px solid var(--border)' }}>
                                <Td>
                                  <select
                                    value={n.item_id}
                                    onChange={(e) => setRow(idx, { item_id: e.target.value })}
                                    style={INPUT_STYLE}
                                  >
                                    <option value="">— выберите —</option>
                                    {items.map(opt => (
                                      <option key={opt.id} value={opt.id}>
                                        {opt.name}{opt.unit ? ` · ${opt.unit}` : ''}
                                      </option>
                                    ))}
                                  </select>
                                </Td>
                                <Td style={{ textAlign: 'right' }}>
                                  <input
                                    type="number" min="0" step="any" value={n.quantity}
                                    onChange={(e) => setRow(idx, { quantity: e.target.value })}
                                    style={{ ...INPUT_STYLE, textAlign: 'right' }}
                                  />
                                </Td>
                                <Td style={{ textAlign: 'right', color: 'var(--fg-3)' }}>{fmtMoney(rowSum)}</Td>
                                <Td>
                                  <button
                                    onClick={() => removeRow(idx)}
                                    className="inline-flex items-center justify-center transition-transform active:scale-95"
                                    style={{
                                      width: 32, height: 32, borderRadius: 8,
                                      background: 'transparent', border: '1px solid var(--border)',
                                      color: 'var(--bad, #d4424b)',
                                    }}
                                    aria-label="Удалить"
                                  >
                                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span>
                                  </button>
                                </Td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div className="flex items-center justify-between mt-3 flex-wrap gap-2">
                    <Button variant="secondary" size="sm" onClick={addRow}>
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add</span>
                      Добавить позицию
                    </Button>
                    <div style={{ fontSize: 13, color: 'var(--fg-2)' }}>
                      Расчётная себестоимость:{' '}
                      <b style={{ color: 'var(--fg)' }}>{fmtMoney(totalCost)}</b>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* ─── Модалка копирования с другой услуги ─── */}
      <Modal
        open={copyOpen}
        onClose={() => setCopyOpen(false)}
        title="Скопировать норматив"
        size="sm"
        actions={
          <>
            <Button variant="ghost" onClick={() => setCopyOpen(false)}>Отмена</Button>
            <Button variant="primary" onClick={copyFrom} disabled={!copyFromId}>
              Скопировать
            </Button>
          </>
        }
      >
        <div style={{ fontSize: 13, color: 'var(--fg-2)', marginBottom: 10 }}>
          Из какой услуги скопировать норматив в <b>«{selected?.name}»</b>?
        </div>
        <select
          value={copyFromId}
          onChange={(e) => setCopyFromId(e.target.value)}
          style={INPUT_STYLE}
        >
          <option value="">— выберите услугу —</option>
          {services.filter(s => s.id !== selectedId).map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 10 }}>
          Текущий норматив целевой услуги будет заменён полностью.
        </div>
      </Modal>
    </ManagerShell>
  )
}

function Th({ children, style }) {
  return (
    <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--fg-3)', fontWeight: 600, fontSize: 12, ...style }}>
      {children}
    </th>
  )
}
function Td({ children, style }) {
  return (
    <td style={{ padding: '8px 10px', color: 'var(--fg)', verticalAlign: 'middle', fontSize: 13, ...style }}>
      {children}
    </td>
  )
}
