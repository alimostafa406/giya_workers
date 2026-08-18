import { useEffect, useMemo, useState } from 'react'
import { getAttendanceRequest } from '../api/attendanceApi'
import { getErrorMessage } from '../api/axios'
import { getTeamsRequest } from '../api/teamsApi'
import { getWorkersRequest } from '../api/workersApi'
import Modal from '../components/Modal/Modal'
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

const getTodayLocalDate = () => {
  const date = new Date()
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 10)
}

const getAttendanceDate = (row) => row.attendance_date || row.date || ''
const getAttendanceKey = (row) => String(row.worker_id || row.id || '')

const formatSupervisorPhone = (phone, t) => {
  const normalized = String(phone || '').trim()
  return normalized || t('missingAttendance.noPhone')
}

function MissingAttendance() {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [teams, setTeams] = useState([])
  const [workers, setWorkers] = useState([])
  const [attendance, setAttendance] = useState([])
  const [selectedTeam, setSelectedTeam] = useState(null)

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

  const recordedWorkerIds = useMemo(() => {
    const todaysRows = attendance.filter((row) => getAttendanceDate(row) === today)
    return new Set(todaysRows.map((row) => getAttendanceKey(row)).filter(Boolean))
  }, [attendance, today])

  const missingTeams = useMemo(() => {
    return teams
      .filter((team) => team.is_active !== false)
      .map((team) => {
        const teamWorkers = workers.filter(
          (worker) => String(worker.team_id || '') === String(team.id) && worker.is_active !== false,
        )

        if (teamWorkers.length === 0) {
          return null
        }

        const missingWorkers = teamWorkers.filter(
          (worker) => !recordedWorkerIds.has(String(worker.id || '')),
        )

        if (missingWorkers.length === 0) {
          return null
        }

        return {
          id: team.id,
          teamName: team.name || '-',
          supervisorName: team.supervisor?.full_name || team.supervisor_name || t('common.noSupervisor'),
          supervisorPhone: formatSupervisorPhone(team.supervisor?.phone, t),
          missingCount: missingWorkers.length,
          missingWorkers,
        }
      })
      .filter(Boolean)
  }, [teams, workers, recordedWorkerIds, t])

  const missingWorkersColumns = [
    {
      key: 'full_name',
      header: t('workers.name'),
      render: (row) => row.full_name || '-',
    },
    {
      key: 'phone',
      header: t('workers.phone'),
      render: (row) => row.phone || '-',
    },
  ]

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-extrabold">{t('missingAttendance.title')}</h2>
        <p className="text-sm text-(--muted)">{today}</p>
      </div>

      {error ? (
        <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="surface-card p-4 text-sm text-(--muted)">{t('missingAttendance.loading')}</div>
      ) : missingTeams.length === 0 ? (
        <div className="surface-card p-4 text-sm text-(--muted)">{t('missingAttendance.empty')}</div>
      ) : (
        <div className="space-y-3">
          {missingTeams.map((team) => (
            <div key={team.id} className="surface-card p-4">
              <p className="font-semibold">{t('common.team')}: {team.teamName}</p>
              <p className="text-sm">{t('common.supervisor')}: {team.supervisorName}</p>
              <p className="text-sm">{t('common.phone')}: {team.supervisorPhone}</p>
              <p className="mt-1 text-sm font-semibold text-red-700">{t('missingAttendance.missing', { count: team.missingCount })}</p>
              <button
                type="button"
                className="btn-secondary mt-2 px-3 py-1"
                onClick={() => setSelectedTeam(team)}
              >
                {t('missingAttendance.showWorkers')}
              </button>
            </div>
          ))}
        </div>
      )}

      <Modal
        isOpen={Boolean(selectedTeam)}
        title={t('missingAttendance.unrecordedWorkers', { team: selectedTeam?.teamName || '' })}
        onClose={() => setSelectedTeam(null)}
      >
        <Table
          columns={missingWorkersColumns}
          data={selectedTeam?.missingWorkers || []}
          loading={false}
          emptyMessage={t('missingAttendance.noUnrecordedWorkers')}
        />
      </Modal>
    </section>
  )
}

export default MissingAttendance
