import { useEffect, useMemo, useState } from 'react'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import { getAttendanceRequest } from '../api/attendanceApi'
import { getErrorMessage } from '../api/axios'
import { getTeamsRequest } from '../api/teamsApi'
import { getWorkersRequest } from '../api/workersApi'
import Table from '../components/Table/Table'

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
  start.setDate(today.getDate() - offsetToSaturday)
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

const isPresentStatus = (status) => {
  const normalized = String(status || '').toLowerCase()
  return normalized === 'present' || normalized === 'حاضر'
}

const getDayLabel = (dateText) => {
  const date = toMidnightDate(dateText)
  const dayName = new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(date)
  return `${dayName} ${dateText.slice(5)}`
}

const statusToLabel = (status) => (status === 'present' ? 'Present' : 'Absent')

function WeeklyAttendanceReport() {
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
        name: team.supervisor?.full_name || team.supervisor_name || 'بدون مشرف',
      })
    })

    return Array.from(byId.values())
  }, [teams])

  const weeklyDates = useMemo(
    () => buildDateRange(weeklyFilters.startDate, weeklyFilters.endDate),
    [weeklyFilters.startDate, weeklyFilters.endDate],
  )

  const weeklyReportRows = useMemo(() => {
    if (weeklyDates.length === 0) {
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
      const nextStatus = isPresentStatus(row.status || row.status_key) ? 'present' : 'absent'

      if (!prev || (prev === 'absent' && nextStatus === 'present')) {
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
        supervisorName: team?.supervisor?.full_name || team?.supervisor_name || 'بدون مشرف',
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
  }, [attendance, teams, weeklyDates, weeklyFilters.supervisorId, weeklyFilters.teamId, workers])

  const weeklyColumns = useMemo(() => {
    const baseColumns = [
      {
        key: 'workerName',
        header: 'Worker',
        render: (row) => row.workerName,
      },
      {
        key: 'teamName',
        header: 'Team',
        render: (row) => row.teamName,
      },
      {
        key: 'supervisorName',
        header: 'Supervisor',
        render: (row) => row.supervisorName,
      },
    ]

    const dayColumns = weeklyDates.map((date, index) => ({
      key: `day_${index}`,
      header: getDayLabel(date),
      render: (row) => statusToLabel(row[`day_${index}`]),
    }))

    return [
      ...baseColumns,
      ...dayColumns,
      {
        key: 'presentDays',
        header: 'Present Days',
        render: (row) => row.presentDays,
      },
      {
        key: 'absentDays',
        header: 'Absent Days',
        render: (row) => row.absentDays,
      },
    ]
  }, [weeklyDates])

  const exportHeaders = useMemo(
    () => [
      'Worker',
      'Team',
      'Supervisor',
      ...weeklyDates.map((date) => getDayLabel(date)),
      'Present Days',
      'Absent Days',
    ],
    [weeklyDates],
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
          <title>Weekly Attendance Report</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; }
            table { border-collapse: collapse; width: 100%; }
            th, td { border: 1px solid #ccc; padding: 6px; text-align: left; font-size: 12px; }
            h2 { margin-bottom: 12px; }
          </style>
        </head>
        <body>
          <h2>Weekly Attendance Report</h2>
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
    const doc = new jsPDF({ orientation: 'landscape' })
    autoTable(doc, {
      head: [exportHeaders],
      body: exportRows,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [39, 39, 42] },
    })
    doc.save(`weekly-attendance-${weeklyFilters.startDate}-to-${weeklyFilters.endDate}.pdf`)
  }

  const handleExportWeeklyExcel = () => {
    const sheet = XLSX.utils.aoa_to_sheet([exportHeaders, ...exportRows])
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, 'Weekly Attendance')
    XLSX.writeFile(workbook, `weekly-attendance-${weeklyFilters.startDate}-to-${weeklyFilters.endDate}.xlsx`)
  }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-extrabold">Weekly Attendance Report</h2>
      </div>

      {error ? (
        <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="surface-card mb-4 grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
        <div>
          <label className="mb-1 block text-sm font-semibold">Start Date</label>
          <input
            type="date"
            value={weeklyFilters.startDate}
            onChange={(e) => setWeeklyFilters((prev) => ({ ...prev, startDate: e.target.value }))}
            className="input-base"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-semibold">End Date</label>
          <input
            type="date"
            value={weeklyFilters.endDate}
            onChange={(e) => setWeeklyFilters((prev) => ({ ...prev, endDate: e.target.value }))}
            className="input-base"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-semibold">Team</label>
          <select
            value={weeklyFilters.teamId}
            onChange={(e) => setWeeklyFilters((prev) => ({ ...prev, teamId: e.target.value }))}
            className="input-base"
          >
            <option value="">All Teams</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-semibold">Supervisor</label>
          <select
            value={weeklyFilters.supervisorId}
            onChange={(e) => setWeeklyFilters((prev) => ({ ...prev, supervisorId: e.target.value }))}
            className="input-base"
          >
            <option value="">All Supervisors</option>
            {supervisorsOptions.map((supervisor) => (
              <option key={supervisor.id} value={supervisor.id}>
                {supervisor.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary px-3 py-2" onClick={handlePrintWeeklyReport}>
          Print Report
        </button>
        <button type="button" className="btn-secondary px-3 py-2" onClick={handleExportWeeklyPdf}>
          Export PDF
        </button>
        <button type="button" className="btn-secondary px-3 py-2" onClick={handleExportWeeklyExcel}>
          Export Excel (.xlsx)
        </button>
      </div>

      {weeklyDates.length === 0 ? (
        <div className="surface-card p-4 text-sm text-(--muted)">يرجى اختيار مدى زمني صحيح للتقرير الأسبوعي.</div>
      ) : (
        <Table
          columns={weeklyColumns}
          data={weeklyReportRows}
          loading={loading}
          emptyMessage="لا توجد بيانات للفلاتر المختارة"
        />
      )}
    </section>
  )
}

export default WeeklyAttendanceReport
