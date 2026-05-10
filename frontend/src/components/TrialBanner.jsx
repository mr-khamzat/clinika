/**
 * ====================================================================
 * БЛОК: TrialBanner — баннер о статусе триала (Глава 2 ROADMAP)
 * ====================================================================
 * Жёлтая полоса при «expiring_soon» (<=3 дня) или красная при «expired».
 * Показывается ТОЛЬКО владельцу франшизы и только когда trial-план.
 *
 * Источник данных — `/admins/me` (поле `trial_status`).
 *
 * Использование: один раз в AdminLayout рядом с верхней навигацией.
 *    <TrialBanner trialStatus={me.trial_status} role={me.role} />
 * ====================================================================
 */
export default function TrialBanner({ trialStatus, role }) {
  if (!trialStatus || trialStatus.status === 'none' || trialStatus.status === 'active') return null
  if (role !== 'franchise_owner' && role !== 'super_admin') return null

  const expired = trialStatus.status === 'expired'
  const days = trialStatus.days_left

  const styles = {
    bar: {
      width: '100%',
      padding: '12px 16px',
      background: expired ? '#fef2f2' : '#fefce8',
      borderBottom: expired ? '1px solid #fecaca' : '1px solid #fde68a',
      color: expired ? '#991b1b' : '#854d0e',
      fontSize: 14,
      lineHeight: 1.5,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
      flexWrap: 'wrap',
    },
    msg: { display: 'flex', alignItems: 'center', gap: 10 },
    icon: {
      width: 24, height: 24, borderRadius: '50%',
      background: expired ? '#dc2626' : '#eab308',
      color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 700, fontSize: 14, flexShrink: 0,
    },
    cta: {
      background: expired ? '#dc2626' : '#0097a7',
      color: '#fff',
      padding: '6px 14px',
      borderRadius: 8,
      textDecoration: 'none',
      fontSize: 13,
      fontWeight: 600,
      whiteSpace: 'nowrap',
    },
  }

  return (
    <div style={styles.bar}>
      <div style={styles.msg}>
        <span style={styles.icon}>{expired ? '!' : '⏱'}</span>
        <span>
          {expired
            ? <>Триал-период истёк. Чтобы продолжить работу — оформите подписку.</>
            : <>Триал заканчивается через <b>{days === 0 ? 'сегодня' : `${days} ${dayWord(days)}`}</b>. Оформите подписку, чтобы не потерять доступ.</>
          }
        </span>
      </div>
      <a href="#/billing" onClick={(e) => {
        // мягкое решение: пробуем перейти в /admin/billing,
        // если поле hash не выстреливает — фолбэк на location
        try {
          const sl = window.location.pathname.match(/^\/([^/]+)\/admin/)
          const target = sl ? `/${sl[1]}/admin/billing` : '/admin/billing'
          e.preventDefault()
          window.location.assign(target)
        } catch (_) { /* noop — пусть отработает href */ }
      }} style={styles.cta}>
        Оформить подписку →
      </a>
    </div>
  )
}

function dayWord(n) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'день'
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'дня'
  return 'дней'
}
