import { useEffect, useMemo, useState } from 'react'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
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

const getDateInputValue = (date) => {
  const local = new Date(date)
  local.setMinutes(local.getMinutes() - local.getTimezoneOffset())
  return local.toISOString().slice(0, 10)
}

const getDefaultWeekRange = () => {
  const today = new Date()
  const day = today.getDay()
  const offsetToSaturday = (day + 1) % 7
  const start = new Date(today)
  // On Saturday a new workweek has just begun. Open the report on the most
  // recently completed Saturday–Friday week so Friday's finalized attendance
  // is visible immediately; managers can still select any range manually.
  start.setDate(today.getDate() - offsetToSaturday - (day === 6 ? 7 : 0))
  const end = new Date(start)
  end.setDate(start.getDate() + 6)

  return {
    startDate: getDateInputValue(start),
    endDate: getDateInputValue(end),
  }
}

const toMidnightDate = (dateText) => new Date(`${dateText}T00:00:00`)

const buildDateRange = (startDate, endDate) => {
  if (!startDate || !endDate) {
    return []
  }

  const start = toMidnightDate(startDate)
  const end = toMidnightDate(endDate)

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return []
  }

  const dates = []
  const cursor = new Date(start)
  while (cursor <= end) {
    dates.push(getDateInputValue(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }

  return dates
}

const getAttendanceDate = (row) => row.attendance_date || row.date || '-'
const getAttendanceKey = (row) => row.worker_id || row.id

const getReportDayStatus = (status) => {
  const normalized = String(status || '').toLowerCase()
  if (normalized === 'present' || normalized === 'حاضر') {
    return 'present'
  }
  if (normalized === 'half_day') {
    return 'half_day'
  }
  return 'absent'
}

const getDayLabel = (dateText, language) => {
  const date = toMidnightDate(dateText)
  const locale = { ar: 'ar', en: 'en-US', fr: 'fr-FR' }[language] || 'en-US'
  const dayName = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date)
  return `${dayName} ${dateText.slice(5)}`
}

function WeeklyAttendanceReport() {
  const { t, language } = useTranslation()
  const statusToLabel = (status) => {
    if (status === 'present') return t('reports.present')
    if (status === 'half_day') return '½'
    return '-'
  }
  const defaultWeekRange = useMemo(() => getDefaultWeekRange(), [])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [teams, setTeams] = useState([])
  const [workers, setWorkers] = useState([])
  const [attendance, setAttendance] = useState([])
  const [weeklyFilters, setWeeklyFilters] = useState({
    startDate: defaultWeekRange.startDate,
    endDate: defaultWeekRange.endDate,
    teamId: '',
    supervisorId: '',
  })

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
    () => buildDateRange(weeklyFilters.startDate, weeklyFilters.endDate),
    [weeklyFilters.startDate, weeklyFilters.endDate],
  )

  const selectedTeam = useMemo(
    () => teams.find((team) => String(team.id) === String(weeklyFilters.teamId)) || null,
    [teams, weeklyFilters.teamId],
  )

  const reportTitle = selectedTeam
    ? t('reports.weeklyTitleForTeam', { team: selectedTeam.name })
    : t('reports.weeklyTitle')

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
      const nextStatus = getReportDayStatus(row.status || row.status_key)

      if (!prev || (prev !== 'present' && nextStatus === 'present')) {
        attendanceByWorkerDay.set(mapKey, nextStatus)
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

      let presentDays = 0
      let absentDays = 0

      weeklyDates.forEach((date, index) => {
        const status = attendanceByWorkerDay.get(`${String(worker.id)}|${date}`) || 'absent'
        row[`day_${index}`] = status

        if (status === 'present') {
          presentDays += 1
        } else {
          absentDays += 1
        }
      })

      row.presentDays = presentDays
      row.absentDays = absentDays

      return row
    })
  }, [attendance, teams, weeklyDates, weeklyFilters.supervisorId, weeklyFilters.teamId, workers, t])

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
  }, [weeklyDates, language, t])

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
    [weeklyDates, weeklyReportRows],
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
      <html>
        <head>
          <title>${reportTitle}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; }
            table { border-collapse: collapse; width: 100%; }
            th, td { border: 1px solid #ccc; padding: 6px; text-align: left; font-size: 12px; }
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

    const doc = new jsPDF({ orientation: 'landscape' })
    doc.setFontSize(14)
    doc.text(reportTitle, 14, 14)
    autoTable(doc, {
      head: [exportHeaders],
      body: exportRows,
      startY: 20,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [39, 39, 42] },
    })
    doc.save(`weekly-attendance-${weeklyFilters.startDate}-to-${weeklyFilters.endDate}.pdf`)
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

      <div className="surface-card mb-4 grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
        <div>
          <label className="mb-1 block text-sm font-semibold">{t('reports.from')}</label>
          <input
            type="date"
            value={weeklyFilters.startDate}
            onChange={(e) => setWeeklyFilters((prev) => ({ ...prev, startDate: e.target.value }))}
            className="input-base"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-semibold">{t('reports.to')}</label>
          <input
            type="date"
            value={weeklyFilters.endDate}
            onChange={(e) => setWeeklyFilters((prev) => ({ ...prev, endDate: e.target.value }))}
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
            emptyMessage={t('reports.noData')}
          />
        </>
      )}
    </section>
  )
}

export default WeeklyAttendanceReport
