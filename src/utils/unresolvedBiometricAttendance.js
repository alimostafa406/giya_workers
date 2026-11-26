export const splitUnresolvedBiometricAttendance = (rows = []) => rows.reduce((result, row) => {
  if (row?.resolution_reason === 'inactive_worker') result.inactiveWorkerEvents.push(row)
  else result.urgent.push(row)
  return result
}, { urgent: [], inactiveWorkerEvents: [] })

// Only a confirmed canonical owner may merge observations across devices.
// Unmapped/ambiguous identities retain exact device + string boundaries.
export const groupUnresolvedBiometricAttendance = (rows = []) => {
  const groups = new Map()
  for (const row of rows) {
    const date = row.attendance_date || (row.event_timestamp ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kinshasa' }).format(new Date(row.event_timestamp)) : '')
    const owner = row.worker_id && row.mapping_review_state === 'confirmed' && !['unmapped', 'ambiguous', 'needs_review'].includes(row.resolution_reason)
      ? ['worker', row.worker_id]
      : ['identity', row.device_id, row.device_employee_no]
    const key = JSON.stringify([owner, date, row.resolution_reason])
    if (!groups.has(key)) groups.set(key, { ...row, issue_key: key, attendance_date: date, events: [], devices: [], identities: [] })
    const group = groups.get(key)
    if (!group.events.some(event => event.event_id && event.event_id === row.event_id)) group.events.push(row)
  }
  return [...groups.values()].map(group => {
    group.events.sort((a, b) => new Date(a.event_timestamp) - new Date(b.event_timestamp))
    group.devices = [...new Set(group.events.map(event => event.device_id))].sort()
    group.identities = [...new Set(group.events.map(event => event.device_employee_no))]
    group.first_timestamp = group.events[0]?.event_timestamp
    group.last_timestamp = group.events.at(-1)?.event_timestamp
    return group
  })
}
