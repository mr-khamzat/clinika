/**
 * AdsSection — управление рекламными объявлениями.
 * Создание, активация, статистика (impressions/clicks/conversions).
 */
import { useState, useEffect, useCallback } from 'react'
import { API_BASE } from '../config'

const API = API_BASE

function apiFetch(token, path, opts = {}) {
  return fetch(API + path, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  })
}

const STATUS_LABELS = {
  draft: 'Черновик',
  active: 'Активно',
  paused: 'Пауза',
  completed: 'Завершено',
  cancelled: 'Отменено',
}

const STATUS_COLORS = {
  draft: '#64748b',
  active: '#16a34a',
  paused: '#d97706',
  completed: '#0097A7',
  cancelled: '#dc2626',
}

const PRICING_LABELS = {
  flat: 'Фиксированная',
  cpc: 'За клик (CPC)',
  cpm: 'За 1000 показов (CPM)',
}

const TYPE_LABELS = {
  banner: 'Баннер',
  interstitial: 'Промежуточный',
  native: 'Нативный',
}

function Badge({ status }) {
  return (
    <span style={{
      background: STATUS_COLORS[status] + '22',
      color: STATUS_COLORS[status],
      border: `1px solid ${STATUS_COLORS[status]}44`,
      padding: '2px 8px',
      borderRadius: 12,
      fontSize: 12,
      fontWeight: 600,
    }}>
      {STATUS_LABELS[status] || status}
    </span>
  )
}

function StatCard({ label, value, icon, color = '#0097A7' }) {
  return (
    <div style={{
      background: '#fff',
      borderRadius: 12,
      padding: '16px 20px',
      border: '1px solid #e2e8f0',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
    }}>
      <span className="material-icons" style={{ color, fontSize: 28 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#1e293b' }}>{value}</div>
        <div style={{ fontSize: 12, color: '#64748b' }}>{label}</div>
      </div>
    </div>
  )
}

const EMPTY_FORM = {
  title: '',
  body: '',
  image_url: '',
  link: '',
  ad_type: 'banner',
  pricing_model: 'flat',
  start_date: new Date().toISOString().slice(0, 10),
  end_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  price: '',
  impressions_limit: '',
  clicks_limit: '',
}

export default function AdsSection({ token }) {
  const [ads, setAds] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [selected, setSelected] = useState(null)
  const [updatingStatus, setUpdatingStatus] = useState(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = filterStatus ? `?status=${filterStatus}` : ''
      const r = await apiFetch(token, `/ads${params}`)
      if (r.ok) setAds(await r.json())
      else setErr('Ошибка загрузки')
    } catch { setErr('Сетевая ошибка') }
    setLoading(false)
  }, [token, filterStatus])

  useEffect(() => { load() }, [load])

  const resetForm = () => { setForm(EMPTY_FORM); setErr('') }

  const save = async () => {
    if (!form.title.trim()) { setErr('Укажите заголовок'); return }
    if (!form.price || isNaN(Number(form.price))) { setErr('Укажите стоимость'); return }
    if (!form.start_date || !form.end_date) { setErr('Укажите даты'); return }
    setSaving(true); setErr('')
    try {
      const payload = {
        title: form.title.trim(),
        body: form.body.trim() || null,
        image_url: form.image_url.trim() || null,
        link: form.link.trim() || null,
        ad_type: form.ad_type,
        pricing_model: form.pricing_model,
        start_date: form.start_date,
        end_date: form.end_date,
        price: Number(form.price),
        impressions_limit: form.impressions_limit ? Number(form.impressions_limit) : null,
        clicks_limit: form.clicks_limit ? Number(form.clicks_limit) : null,
      }
      const r = await apiFetch(token, '/ads', { method: 'POST', body: JSON.stringify(payload) })
      if (r.ok) {
        setShowCreate(false)
        resetForm()
        load()
      } else {
        const d = await r.json()
        setErr(d.detail?.message || d.detail || 'Ошибка создания')
      }
    } catch { setErr('Сетевая ошибка') }
    setSaving(false)
  }

  const updateStatus = async (ad, status) => {
    setUpdatingStatus(ad.id)
    try {
      const r = await apiFetch(token, `/ads/${ad.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      })
      if (r.ok) load()
    } catch {}
    setUpdatingStatus(null)
  }

  // Агрегированная статистика
  const totalImpressions = ads.reduce((s, a) => s + (a.impressions_count || 0), 0)
  const totalClicks = ads.reduce((s, a) => s + (a.clicks_count || 0), 0)
  const totalConversions = ads.reduce((s, a) => s + (a.conversions_count || 0), 0)
  const activeCount = ads.filter(a => a.status === 'active').length
  const ctr = totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) : '0.00'

  const selectedAd = ads.find(a => a.id === selected)

  return (
    <div style={{ padding: '24px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Заголовок */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Рекламные объявления</h2>
          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 13 }}>
            Управление баннерами и объявлениями для пациентов
          </p>
        </div>
        <button
          onClick={() => { setShowCreate(true); resetForm() }}
          style={{
            background: '#0097A7', color: '#fff', border: 'none', borderRadius: 8,
            padding: '10px 20px', cursor: 'pointer', fontWeight: 600, fontSize: 14,
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <span className="material-icons" style={{ fontSize: 18 }}>add</span>
          Создать объявление
        </button>
      </div>

      {/* Статистика */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 24 }}>
        <StatCard label="Активных" value={activeCount} icon="campaign" color="#16a34a" />
        <StatCard label="Показов" value={totalImpressions.toLocaleString('ru')} icon="visibility" color="#0097A7" />
        <StatCard label="Кликов" value={totalClicks.toLocaleString('ru')} icon="ads_click" color="#7c3aed" />
        <StatCard label="Конверсий" value={totalConversions.toLocaleString('ru')} icon="flag" color="#d97706" />
        <StatCard label="CTR" value={`${ctr}%`} icon="percent" color="#dc2626" />
      </div>

      {/* Фильтр по статусу */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {['', 'active', 'draft', 'paused', 'completed', 'cancelled'].map(s => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            style={{
              padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 500,
              border: `1px solid ${filterStatus === s ? '#0097A7' : '#e2e8f0'}`,
              background: filterStatus === s ? '#0097A7' : '#fff',
              color: filterStatus === s ? '#fff' : '#374151',
              cursor: 'pointer',
            }}
          >
            {s ? STATUS_LABELS[s] : 'Все'}
          </button>
        ))}
      </div>

      {err && <div style={{ background: '#fee2e2', color: '#dc2626', padding: '10px 16px', borderRadius: 8, marginBottom: 16 }}>{err}</div>}

      {/* Список объявлений */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>Загрузка...</div>
      ) : ads.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: 60, background: '#f8fafc',
          borderRadius: 12, border: '2px dashed #e2e8f0',
        }}>
          <span className="material-icons" style={{ fontSize: 48, color: '#cbd5e1', display: 'block', marginBottom: 12 }}>campaign</span>
          <div style={{ color: '#64748b', fontWeight: 600 }}>Объявлений нет</div>
          <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 4 }}>Создайте первое объявление</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {ads.map(ad => (
            <div
              key={ad.id}
              onClick={() => setSelected(selected === ad.id ? null : ad.id)}
              style={{
                background: '#fff', border: `1px solid ${selected === ad.id ? '#0097A7' : '#e2e8f0'}`,
                borderRadius: 12, padding: '16px 20px', cursor: 'pointer',
                boxShadow: selected === ad.id ? '0 0 0 2px #0097A740' : 'none',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>{ad.title}</span>
                    <Badge status={ad.status} />
                    <span style={{ fontSize: 12, color: '#64748b', background: '#f1f5f9', padding: '2px 8px', borderRadius: 10 }}>
                      {TYPE_LABELS[ad.ad_type] || ad.ad_type}
                    </span>
                    <span style={{ fontSize: 12, color: '#7c3aed', background: '#f3f0ff', padding: '2px 8px', borderRadius: 10 }}>
                      {PRICING_LABELS[ad.pricing_model] || ad.pricing_model}
                    </span>
                  </div>
                  {ad.body && <div style={{ fontSize: 13, color: '#475569', marginBottom: 8 }}>{ad.body}</div>}
                  <div style={{ display: 'flex', gap: 20, fontSize: 13, color: '#64748b' }}>
                    <span>📅 {ad.start_date} — {ad.end_date}</span>
                    <span>💰 {Number(ad.price).toLocaleString('ru')} ₽</span>
                    <span>👁 {(ad.impressions_count || 0).toLocaleString('ru')} показов</span>
                    <span>🖱 {(ad.clicks_count || 0).toLocaleString('ru')} кликов</span>
                    <span>🎯 {(ad.conversions_count || 0).toLocaleString('ru')} конверсий</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginLeft: 16 }}>
                  {ad.status === 'draft' && (
                    <button
                      onClick={e => { e.stopPropagation(); updateStatus(ad, 'active') }}
                      disabled={updatingStatus === ad.id}
                      style={{
                        background: '#16a34a', color: '#fff', border: 'none',
                        borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                      }}
                    >
                      Активировать
                    </button>
                  )}
                  {ad.status === 'active' && (
                    <button
                      onClick={e => { e.stopPropagation(); updateStatus(ad, 'paused') }}
                      disabled={updatingStatus === ad.id}
                      style={{
                        background: '#d97706', color: '#fff', border: 'none',
                        borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                      }}
                    >
                      Пауза
                    </button>
                  )}
                  {ad.status === 'paused' && (
                    <button
                      onClick={e => { e.stopPropagation(); updateStatus(ad, 'active') }}
                      disabled={updatingStatus === ad.id}
                      style={{
                        background: '#16a34a', color: '#fff', border: 'none',
                        borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                      }}
                    >
                      Возобновить
                    </button>
                  )}
                  {!['cancelled', 'completed'].includes(ad.status) && (
                    <button
                      onClick={e => { e.stopPropagation(); updateStatus(ad, 'cancelled') }}
                      disabled={updatingStatus === ad.id}
                      style={{
                        background: '#fee2e2', color: '#dc2626', border: '1px solid #fca5a5',
                        borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                      }}
                    >
                      Отменить
                    </button>
                  )}
                </div>
              </div>

              {/* Расширенный просмотр */}
              {selected === ad.id && (
                <div style={{ marginTop: 16, borderTop: '1px solid #f1f5f9', paddingTop: 16 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
                    {/* CTR */}
                    <div style={{ background: '#f8fafc', borderRadius: 8, padding: 16 }}>
                      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>CTR (кликов/показов)</div>
                      <div style={{ fontSize: 24, fontWeight: 700 }}>
                        {ad.impressions_count > 0
                          ? ((ad.clicks_count / ad.impressions_count) * 100).toFixed(2)
                          : '0.00'}%
                      </div>
                    </div>
                    {/* Лимиты */}
                    <div style={{ background: '#f8fafc', borderRadius: 8, padding: 16 }}>
                      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Лимиты</div>
                      <div style={{ fontSize: 14 }}>
                        {ad.impressions_limit
                          ? <div>Показов: {(ad.impressions_count || 0)}/{ad.impressions_limit}</div>
                          : <div style={{ color: '#94a3b8' }}>Без лимита показов</div>}
                        {ad.clicks_limit
                          ? <div>Кликов: {(ad.clicks_count || 0)}/{ad.clicks_limit}</div>
                          : <div style={{ color: '#94a3b8' }}>Без лимита кликов</div>}
                      </div>
                    </div>
                    {/* Ссылки */}
                    <div style={{ background: '#f8fafc', borderRadius: 8, padding: 16 }}>
                      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Ссылка</div>
                      {ad.link
                        ? <a href={ad.link} target="_blank" rel="noopener noreferrer"
                            style={{ color: '#0097A7', fontSize: 13, wordBreak: 'break-all' }}
                            onClick={e => e.stopPropagation()}>
                            {ad.link}
                          </a>
                        : <span style={{ color: '#94a3b8', fontSize: 13 }}>Не указана</span>}
                      {ad.image_url && (
                        <div style={{ marginTop: 8 }}>
                          <a href={ad.image_url} target="_blank" rel="noopener noreferrer"
                            style={{ color: '#0097A7', fontSize: 12 }}
                            onClick={e => e.stopPropagation()}>
                            Изображение
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Модал создания */}
      {showCreate && (
        <div style={{
          position: 'fixed', inset: 0, background: '#00000066', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={() => setShowCreate(false)}>
          <div style={{
            background: '#fff', borderRadius: 16, padding: 28, width: 600, maxHeight: '90vh',
            overflowY: 'auto', boxShadow: '0 20px 60px #0003',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Новое объявление</h3>
              <button onClick={() => setShowCreate(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#64748b' }}>✕</button>
            </div>

            {err && <div style={{ background: '#fee2e2', color: '#dc2626', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>{err}</div>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
                Заголовок *
                <input
                  value={form.title}
                  onChange={e => set('title', e.target.value)}
                  placeholder="Акция: скидка 20% на МРТ"
                  style={{ display: 'block', width: '100%', marginTop: 6, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
                />
              </label>

              <label style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
                Текст объявления
                <textarea
                  value={form.body}
                  onChange={e => set('body', e.target.value)}
                  placeholder="Подробное описание акции или услуги..."
                  rows={3}
                  style={{ display: 'block', width: '100%', marginTop: 6, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, boxSizing: 'border-box', resize: 'vertical' }}
                />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
                  URL изображения
                  <input
                    value={form.image_url}
                    onChange={e => set('image_url', e.target.value)}
                    placeholder="https://..."
                    style={{ display: 'block', width: '100%', marginTop: 6, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
                  />
                </label>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
                  Ссылка при клике
                  <input
                    value={form.link}
                    onChange={e => set('link', e.target.value)}
                    placeholder="https://..."
                    style={{ display: 'block', width: '100%', marginTop: 6, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
                  />
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
                  Тип
                  <select value={form.ad_type} onChange={e => set('ad_type', e.target.value)}
                    style={{ display: 'block', width: '100%', marginTop: 6, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14 }}>
                    <option value="banner">Баннер</option>
                    <option value="interstitial">Промежуточный</option>
                    <option value="native">Нативный</option>
                  </select>
                </label>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
                  Модель оплаты
                  <select value={form.pricing_model} onChange={e => set('pricing_model', e.target.value)}
                    style={{ display: 'block', width: '100%', marginTop: 6, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14 }}>
                    <option value="flat">Фиксированная</option>
                    <option value="cpc">За клик (CPC)</option>
                    <option value="cpm">За 1000 показов (CPM)</option>
                  </select>
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
                  Дата начала *
                  <input type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)}
                    style={{ display: 'block', width: '100%', marginTop: 6, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
                </label>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
                  Дата окончания *
                  <input type="date" value={form.end_date} onChange={e => set('end_date', e.target.value)}
                    style={{ display: 'block', width: '100%', marginTop: 6, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
                </label>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
                  Стоимость, ₽ *
                  <input type="number" value={form.price} onChange={e => set('price', e.target.value)}
                    placeholder="9900"
                    style={{ display: 'block', width: '100%', marginTop: 6, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
                  Лимит показов (необяз.)
                  <input type="number" value={form.impressions_limit} onChange={e => set('impressions_limit', e.target.value)}
                    placeholder="Без лимита"
                    style={{ display: 'block', width: '100%', marginTop: 6, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
                </label>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
                  Лимит кликов (необяз.)
                  <input type="number" value={form.clicks_limit} onChange={e => set('clicks_limit', e.target.value)}
                    placeholder="Без лимита"
                    style={{ display: 'block', width: '100%', marginTop: 6, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
                </label>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
              <button onClick={() => setShowCreate(false)} style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 14 }}>
                Отмена
              </button>
              <button
                onClick={save}
                disabled={saving}
                style={{
                  padding: '10px 24px', borderRadius: 8, border: 'none',
                  background: saving ? '#94a3b8' : '#0097A7', color: '#fff',
                  cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 14,
                }}
              >
                {saving ? 'Создание...' : 'Создать объявление'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
