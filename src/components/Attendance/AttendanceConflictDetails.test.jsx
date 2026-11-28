// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import AttendanceConflictDetails from './AttendanceConflictDetails.jsx'
globalThis.React = React
afterEach(cleanup)
it('shows the actual KAFUTI A/A values and identifies Outside Work O as the conflicting evidence', () => {
 const { container } = render(<AttendanceConflictDetails rows={[{ worker_id:'k',worker_name:'KAFUTI',employee_code:'95',attendance_date:'2026-11-26',
 protected_choice:'A',supervisor_choice:'A',conflict_type:'outside_work',attendance_source:'manual',check_in:null,check_out:null }]} language="ar" />)
 expect(screen.getByText(/KAFUTI/)).toBeTruthy()
 expect(container.textContent).toContain('(A)')
 expect(container.textContent).toContain('(O)')
 expect(container.textContent).not.toContain('(P)')
 expect(container.textContent).toContain('مطابق')
 expect(container.textContent).toContain('manual')
})
it('shows the selected supervisor choice and protected choice separately without changing either', () => {
 const row={worker_id:'k',worker_name:'KAFUTI',protected_choice:'P',supervisor_choice:'A',conflict_type:'manual',attendance_source:'manual'}
 const before=JSON.stringify(row)
 render(<AttendanceConflictDetails rows={[row]} results={{k:'M'}} language="en" />)
 expect(screen.getByText('Protected decision: Present (P)')).toBeTruthy()
 expect(screen.getByText('Supervisor choice: Medical (M)')).toBeTruthy()
 expect(JSON.stringify(row)).toBe(before)
})

it('does not claim a manual A/A match is a conflict after changing the selection', () => {
 const { container }=render(<AttendanceConflictDetails rows={[{worker_id:'w',protected_choice:'A',supervisor_choice:'P',conflict_type:'manual'}]} results={{w:'A'}} language="ar" />)
 expect(container.textContent).toBe('')
})
