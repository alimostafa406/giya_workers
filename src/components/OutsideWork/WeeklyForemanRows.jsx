import { Fragment } from 'react'
import { formatClock, formatDuration } from '../../utils/outsideWork'

export default function WeeklyForemanRows({ rows, labels: l, dateLabel, workersById, expanded = [], onToggle, print = false }) {
  return rows.map((row) => {
    const members = row.outside_work_movement_workers || []
    const open = print || expanded.includes(row.id)
    const timeKey = (value) => value ? String(value).padEnd(8, ':00') : ''
    const ranges = new Set(members.map((member) => `${timeKey(member.start_time)}|${timeKey(member.end_time)}`))
    const differing = ranges.size > 1 || members.some((member) =>
      (row.common_worker_start && timeKey(member.start_time) !== timeKey(row.common_worker_start))
      || (row.common_worker_end && timeKey(member.end_time) !== timeKey(row.common_worker_end)))
    const cell = print ? 'border p-2' : 'p-2'
    return <Fragment key={row.id}>
      <tr className="border-t"><td className={cell}>{dateLabel(row.work_date).split(' ')[0]}</td><td className={cell}><bdi dir="ltr">{row.work_date}</bdi></td>
        <td className={cell} dir="ltr">{formatClock(row.start_time)}</td><td className={cell} dir="ltr">{formatClock(row.end_time)}</td>
        <td className={cell}><bdi dir="ltr" className="inline-block whitespace-nowrap">{formatDuration(row.foremanOvertimeMinutes)}</bdi></td>
        <td className={cell}>{members.length}</td>
        {!print && <td className={cell}><button type="button" className="btn-secondary text-sm" aria-expanded={open} onClick={() => onToggle(row.id)}>{`${open ? l.hide : l.show} (${members.length})`}</button></td>}
      </tr>
      {open && <tr><td colSpan={print ? 6 : 7} className="p-2">
        <table className="w-full text-sm"><thead><tr>{[l.workers, l.team, ...(differing ? [l.start, l.end] : [])].map((label) => <th key={label} className="p-2 text-start">{label}</th>)}</tr></thead>
          <tbody>{members.map((member) => <tr key={member.id || member.worker_id} className="border-t"><td className="p-2">{member.worker_name}</td><td className="p-2">{workersById.get(String(member.worker_id))?.team_name || '—'}</td>
            {differing && <><td className="p-2" dir="ltr">{formatClock(member.start_time)}</td><td className="p-2" dir="ltr">{formatClock(member.end_time)}</td></>}
          </tr>)}</tbody></table>
      </td></tr>}
    </Fragment>
  })
}
