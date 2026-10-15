import { durationMinutes, foremanOvertimeMinutes, formatClock, formatDuration, hasOutsideWorkForeman } from '../../utils/outsideWork'

export default function OutsideWorkMovementCard({ row, workersById, teamName, labels: l, language, open, onToggle, onEdit, onDelete, busy }) {
  const members = row.outside_work_movement_workers || []
  const timeKey = (time) => !time ? '' : String(time).length === 5 ? `${time}:00` : String(time)
  const ranges = [...new Map(members.map((member) => [`${timeKey(member.start_time)}|${timeKey(member.end_time)}`, member])).values()]
  const workerStart = row.common_worker_start || (ranges.length === 1 ? ranges[0].start_time : null)
  const workerEnd = row.common_worker_end || (ranges.length === 1 ? ranges[0].end_time : null)
  const individualTimes = ranges.length > 1 || members.some((member) => timeKey(member.start_time) !== timeKey(workerStart) || timeKey(member.end_time) !== timeKey(workerEnd))
  return <article className="outside-work-movement">
    <header className="outside-work-movement-heading"><h3><bdi>{teamName}</bdi></h3><span className="outside-work-status">{l.finalBadge}</span></header>
    <div className="outside-work-movement-times">
      {hasOutsideWorkForeman(row) && <div aria-label={l.foreman}>
        <p className="outside-work-person"><span>{l.foreman}</span><strong><bdi>{row.foreman_name}</bdi></strong></p>
        <p><bdi dir="ltr">{formatClock(row.start_time)} → {formatClock(row.end_time)}</bdi></p>
        <p className="outside-work-caption">{l.overtime}: <bdi dir="ltr">{formatDuration(foremanOvertimeMinutes(row.work_date, row.end_time))}</bdi>
          <span className="outside-work-duration"> · {l.duration}: <bdi dir="ltr">{formatDuration(durationMinutes(row.start_time, row.end_time))}</bdi></span></p>
      </div>}
      <div aria-label={l.workers}>
        <p className="outside-work-person"><span>{l.workers}</span><strong>{members.length}</strong></p>
        {workerStart && workerEnd ? <p><bdi dir="ltr">{formatClock(workerStart)} → {formatClock(workerEnd)}</bdi></p>
          : <p className="outside-work-caption">{({ ar: 'أوقات فردية موضحة في تفاصيل العمال', en: 'Individual times shown in worker details', fr: 'Horaires individuels dans les détails des travailleurs' })[language]}</p>}
      </div>
    </div>
    <footer className="outside-work-movement-actions">
      <button type="button" className="outside-work-text-action" aria-expanded={open} onClick={onToggle}>{`${open ? l.hide : l.show} (${members.length})`}</button>
      <button type="button" className="outside-work-text-action" disabled={busy} onClick={onEdit}>{l.edit}</button>
      <button type="button" className="outside-work-text-action outside-work-delete" disabled={busy} onClick={onDelete}>{l.delete}</button>
    </footer>
    {open && <div className="outside-work-table-scroll"><table className="outside-work-compact-table"><thead><tr>{[l.workers, l.team, ...(individualTimes ? [l.start, l.end] : [])].map((label) => <th key={label}>{label}</th>)}</tr></thead>
      <tbody>{members.map((member) => <tr key={member.id || member.worker_id}><td><bdi>{member.worker_name}</bdi></td><td><bdi>{workersById.get(String(member.worker_id))?.team_name || '—'}</bdi></td>
        {individualTimes && <><td><bdi dir="ltr">{formatClock(member.start_time)}</bdi></td><td><bdi dir="ltr">{formatClock(member.end_time)}</bdi></td></>}</tr>)}</tbody></table></div>}
  </article>
}
