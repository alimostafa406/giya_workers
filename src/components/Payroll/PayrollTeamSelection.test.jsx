// @vitest-environment jsdom
import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { findPayrollTeam, usePayrollTeamDetail } from '../../utils/payrollTeamSelection'
import WeeklyPayrollTeamSummary from './WeeklyPayrollTeamSummary'
import MonthlyPayrollTeamSummary from './MonthlyPayrollTeamSummary'

globalThis.React = React

const groups = [
  { id: 'team-a', name: 'Team A', lines: [{ worker: { id: 'a', full_name: 'Worker Alpha' }, currency: 'CDF', finalAmount: 10 }] },
  { id: 'team-b', name: 'Team B', lines: [{ worker: { id: 'b', full_name: 'Worker Beta' }, currency: 'CDF', finalAmount: 20 }] },
]

function Flow({ Summary, detailSelector }) {
  const [selectedTeamId, setSelectedTeamId] = useState('')
  const selectedTeam = findPayrollTeam(groups, selectedTeamId)
  usePayrollTeamDetail(selectedTeam, detailSelector)
  return <LanguageProvider><Summary groups={groups} selectedTeamId={selectedTeamId} onSelectTeam={setSelectedTeamId} />{selectedTeam ? <div data-testid="team-detail" className={detailSelector.includes('monthly') ? 'mt-4' : ''} data-weekly-team-review={detailSelector.includes('weekly') ? '' : undefined}>{selectedTeam.lines.map((line) => <span key={line.worker.id}>{line.worker.full_name}</span>)}</div> : null}</LanguageProvider>
}

describe.each([
  ['weekly', WeeklyPayrollTeamSummary, '[data-weekly-team-review]'],
  ['monthly', MonthlyPayrollTeamSummary, '[data-monthly-team-summary] + .mt-4'],
])('%s payroll team interaction', (_name, Summary, detailSelector) => {
  afterEach(cleanup)
  beforeEach(() => {
    localStorage.setItem('workers_app_language', 'en')
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('clicks real team controls, renders that team workers, switches teams, and reveals details', () => {
    render(<Flow Summary={Summary} detailSelector={detailSelector} />)
    expect(screen.queryByTestId('team-detail')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Team A' }))
    expect(screen.getByText('Worker Alpha')).toBeTruthy()
    expect(screen.queryByText('Worker Beta')).toBeNull()
    expect(screen.getByRole('button', { name: 'Team A' }).closest('tr').className).toContain('is-selected')
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Team B' }))
    expect(screen.getByText('Worker Beta')).toBeTruthy()
    expect(screen.queryByText('Worker Alpha')).toBeNull()
    expect(screen.getByRole('button', { name: 'Team B' }).closest('tr').className).toContain('is-selected')
  })
})
