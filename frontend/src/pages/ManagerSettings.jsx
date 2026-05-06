/**
 * ========================================
 * БЛОК: ManagerSettings (premium редизайн)
 * ========================================
 * Настройки управляющего: бонусы по услугам и подсказка о МИС/Telegram.
 * Бизнес-логика не изменена.
 * ========================================
 */
import { useEffect, useState } from 'react'
import { listManagerServices, updateService } from '../api'
import { Card, Button, EmptyState } from '../design'
import ManagerShell from './_ManagerShell'

export default function ManagerSettings() {
  const [services, setServices]           = useState([])
  const [loading, setLoading]             = useState(true)
  const [savedMsg, setSavedMsg]           = useState('')
  const [error, setError]                 = useState('')
  const [savingService, setSavingService] = useState(null)
  const [serviceBonuses, setServiceBonuses] = useState({})

  useEffect(() => {
    listManagerServices()
      .then(svRes => {
        const svcs = Array.isArray(svRes.data) ? svRes.data : []
        setServices(svcs)
        const bm = {}; svcs.forEach(s => { bm[s.id] = String(s.bonus_amount ?? '') })
        setServiceBonuses(bm)
      })
      .catch(() => setError('Ошибка загрузки настроек'))
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async (svcId) => {
    setSavingService(svcId)
    try {
      await updateService(svcId, { bonus_amount: parseFloat(serviceBonuses[svcId]) || 0 })
      setSavedMsg('Бонус обновлён'); setTimeout(() => setSavedMsg(''), 2000)
    } catch { setError('Ошибка сохранения бонуса') } finally { setSavingService(null) }
  }

  return (
    <ManagerShell
      active="settings"
      title="Настройки"
      subtitle="Бонусы по услугам и интеграции"
      icon="tune"
    >
      {loading ? (
        <Card>
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 rounded-full animate-spin" style={{ border: '3px solid var(--accent-soft)', borderTopColor: 'var(--accent)' }} />
          </div>
        </Card>
      ) : (
        <>
          {error && (
            <div
              className="mb-4 rounded-xl p-3"
              style={{ background: 'var(--bad-soft)', border: '1px solid var(--bad-soft)', color: 'var(--bad)' }}
            >
              <p className="text-sm">{error}</p>
            </div>
          )}
          {savedMsg && (
            <div
              className="mb-4 rounded-xl p-3 flex items-center gap-2"
              style={{ background: 'var(--good-soft)', border: '1px solid var(--good-soft)', color: 'var(--good)' }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}>check_circle</span>
              <p className="text-sm font-medium">{savedMsg}</p>
            </div>
          )}

          {/* ─── Инфо ─── */}
          <Card className="mb-4" style={{ background: 'var(--accent-soft)', borderColor: 'var(--accent-line)' }}>
            <div className="flex gap-3">
              <span
                className="inline-grid place-items-center flex-shrink-0"
                style={{ width: 32, height: 32, borderRadius: 9, background: 'oklch(1 0 0 / 0.6)', color: 'var(--accent)' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}>info</span>
              </span>
              <p className="text-sm" style={{ color: 'var(--accent)' }}>
                Настройки МИС и Telegram доступны в панели администратора.
              </p>
            </div>
          </Card>

          {/* ─── Бонусы по услугам ─── */}
          <Card padded={false}>
            <div className="flex items-center justify-between p-4 pb-3" style={{ borderBottom: '1px solid var(--line)' }}>
              <div>
                <Card.Title>Бонусы по услугам</Card.Title>
                <Card.Subtitle>Размер бонуса (Б) за подтверждённое направление</Card.Subtitle>
              </div>
              <span
                className="inline-grid place-items-center flex-shrink-0"
                style={{ width: 32, height: 32, borderRadius: 9, background: 'var(--warn-soft)', color: 'var(--warn)' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}>sell</span>
              </span>
            </div>
            {services.length === 0 ? (
              <EmptyState
                icon={<span className="material-symbols-outlined" style={{ fontSize: 28, fontVariationSettings: "'FILL' 1" }}>sell</span>}
                title="Нет услуг"
                message="Услуги ещё не созданы. Добавьте их в панели администратора."
              />
            ) : (
              <div>
                {services.map((svc, i) => (
                  <div
                    key={svc.id}
                    className="flex items-center gap-3 px-4 py-3"
                    style={{ borderBottom: i < services.length - 1 ? '1px solid var(--line)' : 'none' }}
                  >
                    <p className="flex-1 text-sm font-medium truncate" style={{ color: 'var(--fg)' }}>
                      {svc.name}
                    </p>
                    <input
                      type="number"
                      value={serviceBonuses[svc.id] ?? ''}
                      onChange={e => setServiceBonuses(b => ({ ...b, [svc.id]: e.target.value }))}
                      className="text-sm w-24 text-right outline-none"
                      style={{
                        background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 9,
                        padding: '8px 10px', color: 'var(--fg)', fontVariantNumeric: 'tabular-nums',
                      }}
                      placeholder="Б"
                    />
                    <Button
                      variant="primary" size="sm" onClick={() => handleSave(svc.id)}
                      disabled={savingService === svc.id}
                    >
                      {savingService === svc.id ? '…' : 'OK'}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </ManagerShell>
  )
}
