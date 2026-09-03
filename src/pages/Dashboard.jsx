import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { getAttendanceRequest } from '../api/attendanceApi'
import { getErrorMessage } from '../api/axios'
import { getRecentUnmappedBiometricIdentitiesRequest, getUnresolvedBiometricAttendanceRequest } from '../api/biometricMappingApi'
import { getWorkersRequest } from '../api/workersApi'
import AttendanceAgentStatus from '../components/Attendance/AttendanceAgentStatus'
import UnresolvedBiometricAttendancePanel from '../components/Attendance/UnresolvedBiometricAttendancePanel'
import Table from '../components/Table/Table'
import { useTranslation } from '../i18n/LanguageContext'
import { attendanceRosterCategory, mergeAttendanceRoster } from '../utils/attendanceRoster'
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
  const [recentUnmappedCount, setRecentUnmappedCount] = useState(null)
  const [unresolvedBiometric, setUnresolvedBiometric] = useState([])
  const [unresolvedBiometricUnavailable, setUnresolvedBiometricUnavailable] = useState(false)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const attendanceDate = getTodayLocalDate()
        const [workersRes, attendanceRes, recentUnmappedRes, unresolvedRes] = await Promise.all([
          getWorkersRequest(),
          getAttendanceRequest(),
          getRecentUnmappedBiometricIdentitiesRequest({ days: 7 }).catch(() => ({ data: [], unavailable: true })),
          getUnresolvedBiometricAttendanceRequest({ attendanceDate }).catch(() => ({ data: [], unavailable: true })),
        ])

        setWorkers(asArray(workersRes.data))
        setAttendance(asArray(attendanceRes.data))
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
    date: today,
    businessDate: today,
  }), [attendance, today, workers])

  const presentCount = useMemo(
    () => todayRoster.filter((item) => {
      const status = String(item.status || item.status_key || '').toLowerCase()
      return status === 'half_day' || status === 'present'
    }).length,
    [todayRoster],
  )

  const lateCount = useMemo(
    () => todayRoster.filter((item) => String(item.status || item.status_key || '').toLowerCase() === 'late').length,
    [todayRoster],
  )

  const absentCount = useMemo(
    () => todayRoster.filter((item) => attendanceRosterCategory(item) === 'absent').length,
    [todayRoster],
  )
  const notRecordedCount = todayRoster.filter((item) => attendanceRosterCategory(item) === 'not_recorded').length

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

  const cards = [
    { label: t('dashboard.presentToday'), value: presentCount },
    { label: t('attendance.late'), value: lateCount },
    { label: t('dashboard.absentToday'), value: absentCount },
    { label: t('dashboard.notRecorded'), value: notRecordedCount },
    { label: t('dashboard.totalWorkers'), value: todayRoster.length },
  ]

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
