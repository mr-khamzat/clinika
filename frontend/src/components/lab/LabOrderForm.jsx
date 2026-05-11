/**
 * ========================================
 * БЛОК: LabOrderForm — форма создания заявки на анализы (Глава 10)
 * ========================================
 * Используется в DoctorLabOrdersSection (модалка «+ Новая заявка»).
 *
 * Что делает:
 *   1. Поиск пациента: GET /admin/patients/search?q= (с debounce 300ms)
 *      — если эндпойнт другой, передайте onSearchPatients(query) prop.
 *   2. Выбор провайдера лаборатории: список приходит из родителя (providers prop).
 *   3. Мульти-выбор тестов: либо из пресета PRESET_TESTS, либо free-text (chip).
 *   4. POST /doctor/lab-orders body { patient_id, provider_id, test_codes:[], notes }
 *
 * Props:
 *   open, onClose, onCreated(order), providers, api (axios instance)
 * ========================================
 */
import { useState, useEffect, useMemo } from 'react'
import { Modal, Button, Chip, useToast } from '../../design'

// Пресет популярных тестов (можно расширять). Backend принимает любые коды.
const PRESET_TESTS = [
  { code: 'CBC',         name: 'Общий анализ крови'         },
  { code: 'BIOCHEM',     name: 'Биохимия (10 показателей)'  },
  { code: 'LIPID',       name: 'Липидный профиль'           },
  { code: 'TSH',         name: 'ТТГ (щитовидка)'            },
  { code: 'T4_FREE',     name: 'Т4 свободный'               },
  { code: 'HBA1C',       name: 'Гликированный гемоглобин'   },
  { code: 'GLUCOSE',     name: 'Глюкоза крови'              },
  { code: 'VITAMIN_D',   name: 'Витамин D (25-OH)'          },
  { code: 'FERRITIN',    name: 'Ферритин'                   },
  { code: 'URINE',       name: 'Общий анализ мочи'          },
  { code: 'PSA',         name: 'ПСА общий'                  },
  { code: 'COVID_PCR',   name: 'COVID-19 ПЦР'               },
]

export default function LabOrderForm({ open, onClose, onCreated, providers = [], api }) {
  const { toast } = useToast()

  const [patientQuery, setPatientQuery] = useState('')
  const [patientResults, setPatientResults] = useState([])
  const [patientSearchBusy, setPatientSearchBusy] = useState(false)
  const [patient, setPatient] = useState(null)        // { id, name, phone }

  const [providerId, setProviderId] = useState('')
  const [selectedCodes, setSelectedCodes] = useState([])
  const [customCode, setCustomCode] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) {
      setPatient(null); setPatientQuery(''); setPatientResults([])
      setProviderId(''); setSelectedCodes([]); setCustomCode(''); setNotes('')
    }
  }, [open])

  // Поиск пациента (debounce 300ms)
  useEffect(() => {
    if (!open) return
    if (patient) return
    if (!patientQuery || patientQuery.length < 2) { setPatientResults([]); return }
    let alive = true
    const tid = setTimeout(async () => {
      setPatientSearchBusy(true)
      try {
        // Используем admin-эндпойнт поиска пациентов; если эндпойнт другой —
        // backend-агент уточнит. Падение здесь не критично, форма деградирует.
        const r = await api.get('/admin/patients/search', { params: { q: patientQuery, limit: 8 } })
        if (alive) setPatientResults(Array.isArray(r.data) ? r.data : (r.data?.patients || []))
      } catch {
        if (alive) setPatientResults([])
      } finally {
        if (alive) setPatientSearchBusy(false)
      }
    }, 300)
    return () => { alive = false; clearTimeout(tid) }
  }, [patientQuery, patient, open, api])

  const toggleCode = (code) => {
    setSelectedCodes(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code])
  }
  const addCustom = () => {
    const c = customCode.trim().toUpperCase()
    if (!c) return
    if (!selectedCodes.includes(c)) setSelectedCodes([...selectedCodes, c])
    setCustomCode('')
  }

  const canSubmit = useMemo(
    () => !!patient?.id && !!providerId && selectedCodes.length > 0 && !busy,
    [patient, providerId, selectedCodes, busy]
  )

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    try {
      const r = await api.post('/doctor/lab-orders', {
        patient_id: patient.id,
        provider_id: Number(providerId),
        test_codes: selectedCodes,
        notes: notes || undefined,
      })
      toast({ kind: 'success', text: 'Заявка создана' })
      onCreated && onCreated(r.data)
      onClose && onClose()
    } catch (e) {
      const msg = e?.response?.data?.detail || 'Не удалось создать заявку'
      toast({ kind: 'error', text: msg })
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <Modal open={open} onClose={onClose} title="Новая заявка на анализы" size="lg">
      <div className="flex flex-col gap-4" style={{ minWidth: 320 }}>

        {/* ── 1. Пациент ───────────────────────────────────────────── */}
        <div>
          <label className="block mb-1.5" style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Пациент
          </label>
          {patient ? (
            <div
              className="flex items-center justify-between rounded-xl"
              style={{ padding: '10px 12px', background: '#ecfeff', border: '1px solid #a5f3fc' }}
            >
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: '#0e7490' }}>{patient.full_name || patient.name}</div>
                <div style={{ fontSize: 11.5, color: '#0891b2' }}>{patient.phone || `id ${patient.id}`}</div>
              </div>
              <button
                onClick={() => { setPatient(null); setPatientQuery('') }}
                className="text-xs font-semibold"
                style={{ color: '#0e7490' }}
              >
                сменить
              </button>
            </div>
          ) : (
            <>
              <input
                value={patientQuery}
                onChange={(e) => setPatientQuery(e.target.value)}
                placeholder="ФИО или телефон…"
                className="w-full rounded-xl"
                style={{
                  padding: '10px 12px',
                  border: '1px solid #e2e8f0', background: '#fff',
                  fontSize: 13, outline: 'none',
                }}
              />
              {patientSearchBusy && (
                <div style={{ fontSize: 11, color: '#94a3b8', padding: '4px 4px 0' }}>Ищем…</div>
              )}
              {patientResults.length > 0 && (
                <div
                  className="rounded-xl mt-1"
                  style={{ border: '1px solid #e2e8f0', maxHeight: 200, overflow: 'auto' }}
                >
                  {patientResults.map(p => (
                    <button
                      key={p.id}
                      onClick={() => setPatient(p)}
                      className="w-full text-left transition-colors hover:bg-gray-50"
                      style={{ padding: '8px 12px', borderBottom: '1px solid #f1f5f9' }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                        {p.full_name || p.name || '—'}
                      </div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>{p.phone || ''}</div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── 2. Провайдер лаборатории ────────────────────────────── */}
        <div>
          <label className="block mb-1.5" style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Лаборатория
          </label>
          <select
            value={providerId}
            onChange={(e) => setProviderId(e.target.value)}
            className="w-full rounded-xl"
            style={{
              padding: '10px 12px',
              border: '1px solid #e2e8f0', background: '#fff',
              fontSize: 13, outline: 'none',
            }}
          >
            <option value="">— выберите провайдера —</option>
            {providers
              .filter(pr => pr.active !== false)
              .map(pr => (
                <option key={pr.id} value={pr.id}>
                  {pr.name}{pr.provider_type ? ` · ${pr.provider_type}` : ''}
                </option>
              ))}
          </select>
          {providers.length === 0 && (
            <div style={{ fontSize: 11, color: '#b45309', marginTop: 6 }}>
              Провайдеров пока нет — попросите управляющего настроить лабораторию.
            </div>
          )}
        </div>

        {/* ── 3. Тесты ─────────────────────────────────────────────── */}
        <div>
          <label className="block mb-1.5" style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Тесты ({selectedCodes.length})
          </label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {PRESET_TESTS.map(t => {
              const on = selectedCodes.includes(t.code)
              return (
                <button
                  key={t.code}
                  type="button"
                  onClick={() => toggleCode(t.code)}
                  className="transition-colors"
                  style={{
                    fontSize: 12, padding: '5px 10px', borderRadius: 999,
                    background: on ? '#0ea5e9' : '#f1f5f9',
                    color: on ? '#fff' : '#475569',
                    border: on ? '1px solid #0284c7' : '1px solid #e2e8f0',
                    fontWeight: on ? 700 : 500,
                  }}
                >
                  {t.name}
                </button>
              )
            })}
          </div>

          {/* Произвольный код */}
          <div className="flex gap-2">
            <input
              value={customCode}
              onChange={(e) => setCustomCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCustom())}
              placeholder="Свой код (напр. ALT)"
              className="flex-1 rounded-xl"
              style={{ padding: '8px 12px', border: '1px solid #e2e8f0', fontSize: 12.5, outline: 'none' }}
            />
            <Button size="sm" variant="secondary" onClick={addCustom}>+</Button>
          </div>

          {selectedCodes.filter(c => !PRESET_TESTS.find(p => p.code === c)).length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {selectedCodes.filter(c => !PRESET_TESTS.find(p => p.code === c)).map(c => (
                <Chip key={c} variant="accent" onClick={() => toggleCode(c)}>{c} ✕</Chip>
              ))}
            </div>
          )}
        </div>

        {/* ── 4. Комментарий ──────────────────────────────────────── */}
        <div>
          <label className="block mb-1.5" style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Комментарий (опц.)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Особые указания для лаборатории…"
            className="w-full rounded-xl"
            style={{ padding: '10px 12px', border: '1px solid #e2e8f0', fontSize: 13, outline: 'none', resize: 'vertical' }}
          />
        </div>

        {/* ── Footer ──────────────────────────────────────────────── */}
        <div className="flex items-center justify-end gap-2 pt-2" style={{ borderTop: '1px solid #f1f5f9' }}>
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {busy ? 'Создаём…' : 'Создать заявку'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
