/**
 * ========================================
 * БЛОК: <InventoryImportWizard> — 5-шаговый импорт 1С Excel/CSV
 * ========================================
 * Этапы:
 *   1) Загрузка файла → POST /inventory/import/preview
 *   2) Маппинг колонок (auto + ручная правка)
 *   3) Параметры импорта (клиника, стратегия, категория, поставщик, дата)
 *   4) Превью и валидация
 *   5) Выполнение → POST /inventory/import/execute + результат
 *
 * Используется на странице ManagerInventory. Открывается по большой кнопке
 * «📥 Импорт из 1С». После успешного импорта вызывает onDone() — родитель
 * перезагружает список товаров.
 *
 * Дизайн-система: Modal / Button / useToast из ../../design.
 * Axios через ../../api (auto-token, baseURL = /<slug>/api).
 * ========================================
 */
import { useEffect, useMemo, useState } from 'react'
import api from '../../api'
import { Modal, Button, useToast } from '../../design'

// ─── Поля, на которые мапим колонки файла ───
// key — внутренний идентификатор (отправится в mapping как ключ);
// label — человеко-читаемое имя; required — обязательное поле.
const TARGET_FIELDS = [
  { key: 'sku',            label: 'SKU / Артикул',       required: true  },
  { key: 'name',           label: 'Название товара',     required: true  },
  { key: 'quantity',       label: 'Количество',          required: true  },
  { key: 'unit',           label: 'Единица измерения',   required: false },
  { key: 'cost_price',     label: 'Цена закупки',        required: false },
  { key: 'category',       label: 'Категория',           required: false },
  { key: 'batch_number',   label: 'Партия (batch)',      required: false },
  { key: 'expiry_date',    label: 'Срок годности',       required: false },
  { key: 'vendor',         label: 'Поставщик',           required: false },
  { key: 'barcode',        label: 'Штрих-код',           required: false },
  { key: 'external_id',    label: 'Внешний ID (1C)',     required: false },
]

const CATEGORY_OPTIONS = [
  { value: 'CONSUMABLE',  label: 'Расходник' },
  { value: 'EQUIPMENT',   label: 'Оборудование' },
  { value: 'MEDICATION',  label: 'Медикамент' },
  { value: 'REAGENT',     label: 'Реагент' },
  { value: 'OTHER',       label: 'Прочее' },
]

const STRATEGY_OPTIONS = [
  { value: 'skip',    title: 'Пропустить',  desc: 'Только новые SKU; существующие не трогаем' },
  { value: 'update',  title: 'Обновить',    desc: 'Обновить название/цену/поставщика, остатки прибавить (рекомендуется)' },
  { value: 'replace', title: 'Заменить',    desc: 'Обнулить старые остатки и записать новые' },
]

// ─── Утилита: формат размера файла ───
function fmtSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return bytes + ' Б'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' КБ'
  return (bytes / 1024 / 1024).toFixed(2) + ' МБ'
}

// ─── Утилита: today YYYY-MM-DD ───
function todayISO() {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

export default function InventoryImportWizard({ open, onClose, onDone }) {
  const { toast } = useToast?.() || { toast: (m) => alert(m) }
  // ─── Состояние мастера ───
  const [step, setStep] = useState(1)
  const [file, setFile] = useState(null)
  const [sheetName, setSheetName] = useState('')
  const [previewResp, setPreviewResp] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // Маппинг (target_field -> header_name из файла)
  const [mapping, setMapping] = useState({})

  // Параметры импорта
  const [clinics, setClinics] = useState([])
  const [clinicId, setClinicId] = useState('')
  const [strategy, setStrategy] = useState('update')
  const [defaultCategory, setDefaultCategory] = useState('CONSUMABLE')
  const [defaultVendor, setDefaultVendor] = useState('')
  const [incomeDate, setIncomeDate] = useState(todayISO())

  // Результат
  const [result, setResult] = useState(null)

  // ─── Сброс при открытии ───
  useEffect(() => {
    if (!open) return
    setStep(1)
    setFile(null); setSheetName(''); setPreviewResp(null)
    setMapping({}); setBusy(false); setErr('')
    setResult(null)
    setStrategy('update'); setDefaultCategory('CONSUMABLE'); setDefaultVendor('')
    setIncomeDate(todayISO())
  }, [open])

  // ─── Загружаем клиники (для select назначения) ───
  useEffect(() => {
    if (!open) return
    api.get('/manager/clinics-accessible')
      .then(r => {
        const list = Array.isArray(r.data) ? r.data : []
        setClinics(list)
        if (list.length > 0 && !clinicId) setClinicId(String(list[0].id || list[0].tenant_id || ''))
      })
      .catch(() => setClinics([]))
  }, [open])

  // ─── Шаг 1 → 2: загрузка файла и preview ───
  async function uploadPreview() {
    if (!file) { setErr('Выберите файл'); return }
    setBusy(true); setErr('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      if (sheetName) fd.append('sheet_name', sheetName)
      const r = await api.post('/inventory/import/preview', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setPreviewResp(r.data || null)
      // Авто-маппинг с бэка
      const sug = (r.data && r.data.suggested_mapping) || {}
      setMapping(sug)
      setStep(2)
    } catch (e) {
      const detail = e?.response?.data?.detail || e.message
      setErr('Не удалось прочитать файл: ' + detail)
    } finally {
      setBusy(false)
    }
  }

  // ─── Шаг 4 → 5: execute ───
  async function executeImport() {
    setBusy(true); setErr(''); setResult(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('mapping', JSON.stringify(mapping))
      if (clinicId) fd.append('clinic_id', clinicId)
      fd.append('existing_strategy', strategy)
      fd.append('default_category', defaultCategory)
      if (defaultVendor.trim()) fd.append('default_vendor', defaultVendor.trim())
      if (incomeDate) fd.append('income_date', incomeDate)
      if (sheetName) fd.append('sheet_name', sheetName)
      const r = await api.post('/inventory/import/execute', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setResult(r.data || null)
      setStep(5)
      toast?.('Импорт завершён')
    } catch (e) {
      const detail = e?.response?.data?.detail || e.message
      setErr('Ошибка импорта: ' + detail)
      setStep(4)
    } finally {
      setBusy(false)
    }
  }

  // ─── Производные значения ───
  const headers = previewResp?.headers || []
  const previewRows = previewResp?.preview_rows || []
  const sheets = previewResp?.sheets || []
  const warnings = previewResp?.warnings || []
  const totalRows = previewResp?.total_rows ?? 0

  // Проверка обязательных полей маппинга
  const missingRequired = useMemo(() => {
    return TARGET_FIELDS.filter(f => f.required && !mapping[f.key])
  }, [mapping])

  // ─── Применение маппинга к строке для preview-таблицы ───
  function mapRow(row) {
    const out = {}
    for (const f of TARGET_FIELDS) {
      const h = mapping[f.key]
      out[f.key] = h ? row[h] : ''
    }
    return out
  }

  // ─── Шапка шагов ───
  const STEPS = [
    'Файл', 'Маппинг', 'Параметры', 'Превью', 'Готово',
  ]

  function StepperHeader() {
    return (
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {STEPS.map((s, i) => {
          const n = i + 1
          const active = n === step
          const done = n < step
          return (
            <div key={s} className="flex items-center gap-2">
              <div
                style={{
                  width: 26, height: 26, borderRadius: 999,
                  display: 'grid', placeItems: 'center',
                  fontSize: 12, fontWeight: 700,
                  background: done ? 'var(--accent)' : active ? 'var(--accent-soft)' : 'var(--bg-1)',
                  color: done ? '#fff' : active ? 'var(--accent)' : 'var(--fg-3)',
                  border: '1px solid ' + (done || active ? 'var(--accent)' : 'var(--border)'),
                }}
              >{done ? '✓' : n}</div>
              <div style={{ fontSize: 12.5, color: active ? 'var(--fg)' : 'var(--fg-3)', fontWeight: active ? 600 : 500 }}>{s}</div>
              {i < STEPS.length - 1 && (
                <div style={{ width: 18, height: 1, background: 'var(--border)' }} />
              )}
            </div>
          )
        })}
      </div>
    )
  }

  // ─── Контент по шагам ───
  function StepContent() {
    if (step === 1) {
      return (
        <div>
          <p style={{ marginBottom: 12, color: 'var(--fg-2)' }}>
            Выберите файл выгрузки из 1С — поддерживаются <b>.xlsx</b>, <b>.xls</b>, <b>.csv</b>.
          </p>
          <label
            style={{
              display: 'block', padding: 28, border: '2px dashed var(--border)',
              borderRadius: 12, textAlign: 'center', cursor: 'pointer',
              background: file ? 'var(--accent-soft)' : 'var(--bg-1)',
            }}
          >
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              style={{ display: 'none' }}
              onChange={(e) => { setFile(e.target.files?.[0] || null); setPreviewResp(null) }}
            />
            <div style={{ fontSize: 32, marginBottom: 6 }}>📂</div>
            {file ? (
              <>
                <div style={{ fontWeight: 600, color: 'var(--fg)' }}>{file.name}</div>
                <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>{fmtSize(file.size)}</div>
              </>
            ) : (
              <>
                <div style={{ fontWeight: 600, color: 'var(--fg)' }}>Нажмите и выберите файл</div>
                <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>или перетащите сюда</div>
              </>
            )}
          </label>

          {/* Лист Excel (необязательно — заполняется на шаге 2 если придёт несколько листов) */}
          <div style={{ marginTop: 12 }}>
            <label style={{ fontSize: 12, color: 'var(--fg-3)' }}>Лист Excel (опционально)</label>
            <input
              type="text"
              value={sheetName}
              onChange={(e) => setSheetName(e.target.value)}
              placeholder="например: Остатки"
              style={{
                width: '100%', marginTop: 4, padding: '8px 10px',
                border: '1px solid var(--border)', borderRadius: 8,
                background: 'var(--surface)', color: 'var(--fg)', fontSize: 13.5,
              }}
            />
          </div>
        </div>
      )
    }

    if (step === 2) {
      return (
        <div>
          <p style={{ marginBottom: 8, color: 'var(--fg-2)' }}>
            Подтвердите соответствие колонок файла нашим полям.
            Поля со <span style={{ color: 'var(--bad)' }}>*</span> — обязательные.
          </p>
          {sheets.length > 1 && (
            <div style={{ marginBottom: 10, padding: 10, background: 'var(--bg-1)', borderRadius: 8 }}>
              <label style={{ fontSize: 12, color: 'var(--fg-3)' }}>Лист Excel</label>
              <select
                value={sheetName}
                onChange={(e) => setSheetName(e.target.value)}
                style={{
                  width: '100%', marginTop: 4, padding: '8px 10px',
                  border: '1px solid var(--border)', borderRadius: 8,
                  background: 'var(--surface)', color: 'var(--fg)', fontSize: 13.5,
                }}
              >
                {sheets.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {TARGET_FIELDS.map(f => (
              <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 12, color: 'var(--fg-3)' }}>
                  {f.label}{f.required && <span style={{ color: 'var(--bad)' }}> *</span>}
                </label>
                <select
                  value={mapping[f.key] || ''}
                  onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value })}
                  style={{
                    padding: '7px 9px', border: '1px solid var(--border)',
                    borderRadius: 8, background: 'var(--surface)', color: 'var(--fg)', fontSize: 13,
                  }}
                >
                  <option value="">— не использовать —</option>
                  {headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>

          {missingRequired.length > 0 && (
            <div style={{ marginTop: 10, padding: 10, background: 'var(--bad-soft, #fee)', color: 'var(--bad)', borderRadius: 8, fontSize: 12.5 }}>
              Не заполнены обязательные поля: {missingRequired.map(f => f.label).join(', ')}
            </div>
          )}

          {warnings.length > 0 && (
            <div style={{ marginTop: 10, padding: 10, background: 'var(--bg-1)', borderRadius: 8, fontSize: 12.5, color: 'var(--fg-2)' }}>
              <b>Предупреждения парсера:</b>
              <ul style={{ paddingLeft: 18, margin: '4px 0 0 0' }}>
                {warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
        </div>
      )
    }

    if (step === 3) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Клиника */}
          <div>
            <label style={{ fontSize: 12, color: 'var(--fg-3)' }}>Клиника назначения</label>
            <select
              value={clinicId}
              onChange={(e) => setClinicId(e.target.value)}
              style={{
                width: '100%', marginTop: 4, padding: '8px 10px',
                border: '1px solid var(--border)', borderRadius: 8,
                background: 'var(--surface)', color: 'var(--fg)', fontSize: 13.5,
              }}
            >
              {clinics.length === 0 && <option value="">— нет доступных клиник —</option>}
              {clinics.map(c => (
                <option key={c.id || c.tenant_id} value={c.id || c.tenant_id}>
                  {c.name || c.slug || c.id}
                </option>
              ))}
            </select>
          </div>

          {/* Стратегия */}
          <div>
            <label style={{ fontSize: 12, color: 'var(--fg-3)' }}>Что делать с существующими SKU</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
              {STRATEGY_OPTIONS.map(opt => (
                <label
                  key={opt.value}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 8,
                    padding: 10, border: '1px solid var(--border)', borderRadius: 8,
                    background: strategy === opt.value ? 'var(--accent-soft)' : 'var(--surface)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name="ks-strategy"
                    checked={strategy === opt.value}
                    onChange={() => setStrategy(opt.value)}
                    style={{ marginTop: 3 }}
                  />
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--fg)', fontSize: 13 }}>{opt.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--fg-3)' }}>{opt.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Категория по умолчанию */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--fg-3)' }}>Категория по умолчанию</label>
              <select
                value={defaultCategory}
                onChange={(e) => setDefaultCategory(e.target.value)}
                style={{
                  width: '100%', marginTop: 4, padding: '8px 10px',
                  border: '1px solid var(--border)', borderRadius: 8,
                  background: 'var(--surface)', color: 'var(--fg)', fontSize: 13.5,
                }}
              >
                {CATEGORY_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--fg-3)' }}>Дата прихода</label>
              <input
                type="date"
                value={incomeDate}
                onChange={(e) => setIncomeDate(e.target.value)}
                style={{
                  width: '100%', marginTop: 4, padding: '7px 10px',
                  border: '1px solid var(--border)', borderRadius: 8,
                  background: 'var(--surface)', color: 'var(--fg)', fontSize: 13.5,
                }}
              />
            </div>
          </div>

          {/* Поставщик по умолчанию */}
          <div>
            <label style={{ fontSize: 12, color: 'var(--fg-3)' }}>Поставщик по умолчанию (опционально)</label>
            <input
              type="text"
              value={defaultVendor}
              onChange={(e) => setDefaultVendor(e.target.value)}
              placeholder="например: ООО «МедСнаб»"
              style={{
                width: '100%', marginTop: 4, padding: '8px 10px',
                border: '1px solid var(--border)', borderRadius: 8,
                background: 'var(--surface)', color: 'var(--fg)', fontSize: 13.5,
              }}
            />
          </div>
        </div>
      )
    }

    if (step === 4) {
      const sample = previewRows.slice(0, 10).map(mapRow)
      return (
        <div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <div style={{ padding: '6px 12px', borderRadius: 999, background: 'var(--accent-soft)', color: 'var(--accent)', fontSize: 12.5, fontWeight: 600 }}>
              Всего строк: {totalRows}
            </div>
            <div style={{ padding: '6px 12px', borderRadius: 999, background: 'var(--bg-1)', color: 'var(--fg-2)', fontSize: 12.5 }}>
              Стратегия: <b>{STRATEGY_OPTIONS.find(s => s.value === strategy)?.title}</b>
            </div>
            <div style={{ padding: '6px 12px', borderRadius: 999, background: 'var(--bg-1)', color: 'var(--fg-2)', fontSize: 12.5 }}>
              Клиника: <b>{clinics.find(c => String(c.id || c.tenant_id) === clinicId)?.name || '—'}</b>
            </div>
          </div>

          {warnings.length > 0 && (
            <div style={{ marginBottom: 10, padding: 10, background: 'var(--bg-1)', borderRadius: 8, fontSize: 12.5, color: 'var(--fg-2)' }}>
              <b>Предупреждения:</b>
              <ul style={{ paddingLeft: 18, margin: '4px 0 0 0' }}>
                {warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}

          <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead style={{ background: 'var(--bg-1)' }}>
                <tr>
                  {TARGET_FIELDS.filter(f => mapping[f.key]).map(f => (
                    <th key={f.key} style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border)', color: 'var(--fg-3)' }}>{f.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sample.map((row, i) => (
                  <tr key={i}>
                    {TARGET_FIELDS.filter(f => mapping[f.key]).map(f => (
                      <td key={f.key} style={{ padding: '7px 10px', borderBottom: '1px solid var(--border)', color: 'var(--fg)' }}>
                        {row[f.key] ?? '—'}
                      </td>
                    ))}
                  </tr>
                ))}
                {sample.length === 0 && (
                  <tr><td style={{ padding: 12, color: 'var(--fg-3)' }} colSpan={TARGET_FIELDS.length}>Превью пусто</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--fg-3)' }}>
            Показаны первые {sample.length} строк после применения маппинга.
            Полный импорт обработает все {totalRows} строк.
          </div>
        </div>
      )
    }

    if (step === 5) {
      if (busy) {
        return (
          <div style={{ padding: 24, textAlign: 'center' }}>
            <div className="w-10 h-10 rounded-full animate-spin" style={{ margin: '0 auto 12px', border: '3px solid var(--accent-soft)', borderTopColor: 'var(--accent)' }} />
            <div style={{ fontSize: 13, color: 'var(--fg-2)' }}>Импортируем данные…</div>
          </div>
        )
      }
      const r = result || {}
      return (
        <div>
          <div style={{ textAlign: 'center', padding: '10px 0 16px' }}>
            <div style={{ fontSize: 40, marginBottom: 4 }}>✅</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg)' }}>
              Импортировано: {r.rows_total ?? 0}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 12 }}>
            <Stat label="Создано"   value={r.rows_created} color="var(--good, #10b981)" />
            <Stat label="Обновлено" value={r.rows_updated} color="var(--accent)" />
            <Stat label="Пропущено" value={r.rows_skipped} color="var(--fg-3)" />
            <Stat label="Ошибки"    value={r.rows_failed}  color="var(--bad, #ef4444)" />
          </div>

          {Array.isArray(r.errors) && r.errors.length > 0 && (
            <div style={{ marginTop: 10, padding: 10, background: 'var(--bg-1)', borderRadius: 8, fontSize: 12.5 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Ошибки ({r.errors.length}):</div>
              <ul style={{ paddingLeft: 18, margin: 0, maxHeight: 160, overflow: 'auto' }}>
                {r.errors.slice(0, 50).map((er, i) => (
                  <li key={i} style={{ color: 'var(--fg-2)' }}>
                    {typeof er === 'string' ? er : `Строка ${er.row || '?'}: ${er.message || er.error || JSON.stringify(er)}`}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )
    }

    return null
  }

  // ─── Кнопки футера ───
  function FooterButtons() {
    if (step === 1) {
      return (
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Отмена</Button>
          <Button variant="primary" onClick={uploadPreview} disabled={!file || busy}>
            {busy ? 'Чтение…' : 'Далее →'}
          </Button>
        </>
      )
    }
    if (step === 2) {
      return (
        <>
          <Button variant="ghost" onClick={() => setStep(1)} disabled={busy}>← Назад</Button>
          <Button variant="primary" onClick={() => setStep(3)} disabled={missingRequired.length > 0 || busy}>
            Далее →
          </Button>
        </>
      )
    }
    if (step === 3) {
      return (
        <>
          <Button variant="ghost" onClick={() => setStep(2)} disabled={busy}>← Назад</Button>
          <Button variant="primary" onClick={() => setStep(4)} disabled={!clinicId || busy}>
            Далее →
          </Button>
        </>
      )
    }
    if (step === 4) {
      return (
        <>
          <Button variant="ghost" onClick={() => setStep(3)} disabled={busy}>← Назад</Button>
          <Button variant="primary" onClick={() => { setStep(5); executeImport() }} disabled={busy}>
            Импортировать ✓
          </Button>
        </>
      )
    }
    // step 5
    return (
      <>
        <Button
          variant="primary"
          onClick={() => { onDone?.(); onClose?.() }}
          disabled={busy}
        >
          Закрыть
        </Button>
      </>
    )
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title="Импорт остатков из 1С"
      size="lg"
      actions={<FooterButtons />}
    >
      <StepperHeader />
      <StepContent />
      {err && (
        <div style={{ marginTop: 10, padding: 10, background: 'var(--bad-soft, #fee)', color: 'var(--bad, #b91c1c)', borderRadius: 8, fontSize: 12.5 }}>
          {err}
        </div>
      )}
    </Modal>
  )
}

// ─── Подкомпонент: статистика результата ───
function Stat({ label, value, color }) {
  return (
    <div style={{ padding: 10, background: 'var(--bg-1)', borderRadius: 8, textAlign: 'center' }}>
      <div style={{ fontSize: 18, fontWeight: 700, color }}>{value ?? 0}</div>
      <div style={{ fontSize: 11, color: 'var(--fg-3)' }}>{label}</div>
    </div>
  )
}
