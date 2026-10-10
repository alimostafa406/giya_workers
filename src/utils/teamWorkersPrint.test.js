import { describe, expect, it, vi } from 'vitest'
import { translations } from '../i18n/translations.js'
import { buildAllTeamWorkersPrintHtml, printAllTeamWorkers, teamWorkersForPrint } from './teamWorkersPrint.js'

const team = { id: 'zarour', name: 'Zarour' }
const workers = [
  { id: 'one', team_id: 'zarour', full_name: 'JEREMIE', employee_code: '1', is_active: true, monthly_salary: 10000 },
  { id: 'two', team_id: 'zarour', full_name: 'ROBERT', employee_code: '79', is_active: false },
  { id: 'other', team_id: 'paint', full_name: 'MATAMATA', employee_code: '339', is_active: true },
]
const mappings = [
  { worker_id: 'one', device_employee_no: '204', is_active: true, mapping_review_state: 'confirmed' },
  { worker_id: 'one', device_employee_no: '204', is_active: true, mapping_review_state: 'confirmed', device_id: 'secondary' },
  { worker_id: 'two', device_employee_no: '79', is_active: true, mapping_review_state: 'confirmed' },
  { worker_id: 'one', device_employee_no: '999', is_active: true, mapping_review_state: 'pending' },
  { worker_id: 'other', device_employee_no: '55550008', is_active: true, mapping_review_state: 'confirmed' },
]
const labels = {
  printAllTitle: 'Workers by Team', totalTeams: 'Total teams', totalWorkers: 'Total workers', workerCount: 'Worker count',
  number: '#', worker: 'Worker name', employeeCode: 'Employee code', biometricId: 'Biometric ID',
  status: 'Status', active: 'Active', inactive: 'Inactive', noMembers: 'No workers',
}
const options = { teams: [team, { id: 'paint', name: 'Peinture Raghibe' }], workers, mappings, labels, language: 'en', direction: 'ltr' }

describe('team worker-list printing', () => {
  it('includes only the selected team, including inactive workers, with confirmed active biometric IDs', () => {
    const beforeWorkers = structuredClone(workers)
    const beforeMappings = structuredClone(mappings)
    expect(teamWorkersForPrint({ ...options, team })).toEqual([
      { id: 'one', name: 'JEREMIE', employeeCode: '1', biometricIds: ['204'], isActive: true },
      { id: 'two', name: 'ROBERT', employeeCode: '79', biometricIds: ['79'], isActive: false },
    ])
    expect(workers).toEqual(beforeWorkers)
    expect(mappings).toEqual(beforeMappings)
  })

  it('prints every team in page order with exact team/overall counts and worker-only columns', () => {
    const html = buildAllTeamWorkersPrintHtml(options)
    expect(html).toContain('<h1>Workers by Team</h1>')
    expect(html).toContain('Total teams: 2 · Total workers: 3')
    expect(html).toContain('<h2>Zarour</h2><p>Worker count: 2</p>')
    expect(html).toContain('<h2>Peinture Raghibe</h2><p>Worker count: 1</p>')
    expect(html.indexOf('<h2>Zarour</h2>')).toBeLessThan(html.indexOf('<h2>Peinture Raghibe</h2>'))
    expect(html.match(/<th>#<\/th><th>Worker name<\/th><th>Employee code<\/th><th>Biometric ID<\/th><th>Status<\/th>/g)).toHaveLength(2)
    const sections = html.match(/<section class="team-section">[\s\S]*?<\/section>/g)
    expect(sections).toHaveLength(2)
    expect(sections[0]).toContain('JEREMIE')
    expect(sections[0]).toContain('ROBERT')
    expect(sections[0]).not.toContain('MATAMATA')
    expect(sections[1]).toContain('MATAMATA')
    expect(sections[1]).not.toContain('JEREMIE')
    expect(html.match(/<td>JEREMIE<\/td>/g)).toHaveLength(1)
    expect(html).toContain('>204</td>')
    expect(html).toContain('>55550008</td>')
    expect(html).toContain('>Inactive</td>')
    expect(html).not.toMatch(/payroll|wage|salary|overtime|attendance|transport|10000/i)
    expect(html).toMatch(/@page\{size:A4 portrait/)
    expect(html).toMatch(/\.team-section \+ \.team-section\{break-before:page;page-break-before:always\}/)
    expect(html).toMatch(/thead\{display:table-header-group\}/)
    expect(html).toMatch(/tr\{break-inside:avoid/)
  })

  it('escapes worker-controlled names and shows a dash for missing biometric mapping', () => {
    const html = buildAllTeamWorkersPrintHtml({ ...options, workers: [{ ...workers[0], full_name: '<script>alert(1)</script>' }], mappings: [] })
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).toContain('>—</td>')
  })

  it('opens exactly one worker-only print document', () => {
    const printDocument = { write: vi.fn(), close: vi.fn() }
    const printWindow = { document: printDocument, focus: vi.fn(), print: vi.fn() }
    const originalWindow = globalThis.window
    globalThis.window = { open: vi.fn(() => printWindow) }
    try {
      expect(printAllTeamWorkers(options)).toBe(true)
      expect(globalThis.window.open).toHaveBeenCalledOnce()
      expect(printDocument.write).toHaveBeenCalledOnce()
      expect(printWindow.print).toHaveBeenCalledOnce()
    } finally {
      globalThis.window = originalWindow
    }
  })

  it('localizes the team print button in all supported languages', () => {
    expect(translations.ar.teams.printAllTeams).toBe('طباعة كل الفرق')
    expect(translations.en.teams.printAllTeams).toBe('Print All Teams')
    expect(translations.fr.teams.printAllTeams).toBe('Imprimer toutes les équipes')
    expect(translations.ar.teams.printAllTitle).toBe('قائمة العمال حسب الفرق')
    expect(translations.en.teams.printBiometricId).toBe('Biometric ID')
  })
})
