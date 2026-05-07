/**
 * ========================================
 * БЛОК: OnboardingWizard — пошаговый мастер франчайзи
 * ========================================
 * Показывается franchise_owner после первого логина, если
 * franchise.onboarding_done === false.
 *
 * 6 шагов:
 *   1. Приветствие — название и регион франшизы
 *   2. Первая клиника — название, адрес, телефон, mis_id
 *   3. Услуги — выбрать из шаблона ИЛИ загрузить CSV (мин. 5)
 *   4. Сотрудники — менеджер + регистратор (мин 1+1)
 *   5. Уведомления — Telegram-бот
 *   6. Готово — итоговый чеклист, кнопка «В кабинет»
 *
 * Состояние:
 *   - GET /onboarding/status      — стартовое состояние, пришедшее с сервера
 *   - POST /onboarding/step/{n}   — сохранение прогресса
 *   - POST /onboarding/complete   — финал
 *   - localStorage clinika_onboarding_<franchise_id> — кэш прогресса оффлайн
 *
 * Анимации: slide left/right (CSS transition translateX).
 * super_admin может зайти на любой шаг через query ?step=N.
 * ========================================
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import api from '../../api'
import {
  Page,
  PageHeader,
  Card,
  Button,
  InfoHint,
  useToast,
} from '../../design'

const TOTAL_STEPS = 6

// ── Описание шагов (для прогресс-бара и заголовков) ──────────────────────────
const STEPS_META = [
  {
    id: 1,
    title: 'Добро пожаловать!',
    subtitle: 'Расскажите о вашей франшизе',
    icon: 'celebration',
    hint: 'Этот мастер поможет за 5 минут настроить франшизу: создать первую клинику, добавить услуги и команду.',
  },
  {
    id: 2,
    title: 'Первая клиника',
    subtitle: 'Создадим первый тенант и клинику в нём',
    icon: 'business',
    hint: 'Тенант — это отдельная клиника-юрлицо с собственным URL. Slug — короткое имя для адреса (например, sochi).',
  },
  {
    id: 3,
    title: 'Услуги',
    subtitle: 'Базовый прайс — выберите шаблон или добавьте свои',
    icon: 'medical_services',
    hint: 'Можно начать с готового шаблона (терапия, стоматология, косметология) и потом добавить свои услуги. Минимум 5 услуг для старта.',
  },
  {
    id: 4,
    title: 'Сотрудники',
    subtitle: 'Добавим первого менеджера и регистратора',
    icon: 'group_add',
    hint: 'Менеджер видит всю клинику и аналитику. Регистратор — заводит пациентов и назначает приёмы. Минимум один из каждой роли.',
  },
  {
    id: 5,
    title: 'Уведомления',
    subtitle: 'Подключите Telegram-бот для команды',
    icon: 'notifications_active',
    hint: 'Бот уведомляет сотрудников о новых записях, отзывах и счетах. Можно подключить позже из раздела «Настройки».',
  },
  {
    id: 6,
    title: 'Всё готово!',
    subtitle: 'Финальный чеклист — давайте проверим',
    icon: 'task_alt',
    hint: 'После завершения мастер больше не появится. Все данные можно поменять в кабинете.',
  },
]

// ── Шаблоны услуг (синхронизированы с backend SERVICE_TEMPLATES) ────────────
const SERVICE_TEMPLATES = {
  general: {
    title: 'Общая медицина',
    items: [
      { name: 'Первичный приём терапевта',         bonus_amount: 300, duration: 30, category: 'Терапия' },
      { name: 'Повторный приём терапевта',         bonus_amount: 200, duration: 20, category: 'Терапия' },
      { name: 'Общий анализ крови',                bonus_amount: 150, duration: 10, category: 'Лаборатория' },
      { name: 'ЭКГ с расшифровкой',                bonus_amount: 250, duration: 20, category: 'Диагностика' },
      { name: 'УЗИ органов брюшной полости',       bonus_amount: 400, duration: 30, category: 'Диагностика' },
    ],
  },
  dental: {
    title: 'Стоматология',
    items: [
      { name: 'Консультация стоматолога',                  bonus_amount: 300,  duration: 20, category: 'Стоматология' },
      { name: 'Профессиональная гигиена полости рта',      bonus_amount: 500,  duration: 60, category: 'Стоматология' },
      { name: 'Лечение кариеса (1 зуб)',                   bonus_amount: 600,  duration: 60, category: 'Стоматология' },
      { name: 'Удаление зуба простое',                     bonus_amount: 500,  duration: 30, category: 'Стоматология' },
      { name: 'Рентгенограмма зуба',                       bonus_amount: 150,  duration: 10, category: 'Диагностика' },
    ],
  },
  cosmetology: {
    title: 'Косметология',
    items: [
      { name: 'Консультация косметолога',         bonus_amount: 300,  duration: 30, category: 'Косметология' },
      { name: 'Чистка лица механическая',         bonus_amount: 600,  duration: 60, category: 'Косметология' },
      { name: 'Биоревитализация (1 процедура)',   bonus_amount: 800,  duration: 45, category: 'Косметология' },
      { name: 'Контурная пластика губ',           bonus_amount: 1000, duration: 60, category: 'Косметология' },
      { name: 'Лазерная эпиляция (зона ноги)',    bonus_amount: 700,  duration: 45, category: 'Косметология' },
    ],
  },
}

// ── Хелпер: ключ для localStorage ────────────────────────────────────────────
const lsKey = (franchiseId) => `clinika_onboarding_${franchiseId || 'default'}`

// ── Хелпер: парсер CSV с шапкой name,bonus_amount,duration,category ─────────
function parseServicesCsv(text) {
  if (!text) return []
  const rows = text.split(/\r?\n/).filter((r) => r.trim().length > 0)
  if (rows.length === 0) return []
  const header = rows[0].split(/[;,]/).map((s) => s.trim().toLowerCase())
  const idxName = header.indexOf('name')
  const idxBonus = header.indexOf('bonus_amount')
  const idxDur = header.indexOf('duration')
  const idxCat = header.indexOf('category')
  // Если шапка не распознана — считаем что весь CSV без шапки и одна колонка name
  const items = []
  const startIdx = idxName >= 0 ? 1 : 0
  for (let i = startIdx; i < rows.length; i++) {
    const cells = rows[i].split(/[;,]/).map((s) => s.trim())
    const name = idxName >= 0 ? cells[idxName] : cells[0]
    if (!name) continue
    items.push({
      name,
      bonus_amount: idxBonus >= 0 ? Number(cells[idxBonus]) || 0 : 0,
      duration: idxDur >= 0 ? Number(cells[idxDur]) || null : null,
      category: idxCat >= 0 ? cells[idxCat] || null : null,
    })
  }
  return items
}

// ── UI: Material Symbol icon ────────────────────────────────────────────────
function MIcon({ name, size = 22, className = '', style = {} }) {
  return (
    <span
      className={`material-symbols-outlined ${className}`}
      style={{ fontSize: size, lineHeight: 1, ...style }}
      aria-hidden
    >
      {name}
    </span>
  )
}

// ── UI: progress bar ────────────────────────────────────────────────────────
function ProgressBar({ step }) {
  const pct = Math.round(((step - 1) / (TOTAL_STEPS - 1)) * 100)
  return (
    <div className="w-full mb-6">
      <div className="flex items-center justify-between text-xs mb-2" style={{ color: 'var(--fg-3)' }}>
        <span>Шаг {step} из {TOTAL_STEPS}</span>
        <span>{pct}%</span>
      </div>
      <div
        className="w-full h-2 rounded-full overflow-hidden"
        style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}
      >
        <div
          className="h-full transition-all duration-500 ease-out"
          style={{ width: `${Math.max(8, ((step) / TOTAL_STEPS) * 100)}%`, background: 'var(--accent)' }}
        />
      </div>
      {/* Точки шагов */}
      <div className="mt-3 grid grid-cols-6 gap-1">
        {STEPS_META.map((s) => (
          <div key={s.id} className="flex flex-col items-center text-center">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold"
              style={{
                background: s.id <= step ? 'var(--accent)' : 'var(--bg-2)',
                color: s.id <= step ? 'var(--accent-fg)' : 'var(--fg-3)',
                border: '1px solid var(--border)',
                transition: 'all 200ms ease',
              }}
            >
              {s.id < step ? <MIcon name="check" size={16} /> : s.id}
            </div>
            <span
              className="hidden sm:block text-[10px] mt-1 leading-tight"
              style={{ color: s.id === step ? 'var(--fg)' : 'var(--fg-3)' }}
            >
              {s.id === 1 ? 'Старт' : s.id === 2 ? 'Клиника' : s.id === 3 ? 'Услуги' : s.id === 4 ? 'Команда' : s.id === 5 ? 'Бот' : 'Готово'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Шаг 1: Приветствие ──────────────────────────────────────────────────────
function Step1({ data, setData }) {
  const v = data.step1 || {}
  const upd = (k, val) => setData((d) => ({ ...d, step1: { ...(d.step1 || {}), [k]: val } }))
  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: 'var(--fg-2)' }}>
        Поздравляем с подключением! Этот короткий мастер поможет настроить вашу
        франшизу за несколько минут. Все шаги можно пропустить и заполнить позже
        в кабинете.
      </p>
      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--fg-2)' }}>
          Название франшизы <span style={{ color: 'var(--bad)' }}>*</span>
        </label>
        <input
          type="text"
          className="w-full px-3 py-2.5 rounded-lg outline-none transition"
          style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--fg)' }}
          placeholder="Например: КлиникСеть Юг"
          value={v.name || ''}
          onChange={(e) => upd('name', e.target.value)}
        />
      </div>
      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--fg-2)' }}>
          Регион / город
        </label>
        <input
          type="text"
          className="w-full px-3 py-2.5 rounded-lg outline-none transition"
          style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--fg)' }}
          placeholder="Краснодарский край, Сочи"
          value={v.region || ''}
          onChange={(e) => upd('region', e.target.value)}
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--fg-2)' }}>Email для связи</label>
          <input
            type="email"
            className="w-full px-3 py-2.5 rounded-lg outline-none"
            style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--fg)' }}
            placeholder="owner@franchise.ru"
            value={v.contact_email || ''}
            onChange={(e) => upd('contact_email', e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--fg-2)' }}>Телефон</label>
          <input
            type="tel"
            className="w-full px-3 py-2.5 rounded-lg outline-none"
            style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--fg)' }}
            placeholder="+7 (000) 000-00-00"
            value={v.contact_phone || ''}
            onChange={(e) => upd('contact_phone', e.target.value)}
          />
        </div>
      </div>
    </div>
  )
}

// ── Шаг 2: Первая клиника ───────────────────────────────────────────────────
function Step2({ data, setData }) {
  const v = data.step2 || {}
  const upd = (k, val) => setData((d) => ({ ...d, step2: { ...(d.step2 || {}), [k]: val } }))
  // Авто-генерация slug из названия
  const onTenantNameChange = (val) => {
    upd('tenant_name', val)
    if (!v.tenant_slug || v.tenant_slug === _slugify(v.tenant_name || '')) {
      upd('tenant_slug', _slugify(val))
    }
  }
  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: 'var(--fg-2)' }}>
        Создадим первый тенант (юрлицо/филиал) и одну клинику внутри него.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--fg-2)' }}>
            Название тенанта <span style={{ color: 'var(--bad)' }}>*</span>
          </label>
          <input
            type="text"
            className="w-full px-3 py-2.5 rounded-lg outline-none"
            style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--fg)' }}
            placeholder="ООО «КлиникСеть Сочи»"
            value={v.tenant_name || ''}
            onChange={(e) => onTenantNameChange(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--fg-2)' }}>
            Slug (URL) <span style={{ color: 'var(--bad)' }}>*</span>
          </label>
          <input
            type="text"
            className="w-full px-3 py-2.5 rounded-lg outline-none font-mono text-sm"
            style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--fg)' }}
            placeholder="sochi"
            value={v.tenant_slug || ''}
            onChange={(e) => upd('tenant_slug', _slugify(e.target.value))}
          />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--fg-2)' }}>
          Название клиники <span style={{ color: 'var(--bad)' }}>*</span>
        </label>
        <input
          type="text"
          className="w-full px-3 py-2.5 rounded-lg outline-none"
          style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--fg)' }}
          placeholder="Клиника на Курортном"
          value={v.clinic_name || ''}
          onChange={(e) => upd('clinic_name', e.target.value)}
        />
      </div>
      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--fg-2)' }}>Адрес</label>
        <input
          type="text"
          className="w-full px-3 py-2.5 rounded-lg outline-none"
          style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--fg)' }}
          placeholder="354000, г. Сочи, ул. Курортный пр., 1"
          value={v.address || ''}
          onChange={(e) => upd('address', e.target.value)}
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--fg-2)' }}>Город</label>
          <input
            type="text"
            className="w-full px-3 py-2.5 rounded-lg outline-none"
            style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--fg)' }}
            placeholder="Сочи"
            value={v.city || ''}
            onChange={(e) => upd('city', e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--fg-2)' }}>Телефон</label>
          <input
            type="tel"
            className="w-full px-3 py-2.5 rounded-lg outline-none"
            style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--fg)' }}
            placeholder="+7 (862) 000-00-00"
            value={v.phone || ''}
            onChange={(e) => upd('phone', e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--fg-2)' }}>
            MIS ID (опц.)
          </label>
          <input
            type="number"
            className="w-full px-3 py-2.5 rounded-lg outline-none"
            style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--fg)' }}
            placeholder="123"
            value={v.mis_id || ''}
            onChange={(e) => upd('mis_id', e.target.value ? Number(e.target.value) : null)}
          />
        </div>
      </div>
    </div>
  )
}

function _slugify(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[ёе]/g, 'e')
    .replace(/[^a-z0-9а-я-]/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .replace(/[а-я]/g, (ch) => {
      const map = {
        а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ж:'zh',з:'z',и:'i',й:'y',
        к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',
        ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'
      }
      return map[ch] || ''
    })
    .slice(0, 50)
}

// ── Шаг 3: Услуги ───────────────────────────────────────────────────────────
function Step3({ data, setData, toast }) {
  const v = data.step3 || { template: null, services: [] }
  const upd = (val) => setData((d) => ({ ...d, step3: { ...(d.step3 || {}), ...val } }))
  const fileRef = useRef(null)

  const applyTemplate = (key) => {
    upd({ template: key, services: SERVICE_TEMPLATES[key].items })
  }
  const removeAt = (i) => {
    const next = (v.services || []).filter((_, idx) => idx !== i)
    upd({ services: next })
  }
  const addEmpty = () => {
    upd({ services: [...(v.services || []), { name: '', bonus_amount: 0, duration: 30, category: '' }] })
  }
  const editAt = (i, k, val) => {
    const next = (v.services || []).map((s, idx) => (idx === i ? { ...s, [k]: val } : s))
    upd({ services: next })
  }
  const onCsv = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const items = parseServicesCsv(String(ev.target?.result || ''))
      if (items.length === 0) {
        toast?.error?.('Не удалось прочитать CSV')
        return
      }
      upd({ services: [...(v.services || []), ...items], template: null })
      toast?.success?.(`Добавлено ${items.length} услуг из CSV`)
    }
    reader.readAsText(file)
  }
  const count = (v.services || []).length
  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm mb-2" style={{ color: 'var(--fg-2)' }}>
          Выберите готовый шаблон — это быстрее всего:
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {Object.entries(SERVICE_TEMPLATES).map(([key, tpl]) => (
            <button
              key={key}
              type="button"
              onClick={() => applyTemplate(key)}
              className="text-left p-3 rounded-lg transition"
              style={{
                background: v.template === key ? 'var(--accent)' : 'var(--bg-2)',
                color: v.template === key ? 'var(--accent-fg)' : 'var(--fg)',
                border: '1px solid var(--border)',
              }}
            >
              <div className="font-semibold text-sm">{tpl.title}</div>
              <div className="text-xs opacity-80">{tpl.items.length} услуг</div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <Button variant="secondary" size="sm" leftIcon={<MIcon name="add" size={16} />} onClick={addEmpty}>
          Добавить вручную
        </Button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={onCsv} />
        <Button variant="secondary" size="sm" leftIcon={<MIcon name="upload_file" size={16} />} onClick={() => fileRef.current?.click()}>
          Загрузить CSV
        </Button>
        <span className="text-xs ml-auto" style={{ color: count >= 5 ? 'var(--good, #16a34a)' : 'var(--fg-3)' }}>
          {count} / 5 услуг {count >= 5 ? '✓' : ''}
        </span>
      </div>

      {count > 0 && (
        <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
          {(v.services || []).map((s, i) => (
            <div
              key={i}
              className="grid grid-cols-12 gap-2 p-2 rounded-lg"
              style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}
            >
              <input
                className="col-span-5 px-2 py-1.5 rounded text-sm outline-none"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--fg)' }}
                placeholder="Название"
                value={s.name}
                onChange={(e) => editAt(i, 'name', e.target.value)}
              />
              <input
                type="number"
                className="col-span-2 px-2 py-1.5 rounded text-sm outline-none"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--fg)' }}
                placeholder="Бонус"
                value={s.bonus_amount || 0}
                onChange={(e) => editAt(i, 'bonus_amount', Number(e.target.value) || 0)}
              />
              <input
                type="number"
                className="col-span-2 px-2 py-1.5 rounded text-sm outline-none"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--fg)' }}
                placeholder="Мин"
                value={s.duration || ''}
                onChange={(e) => editAt(i, 'duration', e.target.value ? Number(e.target.value) : null)}
              />
              <input
                className="col-span-2 px-2 py-1.5 rounded text-sm outline-none"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--fg)' }}
                placeholder="Категория"
                value={s.category || ''}
                onChange={(e) => editAt(i, 'category', e.target.value)}
              />
              <button
                type="button"
                className="col-span-1 inline-flex items-center justify-center rounded transition"
                style={{ color: 'var(--fg-3)' }}
                onClick={() => removeAt(i)}
                title="Удалить"
              >
                <MIcon name="close" size={18} />
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs" style={{ color: 'var(--fg-3)' }}>
        Формат CSV: <code>name,bonus_amount,duration,category</code> (разделитель запятая или ;)
      </p>
    </div>
  )
}

// ── Шаг 4: Сотрудники ───────────────────────────────────────────────────────
function Step4({ data, setData }) {
  const v = data.step4 || { members: [] }
  const upd = (val) => setData((d) => ({ ...d, step4: { ...(d.step4 || {}), ...val } }))
  const list = v.members || []
  const editAt = (i, k, val) => {
    const next = list.map((m, idx) => (idx === i ? { ...m, [k]: val } : m))
    upd({ members: next })
  }
  const removeAt = (i) => upd({ members: list.filter((_, idx) => idx !== i) })
  const addRole = (role) => {
    upd({ members: [...list, { full_name: '', username: '', password: '', role, phone: '' }] })
  }
  const managerCount = list.filter((m) => m.role === 'manager').length
  const regCount = list.filter((m) => m.role === 'reg').length
  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: 'var(--fg-2)' }}>
        Добавим стартовую команду. После завершения мастера сотрудники получат
        логин и пароль, смогут войти в свой кабинет.
      </p>
      <div className="flex gap-2 flex-wrap">
        <Button variant="secondary" size="sm" leftIcon={<MIcon name="manage_accounts" size={16} />} onClick={() => addRole('manager')}>
          + Менеджер
        </Button>
        <Button variant="secondary" size="sm" leftIcon={<MIcon name="badge" size={16} />} onClick={() => addRole('reg')}>
          + Регистратор
        </Button>
        <span className="text-xs ml-auto self-center" style={{ color: 'var(--fg-3)' }}>
          Менеджеров: {managerCount} · Регистраторов: {regCount}
        </span>
      </div>

      {list.length === 0 && (
        <div
          className="p-4 rounded-lg text-center text-sm"
          style={{ background: 'var(--bg-2)', border: '1px dashed var(--border)', color: 'var(--fg-3)' }}
        >
          Пока никого. Добавьте хотя бы одного менеджера и одного регистратора.
        </div>
      )}

      {list.map((m, i) => (
        <div
          key={i}
          className="p-3 rounded-lg space-y-2"
          style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-center justify-between">
            <span
              className="text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded"
              style={{
                background: m.role === 'manager' ? 'var(--accent)' : 'var(--bg-1, var(--surface))',
                color: m.role === 'manager' ? 'var(--accent-fg)' : 'var(--fg)',
              }}
            >
              {m.role === 'manager' ? 'Менеджер' : 'Регистратор'}
            </span>
            <button onClick={() => removeAt(i)} style={{ color: 'var(--fg-3)' }}>
              <MIcon name="close" size={18} />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              className="px-2 py-1.5 rounded text-sm outline-none"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--fg)' }}
              placeholder="ФИО"
              value={m.full_name}
              onChange={(e) => editAt(i, 'full_name', e.target.value)}
            />
            <input
              className="px-2 py-1.5 rounded text-sm outline-none font-mono"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--fg)' }}
              placeholder="Логин (username)"
              value={m.username}
              onChange={(e) => editAt(i, 'username', e.target.value.toLowerCase())}
            />
            <input
              type="text"
              className="px-2 py-1.5 rounded text-sm outline-none"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--fg)' }}
              placeholder="Временный пароль (опц.)"
              value={m.password || ''}
              onChange={(e) => editAt(i, 'password', e.target.value)}
            />
            <input
              className="px-2 py-1.5 rounded text-sm outline-none"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--fg)' }}
              placeholder="Телефон"
              value={m.phone || ''}
              onChange={(e) => editAt(i, 'phone', e.target.value)}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Шаг 5: Уведомления (Telegram-бот) ───────────────────────────────────────
function Step5({ data, setData }) {
  const v = data.step5 || { enabled: false }
  const upd = (k, val) => setData((d) => ({ ...d, step5: { ...(d.step5 || {}), [k]: val } }))
  const botUrl = 'https://t.me/clinika_bot'
  // QR через публичный сервис (картинка). При оффлайн — fallback на ссылку.
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(botUrl)}`
  return (
    <div className="space-y-5">
      <p className="text-sm" style={{ color: 'var(--fg-2)' }}>
        Подключите Telegram-бот для оперативных уведомлений о записях, отзывах
        и счетах. Это можно сделать сейчас или позже из «Настроек».
      </p>
      <div
        className="p-4 rounded-xl flex flex-col sm:flex-row items-center gap-4"
        style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}
      >
        <img
          src={qr}
          alt="QR на бот"
          className="w-[160px] h-[160px] rounded-lg"
          style={{ background: '#fff', padding: 6 }}
          onError={(e) => { e.currentTarget.style.display = 'none' }}
        />
        <div className="flex-1 text-center sm:text-left">
          <div className="text-base font-semibold mb-1" style={{ color: 'var(--fg)' }}>@clinika_bot</div>
          <div className="text-xs mb-3" style={{ color: 'var(--fg-3)' }}>
            Отсканируйте QR или откройте ссылку в Telegram, нажмите «Start»,
            и бот предложит привязку к вашему аккаунту.
          </div>
          <a
            href={botUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm font-medium underline"
            style={{ color: 'var(--accent)' }}
          >
            <MIcon name="open_in_new" size={14} />
            {botUrl}
          </a>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--fg-2)' }}>
            Telegram username (опц.)
          </label>
          <input
            className="w-full px-3 py-2.5 rounded-lg outline-none"
            style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--fg)' }}
            placeholder="@my_username"
            value={v.telegram_bot_username || ''}
            onChange={(e) => upd('telegram_bot_username', e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--fg-2)' }}>
            Telegram chat ID (опц.)
          </label>
          <input
            className="w-full px-3 py-2.5 rounded-lg outline-none font-mono"
            style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--fg)' }}
            placeholder="123456789"
            value={v.telegram_admin_id || ''}
            onChange={(e) => upd('telegram_admin_id', e.target.value)}
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--fg)' }}>
        <input
          type="checkbox"
          checked={!!v.enabled}
          onChange={(e) => upd('enabled', e.target.checked)}
          style={{ accentColor: 'var(--accent)' }}
        />
        Я подключил бота, можно отправлять уведомления
      </label>
    </div>
  )
}

// ── Шаг 6: Готово (чеклист) ─────────────────────────────────────────────────
function Step6({ data }) {
  const items = [
    {
      ok: !!data?.step1?.name,
      label: 'Название и контакты франшизы',
      detail: data?.step1?.name || '—',
    },
    {
      ok: !!data?.step2?.tenant_slug && !!data?.step2?.clinic_name,
      label: 'Первая клиника создана',
      detail: data?.step2?.clinic_name ? `${data.step2.clinic_name} (${data?.step2?.city || '—'})` : '—',
    },
    {
      ok: ((data?.step3?.services || []).length) >= 5,
      label: `Услуги (минимум 5)`,
      detail: `${(data?.step3?.services || []).length} шт.`,
    },
    {
      ok:
        (data?.step4?.members || []).some((m) => m.role === 'manager') &&
        (data?.step4?.members || []).some((m) => m.role === 'reg'),
      label: 'Команда: менеджер + регистратор',
      detail: `${(data?.step4?.members || []).length} сотрудников`,
    },
    {
      ok: !!data?.step5?.enabled,
      label: 'Telegram-бот подключён',
      detail: data?.step5?.enabled ? 'Да' : 'Можно подключить позже',
    },
  ]
  return (
    <div className="space-y-3">
      <p className="text-sm" style={{ color: 'var(--fg-2)' }}>
        Проверьте итоговый чеклист. Серые пункты можно дозаполнить уже в кабинете.
      </p>
      {items.map((it, i) => (
        <div
          key={i}
          className="flex items-start gap-3 p-3 rounded-lg"
          style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}
        >
          <MIcon
            name={it.ok ? 'check_circle' : 'radio_button_unchecked'}
            size={22}
            style={{ color: it.ok ? 'var(--good, #16a34a)' : 'var(--fg-3)' }}
          />
          <div className="flex-1">
            <div className="text-sm font-medium" style={{ color: 'var(--fg)' }}>{it.label}</div>
            <div className="text-xs" style={{ color: 'var(--fg-3)' }}>{it.detail}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Главный компонент ──────────────────────────────────────────────────────
export default function OnboardingWizard({ user, onComplete }) {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [step, setStep] = useState(1)
  const [direction, setDirection] = useState(1) // 1=вперёд (slide left), -1=назад
  const [animKey, setAnimKey] = useState(0)
  const [franchiseId, setFranchiseId] = useState(null)
  const [data, setData] = useState({})

  // ── 1. Загрузка стартового состояния ─────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      try {
        const res = await api.get('/onboarding/status')
        const d = res.data || {}
        setFranchiseId(d.franchise_id)
        setData(d.data || {})
        // Ищем локальный кэш (если пользователь редактировал но не сохранил)
        try {
          const cached = localStorage.getItem(lsKey(d.franchise_id))
          if (cached) {
            const parsed = JSON.parse(cached)
            if (parsed && typeof parsed === 'object' && parsed.data) {
              setData((prev) => ({ ...prev, ...parsed.data }))
            }
          }
        } catch {}
        // Если уже завершён — сразу выходим
        if (d.completed) {
          onComplete?.()
          return
        }
        // Стартовый шаг (или из URL ?step=N для super_admin отладки)
        const urlStep = Number(new URLSearchParams(window.location.search).get('step'))
        const initial = Number.isFinite(urlStep) && urlStep >= 1 && urlStep <= TOTAL_STEPS ? urlStep : (d.step || 1)
        setStep(initial)
      } catch (e) {
        console.error('[Onboarding] status', e)
        toast?.error?.('Не удалось загрузить состояние мастера')
      } finally {
        setLoading(false)
      }
    }
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── 2. Кэширование прогресса в localStorage ──────────────────────────────
  useEffect(() => {
    if (!franchiseId) return
    try {
      localStorage.setItem(lsKey(franchiseId), JSON.stringify({ step, data, ts: Date.now() }))
    } catch {}
  }, [franchiseId, step, data])

  // ── 3. Валидация текущего шага (для блокировки «Далее») ──────────────────
  const canProceed = useCallback(() => {
    if (step === 1) return !!(data?.step1?.name && data.step1.name.trim().length >= 2)
    if (step === 2)
      return !!(
        data?.step2?.tenant_name &&
        data?.step2?.tenant_slug &&
        data?.step2?.clinic_name
      )
    if (step === 3) return (data?.step3?.services || []).length >= 5
    if (step === 4) {
      const m = (data?.step4?.members || [])
      return m.some((x) => x.role === 'manager' && x.full_name && x.username) &&
             m.some((x) => x.role === 'reg' && x.full_name && x.username)
    }
    if (step === 5) return true // всегда можно идти дальше
    if (step === 6) return true
    return true
  }, [step, data])

  // ── 4. Сохранение шага и переход вперёд ──────────────────────────────────
  const saveAndNext = async ({ skip = false } = {}) => {
    if (saving) return
    setSaving(true)
    try {
      const stepKey = `step${step}`
      const payload = skip ? { skipped: true } : { data: data[stepKey] || {} }
      await api.post(`/onboarding/step/${step}`, payload)
      setDirection(1)
      setAnimKey((k) => k + 1)
      setStep((s) => Math.min(s + 1, TOTAL_STEPS))
    } catch (e) {
      console.error('[Onboarding] step save', e)
      toast?.error?.(e?.response?.data?.detail || 'Не удалось сохранить шаг')
    } finally {
      setSaving(false)
    }
  }

  // ── 5. Назад ─────────────────────────────────────────────────────────────
  const goBack = () => {
    setDirection(-1)
    setAnimKey((k) => k + 1)
    setStep((s) => Math.max(s - 1, 1))
  }

  // ── 6. Финал ─────────────────────────────────────────────────────────────
  const finish = async () => {
    setCompleting(true)
    try {
      const res = await api.post('/onboarding/complete')
      toast?.success?.('Настройка завершена!')
      try { localStorage.removeItem(lsKey(franchiseId)) } catch {}
      onComplete?.(res.data)
    } catch (e) {
      console.error('[Onboarding] complete', e)
      toast?.error?.(e?.response?.data?.detail || 'Не удалось завершить мастер')
    } finally {
      setCompleting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-t-transparent rounded-full animate-spin mx-auto mb-3"
               style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
          <p className="text-sm" style={{ color: 'var(--fg-3)' }}>Загрузка мастера...</p>
        </div>
      </div>
    )
  }

  const meta = STEPS_META[step - 1]

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      {/* Material Symbols + анимация */}
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,300..700,0..1,-50..200"
      />
      <style>{`
        .ks-wiz-slide { animation: ks-wiz-in 320ms cubic-bezier(.2,.8,.2,1) both; }
        @keyframes ks-wiz-in {
          from { opacity: 0; transform: translateX(var(--slide-from, 24px)); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>

      <div className="max-w-3xl mx-auto px-4 py-8 sm:py-12">
        <PageHeader
          title="Настройка франшизы"
          subtitle={`Привет, ${user?.full_name || 'владелец'}! Давайте подготовим ваш кабинет.`}
          actions={
            user?.role === 'super_admin' ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onComplete?.()}
                leftIcon={<MIcon name="speed" size={16} />}
              >
                Пропустить (super_admin)
              </Button>
            ) : null
          }
        />

        <Card>
          <ProgressBar step={step} />

          <div
            key={animKey}
            className="ks-wiz-slide flex flex-col sm:flex-row gap-4 sm:gap-6 items-start"
            style={{ '--slide-from': direction > 0 ? '24px' : '-24px' }}
          >
            {/* Левый блок: иконка + заголовок (на мобильном — сверху) */}
            <div className="flex sm:flex-col sm:w-[120px] items-center sm:items-start gap-3">
              <div
                className="rounded-2xl flex items-center justify-center"
                style={{
                  width: 64, height: 64,
                  background: 'var(--accent)', color: 'var(--accent-fg)',
                  boxShadow: '0 4px 16px oklch(0.55 0.16 240 / 0.25)',
                }}
              >
                <MIcon name={meta.icon} size={36} />
              </div>
              <div className="sm:mt-2">
                <div className="text-base font-semibold leading-tight" style={{ color: 'var(--fg)' }}>
                  {meta.title}
                </div>
                <div className="text-xs mt-1" style={{ color: 'var(--fg-3)' }}>
                  {meta.subtitle}
                </div>
              </div>
            </div>

            {/* Правый блок: форма */}
            <div className="flex-1 min-w-0 w-full">
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-lg font-semibold" style={{ color: 'var(--fg)' }}>{meta.title}</h2>
                <InfoHint text={meta.hint} title={meta.title} />
              </div>

              {step === 1 && <Step1 data={data} setData={setData} />}
              {step === 2 && <Step2 data={data} setData={setData} />}
              {step === 3 && <Step3 data={data} setData={setData} toast={toast} />}
              {step === 4 && <Step4 data={data} setData={setData} />}
              {step === 5 && <Step5 data={data} setData={setData} />}
              {step === 6 && <Step6 data={data} />}
            </div>
          </div>

          {/* Кнопки навигации */}
          <div className="flex items-center justify-between mt-6 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
            <div>
              {step > 1 && (
                <Button variant="ghost" size="md" onClick={goBack} leftIcon={<MIcon name="chevron_left" size={18} />}>
                  Назад
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              {step < TOTAL_STEPS && step !== 1 && (
                <Button
                  variant="ghost"
                  size="md"
                  onClick={() => saveAndNext({ skip: true })}
                  disabled={saving}
                >
                  Пропустить
                </Button>
              )}
              {step < TOTAL_STEPS ? (
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => saveAndNext({ skip: false })}
                  disabled={saving || !canProceed()}
                  rightIcon={<MIcon name="chevron_right" size={18} />}
                >
                  {saving ? 'Сохраняем...' : 'Далее'}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="md"
                  onClick={finish}
                  disabled={completing}
                  rightIcon={<MIcon name="rocket_launch" size={18} />}
                >
                  {completing ? 'Запускаем...' : 'В кабинет'}
                </Button>
              )}
            </div>
          </div>
        </Card>

        <p className="text-center mt-4 text-xs" style={{ color: 'var(--fg-3)' }}>
          Ваш прогресс автоматически сохраняется. Можно закрыть и продолжить позже.
        </p>
      </div>
    </div>
  )
}
