import { describe, expect, it } from 'vitest'
import { changeOutsideWorkDate, durationMinutes, editOutsideWorkTime, foremanKey, formatClock, formatDuration, newOutsideWorkForm, outsideWorkDefaultTimes, outsideWorkFinalError, outsideWorkForm, weekDays, weeklyForemanReport } from './outsideWork'

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
  it('excludes all drafts while preserving legacy finalized rows', () => {
    const report = weeklyForemanReport([...rows, { ...rows[0], id: 'draft', status: 'draft', end_time: '23:00' }], 'worker:f1', days)
    expect(report.totalMinutes).toBe(1425)
    expect(report.rows.map((row) => row.id)).not.toContain('draft')
  })
  it('hydrates incomplete drafts without inventing times and validates only final saves', () => {
    const form = outsideWorkForm({ status: 'draft', missing_worker_note: 'WhatsApp person',
      entry_state: { otherSearch: 'missing' }, outside_work_movement_workers: [{ worker_id: 'local', worker_name: 'LOCAL', start_time: null, end_time: null }] })
    expect(form.work_date).toBe('')
    expect(form.workers[0].start_time).toBe('')
    expect(form.entry_state.otherSearch).toBe('missing')
    expect(outsideWorkFinalError(form)).toBe('required')
    const complete = { ...form, work_date: '2026-10-14', team_id: 'team', foreman_name: 'LEADER',
      start_time: '08:00', end_time: '17:00', workers: [{ worker_id: 'local', start_time: '08:00', end_time: '17:00' }] }
    expect(outsideWorkFinalError(complete)).toBe('unresolved')
    expect(outsideWorkFinalError({ ...complete, missing_worker_note: '' })).toBe('')
  })
})

describe('outside-work entry defaults', () => {
  it('defaults every Monday-Friday to 08:00–17:00', () => {
    for (const date of ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']) {
      expect(outsideWorkDefaultTimes(date)).toEqual({ start: '08:00', end: '17:00' })
    }
  })
  it('uses 08:00–14:00 Saturday and leaves Sunday hours empty', () => {
    expect(outsideWorkDefaultTimes('2026-10-17')).toEqual({ start: '08:00', end: '14:00' })
    expect(outsideWorkDefaultTimes('2026-10-18')).toEqual({ start: '', end: '' })
  })
  it('updates untouched defaults and selected worker times on date changes', () => {
    const form = { ...newOutsideWorkForm('2026-10-14'), workers: [{ worker_id: 'one', start_time: '08:00', end_time: '17:00' }] }
    const saturday = changeOutsideWorkDate(form, '2026-10-17')
    expect(saturday.common_worker_end).toBe('14:00')
    expect(saturday.end_time).toBe('14:00')
    expect(saturday.workers[0].end_time).toBe('14:00')
    expect(changeOutsideWorkDate(saturday, '2026-10-18').common_worker_end).toBe('')
    expect(changeOutsideWorkDate(saturday, '2026-10-19').common_worker_end).toBe('17:00')
  })
  it('preserves common edits and worker overrides, including after draft hydration', () => {
    let form = { ...newOutsideWorkForm('2026-10-14'), workers: [{ worker_id: 'one', start_time: '09:30', end_time: '17:00' }] }
    form = editOutsideWorkTime(form, 'common_worker_start', '07:45')
    form = outsideWorkForm({ ...form, id: 'saved-draft' })
    const saturday = changeOutsideWorkDate(form, '2026-10-17')
    expect(saturday.common_worker_start).toBe('07:45')
    expect(saturday.common_worker_end).toBe('14:00')
    expect(saturday.workers[0].start_time).toBe('09:30')
    expect(saturday.workers[0].end_time).toBe('14:00')
  })
  it('preserves saved legacy and incomplete draft values instead of silently filling them', () => {
    const saved = outsideWorkForm({ id: 'old', work_date: '2026-10-14', common_worker_start: '10:00', common_worker_end: '18:00' })
    expect(changeOutsideWorkDate(saved, '2026-10-17').common_worker_end).toBe('18:00')
    expect(outsideWorkForm({ id: 'empty-draft', work_date: '2026-10-14', start_time: null }).start_time).toBe('')
  })
})
