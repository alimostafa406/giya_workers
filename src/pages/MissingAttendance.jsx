import { useEffect, useMemo, useState } from 'react'
import { getAttendanceRequest } from '../api/attendanceApi'
import { getErrorMessage } from '../api/axios'
import { getCurrentAttendanceEvidenceRequest } from '../api/currentAttendanceEvidenceApi'
import { getTeamsRequest } from '../api/teamsApi'
import { getWorkersRequest } from '../api/workersApi'
import Modal from '../components/Modal/Modal'
import Table from '../components/Table/Table'
import { useTranslation } from '../i18n/LanguageContext'
import { attendanceRosterCategory, mergeAttendanceRoster } from '../utils/attendanceRoster'
import { kinshasaClock } from '../utils/attendanceOperationalGate'

const asArray = (value) => {
  if (Array.isArray(value)) {
    return value
  }
  if (Array.isArray(value?.data)) {
    return value.data
  }
  return []
}

const getTodayLocalDate = () => kinshasaClock().date

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
  const [biometricEvidence, setBiometricEvidence] = useState([])
  const [selectedTeam, setSelectedTeam] = useState(null)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const attendanceDate = getTodayLocalDate()
        const [teamsRes, workersRes, attendanceRes, biometricEvidenceRes] = await Promise.all([
          getTeamsRequest(),
          getWorkersRequest(),
          getAttendanceRequest(),
          getCurrentAttendanceEvidenceRequest(attendanceDate),
        ])

        setTeams(asArray(teamsRes.data))
        setWorkers(asArray(workersRes.data))
        setAttendance(asArray(attendanceRes.data))
        setBiometricEvidence(asArray(biometricEvidenceRes.data))
      } catch (err) {
        setError(getErrorMessage(err))
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [])

  const today = getTodayLocalDate()

  const roster = useMemo(() => mergeAttendanceRoster({
    workers,
    attendance,
    biometricEvidence,
    date: today,
    businessDate: today,
  }), [attendance, biometricEvidence, today, workers])

  const missingTeams = useMemo(() => {
    const teamsById = new Map(teams.map((team) => [String(team.id), team]))
    const grouped = new Map()
    roster
      .filter((row) => attendanceRosterCategory(row) === 'not_recorded')
      .forEach((row) => {
        const teamId = String(row.worker?.team_id || '')
        const team = teamsById.get(teamId) || null
        const key = teamId || 'unassigned'
        const group = grouped.get(key) || {
          id: key,
          teamName: team?.name || '-',
          supervisorName: team?.supervisor?.full_name || team?.supervisor_name || t('common.noSupervisor'),
          supervisorPhone: formatSupervisorPhone(team?.supervisor?.phone, t),
          missingWorkers: [],
        }
        group.missingWorkers.push(row.worker)
        grouped.set(key, group)
      })
    return [...grouped.values()]
      .map((group) => ({ ...group, missingCount: group.missingWorkers.length }))
      .sort((left, right) => left.teamName.localeCompare(right.teamName))
  }, [roster, teams, t])

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
