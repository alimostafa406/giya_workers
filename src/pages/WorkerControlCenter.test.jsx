// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import WorkerControlCenter from './WorkerControlCenter'

globalThis.React = React
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
vi.mock('../store/authStore', () => ({ useAuthStore: (selector) => selector({ admin: null }) }))

const routes = <Routes>
  <Route path="/worker-control-center" element={<WorkerControlCenter />} />
  <Route path="/worker-control-center/absent-today" element={<WorkerControlCenter category="absent-today" />} />
  <Route path="/worker-control-center/consecutive-absence" element={<WorkerControlCenter category="consecutive-absence" />} />
  <Route path="/worker-control-center/monthly" element={<WorkerControlCenter category="monthly" />} />
  <Route path="/worker-control-center/inactive-punched" element={<WorkerControlCenter category="inactive-punched" />} />
  <Route path="/worker-control-center/activated-today" element={<WorkerControlCenter category="activated-today" />} />
  <Route path="/worker-control-center/teams" element={<WorkerControlCenter category="teams" />} />
  <Route path="/worker-control-center/teams/:teamId" element={<WorkerControlCenter category="team-detail" />} />
</Routes>
const open = (path = '/worker-control-center') => render(<MemoryRouter initialEntries={[path]}>{routes}</MemoryRouter>)
afterEach(cleanup)

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

  it('subpage worker Details opens the existing expanded monitoring panel', async () => {
    open('/worker-control-center/absent-today')
    expect(await screen.findByText('Absent Worker')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'التفاصيل' }))
    expect(screen.getByRole('dialog', { name: /متابعة العامل: Absent Worker/ })).toBeTruthy()
    expect(screen.getByText('هذا الأسبوع')).toBeTruthy()
    expect(screen.getByText('هذا الشهر')).toBeTruthy()
  })

  it('shows a compact current absence period and reveals individual dates on demand', async () => {
    open('/worker-control-center/consecutive-absence')
    expect(await screen.findByText('Absent Worker')).toBeTruthy()
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'العامل', 'الفريق', 'أيام الغياب المتتالي', 'فترة الغياب', 'غياب الشهر', 'آخر حضور', 'التفاصيل',
    ])
    const shortDate = (value) => value.slice(5).split('-').reverse().join('/')
    expect(screen.getByText(`${shortDate(`${day.slice(0, 7)}-01`)} → ${shortDate(day)}`)).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'أيام الغياب المتتالي' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'عرض الأيام' }))
    const dialog = screen.getByRole('dialog', { name: 'أيام الغياب المتتالي' })
    expect(dialog.querySelectorAll('li').length).toBeGreaterThanOrEqual(2)
    expect(dialog.querySelectorAll('li')[0].textContent).toBe(`01/${day.slice(5, 7)}/${day.slice(0, 4)}`)
    fireEvent.click(screen.getByRole('button', { name: 'إغلاق' }))
    expect(screen.queryByRole('dialog', { name: 'أيام الغياب المتتالي' })).toBeNull()
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
