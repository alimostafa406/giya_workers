import { useEffect } from 'react'

export const payrollTeamId = (value) => String(value ?? '')

export const findPayrollTeam = (groups = [], selectedTeamId = '') => {
  const selectedId = payrollTeamId(selectedTeamId)
  return selectedId ? groups.find((group) => payrollTeamId(group.id) === selectedId) || null : null
}

export const usePayrollTeamDetail = (selectedTeam, selector) => {
  useEffect(() => {
    if (selectedTeam) document.querySelector(selector)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [selectedTeam, selector])
}
