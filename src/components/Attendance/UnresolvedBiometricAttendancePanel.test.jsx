// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import UnresolvedBiometricAttendancePanel from './UnresolvedBiometricAttendancePanel.jsx'

globalThis.React = React
afterEach(cleanup)

describe('unresolved biometric issue cards', () => {
  it('groups repeated identity issues while retaining raw event details', () => {
    const rows = [
      { event_id: '237053', event_timestamp: '2026-10-12T07:23:55Z', device_id: 'office-main', device_employee_no: '85', device_name: 'bevindo chadrack1989", "doorRight": "1"', resolution_reason: 'unmapped' },
      { event_id: '237054', event_timestamp: '2026-10-12T07:23:58Z', device_id: 'office-main', device_employee_no: '85', device_name: 'bevindo chadrack\t"NGANZI",\n"userType": "normal"', resolution_reason: 'unmapped' },
    ]
    const { container } = render(<MemoryRouter><UnresolvedBiometricAttendancePanel rows={rows} language="en" /></MemoryRouter>)
    expect(screen.getAllByText('#85')).toHaveLength(1)
    expect(container.textContent).not.toMatch(/doorRight|RightPlan|NGANZI|userType|1989/)
    expect(container.textContent).toContain('2')
    expect(screen.getAllByText('Unmapped identity')).toHaveLength(1)
  })

  it('shows the current structured office-main / 85 name on both real events without mapping them', () => {
    const rows = [
      { event_id: '237053', event_timestamp: '2026-10-12T07:23:55Z', device_id: 'office-main', device_employee_no: '85', device_name: 'bevindo chadrack1989", "doorRight": "1"', resolution_reason: 'unmapped' },
      { event_id: '237054', event_timestamp: '2026-10-12T07:23:58Z', device_id: 'office-main', device_employee_no: '85', device_name: 'bevindo chadrack\t"NGANZI",\n"userType": "normal"', resolution_reason: 'unmapped' },
    ]
    const currentIdentityNames = [
      { device_id: 'office-main', device_employee_no: '85', device_name: 'bevindo chadrack', is_current: true },
      { device_id: 'office-secondary', device_employee_no: '85', device_name: 'wrong device', is_current: true },
      { device_id: 'office-main', device_employee_no: '085', device_name: 'wrong number', is_current: true },
    ]
    const { container } = render(<MemoryRouter><UnresolvedBiometricAttendancePanel rows={rows} currentIdentityNames={currentIdentityNames} language="en" /></MemoryRouter>)
    expect(screen.getAllByText(/bevindo chadrack/)).toHaveLength(1)
    expect(screen.getAllByText('#85')).toHaveLength(1)
    expect(screen.getAllByText('Unmapped identity')).toHaveLength(1)
    expect(container.textContent).not.toMatch(/wrong device|wrong number|doorRight|NGANZI/)
  })

  it('uses a fallback when no current exact-device and exact-number name exists', () => {
    const rows = [{ event_id: 'other', event_timestamp: '2026-10-12T07:23:55Z', device_id: 'office-main', device_employee_no: '85', device_name: 'historical event name', resolution_reason: 'unmapped' }]
    render(<MemoryRouter><UnresolvedBiometricAttendancePanel rows={rows} currentIdentityNames={[
      { device_id: 'office-main', device_employee_no: '085', device_name: 'another user', is_current: true },
      { device_id: 'office-main', device_employee_no: '85', device_name: 'old user', is_current: false },
    ]} language="en" /></MemoryRouter>)
    expect(screen.getByText('—')).toBeTruthy()
    expect(screen.getByText('Unmapped identity')).toBeTruthy()
    expect(screen.queryByText(/historical event name/)).toBeNull()
  })
})


it('renders one PITSHOU issue with eight expandable events and a grouped action count', () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({
    event_id: String(i), attendance_date: '2026-11-26', event_timestamp: '2026-11-26T06:33:08Z',
    worker_id: 'pitshou', mapping_review_state: 'confirmed', worker_name: 'PITSHOU', employee_code: '70',
    device_name: 'PITSHOU', device_employee_no: '094', device_id: i % 2 ? 'office-main' : 'office-secondary', resolution_reason: 'outside_attendance_window',
  }))
  const { container } = render(<MemoryRouter><UnresolvedBiometricAttendancePanel rows={rows} language="en" /></MemoryRouter>)
  expect(screen.getAllByText('#094')).toHaveLength(1)
  expect(screen.getByText('8 punches')).toBeTruthy()
  expect(screen.getByText('1')).toBeTruthy()
  expect(container.querySelectorAll('details')).toHaveLength(1)
  expect(container.querySelectorAll('details p')).toHaveLength(8)
  expect(screen.getByText(/Punches outside configured night window/)).toBeTruthy()
})
