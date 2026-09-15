export const payrollTeamId = (value) => String(value ?? '')

export const findPayrollTeam = (groups = [], selectedTeamId = '') => {
  const selectedId = payrollTeamId(selectedTeamId)
  return selectedId ? groups.find((group) => payrollTeamId(group.id) === selectedId) || null : null
}
