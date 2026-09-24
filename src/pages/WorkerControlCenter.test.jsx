// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import WorkerControlCenter from './WorkerControlCenter'
import { getAttendanceRequest } from '../api/attendanceApi'
import { workerControlPeriods } from '../utils/workerControlPeriods'
import { reactivateWorkerRequest } from '../api/workersApi'

globalThis.React = React
const auth = vi.hoisted(() => ({ admin: null }))
const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Kinshasa' })
const previous = new Date(`${day}T12:00:00Z`)
previous.setUTCDate(previous.getUTCDate() - 1)
const prior = previous.toISOString().slice(0, 10)

vi.mock('../api/workersApi', () => ({
  getWorkersRequest: vi.fn(async () => ({ data: [
    { id: 'absent', full_name: 'Absent Worker', employee_code: '11', team_id: 'paint', team_name: 'Peinture Raghibe', is_active: true, staff_classification: 'normal' },
    { id: 'inactive', full_name: 'Inactive Worker', employee_code: '12', team_id: 'paint', team_name: 'Peinture Raghibe', is_active: false, staff_classification: 'normal' },
    { id: 'activated', full_name: 'Activated Worker', employee_code: '13', team_id: 'paint', team_name: 'Peinture Raghibe', is_active: true, staff_classification: 'normal' },
  ] })),
  getWorkersActivatedTodayRequest: vi.fn(async () => ({ data: [{ worker_id: 'activated', activated_at: `${day}T08:00:00Z`, biometric_ids: ['74'] }] })),
  reactivateWorkerRequest: vi.fn(),
}))
vi.mock('../api/attendanceApi', () => ({
  getAttendanceRequest: vi.fn(async () => ({ data: [
    { worker_id: 'absent', attendance_date: day, status: 'absent' },
    { worker_id: 'absent', attendance_date: prior, status: 'absent' },
    { worker_id: 'activated', attendance_date: day, status: 'present', check_in: '07:30:00' },
  ] })),
}))
vi.mock('../api/biometricMappingApi', () => ({
  getBiometricMappingsRequest: vi.fn(async () => ({ data: [] })),
  getInactiveWorkerBiometricActivityRequest: vi.fn(async () => ({ data: [{ worker_id: 'inactive', device_id: 'office-main', device_employee_no: '73', event_timestamp: `${day}T07:00:00Z` }] })),
}))
vi.mock('../store/authStore', () => ({ useAuthStore: (selector) => selector({ admin: auth.admin }) }))
vi.mock('../components/WorkerWeekAttendanceRecovery', () => ({ default: () => <button type="button">استرجاع حضور الأسبوع</button> }))

const routes = <Routes>
  <Route path="/worker-control-center" element={<WorkerControlCenter />} />
  <Route path="/worker-control-center/absent-today" element={<WorkerControlCenter category="absent-today" />} />
  <Route path="/worker-control-center/consecutive-absence" element={<WorkerControlCenter category="consecutive-absence" />} />
  <Route path="/worker-control-center/weekly" element={<WorkerControlCenter category="weekly" />} />
  <Route path="/worker-control-center/monthly" element={<WorkerControlCenter category="monthly" />} />
  <Route path="/worker-control-center/inactive-punched" element={<WorkerControlCenter category="inactive-punched" />} />
  <Route path="/worker-control-center/activated-today" element={<WorkerControlCenter category="activated-today" />} />
  <Route path="/worker-control-center/teams" element={<WorkerControlCenter category="teams" />} />
  <Route path="/worker-control-center/teams/:teamId" element={<WorkerControlCenter category="team-detail" />} />
  <Route path="/worker-control-center/worker/:workerId" element={<WorkerControlCenter category="worker-detail" />} />
</Routes>
const open = (path = '/worker-control-center') => render(<MemoryRouter initialEntries={[path]}>{routes}</MemoryRouter>)
afterEach(() => { cleanup(); auth.admin = null; vi.restoreAllMocks() })

describe('Worker Control Center information architecture', () => {
  it('home renders nine compact route cards and no worker table', async () => {
    open()
    await screen.findByText('ملخص تشغيلي سريع. افتح فئة لعرض بياناتها وتفاصيل العمال.')
    expect(screen.getAllByRole('link')).toHaveLength(9)
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByRole('link', { name: /الغائبون اليوم/ }).getAttribute('href')).toBe('/worker-control-center/absent-today')
  })

  it.each([
    ['الغائبون اليوم', 'absent-today'],
    ['الغياب المتتالي', 'consecutive-absence'],
    ['المراقبة الشهرية', 'monthly'],
    ['عمال غير مفعّلين قاموا بالبصمة', 'inactive-punched'],
    ['تم تفعيلهم اليوم', 'activated-today'],
  ])('%s card opens its focused route and back returns to the hub', async (title, slug) => {
    open()
    const card = screen.getByRole('link', { name: new RegExp(title) })
    expect(card.getAttribute('href')).toBe(`/worker-control-center/${slug}`)
    fireEvent.click(card)
    expect(await screen.findByRole('heading', { name: title, level: 2 })).toBeTruthy()
    expect(screen.getByRole('link', { name: /العودة إلى مركز مراقبة العمال/ }).getAttribute('href')).toBe('/worker-control-center')
    expect(screen.queryByRole('link', { name: /فتح/ })).toBeNull()
    expect(screen.getByRole('table')).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: /العودة إلى مركز مراقبة العمال/ }))
    expect(await screen.findByRole('heading', { name: 'مركز مراقبة العمال', level: 2 })).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('table Details navigates to a full worker page and back returns to the category', async () => {
    open('/worker-control-center/absent-today')
    expect(await screen.findByText('Absent Worker')).toBeTruthy()
    const details = screen.getByRole('link', { name: 'التفاصيل' })
    expect(details.getAttribute('href')).toBe('/worker-control-center/worker/absent')
    fireEvent.click(details)
    expect(await screen.findByRole('heading', { name: 'Absent Worker', level: 2 })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: /متابعة العامل/ })).toBeNull()
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
      'ملخص سريع', 'هذا الأسبوع', 'هذا الشهر', 'سجل الغياب', 'سجل نصف اليوم', 'معلومات البصمة',
    ])
    const absencePeriod = screen.getByText('عرض الأيام').closest('details')
    expect(absencePeriod.open).toBe(false)
    fireEvent.click(absencePeriod.querySelector('summary'))
    expect(absencePeriod.open).toBe(true)
    const back = screen.getByRole('link', { name: '← العودة' })
    expect(back.getAttribute('href')).toBe('/worker-control-center/absent-today')
    fireEvent.click(back)
    expect(await screen.findByRole('heading', { name: 'الغائبون اليوم', level: 2 })).toBeTruthy()
  })

  it('direct worker route falls back to the hub and admin actions remain available', async () => {
    auth.admin = { id: 'admin' }
    open('/worker-control-center/worker/absent')
    expect(await screen.findByRole('heading', { name: 'Absent Worker', level: 2 })).toBeTruthy()
    expect(screen.getByRole('link', { name: '← العودة' }).getAttribute('href')).toBe('/worker-control-center')
    expect(screen.getByRole('link', { name: 'تعديل العامل' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'إدارة / تعديل البصمة' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'استرجاع حضور الأسبوع' })).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps the existing inactive-worker activation action on the worker page', async () => {
    auth.admin = { id: 'admin' }
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    reactivateWorkerRequest.mockClear()
    open('/worker-control-center/worker/inactive')
    expect(await screen.findByRole('heading', { name: 'Inactive Worker', level: 2 })).toBeTruthy()
    expect(screen.getByText('الحالة: غير نشط')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'تفعيل العامل' }))
    await waitFor(() => expect(reactivateWorkerRequest).toHaveBeenCalledTimes(1))
    expect(confirm).toHaveBeenCalled()
  })

  it('shows a compact current absence period and reveals individual dates on demand', async () => {
    open('/worker-control-center/consecutive-absence')
    expect(await screen.findByText('Absent Worker')).toBeTruthy()
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'العامل', 'الفريق', 'أيام الغياب المتتالي', 'فترة الغياب', 'غياب الشهر', 'آخر حضور', 'التفاصيل',
    ])
    const shortDate = (value) => value.slice(5).split('-').reverse().join('/')
    expect(screen.getByText(`${shortDate(prior)} → ${shortDate(day)}`)).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'أيام الغياب المتتالي' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'عرض الأيام' }))
    const dialog = screen.getByRole('dialog', { name: 'أيام الغياب المتتالي' })
    expect(dialog.querySelectorAll('li')).toHaveLength(2)
    expect(dialog.querySelectorAll('li')[0].textContent).toBe(prior.split('-').reverse().join('/'))
    fireEvent.click(screen.getByRole('button', { name: 'إغلاق' }))
    expect(screen.queryByRole('dialog', { name: 'أيام الغياب المتتالي' })).toBeNull()
  })

  it('shows explicit weekly and monthly ranges and loads history for cross-period streaks', async () => {
    const period = workerControlPeriods(day)
    const fullDate = (value) => value.split('-').reverse().join('/')
    getAttendanceRequest.mockClear()
    const weekly = open('/worker-control-center/weekly')
    expect(await screen.findByText(/هذا الأسبوع:/)).toHaveProperty('textContent', `هذا الأسبوع: ${fullDate(period.weekStart)} → ${fullDate(period.weekEnd)}`)
    expect(getAttendanceRequest).toHaveBeenCalledWith({ date_from: period.monthStart, date_to: day, paginate: true })
    weekly.unmount()

    getAttendanceRequest.mockClear()
    const monthly = open('/worker-control-center/monthly')
    expect(await screen.findByText(/هذا الشهر:/)).toHaveProperty('textContent', `هذا الشهر: ${fullDate(period.monthStart)} → ${fullDate(day)}`)
    expect(getAttendanceRequest).toHaveBeenCalledWith({ date_from: period.monthStart, date_to: day, paginate: true })
    monthly.unmount()

    getAttendanceRequest.mockClear()
    open('/worker-control-center/consecutive-absence')
    await screen.findByText('Absent Worker')
    expect(getAttendanceRequest).toHaveBeenCalledWith({ date_to: day, paginate: true })
  })

  it('monthly page has only monthly workers and its search/absence filters', async () => {
    open('/worker-control-center/monthly')
    expect(await screen.findByText('Absent Worker')).toBeTruthy()
    expect(screen.queryByText('Inactive Worker')).toBeNull()
    fireEvent.change(screen.getByRole('combobox', { name: 'الحد الأدنى للغياب' }), { target: { value: '3' } })
    expect(screen.queryByText('Absent Worker')).toBeNull()
    fireEvent.change(screen.getByRole('combobox', { name: 'الحد الأدنى للغياب' }), { target: { value: '1' } })
    fireEvent.change(screen.getByRole('searchbox', { name: 'بحث عن عامل' }), { target: { value: 'not found' } })
    expect(screen.queryByText('Absent Worker')).toBeNull()
  })

  it('team details navigate to a team-focused page instead of expanding the hub', async () => {
    open('/worker-control-center/teams')
    expect(await screen.findByText('Peinture Raghibe')).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: 'التفاصيل' }))
    expect(await screen.findByRole('heading', { name: 'Peinture Raghibe', level: 2 })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'العودة إلى مراقبة الفرق' })).toBeTruthy()
    expect(screen.queryByText('Inactive Worker')).toBeNull()
  })
})
