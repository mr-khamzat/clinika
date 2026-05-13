/**
 * FranchiseRevenue — доходы франшизы с бонусов клиник.
 *
 * Каждая клиника франшизы платит fee_per_bonus_from_clinic за каждый выплаченный
 * бонус. По умолчанию 100 ₽. Тут видно: общая сумма, разбивка по клиникам, настройка ставки.
 */
import { useEffect, useState } from 'react'
import api from '../api'

export default function FranchiseRevenue() {
  const [settings, setSettings] = useState(null)
  const [dashboard, setDashboard] = useState(null)
  const [byClinic, setByClinic] = useState(null)
  const [period, setPeriod] = useState(() => {
    const now = new Date()
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10),
      end: now.toISOString().slice(0, 10),
    }
  })
  const [savingFee, setSavingFee] = useState(false)

  useEffect(() => {
    document.title = 'Доходы франшизы — КлиникСеть'
    loadAll()
  }, [])

  async function loadAll() {
    try {
      const [s, d, c] = await Promise.all([
        api.get('/franchise-owner/revenue/settings'),
        api.get('/franchise-owner/revenue/dashboard'),
        api.get(`/franchise-owner/revenue/by-clinic?period_start=${period.start}&period_end=${period.end}`),
      ])
      setSettings(s.data); setDashboard(d.data); setByClinic(c.data)
    } catch (e) { console.error(e) }
  }

  async function changePeriod(newPeriod) {
    setPeriod(newPeriod)
    try {
      const c = await api.get(`/franchise-owner/revenue/by-clinic?period_start=${newPeriod.start}&period_end=${newPeriod.end}`)
      setByClinic(c.data)
    } catch (e) { console.error(e) }
  }

  async function saveFee(newFee) {
    setSavingFee(true)
    try {
      const { data } = await api.put('/franchise-owner/revenue/settings', { fee_per_bonus_from_clinic: newFee })
      setSettings(s => ({ ...s, fee_per_bonus_from_clinic: data.fee_per_bonus_from_clinic }))
      await loadAll()
    } catch (e) {
      alert('Ошибка: ' + (e?.response?.data?.detail || e.message))
    } finally {
      setSavingFee(false)
    }
  }

  if (!settings || !dashboard || !byClinic) return <div className="fr-loading">Загрузка…</div>

  return (
    <div className="fr-root">
      <style>{FR_CSS}</style>
      <header className="fr-head">
        <div>
          <h1>Доходы франшизы с бонусов</h1>
          <p>«{settings.franchise_name}» — комиссия с каждого выплаченного бонуса в клиниках сети</p>
        </div>
      </header>

      {/* Settings card */}
      <section className="fr-card">
        <h2>Ставка комиссии</h2>
        <div className="fr-fee-row">
          <div>
            <div className="fr-label">С каждого бонуса любой клиники франшиза получает:</div>
            <div className="fr-fee-display">
              <input type="number" min="0" step="10" defaultValue={settings.fee_per_bonus_from_clinic}
                onBlur={(e) => {
                  const v = Number(e.target.value) || 0
                  if (v !== settings.fee_per_bonus_from_clinic) saveFee(v)
                }}
                className="fr-fee-input" disabled={savingFee} />
              <span className="fr-rub">₽ за бонус</span>
            </div>
          </div>
          <div className="fr-platform-fee">
            <div className="fr-label">Платформа берёт с франшизы:</div>
            <div className="fr-fee-display">
              <span className="fr-fee-value">{settings.platform_fee_per_bonus} ₽ за бонус</span>
            </div>
          </div>
        </div>
      </section>

      {/* KPI cards */}
      <section className="fr-kpi-grid">
        <div className="fr-kpi">
          <div className="fr-kpi-label">За этот месяц</div>
          <div className="fr-kpi-value">{dashboard.this_month.toLocaleString('ru-RU')} ₽</div>
          <div className="fr-kpi-sub">{dashboard.this_month_bonus_count} выплаченных бонусов</div>
        </div>
        <div className="fr-kpi">
          <div className="fr-kpi-label">За прошлый месяц</div>
          <div className="fr-kpi-value">{dashboard.last_month.toLocaleString('ru-RU')} ₽</div>
          <div className="fr-kpi-sub">{dashboard.last_month_bonus_count} бонусов</div>
        </div>
        <div className="fr-kpi fr-kpi-total">
          <div className="fr-kpi-label">За всё время</div>
          <div className="fr-kpi-value">{dashboard.all_time.toLocaleString('ru-RU')} ₽</div>
          <div className="fr-kpi-sub">{dashboard.all_time_bonus_count} бонусов</div>
        </div>
      </section>

      {/* By-clinic breakdown */}
      <section className="fr-card">
        <div className="fr-period-row">
          <h2>По клиникам</h2>
          <div className="fr-period">
            <label>С:</label>
            <input type="date" value={period.start} onChange={(e) => changePeriod({ ...period, start: e.target.value })} />
            <label>По:</label>
            <input type="date" value={period.end} onChange={(e) => changePeriod({ ...period, end: e.target.value })} />
          </div>
        </div>
        <div className="fr-totals">
          За период {byClinic.period_start} – {byClinic.period_end}:
          <b> {byClinic.total_bonus_count}</b> бонусов · доход франшизы <b>{byClinic.total_revenue_rub.toLocaleString('ru-RU')} ₽</b>
        </div>
        <table className="fr-table">
          <thead>
            <tr>
              <th>Клиника</th>
              <th className="fr-right">Бонусов выплачено</th>
              <th className="fr-right">Сумма бонусов</th>
              <th className="fr-right">Доход франшизы</th>
            </tr>
          </thead>
          <tbody>
            {byClinic.by_clinic.map(c => (
              <tr key={c.tenant_id}>
                <td>
                  <div className="fr-clinic-name">{c.clinic_name}</div>
                  <div className="fr-clinic-slug">/{c.tenant_slug}</div>
                </td>
                <td className="fr-right">{c.bonus_count}</td>
                <td className="fr-right">{c.bonus_total_paid_rub.toLocaleString('ru-RU')} ₽</td>
                <td className="fr-right fr-revenue-cell">{c.franchise_revenue_rub.toLocaleString('ru-RU')} ₽</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td><b>Итого</b></td>
              <td className="fr-right"><b>{byClinic.total_bonus_count}</b></td>
              <td className="fr-right">—</td>
              <td className="fr-right fr-revenue-cell"><b>{byClinic.total_revenue_rub.toLocaleString('ru-RU')} ₽</b></td>
            </tr>
          </tfoot>
        </table>
      </section>
    </div>
  )
}

const FR_CSS = `
.fr-root {
  background: oklch(0.99 0.005 250); min-height: 100vh; padding: 24px;
  font-family: "Golos Text", system-ui, sans-serif;
  color: oklch(0.2 0.02 250);
}
.fr-loading { padding: 60px; text-align: center; }
.fr-head { max-width: 1200px; margin: 0 auto 24px; }
.fr-head h1 { font-size: 24px; margin: 0 0 4px; font-weight: 700; letter-spacing: -0.02em; }
.fr-head p { margin: 0; font-size: 14px; color: oklch(0.5 0.02 250); }
.fr-card {
  max-width: 1200px; margin: 0 auto 20px;
  background: #fff; border-radius: 16px; padding: 24px;
  box-shadow: 0 2px 8px -2px rgba(0,0,0,0.04);
}
.fr-card h2 { font-size: 16px; font-weight: 600; margin: 0 0 16px; }

.fr-fee-row { display: flex; gap: 32px; flex-wrap: wrap; }
.fr-fee-row > div { flex: 1; min-width: 240px; }
.fr-label { font-size: 13px; color: oklch(0.5 0.02 250); margin-bottom: 6px; }
.fr-fee-display { display: flex; align-items: center; gap: 10px; }
.fr-fee-input {
  padding: 10px 14px; font-size: 22px; font-weight: 700;
  width: 140px; border: 1px solid oklch(0.85 0.04 230);
  border-radius: 10px; font-family: inherit;
  color: oklch(0.55 0.18 230); background: oklch(0.97 0.04 230);
}
.fr-rub { font-size: 14px; color: oklch(0.5 0.02 250); font-weight: 600; }
.fr-platform-fee .fr-fee-value { font-size: 18px; font-weight: 600; color: oklch(0.5 0.02 250); }

.fr-kpi-grid {
  max-width: 1200px; margin: 0 auto 20px;
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;
}
.fr-kpi {
  background: #fff; border-radius: 16px; padding: 24px;
  box-shadow: 0 2px 8px -2px rgba(0,0,0,0.04);
}
.fr-kpi-total {
  background: linear-gradient(135deg, oklch(0.55 0.18 230), oklch(0.45 0.2 250));
  color: white;
}
.fr-kpi-label { font-size: 12px; font-weight: 600; opacity: 0.8; text-transform: uppercase; letter-spacing: 0.05em; }
.fr-kpi-value { font-size: 32px; font-weight: 700; margin: 8px 0 4px; letter-spacing: -0.02em; }
.fr-kpi-sub { font-size: 12.5px; opacity: 0.7; }

.fr-period-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 12px; }
.fr-period-row h2 { margin: 0; }
.fr-period { display: flex; align-items: center; gap: 8px; font-size: 13px; color: oklch(0.5 0.02 250); }
.fr-period input { padding: 6px 10px; border: 1px solid oklch(0.92 0.005 250); border-radius: 8px; font: inherit; font-size: 13px; }
.fr-totals { background: oklch(0.97 0.005 250); padding: 12px 16px; border-radius: 10px; font-size: 13px; margin-bottom: 16px; color: oklch(0.4 0.02 250); }
.fr-totals b { color: oklch(0.55 0.18 230); }

.fr-table { width: 100%; border-collapse: collapse; }
.fr-table th, .fr-table td { padding: 12px; border-bottom: 1px solid oklch(0.92 0.005 250); text-align: left; font-size: 14px; }
.fr-table th { background: oklch(0.97 0.005 250); font-size: 12px; font-weight: 600; color: oklch(0.45 0.02 250); }
.fr-right { text-align: right; font-variant-numeric: tabular-nums; }
.fr-clinic-name { font-weight: 600; }
.fr-clinic-slug { font-size: 11px; color: oklch(0.55 0.02 250); margin-top: 2px; font-family: monospace; }
.fr-revenue-cell { color: oklch(0.5 0.2 145); font-weight: 600; }

@media (max-width: 760px) {
  .fr-kpi-grid { grid-template-columns: 1fr; }
}
`
