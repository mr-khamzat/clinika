/**
 * ========================================
 * БЛОК: DirectorMarketing — реальные доходы с рекламы
 * ========================================
 * Источники:
 *   GET /director/marketing/sources — donut «откуда пришли пациенты»
 *   GET /director/marketing/roi     — расход / доход / ROI по каналам
 * Виджеты: Расход, Доход, ROI, CPL, CAC.
 * Графики: donut источников + horizontal bar ROI по каналам.
 * Таблица: канал · расход · лиды · пациенты · доход · ROI · CPL · CAC.
 * ========================================
 */
import { useEffect, useState } from 'react'
import api from '../../api'
import { Card, EmptyState, Skeleton } from '../../design'
import { useDirectorPeriod } from '../DirectorLayout'
import { DonutChart, BarChart, fmtRUB, fmtInt, fmtPct } from './_DirectorCharts'

export default function DirectorMarketing() {
  const { from, to } = useDirectorPeriod()
  const [sources, setSources] = useState(null)
  const [roi, setRoi] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true); setError('')

    Promise.all([
      api.get('/director/marketing/sources', { params: { from, to } }).catch(e => ({ data: null, _err: e })),
      api.get('/director/marketing/roi',     { params: { from, to } }).catch(e => ({ data: null, _err: e })),
    ])
      .then(([s, r]) => {
        if (!alive) return
        if (s._err && r._err) {
          setError('Бэкенд маркетинга недоступен')
          return
        }
        setSources(s.data || { sources: [], total: 0, total_revenue: 0 })
        setRoi(r.data || { channels: [], totals: {} })
      })
      .finally(() => { if (alive) setLoading(false) })

    return () => { alive = false }
  }, [from, to])

  if (loading) {
    return (
      <div className="flex flex-col gap-3 sm:gap-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[1,2,3,4].map(i => <Card key={i} padded><Skeleton height={50} /></Card>)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Card padded><Skeleton height={220} /></Card>
          <Card padded><Skeleton height={220} /></Card>
        </div>
        <Card padded><Skeleton height={180} /></Card>
      </div>
    )
  }

  if (error && !sources && !roi) {
    return <EmptyState icon="cloud_off" title="Бэкенд маркетинга пока не готов" />
  }

  // Источники для donut
  const sourcesList = sources?.sources || []
  const totalPatients = sources?.total || 0
  const totalRevenue = sources?.total_revenue || 0

  // ROI по каналам
  const channels = roi?.channels || []
  const totals = roi?.totals || { spent: 0, revenue: 0, leads: 0, patients: 0, roi_pct: 0, cpl: 0, cac: 0 }

  // Если совсем пусто — показываем понятное состояние
  const hasAnyData = sourcesList.length > 0 || channels.length > 0

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      {/* ─── KPI виджеты ──────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card padded>
          <div style={{ fontSize: 11, color: 'var(--fg-3)', fontWeight: 600 }}>Расход на рекламу</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--fg)' }}>{fmtRUB(totals.spent || 0)}</div>
          <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 4 }}>
            {fmtInt(totals.leads || 0)} лидов · {fmtInt(totals.patients || 0)} пациентов
          </div>
        </Card>
        <Card padded>
          <div style={{ fontSize: 11, color: 'var(--fg-3)', fontWeight: 600 }}>Доход с рекламы</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--accent)' }}>{fmtRUB(totals.revenue || 0)}</div>
          <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 4 }}>
            Всего пациентов: {fmtInt(totalPatients)}
          </div>
        </Card>
        <Card padded>
          <div style={{ fontSize: 11, color: 'var(--fg-3)', fontWeight: 600 }}>ROI</div>
          <div style={{
            fontSize: 22, fontWeight: 700,
            color: (totals.roi_pct || 0) >= 0 ? 'var(--good)' : 'var(--bad, #d33)',
          }}>
            {fmtPct(totals.roi_pct || 0)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 4 }}>
            Доход / Расход − 100%
          </div>
        </Card>
        <Card padded>
          <div style={{ fontSize: 11, color: 'var(--fg-3)', fontWeight: 600 }}>CPL · CAC</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--fg)' }}>
            {fmtRUB(totals.cpl || 0)} / {fmtRUB(totals.cac || 0)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 4 }}>
            Цена лида / стоимость пациента
          </div>
        </Card>
      </div>

      {/* ─── Donut + ROI bars ─────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card padded>
          <Card.Header><Card.Title>Источники пациентов</Card.Title></Card.Header>
          {sourcesList.length === 0 ? (
            <EmptyState icon="campaign" title="Нет атрибуций пациентов"
              description="Подключите UTM-метки или вручную добавьте источники в карточках пациентов." />
          ) : (
            <DonutChart
              slices={sourcesList.slice(0, 8).map(s => ({
                label: s.name,
                value: s.patients_count || s.count || 0,
              }))}
              formatter={fmtInt}
              size={200}
            />
          )}
        </Card>
        <Card padded>
          <Card.Header><Card.Title>ROI по каналам</Card.Title></Card.Header>
          {channels.length === 0 ? (
            <EmptyState icon="payments" title="Нет данных о расходах"
              description="Добавьте записи в Кабинете Системного администратора: Маркетинг → Расходы на рекламу." />
          ) : (
            <BarChart
              horizontal
              items={channels.slice(0, 8).map(c => ({
                label: c.name,
                value: c.roi_pct || 0,
              }))}
              formatter={fmtPct}
            />
          )}
        </Card>
      </div>

      {/* ─── Таблица детализации каналов ──────────────────── */}
      <Card padded>
        <Card.Header><Card.Title>Детализация по каналам</Card.Title></Card.Header>
        {channels.length === 0 ? (
          <EmptyState icon="campaign" title="Нет данных" />
        ) : (
          <div className="overflow-x-auto" style={{ marginLeft: -8, marginRight: -8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: 'var(--fg-3)', fontSize: 11, textTransform: 'uppercase' }}>
                  <th style={{ textAlign: 'left',  padding: '6px 8px' }}>Канал</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px' }}>Расход</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px' }} className="hidden sm:table-cell">Лиды</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px' }} className="hidden sm:table-cell">Пациенты</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px' }}>Доход</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px' }}>ROI</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px' }} className="hidden md:table-cell">CPL</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px' }} className="hidden md:table-cell">CAC</th>
                </tr>
              </thead>
              <tbody>
                {channels.map((c, i) => (
                  <tr key={`ch-${c.channel_id || i}`} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px', fontWeight: 600 }}>
                      <span className="material-symbols-rounded" style={{
                        fontSize: 16, verticalAlign: 'middle', marginRight: 6, color: 'var(--fg-3)',
                      }}>{c.icon || 'help'}</span>
                      {c.name}
                    </td>
                    <td style={{ padding: '8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtRUB(c.spent || 0)}</td>
                    <td style={{ padding: '8px', textAlign: 'right', color: 'var(--fg-3)' }} className="hidden sm:table-cell">{fmtInt(c.leads || 0)}</td>
                    <td style={{ padding: '8px', textAlign: 'right', color: 'var(--fg-3)' }} className="hidden sm:table-cell">{fmtInt(c.patients || 0)}</td>
                    <td style={{ padding: '8px', textAlign: 'right', color: 'var(--accent)', fontWeight: 600 }}>{fmtRUB(c.revenue || 0)}</td>
                    <td style={{
                      padding: '8px', textAlign: 'right', fontWeight: 600,
                      color: (c.roi_pct || 0) >= 0 ? 'var(--good)' : 'var(--bad, #d33)',
                    }}>{fmtPct(c.roi_pct || 0)}</td>
                    <td style={{ padding: '8px', textAlign: 'right', color: 'var(--fg-3)' }} className="hidden md:table-cell">{fmtRUB(c.cpl || 0)}</td>
                    <td style={{ padding: '8px', textAlign: 'right', color: 'var(--fg-3)' }} className="hidden md:table-cell">{fmtRUB(c.cac || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ─── Таблица источников (откуда пришли пациенты) ──── */}
      {sourcesList.length > 0 && (
        <Card padded>
          <Card.Header><Card.Title>Откуда пришли пациенты</Card.Title></Card.Header>
          <div className="overflow-x-auto" style={{ marginLeft: -8, marginRight: -8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: 'var(--fg-3)', fontSize: 11, textTransform: 'uppercase' }}>
                  <th style={{ textAlign: 'left',  padding: '6px 8px' }}>Источник</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px' }}>Пациенты</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px' }} className="hidden sm:table-cell">Доля</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px' }} className="hidden sm:table-cell">Приёмы</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px' }}>Доход</th>
                </tr>
              </thead>
              <tbody>
                {sourcesList.map((s, i) => (
                  <tr key={`src-${i}`} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px', fontWeight: 600 }}>
                      <span className="material-symbols-rounded" style={{
                        fontSize: 16, verticalAlign: 'middle', marginRight: 6, color: 'var(--fg-3)',
                      }}>{s.icon || 'help'}</span>
                      {s.name}
                    </td>
                    <td style={{ padding: '8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtInt(s.patients_count || s.count || 0)}</td>
                    <td style={{ padding: '8px', textAlign: 'right', color: 'var(--fg-3)' }} className="hidden sm:table-cell">{fmtPct(s.pct || 0)}</td>
                    <td style={{ padding: '8px', textAlign: 'right', color: 'var(--fg-3)' }} className="hidden sm:table-cell">{fmtInt(s.appointments_count || 0)}</td>
                    <td style={{ padding: '8px', textAlign: 'right', color: 'var(--accent)', fontWeight: 600 }}>{fmtRUB(s.revenue || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!hasAnyData && (
        <Card padded>
          <EmptyState
            icon="info"
            title="Данных пока нет"
            description="Добавьте расходы на рекламу через Кабинет Системного администратора и подключите UTM-разметку — после этого здесь появятся реальные цифры ROI, CPL и CAC."
          />
        </Card>
      )}
    </div>
  )
}
