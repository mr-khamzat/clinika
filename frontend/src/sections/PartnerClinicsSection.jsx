/**
 * ========================================
 * БЛОК: PartnerClinicsSection — клиники-партнёры франшизы (Этап 14)
 * ========================================
 * Каждая Clinic в составе тенанта франшизы — это партнёр (а не филиал) с
 * собственным контрактом:
 *   - royalty       — % с выручки подтверждённых направлений
 *   - per_referral  — фиксированный ₽ за каждое подтверждённое направление
 *   - hybrid        — оба механизма одновременно
 *
 * Что показываем:
 *   - таблица всех клиник-партнёров с ключевыми параметрами контракта
 *   - расчёт ожидаемой выплаты за 30 дней (POST /calculate)
 *   - модалка редактирования контракта
 *   - паузa / возобновление / расторжение через useConfirm
 *
 * API:
 *   GET    /franchise-owner/partner-clinics
 *   PATCH  /franchise-owner/partner-clinics/{id}/contract
 *   POST   /franchise-owner/partner-clinics/{id}/calculate?period_days=30
 *   POST   /franchise-owner/partner-clinics/{id}/pause | /resume | /terminate
 * ========================================
 */
import { useEffect, useMemo, useState } from 'react'
import api from '../api'
import {
  Card,
  Button,
  Chip,
  Modal,
  EmptyState,
  InfoHint,
  useToast,
  useConfirm,
} from '../design'

// ── Хелперы ─────────────────────────────────────────────────────────────────

const fmtRub = (v) => {
  const n = Number(v || 0)
  if (!Number.isFinite(n)) return '—'
  return `${n.toLocaleString('ru')} ₽`
}

const fmtDate = (iso) => {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('ru', {
      year: 'numeric', month: '2-digit', day: '2-digit',
    })
  } catch { return '—' }
}

const toInputDate = (iso) => {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  } catch { return '' }
}

// Локальная иконка material symbols (как в основном кабинете).
function Icon({ name, size = 18, fill = 0, style = {} }) {
  return (
    <span
      className="material-symbols-outlined"
      style={{
        fontSize: size,
        fontVariationSettings: `'FILL' ${fill}, 'wght' 500, 'opsz' 24`,
        lineHeight: 1,
        display: 'inline-flex',
        ...style,
      }}
    >{name}</span>
  )
}

const CONTRACT_LABEL = {
  royalty:      { text: '% с выручки',      tone: 'accent' },
  per_referral: { text: '₽ за направление', tone: 'good'   },
  hybrid:       { text: 'Гибрид % + ₽',     tone: 'warn'   },
}

const STATUS_LABEL = {
  active:     { text: 'Активен',    tone: 'good'    },
  paused:     { text: 'На паузе',   tone: 'warn'    },
  terminated: { text: 'Расторгнут', tone: 'bad'     },
}

const REVENUE_SOURCE_LABEL = {
  mis:    'МИС (auto)',
  manual: 'Вручную',
  export: 'Импорт/экспорт',
}

const HINT_TEXT = (
  <div style={{ fontSize: 13, lineHeight: 1.5 }}>
    <b>Клиники-партнёры</b> — это клиники под вашим тенантом, которые работают
    с франшизой по контракту. Возможные типы контракта:
    <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
      <li><b>% с выручки</b> — роялти от подтверждённых направлений.</li>
      <li><b>₽ за направление</b> — фикс. сумма за каждое подтверждённое направление.</li>
      <li><b>Гибрид</b> — оба механизма одновременно.</li>
    </ul>
    <div style={{ marginTop: 8, color: 'var(--fg-3)' }}>
      Расчёт за 30 дней — это <b>предпросмотр</b>, фактические начисления делает отдельный cron.
    </div>
  </div>
)

// ── Модалка редактирования контракта ─────────────────────────────────────────
function ContractEditModal({ open, partner, onClose, onSaved, adminToken }) {
  const toast = useToast()
  const [form, setForm] = useState({
    contract_type: '',
    royalty_percent: '',
    bonus_per_referral: '',
    contract_signed_at: '',
    contract_expires_at: '',
    revenue_source: '',
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!partner) return
    setForm({
      contract_type: partner.contract_type || '',
      royalty_percent: partner.royalty_percent != null ? String(partner.royalty_percent) : '',
      bonus_per_referral: partner.bonus_per_referral != null ? String(partner.bonus_per_referral) : '',
      contract_signed_at: toInputDate(partner.contract_signed_at),
      contract_expires_at: toInputDate(partner.contract_expires_at),
      revenue_source: partner.revenue_source || '',
    })
  }, [partner])

  if (!open || !partner) return null

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async () => {
    // ── Валидация: тип контракта обязателен; ставки соответствуют типу ────
    if (!form.contract_type) {
      toast?.error?.('Выберите тип контракта') || alert('Выберите тип контракта')
      return
    }
    if ((form.contract_type === 'royalty' || form.contract_type === 'hybrid')
        && (form.royalty_percent === '' || Number.isNaN(Number(form.royalty_percent)))) {
      toast?.error?.('Укажите процент роялти')
      return
    }
    if ((form.contract_type === 'per_referral' || form.contract_type === 'hybrid')
        && (form.bonus_per_referral === '' || Number.isNaN(Number(form.bonus_per_referral)))) {
      toast?.error?.('Укажите бонус за направление')
      return
    }

    setSaving(true)
    try {
      const body = {
        contract_type: form.contract_type,
        royalty_percent: form.royalty_percent === '' ? null : Number(form.royalty_percent),
        bonus_per_referral: form.bonus_per_referral === '' ? null : Number(form.bonus_per_referral),
        contract_signed_at: form.contract_signed_at ? new Date(form.contract_signed_at).toISOString() : null,
        contract_expires_at: form.contract_expires_at ? new Date(form.contract_expires_at).toISOString() : null,
        revenue_source: form.revenue_source || null,
      }
      await api.patch(
        `/franchise-owner/partner-clinics/${partner.id}/contract`,
        body,
      )
      toast?.success?.('Контракт обновлён')
      onSaved?.()
      onClose?.()
    } catch (e) {
      const msg = e?.response?.data?.detail || e.message
      toast?.error?.('Ошибка: ' + msg)
    } finally {
      setSaving(false)
    }
  }

  // ── Какие поля показываем в зависимости от типа ──────────────────────────
  const showRoyalty = form.contract_type === 'royalty' || form.contract_type === 'hybrid'
  const showPerRef  = form.contract_type === 'per_referral' || form.contract_type === 'hybrid'

  return (
    <Modal open={open} onClose={onClose} title={`Контракт: ${partner.name}`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={{ fontSize: 12, color: 'var(--fg-3)', fontWeight: 500 }}>Тип контракта</label>
          <select
            value={form.contract_type}
            onChange={(e) => set('contract_type', e.target.value)}
            style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, marginTop: 4, background: 'var(--bg-1)', color: 'var(--fg)' }}
          >
            <option value="">— не задан —</option>
            <option value="royalty">% с выручки (royalty)</option>
            <option value="per_referral">₽ за направление (per_referral)</option>
            <option value="hybrid">Гибрид (royalty + per_referral)</option>
          </select>
        </div>

        {showRoyalty && (
          <div>
            <label style={{ fontSize: 12, color: 'var(--fg-3)', fontWeight: 500 }}>Ставка роялти, %</label>
            <input
              type="number" min="0" max="100" step="0.01"
              value={form.royalty_percent}
              onChange={(e) => set('royalty_percent', e.target.value)}
              placeholder="например 5.50"
              style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, marginTop: 4, background: 'var(--bg-1)', color: 'var(--fg)' }}
            />
          </div>
        )}

        {showPerRef && (
          <div>
            <label style={{ fontSize: 12, color: 'var(--fg-3)', fontWeight: 500 }}>Бонус за направление, ₽</label>
            <input
              type="number" min="0" step="0.01"
              value={form.bonus_per_referral}
              onChange={(e) => set('bonus_per_referral', e.target.value)}
              placeholder="например 500"
              style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, marginTop: 4, background: 'var(--bg-1)', color: 'var(--fg)' }}
            />
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--fg-3)', fontWeight: 500 }}>Подписан</label>
            <input
              type="date"
              value={form.contract_signed_at}
              onChange={(e) => set('contract_signed_at', e.target.value)}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, marginTop: 4, background: 'var(--bg-1)', color: 'var(--fg)' }}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--fg-3)', fontWeight: 500 }}>Истекает</label>
            <input
              type="date"
              value={form.contract_expires_at}
              onChange={(e) => set('contract_expires_at', e.target.value)}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, marginTop: 4, background: 'var(--bg-1)', color: 'var(--fg)' }}
            />
          </div>
        </div>

        <div>
          <label style={{ fontSize: 12, color: 'var(--fg-3)', fontWeight: 500 }}>Источник данных о выручке</label>
          <select
            value={form.revenue_source}
            onChange={(e) => set('revenue_source', e.target.value)}
            style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, marginTop: 4, background: 'var(--bg-1)', color: 'var(--fg)' }}
          >
            <option value="">— не задан —</option>
            <option value="mis">МИС (автоматически)</option>
            <option value="manual">Вручную</option>
            <option value="export">Импорт/экспорт файла</option>
          </select>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Отмена</Button>
          <Button variant="primary" onClick={submit} disabled={saving}>
            {saving ? 'Сохранение…' : 'Сохранить контракт'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Главный экспорт секции ───────────────────────────────────────────────────
export default function PartnerClinicsSection({ adminToken }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [partners, setPartners] = useState([])
  const [loading, setLoading] = useState(true)
  // payouts: { [clinic_id]: {confirmed_referrals, total_amount, ...} }
  const [payouts, setPayouts] = useState({})
  const [editing, setEditing] = useState(null)
  // Состояние подписки модуля ltv_pro по тенантам: { [tenant_id]: bool }
  const [ltvByTenant, setLtvByTenant] = useState({})
  const [enablingLtv, setEnablingLtv] = useState({}) // { [tenant_id]: true }

  // Подгружаем подписки на ltv_pro для всех видимых тенантов (только super_admin
  // имеет доступ к /admin/tenants/{id}/modules; для franchise-owner — пропускаем).
  const loadLtvForTenants = async (tenantIds) => {
    if (!tenantIds.length) return
    try {
      const results = await Promise.all(tenantIds.map(async (tid) => {
        try {
          const r = await api.get(`/admin/tenants/${tid}/modules`)
          const items = Array.isArray(r.data) ? r.data : []
          const sub = items.find(x => x.module?.key === 'ltv_pro')?.subscription
          const active = !!sub && ['active', 'trial', 'grace'].includes(sub.status)
          return [tid, active]
        } catch {
          return [tid, false]
        }
      }))
      const map = {}
      for (const [tid, val] of results) map[tid] = val
      setLtvByTenant(prev => ({ ...prev, ...map }))
    } catch { /* ignore */ }
  }

  // Включить ltv_pro на 14 дней пробного периода
  const enableLtvForTenant = async (tenantId, tenantName) => {
    const ok = await confirm({
      title: 'Подключить LTV-аналитику?',
      message: `Тенант: ${tenantName}. Будет создана подписка ltv_pro с пробным периодом 14 дней.`,
      confirmText: 'Подключить',
    })
    if (!ok) return
    setEnablingLtv(s => ({ ...s, [tenantId]: true }))
    try {
      await api.post(
        `/admin/tenants/${tenantId}/modules/ltv_pro/enable`,
        { billing_cycle: 'monthly', trial_days: 14 },
      )
      toast?.success?.('LTV-аналитика подключена (trial 14 дней)')
      setLtvByTenant(prev => ({ ...prev, [tenantId]: true }))
    } catch (e) {
      const msg = e?.response?.data?.detail || e.message
      toast?.error?.('Ошибка подключения: ' + msg)
    } finally {
      setEnablingLtv(s => ({ ...s, [tenantId]: false }))
    }
  }

  const reload = async () => {
    setLoading(true)
    try {
      const r = await api.get('/franchise-owner/partner-clinics')
      setPartners(Array.isArray(r.data) ? r.data : [])
    } catch (e) {
      const msg = e?.response?.data?.detail || e.message
      toast?.error?.('Не удалось загрузить партнёров: ' + msg)
      setPartners([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() /* eslint-disable-next-line */ }, [])

  // ── Подсчёт выплат за 30 дней (ленивая дозагрузка по строкам) ────────────
  const calcPayout = async (clinicId) => {
    try {
      const r = await api.post(
        `/franchise-owner/partner-clinics/${clinicId}/calculate?period_days=30`,
        null,
      )
      setPayouts(p => ({ ...p, [clinicId]: r.data }))
      return r.data
    } catch (e) {
      const msg = e?.response?.data?.detail || e.message
      toast?.error?.('Ошибка расчёта: ' + msg)
      return null
    }
  }

  // ── При первой загрузке партнёров — фоном считаем выплату по каждому ─────
  useEffect(() => {
    if (!partners.length) return
    let cancelled = false
    ;(async () => {
      for (const p of partners) {
        if (cancelled) break
        if (!payouts[p.id]) {
          await calcPayout(p.id)
        }
      }
    })()
    // Параллельно подгружаем статусы ltv_pro по уникальным тенантам
    const uniqueTenants = Array.from(new Set(
      partners.map(p => p.tenant_id).filter(Boolean)
    ))
    loadLtvForTenants(uniqueTenants)
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partners])

  // ── Action: пауза / resume / terminate ───────────────────────────────────
  const setStatus = async (partner, action, label) => {
    const ok = await confirm({
      title: `${label}?`,
      message: `Партнёр: ${partner.name}. Подтвердить действие «${label.toLowerCase()}»?`,
      confirmText: label,
      tone: action === 'terminate' ? 'danger' : 'default',
    })
    if (!ok) return
    try {
      await api.post(
        `/franchise-owner/partner-clinics/${partner.id}/${action}`,
        null,
      )
      toast?.success?.(`Готово: ${label.toLowerCase()}`)
      await reload()
    } catch (e) {
      const msg = e?.response?.data?.detail || e.message
      toast?.error?.('Ошибка: ' + msg)
    }
  }

  // ── Отрисовка ставки контракта в таблице ─────────────────────────────────
  const rateText = (p) => {
    if (!p.contract_type) return '—'
    if (p.contract_type === 'royalty')      return p.royalty_percent != null ? `${p.royalty_percent}%` : '—'
    if (p.contract_type === 'per_referral') return p.bonus_per_referral != null ? fmtRub(p.bonus_per_referral) : '—'
    if (p.contract_type === 'hybrid') {
      const a = p.royalty_percent != null ? `${p.royalty_percent}%` : '—'
      const b = p.bonus_per_referral != null ? fmtRub(p.bonus_per_referral) : '—'
      return `${a} + ${b}`
    }
    return '—'
  }

  // ── Видимые в таблице элементы ──────────────────────────────────────────
  const visible = useMemo(() => partners, [partners])

  return (
    <div className="flex flex-col gap-4">
      {/* ─── Заголовок секции ─── */}
      <div className="flex items-center gap-2 flex-wrap">
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--fg)' }}>Клиники-партнёры</div>
        <InfoHint>{HINT_TEXT}</InfoHint>
        <div className="flex-1" />
        <Button variant="ghost" leftIcon={<Icon name="refresh" size={16} />} onClick={reload}>
          Обновить
        </Button>
      </div>

      {/* ─── Тело: таблица или EmptyState ─── */}
      {loading ? (
        <Card><div style={{ padding: 24, color: 'var(--fg-3)' }}>Загрузка…</div></Card>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Icon name="medical_services" size={28} />}
            title="Нет клиник-партнёров"
            message="Партнёры появятся здесь после создания клиник в составе ваших тенантов."
          />
        </Card>
      ) : (
        <Card padded={false}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--fg-3)' }}>
                  <th style={{ textAlign: 'left',  padding: '12px 10px', fontWeight: 600 }}>Клиника</th>
                  <th style={{ textAlign: 'left',  padding: '12px 10px', fontWeight: 600 }}>Тип контракта</th>
                  <th style={{ textAlign: 'left',  padding: '12px 10px', fontWeight: 600 }}>Ставка</th>
                  <th style={{ textAlign: 'left',  padding: '12px 10px', fontWeight: 600 }}>Подписан</th>
                  <th style={{ textAlign: 'left',  padding: '12px 10px', fontWeight: 600 }}>Истекает</th>
                  <th style={{ textAlign: 'left',  padding: '12px 10px', fontWeight: 600 }}>Статус</th>
                  <th style={{ textAlign: 'right', padding: '12px 10px', fontWeight: 600 }}>Расчёт ₽ (30д)</th>
                  <th style={{ textAlign: 'right', padding: '12px 10px', fontWeight: 600 }}>Действия</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(p => {
                  const ct = CONTRACT_LABEL[p.contract_type] || null
                  const st = STATUS_LABEL[p.partner_status] || STATUS_LABEL.active
                  const payout = payouts[p.id]
                  const isPaused = p.partner_status === 'paused'
                  const isTerm   = p.partner_status === 'terminated'
                  return (
                    <tr key={p.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px' }}>
                        <div style={{ fontWeight: 600, color: 'var(--fg)' }}>{p.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--fg-4)' }}>
                          {p.tenant_name || '—'}{p.address ? ` · ${p.address}` : ''}
                        </div>
                      </td>
                      <td style={{ padding: '10px' }}>
                        {ct ? <Chip variant={ct.tone}>{ct.text}</Chip> : <span style={{ color: 'var(--fg-4)' }}>—</span>}
                        {p.revenue_source && (
                          <div style={{ fontSize: 11, color: 'var(--fg-4)', marginTop: 4 }}>
                            {REVENUE_SOURCE_LABEL[p.revenue_source] || p.revenue_source}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '10px', fontVariantNumeric: 'tabular-nums' }}>
                        {rateText(p)}
                      </td>
                      <td style={{ padding: '10px' }}>{fmtDate(p.contract_signed_at)}</td>
                      <td style={{ padding: '10px' }}>{fmtDate(p.contract_expires_at)}</td>
                      <td style={{ padding: '10px' }}>
                        <Chip variant={st.tone} dot>{st.text}</Chip>
                      </td>
                      <td style={{ padding: '10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {payout
                          ? <>
                              <div style={{ fontWeight: 700, color: 'var(--fg)' }}>{fmtRub(payout.total_amount)}</div>
                              <div style={{ fontSize: 11, color: 'var(--fg-4)' }}>
                                {payout.confirmed_referrals} напр.
                              </div>
                            </>
                          : <span style={{ color: 'var(--fg-4)' }}>…</span>}
                      </td>
                      <td style={{ padding: '10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <Button
                          variant="ghost" size="sm"
                          leftIcon={<Icon name="edit" size={14} />}
                          onClick={() => setEditing(p)}
                        >Контракт</Button>
                        {/* ── Кнопка LTV-аналитики ── */}
                        {p.tenant_id && (ltvByTenant[p.tenant_id]
                          ? <Button
                              variant="ghost" size="sm"
                              leftIcon={<Icon name="check_circle" size={14} />}
                              disabled
                            >LTV подключено</Button>
                          : <Button
                              variant="ghost" size="sm"
                              leftIcon={<Icon name="insights" size={14} />}
                              onClick={() => enableLtvForTenant(p.tenant_id, p.tenant_name || p.name)}
                              disabled={!!enablingLtv[p.tenant_id]}
                            >{enablingLtv[p.tenant_id] ? 'Подключение…' : 'LTV-аналитика'}</Button>
                        )}
                        {!isTerm && (isPaused
                          ? <Button
                              variant="ghost" size="sm"
                              leftIcon={<Icon name="play_arrow" size={14} />}
                              onClick={() => setStatus(p, 'resume', 'Возобновить')}
                            >Возобновить</Button>
                          : <Button
                              variant="ghost" size="sm"
                              leftIcon={<Icon name="pause" size={14} />}
                              onClick={() => setStatus(p, 'pause', 'Поставить на паузу')}
                            >Пауза</Button>
                        )}
                        {!isTerm && (
                          <Button
                            variant="ghost" size="sm"
                            leftIcon={<Icon name="block" size={14} />}
                            onClick={() => setStatus(p, 'terminate', 'Расторгнуть')}
                          >Расторгнуть</Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ─── Модалка редактирования контракта ─── */}
      <ContractEditModal
        open={!!editing}
        partner={editing}
        adminToken={adminToken}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          await reload()
          if (editing?.id) {
            // пересчёт выплаты после смены условий
            await calcPayout(editing.id)
          }
        }}
      />
    </div>
  )
}
