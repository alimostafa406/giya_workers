// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { payrollWorkerSearchResults } from '../../utils/payrollWorkerSearch'
import PayrollWorkerSearch from './PayrollWorkerSearch'

globalThis.React = React

const lines = [
  { worker: { id: 'weekly-a', full_name: 'MUNIANGA', employee_code: '346', employeeNoString: 'BIO-46', team_id: 'paint', team_name: 'Peinture Raghibe', is_active: true, payment_type: 'weekly', staff_classification: 'normal' } },
  { worker: { id: 'weekly-inactive', full_name: 'Inactive Weekly', employee_code: '111', team_id: 'paint', team_name: 'Peinture Raghibe', is_active: false, payment_type: 'weekly', staff_classification: 'normal' } },
  { worker: { id: 'monthly-a', full_name: 'Monthly Person', employee_code: '812', biometric_mappings: [{ device_employee_no: 'BIO-812' }], team_id: 'office', team_name: 'Office', is_active: true, payment_type: 'monthly', staff_classification: 'normal' } },
]

const t = (key) => ({
  'payroll.workerSearchLabel': 'بحث عن عامل',
  'payroll.workerSearchPlaceholder': 'بحث بالاسم أو رقم العامل...',
  'common.team': 'Team',
  'common.unknown': 'Unknown',
  'common.noResults': 'لا توجد نتائج',
}[key] || key)

afterEach(cleanup)

describe('payroll worker search eligibility and matching', () => {
  it('matches weekly workers by full name, partial name, code, biometric number, and case-insensitively', () => {
    expect(payrollWorkerSearchResults(lines, 'MUNIANGA', 'weekly').map((line) => line.worker.id)).toEqual(['weekly-a'])
    expect(payrollWorkerSearchResults(lines, 'muni', 'weekly').map((line) => line.worker.id)).toEqual(['weekly-a'])
    expect(payrollWorkerSearchResults(lines, '346', 'weekly').map((line) => line.worker.id)).toEqual(['weekly-a'])
    expect(payrollWorkerSearchResults(lines, 'bio-46', 'weekly').map((line) => line.worker.id)).toEqual(['weekly-a'])
  })

  it('excludes inactive and wrong-payment-type workers without mutating payroll lines', () => {
    const original = structuredClone(lines)
    expect(payrollWorkerSearchResults(lines, 'inactive', 'weekly')).toEqual([])
    expect(payrollWorkerSearchResults(lines, 'monthly', 'weekly')).toEqual([])
    expect(payrollWorkerSearchResults(lines, 'muni', 'monthly')).toEqual([])
    expect(payrollWorkerSearchResults(lines, 'BIO-812', 'monthly').map((line) => line.worker.id)).toEqual(['monthly-a'])
    expect(lines).toEqual(original)
  })
})

describe.each(['weekly', 'monthly'])('%s payroll visible search', (paymentType) => {
  it('renders visibly and selecting a result returns its team and worker line', () => {
    const onSelect = vi.fn()
    const eligible = paymentType === 'weekly' ? lines : lines
    const query = paymentType === 'weekly' ? 'MUNI' : '812'
    render(<PayrollWorkerSearch lines={eligible} paymentType={paymentType} value={query} onChange={() => {}} onSelect={onSelect} t={t} />)

    expect(screen.getByRole('searchbox', { name: 'بحث عن عامل' }).getAttribute('placeholder')).toBe('بحث بالاسم أو رقم العامل...')
    const workerName = paymentType === 'weekly' ? 'MUNIANGA' : 'Monthly Person'
    fireEvent.click(screen.getByRole('button', { name: new RegExp(workerName) }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect.mock.calls[0][0].worker.team_id).toBe(paymentType === 'weekly' ? 'paint' : 'office')
  })

  it('shows a clean no-results state', () => {
    render(<PayrollWorkerSearch lines={lines} paymentType={paymentType} value="not-found" onChange={() => {}} onSelect={() => {}} t={t} />)
    expect(screen.getByText('لا توجد نتائج')).toBeTruthy()
  })
})
