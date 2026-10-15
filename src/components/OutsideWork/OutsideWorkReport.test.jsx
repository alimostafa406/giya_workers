// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { LanguageProvider } from '../../i18n/LanguageContext'
import OutsideWorkReport from './OutsideWorkReport'
import { outsideWorkReport } from '../../utils/outsideWorkReports'

globalThis.React = React
const api = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('../../api/outsideWorkApi', () => ({ getOutsideWorkMovements: api.list }))
vi.mock('../../utils/attendanceOperationalGate', () => ({ kinshasaClock: () => ({ date: '2026-10-15' }) }))
const workers = [
  { id: 'a', full_name: 'ALPHA', employee_code: '79', team_id: 'A', team_name: 'Team A' },
  { id: 'b', full_name: 'BETA', employee_code: '80', team_id: 'B', team_name: 'Team B' },
]
const member = id => ({ worker_id: id, worker_name: id === 'a' ? 'ALPHA' : 'BETA', start_time: '08:00:00', end_time: '17:00:00' })
const movement = (id, date, overrides = {}) => ({ id, work_date: date, team_id: 'A', team: { id: 'A', name: 'Team A' }, status: 'final',
  foreman_worker_id: 'f1', foreman_name: 'FOREMAN ONE', start_time: '08:00:00', end_time: '19:00:00', common_worker_start: '08:00:00', common_worker_end: '17:00:00',
  outside_work_movement_workers: [member('a')], ...overrides })
const rows = [movement('old', '2026-09-30'), movement('early', '2026-10-02'),
  movement('mixed', '2026-10-13', { outside_work_movement_workers: [member('a'), member('b')] }),
  movement('independent', '2026-10-14', { team_id: null, team: null, foreman_worker_id: 'f2', foreman_name: 'INDEPENDENT', end_time: '18:00:00', outside_work_movement_workers: [member('b')] }),
  movement('draft', '2026-10-15', { status: 'draft', team_id: 'B', team: { id: 'B', name: 'Team B' } })]
const props = { workers, teams: [{ id: 'A', name: 'Team A' }, { id: 'B', name: 'Team B' }], biometricIds: new Map([['b', '064']]) }
const open = () => render(<LanguageProvider><OutsideWorkReport {...props} /></LanguageProvider>)
const change = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const loaded = () => waitFor(() => expect(screen.queryByText('Loading report...')).toBeNull())
beforeEach(() => {
  localStorage.setItem('workers_app_language', 'en')
  api.list.mockImplementation(async (from, to, { reportStatus }) => structuredClone(rows.filter(row => row.work_date >= from && row.work_date <= to && (reportStatus === 'all' || row.status === reportStatus))))
  window.print = vi.fn()
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('custom outside-work report center', () => {
  it('defaults to comprehensive final-only and includes no-team and cross-team workers in print', async () => {
    const { container } = open(); await loaded()
    expect(screen.getByLabelText('Report type').value).toBe('comprehensive')
    expect(api.list).toHaveBeenLastCalledWith('2026-10-01', '2026-10-15', { reportStatus: 'final' })
    expect(container.querySelectorAll('.outside-report-day')).toHaveLength(6)
    expect(screen.getAllByText('Independent foreman')).toHaveLength(2)
    expect(screen.queryByRole('cell', { name: 'BETA' })).toBeNull()
    const print = container.querySelector('.outside-work-print')
    expect(print.querySelectorAll('.outside-report-movement')).toHaveLength(3)
    expect(print.textContent).toContain('ALPHA')
    expect(print.textContent).toContain('BETA')
    expect(print.textContent).toContain('Team B')
    expect(print.textContent).toContain('08:00 → 17:00')
    expect(print.textContent).toContain('Generated at')
    expect(print.querySelector('button,select,input')).toBeNull()
    expect([...container.querySelector('.foreman-report-summary').querySelectorAll('strong')].map(el => el.textContent)).toEqual(['3', '3', '4', '5 h'])
    fireEvent.click(screen.getByRole('button', { name: 'Print Report' }))
    expect(window.print).toHaveBeenCalledOnce()
  })
  it.each([
    ['2026-10-13', '2026-10-13', 1],
    ['2026-10-02', '2026-10-14', 3],
    ['2026-09-30', '2026-10-15', 4],
  ])('supports exact custom range %s through %s without week snapping', async (from, to, count) => {
    const { container } = open(); await loaded()
    change('From date', from); change('To date', to); await loaded()
    expect(api.list).toHaveBeenLastCalledWith(from, to, { reportStatus: 'final' })
    expect(container.querySelector('.outside-work-print').querySelectorAll('.outside-report-movement')).toHaveLength(count)
    expect(container.querySelector('.outside-work-print .outside-report-period').textContent).toBe(`${from} → ${to}`)
  })
  it('filters foreman movements with all their participants and original teams', async () => {
    const { container } = open(); await loaded()
    change('Report type', 'foreman'); change('Select a foreman', 'worker:f1')
    expect(screen.queryByText('Independent foreman')).toBeNull()
    const print = container.querySelector('.outside-work-print')
    expect(print.querySelectorAll('.outside-report-movement')).toHaveLength(2)
    expect(print.textContent).toContain('BETA')
    expect(print.textContent).toContain('FOREMAN ONE')
    expect([...container.querySelector('.foreman-report-summary').querySelectorAll('strong')].map(el => el.textContent)).toEqual(['2', '2', '4 h'])
  })
  it.each(['beta', '80', '064'])('finds a worker by %s and reports their own real participation times without worker overtime', async search => {
    const { container } = open(); await loaded()
    change('Report type', 'worker')
    const requests = api.list.mock.calls.length
    change('Worker name / employee code / biometric ID', search)
    expect(screen.getByRole('option', { name: /BETA/ })).toBeTruthy()
    expect(screen.queryByRole('option', { name: /ALPHA/ })).toBeNull()
    change('Select worker', 'b')
    const print = container.querySelector('.outside-work-print')
    expect(print.textContent).toContain('BETA')
    expect(print.textContent).not.toContain('ALPHA')
    expect(print.querySelectorAll('.outside-report-movement')).toHaveLength(2)
    expect(container.querySelector('.foreman-report-summary').children).toHaveLength(2)
    expect(api.list).toHaveBeenCalledTimes(requests)
  })
  it('includes other-primary-team and no-team movements for an original-team filter', async () => {
    const { container } = open(); await loaded()
    change('Report type', 'team'); change('Select team', 'B')
    const print = container.querySelector('.outside-work-print')
    expect(print.querySelectorAll('.outside-report-movement')).toHaveLength(2)
    expect(print.textContent).toContain('Team A')
    expect(print.textContent).toContain('Team B')
    expect(print.textContent).toContain('Independent foreman')
  })
  it('bounds drafts/all to the selected range and labels drafts', async () => {
    const { container } = open(); await loaded()
    change('Status', 'draft'); await loaded()
    expect(api.list).toHaveBeenLastCalledWith('2026-10-01', '2026-10-15', { reportStatus: 'draft' })
    expect(screen.getAllByText('Draft', { exact: true })).toHaveLength(2)
    expect(container.querySelector('.outside-work-print').querySelectorAll('.outside-report-movement')).toHaveLength(1)
    change('Status', 'all'); await loaded()
    expect(container.querySelector('.outside-work-print').querySelectorAll('.outside-report-movement')).toHaveLength(4)
  })
  it('shows empty, invalid, loading and error states and disables printing stale data', async () => {
    open(); await loaded()
    change('From date', '2026-10-15'); await loaded()
    expect(screen.getByText('No movements match the selected filters')).toBeTruthy()
    change('To date', '2026-10-01')
    expect(screen.getByRole('alert').textContent).toContain('valid date range')
    expect(screen.getByRole('button', { name: 'Print Report' }).disabled).toBe(true)
    api.list.mockRejectedValueOnce(new Error('Report unavailable'))
    change('To date', '2026-10-15'); await loaded()
    expect(screen.getByRole('alert').textContent).toContain('Report unavailable')
    expect(screen.getByRole('button', { name: 'Print Report' }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await loaded()
  })
  it('shows Arabic weekday ranges with correct RTL isolation and clean A4 print CSS', async () => {
    localStorage.setItem('workers_app_language', 'ar')
    const { container } = open(); await waitFor(() => expect(screen.queryByText('جاري تحميل التقرير...')).toBeNull())
    expect(container.querySelector('.outside-report-period').textContent).toBe('الخميس 01/10/2026 → الخميس 15/10/2026')
    expect(container.querySelector('.outside-report-period').dir).toBe('ltr')
    const css = readFileSync('src/components/OutsideWork/OutsideWorkReport.css', 'utf8')
    for (const rule of ['A4 portrait', 'break-inside: avoid', 'table-header-group', 'visibility: visible !important', '#outside-work-report-view > :not(.outside-work-print)']) expect(css).toContain(rule)
  })
  it('keeps real worker times, stored values and the existing overtime rule unchanged', () => {
    const before = structuredClone(rows)
    const report = outsideWorkReport(rows, { from: '2026-10-01', to: '2026-10-15' }, new Map(workers.map(w => [w.id, w])))
    expect(report.totalOvertimeMinutes).toBe(300)
    expect(report.rows[1].participants.map(w => w.worker_id)).toEqual(['a', 'b'])
    expect(rows).toEqual(before)
  })
})
