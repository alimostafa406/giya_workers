import { useEffect, useMemo, useState } from 'react'
import { getAttendanceRequest } from '../api/attendanceApi'
import { getErrorMessage } from '../api/axios'
import { getTeamsRequest } from '../api/teamsApi'
import { getWorkersRequest } from '../api/workersApi'
import AttendanceAgentStatus from '../components/Attendance/AttendanceAgentStatus'
import Table from '../components/Table/Table'
import { useTranslation } from '../i18n/LanguageContext'
import { attendanceRosterCategory, mergeAttendanceRoster } from '../utils/attendanceRoster'

const asArray = (value) => {
  if (Array.isArray(value)) {
    return value
  }
  if (Array.isArray(value?.data)) {
    return value.data
  }
  return []
}

const isPresentStatus = (status) => {
  const normalized = String(status || '').toLowerCase()
  return normalized === 'present' || normalized === 'حاضر'
}

const getTodayLocalDate = () => new Date().toLocaleDateString('en-CA', {
  timeZone: 'Africa/Kinshasa',
})

function Dashboard() {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [teams, setTeams] = useState([])
  const [workers, setWorkers] = useState([])
  const [attendance, setAttendance] = useState([])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const [teamsRes, workersRes, attendanceRes] = await Promise.all([
          getTeamsRequest(),
          getWorkersRequest(),
          getAttendanceRequest(),
        ])

        setTeams(asArray(teamsRes.data))
        setWorkers(asArray(workersRes.data))
        setAttendance(asArray(attendanceRes.data))
      } catch (err) {
        setError(getErrorMessage(err))
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [])

  const today = getTodayLocalDate()
  const todayRoster = useMemo(() => mergeAttendanceRoster({
    workers,
    attendance,
    date: today,
    businessDate: today,
  }), [attendance, today, workers])

  const presentCount = useMemo(
    () => todayRoster.filter((item) => isPresentStatus(item.status || item.status_key)).length,
    [todayRoster],
  )

  const absentCount = useMemo(
    () => todayRoster.filter((item) => attendanceRosterCategory(item) === 'absent').length,
    [todayRoster],
  )
  const halfDayCount = useMemo(
    () => todayRoster.filter((item) => String(item.status || item.status_key || '').toLowerCase() === 'half_day').length,
    [todayRoster],
  )

  const notRecordedCount = todayRoster.filter((item) => attendanceRosterCategory(item) === 'not_recorded').length

  const latestAttendance = useMemo(() => {
    return todayRoster
      .filter((row) => !row.is_virtual)
      .slice()
      .sort((a, b) => {
        const aDate = new Date(a.created_at || a.check_in || a.date || 0)
        const bDate = new Date(b.created_at || b.check_in || b.attendance_date || 0)
        return bDate - aDate
      })
      .slice(0, 8)
  }, [todayRoster])

  const cards = [
    { label: t('dashboard.presentToday'), value: presentCount },
    { label: t('dashboard.halfDay'), value: halfDayCount },
    { label: t('dashboard.absentToday'), value: absentCount },
    { label: t('dashboard.notRecorded'), value: notRecordedCount },
    { label: t('dashboard.totalWorkers'), value: todayRoster.length },
  ]

  const columns = [
    {
      key: 'worker',
      header: t('attendance.worker'),
      render: (row) => row.worker?.full_name || row.worker_name || '-',
    },
    {
      key: 'team',
      header: t('attendance.team'),
      render: (row) => row.team?.name || row.team_name || '-',
    },
    {
      key: 'status',
      header: t('attendance.status'),
      render: (row) => row.roster_state === 'not_recorded' ? t('attendance.notRecorded') : row.status || '-',
    },
    {
      key: 'check_in',
      header: t('attendance.checkIn'),
      render: (row) => row.check_in || '-',
    },
    {
      key: 'check_out',
      header: t('attendance.checkOut'),
      render: (row) => row.check_out || '-',
    },
    {
      key: 'note',
      header: t('attendance.notes'),
      render: (row) => row.note || '-',
    },
  ]

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-extrabold">{t('dashboard.title')}</h2>
      </div>

      {error ? (
        <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="surface-card bg-linear-to-br from-white to-stone-50 p-4"
          >
            <p className="text-sm text-(--muted)">{card.label}</p>
            <p className="mt-2 text-3xl font-extrabold text-(--primary)">
              {loading ? '...' : card.value}
            </p>
          </div>
        ))}
      </div>

      <AttendanceAgentStatus />

      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-lg font-bold">{t('dashboard.recentAttendance')}</h3>
        <p className="text-sm text-(--muted)">{today}</p>
      </div>
      <Table columns={columns} data={latestAttendance} loading={loading} />
    </section>
  )
}

export default Dashboard
