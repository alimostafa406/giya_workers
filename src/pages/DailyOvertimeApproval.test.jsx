// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { LanguageProvider } from '../i18n/LanguageContext'
import DailyOperationalReports from './DailyOperationalReports'
import BiometricOvertimeReview from './BiometricOvertimeReview'
import { applyManualWeeklyOvertime } from '../utils/weeklyManualOvertime'

globalThis.React = React
const api = vi.hoisted(() => ({ load: vi.fn(), decide: vi.fn(), attendance: vi.fn() }))
vi.mock('../api/biometricOvertimeReviewApi', () => ({ getBiometricOvertimeReviews: api.load, decideBiometricOvertime: api.decide }))
vi.mock('../api/attendanceApi', () => ({ getAttendanceRequest: api.attendance }))
vi.mock('../api/workersApi', () => ({ getWorkersRequest: async () => ({ data: [] }) }))
vi.mock('../api/biometricMappingApi', () => ({ getBiometricMappingsRequest: async () => ({ data: [] }) }))
vi.mock('../api/currentAttendanceEvidenceApi', () => ({ getCurrentAttendanceEvidenceRequest: async () => ({ data: [] }) }))
vi.mock('../utils/useOvertimeReportSettings.js', () => ({ useOvertimeReportSettings: () => ({ loading: false, settings: { team_ids: ['one','two'] } }) }))
vi.mock('../utils/attendanceOperationalGate', () => ({ kinshasaClock: () => ({ date: '2026-10-24' }) }))
vi.mock('../utils/weeklyPayrollOvertime.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, weeklyPayrollOvertimeForDetail: (detail) => detail.row?.derivedMinutes != null
    ? { morningOvertimeMinutes:0, eveningOvertimeMinutes:detail.row.derivedMinutes }
    : actual.weeklyPayrollOvertimeForDetail(detail) }
})
let sources
beforeEach(() => {
  sources = ['Alpha','Beta'].map((name, i) => {
    const worker = { id: name, full_name: name, employee_code: String(i+1), team_id: i?'two':'one', team_name: i?'Two':'One', is_active: true, payment_type: 'weekly', staff_classification: 'normal' }
    return { worker, attendance: { id: `a-${name}`, worker_id: name, worker, attendance_date: '2026-10-23', attendance_source: 'biometric', status: 'present', check_in: '08:00:00', check_out: '19:30:00', note: 'Original note' }, source_fingerprint: name, review: null, locked: false }
  })
  api.load.mockImplementation(async () => structuredClone(sources))
  api.attendance.mockImplementation(async () => ({ data: structuredClone(sources.map(s=>s.attendance)) }))
  api.decide.mockImplementation(async (date, entries, decision) => entries.map(entry => {
    const source = sources.find(s=>s.worker.id===entry.worker.id)
    source.review = { decision, minutes: entry.minutes, source_fingerprint: source.source_fingerprint, version: (source.review?.version || 0)+1 }
    return { worker_id: source.worker.id, decision, version: source.review.version }
  }))
})
afterEach(() => { cleanup(); vi.clearAllMocks() })
const open = () => render(<LanguageProvider><DailyOperationalReports type="overtime" /></LanguageProvider>)

it.each(['approved','rejected'])('daily report single %s updates immediately and persists in the canonical review page', async decision => {
  open()
  await screen.findByRole('checkbox', { name: 'Alpha' })
  expect(screen.getAllByText('Original note')).toHaveLength(2)
  const before = JSON.stringify(sources.map(s=>s.attendance))
  const row = screen.getByRole('checkbox', { name:'Alpha' }).closest('tr')
  fireEvent.click(within(row).getByRole('button', { name: decision==='approved'?'موافقة':'رفض', exact:true }))
  await waitFor(()=>expect(sources[0].review?.decision).toBe(decision))
  await waitFor(()=>expect(screen.queryByRole('checkbox', { name:'Alpha' })).toBeNull())
  expect(api.load).toHaveBeenCalledTimes(1) // no table reload after successful mutation
  expect(JSON.stringify(sources.map(s=>s.attendance))).toBe(before)
  cleanup(); open()
  await screen.findByRole('checkbox', { name:'Beta' })
  fireEvent.change(screen.getByLabelText('الحالة'), { target: { value: decision } })
  expect(await screen.findByRole('checkbox', { name:'Alpha' })).toBeTruthy()
  cleanup(); render(<BiometricOvertimeReview />)
  await screen.findByRole('checkbox', { name:'Beta' })
  fireEvent.change(screen.getByLabelText('الحالة'), { target: { value: decision } })
  expect(await screen.findByRole('checkbox', { name:'Alpha' })).toBeTruthy()
})

it.each(['approved','rejected'])('bulk %s affects only selected visible rows, not hidden selections', async decision => {
  open(); await screen.findByRole('checkbox', { name:'Alpha' })
  fireEvent.click(screen.getByRole('button', { name:'اختيار الكل' }))
  fireEvent.change(screen.getByLabelText('الفريق'), { target: { value:'one' } })
  fireEvent.click(screen.getByRole('button', { name: decision==='approved'?'موافقة على المحددين':'رفض المحددين' }))
  await waitFor(()=>expect(api.decide).toHaveBeenCalledWith('2026-10-23', [expect.objectContaining({ worker: expect.objectContaining({ id:'Alpha' }) })], decision))
  expect(sources[1].review).toBeNull()
})

it('bulk includes all visible rows and approved decisions alone flow to payroll', async () => {
  open(); await screen.findByRole('checkbox', { name:'Alpha' })
  fireEvent.click(screen.getByRole('button', { name:'اختيار الكل' }))
  fireEvent.click(screen.getByRole('button', { name:'موافقة على المحددين' }))
  await waitFor(()=>expect(sources.every(s=>s.review?.decision==='approved')).toBe(true))
  expect(api.decide.mock.calls[0][1]).toHaveLength(2)
  const source = sources[0]
  const details = [{ date:'2026-10-23', row:source.attendance }]
  const line = { worker: source.worker, details, term: { overtime_rate_per_hour: 1800 }, finalAmount: 0, overtimeAmount: 0 }
  expect(applyManualWeeklyOvertime(line, null, [], sources).payableOvertimeDays[0].minutes).toBe(150)
  source.review.decision = 'rejected'
  expect(applyManualWeeklyOvertime(line, null, [], sources).payableOvertimeDays[0].minutes).toBe(0)
})

it('stale decisions require review again and retain the report biometric/notes columns', async () => {
  sources[0].review = { decision:'approved', minutes:60, source_fingerprint:'old', version:2 }
  open(); await screen.findByRole('checkbox', { name:'Alpha' })
  expect(screen.getByText('يحتاج مراجعة من جديد')).toBeTruthy()
  expect(screen.getByRole('columnheader', { name:'رقم البصمة' })).toBeTruthy()
  expect(screen.getByRole('columnheader', { name:'ملاحظات' })).toBeTruthy()
  expect(screen.getByRole('columnheader', { name:'وقت الدخول' })).toBeTruthy()
  expect(screen.getByText('إجمالي الساعات الموافق عليها:').textContent).not.toContain('2.5')
})

it('both routes show the identical >=30-minute candidate set, independent of the old report population', async () => {
  const template = sources[0]
  sources = [20,29,30,31,45,60].map(minutes => ({ ...structuredClone(template),
    worker: { ...template.worker, id:String(minutes), full_name:`Worker ${minutes}`, payment_type:minutes===30?'monthly':'weekly' },
    attendance: { ...template.attendance, id:`att-${minutes}`, worker_id:String(minutes), derivedMinutes:minutes },
  }))
  // Display enrichment need not contain an attendance row for a candidate.
  api.attendance.mockResolvedValue({ data:[] })
  open()
  await screen.findByRole('checkbox', { name:'Worker 30' })
  const reportNames = screen.getAllByRole('checkbox').map(input=>input.getAttribute('aria-label'))
  expect(reportNames).toEqual(['Worker 30','Worker 31','Worker 45','Worker 60'])
  cleanup(); render(<BiometricOvertimeReview />)
  fireEvent.change(screen.getByLabelText('التاريخ'), { target:{ value:'2026-10-23' } })
  await screen.findByRole('checkbox', { name:'Worker 30' })
  expect(screen.getAllByRole('checkbox').map(input=>input.getAttribute('aria-label'))).toEqual(reportNames)
  expect(screen.queryByRole('checkbox', { name:'Worker 29' })).toBeNull()
  expect(api.decide).not.toHaveBeenCalled()
})
