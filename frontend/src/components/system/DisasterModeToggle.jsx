/**
 * ========================================
 * БЛОК: DisasterModeToggle — управление disaster-mode (Глава 10)
 * ========================================
 * disaster-mode — глобальный переключатель: при включении вся не-критичная
 * запись отключается (только чтение + emergency endpoints). Используется
 * при потере backup-ов, миграциях, инцидентах безопасности.
 *
 * API:
 *   POST /admin/system/enable-disaster-mode  body { reason }
 *   POST /admin/system/disable-disaster-mode
 *
 * Props:
 *   - state: { enabled, enabled_at?, reason? } | null
 *   - onChanged() — после успешного toggle
 * ========================================
 */
import { useState } from 'react'
import api from '../../api'
import { useToast, Modal, Button } from '../../design'

function fmtDate(iso) {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit',
    })
  } catch { return iso }
}

export default function DisasterModeToggle({ state, onChanged }) {
  const { toast } = useToast()
  const [openEnable, setOpenEnable]   = useState(false)
  const [openDisable, setOpenDisable] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const enabled = !!state?.enabled

  const enable = async () => {
    if (!reason.trim() || reason.trim().length < 10) {
      toast({ kind: 'error', text: 'Укажите причину (≥ 10 символов)' })
      return
    }
    setBusy(true)
    try {
      await api.post('/admin/system/enable-disaster-mode', { reason: reason.trim() })
      toast({ kind: 'success', text: 'Disaster mode активирован' })
      setOpenEnable(false)
      setReason('')
      onChanged && onChanged()
    } catch (e) {
      toast({ kind: 'error', text: e?.response?.data?.detail || 'Не удалось активировать' })
    } finally {
      setBusy(false)
    }
  }

  const disable = async () => {
    setBusy(true)
    try {
      await api.post('/admin/system/disable-disaster-mode')
      toast({ kind: 'success', text: 'Disaster mode отключён' })
      setOpenDisable(false)
      onChanged && onChanged()
    } catch (e) {
      toast({ kind: 'error', text: e?.response?.data?.detail || 'Не удалось отключить' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {/* HERO CARD — статус */}
      <div
        className="rounded-2xl p-5 sm:p-6"
        style={{
          background: enabled
            ? 'linear-gradient(135deg, #991b1b 0%, #7f1d1d 100%)'
            : 'linear-gradient(135deg, #166534 0%, #14532d 100%)',
          color: '#fff',
          boxShadow: enabled
            ? '0 10px 40px rgba(153,27,27,0.25)'
            : '0 10px 30px rgba(20,83,45,0.18)',
        }}
      >
        <div className="flex items-start gap-4">
          <span
            className="inline-grid place-items-center flex-shrink-0"
            style={{
              width: 64, height: 64, borderRadius: 16,
              background: 'rgba(255,255,255,0.18)',
              backdropFilter: 'blur(4px)',
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{
                fontSize: 38,
                color: '#fff',
                fontVariationSettings: "'FILL' 1",
              }}
            >{enabled ? 'crisis_alert' : 'verified'}</span>
          </span>

          <div className="min-w-0 flex-1">
            <div
              className="font-bold mb-1"
              style={{ fontSize: 22, letterSpacing: '-0.02em', lineHeight: 1.15 }}
            >
              {enabled
                ? 'Disaster mode активирован'
                : 'Система работает нормально'}
            </div>
            <div style={{ fontSize: 13, opacity: 0.9, lineHeight: 1.5 }}>
              {enabled
                ? 'Запись данных приостановлена. Доступно только чтение и аварийные операции.'
                : 'Все сервисы доступны. Запись/чтение работают штатно.'}
            </div>
            {enabled && state?.enabled_at && (
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1" style={{ fontSize: 12, opacity: 0.85 }}>
                <span>с <b>{fmtDate(state.enabled_at)}</b></span>
                {state.reason && (
                  <span>причина: <b>{state.reason}</b></span>
                )}
              </div>
            )}
          </div>

          <div className="flex-shrink-0">
            {enabled ? (
              <button
                onClick={() => setOpenDisable(true)}
                className="inline-flex items-center gap-2 rounded-xl font-bold transition-transform active:scale-95"
                style={{
                  padding: '11px 16px',
                  background: '#fff',
                  color: '#991b1b',
                  fontSize: 13,
                  boxShadow: '0 4px 14px rgba(0,0,0,0.15)',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>restart_alt</span>
                Выключить
              </button>
            ) : (
              <button
                onClick={() => setOpenEnable(true)}
                className="inline-flex items-center gap-2 rounded-xl font-bold transition-transform active:scale-95"
                style={{
                  padding: '11px 16px',
                  background: 'rgba(255,255,255,0.18)',
                  color: '#fff',
                  border: '1px solid rgba(255,255,255,0.35)',
                  fontSize: 13,
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>crisis_alert</span>
                Включить disaster
              </button>
            )}
          </div>
        </div>
      </div>

      {/* МОДАЛ — Включить */}
      <Modal open={openEnable} onClose={() => setOpenEnable(false)} title="Включить disaster mode" size="md">
        <div className="flex flex-col gap-3" style={{ minWidth: 320 }}>
          <div
            className="rounded-xl p-3 flex items-start gap-2.5"
            style={{ background: '#fef2f2', border: '1px solid #fecaca' }}
          >
            <span
              className="material-symbols-outlined flex-shrink-0"
              style={{ fontSize: 22, color: '#991b1b' }}
            >warning</span>
            <div style={{ fontSize: 12.5, color: '#991b1b', lineHeight: 1.5 }}>
              При активации <b>все операции записи</b> в систему будут заблокированы.
              Пациенты не смогут записываться, врачи — выписывать назначения, регистраторы — создавать записи.
              Только аварийные endpoints доступны.
            </div>
          </div>

          <label className="block">
            <div className="font-bold uppercase mb-1.5" style={{ fontSize: 11, color: '#475569', letterSpacing: '0.06em' }}>
              Причина активации*
            </div>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Например: миграция БД на новый кластер, оценочное время простоя — 30 минут"
              rows={4}
              className="w-full rounded-xl"
              style={{ padding: '10px 12px', border: '1px solid #e2e8f0', fontSize: 13, outline: 'none', resize: 'vertical', minHeight: 90 }}
              autoFocus
            />
            <div className="mt-1 text-[11px]" style={{ color: '#94a3b8' }}>
              Причина будет видна в логах и пользователям сети
            </div>
          </label>

          <div className="flex items-center justify-end gap-2 pt-3" style={{ borderTop: '1px solid #f1f5f9' }}>
            <Button variant="ghost" onClick={() => setOpenEnable(false)}>Отмена</Button>
            <button
              onClick={enable}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold text-white"
              style={{ background: '#991b1b', opacity: busy ? 0.6 : 1, cursor: busy ? 'not-allowed' : 'pointer' }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>crisis_alert</span>
              {busy ? 'Включаем…' : 'Подтвердить и включить'}
            </button>
          </div>
        </div>
      </Modal>

      {/* МОДАЛ — Выключить */}
      <Modal open={openDisable} onClose={() => setOpenDisable(false)} title="Выключить disaster mode" size="sm">
        <div className="flex flex-col gap-3" style={{ minWidth: 280 }}>
          <p style={{ fontSize: 13, color: '#475569' }}>
            Система вернётся в штатный режим. Запись будет разрешена для всех сервисов.
          </p>
          <div className="flex items-center justify-end gap-2 pt-2" style={{ borderTop: '1px solid #f1f5f9' }}>
            <Button variant="ghost" onClick={() => setOpenDisable(false)}>Отмена</Button>
            <Button onClick={disable} disabled={busy}>
              {busy ? 'Выключаем…' : 'Подтвердить'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
