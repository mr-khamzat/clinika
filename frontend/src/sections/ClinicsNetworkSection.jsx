/**
 * ========================================
 * БЛОК: <ClinicsNetworkSection>
 * ========================================
 * Раздел «Клиники сети» в кабинете franchise_owner.
 * Показывает 5 карточек (по числу тенантов франшизы) с краткой информацией:
 *   • название клиники + slug
 *   • адрес
 *   • контракт-метрика (тип контракта + ставки)
 *   • руководитель (ФИО / username) или предупреждение если его нет
 *
 * Клик на любую карточку → открывается <ClinicEditModal /> для этой клиники
 * с двумя вкладками: «Реквизиты» и «Руководитель».
 *
 * Источник данных: GET /franchise-owner/clinics
 *
 * Props:
 *   adminToken — JWT для api (используется auto через axios interceptor,
 *                принимается для совместимости с другими секциями).
 * ========================================
 */
import { useCallback, useEffect, useState } from 'react'
import api from '../api'
import {
  Card,
  Chip,
  Button,
  EmptyState,
} from '../design'
import ClinicEditModal from '../components/ClinicEditModal'

// ── Иконка material через span ──────────────────────────────────────────────
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

// ── Лейблы типа контракта ───────────────────────────────────────────────────
const CONTRACT_LABEL = {
  royalty: 'Royalty',
  per_referral: 'Per referral',
  hybrid: 'Hybrid',
}

function ContractMetric({ clinic }) {
  const ct = clinic.contract_type
  if (!ct) {
    return (
      <Chip variant="warn" dot>контракт не задан</Chip>
    )
  }
  const parts = []
  if ((ct === 'royalty' || ct === 'hybrid') && clinic.royalty_percent != null) {
    parts.push(`${clinic.royalty_percent}%`)
  }
  if ((ct === 'per_referral' || ct === 'hybrid') && clinic.bonus_per_referral != null) {
    parts.push(`${Number(clinic.bonus_per_referral).toLocaleString('ru')} ₽`)
  }
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Chip variant="accent">{CONTRACT_LABEL[ct] || ct}</Chip>
      {parts.length > 0 && (
        <span style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>{parts.join(' · ')}</span>
      )}
    </div>
  )
}

// ── Карточка одной клиники ──────────────────────────────────────────────────
function ClinicCard({ item, onClick }) {
  const isActive = item.is_active
  const hasManager = !!item.manager
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        boxShadow: 'var(--shadow-sm)',
        padding: '16px',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        transition: 'transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-1px)'
        e.currentTarget.style.borderColor = 'var(--accent)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.borderColor = 'var(--border)'
      }}
    >
      {/* Шапка: иконка + name + slug + статус */}
      <div className="flex items-start gap-3">
        <div
          className="grid place-items-center flex-shrink-0"
          style={{
            width: 44, height: 44, borderRadius: 11,
            background: isActive ? 'var(--accent-soft)' : 'var(--bg-2)',
            color: isActive ? 'var(--accent)' : 'var(--fg-4)',
          }}
        >
          <Icon name="corporate_fare" size={22} fill={1} />
        </div>
        <div className="flex-1 min-w-0">
          <div
            className="font-semibold truncate"
            style={{
              fontSize: 14,
              color: isActive ? 'var(--fg)' : 'var(--fg-3)',
              textDecoration: isActive ? 'none' : 'line-through',
            }}
          >{item.name}</div>
          <div className="font-mono truncate" style={{ fontSize: 11, color: 'var(--fg-4)' }}>
            /{item.slug}
          </div>
        </div>
        <Chip variant={isActive ? 'good' : 'default'} dot={isActive}>
          {isActive ? 'активна' : 'неактивна'}
        </Chip>
      </div>

      {/* Адрес и телефон */}
      <div className="flex flex-col gap-1.5" style={{ fontSize: 12, color: 'var(--fg-2)' }}>
        <div className="flex items-start gap-1.5">
          <Icon name="place" size={14} style={{ color: 'var(--fg-4)', marginTop: 1 }} />
          <span className="flex-1" style={{ wordBreak: 'break-word' }}>
            {item.address || <span style={{ color: 'var(--fg-4)' }}>адрес не указан</span>}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Icon name="call" size={14} style={{ color: 'var(--fg-4)' }} />
          <span>{item.phone || <span style={{ color: 'var(--fg-4)' }}>—</span>}</span>
        </div>
      </div>

      {/* Контракт */}
      <div
        className="rounded-lg p-2.5"
        style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}
      >
        <div
          className="font-bold uppercase mb-1"
          style={{ fontSize: 9.5, color: 'var(--fg-4)', letterSpacing: '0.08em' }}
        >Контракт</div>
        <ContractMetric clinic={item} />
      </div>

      {/* Руководитель */}
      <div
        className="rounded-lg p-2.5 flex items-center gap-2"
        style={{
          background: hasManager ? 'var(--bg-1)' : 'var(--warn-soft)',
          border: `1px solid ${hasManager ? 'var(--border)' : 'var(--warn-soft)'}`,
        }}
      >
        <Icon
          name={hasManager ? 'badge' : 'person_off'}
          size={18}
          fill={1}
          style={{ color: hasManager ? 'var(--accent)' : 'var(--warn)' }}
        />
        <div className="flex-1 min-w-0">
          {hasManager ? (
            <>
              <div
                className="font-semibold truncate"
                style={{ fontSize: 12.5, color: 'var(--fg)' }}
              >{item.manager.full_name}</div>
              <div
                className="font-mono truncate"
                style={{ fontSize: 11, color: 'var(--fg-4)' }}
              >{item.manager.username}</div>
            </>
          ) : (
            <div className="font-medium" style={{ fontSize: 12.5, color: 'var(--warn)' }}>
              Руководитель не назначен
            </div>
          )}
        </div>
        <Icon name="chevron_right" size={18} style={{ color: 'var(--fg-4)' }} />
      </div>
    </button>
  )
}

// ============================================================================
// БЛОК: главный компонент секции
// ============================================================================
export default function ClinicsNetworkSection({ adminToken: _adminToken } = {}) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedTenantId, setSelectedTenantId] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)

  // ── Загрузка списка ──────────────────────────────────────────────────────
  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const r = await api.get('/franchise-owner/clinics')
      setItems(Array.isArray(r.data) ? r.data : [])
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Ошибка загрузки')
      setItems([])
    }
    setLoading(false)
  }, [])

  useEffect(() => { reload() }, [reload])

  const openModal = (id) => {
    setSelectedTenantId(id)
    setModalOpen(true)
  }
  const closeModal = () => {
    setModalOpen(false)
    // selectedTenantId оставляем — модалка анимируется на закрытии
    setTimeout(() => setSelectedTenantId(null), 250)
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">
      {/* ─── Сводка ─── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div style={{ fontSize: 13, color: 'var(--fg-3)' }}>
          Всего клиник в сети: <b style={{ color: 'var(--fg)' }}>{items.length}</b>
          {items.some(i => !i.manager) && (
            <span className="ml-3" style={{ color: 'var(--warn)' }}>
              {items.filter(i => !i.manager).length} без руководителя
            </span>
          )}
        </div>
        <Button
          size="sm"
          variant="secondary"
          leftIcon={<Icon name="refresh" size={16} />}
          onClick={reload}
          disabled={loading}
        >
          Обновить
        </Button>
      </div>

      {/* ─── Сообщение об ошибке ─── */}
      {error && (
        <div
          className="px-4 py-3"
          style={{
            fontSize: 13, fontWeight: 500,
            color: 'var(--bad)',
            background: 'var(--bad-soft)',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--bad-soft)',
          }}
        >
          {error}
        </div>
      )}

      {/* ─── Список карточек ─── */}
      {loading ? (
        <div className="py-10 text-center" style={{ color: 'var(--fg-3)', fontSize: 13 }}>
          Загрузка…
        </div>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Icon name="business" size={28} />}
            title="Нет клиник в сети"
            message="Перейдите в раздел «Клиники» и создайте первый тенант."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {items.map(item => (
            <ClinicCard
              key={item.tenant_id}
              item={item}
              onClick={() => openModal(item.tenant_id)}
            />
          ))}
        </div>
      )}

      {/* ─── Модалка редактирования ─── */}
      <ClinicEditModal
        open={modalOpen}
        onClose={closeModal}
        tenantId={selectedTenantId}
        onSaved={reload}
      />
    </div>
  )
}
