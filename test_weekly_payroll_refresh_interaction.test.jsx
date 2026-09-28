// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import PayrollOperations from './src/components/Payroll/PayrollOperations.jsx'
import { getPayrollOperationsDataRequest, persistPayrollDraftRequest } from './src/api/payrollOperationsApi.js'

vi.stubGlobal('React', React)
vi.mock('./src/api/payrollOperationsApi.js', () => ({
  getPayrollOperationsDataRequest: vi.fn(), persistPayrollDraftRequest: vi.fn(),
  cancelSundayWorkRequest: vi.fn(), confirmSundayWorkRequest: vi.fn(), createPayrollAdjustmentRequest: vi.fn(),
  markSundayPaymentPaidRequest: vi.fn(), reversePaidSundayPaymentRequest: vi.fn(), setWeeklyPayrollRunStatusRequest: vi.fn(),
}))
vi.mock('./src/i18n/LanguageContext', () => ({ useTranslation: () => ({ t: key => key, language: 'en', direction: 'ltr' }) }))
vi.mock('./src/components/Payroll/WeeklyPayrollSheet', () => ({ default: () => null }))
vi.mock('./src/components/Payroll/WeeklyPayrollWorkerEditPanel', () => ({ default: () => null }))
vi.mock('./src/components/Payroll/WeeklyPayrollTeamSummary', () => ({ default: () => null }))
vi.mock('./src/components/Payroll/PayrollWorkerSearch', () => ({ default: () => null }))
vi.mock('./src/components/Payroll/PayrollNotes', () => ({ default: () => null }))
vi.mock('./src/components/Forms/AttendanceEditModal', () => ({ default: () => null }))

const worker = { id:'w', full_name:'Worker', employee_code:'350', is_active:true, staff_classification:'normal',
  payment_type:'weekly', team_id:'team', team_name:'Zarour', team:{ id:'team', name:'Zarour' },
  payroll_compensation:{ daily_rate:15000, overtime_rate_per_hour:1500, daily_transport_allowance:0, currency_code:'CDF' } }
const dataset = (status, runStatus='draft') => ({
  workers:[worker], attendance:[{ id:'a', worker_id:'w', attendance_date:'2026-09-28', status,
    check_in:'07:54:25', check_out:status==='present'?'18:00:00':null, attendance_day_fraction:status==='present'?1:0.5,
    worker, team:worker.team }],
  rules:{ id:'rule', half_day_multiplier:0.5 }, holidays:[],
  runs:[{ id:'run', payment_type:'weekly', status:runStatus, weekly_period_start:'2026-09-28', weekly_period_end:'2026-10-03', scheduled_payment_date:'2026-10-03' }],
  payrollLines:[], payrollAdjustments:[], sundayPayments:[],
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

test('draft Refresh from attendance reloads canonical rows and persists a corrected line', async () => {
  let reads=0
  getPayrollOperationsDataRequest.mockImplementation(async () => dataset(++reads===1?'half_day':'present'))
  persistPayrollDraftRequest.mockResolvedValue({ id:'run' })
  render(<PayrollOperations />)
  fireEvent.click(await screen.findByRole('button', { name:'payroll.refreshFromAttendance' }))
  await waitFor(() => expect(persistPayrollDraftRequest).toHaveBeenCalledTimes(1))
  const request = persistPayrollDraftRequest.mock.calls[0][0]
  expect(request.periodStart).toBe('2026-09-28')
  expect(request.periodEnd).toBe('2026-10-03')
  expect(request.lines[0].details[0].status).toBe('present')
  expect(request.lines[0].eveningOvertimeMinutes).toBe(60)
  expect(request.lines[0].overtimeAmount).toBe(1500)
})

test.each(['finalized','paid'])('%s run refreshes display only, never persists', async status => {
  getPayrollOperationsDataRequest.mockResolvedValue(dataset('present',status))
  render(<PayrollOperations />)
  fireEvent.click(await screen.findByRole('button', { name:'payroll.refresh' }))
  await waitFor(() => expect(getPayrollOperationsDataRequest).toHaveBeenCalledTimes(2))
  expect(persistPayrollDraftRequest).not.toHaveBeenCalled()
})
