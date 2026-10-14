// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { LanguageProvider } from '../../i18n/LanguageContext'
import WorkerForm from './WorkerForm'
globalThis.React = React
afterEach(cleanup)
const open = (values = {}) => {
  localStorage.setItem('workers_app_language', 'en')
  const submit = vi.fn()
  const rendered = render(<LanguageProvider><WorkerForm initialValues={{ full_name: 'Worker', employee_code: '064', ...values }} teams={[{ id: 'team', name: 'Paint' }]} onSubmit={submit} /></LanguageProvider>)
  return { ...rendered, submit }
}
it('keeps normal worker team/payment/monthly salary fields and payload unchanged', () => {
  const { container, submit } = open({ team_id: 'team', payment_type: 'monthly', monthly_salary: 1000 })
  expect(container.querySelector('select[required]').value).toBe('team')
  expect(container.querySelector('input[type="number"]').value).toBe('1000')
  expect(container.querySelectorAll('select')).toHaveLength(3)
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({ team_id: 'team', payment_type: 'monthly', monthly_salary: 1000 }))
})
it('hides special-staff team and payroll fields and saves only identity/classification/active fields', () => {
  const { container, submit } = open({ staff_classification: 'special_staff', payment_type: 'monthly', monthly_salary: 1000 })
  expect(container.querySelectorAll('select')).toHaveLength(1)
  expect(container.querySelector('input[type="number"]')).toBeNull()
  expect(container.querySelector('select[required]')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(submit).toHaveBeenCalledWith({ full_name: 'Worker', employee_code: '064', phone: '', is_active: true, staff_classification: 'special_staff' })
})
it('does not submit hidden legacy special-staff team/payroll data', () => {
  const { submit } = open({ staff_classification: 'special_staff', team_id: 'legacy', payment_type: 'monthly', monthly_salary: 1234 })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(submit.mock.calls[0][0]).not.toHaveProperty('team_id')
  expect(submit.mock.calls[0][0]).not.toHaveProperty('payment_type')
  expect(submit.mock.calls[0][0]).not.toHaveProperty('monthly_salary')
})
it('hides stale normal-worker fields immediately when classification changes', () => {
  const { container, submit } = open({ team_id: 'team' })
  fireEvent.change(container.querySelector('select'), { target: { value: 'special_staff' } })
  expect(container.querySelectorAll('select')).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(submit.mock.calls[0][0]).not.toHaveProperty('team_id')
})
