// @vitest-environment jsdom
import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import UnresolvedBiometricAttendancePanel from './UnresolvedBiometricAttendancePanel.jsx'

globalThis.React = React

describe('unresolved biometric issue cards', () => {
  it('keeps two distinct #85 events while hiding corrupt persisted name metadata', () => {
    const rows = [
      { event_id: '237053', event_timestamp: '2026-10-12T07:23:55Z', device_id: 'office-main', device_employee_no: '85', device_name: 'bevindo chadrack1989", "doorRight": "1"', resolution_reason: 'unmapped' },
      { event_id: '237054', event_timestamp: '2026-10-12T07:23:58Z', device_id: 'office-main', device_employee_no: '85', device_name: 'bevindo chadrack\t"NGANZI",\n"userType": "normal"', resolution_reason: 'unmapped' },
    ]
    const { container } = render(<MemoryRouter><UnresolvedBiometricAttendancePanel rows={rows} language="en" /></MemoryRouter>)
    expect(screen.getAllByText('#85')).toHaveLength(2)
    expect(container.textContent).not.toMatch(/doorRight|RightPlan|NGANZI|userType|1989/)
    expect(container.textContent).toContain('2')
    expect(screen.getAllByText('Unmapped identity')).toHaveLength(2)
  })
})
