import { describe, expect, it } from 'vitest'
import { buildWorkerHistory, validWorkerHistoryRange, workerHistoryRange } from './workerControlHistory'
import { workerControlSearchResults } from './workerControlSearch'

const worker = { id: 'w1', full_name: 'Example Worker', employee_code: '75', team: { name: 'Zarour' }, is_active: true, staff_classification: 'normal', operational_start_date: '2026-09-21' }
const rows = [
  { worker_id: 'w1', attendance_date: '2026-09-21', status: 'absent' },
  { worker_id: 'w1', attendance_date: '2026-09-22', status: 'present', check_in: '08:00:00' },
  { worker_id: 'w1', attendance_date: '2026-09-24', status: 'absent' },
  { worker_id: 'w1', attendance_date: '2026-09-25', status: 'half_day' },
  { worker_id: 'other', attendance_date: '2026-09-23', status: 'present' },
]

describe('worker attendance history', () => {
  it('resolves this month, rolling two months, and bounded custom dates', () => {
    expect(workerHistoryRange('this-month', '2026-10-06')).toEqual({ dateFrom: '2026-10-01', dateTo: '2026-10-06' })
    expect(workerHistoryRange('last-two-months', '2026-10-06')).toEqual({ dateFrom: '2026-08-06', dateTo: '2026-10-06' })
    const custom = workerHistoryRange('custom', '2026-10-06', '2026-09-21', '2026-09-25')
    expect(custom).toEqual({ dateFrom: '2026-09-21', dateTo: '2026-09-25' })
    expect(validWorkerHistoryRange(custom, '2026-10-06')).toBe(true)
    expect(validWorkerHistoryRange({ dateFrom: '2026-10-01', dateTo: '2026-10-07' }, '2026-10-06')).toBe(false)
  })

  it('keeps scattered canonical absences separate from missing records and summarizes eligible days', () => {
    const result = buildWorkerHistory({ worker, attendance: rows, dateFrom: '2026-09-20', dateTo: '2026-09-27' })
    expect(result.days.map((day) => [day.date, day.status])).toEqual([
      ['2026-09-21', 'absent'], ['2026-09-22', 'present'], ['2026-09-23', 'no_record'],
      ['2026-09-24', 'absent'], ['2026-09-25', 'half_day'], ['2026-09-26', 'no_record'],
    ])
    expect(result.days.filter((day) => day.status === 'absent').map((day) => day.date)).toEqual(['2026-09-21', '2026-09-24'])
    expect(result.days.filter((day) => day.status === 'half_day')).toHaveLength(1)
    expect(result.days.filter((day) => day.status === 'present')).toHaveLength(1)
    expect(result.summary).toEqual({ eligible: 6, present: 1, halfDay: 1, absent: 2, percentage: 25 })
  })

  it('finds names, employee codes, and confirmed active biometric IDs only', () => {
    const mappings = [
      { worker_id: 'w1', device_employee_no: '021', is_active: true, mapping_review_state: 'confirmed' },
      { worker_id: 'w1', device_employee_no: '999', is_active: false, mapping_review_state: 'confirmed' },
    ]
    expect(workerControlSearchResults([worker], mappings, 'example')).toHaveLength(1)
    expect(workerControlSearchResults([worker], mappings, '75')).toHaveLength(1)
    expect(workerControlSearchResults([worker], mappings, '021')[0].biometricIds).toEqual(['021'])
    expect(workerControlSearchResults([worker], mappings, '999')).toHaveLength(0)
  })
})
