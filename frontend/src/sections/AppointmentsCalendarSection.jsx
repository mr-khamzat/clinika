/**
 * AppointmentsCalendarSection — обёртка-совместимость над WeekScheduleSection.
 * Используется ManagerAppointments и SupervisorCabinet.
 */
import WeekScheduleSection from './scheduling/WeekScheduleSection'

export default function AppointmentsCalendarSection({ token }) {
  return <WeekScheduleSection token={token} mode="full" />
}
