import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { getAttendanceRequest } from '../api/attendanceApi'
import { getErrorMessage } from '../api/axios'
import { getBiometricMappingsRequest, getRecentUnmappedBiometricIdentitiesRequest, getUnresolvedBiometricAttendanceRequest } from '../api/biometricMappingApi'
import { getCurrentAttendanceEvidenceRequest } from '../api/currentAttendanceEvidenceApi'
import { getWorkersRequest } from '../api/workersApi'
import AttendanceAgentStatus from '../components/Attendance/AttendanceAgentStatus'
import DailyAttendanceSummary from '../components/Attendance/DailyAttendanceSummary'
import UnresolvedBiometricAttendancePanel from '../components/Attendance/UnresolvedBiometricAttendancePanel'
import Table from '../components/Table/Table'
import { useTranslation } from '../i18n/LanguageContext'
import { dailyAttendanceBucket, mergeAttendanceRoster, operationalAttendanceStatus, summarizeDailyAttendanceRoster } from '../utils/attendanceRoster'
import { biometricIdsByWorker, latestPunchesByWorker } from '../utils/dailyOperationalReports'
import { splitUnresolvedBiometricAttendance } from '../utils/unresolvedBiometricAttendance'

const asArray = (value) => {
  if (Array.isArray(value)) {
    return value
  }
  if (Array.isArray(value?.data)) {
    return value.data
  }
  return []
}

const getTodayLocalDate = () => new Date().toLocaleDateString('en-CA', {
  timeZone: 'Africa/Kinshasa',
})

function Dashboard() {
  const { t, language } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [workers, setWorkers] = useState([])
  const [attendance, setAttendance] = useState([])
  const [biometricEvidence, setBiometricEvidence] = useState([])
  const [biometricMappings, setBiometricMappings] = useState([])
  const [recentUnmappedCount, setRecentUnmappedCount] = useState(null)
  const [unresolvedBiometric, setUnresolvedBiometric] = useState([])
  const [unresolvedBiometricUnavailable, setUnresolvedBiometricUnavailable] = useState(false)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const attendanceDate = getTodayLocalDate()
        const [workersRes, attendanceRes, biometricEvidenceRes, recentUnmappedRes, unresolvedRes, mappingsRes] = await Promise.all([
          getWorkersRequest(),
          getAttendanceRequest(),
          getCurrentAttendanceEvidenceRequest(attendanceDate),
          getRecentUnmappedBiometricIdentitiesRequest({ days: 7 }).catch(() => ({ data: [], unavailable: true })),
          getUnresolvedBiometricAttendanceRequest({ attendanceDate }).catch(() => ({ data: [], unavailable: true })),
          getBiometricMappingsRequest(),
        ])

        setWorkers(asArray(workersRes.data))
        setAttendance(asArray(attendanceRes.data))
        setBiometricEvidence(asArray(biometricEvidenceRes.data))
        setBiometricMappings(asArray(mappingsRes.data))
        setRecentUnmappedCount(recentUnmappedRes.unavailable ? null : asArray(recentUnmappedRes.data).length)
        setUnresolvedBiometric(asArray(unresolvedRes.data))
        setUnresolvedBiometricUnavailable(Boolean(unresolvedRes.unavailable))
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
    biometricEvidence,
    date: today,
    businessDate: today,
  }), [attendance, biometricEvidence, today, workers])

  const dailyCounts = useMemo(() => summarizeDailyAttendanceRoster(todayRoster), [todayRoster])
  const summaryRows = useMemo(() => {
    const ids = biometricIdsByWorker(biometricMappings)
    const punches = latestPunchesByWorker(biometricEvidence, today)
    return todayRoster.map((row) => ({
      ...row,
      workerId: row.worker.id,
      workerName: row.worker.full_name,
      employeeCode: row.worker.employee_code || '—',
      biometricId: ids.get(String(row.worker.id)) || '—',
      teamName: row.team?.name || row.team_name || '—',
      lastPunch: punches.get(String(row.worker.id)) || '—',
      bucket: dailyAttendanceBucket(row),
    }))
  }, [todayRoster, biometricMappings, biometricEvidence, today])

  const urgentBiometric = useMemo(
    () => splitUnresolvedBiometricAttendance(unresolvedBiometric).urgent,
    [unresolvedBiometric],
  )

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

  const reviewLabelsByLanguage = {
    ar: { title: 'بصمات غير مربوطة خلال آخر 7 أيام', description: 'هويات سجلت بصمة فعلية حديثًا ولم يتم ربطها بعامل في النظام.', action: 'مراجعة' },
    en: { title: 'Unmapped punches in the last 7 days', description: 'Identities generated a recent real punch but are not linked to a system worker.', action: 'Review' },
    fr: { title: 'Pointages non liés des 7 derniers jours', description: 'Des identités ont produit un pointage réel récent sans être liées à un travailleur.', action: 'Vérifier' },
  }
  const reviewLabels = reviewLabelsByLanguage[language] || reviewLabelsByLanguage.en

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
      render: (row) => row.roster_state === 'not_recorded'
        ? t('attendance.notRecorded')
        : row.roster_state === 'biometric_pending' ? t('attendance.pending') : operationalAttendanceStatus(row) || '-',
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

      {loading ? <p className="mb-5">{t('common.loading')}</p> : <DailyAttendanceSummary
        rows={summaryRows}
        counts={dailyCounts}
        t={t}
        labels={{ worker: t('attendance.worker'), biometric: t('reports.biometricId'), team: t('attendance.team'), status: t('attendance.status'), in: t('attendance.checkIn'), out: t('attendance.checkOut'), last: t('reports.lastPunch'), noRows: t('common.noResults') }}
      />}

      <div className="surface-card mb-5 flex flex-wrap items-center justify-between gap-4 border-2 border-amber-200 bg-amber-50 p-4">
        <div><p className="font-extrabold">{reviewLabels.title}</p><p className="mt-1 text-sm text-(--muted)">{reviewLabels.description}</p></div>
        <div className="flex items-center gap-3"><span className="text-3xl font-extrabold text-amber-800">{recentUnmappedCount ?? '—'}</span><Link className="btn-secondary" to="/biometric-mapping">{reviewLabels.action}</Link></div>
      </div>

      <UnresolvedBiometricAttendancePanel
        rows={urgentBiometric}
        unavailable={unresolvedBiometricUnavailable}
        loading={loading}
        language={language}
      />

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
