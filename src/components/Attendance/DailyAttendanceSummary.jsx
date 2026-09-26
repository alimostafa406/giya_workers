import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { filterDailyMonitoringRows } from '../../utils/dailyReportCenter.js'

const time = (value) => value && value !== '—' ? String(value).slice(0, 5) : '—'
const statusKeys = { present: 'present', half_day: 'halfDay', absent: 'absent', late: 'late', pending: 'pending', in_progress: 'inProgress', not_recorded: 'notRecorded' }

export default function DailyAttendanceSummary({ rows, counts, labels, t }) {
  const [filter, setFilter] = useState(null)
  const cards = [
    ['present', 'dashboard.presentToday', counts.present],
    ['half_day', 'dashboard.halfDay', counts.half_day],
    ['absent', 'dashboard.absentToday', counts.absent],
    ['not_recorded', 'dashboard.notRecorded', counts.not_recorded],
    ['all', 'dashboard.totalWorkers', counts.total],
  ]
  const selectedRows = filter ? filterDailyMonitoringRows(rows, filter) : []
  const statusLabel = (row) => row.roster_state === 'biometric_pending'
    ? t('attendance.pending')
    : row.status ? (statusKeys[row.status] ? t(`attendance.${statusKeys[row.status]}`) : String(row.status)) : t('attendance.notRecorded')

  return <section className="daily-center-screen-only mb-8">
    <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">{cards.map(([key, label, value]) => <button type="button" key={key} aria-pressed={filter === key} aria-controls="daily-monitoring-worker-list" onClick={() => setFilter(key)} className={`cursor-pointer rounded-xl border p-3 text-start transition hover:border-blue-500 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-blue-600 ${filter === key ? 'border-blue-600 bg-blue-50 ring-2 ring-blue-500' : 'border-(--border) bg-white'}`}><span className="block text-sm text-(--muted)">{t(label)}</span><span className="mt-1 block text-2xl font-extrabold">{value}</span></button>)}</div>
    {filter && <div id="daily-monitoring-worker-list" className="rounded-xl border border-(--border) bg-white p-4"><h2 className="mb-3 text-lg font-extrabold">{t(cards.find(([key]) => key === filter)[1])} ({selectedRows.length})</h2>
      {selectedRows.length ? <div className="daily-center-table-wrap"><table className="daily-center-table"><thead><tr><th>{labels.worker}</th><th>{t('workers.employeeCode')}</th><th>{labels.biometric}</th><th>{labels.team}</th><th>{labels.status}</th><th>{labels.in}</th><th>{labels.out}</th><th>{labels.last}</th><th>{t('common.details')}</th></tr></thead><tbody>{selectedRows.map((row) => <tr key={row.workerId}><td className="font-bold">{row.workerName}</td><td dir="ltr">{row.employeeCode}</td><td dir="ltr">{row.biometricId}</td><td>{row.teamName}</td><td>{statusLabel(row)}</td><td dir="ltr">{time(row.check_in)}</td><td dir="ltr">{time(row.check_out)}</td><td dir="ltr">{time(row.lastPunch)}</td><td><Link className="font-bold text-blue-700 underline" to={`/worker-control-center/worker/${encodeURIComponent(row.workerId)}`}>{t('common.details')}</Link></td></tr>)}</tbody></table></div> : <p className="py-5 text-center text-(--muted)">{labels.noRows}</p>}
    </div>}
  </section>
}
