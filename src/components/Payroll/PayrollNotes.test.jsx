// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import PayrollNotes from './PayrollNotes'

globalThis.React = React
afterEach(cleanup)

const t = (key) => ({
  'payroll.notesTitle': 'ملاحظات القبض',
  'payroll.warning_dailyRate': 'اليومية غير محددة',
  'payroll.warning_overtimeRate': 'سعر ساعة الإضافي غير محدد',
}[key] || key)

it('renders multiple payroll notes with worker, code, team, and exact reason', () => {
  render(<PayrollNotes warnings={[
    { workerId: '1', workerName: 'MUNIANGA', employeeCode: '346', teamName: 'Peinture Raghibe', field: 'overtimeRate' },
    { workerId: '2', workerName: 'JOEL', employeeCode: '56', teamName: 'Siraj', field: 'dailyRate' },
  ]} t={t} />)
  expect(screen.getByText('ملاحظات القبض')).toBeTruthy()
  expect(screen.getByText(/MUNIANGA #346/).closest('li').textContent).toContain('سعر ساعة الإضافي غير محدد')
  expect(screen.getByText(/JOEL #56/).closest('li').textContent).toContain('اليومية غير محددة')
})

it('renders no notes container when there are no warnings', () => {
  const { container } = render(<PayrollNotes warnings={[]} t={t} />)
  expect(container.querySelector('[data-payroll-notes]')).toBeNull()
})
