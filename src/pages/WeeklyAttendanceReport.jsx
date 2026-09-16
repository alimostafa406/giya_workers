import { useCallback, useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { getAttendanceRequest } from '../api/attendanceApi'
import { getErrorMessage } from '../api/axios'
import { getTeamsRequest } from '../api/teamsApi'
import { getWorkersRequest } from '../api/workersApi'
import { reviewWeeklyAttendanceRequest } from '../api/weeklyAttendanceReviewApi'
import ReportWorkerSearch from '../components/Reports/ReportWorkerSearch'
import Table from '../components/Table/Table'
import { useTranslation } from '../i18n/LanguageContext'
import {
  buildWeeklyReportDateRange,
  getDefaultWeeklyReportRange,
  getWeeklyReportRange,
  getWeeklyReportBusinessDate,
  normalizeWeeklyAttendanceStatus,
  shiftWeeklyReportRange,
  summarizeWeeklyAttendanceDays,
} from '../utils/weeklyAttendanceReport'
import { reportWorkerMatchesSearch } from '../utils/reportWorkerSearch'

const asArray = (value) => {
  if (Array.isArray(value)) {
    return value
  }
  if (Array.isArray(value?.data)) {
    return value.data
  }
  return []
}

const toMidnightDate = (dateText) => new Date(`${dateText}T00:00:00`)

const getAttendanceDate = (row) => row.attendance_date || row.date || '-'
const getAttendanceKey = (row) => row.worker_id || row.id

const getDayLabel = (dateText, language) => {
  const date = toMidnightDate(dateText)
  const locale = { ar: 'ar', en: 'en-US', fr: 'fr-FR' }[language] || 'en-US'
  const dayName = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date)
  return `${dayName} ${dateText.slice(5)}`
}

function WeeklyAttendanceReport() {
  const { t, language } = useTranslation()
  const statusToLabel = useCallback((status) => {
    if (status === 'present' || status === 'sunday_present') return t('reports.present')
    if (status === 'half_day' || status === 'sunday_half_day') return '½'
    if (status === 'absent') return '-'
    return '—'
  }, [t])
  const defaultWeekRange = useMemo(() => getDefaultWeeklyReportRange(), [])
  const businessDate = useMemo(() => getWeeklyReportBusinessDate(), [])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [teams, setTeams] = useState([])
  const [workers, setWorkers] = useState([])
  const [attendance, setAttendance] = useState([])
  const [reviewing, setReviewing] = useState(false)
  const [reviewResult, setReviewResult] = useState(null)
  const [weeklyFilters, setWeeklyFilters] = useState({
    startDate: defaultWeekRange.startDate,
    endDate: defaultWeekRange.endDate,
    teamId: '',
    supervisorId: '',
    search: '',
  })
  const weekNavigationLabels = {
    ar: { previous: 'الأسبوع السابق', current: 'الأسبوع الحالي', next: 'الأسبوع التالي' },
    en: { previous: 'Previous week', current: 'Current week', next: 'Next week' },
    fr: { previous: 'Semaine précédente', current: 'Semaine actuelle', next: 'Semaine suivante' },
  }[language] || { previous: 'Previous week', current: 'Current week', next: 'Next week' }

  const setReportWeek = (range) => {
    setWeeklyFilters((prev) => ({ ...prev, ...range }))
  }

  const selectWeekContaining = (date) => {
    if (date) setReportWeek(getWeeklyReportRange(date))
  }

  const moveReportWeek = (weekOffset) => {
    setReportWeek(shiftWeeklyReportRange(weeklyFilters.startDate, weekOffset))
  }

  const loadSelectedWeek = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [teamsRes, workersRes, attendanceRes] = await Promise.all([
        getTeamsRequest(),
        getWorkersRequest(),
        getAttendanceRequest({
          date_from: weeklyFilters.startDate,
          date_to: weeklyFilters.endDate,
          paginate: true,
        }),
      ])
      setTeams(asArray(teamsRes.data))
      setWorkers(asArray(workersRes.data))
      setAttendance(asArray(attendanceRes.data))
      return true
    } catch (err) {
      setError(getErrorMessage(err))
      return false
    } finally {
      setLoading(false)
    }
  }, [weeklyFilters.startDate, weeklyFilters.endDate])

  useEffect(() => {
    loadSelectedWeek()
  }, [loadSelectedWeek])

  const handleReviewWeekBiometrics = async () => {
    if (reviewing || !window.confirm(t('reports.reviewWeekConfirmation', {
      start: weeklyFilters.startDate,
      end: weeklyFilters.endDate,
    }))) return
    setReviewing(true)
    setReviewResult(null)
    setError('')
    try {
      const result = await reviewWeeklyAttendanceRequest({
        dateFrom: weeklyFilters.startDate,
        dateTo: weeklyFilters.endDate,
      })
      setReviewResult(result)
      await loadSelectedWeek()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setReviewing(false)
    }
  }

  const supervisorsOptions = useMemo(() => {
    const byId = new Map()
    teams.forEach((team) => {
      if (!team.supervisor_id) {
        return
      }

      byId.set(String(team.supervisor_id), {
        id: String(team.supervisor_id),
        name: team.supervisor?.full_name || team.supervisor_name || t('common.noSupervisor'),
      })
    })

    return Array.from(byId.values())
  }, [teams, t])

  const weeklyDates = useMemo(
    () => buildWeeklyReportDateRange(weeklyFilters.startDate, weeklyFilters.endDate),
    [weeklyFilters.startDate, weeklyFilters.endDate],
  )

  const selectedTeam = useMemo(
    () => teams.find((team) => String(team.id) === String(weeklyFilters.teamId)) || null,
    [teams, weeklyFilters.teamId],
  )

  const reportBaseTitle = selectedTeam
    ? t('reports.weeklyTitleForTeam', { team: selectedTeam.name })
    : t('reports.weeklyTitle')
  const reportTitle = `${reportBaseTitle} — ${weeklyFilters.startDate} → ${weeklyFilters.endDate}`

  const weeklyReportRows = useMemo(() => {
    if (!weeklyFilters.teamId || weeklyDates.length === 0) {
      return []
    }

    const teamsById = new Map(teams.map((team) => [String(team.id), team]))
    const selectedDates = new Set(weeklyDates)
    const attendanceByWorkerDay = new Map()

    attendance.forEach((row) => {
      const date = getAttendanceDate(row)
      if (!selectedDates.has(date)) {
        return
      }

      const workerId = String(getAttendanceKey(row))
      const mapKey = `${workerId}|${date}`
      const prev = attendanceByWorkerDay.get(mapKey)
      const nextAttendance = { ...row, status: normalizeWeeklyAttendanceStatus(row.status || row.status_key) }
      const priority = { unresolved: 0, absent: 1, half_day: 2, late: 3, present: 4 }

      if (!prev || priority[nextAttendance.status] > priority[prev.status]) {
        attendanceByWorkerDay.set(mapKey, nextAttendance)
      }
    })

    const filteredWorkers = workers.filter((worker) => {
      if (worker.is_active === false) {
        return false
      }

      const teamId = String(worker.team_id || '')
      const team = teamsById.get(teamId)

      if (weeklyFilters.teamId && teamId !== String(weeklyFilters.teamId)) {
        return false
      }

      if (
        weeklyFilters.supervisorId
        && String(team?.supervisor_id || '') !== String(weeklyFilters.supervisorId)
      ) {
        return false
      }

      if (!reportWorkerMatchesSearch(worker, weeklyFilters.search)) return false

      return true
    })

    return filteredWorkers.map((worker) => {
      const team = teamsById.get(String(worker.team_id || ''))
      const row = {
        id: worker.id,
        workerName: worker.full_name || '-',
        teamName: team?.name || worker.team?.name || worker.team_name || '-',
        supervisorName: team?.supervisor?.full_name || team?.supervisor_name || t('common.noSupervisor'),
      }

      const summary = summarizeWeeklyAttendanceDays({
        dates: weeklyDates,
        businessDate,
        getAttendance: (date) => attendanceByWorkerDay.get(`${String(worker.id)}|${date}`),
      })

      summary.days.forEach((day, index) => {
        row[`day_${index}`] = day.status
      })
      row.presentDays = summary.presentDays
      row.absentDays = summary.absentDays

      return row
    })
  }, [attendance, businessDate, teams, weeklyDates, weeklyFilters.search, weeklyFilters.supervisorId, weeklyFilters.teamId, workers, t])

  const weeklyColumns = useMemo(() => {
    const baseColumns = [
      {
        key: 'workerName',
        header: t('reports.worker'),
        render: (row) => row.workerName,
      },
      {
        key: 'teamName',
        header: t('reports.team'),
        render: (row) => row.teamName,
      },
      {
        key: 'supervisorName',
        header: t('reports.supervisor'),
        render: (row) => row.supervisorName,
      },
    ]

    const dayColumns = weeklyDates.map((date, index) => ({
      key: `day_${index}`,
      header: getDayLabel(date, language),
      render: (row) => statusToLabel(row[`day_${index}`]),
    }))

    return [
      ...baseColumns,
      ...dayColumns,
      {
        key: 'presentDays',
        header: t('reports.presentDays'),
        render: (row) => row.presentDays,
      },
      {
        key: 'absentDays',
        header: t('reports.absentDays'),
        render: (row) => row.absentDays,
      },
    ]
  }, [weeklyDates, language, statusToLabel, t])

  const exportHeaders = useMemo(
    () => [
      t('reports.worker'),
      t('reports.team'),
      t('reports.supervisor'),
      ...weeklyDates.map((date) => getDayLabel(date, language)),
      t('reports.presentDays'),
      t('reports.absentDays'),
    ],
    [weeklyDates, language, t],
  )

  const exportRows = useMemo(
    () => weeklyReportRows.map((row) => ([
      row.workerName,
      row.teamName,
      row.supervisorName,
      ...weeklyDates.map((_, index) => statusToLabel(row[`day_${index}`])),
      row.presentDays,
      row.absentDays,
    ])),
    [statusToLabel, weeklyDates, weeklyReportRows],
  )

  const handlePrintWeeklyReport = () => {
    if (!selectedTeam) {
      return
    }

    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      return
    }

    const tableRows = exportRows
      .map((cells) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
      .join('')

    printWindow.document.write(`
      <html dir="${language === 'ar' ? 'rtl' : 'ltr'}">
        <head>
          <title>${reportTitle}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; }
            table { border-collapse: collapse; width: 100%; }
            th, td { border: 1px solid #ccc; padding: 6px; text-align: ${language === 'ar' ? 'right' : 'left'}; font-size: 12px; }
            h2 { margin-bottom: 12px; }
          </style>
        </head>
        <body>
          <h2>${reportTitle}</h2>
          <table>
            <thead>
              <tr>${exportHeaders.map((header) => `<th>${header}</th>`).join('')}</tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
        </body>
      </html>
    `)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
  }

  const handleExportWeeklyPdf = () => {
    if (!selectedTeam) {
      return
    }
    handlePrintWeeklyReport()
  }

  const handleExportWeeklyExcel = () => {
    if (!selectedTeam) {
      return
    }

    const sheet = XLSX.utils.aoa_to_sheet([[reportTitle], [], exportHeaders, ...exportRows])
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, t('reports.weeklySheet'))
    XLSX.writeFile(workbook, `weekly-attendance-${weeklyFilters.startDate}-to-${weeklyFilters.endDate}.xlsx`)
  }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-extrabold">{reportTitle}</h2>
      </div>

      {error ? (
        <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary px-3 py-2" onClick={() => moveReportWeek(-1)}>
          {weekNavigationLabels.previous}
        </button>
        <button type="button" className="btn-secondary px-3 py-2" onClick={() => setReportWeek(getWeeklyReportRange(businessDate))}>
          {weekNavigationLabels.current}
        </button>
        <button type="button" className="btn-secondary px-3 py-2" onClick={() => moveReportWeek(1)}>
          {weekNavigationLabels.next}
        </button>
      </div>

      <div className="surface-card mb-4 grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-5">
        <div>
          <label className="mb-1 block text-sm font-semibold">{t('reports.from')}</label>
          <input
            type="date"
            value={weeklyFilters.startDate}
            onChange={(e) => selectWeekContaining(e.target.value)}
            className="input-base"
          />
        </div>

        <ReportWorkerSearch
          value={weeklyFilters.search}
          onChange={(search) => setWeeklyFilters((prev) => ({ ...prev, search }))}
          label={t('reports.workerSearchLabel')}
          placeholder={t('reports.workerSearchPlaceholder')}
        />

        <div>
          <label className="mb-1 block text-sm font-semibold">{t('reports.to')}</label>
          <input
            type="date"
            value={weeklyFilters.endDate}
            onChange={(e) => selectWeekContaining(e.target.value)}
            className="input-base"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-semibold">{t('reports.team')}</label>
          <select
            value={weeklyFilters.teamId}
            onChange={(e) => setWeeklyFilters((prev) => ({ ...prev, teamId: e.target.value }))}
            className="input-base"
          >
            <option value="">{t('common.chooseTeam')}</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-semibold">{t('reports.supervisor')}</label>
          <select
            value={weeklyFilters.supervisorId}
            onChange={(e) => setWeeklyFilters((prev) => ({ ...prev, supervisorId: e.target.value }))}
            className="input-base"
          >
            <option value="">{t('reports.allSupervisors')}</option>
            {supervisorsOptions.map((supervisor) => (
              <option key={supervisor.id} value={supervisor.id}>
                {supervisor.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-primary px-3 py-2"
          onClick={handleReviewWeekBiometrics}
          disabled={reviewing || loading || weeklyDates.length !== 6}
        >
          {reviewing ? t('reports.reviewingWeekBiometrics') : t('reports.reviewWeekBiometrics')}
        </button>
        <button type="button" className="btn-secondary px-3 py-2" onClick={handlePrintWeeklyReport} disabled={!selectedTeam}>
          {t('reports.print')}
        </button>
        <button type="button" className="btn-secondary px-3 py-2" onClick={handleExportWeeklyPdf} disabled={!selectedTeam}>
          {t('reports.pdf')}
        </button>
        <button type="button" className="btn-secondary px-3 py-2" onClick={handleExportWeeklyExcel} disabled={!selectedTeam}>
          {t('reports.excel')}
        </button>
      </div>

      {reviewResult ? (
        <div className={`surface-card mb-4 border p-4 ${reviewResult.completed ? 'border-emerald-200' : 'border-amber-300'}`}>
          <h3 className="font-extrabold">{t('reports.weekReviewSummary')}</h3>
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <span>{t('reports.workersEvaluated')}: <strong>{reviewResult.workers_evaluated}</strong></span>
            <span>{t('reports.workdaysEvaluated')}: <strong>{reviewResult.workdays_evaluated}</strong></span>
            <span>{t('reports.eventsProcessed')}: <strong>{reviewResult.biometric_events_processed}</strong></span>
            <span>{t('reports.rowsInserted')}: <strong>{reviewResult.attendance_rows_inserted}</strong></span>
            <span>{t('reports.rowsUpdated')}: <strong>{reviewResult.attendance_rows_updated}</strong></span>
            <span>{t('reports.rowsUnchanged')}: <strong>{reviewResult.attendance_rows_unchanged}</strong></span>
            <span>{t('reports.protectedSkipped')}: <strong>{reviewResult.manual_protected_rows_skipped}</strong></span>
            <span>{t('reports.unmatchedIdentities')}: <strong>{reviewResult.unmatched_biometric_identities?.length || 0}</strong></span>
            <span>{t('reports.reviewErrors')}: <strong>{reviewResult.errors?.length || 0}</strong></span>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-180 border-collapse text-sm">
              <thead><tr className="bg-(--surface-soft)"><th className="border border-(--border) p-2">{t('payroll.day')}</th><th className="border border-(--border) p-2">{t('reports.present')}</th><th className="border border-(--border) p-2">{t('attendance.halfDay')}</th><th className="border border-(--border) p-2">{t('reports.absent')}</th><th className="border border-(--border) p-2">{t('reports.rowsUpdated')}</th><th className="border border-(--border) p-2">{t('reports.rowsUnchanged')}</th></tr></thead>
              <tbody>{reviewResult.per_day?.map((day) => <tr key={day.date}><td className="border border-(--border) p-2 font-semibold">{day.date}</td><td className="border border-(--border) p-2">{day.present}</td><td className="border border-(--border) p-2">{day.half_day}</td><td className="border border-(--border) p-2">{day.absent}</td><td className="border border-(--border) p-2">{day.updated}</td><td className="border border-(--border) p-2">{day.unchanged}</td></tr>)}</tbody>
            </table>
          </div>
          {reviewResult.unmatched_biometric_identities?.length ? (
            <details className="mt-3 text-sm"><summary className="cursor-pointer font-bold">{t('reports.unmatchedIdentities')}</summary><ul className="mt-2 space-y-1">{reviewResult.unmatched_biometric_identities.map((item, index) => <li key={`${item.device}-${item.serialNo || index}`}>{item.date} {item.timestamp} · {item.device} · {item.employeeNoString} · {item.reason}</li>)}</ul></details>
          ) : null}
        </div>
      ) : null}

      {!weeklyFilters.teamId ? (
        <div className="surface-card p-4 text-sm text-(--muted)">{t('reports.selectTeamToView')}</div>
      ) : weeklyDates.length === 0 ? (
        <div className="surface-card p-4 text-sm text-(--muted)">{t('reports.invalidRange')}</div>
      ) : (
        <>
          <p className="mb-3 text-xs text-(--muted)">
            <span className="font-bold">-</span> = {t('reports.absent')}
            <span className="mx-2">·</span>
            <span className="font-bold">½</span> = {t('attendance.halfDay')}
          </p>
          <Table
            columns={weeklyColumns}
            data={weeklyReportRows}
            loading={loading}
            emptyMessage={weeklyFilters.search.trim() ? t('common.noResults') : t('reports.noData')}
          />
        </>
      )}
    </section>
  )
}

export default WeeklyAttendanceReport
