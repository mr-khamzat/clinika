import { useEffect, useState } from 'react'
import axios from 'axios'

/**
 * PatientMedicalRecord — единая электронная медкарта пациента.
 * Агрегирует данные из нашей БД + МИС Renovatio + лаб + документов.
 *
 * Источник данных: GET /patient/medical-record?t=<token>
 */
export default function PatientMedicalRecord({ apiBase, sessionToken }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!sessionToken) {
      setError('Сессия не найдена. Войдите в кабинет заново.')
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    axios
      .get(`${apiBase}/patient/medical-record`, { params: { t: sessionToken } })
      .then((r) => { if (!cancelled) setData(r.data) })
      .catch((e) => {
        if (!cancelled) setError(e?.response?.data?.detail || 'Не удалось загрузить медкарту')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [apiBase, sessionToken])

  if (loading) {
    return (
      <div className="p-8 text-center text-gray-400 text-sm">
        <div className="inline-block w-10 h-10 rounded-full border-4 border-cyan-200 border-t-cyan-600 animate-spin mb-3" />
        <div>Загрузка медкарты…</div>
      </div>
    )
  }
  if (error) {
    return (
      <div className="p-6 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-sm">
        {error}
      </div>
    )
  }
  if (!data) return null

  const {
    profile = {},
    anthropometry,
    visits = [],
    diagnoses_active = [],
    prescriptions_active = [],
    allergies = [],
    recent_labs = [],
    documents = [],
    referrals = [],
    vaccinations = [],
  } = data

  const age = profile.birth_date
    ? Math.floor((Date.now() - new Date(profile.birth_date)) / (365.25 * 24 * 3600 * 1000))
    : null
  const initials = (profile.name || profile.phone || '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0])
    .join('')
    .toUpperCase()

  const fmtDate = (s) => {
    if (!s) return ''
    try { return new Date(s).toLocaleDateString('ru-RU') } catch { return s }
  }

  const onDownloadPdf = () => {
    if (!sessionToken) return
    const url = `${apiBase}/patient/medical-record/pdf?t=${encodeURIComponent(sessionToken)}`
    // На мобиле — window.open в новой вкладке (Safari сам предложит сохранить)
    // На десктопе — невидимая ссылка с download attribute
    const a = document.createElement('a')
    a.href = url
    a.download = ''
    a.target = '_blank'
    document.body.appendChild(a)
    a.click()
    setTimeout(() => document.body.removeChild(a), 100)
  }

  return (
    <div className="space-y-4 p-2">
      {/* ── Шапка ───────────────────────────────────────────── */}
      <div
        className="rounded-3xl p-5 text-white shadow-lg"
        style={{ background: 'linear-gradient(135deg,#0A2342 0%,#0097A7 100%)' }}
      >
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur grid place-items-center text-2xl font-bold border border-white/30 flex-shrink-0">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xl font-bold truncate">
              {profile.name || 'Пациент'}
            </div>
            <div className="text-sm opacity-90 mt-1">
              {profile.birth_date && fmtDate(profile.birth_date)}
              {age != null && ` · ${age} лет`}
              {profile.sex && (String(profile.sex).toLowerCase().startsWith('m') ? ' · М' : ' · Ж')}
            </div>
            <div className="text-xs opacity-80 mt-1 truncate">
              {profile.phone && <>📞 {profile.phone}</>}
              {profile.email && <> · ✉ {profile.email}</>}
            </div>
            {(() => {
              const addr = typeof profile.address === 'string'
                ? profile.address
                : (profile.address && typeof profile.address === 'object'
                    ? (profile.address.fullAddress || [profile.address.city, profile.address.street, profile.address.house].filter(Boolean).join(', '))
                    : null)
              return addr ? <div className="text-[11px] opacity-75 mt-0.5 truncate">📍 {addr}</div> : null
            })()}
            {false && (
              <div className="text-[11px] opacity-75 mt-0.5 truncate">📍 {profile.address}</div>
            )}
            {profile.mis_patient_id && (
              <div className="text-[10px] opacity-70 mt-1">
                МИС&nbsp;ID: {profile.mis_patient_id}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onDownloadPdf}
            className="px-3 py-2 rounded-xl bg-white/15 hover:bg-white/25 border border-white/30 text-xs font-semibold backdrop-blur transition flex-shrink-0"
            title="Скачать PDF медкарты"
          >
            ⬇ PDF
          </button>
        </div>
      </div>

      {/* ── Аллергии (срочный блок) ─────────────────────────── */}
      {allergies.length > 0 && (
        <div className="rounded-2xl p-4 bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-800">
          <div className="text-sm font-bold mb-2 text-red-800 dark:text-red-300 flex items-center gap-2">
            <span>🚨</span> Аллергии
          </div>
          <div className="flex gap-2 flex-wrap">
            {allergies.map((a, i) => (
              <div
                key={i}
                className="px-3 py-1.5 rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 text-xs font-semibold"
              >
                {a.name}
                {a.severity && a.severity !== '—' && ` · ${a.severity}`}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Антропометрия ───────────────────────────────────── */}
      {anthropometry && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {anthropometry.height && (
            <Stat label="Рост" value={`${anthropometry.height} см`} icon="📏" />
          )}
          {anthropometry.weight && (
            <Stat label="Вес" value={`${anthropometry.weight} кг`} icon="⚖️" />
          )}
          {anthropometry.bmi != null && (
            <Stat label="ИМТ" value={anthropometry.bmi} icon="📊" />
          )}
          {anthropometry.blood_type && (
            <Stat label="Группа крови" value={anthropometry.blood_type} icon="🩸" />
          )}
        </div>
      )}

      {/* ── Двухколоночная сетка на десктопе ────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Активные диагнозы */}
        {diagnoses_active.length > 0 && (
          <Section title="🩺 Активные диагнозы">
            {diagnoses_active.map((d, i) => (
              <div
                key={i}
                className="p-3 rounded-xl bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 mb-2 last:mb-0"
              >
                <div className="font-semibold text-sm">{d.name}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-2 flex-wrap">
                  {d.code && (
                    <span className="font-mono bg-orange-100 dark:bg-orange-900/40 px-1.5 py-0.5 rounded">
                      {d.code}
                    </span>
                  )}
                  {d.doctor && <span>{d.doctor}</span>}
                  {d.since && <span>· с {fmtDate(d.since)}</span>}
                </div>
              </div>
            ))}
          </Section>
        )}

        {/* Назначения */}
        {prescriptions_active.length > 0 && (
          <Section title="💊 Текущие назначения">
            {prescriptions_active.map((p, i) => (
              <div
                key={i}
                className="p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 mb-2 last:mb-0"
              >
                <div className="font-semibold text-sm">{p.drug}</div>
                {(p.dose || p.schedule) && (
                  <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                    {p.dose}
                    {p.dose && p.schedule && ' · '}
                    {p.schedule}
                  </div>
                )}
                {(p.doctor || p.prescribed_at) && (
                  <div className="text-[11px] text-gray-500 mt-1">
                    {p.doctor}
                    {p.doctor && p.prescribed_at && ' · '}
                    {p.prescribed_at && fmtDate(p.prescribed_at)}
                  </div>
                )}
              </div>
            ))}
          </Section>
        )}

        {/* Последние анализы */}
        {recent_labs.length > 0 && (
          <Section title="🧪 Последние анализы">
            {recent_labs.map((l, i) => {
              const c =
                l.status === 'ok'   ? '#16a34a' :
                l.status === 'high' ? '#dc2626' :
                l.status === 'low'  ? '#f59e0b' : '#6b7280'
              return (
                <div
                  key={i}
                  className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40 mb-2 last:mb-0"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xl flex-shrink-0">{l.icon || '🧪'}</span>
                    <div className="min-w-0">
                      <div className="font-semibold text-sm truncate">{l.name}</div>
                      <div className="text-xs text-gray-500">{fmtDate(l.date)}</div>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 ml-2">
                    <div className="font-bold" style={{ color: c }}>
                      {l.value}
                      {l.unit && <span className="text-xs text-gray-500 ml-1">{l.unit}</span>}
                    </div>
                  </div>
                </div>
              )
            })}
          </Section>
        )}

        {/* Документы */}
        {documents.length > 0 && (
          <Section title="📄 Документы">
            {documents.map((d) => (
              <a
                key={d.id}
                href={d.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40 mb-2 last:mb-0 hover:bg-cyan-50 dark:hover:bg-cyan-900/20 transition"
              >
                <span className="text-2xl flex-shrink-0">📄</span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">{d.title}</div>
                  <div className="text-xs text-gray-500">
                    {d.doctor && <>{d.doctor} · </>}
                    {fmtDate(d.date)}
                  </div>
                </div>
                <span className="text-cyan-600 text-xl flex-shrink-0">⇩</span>
              </a>
            ))}
          </Section>
        )}

        {/* Направления */}
        {referrals.length > 0 && (
          <Section title="🧾 Направления">
            {referrals.map((r, i) => (
              <div
                key={i}
                className="p-3 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 mb-2 last:mb-0"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold text-sm truncate">
                    {r.service || 'Направление'}
                  </div>
                  <span className="font-mono text-xs bg-indigo-100 dark:bg-indigo-900/40 px-2 py-0.5 rounded">
                    #{r.short_code}
                  </span>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {r.target_clinic && <>{r.target_clinic} · </>}
                  {r.status && <span className="uppercase">{r.status}</span>}
                  {r.created_at && <> · {fmtDate(r.created_at)}</>}
                </div>
              </div>
            ))}
          </Section>
        )}

        {/* Прививки */}
        {vaccinations.length > 0 && (
          <Section title="💉 Прививки">
            {vaccinations.map((v, i) => (
              <div
                key={i}
                className="flex justify-between items-center px-2 py-1.5 text-sm border-b last:border-b-0 dark:border-gray-700"
              >
                <div className="min-w-0">
                  <div className="truncate">{v.name}</div>
                  {v.lot && (
                    <div className="text-[11px] text-gray-500 font-mono">партия {v.lot}</div>
                  )}
                </div>
                <span className="text-gray-500 text-xs flex-shrink-0 ml-2">
                  {fmtDate(v.date)}
                </span>
              </div>
            ))}
          </Section>
        )}
      </div>

      {/* ── История визитов — timeline на всю ширину ────────── */}
      {visits.length > 0 && (
        <Section title="📅 История визитов">
          <div className="relative pl-6">
            <div className="absolute left-2 top-2 bottom-2 w-0.5 bg-gradient-to-b from-cyan-300 via-cyan-200 to-transparent dark:from-cyan-700 dark:via-cyan-800" />
            {visits.slice(0, 20).map((v, i) => (
              <div key={i} className="relative mb-4 last:mb-0">
                <div className="absolute -left-[18px] top-1.5 w-3 h-3 rounded-full bg-cyan-500 border-2 border-white dark:border-gray-800 shadow" />
                <div className="text-xs text-gray-500 flex items-center gap-2 flex-wrap">
                  <span>{fmtDate(v.date)}{v.time && ` · ${v.time}`}</span>
                  {v.source === 'mis' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">
                      МИС
                    </span>
                  )}
                  {v.source === 'local' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300">
                      КлиникСеть
                    </span>
                  )}
                  {v.status && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 uppercase">
                      {v.status}
                    </span>
                  )}
                </div>
                <div className="font-semibold text-sm mt-0.5">{v.service || 'Приём'}</div>
                <div className="text-xs text-gray-600 dark:text-gray-400">
                  {v.doctor}
                  {v.clinic && <> · {v.clinic}</>}
                </div>
                {v.notes && (
                  <div className="text-xs text-gray-500 mt-1 italic">«{v.notes}»</div>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Если пусто — заглушка */}
      {visits.length === 0 &&
        diagnoses_active.length === 0 &&
        prescriptions_active.length === 0 &&
        recent_labs.length === 0 &&
        documents.length === 0 &&
        referrals.length === 0 && (
        <div className="p-8 text-center text-gray-400 text-sm rounded-2xl border border-dashed dark:border-gray-700">
          В медкарте пока пусто. Данные появятся после первого визита или синхронизации с МИС.
        </div>
      )}

      <div className="text-[10px] text-gray-400 text-center pt-2">
        Данные собраны из МИС, наших приёмов и лаб-результатов.
        Обновлено: {data.generated_at ? new Date(data.generated_at).toLocaleString('ru-RU') : '—'}
      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="rounded-2xl bg-white dark:bg-gray-800 border dark:border-gray-700 p-4 shadow-sm">
      <div className="font-bold text-sm mb-3">{title}</div>
      {children}
    </div>
  )
}

function Stat({ label, value, icon }) {
  return (
    <div className="rounded-xl bg-white dark:bg-gray-800 border dark:border-gray-700 p-3 text-center shadow-sm">
      <div className="text-xl">{icon}</div>
      <div className="text-base font-bold mt-1">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  )
}
