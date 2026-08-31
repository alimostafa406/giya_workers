export const splitUnresolvedBiometricAttendance = (rows = []) => rows.reduce((result, row) => {
  if (row?.resolution_reason === 'inactive_worker') result.inactiveWorkerEvents.push(row)
  else result.urgent.push(row)
  return result
}, { urgent: [], inactiveWorkerEvents: [] })
