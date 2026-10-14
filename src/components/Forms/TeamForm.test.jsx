// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { LanguageProvider } from '../../i18n/LanguageContext'
import TeamForm from './TeamForm'
globalThis.React = React
afterEach(cleanup)
it('loads and saves the team foreman separately from supervisor and worker membership', () => {
  localStorage.setItem('workers_app_language', 'en')
  const onSubmit = vi.fn()
  render(<LanguageProvider><TeamForm initialValues={{ id: 'team', name: 'Paint', foreman_worker_id: 'foreman' }} supervisors={[]} foremen={[{ id: 'foreman', full_name: 'FOREMAN' }]} onSubmit={onSubmit} /></LanguageProvider>)
  expect(screen.getByRole('combobox', { name: 'Team Foreman' }).value).toBe('foreman')
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(onSubmit).toHaveBeenCalledWith({ name: 'Paint', foreman_worker_id: 'foreman', supervisor_id: '', is_active: true })
})
