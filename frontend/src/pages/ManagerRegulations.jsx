/**
 * ========================================
 * БЛОК: ManagerRegulations
 * ========================================
 * Глава 7 — Регламент-конструктор. Страница «Мои регламенты» для управляющего.
 * Использует общий ManagerShell + общий RegulationsReaderSection.
 * ========================================
 */
import { useEffect, useState } from 'react'
import api from '../api'
import ManagerShell from './_ManagerShell'
import RegulationsReaderSection from '../sections/RegulationsReaderSection'

export default function ManagerRegulations() {
  const [user, setUser] = useState(null)

  useEffect(() => {
    let alive = true
    api.get('/admins/me')
      .then(r => { if (alive) setUser(r.data) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  return (
    <ManagerShell
      active="regulations"
      title="Мои регламенты"
      subtitle="Назначенные вам регламенты и подтверждение ознакомления"
      icon="rule"
    >
      <RegulationsReaderSection user={user} />
    </ManagerShell>
  )
}
