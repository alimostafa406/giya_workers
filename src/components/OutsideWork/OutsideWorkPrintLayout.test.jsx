// @vitest-environment jsdom
import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import OutsideWorkReport from './OutsideWorkReport'
import { LanguageProvider } from '../../i18n/LanguageContext'
import { outsideWorkDateFilterLabels } from './outsideWorkDateFilterLabels'
const api = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('../../api/outsideWorkApi', () => ({ getOutsideWorkMovements: api.list }))
vi.mock('../../utils/attendanceOperationalGate', () => ({ kinshasaClock: () => ({ date: '2026-10-31' }) }))
globalThis.React = React
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks() })
it.each(['ar', 'fr'])('three selected dates share one continuous %s print root', async language => {
  localStorage.setItem('workers_app_language', language)
  const dates = ['2026-10-04', '2026-10-11', '2026-10-18']
  const workers = ['IROCHIE chima', 'nguvu', 'PEMBELE'].map((full_name, i) => ({ id: String(i), full_name,
    employee_code: String(23 + i), team_id: 'siraj', team_name: 'Siraj' }))
  const movements = [...dates, '2026-10-19'].map((work_date, i) => ({ id: String(i), work_date, status: 'final', team_id: 'mostafa',
    team: { name: 'Montage mostafa' }, foreman_worker_id: 'f', foreman_name: 'Mostafa', start_time: '09:00', end_time: '16:30',
    common_worker_start: '09:00', common_worker_end: '16:30', outside_work_movement_workers: workers.map(w => ({
      worker_id: w.id, worker_name: w.full_name, start_time: '09:00', end_time: '16:30' })) }))
  api.list.mockResolvedValue(movements)
  const { container } = render(<LanguageProvider><OutsideWorkReport workers={workers} teams={[]} biometricIds={new Map()} /></LanguageProvider>)
  await waitFor(() => expect(container.querySelectorAll('.outside-work-print .outside-report-day')).toHaveLength(4))
  const labels = outsideWorkDateFilterLabels[language]
  for (const date of dates) {
    fireEvent.change(screen.getByLabelText(labels.specificDates), { target: { value: date } })
    fireEvent.click(screen.getByRole('button', { name: labels.addDate }))
  }
  const print = container.querySelector('.outside-work-print')
  expect(print.querySelectorAll('.outside-report-day')).toHaveLength(3)
  expect(print.querySelectorAll('tbody tr')).toHaveLength(9)
  expect(print.innerHTML).not.toContain('2026-10-19')
  expect(print.querySelector('button, input, select')).toBeNull()
  const css = readFileSync('src/components/OutsideWork/OutsideWorkReport.css', 'utf8')
  expect(css).toContain('size: A4 landscape; margin: 7mm')
  expect(css).toContain('page-break-before: auto; page-break-after: auto')
  expect(css).not.toMatch(/rotate\(|break-before:\s*page|break-after:\s*page|page-break-(?:before|after):\s*always/)
  // Optional browser/PDF fixture uses the real rendered component and built CSS.
  const output = process.env.OUTSIDE_WORK_PRINT_FIXTURES
  if (output) {
    mkdirSync(output, { recursive: true })
    const index = readFileSync('dist/index.html', 'utf8')
    const cssAsset = index.match(/href="([^"]+\.css)"/)[1]
    const builtCss = readFileSync(join('dist', cssAsset.replace(/^\//, '')), 'utf8')
    writeFileSync(join(output, `three-dates-${language}.html`), `<!doctype html><html lang="${language}" dir="${language === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>${builtCss}</style></head><body><main><div><div class="outside-work-page">${container.innerHTML}</div></div></main></body></html>`)
  }
})
