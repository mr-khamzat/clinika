/**
 * ====================================================================
 * БЛОК: SignupWizard — публичный мастер регистрации франшизы (Глава 2)
 * ====================================================================
 * 5 шагов:
 *   1. Контакты    — email + ФИО + телефон
 *   2. Франшиза    — название + slug (с live-проверкой)
 *   3. Клиники     — 1..10 клиник (название + адрес + телефон)
 *   4. Модули      — checkbox-список из /marketplace/modules
 *   5. Тариф       — trial | starter | pro + финальный review
 *   OTP-модалка    — после Шага 5, 6-значный код + resend через 60 сек
 *   Финал          — «Готово, проверьте email» + кнопка «Войти»
 *
 * UX:
 *   • Прогресс-бар сверху (1..5)
 *   • Inline-валидация в реальном времени
 *   • Slug preview: https://клиниксеть.рф/lor/admin
 *   • Mobile-responsive
 *   • Loading-state для async-операций
 *   • Toast'ы через useToast
 * ====================================================================
 */
import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { API_BASE } from '../config'
import { useToast } from '../design/components/ToastContext'
import './SignupWizard.css'

const TOTAL = 5
const SIGNUP_API = axios.create({ baseURL: API_BASE })

// ─── Дефолтный шаблон новой клиники для шага 3 ──────────────────────────
const EMPTY_CLINIC = { name: '', address: '', phone: '', city: '' }

// ─── Список тарифов (UI-мета) ──────────────────────────────────────────
const PLANS = [
  {
    key: 'trial',
    title: 'Триал',
    price: '0 ₽',
    note: '14 дней бесплатно',
    features: ['До 3 клиник', '20 пользователей', 'Поддержка email'],
    highlight: false,
  },
  {
    key: 'starter',
    title: 'Стартер',
    price: '12 900 ₽/мес',
    note: 'после триала',
    features: ['До 5 клиник', '50 пользователей', 'Все базовые модули'],
    highlight: true,
  },
  {
    key: 'pro',
    title: 'Профессиональный',
    price: '29 900 ₽/мес',
    note: 'для сетей',
    features: ['До 20 клиник', '200 пользователей', 'White-Label, API'],
    highlight: false,
  },
]

// ─── Валидаторы ────────────────────────────────────────────────────────
const SLUG_RE = /^[a-z0-9-]{3,20}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function SignupWizard() {
  const { toast } = useToast()

  // ────────── состояние шагов ──────────
  const [step, setStep] = useState(1)

  // Шаг 1
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')

  // Шаг 2
  const [franchiseName, setFranchiseName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugCheck, setSlugCheck] = useState({ state: 'idle', reason: null })

  // Шаг 3
  const [clinics, setClinics] = useState([{ ...EMPTY_CLINIC }])

  // Шаг 4
  const [catalog, setCatalog] = useState([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [modules, setModules] = useState([])  // массив key

  // Шаг 5
  const [plan, setPlan] = useState('trial')

  // OTP
  const [requestId, setRequestId] = useState(null)
  const [otp, setOtp] = useState('')
  const [otpStage, setOtpStage] = useState('hidden')   // 'hidden'|'open'|'verified'
  const [resendCooldown, setResendCooldown] = useState(0)

  // Глобальный лоадинг (start / verify / complete)
  const [busy, setBusy] = useState(false)

  // Финал
  const [final, setFinal] = useState(null)            // { tenant_slug, login_url, ... }

  // ────────── загружаем каталог модулей при входе на шаг 4 ──────────
  useEffect(() => {
    if (step === 4 && !catalog.length && !catalogLoading) {
      setCatalogLoading(true)
      SIGNUP_API.get('/marketplace/modules')
        .then(r => { setCatalog(Array.isArray(r.data) ? r.data : []) })
        .catch(() => { setCatalog([]); toast('Не удалось загрузить каталог модулей', 'warn') })
        .finally(() => setCatalogLoading(false))
    }
  }, [step])   // eslint-disable-line react-hooks/exhaustive-deps

  // ────────── slug live-check (с debounce) ──────────
  useEffect(() => {
    const s = (slug || '').trim().toLowerCase()
    if (!s) { setSlugCheck({ state: 'idle', reason: null }); return }
    if (!SLUG_RE.test(s)) {
      setSlugCheck({ state: 'invalid', reason: 'Только латиница, цифры и дефис, 3–20 символов' })
      return
    }
    setSlugCheck({ state: 'checking', reason: null })
    const handle = setTimeout(() => {
      SIGNUP_API.post('/signup/check-slug', { slug: s })
        .then(r => {
          if (r.data?.available) setSlugCheck({ state: 'available', reason: null })
          else setSlugCheck({ state: 'taken', reason: r.data?.reason || 'Занято' })
        })
        .catch(() => setSlugCheck({ state: 'error', reason: 'Ошибка проверки' }))
    }, 400)
    return () => clearTimeout(handle)
  }, [slug])

  // ────────── resend cooldown таймер ──────────
  useEffect(() => {
    if (resendCooldown <= 0) return
    const t = setTimeout(() => setResendCooldown(v => Math.max(0, v - 1)), 1000)
    return () => clearTimeout(t)
  }, [resendCooldown])

  // ────────── валидаторы шагов ──────────
  const validStep1 = EMAIL_RE.test(email.trim()) && fullName.trim().length >= 2
  const validStep2 = franchiseName.trim().length >= 2 && slugCheck.state === 'available'
  const validStep3 =
    clinics.length >= 1 &&
    clinics.length <= 10 &&
    clinics.every(c => (c.name || '').trim().length >= 2)
  const validStep4 = true   // модули необязательны
  const validStep5 = !!plan

  const canNext = (
    (step === 1 && validStep1) ||
    (step === 2 && validStep2) ||
    (step === 3 && validStep3) ||
    (step === 4 && validStep4) ||
    (step === 5 && validStep5)
  )

  // ────────── навигация ──────────
  function next() {
    if (!canNext) return
    if (step === 5) return doStart()
    setStep(s => Math.min(TOTAL, s + 1))
  }
  function prev() { setStep(s => Math.max(1, s - 1)) }

  // ────────── шаг 3: операции над клиниками ──────────
  function addClinic() {
    if (clinics.length >= 10) return
    setClinics(arr => [...arr, { ...EMPTY_CLINIC }])
  }
  function removeClinic(i) {
    if (clinics.length === 1) return
    setClinics(arr => arr.filter((_, idx) => idx !== i))
  }
  function updateClinic(i, key, value) {
    setClinics(arr => arr.map((c, idx) => idx === i ? { ...c, [key]: value } : c))
  }

  // ────────── /signup/start ──────────
  async function doStart() {
    setBusy(true)
    try {
      const body = {
        email: email.trim().toLowerCase(),
        full_name: fullName.trim(),
        phone: phone.trim() || null,
        franchise_name: franchiseName.trim(),
        tenant_slug: slug.trim().toLowerCase(),
        clinics: clinics.map(c => ({
          name: c.name.trim(),
          address: c.address?.trim() || null,
          phone: c.phone?.trim() || null,
          city: c.city?.trim() || null,
        })),
        modules,
        plan,
      }
      const r = await SIGNUP_API.post('/signup/start', body)
      setRequestId(r.data?.request_id)
      setOtpStage('open')
      setResendCooldown(60)
      toast('Код отправлен на email. Проверьте почту.', 'success')
    } catch (e) {
      const detail = e?.response?.data?.detail || 'Ошибка регистрации'
      toast(detail, 'error', 6000)
    } finally {
      setBusy(false)
    }
  }

  // ────────── /signup/verify ──────────
  async function doVerify() {
    if (!otp || otp.length < 4) return
    setBusy(true)
    try {
      await SIGNUP_API.post('/signup/verify', { request_id: requestId, code: otp.trim() })
      setOtpStage('verified')
      await doComplete()
    } catch (e) {
      const detail = e?.response?.data?.detail || 'Неверный код'
      toast(detail, 'error', 5000)
    } finally {
      setBusy(false)
    }
  }

  // ────────── /signup/complete ──────────
  async function doComplete() {
    setBusy(true)
    try {
      const r = await SIGNUP_API.post('/signup/complete', { request_id: requestId })
      setFinal(r.data)
      setOtpStage('hidden')
    } catch (e) {
      const detail = e?.response?.data?.detail || 'Не удалось завершить регистрацию'
      toast(detail, 'error', 6000)
    } finally {
      setBusy(false)
    }
  }

  // ────────── /signup/resend ──────────
  async function doResend() {
    if (resendCooldown > 0 || !requestId) return
    setBusy(true)
    try {
      await SIGNUP_API.post('/signup/resend', { request_id: requestId })
      toast('Новый код отправлен', 'success')
      setResendCooldown(60)
      setOtp('')
    } catch (e) {
      toast(e?.response?.data?.detail || 'Ошибка', 'error')
    } finally {
      setBusy(false)
    }
  }

  // ────────── финальный экран ──────────
  if (final) {
    return (
      <div className="sw-wrap">
        <div className="sw-card sw-final">
          <div className="sw-check-circle">&#10003;</div>
          <h1>Готово!</h1>
          <p>Ваша франшиза <b>{franchiseName}</b> успешно создана.</p>
          <p className="sw-muted">Письмо с реквизитами входа отправлено на <b>{email}</b>. Если не пришло — проверьте «Спам».</p>
          <div className="sw-final-summary">
            <div><span className="sw-muted">URL кабинета:</span><br/><a href={final.login_url}>{final.login_url}</a></div>
            <div><span className="sw-muted">Тариф:</span> {final.plan} · триал до {final.trial_until}</div>
          </div>
          <a className="sw-btn sw-btn-primary sw-btn-lg" href={final.login_url}>Войти в кабинет &rarr;</a>
          <a className="sw-link" href="/">Вернуться на главную</a>
        </div>
      </div>
    )
  }

  // ────────── OTP modal ──────────
  const otpModal = otpStage === 'open' && (
    <div className="sw-modal-backdrop">
      <div className="sw-modal">
        <h3>Подтверждение email</h3>
        <p className="sw-muted">Мы отправили 6-значный код на <b>{email}</b>. Введите его, чтобы завершить регистрацию.</p>
        <input
          type="text"
          inputMode="numeric"
          autoFocus
          maxLength={6}
          className="sw-otp-input"
          placeholder="000000"
          value={otp}
          onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
        />
        <button
          className="sw-btn sw-btn-primary sw-btn-lg"
          onClick={doVerify}
          disabled={busy || otp.length < 4}
        >
          {busy ? 'Проверяем…' : 'Подтвердить'}
        </button>
        <div className="sw-resend-row">
          {resendCooldown > 0 ? (
            <span className="sw-muted">Получить новый код через {resendCooldown} сек</span>
          ) : (
            <button className="sw-link" type="button" onClick={doResend} disabled={busy}>
              Получить новый код
            </button>
          )}
        </div>
        <button className="sw-link sw-muted" type="button" onClick={() => setOtpStage('hidden')}>
          Отмена
        </button>
      </div>
    </div>
  )

  // ────────── Header + Progress ──────────
  return (
    <div className="sw-wrap">
      <a href="/" className="sw-back-home">&larr; На главную</a>

      <div className="sw-progress">
        {Array.from({ length: TOTAL }, (_, i) => {
          const n = i + 1
          const cls = step > n ? 'done' : step === n ? 'active' : 'pending'
          return (
            <div key={n} className={`sw-step-dot ${cls}`}>
              <div className="sw-dot-circle">{step > n ? '✓' : n}</div>
              <div className="sw-dot-label">{['Контакты','Франшиза','Клиники','Модули','Тариф'][i]}</div>
            </div>
          )
        })}
      </div>

      <div className="sw-card">
        {step === 1 && <Step1 {...{ email, setEmail, fullName, setFullName, phone, setPhone }} />}
        {step === 2 && <Step2 {...{ franchiseName, setFranchiseName, slug, setSlug, slugCheck }} />}
        {step === 3 && <Step3 {...{ clinics, addClinic, removeClinic, updateClinic }} />}
        {step === 4 && <Step4 {...{ catalog, catalogLoading, modules, setModules }} />}
        {step === 5 && <Step5 {...{ plan, setPlan, email, fullName, phone, franchiseName, slug, clinics, modules, catalog }} />}

        <div className="sw-actions">
          <button className="sw-btn sw-btn-ghost" onClick={prev} disabled={step === 1 || busy}>
            Назад
          </button>
          <button
            className="sw-btn sw-btn-primary"
            onClick={next}
            disabled={!canNext || busy}
          >
            {step < TOTAL ? 'Далее' : (busy ? 'Отправляем…' : 'Начать')}
          </button>
        </div>
      </div>

      {otpModal}
    </div>
  )
}

// ─── Шаги (под-компоненты, чисто рендер + контроль формы) ───────────────

function Step1({ email, setEmail, fullName, setFullName, phone, setPhone }) {
  return (
    <div className="sw-step">
      <h2>Шаг 1. Контакты владельца</h2>
      <p className="sw-muted">На этот email мы отправим код подтверждения и реквизиты для входа.</p>
      <label className="sw-field">
        <span>Email *</span>
        <input
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          autoFocus
        />
      </label>
      <label className="sw-field">
        <span>ФИО владельца *</span>
        <input
          type="text"
          placeholder="Иванов Иван Иванович"
          value={fullName}
          onChange={e => setFullName(e.target.value)}
        />
      </label>
      <label className="sw-field">
        <span>Телефон</span>
        <input
          type="tel"
          placeholder="+7 999 000-00-00"
          value={phone}
          onChange={e => setPhone(e.target.value)}
        />
      </label>
    </div>
  )
}

function Step2({ franchiseName, setFranchiseName, slug, setSlug, slugCheck }) {
  const preview = slug ? `https://клиниксеть.рф/${slug.toLowerCase()}/admin` : 'https://клиниксеть.рф/__slug__/admin'
  const slugIcon = {
    idle: null,
    checking: <span className="sw-spinner" />,
    available: <span className="sw-icon-ok">&#10003;</span>,
    taken: <span className="sw-icon-bad">&#10005;</span>,
    invalid: <span className="sw-icon-bad">&#10005;</span>,
    error: <span className="sw-icon-bad">!</span>,
  }[slugCheck.state]

  return (
    <div className="sw-step">
      <h2>Шаг 2. Название и адрес кабинета</h2>
      <p className="sw-muted">Slug — короткий идентификатор в URL вашей панели. Например, <b>lor</b> → клиниксеть.рф/lor/admin</p>
      <label className="sw-field">
        <span>Название франшизы *</span>
        <input
          type="text"
          placeholder="Клиника Сеть Юг"
          value={franchiseName}
          onChange={e => setFranchiseName(e.target.value)}
          autoFocus
        />
      </label>
      <label className="sw-field">
        <span>Slug в URL *</span>
        <div className="sw-input-wrap">
          <input
            type="text"
            placeholder="lor"
            value={slug}
            onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20))}
          />
          <span className="sw-input-suffix">{slugIcon}</span>
        </div>
        {slugCheck.reason && <span className="sw-field-error">{slugCheck.reason}</span>}
      </label>
      <div className="sw-preview-box">
        <span className="sw-muted">URL кабинета:</span>
        <code>{preview}</code>
      </div>
    </div>
  )
}

function Step3({ clinics, addClinic, removeClinic, updateClinic }) {
  return (
    <div className="sw-step">
      <h2>Шаг 3. Клиники сети</h2>
      <p className="sw-muted">Добавьте хотя бы одну клинику (можно до 10). Подробности можно дополнить позже в кабинете.</p>
      {clinics.map((c, i) => (
        <div key={i} className="sw-clinic">
          <div className="sw-clinic-header">
            <b>Клиника {i + 1}</b>
            {clinics.length > 1 && (
              <button className="sw-icon-btn" type="button" onClick={() => removeClinic(i)} title="Удалить">
                &times;
              </button>
            )}
          </div>
          <label className="sw-field">
            <span>Название *</span>
            <input type="text" placeholder="Клиника №1" value={c.name} onChange={e => updateClinic(i, 'name', e.target.value)} />
          </label>
          <div className="sw-grid-2">
            <label className="sw-field">
              <span>Город</span>
              <input type="text" placeholder="Назрань" value={c.city} onChange={e => updateClinic(i, 'city', e.target.value)} />
            </label>
            <label className="sw-field">
              <span>Телефон</span>
              <input type="tel" placeholder="+7 ..." value={c.phone} onChange={e => updateClinic(i, 'phone', e.target.value)} />
            </label>
          </div>
          <label className="sw-field">
            <span>Адрес</span>
            <input type="text" placeholder="ул. Ленина, д. 1" value={c.address} onChange={e => updateClinic(i, 'address', e.target.value)} />
          </label>
        </div>
      ))}
      {clinics.length < 10 && (
        <button className="sw-btn sw-btn-ghost sw-btn-add" type="button" onClick={addClinic}>
          + Добавить ещё клинику
        </button>
      )}
    </div>
  )
}

function Step4({ catalog, catalogLoading, modules, setModules }) {
  function toggle(key) {
    setModules(arr => arr.includes(key) ? arr.filter(k => k !== key) : [...arr, key])
  }
  // Дефолтные «модули» если каталог пустой — чтобы UI был содержательным.
  const fallback = useMemo(() => ([
    { key: 'calls',       name: 'Calls (телефония)',   description: 'Софтфон в браузере, видеозвонки.',    price_monthly: 1900 },
    { key: 'ltv',         name: 'LTV-аналитика',       description: 'Cohort/retention, оценка LTV.',        price_monthly: 990 },
    { key: 'marketplace', name: 'Marketplace',         description: 'Каталог дополнительных модулей.',     price_monthly: 0 },
    { key: 'region-lock', name: 'Region Lock',         description: 'Контроль географии франшизы.',         price_monthly: 1490 },
    { key: 'monitoring',  name: 'Monitoring',          description: 'Алерты в Telegram, графики Prometheus.', price_monthly: 990 },
  ]), [])
  const list = catalog?.length ? catalog : fallback

  return (
    <div className="sw-step">
      <h2>Шаг 4. Какие модули подключить</h2>
      <p className="sw-muted">Можно отметить сейчас или подключить позже из Marketplace. В триале все модули бесплатно 14 дней.</p>
      {catalogLoading && <div className="sw-muted">Загружаем каталог…</div>}
      <div className="sw-mod-list">
        {list.map(m => (
          <label key={m.key} className={`sw-mod ${modules.includes(m.key) ? 'on' : ''}`}>
            <input type="checkbox" checked={modules.includes(m.key)} onChange={() => toggle(m.key)} />
            <div className="sw-mod-body">
              <div className="sw-mod-head">
                <b>{m.name}</b>
                <span className="sw-mod-price">
                  {Number(m.price_monthly || 0) > 0 ? `${m.price_monthly} ₽/мес` : 'бесплатно'}
                </span>
              </div>
              {m.description && <span className="sw-mod-desc">{m.description}</span>}
            </div>
          </label>
        ))}
      </div>
    </div>
  )
}

function Step5({ plan, setPlan, email, fullName, phone, franchiseName, slug, clinics, modules, catalog }) {
  const moduleNames = (catalog || []).filter(m => modules.includes(m.key)).map(m => m.name)
  return (
    <div className="sw-step">
      <h2>Шаг 5. Тариф и подтверждение</h2>
      <div className="sw-plans">
        {PLANS.map(p => (
          <button
            key={p.key}
            type="button"
            className={`sw-plan ${plan === p.key ? 'on' : ''} ${p.highlight ? 'hl' : ''}`}
            onClick={() => setPlan(p.key)}
          >
            <div className="sw-plan-head">
              <b>{p.title}</b>
              {p.highlight && <span className="sw-badge">Популярно</span>}
            </div>
            <div className="sw-plan-price">{p.price}</div>
            <div className="sw-plan-note sw-muted">{p.note}</div>
            <ul>{p.features.map(f => <li key={f}>{f}</li>)}</ul>
          </button>
        ))}
      </div>

      <h3 className="sw-review-title">Обзор регистрации</h3>
      <div className="sw-review">
        <div><span className="sw-muted">Email:</span> {email}</div>
        <div><span className="sw-muted">Владелец:</span> {fullName}</div>
        {phone && <div><span className="sw-muted">Телефон:</span> {phone}</div>}
        <div><span className="sw-muted">Франшиза:</span> {franchiseName}</div>
        <div><span className="sw-muted">URL:</span> https://клиниксеть.рф/{slug}/admin</div>
        <div><span className="sw-muted">Клиник:</span> {clinics.length}</div>
        <div><span className="sw-muted">Модулей:</span> {modules.length || '—'} {moduleNames.length ? `(${moduleNames.join(', ')})` : ''}</div>
        <div><span className="sw-muted">Тариф:</span> {plan} · триал 14 дней</div>
      </div>
      <p className="sw-muted sw-tos">
        Нажимая «Начать», вы соглашаетесь с <a href="/terms" target="_blank">условиями использования</a> и <a href="/privacy" target="_blank">политикой конфиденциальности</a>.
      </p>
    </div>
  )
}
