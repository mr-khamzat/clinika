/**
 * ========================================
 * БЛОК: ManagerChatPage — страница «Чат пациентов» (Глава 9)
 * ========================================
 * Обёртка вокруг ClinicChatSection в кабинете управляющего.
 * Используется в роутере App.jsx по пути /manager/chat.
 * ========================================
 */
import { lazy, Suspense } from 'react'
import ManagerShell from './_ManagerShell'

const ClinicChatSection = lazy(() => import('../sections/ClinicChatSection'))

export default function ManagerChatPage() {
  return (
    <ManagerShell
      active="chat"
      title="Чат с пациентами"
      subtitle="Сообщения от пациентов клиник сети · ответы, назначение врача, закрытие"
      icon="forum"
    >
      <Suspense fallback={<div style={{ textAlign: 'center', padding: 32, color: 'var(--fg-3)' }}>Загрузка…</div>}>
        <ClinicChatSection role="manager" />
      </Suspense>
    </ManagerShell>
  )
}
