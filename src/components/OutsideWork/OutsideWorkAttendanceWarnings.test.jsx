// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import OutsideWorkAttendanceWarnings from './OutsideWorkAttendanceWarnings.jsx'
import { outsideWorkAttendanceWarnings } from '../../utils/outsideWorkAttendanceWarnings.js'
globalThis.React=React
afterEach(cleanup)
const wid='d5a3617f-0b81-448c-82af-2e0925380698'
const conflict={worker_id:wid,worker_name:'KAFUTI',attendance_date:'2026-11-26',movement_ids:['4cf2fc2e-e9bf-4763-92e9-dac297382511']}
const movement={id:'4cf2fc2e-e9bf-4763-92e9-dac297382511',work_date:'2026-11-26',status:'final',outside_work_movement_workers:[{worker_id:wid}]}
it('removes real KAFUTI FINAL Outside Work from warnings/counts while retaining accessible audit history', () => {
 const before=JSON.stringify([conflict,movement])
 render(<OutsideWorkAttendanceWarnings conflicts={[conflict]} movements={[movement]} date="2026-11-26" language="ar" />)
 expect(screen.queryByRole('alert')).toBeNull()
 expect(screen.queryByTestId('outside-work-unresolved')).toBeNull()
 const audit=screen.getByTestId('outside-work-attendance-history')
 expect(audit.open).toBe(false)
 fireEvent.click(audit.querySelector('summary'))
 expect(audit.textContent).toContain('KAFUTI')
 expect(audit.textContent).toContain('2026-11-26')
 expect(JSON.stringify([conflict,movement])).toBe(before)
 expect(outsideWorkAttendanceWarnings([conflict],[movement],'2026-11-26').unresolved).toHaveLength(0)
})
it('does not suppress unrelated workers, other dates, or draft-only movements', () => {
 const other={...conflict,worker_id:'other',worker_name:'OTHER'}
 const tomorrow={...conflict,attendance_date:'2026-11-27'}
 expect(outsideWorkAttendanceWarnings([conflict,other,tomorrow],[movement]).unresolved).toEqual([other,tomorrow])
 expect(outsideWorkAttendanceWarnings([conflict],[{...movement,status:'draft'}]).unresolved).toEqual([conflict])
 expect(outsideWorkAttendanceWarnings([conflict],[{...movement,outside_work_movement_workers:[]}]).unresolved).toEqual([conflict])
 expect(outsideWorkAttendanceWarnings([conflict],[movement],'2026-11-27')).toEqual({unresolved:[],history:[]})
})
