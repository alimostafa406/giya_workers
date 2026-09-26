// @vitest-environment jsdom
import React from 'react'
import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import ReportPublication from './src/pages/ReportPublication.jsx'
import { getReportPublication, publishReportPublication, stopReportPublication } from './src/api/reportPublicationApi.js'
vi.stubGlobal('React', React)
vi.mock('./src/api/reportPublicationApi.js', () => ({ getReportPublication: vi.fn(), publishReportPublication: vi.fn(), stopReportPublication: vi.fn() }))
vi.mock('./src/api/axios', () => ({ getErrorMessage: e => e.message }))
vi.mock('./src/i18n/LanguageContext', () => ({ useTranslation: () => ({ t: key => key }) }))
const auth = vi.hoisted(() => ({ admin: { is_active: true } }))
vi.mock('./src/store/authStore', () => ({ useAuthStore: selector => selector(auth) }))
const state = published => ({ published, period_start: '2026-09-21', period_end: '2026-09-26', available_dates: ['2026-09-21'], version: 1 })
afterEach(() => { cleanup(); vi.clearAllMocks(); auth.admin = { is_active: true } })
test('admin loads independent status, confirms publish and stop', async () => {
  getReportPublication.mockResolvedValue(state(false))
  publishReportPublication.mockResolvedValue(state(true))
  stopReportPublication.mockResolvedValue(state(false))
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  render(<ReportPublication />)
  fireEvent.click(await screen.findByRole('button', { name: 'reportPublication.publish' }))
  await screen.findByText('reportPublication.published')
  expect(publishReportPublication).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'reportPublication.stop' }))
  await screen.findByText('reportPublication.unpublished')
  expect(stopReportPublication).toHaveBeenCalledTimes(1)
})
test('cancelled confirmation does not publish', async () => {
  getReportPublication.mockResolvedValue(state(false))
  vi.spyOn(window, 'confirm').mockReturnValue(false)
  render(<ReportPublication />)
  fireEvent.click(await screen.findByRole('button', { name: 'reportPublication.publish' }))
  expect(publishReportPublication).not.toHaveBeenCalled()
})
test('non-admin sees no publication controls or source requests', () => {
  auth.admin = null
  render(<ReportPublication />)
  expect(screen.queryByRole('button')).toBeNull()
  expect(getReportPublication).not.toHaveBeenCalled()
})
