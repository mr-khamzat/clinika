/**
 * ========================================
 * БЛОК: AccActs — реестр актов
 * ========================================
 * GET /accountant/acts?date_from&date_to&status →
 *   [{ id, act_number, act_status, act_type, period_label, amount_total,
 *      issued_at, signed_at, paid_at, has_pdf }, ...]
 *
 * Фильтры: статус + диапазон дат (date_from / date_to).
 * Колонки: №, период, тип, сумма, статус (Chip), действия.
 *
 * Download PDF: используем существующий эндпоинт /acts/{id}/pdf
 * (роутер /opt/clinika/backend/app/routers/acts.py, `get_act_pdf`).
 * Если в будущем для accountant потребуется отдельный URL — фронт
 * легко переключить здесь, в `actPdfUrl`.
 * ========================================
 */
import { useEffect, useMemo, useState } from 'react'
import api from '../../api'
import { Card, Button, Chip, EmptyState } from '../../design'
import { API_BASE } from '../../config'
import AccountantShell from '../_AccountantShell'

const STATUS_META = {
  paid:      { label: 'Оплачен',  bg: 'var(--good-soft)', fg: 'var(--good)'   },
  signed:    { label: 'Подписан', bg: 'var(--accent-soft)', fg: 'var(--accent)' },
  generated: { label: 'Выставлен', bg: 'var(--warn-soft)', fg: 'var(--warn)'  },
  draft:     { label: 'Черновик', bg: 'var(--bg-1)',      fg: 'var(--fg-3)'   },
  overdue:   { label: 'Просрочен', bg: 'var(--bad-soft)', fg: 'var(--bad)'    },
}

function fmtMoney(v) {
  if (v == null || v === '') return '—'
  const n = Number(v)
  if (Number.isNaN(n)) return String(v)
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽'
}
function fmtDate(v) {
  if (!v) return '—'
  try { return new Date(v).toLocaleDateString('ru-RU') }
  catch (_) { return String(v) }
}

function StatusChip({ status }) {
  const meta = STATUS_META[status] || { label: status || '—', bg: 'var(--bg-1)', fg: 'var(--fg-3)' }
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center',
        padding: '3px 9px', borderRadius: 999,
        background: meta.bg, color: meta.fg,
        fontSize: 11.5, fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      {meta.label}
    </span>
  )
}

// URL скачивания PDF акта. Используем существующий /acts/{id}/pdf.
// Если эндпоинт у тенанта не работает — кнопка покажет alert (см. ниже).
function actPdfUrl(id) {
  return `${API_BASE}/acts/${id}/pdf`
}

export default function AccActs() {
  const [list, setList]           = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [dateFrom, setDateFrom]   = useState('')
  const [dateTo, setDateTo]       = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const params = {}
      if (filterStatus) params.status = filterStatus
      if (dateFrom)     params.date_from = dateFrom
      if (dateTo)       params.date_to = dateTo
      const r = await api.get('/accountant/acts', { params })
      setList(Array.isArray(r.data) ? r.data : [])
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || 'Ошибка загрузки')
      setList([])
    } finally {
      setLoading(false)
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [filterStatus, dateFrom, dateTo])

  const total = useMemo(() => list.reduce((s, a) => s + (Number(a.amount_total) || 0), 0), [list])

  function downloadPdf(act) {
    if (!act.has_pdf) {
      // Если у акта нет файла — скачивание будет доделано в Phase 2.
      alert('Скачивание PDF будет в Phase 2')
      return
    }
    // Открываем в новой вкладке — axios interceptor подложит токен только для api-вызовов;
    // браузер откроет URL с теми же куками/сессией, что и приложение.
    window.open(actPdfUrl(act.id), '_blank', 'noopener,noreferrer')
  }

  return (
    <AccountantShell active="acts">
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--fg)', margin: 0 }}>
          Акты
        </h1>
        <div style={{ fontSize: 13, color: 'var(--fg-3)', marginTop: 4 }}>
          Реестр актов выполненных работ
        </div>
      </div>

      {/* ─── Фильтры ─── */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ minWidth: 160 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
              Статус
            </label>
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              style={{
                width: '100%', padding: '8px 10px', borderRadius: 9,
                border: '1px solid var(--border)', background: 'var(--surface)',
                color: 'var(--fg)', fontSize: 13, outline: 'none',
              }}
            >
              <option value="">Все статусы</option>
              <option value="draft">Черновик</option>
              <option value="generated">Выставлен</option>
              <option value="signed">Подписан</option>
              <option value="paid">Оплачен</option>
              <option value="overdue">Просрочен</option>
            </select>
          </div>
          <div style={{ minWidth: 140 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
              С даты
            </label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              style={{
                width: '100%', padding: '8px 10px', borderRadius: 9,
                border: '1px solid var(--border)', background: 'var(--surface)',
                color: 'var(--fg)', fontSize: 13, outline: 'none',
              }}
            />
          </div>
          <div style={{ minWidth: 140 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
              По дату
            </label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              style={{
                width: '100%', padding: '8px 10px', borderRadius: 9,
                border: '1px solid var(--border)', background: 'var(--surface)',
                color: 'var(--fg)', fontSize: 13, outline: 'none',
              }}
            />
          </div>
          {(filterStatus || dateFrom || dateTo) && (
            <Button
              variant="secondary"
              onClick={() => { setFilterStatus(''); setDateFrom(''); setDateTo('') }}
            >
              Сбросить
            </Button>
          )}
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>
            Найдено: <b style={{ color: 'var(--fg)' }}>{list.length}</b>
            {list.length > 0 && (
              <span style={{ marginLeft: 12 }}>
                Сумма: <b style={{ color: 'var(--fg)' }}>{fmtMoney(total)}</b>
              </span>
            )}
          </div>
        </div>
      </Card>

      {error && (
        <Card style={{ marginBottom: 16, borderColor: 'var(--bad)', background: 'var(--bad-soft)' }}>
          <div style={{ color: 'var(--bad)', fontSize: 13 }}>{error}</div>
        </Card>
      )}

      {/* ─── Таблица ─── */}
      <Card>
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-3)' }}>Загрузка…</div>
        ) : list.length === 0 ? (
          <EmptyState
            icon="description"
            title="Актов нет"
            description="Попробуйте изменить фильтры периода или статуса"
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={th}>№</th>
                  <th style={th}>Период</th>
                  <th style={th}>Тип</th>
                  <th style={{ ...th, textAlign: 'right' }}>Сумма</th>
                  <th style={th}>Выставлен</th>
                  <th style={th}>Статус</th>
                  <th style={{ ...th, textAlign: 'right' }}>Действия</th>
                </tr>
              </thead>
              <tbody>
                {list.map(act => (
                  <tr key={act.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ ...td, fontWeight: 600 }}>{act.act_number || '—'}</td>
                    <td style={td}>{act.period_label || '—'}</td>
                    <td style={{ ...td, color: 'var(--fg-2)' }}>{act.act_type || '—'}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmtMoney(act.amount_total)}</td>
                    <td style={{ ...td, color: 'var(--fg-2)' }}>{fmtDate(act.issued_at)}</td>
                    <td style={td}><StatusChip status={act.act_status} /></td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      {act.has_pdf ? (
                        <Button variant="secondary" onClick={() => downloadPdf(act)}>
                          <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>
                            download
                          </span>
                          PDF
                        </Button>
                      ) : (
                        <span style={{ color: 'var(--fg-4)', fontSize: 12 }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </AccountantShell>
  )
}

const th = {
  textAlign: 'left',
  padding: '10px 12px',
  fontWeight: 600,
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--fg-3)',
  whiteSpace: 'nowrap',
}
const td = {
  padding: '12px 12px',
  color: 'var(--fg)',
  verticalAlign: 'middle',
}
