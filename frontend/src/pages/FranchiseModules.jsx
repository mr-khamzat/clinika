/**
 * FranchiseModules — распределение модулей внутри франшизы (Опция B).
 *
 * Матрица: подтенанты × модули из каталога.
 * Каждая ячейка: чекбокс (вкл/выкл) + внутренняя цена франшизы для этой клиники.
 * Изменения сохраняются массовым PUT /franchise-owner/modules/grants.
 *
 * Внизу — раздел «Внутренние акты»: генерация и отметка оплаты.
 */
import { useEffect, useMemo, useState } from 'react'
import api from '../api'

export default function FranchiseModules() {
  const [matrix, setMatrix] = useState(null)
  const [catalog, setCatalog] = useState(null)
  const [acts, setActs] = useState([])
  const [saving, setSaving] = useState(false)
  const [period, setPeriod] = useState(() => {
    const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })

  useEffect(() => {
    document.title = 'Модули по клиникам — КлиникСеть'
    Promise.all([
      api.get('/franchise-owner/modules/grants'),
      api.get('/franchise-owner/modules/catalog'),
      api.get('/franchise-owner/modules/acts'),
    ]).then(([g, c, a]) => {
      setMatrix(g.data)
      setCatalog(c.data)
      setActs(a.data.acts || [])
    }).catch(e => console.error(e))
  }, [])

  const grantsByKey = useMemo(() => {
    if (!matrix) return {}
    const m = {}
    matrix.grants.forEach(g => { m[`${g.tenant_id}|${g.module_key}`] = g })
    return m
  }, [matrix])

  // Итого по тенанту (колонке): сумма всех включённых модулей × их internal_price_rub.
  // Реактивно пересчитывается на любом тогле или изменении цены.
  const totalByTenant = useMemo(() => {
    const out = {}
    if (!matrix) return out
    matrix.tenants.forEach(t => {
      let sum = 0
      matrix.modules.forEach(m => {
        const g = grantsByKey[`${t.id}|${m.key}`]
        if (g?.is_active) sum += Number(g.internal_price_rub) || 0
      })
      out[t.id] = sum
    })
    return out
  }, [matrix, grantsByKey])

  // Итого по строке (модулю) — сумма по всем включённым тенантам.
  const totalByModule = useMemo(() => {
    const out = {}
    if (!matrix) return out
    matrix.modules.forEach(m => {
      let sum = 0
      matrix.tenants.forEach(t => {
        const g = grantsByKey[`${t.id}|${m.key}`]
        if (g?.is_active) sum += Number(g.internal_price_rub) || 0
      })
      out[m.key] = sum
    })
    return out
  }, [matrix, grantsByKey])

  // Общая сумма по сети.
  const totalNetwork = useMemo(() => {
    return Object.values(totalByTenant).reduce((acc, v) => acc + v, 0)
  }, [totalByTenant])

  const fmtRub = (v) => `${Math.round(v).toLocaleString('ru-RU')} ₽`

  function toggleGrant(tenant_id, module_key, is_active) {
    const k = `${tenant_id}|${module_key}`
    setMatrix(prev => ({
      ...prev,
      grants: prev.grants.map(g => g.tenant_id === tenant_id && g.module_key === module_key
        ? { ...g, is_active }
        : g)
    }))
  }

  function setPrice(tenant_id, module_key, value) {
    const num = Math.max(0, Number(value) || 0)
    setMatrix(prev => ({
      ...prev,
      grants: prev.grants.map(g => g.tenant_id === tenant_id && g.module_key === module_key
        ? { ...g, internal_price_rub: num }
        : g)
    }))
  }

  async function saveAll() {
    setSaving(true)
    try {
      const { data } = await api.put('/franchise-owner/modules/grants', {
        grants: matrix.grants.map(g => ({
          tenant_id: g.tenant_id,
          module_key: g.module_key,
          is_active: g.is_active,
          internal_price_rub: g.internal_price_rub,
        }))
      })
      alert(`Сохранено. Обновлено: ${data.updated}, активировано: ${data.activated}, отключено: ${data.deactivated}`)
    } catch (e) {
      alert('Ошибка: ' + (e?.response?.data?.detail || e.message))
    } finally {
      setSaving(false)
    }
  }

  async function generateActs() {
    try {
      const { data } = await api.post('/franchise-owner/modules/generate-acts', { period })
      alert(`Создано: ${data.created}, обновлено: ${data.updated} за ${period}`)
      const a = await api.get('/franchise-owner/modules/acts')
      setActs(a.data.acts || [])
    } catch (e) {
      alert('Ошибка: ' + (e?.response?.data?.detail || e.message))
    }
  }

  async function markPaid(actId) {
    if (!confirm('Отметить акт оплаченным?')) return
    try {
      await api.post(`/franchise-owner/modules/acts/${actId}/mark-paid`)
      const a = await api.get('/franchise-owner/modules/acts')
      setActs(a.data.acts || [])
    } catch (e) {
      alert('Ошибка: ' + (e?.response?.data?.detail || e.message))
    }
  }

  if (!matrix || !catalog) return <div className="fm-loading">Загрузка…</div>

  return (
    <div className="fm-root">
      <style>{FM_CSS}</style>
      <header className="fm-head">
        <div>
          <h1>Модули по клиникам</h1>
          <p>Распределение коммерческих модулей по подтенантам франшизы и внутренние цены</p>
        </div>
        <button className="fm-btn-primary" onClick={saveAll} disabled={saving}>
          {saving ? 'Сохранение…' : 'Сохранить изменения'}
        </button>
      </header>

      <section className="fm-section">
        <h2>Подключённые франшизой модули</h2>
        <div className="fm-catalog-chips">
          {catalog.modules.filter(m => m.subscribed_by_franchise).map(m => (
            <div key={m.key} className="fm-chip is-on">
              <span className="fm-chip-name">{m.name}</span>
              <span className="fm-chip-price">{m.price_monthly ? `${m.price_monthly.toLocaleString('ru-RU')} ₽/мес` : '—'}</span>
            </div>
          ))}
          {catalog.modules.filter(m => !m.subscribed_by_franchise).map(m => (
            <div key={m.key} className="fm-chip is-off">
              <span className="fm-chip-name">{m.name}</span>
              <span className="fm-chip-status">не подключён</span>
            </div>
          ))}
        </div>
      </section>

      <section className="fm-section">
        <h2>Матрица распределения</h2>

        {/* Desktop / tablet — таблица (md и выше) */}
        <div className="hidden md:block">
          <div className="fm-table-wrap">
            <table className="fm-table">
              <thead>
                <tr>
                  <th className="fm-col-mod">Модуль</th>
                  {matrix.tenants.map(t => (
                    <th key={t.id} className="fm-col-tenant">
                      <div className="fm-tenant-name">{t.clinic_name || t.name}</div>
                      <div className="fm-tenant-slug">/{t.slug}</div>
                    </th>
                  ))}
                  <th className="fm-col-total">Итого ₽/мес</th>
                </tr>
              </thead>
              <tbody>
                {matrix.modules.map(m => {
                  const subscribedByFranchise = catalog.modules.find(c => c.key === m.key)?.subscribed_by_franchise
                  return (
                    <tr key={m.key} className={subscribedByFranchise ? '' : 'is-disabled-row'}>
                      <td className="fm-col-mod">
                        <div className="fm-mod-name">{m.name}</div>
                        <div className="fm-mod-meta">
                          Платформа: {m.price_monthly_platform ? `${m.price_monthly_platform.toLocaleString('ru-RU')} ₽/мес` : '—'}
                          {!subscribedByFranchise && <span className="fm-tag-warn">франшиза не подключила</span>}
                        </div>
                      </td>
                      {matrix.tenants.map(t => {
                        const g = grantsByKey[`${t.id}|${m.key}`]
                        return (
                          <td key={t.id} className="fm-cell">
                            <label className="fm-checkbox">
                              <input type="checkbox" checked={!!g?.is_active}
                                disabled={!subscribedByFranchise}
                                onChange={e => toggleGrant(t.id, m.key, e.target.checked)} />
                              <span>вкл.</span>
                            </label>
                            <input type="number" min="0" step="100"
                              placeholder="0 ₽/мес"
                              value={g?.internal_price_rub || 0}
                              disabled={!g?.is_active || !subscribedByFranchise}
                              onChange={e => setPrice(t.id, m.key, e.target.value)}
                              className="fm-price" />
                          </td>
                        )
                      })}
                      <td className="fm-col-total fm-total-cell">
                        <b>{fmtRub(totalByModule[m.key] || 0)}</b>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="fm-foot-row">
                  <td className="fm-col-mod"><b>Итого по клинике</b></td>
                  {matrix.tenants.map(t => (
                    <td key={t.id} className="fm-cell fm-total-cell">
                      <b>{fmtRub(totalByTenant[t.id] || 0)}</b>
                    </td>
                  ))}
                  <td className="fm-col-total fm-total-cell fm-total-grand">
                    <b>{fmtRub(totalNetwork)}</b>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Mobile — карточки по клиникам (до md) */}
        <div className="block md:hidden">
          <div className="fm-cards">
            {matrix.tenants.map(t => (
              <div key={t.id} className="fm-card">
                <div className="fm-card-head">
                  <div>
                    <div className="fm-card-title">{t.clinic_name || t.name}</div>
                    <div className="fm-card-slug">/{t.slug}</div>
                  </div>
                  <div className="fm-card-sum">
                    <div className="fm-card-sum-label">Итого / мес</div>
                    <div className="fm-card-sum-val">{fmtRub(totalByTenant[t.id] || 0)}</div>
                  </div>
                </div>
                <div className="fm-card-modules">
                  {matrix.modules.map(m => {
                    const subscribedByFranchise = catalog.modules.find(c => c.key === m.key)?.subscribed_by_franchise
                    const g = grantsByKey[`${t.id}|${m.key}`]
                    return (
                      <div key={m.key} className={'fm-card-mod ' + (subscribedByFranchise ? '' : 'is-disabled-row')}>
                        <label className="fm-card-mod-line">
                          <input type="checkbox" checked={!!g?.is_active}
                            disabled={!subscribedByFranchise}
                            onChange={e => toggleGrant(t.id, m.key, e.target.checked)} />
                          <span className="fm-card-mod-name">{m.name}</span>
                        </label>
                        <input type="number" min="0" step="100"
                          placeholder="0 ₽/мес"
                          value={g?.internal_price_rub || 0}
                          disabled={!g?.is_active || !subscribedByFranchise}
                          onChange={e => setPrice(t.id, m.key, e.target.value)}
                          className="fm-price" />
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
            <div className="fm-card fm-card-grand">
              <div className="fm-card-sum-label">Итого по сети</div>
              <div className="fm-card-sum-val fm-card-sum-grand">{fmtRub(totalNetwork)}</div>
            </div>
          </div>
        </div>
      </section>

      <section className="fm-section">
        <h2>Внутренние акты</h2>
        <div className="fm-acts-controls">
          <label>Период:</label>
          <input type="month" value={period} onChange={e => setPeriod(e.target.value)} className="fm-period" />
          <button className="fm-btn-primary" onClick={generateActs}>
            Сгенерировать акты
          </button>
        </div>
        <div className="fm-acts-table-wrap">
          <table className="fm-acts-table">
            <thead>
              <tr>
                <th>Период</th>
                <th>Клиника</th>
                <th>Детализация</th>
                <th>Сумма</th>
                <th>Статус</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {acts.length === 0 ? (
                <tr><td colSpan={6} className="fm-empty">Актов нет. Сгенерируйте за нужный период.</td></tr>
              ) : acts.map(a => (
                <tr key={a.id}>
                  <td>{a.period}</td>
                  <td>{a.tenant_name} <span className="fm-mute">/{a.tenant_slug}</span></td>
                  <td>{Object.entries(a.breakdown).map(([k, v]) => <div key={k} className="fm-bd">{k}: {v.toLocaleString('ru-RU')} ₽</div>)}</td>
                  <td><b>{a.total_rub.toLocaleString('ru-RU')} ₽</b></td>
                  <td>
                    <span className={'fm-status fm-status-' + a.status}>
                      {a.status === 'paid' ? 'Оплачен' : a.status === 'cancelled' ? 'Отменён' : 'Ожидает оплаты'}
                    </span>
                  </td>
                  <td>
                    {a.status === 'pending' && (
                      <button className="fm-btn-ghost" onClick={() => markPaid(a.id)}>Отметить оплаченным</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

const FM_CSS = `
.fm-root {
  background: oklch(0.99 0.005 250); min-height: 100vh; padding: 24px;
  font-family: "Golos Text", system-ui, sans-serif;
  color: oklch(0.2 0.02 250);
}
.fm-loading { padding: 60px; text-align: center; color: #888; }
.fm-head { display: flex; justify-content: space-between; align-items: center; max-width: 1400px; margin: 0 auto 24px; flex-wrap: wrap; gap: 16px; }
.fm-head h1 { font-size: 24px; margin: 0 0 4px; font-weight: 700; letter-spacing: -0.02em; }
.fm-head p { margin: 0; font-size: 14px; color: oklch(0.5 0.02 250); }
.fm-section { max-width: 1400px; margin: 0 auto 24px; background: #fff; border-radius: 16px; padding: 24px; box-shadow: 0 2px 8px -2px rgba(0,0,0,0.04); }
.fm-section h2 { font-size: 16px; font-weight: 600; margin: 0 0 16px; }
.fm-btn-primary { padding: 10px 18px; background: oklch(0.55 0.18 230); color: #fff; border: none; border-radius: 10px; cursor: pointer; font: inherit; font-size: 14px; font-weight: 600; }
.fm-btn-primary:disabled { opacity: 0.5; }
.fm-btn-primary:hover:not(:disabled) { background: oklch(0.5 0.18 230); }
.fm-btn-ghost { padding: 6px 12px; background: transparent; color: oklch(0.55 0.18 230); border: 1px solid oklch(0.85 0.05 230); border-radius: 8px; cursor: pointer; font: inherit; font-size: 12px; font-weight: 600; }
.fm-btn-ghost:hover { background: oklch(0.95 0.04 230); }

.fm-catalog-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.fm-chip { padding: 8px 14px; border-radius: 999px; font-size: 13px; display: flex; gap: 10px; align-items: center; }
.fm-chip.is-on { background: oklch(0.95 0.04 145); color: oklch(0.4 0.18 145); }
.fm-chip.is-off { background: oklch(0.95 0.005 250); color: oklch(0.55 0.02 250); }
.fm-chip-name { font-weight: 600; }
.fm-chip-price { font-size: 11px; opacity: 0.8; }
.fm-chip-status { font-size: 11px; opacity: 0.7; }

.fm-table-wrap { overflow-x: auto; margin: 0 -24px; padding: 0 24px; }
.fm-table { border-collapse: collapse; width: 100%; }
.fm-table th, .fm-table td { padding: 12px; border-bottom: 1px solid oklch(0.92 0.005 250); text-align: left; vertical-align: top; }
.fm-table th { background: oklch(0.97 0.005 250); font-size: 12px; font-weight: 600; color: oklch(0.45 0.02 250); }
.fm-col-mod { min-width: 220px; max-width: 280px; }
.fm-mod-name { font-weight: 600; font-size: 14px; }
.fm-mod-meta { font-size: 11.5px; color: oklch(0.55 0.02 250); margin-top: 2px; }
.fm-tag-warn { display: inline-block; margin-left: 6px; padding: 1px 6px; background: oklch(0.95 0.05 60); color: oklch(0.45 0.18 60); border-radius: 4px; font-size: 10px; font-weight: 700; }
.fm-col-tenant { min-width: 160px; }
.fm-tenant-name { font-weight: 600; font-size: 13px; }
.fm-tenant-slug { font-size: 11px; color: oklch(0.55 0.02 250); margin-top: 1px; }
.fm-cell { padding: 8px; }
.fm-checkbox { display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer; user-select: none; }
.fm-checkbox input { cursor: pointer; }
.fm-price { width: 100%; padding: 5px 8px; border: 1px solid oklch(0.92 0.005 250); border-radius: 6px; font: inherit; font-size: 12px; margin-top: 4px; }
.fm-price:disabled { background: oklch(0.97 0.005 250); color: oklch(0.6 0.005 250); }
.is-disabled-row { opacity: 0.5; }

.fm-acts-controls { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; }
.fm-period { padding: 8px 12px; border: 1px solid oklch(0.92 0.005 250); border-radius: 8px; font: inherit; font-size: 13px; }
.fm-acts-table-wrap { overflow-x: auto; }
.fm-acts-table { width: 100%; border-collapse: collapse; }
.fm-acts-table th, .fm-acts-table td { padding: 10px 12px; border-bottom: 1px solid oklch(0.92 0.005 250); text-align: left; font-size: 13px; }
.fm-acts-table th { background: oklch(0.97 0.005 250); font-size: 12px; font-weight: 600; color: oklch(0.45 0.02 250); }
.fm-empty { text-align: center; padding: 24px; color: oklch(0.55 0.02 250); }
.fm-status { padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
.fm-status-pending { background: oklch(0.95 0.06 60); color: oklch(0.45 0.18 60); }
.fm-status-paid { background: oklch(0.94 0.05 145); color: oklch(0.4 0.18 145); }
.fm-status-cancelled { background: oklch(0.95 0.005 250); color: oklch(0.55 0.02 250); }
.fm-mute { color: oklch(0.55 0.02 250); font-size: 11px; }
.fm-bd { font-size: 11px; color: oklch(0.45 0.02 250); }

/* Колонки итогов (десктоп) */
.fm-col-total { min-width: 130px; text-align: right; }
.fm-total-cell { text-align: right; font-variant-numeric: tabular-nums; }
.fm-foot-row td { background: oklch(0.97 0.005 250); border-top: 2px solid oklch(0.88 0.005 250); }
.fm-total-grand { color: oklch(0.4 0.18 230); font-size: 14px; }

/* Карточки (мобайл) */
.fm-cards { display: flex; flex-direction: column; gap: 12px; }
.fm-card { background: #fff; border: 1px solid oklch(0.92 0.005 250); border-radius: 14px; padding: 14px; }
.fm-card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; border-bottom: 1px solid oklch(0.94 0.005 250); padding-bottom: 10px; margin-bottom: 10px; }
.fm-card-title { font-weight: 600; font-size: 14px; }
.fm-card-slug { font-size: 11px; color: oklch(0.55 0.02 250); margin-top: 2px; }
.fm-card-sum { text-align: right; }
.fm-card-sum-label { font-size: 11px; color: oklch(0.55 0.02 250); }
.fm-card-sum-val { font-weight: 700; font-size: 15px; color: oklch(0.4 0.18 230); font-variant-numeric: tabular-nums; }
.fm-card-modules { display: flex; flex-direction: column; gap: 10px; }
.fm-card-mod { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.fm-card-mod-line { display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; flex: 1 1 auto; min-width: 0; }
.fm-card-mod-line input[type="checkbox"] { flex: 0 0 auto; }
.fm-card-mod-name { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fm-card-mod .fm-price { width: 110px; flex: 0 0 auto; margin-top: 0; }
.fm-card-grand { background: oklch(0.97 0.04 230); border-color: oklch(0.85 0.06 230); display: flex; justify-content: space-between; align-items: center; }
.fm-card-sum-grand { font-size: 18px; }

@media (max-width: 640px) {
  .fm-root { padding: 14px; }
  .fm-section { padding: 16px; border-radius: 12px; }
  .fm-head h1 { font-size: 20px; }
}
`
