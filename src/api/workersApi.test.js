import { beforeEach, expect, it, vi } from 'vitest'
import { createWorkerRequest, updateWorkerRequest } from './workersApi'
const mocks = vi.hoisted(() => ({ from: vi.fn(), insert: vi.fn(), update: vi.fn(), upsert: vi.fn() }))
vi.mock('../lib/supabase', () => ({ getSupabaseClient: () => ({ from: mocks.from }) }))
beforeEach(() => {
  vi.clearAllMocks()
  mocks.from.mockImplementation(() => {
    const query = { select: () => query, eq: () => query,
      insert: (value) => { mocks.insert(value); return query },
      update: (value) => { mocks.update(value); return query },
      upsert: (value) => { mocks.upsert(value); return query },
      single: async () => ({ data: { id: 'worker', team_id: 'legacy' }, error: null }) }
    return query
  })
})
const special = { full_name: 'Foreign', employee_code: '064', phone: '', is_active: true, staff_classification: 'special_staff' }
it('creates special staff without a team or automatically creating a payroll profile', async () => {
  await createWorkerRequest(special)
  expect(mocks.insert).toHaveBeenCalledWith({ full_name: 'Foreign', phone: '', is_active: true })
  expect(mocks.from.mock.calls.map(([table]) => table)).toEqual(['workers', 'worker_staff_classification'])
})
it('ignores special-staff hidden fields and preserves existing team/payroll and foreman links', async () => {
  await updateWorkerRequest('worker', { ...special, team_id: 'new-team', payment_type: 'monthly', monthly_salary: 9000 })
  expect(mocks.update.mock.calls[0][0]).not.toHaveProperty('team_id')
  expect(mocks.from.mock.calls.map(([table]) => table)).toEqual(['workers', 'worker_staff_classification'])
})
it('normal workers still require a team and retain normal weekly payroll defaults', async () => {
  await expect(createWorkerRequest({ ...special, staff_classification: 'normal' })).rejects.toThrow(/team is required/i)
  await createWorkerRequest({ ...special, staff_classification: 'normal', team_id: 'team' })
  expect(mocks.insert.mock.calls[0][0].team_id).toBe('team')
  expect(mocks.insert.mock.calls[0][0]).not.toHaveProperty('employee_code')
  expect(mocks.upsert).toHaveBeenCalledWith({ worker_id: 'worker', payment_type: 'weekly', monthly_salary: null })
})
