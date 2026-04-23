/**
 * AISection — AI-аналитика через OpenAI-compatible API.
 * Вкладки: Инсайты / Отчёт / Спросить AI / Настройки (super_admin)
 */
import { useState, useCallback, useEffect } from 'react'
import { API_BASE } from '../config'

const API = API_BASE

function apiFetch(token, path, opts = {}) {
  return fetch(API + path, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  })
}

function Spinner() {
  return (
    <div style={{ textAlign: 'center', padding: 60 }}>
      <div style={{
        width: 40, height: 40, border: '3px solid #e2e8f0',
        borderTop: '3px solid #7c3aed', borderRadius: '50%',
        animation: 'spin 0.8s linear infinite', margin: '0 auto 16px',
      }} />
      <div style={{ color: '#64748b', fontSize: 14 }}>AI анализирует данные...</div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

function PeriodSelector({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {[7, 14, 30, 90].map(d => (
        <button
          key={d}
          onClick={() => onChange(d)}
          style={{
            padding: '5px 14px', borderRadius: 20, fontSize: 13, fontWeight: 500,
            border: `1px solid ${value === d ? '#7c3aed' : '#e2e8f0'}`,
            background: value === d ? '#7c3aed' : '#fff',
            color: value === d ? '#fff' : '#374151',
            cursor: 'pointer',
          }}
        >
          {d}д
        </button>
      ))}
    </div>
  )
}

function NotConfigured({ onGoToSettings, isSuperAdmin }) {
  return (
    <div style={{
      background: '#faf5ff', border: '1px dashed #c4b5fd',
      borderRadius: 12, padding: 32, textAlign: 'center', marginTop: 24,
    }}>
      <span className="material-icons" style={{ fontSize: 48, color: '#7c3aed', display: 'block', marginBottom: 12 }}>
        auto_awesome
      </span>
      <div style={{ fontWeight: 700, fontSize: 16, color: '#4c1d95', marginBottom: 8 }}>
        AI не настроен
      </div>
      <div style={{ color: '#6b7280', fontSize: 14, maxWidth: 400, margin: '0 auto' }}>
        Добавьте конфиг провайдера в разделе <strong>Настройки</strong>, чтобы включить AI-аналитику.
      </div>
      {isSuperAdmin && (
        <button
          onClick={onGoToSettings}
          style={{
            marginTop: 16, background: '#7c3aed', color: '#fff',
            border: 'none', borderRadius: 8, padding: '8px 20px',
            cursor: 'pointer', fontSize: 13, fontWeight: 600,
          }}
        >
          Перейти к настройкам
        </button>
      )}
    </div>
  )
}

// ── Инсайты ──────────────────────────────────────────────────────────────────
function InsightsTab({ token, onGoToSettings, isSuperAdmin }) {
  const [days, setDays] = useState(30)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [notConfigured, setNotConfigured] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setErr(''); setNotConfigured(false)
    try {
      const r = await apiFetch(token, `/ai/insights?days=${days}`)
      if (r.status === 501) { setNotConfigured(true); setLoading(false); return }
      if (!r.ok) { const d = await r.json(); setErr(d.detail?.message || d.detail || 'Ошибка AI'); setLoading(false); return }
      setData(await r.json())
    } catch { setErr('Сетевая ошибка') }
    setLoading(false)
  }, [token, days])

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <PeriodSelector value={days} onChange={setDays} />
        <button
          onClick={load}
          disabled={loading}
          style={{
            background: loading ? '#94a3b8' : '#7c3aed', color: '#fff',
            border: 'none', borderRadius: 8, padding: '10px 20px',
            cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 14,
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <span className="material-icons" style={{ fontSize: 16 }}>auto_awesome</span>
          {loading ? 'Анализирую...' : 'Получить инсайты'}
        </button>
      </div>

      {notConfigured && <NotConfigured onGoToSettings={onGoToSettings} isSuperAdmin={isSuperAdmin} />}
      {loading && <Spinner />}
      {err && <div style={{ background: '#fee2e2', color: '#dc2626', padding: '12px 16px', borderRadius: 8 }}>{err}</div>}

      {data && !loading && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
            {[
              { label: 'Направлений', value: data.stats.referrals_total, icon: 'send', color: '#0097A7' },
              { label: 'Подтверждено', value: data.stats.referrals_confirmed, icon: 'check_circle', color: '#16a34a' },
              { label: 'Конверсия', value: `${data.stats.conversion_rate_pct}%`, icon: 'percent', color: '#7c3aed' },
              { label: 'Клиник', value: data.stats.clinic_count, icon: 'local_hospital', color: '#d97706' },
            ].map(s => (
              <div key={s.label} style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="material-icons" style={{ color: s.color, fontSize: 24 }}>{s.icon}</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 20, color: '#1e293b' }}>{s.value}</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>{s.label}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{
            background: 'linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%)',
            border: '1px solid #e9d5ff', borderRadius: 12, padding: 24,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <span className="material-icons" style={{ color: '#7c3aed', fontSize: 20 }}>auto_awesome</span>
              <span style={{ fontWeight: 700, fontSize: 15, color: '#4c1d95' }}>AI-инсайты</span>
              <span style={{ fontSize: 12, color: '#6b7280', marginLeft: 'auto' }}>
                {new Date(data.generated_at).toLocaleString('ru-RU')} · {data.model}
              </span>
            </div>
            <div style={{ fontSize: 14, color: '#1e293b', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
              {data.insights}
            </div>
          </div>
        </div>
      )}

      {!data && !loading && !notConfigured && !err && (
        <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8' }}>
          <span className="material-icons" style={{ fontSize: 48, display: 'block', marginBottom: 12 }}>psychology</span>
          Нажмите «Получить инсайты» для AI-анализа данных клиники
        </div>
      )}
    </div>
  )
}

// ── Отчёт ─────────────────────────────────────────────────────────────────────
function ReportTab({ token, onGoToSettings, isSuperAdmin }) {
  const [days, setDays] = useState(30)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [notConfigured, setNotConfigured] = useState(false)

  const load = async () => {
    setLoading(true); setErr(''); setNotConfigured(false)
    try {
      const r = await apiFetch(token, `/ai/report?days=${days}`)
      if (r.status === 501) { setNotConfigured(true); setLoading(false); return }
      if (!r.ok) { const d = await r.json(); setErr(d.detail?.message || d.detail || 'Ошибка'); setLoading(false); return }
      setData(await r.json())
    } catch { setErr('Сетевая ошибка') }
    setLoading(false)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <PeriodSelector value={days} onChange={setDays} />
        <button
          onClick={load}
          disabled={loading}
          style={{
            background: loading ? '#94a3b8' : '#0097A7', color: '#fff',
            border: 'none', borderRadius: 8, padding: '10px 20px',
            cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 14,
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <span className="material-icons" style={{ fontSize: 16 }}>description</span>
          {loading ? 'Генерирую...' : 'Создать отчёт'}
        </button>
      </div>

      {notConfigured && <NotConfigured onGoToSettings={onGoToSettings} isSuperAdmin={isSuperAdmin} />}
      {loading && <Spinner />}
      {err && <div style={{ background: '#fee2e2', color: '#dc2626', padding: '12px 16px', borderRadius: 8 }}>{err}</div>}

      {data && !loading && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: '#64748b' }}>
              Период: {data.period_start} — {data.period_end} · {data.model}
            </div>
            <button
              onClick={() => {
                const el = document.createElement('a')
                el.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(data.report)
                el.download = `report_${data.period_start}_${data.period_end}.txt`
                el.click()
              }}
              style={{
                background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6,
                padding: '6px 12px', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              <span className="material-icons" style={{ fontSize: 14 }}>download</span>
              Скачать
            </button>
          </div>
          <div style={{
            background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 24,
            fontSize: 14, color: '#1e293b', lineHeight: 1.8, whiteSpace: 'pre-wrap',
          }}>
            {data.report}
          </div>
        </div>
      )}

      {!data && !loading && !notConfigured && !err && (
        <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8' }}>
          <span className="material-icons" style={{ fontSize: 48, display: 'block', marginBottom: 12 }}>article</span>
          Нажмите «Создать отчёт» для генерации за выбранный период
        </div>
      )}
    </div>
  )
}

// ── Спросить AI ───────────────────────────────────────────────────────────────
function AskTab({ token, onGoToSettings, isSuperAdmin }) {
  const [question, setQuestion] = useState('')
  const [days, setDays] = useState(30)
  const [answer, setAnswer] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [notConfigured, setNotConfigured] = useState(false)

  const examples = [
    'Почему упала конверсия направлений?',
    'Какой сотрудник приводит больше всего пациентов?',
    'Как улучшить показатели подтверждения направлений?',
    'Проанализируй эффективность работы клиники',
  ]

  const ask = async () => {
    if (!question.trim()) return
    setLoading(true); setErr(''); setNotConfigured(false)
    try {
      const r = await apiFetch(token, '/ai/ask', { method: 'POST', body: JSON.stringify({ question, days }) })
      if (r.status === 501) { setNotConfigured(true); setLoading(false); return }
      if (!r.ok) { const d = await r.json(); setErr(d.detail?.message || d.detail || 'Ошибка'); setLoading(false); return }
      setAnswer(await r.json())
    } catch { setErr('Сетевая ошибка') }
    setLoading(false)
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>Примеры вопросов:</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {examples.map(ex => (
            <button
              key={ex}
              onClick={() => setQuestion(ex)}
              style={{
                padding: '4px 12px', borderRadius: 16, fontSize: 12,
                border: '1px solid #e2e8f0', background: '#f8fafc',
                color: '#374151', cursor: 'pointer',
              }}
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
        <textarea
          value={question}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) ask() }}
          placeholder="Задайте вопрос по данным клиники... (Ctrl+Enter для отправки)"
          rows={3}
          style={{
            flex: 1, padding: '10px 14px', border: '1px solid #d1d5db', borderRadius: 8,
            fontSize: 14, resize: 'vertical', fontFamily: 'inherit',
          }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <PeriodSelector value={days} onChange={setDays} />
          <button
            onClick={ask}
            disabled={loading || !question.trim()}
            style={{
              background: loading || !question.trim() ? '#94a3b8' : '#7c3aed', color: '#fff',
              border: 'none', borderRadius: 8, padding: '10px 20px',
              cursor: loading || !question.trim() ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 14,
            }}
          >
            {loading ? '...' : 'Спросить'}
          </button>
        </div>
      </div>

      {notConfigured && <NotConfigured onGoToSettings={onGoToSettings} isSuperAdmin={isSuperAdmin} />}
      {loading && <Spinner />}
      {err && <div style={{ background: '#fee2e2', color: '#dc2626', padding: '12px 16px', borderRadius: 8 }}>{err}</div>}

      {answer && !loading && (
        <div style={{ background: '#faf5ff', border: '1px solid #e9d5ff', borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 12, color: '#7c3aed', fontWeight: 600, marginBottom: 8 }}>
            Вопрос: {answer.question}
          </div>
          <div style={{ fontSize: 14, color: '#1e293b', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
            {answer.answer}
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 12 }}>
            {new Date(answer.generated_at).toLocaleString('ru-RU')} · {answer.model}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Настройки (super_admin) ───────────────────────────────────────────────────
function SettingsTab({ token }) {
  const [rawJson, setRawJson] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
  const [models, setModels] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [jsonErr, setJsonErr] = useState('')

  useEffect(() => {
    let mounted = true
    apiFetch(token, '/ai/config').then(async r => {
      if (!mounted) return
      if (r.ok) {
        const d = await r.json()
        if (d.config && Object.keys(d.config).length > 0) {
          const display = { ...d.config }
          delete display._meta
          setRawJson(JSON.stringify(display, null, 2))
        }
      }
    }).catch(() => {})

    apiFetch(token, '/ai/models').then(async r => {
      if (!mounted) return
      if (r.ok) {
        const d = await r.json()
        setModels(d.models || [])
        if (d.selected) setSelectedModel(d.selected)
      }
    }).catch(() => {}).finally(() => { if (mounted) setLoading(false) })

    return () => { mounted = false }
  }, [token])

  const handleJsonChange = (val) => {
    setRawJson(val)
    setJsonErr('')
    if (val.trim()) {
      try { JSON.parse(val) } catch (e) { setJsonErr(e.message) }
    }
  }

  const save = async () => {
    setJsonErr('')
    let parsed
    try { parsed = JSON.parse(rawJson) } catch (e) { setJsonErr(e.message); return }
    setSaving(true); setMsg(null)
    try {
      const r = await apiFetch(token, '/ai/config', {
        method: 'POST',
        body: JSON.stringify({ config: parsed, selected_model: selectedModel || null }),
      })
      if (r.ok) {
        setMsg({ type: 'ok', text: 'Конфиг сохранён успешно.' })
        const mr = await apiFetch(token, '/ai/models')
        if (mr.ok) {
          const md = await mr.json()
          setModels(md.models || [])
          if (md.selected && !selectedModel) setSelectedModel(md.selected)
        }
      } else {
        const d = await r.json()
        setMsg({ type: 'err', text: d.detail || 'Ошибка сохранения' })
      }
    } catch { setMsg({ type: 'err', text: 'Сетевая ошибка' }) }
    setSaving(false)
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Загрузка...</div>

  return (
    <div style={{ maxWidth: 800 }}>
      <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 10, padding: '14px 18px', marginBottom: 24, fontSize: 13, color: '#0369a1' }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Как настроить AI-провайдера</div>
        Вставьте JSON-конфиг в формате opencode.ai (поле <code>provider</code> с <code>baseURL</code>, <code>apiKey</code> и <code>models</code>).
        Выберите активную модель. Конфиг сохраняется на сервере и применяется ко всем AI-запросам.
      </div>

      <div style={{ marginBottom: 20 }}>
        <label style={{ display: 'block', fontWeight: 600, fontSize: 13, color: '#374151', marginBottom: 8 }}>
          JSON-конфиг провайдера
        </label>
        <textarea
          value={rawJson}
          onChange={e => handleJsonChange(e.target.value)}
          placeholder={'{\n  "provider": {\n    "openai": {\n      "options": {\n        "baseURL": "https://...",\n        "apiKey": "sk-..."\n      },\n      "models": { ... }\n    }\n  }\n}'}
          rows={20}
          style={{
            width: '100%', padding: '12px 14px', border: `1px solid ${jsonErr ? '#ef4444' : '#d1d5db'}`,
            borderRadius: 8, fontSize: 12, fontFamily: 'monospace', resize: 'vertical',
            background: '#fafafa', lineHeight: 1.6, boxSizing: 'border-box',
          }}
        />
        {jsonErr && <div style={{ color: '#dc2626', fontSize: 12, marginTop: 4 }}>Ошибка JSON: {jsonErr}</div>}
      </div>

      {models.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <label style={{ display: 'block', fontWeight: 600, fontSize: 13, color: '#374151', marginBottom: 8 }}>
            Активная модель
          </label>
          <select
            value={selectedModel}
            onChange={e => setSelectedModel(e.target.value)}
            style={{ padding: '10px 14px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, background: '#fff', cursor: 'pointer', minWidth: 320 }}
          >
            {models.map(m => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.id}){m.context ? ` · ${(m.context / 1000).toFixed(0)}k ctx` : ''}
              </option>
            ))}
          </select>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
            Выбранная модель используется для всех AI-запросов.
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <button
          onClick={save}
          disabled={saving || !!jsonErr || !rawJson.trim()}
          style={{
            background: saving || !!jsonErr || !rawJson.trim() ? '#94a3b8' : '#7c3aed',
            color: '#fff', border: 'none', borderRadius: 8, padding: '10px 28px',
            cursor: saving || !!jsonErr || !rawJson.trim() ? 'not-allowed' : 'pointer',
            fontWeight: 700, fontSize: 14,
          }}
        >
          {saving ? 'Сохраняю...' : 'Сохранить конфиг'}
        </button>
        <button
          onClick={() => { setRawJson(''); setJsonErr(''); setModels([]); setSelectedModel('') }}
          style={{ background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
        >
          Очистить
        </button>
      </div>

      {msg && (
        <div style={{
          marginTop: 16, padding: '12px 16px', borderRadius: 8,
          background: msg.type === 'ok' ? '#dcfce7' : '#fee2e2',
          color: msg.type === 'ok' ? '#166534' : '#dc2626',
          fontSize: 13, fontWeight: 500,
        }}>
          {msg.type === 'ok' ? '✓ ' : '✗ '}{msg.text}
        </div>
      )}

      {models.length > 0 && (
        <div style={{ marginTop: 24, padding: '14px 18px', background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0' }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: '#374151', marginBottom: 8 }}>
            Доступные модели ({models.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {models.map(m => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                <span className="material-icons" style={{ fontSize: 16, color: m.id === selectedModel ? '#7c3aed' : '#94a3b8' }}>
                  {m.id === selectedModel ? 'radio_button_checked' : 'radio_button_unchecked'}
                </span>
                <span style={{ fontWeight: m.id === selectedModel ? 700 : 400, color: m.id === selectedModel ? '#4c1d95' : '#374151' }}>
                  {m.name}
                </span>
                <span style={{ color: '#94a3b8', fontSize: 11 }}>{m.id}</span>
                {m.context && (
                  <span style={{ fontSize: 11, color: '#64748b', background: '#f1f5f9', padding: '1px 6px', borderRadius: 8 }}>
                    ctx {(m.context / 1000).toFixed(0)}k
                  </span>
                )}
                {m.output && (
                  <span style={{ fontSize: 11, color: '#64748b', background: '#f1f5f9', padding: '1px 6px', borderRadius: 8 }}>
                    out {(m.output / 1000).toFixed(0)}k
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Главный компонент ─────────────────────────────────────────────────────────
export default function AISection({ token, isSuperAdmin }) {
  const [tab, setTab] = useState('insights')
  const [modelInfo, setModelInfo] = useState(null)

  useEffect(() => {
    apiFetch(token, '/ai/models')
      .then(async r => { if (r.ok) { const d = await r.json(); setModelInfo(d) } })
      .catch(() => {})
  }, [token])

  const goToSettings = () => setTab('settings')

  const tabs = [
    { key: 'insights', label: 'Инсайты',    icon: 'auto_awesome' },
    { key: 'report',   label: 'Отчёт',      icon: 'description' },
    { key: 'ask',      label: 'Спросить AI', icon: 'psychology' },
    ...(isSuperAdmin ? [{ key: 'settings', label: 'Настройки', icon: 'settings' }] : []),
  ]

  const providerBadge = modelInfo?.provider
    ? { label: modelInfo.provider.toUpperCase(), color: '#7c3aed', bg: '#ede9fe' }
    : { label: 'НЕ НАСТРОЕН', color: '#dc2626', bg: '#fee2e2' }

  return (
    <div style={{ padding: '24px', maxWidth: 960, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span className="material-icons" style={{ color: '#7c3aed', fontSize: 28 }}>auto_awesome</span>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>AI-аналитика</h2>
          <span style={{
            background: providerBadge.bg, color: providerBadge.color, fontSize: 11, fontWeight: 700,
            padding: '2px 8px', borderRadius: 10, letterSpacing: '0.05em',
          }}>
            {providerBadge.label}
          </span>
          {modelInfo?.selected && (
            <span style={{ background: '#f0fdf4', color: '#166534', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10 }}>
              {modelInfo.models?.find(m => m.id === modelInfo.selected)?.name || modelInfo.selected}
            </span>
          )}
        </div>
        <p style={{ margin: 0, color: '#64748b', fontSize: 13 }}>
          Интеллектуальный анализ данных клиники через OpenAI-compatible API
        </p>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '2px solid #f1f5f9', paddingBottom: 0 }}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '10px 20px', border: 'none', background: 'none', cursor: 'pointer',
              borderBottom: tab === t.key ? '2px solid #7c3aed' : '2px solid transparent',
              color: tab === t.key ? '#7c3aed' : '#64748b',
              fontWeight: tab === t.key ? 700 : 500, fontSize: 14, marginBottom: -2,
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <span className="material-icons" style={{ fontSize: 16 }}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'insights' && <InsightsTab token={token} onGoToSettings={goToSettings} isSuperAdmin={isSuperAdmin} />}
      {tab === 'report'   && <ReportTab   token={token} onGoToSettings={goToSettings} isSuperAdmin={isSuperAdmin} />}
      {tab === 'ask'      && <AskTab      token={token} onGoToSettings={goToSettings} isSuperAdmin={isSuperAdmin} />}
      {tab === 'settings' && isSuperAdmin && <SettingsTab token={token} />}
    </div>
  )
}
