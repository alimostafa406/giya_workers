import { describe, expect, it } from 'vitest'
import { addOutsideWorkWorkers, changeOutsideWorkDate, durationMinutes, editOutsideWorkTime, foremanKey, formatClock, formatDuration, newOutsideWorkForm, outsideWorkDefaultTimes, outsideWorkFinalError, outsideWorkForm, weekDays, weeklyForemanReport } from './outsideWork'

describe('outside-work foreman report', () => {
  it.each([
    ['2026-10-12', '17:00', 0],
    ['2026-10-12', '19:00', 120],
    ['2026-10-17', '14:00', 0],
    ['2026-10-17', '18:00', 240],
    ['2026-10-18', '18:00', 0],
    ['2026-10-12', '16:00', 0],
  ])('reports only overtime beyond normal end on %s ending %s', (date, end, expected) => {
    const movement = { id: 'fixture', work_date: date, foreman_worker_id: 'foreman', start_time: '08:00', end_time: end }
    const before = structuredClone(movement)
    const report = weeklyForemanReport([movement], 'worker:foreman', weekDays(date))
    expect(report.rows[0].foremanOvertimeMinutes).toBe(expected)
    expect(report.totalOvertimeMinutes).toBe(expected)
    expect(movement).toEqual(before)
  })
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
  it('calculates foreman overtime, distinct days and movement count without duration summaries', () => {
    const report = weeklyForemanReport(rows, 'worker:f1', days)
    expect(durationMinutes('07:45', '18:30')).toBe(645)
    expect(report).toMatchObject({ dayCount: 2, movementCount: 3, totalOvertimeMinutes: 450 })
    expect(report).not.toHaveProperty('totalMinutes')
    expect(report).not.toHaveProperty('averageMinutes')
    expect(formatDuration(630)).toBe('10.5 h')
    expect(formatClock('20:00:00')).toBe('8:00 PM')
    expect(formatClock('08:00:00', { hour12: false })).toBe('08:00')
    expect(formatClock('18:00:00', { hour12: false })).toBe('18:00')
    expect(formatClock('00:05:00', { hour12: false })).toBe('00:05')
    expect(formatClock(null, { hour12: false })).toBe('—')
  })
  it('excludes all drafts while preserving legacy finalized rows', () => {
    const report = weeklyForemanReport([...rows, { ...rows[0], id: 'draft', status: 'draft', end_time: '23:00' }], 'worker:f1', days)
    expect(report.totalOvertimeMinutes).toBe(450)
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

describe('separate foreman and shared worker time ranges', () => {
  it('requires either a team or foreman, and always real workers, for final save', () => {
    const form = addOutsideWorkWorkers(newOutsideWorkForm('2026-10-14'), [{ id: 'one', full_name: 'FIRST' }])
    expect(outsideWorkFinalError(form)).toBe('required')
    expect(outsideWorkFinalError({ ...form, team_id: 'team' })).toBe('')
    expect(outsideWorkFinalError({ ...form, foreman_worker_id: 'foreman', foreman_name: 'FOREMAN' })).toBe('')
    expect(outsideWorkFinalError({ ...form, foreman_name: 'Unverified name only' })).toBe('required')
    expect(outsideWorkFinalError({ ...form, foreman_worker_id: 'foreman', workers: [] })).toBe('selectWorkers')
  })
  const people = [{ id: 'one', full_name: 'FIRST' }, { id: 'two', full_name: 'SECOND' }]
  it('defaults both ranges Monday-Friday to 08:00–17:00', () => {
    for (const date of ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']) {
      const form = newOutsideWorkForm(date)
      expect([form.start_time, form.end_time, form.common_worker_start, form.common_worker_end]).toEqual(['08:00', '17:00', '08:00', '17:00'])
    }
  })
  it('defaults both Saturday ranges to 08:00–14:00 and Sunday to blank', () => {
    expect(outsideWorkDefaultTimes('2026-10-17')).toEqual({ start: '08:00', end: '14:00' })
    const saturday = newOutsideWorkForm('2026-10-17')
    expect([saturday.start_time, saturday.end_time, saturday.common_worker_start, saturday.common_worker_end]).toEqual(['08:00', '14:00', '08:00', '14:00'])
    const sunday = newOutsideWorkForm('2026-10-18')
    expect([sunday.start_time, sunday.end_time, sunday.common_worker_start, sunday.common_worker_end]).toEqual(['', '', '', ''])
  })
  it('editing either range leaves the other independent', () => {
    let form = addOutsideWorkWorkers(newOutsideWorkForm('2026-10-14'), people)
    form = editOutsideWorkTime(form, 'end_time', '20:00')
    expect(form.common_worker_end).toBe('17:00')
    expect(form.workers.map((row) => row.end_time)).toEqual(['17:00', '17:00'])
    form = editOutsideWorkTime(form, 'common_worker_end', '18:00')
    expect(form.end_time).toBe('20:00')
    expect(form.workers.map((row) => row.end_time)).toEqual(['18:00', '18:00'])
  })
  it('new worker additions inherit the current shared worker range, not the foreman range', () => {
    let form = editOutsideWorkTime(newOutsideWorkForm('2026-10-14'), 'common_worker_end', '18:30')
    form = editOutsideWorkTime(form, 'end_time', '20:00')
    form = addOutsideWorkWorkers(form, people)
    expect(form.workers.map((row) => row.end_time)).toEqual(['18:30', '18:30'])
    expect(addOutsideWorkWorkers(form, people).workers).toHaveLength(2)
  })
  it('date changes update untouched defaults while preserving separately edited range fields', () => {
    let form = addOutsideWorkWorkers(newOutsideWorkForm('2026-10-14'), people)
    form = editOutsideWorkTime(form, 'end_time', '20:00')
    const saturday = changeOutsideWorkDate(form, '2026-10-17')
    expect(saturday.end_time).toBe('20:00')
    expect(saturday.common_worker_end).toBe('14:00')
    expect(saturday.workers.map((row) => row.end_time)).toEqual(['14:00', '14:00'])
    const reopened = outsideWorkForm({ ...saturday, id: 'draft' })
    expect(reopened.end_time).toBe('20:00')
    expect(reopened.common_worker_end).toBe('14:00')
  })
  it('preserves archived individual times until explicit shared-range edits', () => {
    const saved = outsideWorkForm({ id: 'old', work_date: '2026-10-14', foreman_name: 'LEADER', start_time: '07:00', end_time: '20:00',
      workers: [{ worker_id: 'one', start_time: '09:00', end_time: '17:00' }, { worker_id: 'two', start_time: '08:00', end_time: '18:00' }] })
    expect(saved.common_worker_start).toBe('')
    expect(saved.workers.map((row) => row.end_time)).toEqual(['17:00', '18:00'])
    expect(changeOutsideWorkDate(saved, '2026-10-17').workers).toEqual(saved.workers)
    expect(changeOutsideWorkDate({ ...saved, entry_state: { manual_times: { common_worker_end: false, common_worker_start: false } } }, '2026-10-17').workers).toEqual(saved.workers)
    const changed = editOutsideWorkTime(saved, 'common_worker_end', '19:00')
    expect(changed.workers.map((row) => row.end_time)).toEqual(['19:00', '19:00'])
    expect(changed.end_time).toBe('20:00')
  })
})
