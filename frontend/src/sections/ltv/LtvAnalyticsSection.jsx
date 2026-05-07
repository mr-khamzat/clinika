/**
 * ========================================
 * БЛОК: LtvAnalyticsSection — LTV-аналитика пациентов (модуль ltv_pro)
 * ========================================
 * Tabs:
 *   - Топ пациентов  (GET /analytics/ltv/patients)
 *   - Когорты        (GET /analytics/ltv/cohorts)
 *   - Сводка         (GET /analytics/ltv/summary)
 *
 * Действия:
 *   - «Пересчитать сейчас» — POST /analytics/ltv/recompute
 *
 * Поведение при отсутствии подписки:
 *   - 402 Payment Required → красивое окно «Подключить модуль»
 *
 * Бизнес-правила:
 *   - LTV-горизонт 3 года, формула считается на бэке
 *   - Pull данных идёт из МИС Renovatio через RenovatioAdapter
 * ========================================
 */
import { useEffect, useMemo, useState } from 'react'
import api from '../../api'
import { API_BASE, SLUG } from '../../config'
import {
  Card, KpiCard, KpiRow, Tabs, Button, Chip, EmptyState, useToast,
  ClinicScopeSelector,
} from '../../design'
import useClinicScope from '../../lib/useClinicScope'

// ─── Хелперы форматирования ────────────────────────────────────────────────
const fmtRub = (v) => {
  const n = Number(v || 0)
  if (!Number.isFinite(n)) return '—'
  return `${Math.round(n).toLocaleString('ru')} ₽`
}
// Для NetLTV: если 0 → значит данные getPayments недоступны (Renovatio пока
// не открыл права), показываем «—» вместо нолика.
const fmtRubOrDash = (v) => {
  const n = Number(v || 0)
  if (!Number.isFinite(n) || n <= 0) return '—'
  return `${Math.round(n).toLocaleString('ru')} ₽`
}
const fmtNum = (v) => {
  const n = Number(v || 0)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('ru')
}
const fmtPct = (v) => {
  const n = Number(v || 0)
  if (!Number.isFinite(n)) return '—'
  return `${n.toFixed(1)}%`
}

const RISK_LABEL = {
  low: { text: 'низкий', tone: 'good' },
  medium: { text: 'средний', tone: 'warn' },
  high: { text: 'высокий', tone: 'bad' },
}

// ─── Горизонт LTV (1/3/5/10 лет) ───────────────────────────────────────────
// Бэкенд принимает years=N в /summary, /patients, /export/pdf, /export/xlsx
// и пересчитывает значения LTV/NetLTV из базовой формулы (3 года) в N лет.
const HORIZON_OPTIONS = [
  { id: '1',  label: '1 год' },
  { id: '3',  label: '3 года' },
  { id: '5',  label: '5 лет' },
  { id: '10', label: '10 лет' },
]

// Русское склонение «лет / года / год» для произвольного числа лет.
function yearsLabelRu(n) {
  const num = Number(n) || 0
  const mod10 = num % 10
  const mod100 = num % 100
  if (mod10 === 1 && mod100 !== 11) return `${num} год`
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return `${num} года`
  return `${num} лет`
}

function authH(token) { return token ? { Authorization: `Bearer ${token}` } : {} }


// ─── Окно подключения модуля (показывается на 402) ─────────────────────────
function ConnectModulePrompt() {
  return (
    <Card>
      <div style={{ padding: '24px 12px', textAlign: 'center' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--fg)' }}>
          LTV-аналитика недоступна
        </div>
        <div style={{ marginTop: 8, color: 'var(--fg-3)', fontSize: 13, lineHeight: 1.6 }}>
          Модуль <b>ltv_pro</b> пока не подключён к вашей клинике.<br />
          Считает пожизненную ценность пациентов из МИС: топ по LTV, когорты,
          риск оттока, средний чек.<br />
          Стоимость 2 990 ₽/мес. Доступен пробный период 14 дней.
        </div>
        <div style={{ marginTop: 16, fontSize: 12, color: 'var(--fg-4)' }}>
          Чтобы подключить — обратитесь к администратору платформы.
        </div>
      </div>
    </Card>
  )
}


// ─── Сводка ────────────────────────────────────────────────────────────────
function SummaryView({ data, years = 3 }) {
  if (!data) return null
  return (
    <>
      <KpiRow cols={4} className="mb-4">
        <KpiCard
          label="Средний LTV"
          value={fmtRub(data.avg_ltv)}
          delta={`пациентов: ${fmtNum(data.total_patients)}`}
          trend="up"
        />
        <KpiCard
          label="Средний чистый LTV"
          value={fmtRubOrDash(data.avg_net_ltv)}
          delta={Number(data.avg_net_ltv || 0) > 0
            ? 'по фактическим оплатам'
            : 'getPayments не открыт'}
          trend={Number(data.avg_net_ltv || 0) > 0 ? 'up' : 'flat'}
        />
        <KpiCard
          label="Всего пациентов"
          value={fmtNum(data.total_patients)}
          delta="с визитами в МИС"
          trend="flat"
        />
        <KpiCard
          label="Доля оттока"
          value={fmtPct(data.churn_rate)}
          delta={`в зоне риска: ${fmtNum((data.at_risk_patients || 0) + (data.medium_risk_patients || 0))}`}
          trend={Number(data.churn_rate || 0) > 30 ? 'down' : 'flat'}
        />
      </KpiRow>
      <KpiRow cols={2} className="mb-4">
        <KpiCard
          label="At-risk"
          value={fmtNum(data.at_risk_patients)}
          delta={`средний риск: ${fmtNum(data.medium_risk_patients)}`}
          trend="down"
        />
        <KpiCard
          label="Средний чек"
          value={fmtRub(data.avg_check)}
          delta="по визитам с sum_value"
          trend="flat"
        />
      </KpiRow>

      <Card>
        <Card.Header>
          <Card.Title>Дополнительно</Card.Title>
        </Card.Header>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, padding: 4 }}>
          <Metric label="Общая выручка (по пациентам)" value={fmtRub(data.total_spent)} />
          <Metric
            label="Последний пересчёт"
            value={data.last_computed_at ? new Date(data.last_computed_at).toLocaleString('ru') : '—'}
          />
          <Metric label="Горизонт LTV / NetLTV" value={yearsLabelRu(years)} />
          <Metric
            label="NetLTV: источник"
            value={Number(data.avg_net_ltv || 0) > 0 ? 'getPayments (Renovatio)' : 'нет данных от Renovatio'}
          />
        </div>
      </Card>
    </>
  )
}

function Metric({ label, value }) {
  return (
    <div style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
      <div style={{ fontSize: 11, color: 'var(--fg-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div style={{ marginTop: 4, fontSize: 16, fontWeight: 700, color: 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
    </div>
  )
}


// ─── Топ пациентов ─────────────────────────────────────────────────────────
function PatientsTable({ rows }) {
  if (!rows || rows.length === 0) {
    return (
      <Card>
        <EmptyState
          title="Нет данных"
          message="Снапшоты ещё не построены. Нажмите «Пересчитать сейчас» — после этого здесь появятся пациенты с визитами из МИС."
        />
      </Card>
    )
  }
  return (
    <Card padded={false}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--fg-3)' }}>
              <th style={{ textAlign: 'left', padding: '12px 10px', fontWeight: 600 }}>Пациент</th>
              <th style={{ textAlign: 'right', padding: '12px 10px', fontWeight: 600 }}>Визиты</th>
              <th style={{ textAlign: 'right', padding: '12px 10px', fontWeight: 600 }}>Средний чек</th>
              <th style={{ textAlign: 'right', padding: '12px 10px', fontWeight: 600 }}>Total</th>
              <th style={{ textAlign: 'right', padding: '12px 10px', fontWeight: 600 }}>LTV</th>
              <th style={{ textAlign: 'right', padding: '12px 10px', fontWeight: 600 }} title="NetLTV — по фактическим оплатам из getPayments. «—» если Renovatio ещё не открыл доступ.">Чистый LTV</th>
              <th style={{ textAlign: 'left', padding: '12px 10px', fontWeight: 600 }}>Риск оттока</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const risk = RISK_LABEL[r.churn_risk] || RISK_LABEL.low
              return (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px' }}>
                    <div style={{ fontWeight: 600, color: 'var(--fg)' }}>{r.patient_name || '(без имени)'}</div>
                    <div style={{ fontSize: 11, color: 'var(--fg-4)' }}>{r.patient_phone}</div>
                  </td>
                  <td style={{ padding: '10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(r.visits_count)}</td>
                  <td style={{ padding: '10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtRub(r.avg_check)}</td>
                  <td style={{ padding: '10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtRub(r.total_spent)}</td>
                  <td style={{ padding: '10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'var(--accent)' }}>
                    {fmtRub(r.ltv_estimate)}
                  </td>
                  <td style={{ padding: '10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: Number(r.net_ltv || 0) > 0 ? 'var(--accent)' : 'var(--fg-4)' }}>
                    {fmtRubOrDash(r.net_ltv)}
                  </td>
                  <td style={{ padding: '10px' }}>
                    <Chip variant={risk.tone} dot>{risk.text}</Chip>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}


// ─── Когорты ───────────────────────────────────────────────────────────────
function CohortsTable({ rows }) {
  if (!rows || rows.length === 0) {
    return (
      <Card>
        <EmptyState
          title="Нет когорт"
          message="Когорты строятся по кварталу первого визита пациента. Появятся после первого пересчёта снапшотов."
        />
      </Card>
    )
  }
  return (
    <Card padded={false}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--fg-3)' }}>
              <th style={{ textAlign: 'left', padding: '12px 10px', fontWeight: 600 }}>Квартал</th>
              <th style={{ textAlign: 'right', padding: '12px 10px', fontWeight: 600 }}>Пациентов</th>
              <th style={{ textAlign: 'right', padding: '12px 10px', fontWeight: 600 }}>Total spent</th>
              <th style={{ textAlign: 'right', padding: '12px 10px', fontWeight: 600 }}>Avg LTV</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.cohort} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '10px', fontWeight: 600 }}>{r.cohort}</td>
                <td style={{ padding: '10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(r.patients)}</td>
                <td style={{ padding: '10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtRub(r.total_spent)}</td>
                <td style={{ padding: '10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'var(--accent)' }}>
                  {fmtRub(r.avg_ltv)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}


// ─── Главный компонент ─────────────────────────────────────────────────────
// Если clinicId передан явно (родитель управляет scope) — он используется;
// иначе включается внутренний useClinicScope() с собственным селектором.
export default function LtvAnalyticsSection({ adminToken, clinicId: externalClinicId }) {
  const toast = useToast()
  const [tab, setTab] = useState('summary')
  const [loading, setLoading] = useState(true)
  const [moduleAvailable, setModuleAvailable] = useState(true)
  const [summary, setSummary] = useState(null)
  const [patients, setPatients] = useState([])
  const [cohorts, setCohorts] = useState([])
  const [recomputing, setRecomputing] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)
  const [exportingXlsx, setExportingXlsx] = useState(false)
  // Горизонт расчёта LTV (1/3/5/10 лет). По умолчанию — 3 года (старая формула).
  // При смене перезагружаются summary/patients и передаётся в экспорт PDF/Excel.
  const [years, setYears] = useState(3)

  // Внутренний scope активен только если родитель не передал clinicId
  const externallyControlled = externalClinicId !== undefined
  const scope = useClinicScope()
  const effectiveClinicId = externallyControlled ? externalClinicId : scope.selectedId

  // Берём токен из переданного либо из localStorage. Менеджер логинится через
  // /arc/admin → ключ clinika_admin_token_arc; пациент / партнёр —
  // clinika_token_arc. Старые fallback'и оставлены для обратной совместимости.
  const token = adminToken || (typeof window !== 'undefined'
    ? (localStorage.getItem('clinika_admin_token_' + SLUG)
       || localStorage.getItem('clinika_token_' + SLUG)
       || localStorage.getItem('clinika_admin_token_')
       || localStorage.getItem('clinika_token')
       || localStorage.getItem('token')
       || '')
    : '')
  const headers = useMemo(() => authH(token), [token])

  const reload = async () => {
    setLoading(true)
    setModuleAvailable(true)
    // Базовые параметры включают горизонт LTV (years=N) — бэкенд пересчитывает
    // ltv_estimate / net_ltv в response без переписывания снапшотов в БД.
    const baseParams = { years }
    if (effectiveClinicId) baseParams.clinic_id = effectiveClinicId
    try {
      const [s, p, c] = await Promise.all([
        api.get(`/analytics/ltv/summary`, { headers, params: baseParams }),
        api.get(`/analytics/ltv/patients`, { headers, params: { ...baseParams, limit: 100, min_visits: 2 } }),
        // Когорты не зависят от horizon — отдельная семантика (avg по когорте за всё время)
        api.get(`/analytics/ltv/cohorts`, { headers }),
      ])
      setSummary(s.data || null)
      setPatients(Array.isArray(p.data) ? p.data : [])
      setCohorts(Array.isArray(c.data) ? c.data : [])
    } catch (e) {
      const code = e?.response?.status
      if (code === 402 || code === 403) {
        // 402 Payment Required (no module) | 403 (no role/feature)
        setModuleAvailable(false)
      } else {
        toast?.error?.('Не удалось загрузить LTV-аналитику: ' + (e?.response?.data?.detail || e.message))
      }
    } finally {
      setLoading(false)
    }
  }

  // Перезагружаем данные при смене clinic (внешней/внутренней) или горизонта LTV.
  useEffect(() => { reload() /* eslint-disable-next-line */ }, [effectiveClinicId, years])

  const recompute = async () => {
    setRecomputing(true)
    try {
      const params = effectiveClinicId ? { clinic_id: effectiveClinicId } : {}
      const r = await api.post(`/analytics/ltv/recompute`, null, { headers, params })
      const upd = r.data?.updated ?? 0
      toast?.success?.(`Пересчитано: обновлено ${upd} снапшотов`)
      await reload()
    } catch (e) {
      const code = e?.response?.status
      if (code === 402) {
        setModuleAvailable(false)
        toast?.error?.('Модуль ltv_pro не подключён')
      } else {
        toast?.error?.('Ошибка пересчёта: ' + (e?.response?.data?.detail || e.message))
      }
    } finally {
      setRecomputing(false)
    }
  }

  // ── Экспорт отчётов: PDF / Excel ────────────────────────────────────────
  // Запрашиваем blob, сохраняем через временную ссылку (download attr).
  // Имя файла берём из Content-Disposition сервера (если есть), иначе
  // собираем дефолтное «LTV-отчёт-АРЦ-YYYY-MM-DD».
  const exportReport = async (kind) => {
    const setBusy = kind === 'pdf' ? setExportingPdf : setExportingXlsx
    setBusy(true)
    try {
      // Передаём текущий горизонт LTV — отчёт сгенерится под выбранный N лет.
      const params = { years }
      if (effectiveClinicId) params.clinic_id = effectiveClinicId
      const url = `${API_BASE}/analytics/ltv/export/${kind}`
      const resp = await axios.get(url, {
        headers,
        params,
        responseType: 'blob',
      })

      // Имя файла из заголовка (RFC 5987 filename*=UTF-8'')
      const today = new Date().toISOString().slice(0, 10)
      const ext = kind === 'pdf' ? 'pdf' : 'xlsx'
      let filename = `LTV-отчёт-АРЦ-${today}.${ext}`
      const cd = resp.headers?.['content-disposition'] || resp.headers?.['Content-Disposition']
      if (cd) {
        const m = cd.match(/filename\*=UTF-8''([^;]+)/i)
        if (m) {
          try { filename = decodeURIComponent(m[1].trim().replace(/^"|"$/g, '')) } catch (_) {}
        } else {
          const m2 = cd.match(/filename="?([^";]+)"?/i)
          if (m2) {
            try { filename = decodeURIComponent(m2[1]) } catch (_) { filename = m2[1] }
          }
        }
      }

      const blob = new Blob([resp.data], {
        type: kind === 'pdf'
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      // Освобождаем URL чуть позже, чтобы браузер успел инициировать загрузку
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1500)
      toast?.success?.('Отчёт скачан')
    } catch (e) {
      const code = e?.response?.status
      if (code === 402) {
        setModuleAvailable(false)
        toast?.error?.('Модуль ltv_pro не подключён')
      } else {
        toast?.error?.('Ошибка экспорта: ' + (e?.response?.data?.detail || e.message))
      }
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <Card>
        <div style={{ padding: 24, color: 'var(--fg-3)' }}>Загрузка LTV-аналитики…</div>
      </Card>
    )
  }

  if (!moduleAvailable) {
    return <ConnectModulePrompt />
  }

  const tabs = [
    { id: 'summary',  label: 'Сводка' },
    { id: 'patients', label: 'Топ пациентов', badge: patients.length || null },
    { id: 'cohorts',  label: 'Когорты', badge: cohorts.length || null },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--fg)' }}>LTV-аналитика</div>
        <Tabs items={tabs} value={tab} onChange={setTab} />
        <div className="flex-1" />
        {/* Горизонт расчёта LTV: 1/3/5/10 лет — пересчёт LTV/NetLTV в response */}
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          title="Горизонт расчёта LTV / NetLTV"
        >
          <span style={{ fontSize: 12, color: 'var(--fg-3)', whiteSpace: 'nowrap' }}>
            Горизонт:
          </span>
          <Tabs
            items={HORIZON_OPTIONS}
            value={String(years)}
            onChange={(v) => setYears(Number(v))}
          />
        </div>
        {/* Селектор клиники — только если внутренний scope активен */}
        {!externallyControlled && scope.clinics.length > 0 && (
          <ClinicScopeSelector
            clinics={scope.clinics}
            selectedId={scope.selectedId}
            onChange={scope.setSelectedId}
            allowAll={scope.isMultiClinic}
          />
        )}
        <Button
          variant="ghost"
          onClick={() => exportReport('pdf')}
          disabled={exportingPdf}
          title="Скачать PDF-отчёт"
        >
          {exportingPdf ? 'PDF…' : '📄 PDF'}
        </Button>
        <Button
          variant="ghost"
          onClick={() => exportReport('xlsx')}
          disabled={exportingXlsx}
          title="Скачать Excel-отчёт"
        >
          {exportingXlsx ? 'Excel…' : '📊 Excel'}
        </Button>
        <Button variant="primary" onClick={recompute} disabled={recomputing}>
          {recomputing ? 'Пересчёт…' : 'Пересчитать сейчас'}
        </Button>
      </div>

      {tab === 'summary'  && <SummaryView data={summary} years={years} />}
      {tab === 'patients' && <PatientsTable rows={patients} />}
      {tab === 'cohorts'  && <CohortsTable rows={cohorts} />}
    </div>
  )
}
