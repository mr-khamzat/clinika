/**
 * ManagerDoctors — страница «Врачи» для управляющего.
 * Обёртка над DoctorsSection в ManagerShell. Через неё менеджер настраивает
 * каждому штатному врачу шаблонное расписание (Пн-Вс с временем работы),
 * после чего у регистратора в /manager/appointments появляются слоты.
 */
import api from '../api'
import { SLUG } from '../config'
import ManagerShell from './_ManagerShell'
import DoctorsSection from '../sections/DoctorsSection'

export default function ManagerDoctors() {
  const token =
    api.defaults?.headers?.common?.Authorization?.replace(/^Bearer\s+/, '') ||
    localStorage.getItem('clinika_token_' + SLUG) ||
    localStorage.getItem('clinika_token_arc') ||
    localStorage.getItem('clinika_token')

  return (
    <ManagerShell active="doctors">
      <DoctorsSection token={token} />
    </ManagerShell>
  )
}
