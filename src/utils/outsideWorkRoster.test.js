import { describe, expect, it } from 'vitest'
import { outsideWorkEligibleWorkers, outsideWorkForemen, outsideWorkOtherWorkers, outsideWorkTeamWorkers, searchOutsideWorkPeople } from './outsideWorkRoster'

const staff = [
  { id: 'foreign', full_name: 'FOREIGN LEADER', employee_code: '900', is_active: true, staff_classification: 'special_staff' },
  { id: 'local', full_name: 'ROBERT', employee_code: '79', is_active: true, staff_classification: 'normal', team_id: 'paint', team_name: 'Peinture Raghibe' },
  { id: 'monthly', full_name: 'MONTHLY LOCAL', employee_code: '80', is_active: true, staff_classification: 'normal', team_id: 'paint', team_name: 'Peinture Raghibe', payment_type: 'monthly' },
  { id: 'inactive-foreign', full_name: 'OLD LEADER', employee_code: '901', is_active: false, staff_classification: 'special_staff' },
  { id: 'inactive-local', full_name: 'OLD WORKER', employee_code: '77', is_active: false, staff_classification: 'normal', team_id: 'paint', team_name: 'Peinture Raghibe' },
  { id: 'future', full_name: 'FUTURE WORKER', employee_code: '78', is_active: true, staff_classification: 'normal', team_id: 'paint', team_name: 'Peinture Raghibe', operational_start_date: '2026-10-15' },
  { id: 'admin', full_name: 'ADMIN', employee_code: '20', is_active: true, staff_classification: 'normal', team_id: 'admin', team_name: 'Adminstration' },
]

describe('outside-work roster sources', () => {
  it('selects only active canonical special-staff foremen', () => {
    expect(outsideWorkForemen(staff).map((worker) => worker.id)).toEqual(['foreign'])
  })
  it('selects only active eligible normal workers, including monthly-paid normal workers', () => {
    expect(outsideWorkEligibleWorkers(staff, '2026-10-14').map((worker) => worker.id)).toEqual(['monthly', 'local'])
  })
  it('does not dump a roster before search and matches names or exact code text client-side', () => {
    expect(searchOutsideWorkPeople(staff, '')).toEqual([])
    expect(searchOutsideWorkPeople(outsideWorkForemen(staff), '900').map((worker) => worker.id)).toEqual(['foreign'])
    expect(searchOutsideWorkPeople(outsideWorkEligibleWorkers(staff, '2026-10-14'), 'rob').map((worker) => worker.id)).toEqual(['local'])
  })
  it('returns no team workers before selection, and never mixes teams', () => {
    const all = [...staff, { id: 'other', full_name: 'JEREMIE', employee_code: '100', is_active: true, staff_classification: 'normal', team_id: 'montage', team_name: 'Montage' }]
    expect(outsideWorkTeamWorkers(all, '2026-10-14', '')).toEqual([])
    expect(outsideWorkTeamWorkers(all, '2026-10-14', 'montage').map((worker) => worker.id)).toEqual(['other'])
    expect(outsideWorkOtherWorkers(all, '2026-10-14', 'paint', '', new Map())).toEqual([])
    expect(outsideWorkOtherWorkers(all, '2026-10-14', 'paint', '064', new Map([['other', '064']])).map((worker) => worker.id)).toEqual(['other'])
    expect(all.find((worker) => worker.id === 'other').team_id).toBe('montage')
  })
})
