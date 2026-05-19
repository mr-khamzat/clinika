/**
 * NetworkDashboard — Главная страница «Сводная панель сети клиник».
 *
 * Доступно: director / deputy_director / franchise_owner / super_admin.
 * Виджеты:
 *  - KPI Row (Клиник / Выручка / Визиты / Активных в ЛК / Новых / NPS)
 *  - Карточка лидера сети
 *  - Линейный график выручки сети по дням
 *  - Сравнение клиник по выручке (bar chart)
 *  - Таблица с детализацией по клиникам
 *  - Кнопка «Скачать PDF» — GET /api/network/overview/export-pdf
 */
import { useState, useEffect, useMemo } from 'react'
import { API_BASE } from '../../config'

const API = API_BASE

function fetchJson(token, path) {
  return fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
}

function fmtMoney(v) {
  if (v == null) return '—'
  return Math.round(v).toLocaleString('ru') + ' ₽'
}

function KPICard({ label, value, color = 'cyan' }) {
  const colorMap = {
    cyan:   'bg-cyan-50 dark:bg-cyan-900/20 border-cyan-200 dark:border-cyan-800 text-cyan-900 dark:text-cyan-100',
    violet: 'bg-violet-50 dark:bg-violet-900/20 border-violet-200 dark:border-violet-800 text-violet-900 dark:text-violet-100',
    amber:  'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-100',
    green:  'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-900 dark:text-green-100',
  }
  return (
    <div className={`rounded-xl p-4 border ${colorMap[color] || colorMap.cyan}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs opacity-70 mt-0.5">{label}</div>
    </div>
  )
}

function NetworkLineChart({ data }) {
  if (!data || data.length < 2) {
    return <div className="text-center text-sm text-gray-400 py-8">Недостаточно данных для графика</div>
  }
  const W = 560, H = 160
  const padL = 50, padR = 10, padT = 12, padB = 28
  const plotW = W - padL - padR
  const plotH = H - padT - padB
  const maxV = Math.max(...data.map(d => d.value)) || 1
  const n = data.length
  const points = data.map((d, i) => {
    const x = padL + (i / (n - 1)) * plotW
    const y = padT + plotH - (d.value / maxV) * plotH
    return [x, y]
  })
  const polyline = points.map(p => p.join(',')).join(' ')
  const area = `M ${padL} ${padT + plotH} L ${points.map(p => p.join(',')).join(' L ')} L ${padL + plotW} ${padT + plotH} Z`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-44">
      <line x1={padL} y1={padT + plotH} x2={padL + plotW} y2={padT + plotH} stroke="#cbd5e1" strokeWidth="0.5" />
      <line x1={padL} y1={padT} x2={padL} y2={padT + plotH} stroke="#cbd5e1" strokeWidth="0.5" />
      <text x={padL - 4} y={padT + 4} fontSize="8" fill="#64748b" textAnchor="end">{fmtMoney(maxV)}</text>
      <text x={padL - 4} y={padT + plotH} fontSize="8" fill="#64748b" textAnchor="end">0</text>
      <path d={area} fill="#bae6fd" opacity="0.5" />
      <polyline points={polyline} fill="none" stroke="#0891b2" strokeWidth="2" />
      <text x={padL} y={H - 8} fontSize="9" fill="#64748b">{data[0].date}</text>
      <text x={padL + plotW} y={H - 8} fontSize="9" fill="#64748b" textAnchor="end">{data[n - 1].date}</text>
    </svg>
  )
}

function ClinicsBarChart({ clinics }) {
  if (!clinics || !clinics.length) {
    return <div className="text-center text-sm text-gray-400 py-8">Нет клиник в сети</div>
  }
  const maxRev = Math.max(...clinics.map(c => c.revenue)) || 1
  return (
    <div className="space-y-2">
      {clinics.map(c => (
        <div key={c.tenant_id} className="flex items-center gap-3 text-sm">
          <div className="w-40 truncate text-gray-700 dark:text-gray-300" title={c.name}>{c.name || '—'}</div>
          <div className="flex-1 h-4 bg-gray-200 dark:bg-gray-700 rounded overflow-hidden">
            <div className="h-4 bg-cyan-600 rounded" style={{ width: `${(c.revenue / maxRev) * 100}%` }} />
          </div>
          <div className="w-24 text-right font-semibold text-cyan-900 dark:text-cyan-100">{fmtMoney(c.revenue)}</div>
        </div>
      ))}
    </div>
  )
}

export default function NetworkDashboard({ token }) {
  const [days, setDays] = useState(30)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [pdfBusy, setPdfBusy] = useState(false)

  // ── ЛК-пациенты сети ─────────────────────────────────────────────────────
  const [patients, setPatients] = useState([])
  const [patientsLoading, setPatientsLoading] = useState(false)
  const [patientSearch, setPatientSearch] = useState('')
  const [openPatient, setOpenPatient] = useState(null)
  const [patientDetails, setPatientDetails] = useState(null)
  const [detailsLoading, setDetailsLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    setErr('')
    fetchJson(token, `/network/overview?days=${days}`)
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setErr(String(e.message || e)); setLoading(false) })
  }, [token, days])

  useEffect(() => {
    setPatientsLoading(true)
    const q = patientSearch.trim()
    const qs = q ? `?q=${encodeURIComponent(q)}` : ''
    fetchJson(token, `/network/patients${qs}`)
      .then(d => { setPatients(d.patients || []); setPatientsLoading(false) })
      .catch(() => setPatientsLoading(false))
  }, [token, patientSearch])

  const openPatientDrawer = (p) => {
    setOpenPatient(p)
    setPatientDetails(null)
    setDetailsLoading(true)
    fetchJson(token, `/network/patients/${p.id}`)
      .then(d => { setPatientDetails(d); setDetailsLoading(false) })
      .catch(() => setDetailsLoading(false))
  }

  const downloadPdf = async () => {
    setPdfBusy(true)
    try {
      const res = await fetch(`${API}/network/overview/export-pdf?days=${days}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `network-dashboard-${new Date().toISOString().slice(0, 10)}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert('Ошибка PDF: ' + e.message)
    } finally {
      setPdfBusy(false)
    }
  }

  if (loading) return <div className="p-8 text-center text-gray-400">Загрузка…</div>
  if (err)     return <div className="p-8 text-center text-red-500">Ошибка: {err}</div>
  if (!data)   return null

  const totals = data.totals || {}
  const clinics = data.clinics || []
  const top = totals.top_clinic

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Сводная панель сети клиник</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {data.scope === 'franchise' ? 'Все клиники моей франшизы' : 'Одна клиника'}
            {' · '}
            Период: последние {days} дн
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={e => setDays(Number(e.target.value))}
            className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
          >
            {[7, 14, 30, 60, 90, 180, 365].map(d => <option key={d} value={d}>{d} дн</option>)}
          </select>
          <button
            onClick={downloadPdf}
            disabled={pdfBusy}
            className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg text-sm font-semibold transition disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-base">picture_as_pdf</span>
            {pdfBusy ? 'Генерация…' : 'Скачать PDF'}
          </button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KPICard label="Клиник в сети"      value={totals.clinics ?? 0}                  color="cyan" />
        <KPICard label={`Выручка ${days} дн`} value={fmtMoney(totals.revenue || 0)}     color="green" />
        <KPICard label="Визитов"             value={(totals.visits ?? 0).toLocaleString('ru')} color="violet" />
        <KPICard label="Активных в ЛК"       value={(totals.active_lk ?? 0).toLocaleString('ru')} color="cyan" />
        <KPICard label="Новых пациентов"     value={(totals.new_lk ?? 0).toLocaleString('ru')}    color="amber" />
        <KPICard label={`NPS (${totals.nps_count ?? 0})`} value={(totals.avg_nps ?? 0).toFixed(1)} color="green" />
      </div>

      {/* Top clinic */}
      {top?.name && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4 flex items-center gap-3">
          <span className="material-symbols-outlined text-3xl text-amber-600 dark:text-amber-400">workspace_premium</span>
          <div>
            <div className="text-xs uppercase tracking-wide text-amber-700 dark:text-amber-300 font-semibold">Лидер по выручке</div>
            <div className="text-lg font-bold text-amber-900 dark:text-amber-100">
              {top.name} <span className="text-amber-600">— {fmtMoney(top.revenue)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Выручка сети по дням</h3>
          <NetworkLineChart data={data.network_daily_revenue} />
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Сравнение клиник</h3>
          <ClinicsBarChart clinics={clinics} />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Детализация по клиникам</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                <th className="text-left px-4 py-2 font-semibold text-gray-600 dark:text-gray-400">Клиника</th>
                <th className="text-right px-4 py-2 font-semibold text-gray-600 dark:text-gray-400">Выручка</th>
                <th className="text-right px-4 py-2 font-semibold text-gray-600 dark:text-gray-400">Визиты</th>
                <th className="text-right px-4 py-2 font-semibold text-gray-600 dark:text-gray-400">Актив. в ЛК</th>
                <th className="text-right px-4 py-2 font-semibold text-gray-600 dark:text-gray-400">Новых</th>
                <th className="text-right px-4 py-2 font-semibold text-gray-600 dark:text-gray-400">NPS</th>
              </tr>
            </thead>
            <tbody>
              {clinics.length === 0 && (
                <tr><td colSpan={6} className="text-center py-8 text-gray-400">Нет клиник в сети</td></tr>
              )}
              {clinics.map(c => (
                <tr key={c.tenant_id} className="border-t border-gray-100 dark:border-gray-700">
                  <td className="px-4 py-2 text-gray-900 dark:text-gray-100 font-medium">{c.name || '—'}</td>
                  <td className="px-4 py-2 text-right text-cyan-700 dark:text-cyan-300 font-semibold">{fmtMoney(c.revenue)}</td>
                  <td className="px-4 py-2 text-right text-gray-700 dark:text-gray-300">{c.visits.toLocaleString('ru')}</td>
                  <td className="px-4 py-2 text-right text-gray-700 dark:text-gray-300">{c.active_lk.toLocaleString('ru')}</td>
                  <td className="px-4 py-2 text-right text-gray-700 dark:text-gray-300">{c.new_lk.toLocaleString('ru')}</td>
                  <td className="px-4 py-2 text-right text-gray-700 dark:text-gray-300">
                    {c.avg_nps.toFixed(1)} <span className="text-xs text-gray-400">({c.nps_count})</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ЛК-пациенты сети */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">ЛК-пациенты сети</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Все пациенты с записями в клиниках вашей сети ({patients.length})
            </p>
          </div>
          <input
            type="search"
            value={patientSearch}
            onChange={e => setPatientSearch(e.target.value)}
            placeholder="Поиск по имени или телефону…"
            className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 w-64"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                <th className="text-left px-4 py-2 font-semibold text-gray-600 dark:text-gray-400">Имя</th>
                <th className="text-left px-4 py-2 font-semibold text-gray-600 dark:text-gray-400">Телефон</th>
                <th className="text-left px-4 py-2 font-semibold text-gray-600 dark:text-gray-400">Основная клиника</th>
                <th className="text-right px-4 py-2 font-semibold text-gray-600 dark:text-gray-400">Визитов</th>
                <th className="text-left px-4 py-2 font-semibold text-gray-600 dark:text-gray-400">Последний визит</th>
                <th className="text-left px-4 py-2 font-semibold text-gray-600 dark:text-gray-400">Активен в ЛК</th>
                <th className="text-right px-4 py-2 font-semibold text-gray-600 dark:text-gray-400">Кабинет</th>
              </tr>
            </thead>
            <tbody>
              {patientsLoading && (
                <tr><td colSpan={7} className="text-center py-6 text-gray-400">Загрузка…</td></tr>
              )}
              {!patientsLoading && patients.length === 0 && (
                <tr><td colSpan={7} className="text-center py-8 text-gray-400">
                  {patientSearch ? 'Никого не найдено' : 'Нет пациентов в сети'}
                </td></tr>
              )}
              {patients.map(p => (
                <tr key={p.id} className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/40">
                  <td className="px-4 py-2 text-gray-900 dark:text-gray-100 font-medium">{p.name || '—'}</td>
                  <td className="px-4 py-2 text-gray-700 dark:text-gray-300 font-mono text-xs">{p.phone}</td>
                  <td className="px-4 py-2 text-gray-700 dark:text-gray-300">{p.primary_clinic_name || '—'}</td>
                  <td className="px-4 py-2 text-right text-cyan-700 dark:text-cyan-300 font-semibold">{p.visits}</td>
                  <td className="px-4 py-2 text-gray-700 dark:text-gray-300 text-xs">
                    {p.last_visit_at ? new Date(p.last_visit_at).toLocaleDateString('ru') : '—'}
                  </td>
                  <td className="px-4 py-2 text-gray-700 dark:text-gray-300 text-xs">
                    {p.last_seen_at ? new Date(p.last_seen_at).toLocaleDateString('ru') : 'Не входил'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => openPatientDrawer(p)}
                      className="text-xs px-3 py-1 bg-cyan-100 hover:bg-cyan-200 dark:bg-cyan-900/40 dark:hover:bg-cyan-900/60 text-cyan-800 dark:text-cyan-200 rounded-lg font-semibold transition"
                    >
                      Открыть
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-gray-400 text-center">
        Сгенерировано {data.generated_at?.slice(0, 19).replace('T', ' ')}
      </p>

      {/* Drawer с деталями пациента */}
      {openPatient && (
        <div className="fixed inset-0 z-50 flex items-stretch justify-end" onClick={() => setOpenPatient(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative w-full max-w-xl bg-white dark:bg-gray-900 shadow-2xl overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white dark:bg-gray-900 px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">{openPatient.name}</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">{openPatient.phone}</p>
              </div>
              <button onClick={() => setOpenPatient(null)} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="p-6 space-y-5">
              {detailsLoading && <div className="text-center text-gray-400 py-8">Загрузка…</div>}
              {patientDetails && (
                <>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 font-semibold">Email</div>
                      <div className="text-gray-900 dark:text-gray-100">{patientDetails.email || '—'}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 font-semibold">День рождения</div>
                      <div className="text-gray-900 dark:text-gray-100">
                        {patientDetails.birth_date ? new Date(patientDetails.birth_date).toLocaleDateString('ru') : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 font-semibold">Зарегистрирован</div>
                      <div className="text-gray-900 dark:text-gray-100">
                        {patientDetails.registered_at ? new Date(patientDetails.registered_at).toLocaleDateString('ru') : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 font-semibold">Последний вход</div>
                      <div className="text-gray-900 dark:text-gray-100">
                        {patientDetails.last_login_at ? new Date(patientDetails.last_login_at).toLocaleDateString('ru') : 'Не входил'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 font-semibold">Входов всего</div>
                      <div className="text-gray-900 dark:text-gray-100">{patientDetails.login_count || 0}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 font-semibold">Маркетинг</div>
                      <div className="text-gray-900 dark:text-gray-100">{patientDetails.marketing_opt_in ? 'Разрешён' : 'Запрещён'}</div>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">Клиники сети, в которых был</h4>
                    {patientDetails.clinics_visited?.length ? (
                      <div className="space-y-1">
                        {patientDetails.clinics_visited.map((c, i) => (
                          <div key={i} className="flex items-center justify-between text-sm bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2">
                            <div className="font-medium text-gray-900 dark:text-gray-100">{c.clinic_name}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              {c.visits} визитов · {c.last_visit_at ? new Date(c.last_visit_at).toLocaleDateString('ru') : '—'}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : <p className="text-sm text-gray-400">Нет визитов</p>}
                  </div>

                  <div>
                    <h4 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">
                      Последние визиты ({patientDetails.visits?.length || 0})
                    </h4>
                    <div className="space-y-1 max-h-72 overflow-y-auto">
                      {patientDetails.visits?.map(v => (
                        <div key={v.id} className="border-l-2 border-cyan-400 pl-3 py-1.5">
                          <div className="text-sm text-gray-900 dark:text-gray-100">
                            {v.start_at ? new Date(v.start_at).toLocaleString('ru') : '—'}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {v.clinic_name} · {v.doctor_name || 'врач не указан'}
                            {v.status && <span className="ml-1 px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-[10px]">{v.status}</span>}
                          </div>
                        </div>
                      ))}
                      {!patientDetails.visits?.length && <p className="text-sm text-gray-400">Нет записей</p>}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
