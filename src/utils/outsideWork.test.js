import { describe, expect, it } from 'vitest'
import { durationMinutes, foremanKey, formatClock, formatDuration, weekDays, weeklyForemanReport } from './outsideWork'

describe('outside-work foreman report', () => {
  const days = weekDays('2026-10-14')
  const rows = [
    { id: 'one', work_date: '2026-10-12', foreman_worker_id: 'f1', foreman_name: 'FOREMAN', start_time: '08:00', end_time: '20:00' },
    { id: 'two', work_date: '2026-10-13', foreman_worker_id: 'f1', foreman_name: 'FOREMAN', start_time: '07:45', end_time: '18:30' },
    { id: 'three', work_date: '2026-10-13', foreman_worker_id: 'f1', foreman_name: 'FOREMAN', start_time: '19:00', end_time: '20:00' },
    { id: 'other', work_date: '2026-10-13', foreman_worker_id: 'f2', foreman_name: 'OTHER', start_time: '08:00', end_time: '10:00' },
    { id: 'old', work_date: '2026-10-10', foreman_worker_id: 'f1', foreman_name: 'FOREMAN', start_time: '08:00', end_time: '17:00' },
  ]
  it('uses the selected Monday–Sunday week and separates foremen by worker ID', () => {
    expect(days).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'])
    expect(weeklyForemanReport(rows, foremanKey(rows[0]), days).rows.map((row) => row.id)).toEqual(['one', 'two', 'three'])
  })
  it('calculates foreman duration, distinct days, total, and daily average', () => {
    const report = weeklyForemanReport(rows, 'worker:f1', days)
    expect(durationMinutes('07:45', '18:30')).toBe(645)
    expect(report).toMatchObject({ dayCount: 2, movementCount: 3, totalMinutes: 1425, averageMinutes: 712.5 })
    expect(formatDuration(630)).toBe('10.5 h')
    expect(formatClock('20:00:00')).toBe('8:00 PM')
  })
})
