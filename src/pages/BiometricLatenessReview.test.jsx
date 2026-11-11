// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import BiometricLatenessReview from './BiometricLatenessReview'
globalThis.React = React
const mock = vi.hoisted(() => ({ load: vi.fn(), decide: vi.fn() }))
vi.mock('../api/biometricLatenessApi', () => ({ getBiometricLatenessReviews: mock.load, decideBiometricLateness: mock.decide }))
vi.mock('../utils/attendanceOperationalGate', () => ({ kinshasaClock: () => ({ date: '2026-11-11' }) }))
const fixture = () => ({ worker: { id: 'worker', full_name: 'Worker', employee_code: '27', team_id: 'team', team_name: 'Team' }, attendance: { id: 'a', attendance_date: '2026-11-11', check_in: '08:35:19' }, evidence: { raw_minutes: 35, raw_check_in: '2026-11-11T08:35:19', scheduled_start: '2026-11-11T08:00:00', source_fingerprint: 'fp' }, review: null, locked: false })
afterEach(() => { cleanup(); vi.clearAllMocks() })
it.each(['approved', 'rejected'])('visible controls adjust minutes and exact CDF amount then %s; raw evidence stays visible and untouched', async decision => {
  const row = fixture(), before = JSON.stringify(row)
  mock.load.mockResolvedValue([row]); mock.decide.mockResolvedValue([])
  render(<BiometricLatenessReview />)
  await screen.findByRole('spinbutton', { name: 'دقائق التأخير المعتمدة Worker' })
  expect(screen.getByText('08:35:19')).toBeTruthy()
  fireEvent.change(screen.getByRole('spinbutton', { name: 'دقائق التأخير المعتمدة Worker' }), { target: { value: '30' } })
  fireEvent.change(screen.getByRole('spinbutton', { name: 'خصم التأخير Worker' }), { target: { value: '2000' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'سبب الخصم Worker' }), { target: { value: 'Confirmed deduction' } })
  expect(screen.getByText('35 min')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: decision === 'approved' ? 'موافقة' : 'رفض', exact: true }))
  await waitFor(() => expect(mock.decide).toHaveBeenCalledWith('2026-11-11', row, decision, 30, 2000, 'Confirmed deduction'))
  expect(JSON.stringify(row)).toBe(before)
})
it('locked review disables decisions and edits; stale review is clearly marked; historical date is requested', async () => {
  const row = fixture(); row.review = { decision: 'approved', raw_minutes: 35, approved_minutes: 30, deduction_amount: 2000, source_fingerprint: 'old' }; row.locked = true
  mock.load.mockResolvedValue([row]); render(<BiometricLatenessReview />)
  await screen.findByText('لا يوجد تأخير مطابق للبحث')
  fireEvent.change(screen.getByLabelText('الحالة'), { target: { value: '' } })
  expect(screen.getByText('يحتاج مراجعة من جديد', { selector: 'td' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'موافقة', exact: true }).disabled).toBe(true)
  expect(screen.getByRole('spinbutton', { name: 'خصم التأخير Worker' }).disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('التاريخ'), { target: { value: '2026-11-10' } })
  await waitFor(() => expect(mock.load).toHaveBeenLastCalledWith('2026-11-10'))
})
it('invalid values cannot save, and server stale errors remain visible', async () => {
  mock.load.mockResolvedValue([fixture()]); mock.decide.mockRejectedValue(new Error('Review changed; reload'))
  render(<BiometricLatenessReview />); await screen.findByRole('spinbutton', { name: 'دقائق التأخير المعتمدة Worker' })
  fireEvent.change(screen.getByRole('spinbutton', { name: 'خصم التأخير Worker' }), { target: { value: '-1' } })
  fireEvent.click(screen.getByRole('button', { name: 'موافقة', exact: true }))
  expect(mock.decide).not.toHaveBeenCalled()
  fireEvent.change(screen.getByRole('spinbutton', { name: 'خصم التأخير Worker' }), { target: { value: '2000' } })
  fireEvent.click(screen.getByRole('button', { name: 'موافقة', exact: true }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Review changed'))
})
