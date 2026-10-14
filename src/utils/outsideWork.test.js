import { describe, expect, it } from 'vitest'
import { addOutsideWorkWorkers, changeOutsideWorkDate, durationMinutes, editOutsideWorkWorkerTime, foremanKey, formatClock, formatDuration, newOutsideWorkForm, outsideWorkDefaultTimes, outsideWorkFinalError, outsideWorkForm, weekDays, weeklyForemanReport } from './outsideWork'

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
    expect(outsideWorkFinalError(complete)).toBe('')
    expect(outsideWorkFinalError({ ...complete, missing_worker_note: '' })).toBe('')
  })
})

describe('individual outside-work entry times', () => {
  const people = [{ id: 'one', full_name: 'FIRST' }, { id: 'two', full_name: 'SECOND' }]
  it('defaults Monday-Friday independently to 08:00–17:00', () => {
    for (const date of ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']) {
      const form = addOutsideWorkWorkers(newOutsideWorkForm(date), people)
      expect(form.workers.map((row) => [row.start_time, row.end_time])).toEqual([['08:00', '17:00'], ['08:00', '17:00']])
      expect(form.foreman_name).toBe('')
      expect(form.start_time).toBe('')
      expect(form.common_worker_start).toBe('')
    }
  })
  it('uses Saturday 08:00–14:00 and leaves Sunday rows blank', () => {
    expect(outsideWorkDefaultTimes('2026-10-17')).toEqual({ start: '08:00', end: '14:00' })
    expect(addOutsideWorkWorkers(newOutsideWorkForm('2026-10-18'), people).workers[0]).toMatchObject({ start_time: '', end_time: '' })
  })
  it('updates only untouched row times when the selected date changes', () => {
    let form = addOutsideWorkWorkers(newOutsideWorkForm('2026-10-14'), people)
    form = editOutsideWorkWorkerTime(form, 'one', 'start_time', '09:30')
    const saturday = changeOutsideWorkDate(form, '2026-10-17')
    expect(saturday.workers[0]).toMatchObject({ start_time: '09:30', end_time: '14:00' })
    expect(saturday.workers[1]).toMatchObject({ start_time: '08:00', end_time: '14:00' })
  })
  it('editing one row never changes another, including after draft hydration', () => {
    let form = addOutsideWorkWorkers(newOutsideWorkForm('2026-10-14'), people)
    form = editOutsideWorkWorkerTime(form, 'one', 'end_time', '18:00')
    expect(form.workers[1].end_time).toBe('17:00')
    const reopened = outsideWorkForm({ ...form, id: 'draft' })
    expect(changeOutsideWorkDate(reopened, '2026-10-17').workers.map((row) => row.end_time)).toEqual(['18:00', '14:00'])
    expect(addOutsideWorkWorkers(reopened, people).workers).toHaveLength(2)
  })
  it('preserves archived foreman fields and saved legacy worker times on date edits', () => {
    const saved = outsideWorkForm({ id: 'old', work_date: '2026-10-14', foreman_name: 'LEADER', start_time: '07:00', end_time: '20:00',
      note: 'Archived', workers: [{ worker_id: 'one', start_time: '10:00', end_time: '18:00' }] })
    const changed = changeOutsideWorkDate(saved, '2026-10-17')
    expect(changed).toMatchObject({ foreman_name: 'LEADER', start_time: '07:00', end_time: '20:00', note: 'Archived' })
    expect(changed.workers[0].end_time).toBe('18:00')
  })
})
