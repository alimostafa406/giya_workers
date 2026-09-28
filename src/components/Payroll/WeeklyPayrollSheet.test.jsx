// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import WeeklyPayrollSheet from './WeeklyPayrollSheet'
import { weeklyPayrollTeamFooter } from '../../utils/weeklyPayrollTeamFooter'

vi.stubGlobal('React', React)
vi.mock('../../i18n/LanguageContext', () => ({ useTranslation: () => ({ t: (key) => key, language: 'en' }) }))
afterEach(cleanup)

const detail = (checkOut, timestamp) => ({
  date: '2026-09-24', status: 'present',
  row: { check_out: checkOut, biometric_sync_metadata: timestamp ? { check_out_event_timestamp: timestamp } : {} },
})

const line = (name, code, hours, amount, rate, attendanceDetail) => ({
  worker: { id: code, full_name: name, employee_code: code },
  currency: 'CDF', overtimeHours: hours, overtimeAmount: amount,
  attendanceWage: 0, transportAmount: 0, finalAmount: amount,
  term: { daily_rate: 0, overtime_rate_per_hour: rate, daily_transport_allowance: 0 },
  details: attendanceDetail ? [attendanceDetail] : [],
})

const zarourLines = [
  line('MERVEILLE 2', '80', 7.5, 13500, 1800, detail('00:30:00', '2026-09-25T00:30:00+01:00')),
  line('ROBERT', '79', 7, 12600, 1800, detail('00:00:00', '2026-09-25T00:00:00+01:00')),
  line('MBOMBA', '77', 1, 3000, 3000, detail('18:00:00')),
]

const renderLines = (lines) => render(<WeeklyPayrollSheet lines={lines} dates={['2026-09-24']} onEdit={() => {}} />)
const amountCell = (name) => within(screen.getByRole('row', { name: new RegExp(name) })).getAllByRole('cell')[5]

test('renders saved Zarour worker overtime amounts without changing the team total or line snapshots', () => {
  const before = structuredClone(zarourLines)
  renderLines(zarourLines)
  expect(amountCell('MERVEILLE 2').textContent).toMatch(/13,500(?:\.00)?/)
  expect(amountCell('ROBERT').textContent).toMatch(/12,600(?:\.00)?/)
  expect(amountCell('MBOMBA').textContent).toMatch(/3,000(?:\.00)?/)
  expect(weeklyPayrollTeamFooter(zarourLines).byCurrency.CDF.overtimePay).toBe(29100)
  expect(zarourLines).toEqual(before)
})

test('zero overtime displays no positive amount and an unresolved rate keeps its hours but no amount', () => {
  renderLines([
    line('NO OVERTIME', '1', 0, 0, 1800, null),
    line('UNRESOLVED RATE', '2', 1, null, null, detail('18:00:00')),
  ])
  expect(amountCell('NO OVERTIME').textContent).toBe('—')
  expect(amountCell('UNRESOLVED RATE').textContent).toBe('—')
  expect(within(screen.getByRole('row', { name: /UNRESOLVED RATE/ })).getAllByRole('cell')[4].textContent).toBe('1h00')
})
