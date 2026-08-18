import { useEffect, useMemo, useState } from 'react'
import { getAttendanceRequest } from '../api/attendanceApi'
import { getErrorMessage } from '../api/axios'
import { getTeamsRequest } from '../api/teamsApi'
import { getWorkersRequest } from '../api/workersApi'
import Table from '../components/Table/Table'
import { useTranslation } from '../i18n/LanguageContext'

const asArray = (value) => {
  if (Array.isArray(value)) {
    return value
  }
  if (Array.isArray(value?.data)) {
    return value.data
  }
  return []
}

const getAttendanceDate = (row) => {
  return row.attendance_date || row.date || '-'
}

const getAttendanceKey = (row) => row.worker_id || row.id

const isPresentStatus = (status) => {
  const normalized = String(status || '').toLowerCase()
  return normalized === 'present' || normalized === 'حاضر'
}

const isAbsentStatus = (status) => {
  const normalized = String(status || '').toLowerCase()
  return normalized === 'absent' || normalized === 'غائب'
}

const getTodayLocalDate = () => {
  const date = new Date()
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 10)
}

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
  const todayAttendance = useMemo(
    () => attendance.filter((item) => getAttendanceDate(item) === today),
    [attendance, today],
  )

  const recordedWorkerIds = useMemo(() => {
    return new Set(todayAttendance.map((item) => getAttendanceKey(item)).filter(Boolean))
  }, [todayAttendance])

  const activeWorkers = useMemo(() => workers.filter((worker) => worker.is_active), [workers])

  const presentCount = useMemo(
    () => todayAttendance.filter((item) => isPresentStatus(item.status || item.status_key)).length,
    [todayAttendance],
  )

  const absentCount = useMemo(
    () => todayAttendance.filter((item) => isAbsentStatus(item.status || item.status_key)).length,
    [todayAttendance],
  )
  const halfDayCount = useMemo(
    () => todayAttendance.filter((item) => String(item.status || item.status_key || '').toLowerCase() === 'half_day').length,
    [todayAttendance],
  )

  const notRecordedCount = Math.max(activeWorkers.length - recordedWorkerIds.size, 0)

  const activeTeams = useMemo(() => {
    return teams.filter((team) => team.is_active !== false)
  }, [teams])

  const teamsWithMissingAttendanceToday = useMemo(() => {
    return activeTeams
      .map((team) => {
        const teamWorkers = workers.filter(
          (worker) => String(worker.team_id || '') === String(team.id) && worker.is_active !== false,
        )
        const missingWorkers = teamWorkers.filter((worker) => !recordedWorkerIds.has(getAttendanceKey(worker)))

        return {
          id: team.id,
          totalWorkers: teamWorkers.length,
          missingCount: missingWorkers.length,
        }
      })
      .filter((team) => team.totalWorkers > 0 && team.missingCount > 0)
  }, [activeTeams, workers, recordedWorkerIds])

  const latestAttendance = useMemo(() => {
    return [...attendance]
      .sort((a, b) => {
        const aDate = new Date(a.created_at || a.check_in || a.date || 0)
        const bDate = new Date(b.created_at || b.check_in || b.attendance_date || 0)
        return bDate - aDate
      })
      .slice(0, 8)
  }, [attendance])

  const cards = [
    { label: t('dashboard.presentToday'), value: presentCount },
    { label: t('dashboard.halfDay'), value: halfDayCount },
    { label: t('dashboard.absentToday'), value: absentCount },
    { label: t('dashboard.notRecorded'), value: notRecordedCount },
    { label: t('dashboard.totalWorkers'), value: activeWorkers.length },
    { label: t('dashboard.lastUpdate'), value: latestAttendance[0]?.updated_at ? new Date(latestAttendance[0].updated_at).toLocaleTimeString() : '—' },
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
      render: (row) => row.status || '-',
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

      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-lg font-bold">{t('dashboard.recentAttendance')}</h3>
        <p className="text-sm text-(--muted)">{today}</p>
      </div>
      <Table columns={columns} data={latestAttendance} loading={loading} />
    </section>
  )
}

export default Dashboard
