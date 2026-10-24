// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import Payroll from './Payroll'
import { LanguageProvider } from '../i18n/LanguageContext'

globalThis.React = React
vi.mock('../components/Payroll/PayrollOperations', () => ({ default: () => <div>Existing weekly payroll</div> }))
vi.mock('../components/Payroll/MonthlyPayrollOperations', () => ({ default: () => <div>Existing monthly payroll</div> }))
vi.mock('../components/Payroll/PayrollHistory', () => ({ default: () => <div>Existing history</div> }))
afterEach(cleanup)

it('real Payroll page exposes one primary report link and clicking opens the report route', () => {
  render(<LanguageProvider><MemoryRouter initialEntries={['/payroll']}><Routes>
    <Route path="/payroll" element={<Payroll />} />
    <Route path="/payroll/team-weekly-report" element={<h1>Team payout destination</h1>} />
  </Routes></MemoryRouter></LanguageProvider>)
  expect(screen.getByText('Existing weekly payroll')).toBeTruthy()
  const links = screen.getAllByRole('link', { name: 'تقرير قبض الفرق' })
  expect(links).toHaveLength(1)
  expect(links[0].className).toContain('btn-primary')
  expect(links[0].getAttribute('href')).toBe('/payroll/team-weekly-report')
  expect(links[0].closest('details')).toBeNull()
  fireEvent.click(links[0])
  expect(screen.getByRole('heading', { name: 'Team payout destination' })).toBeTruthy()
})
