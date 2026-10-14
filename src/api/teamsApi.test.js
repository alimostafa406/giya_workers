import { beforeEach, it, expect, vi } from 'vitest'
import { getTeamsRequest, updateTeamRequest } from './teamsApi'
const mocks = vi.hoisted(() => ({ from: vi.fn(), workers: vi.fn(), updated: vi.fn() }))
vi.mock('../lib/supabase', () => ({ getSupabaseClient: () => ({ from: mocks.from }) }))
vi.mock('./workersApi', () => ({ getWorkersRequest: mocks.workers }))
const foreman = { id: 'foreman', full_name: 'FOREMAN', is_active: true, staff_classification: 'special_staff', team_id: null }
beforeEach(() => {
  mocks.from.mockClear()
  mocks.updated.mockReset()
  mocks.workers.mockResolvedValue({ data: [foreman] })
  mocks.from.mockImplementation((table) => {
    const data = table === 'teams' ? [{ id: 'paint', name: 'Paint', foreman_worker_id: 'foreman' }]
      : table === 'workers' ? [{ id: 'worker', team_id: 'paint', is_active: true }, foreman] : []
    const query = { select: () => query, order: () => query, eq: () => query,
      update: (payload) => { mocks.updated(payload); return query },
      single: async () => ({ data: data[0], error: null }),
      then: (resolve) => resolve({ data, error: null }) }
    return query
  })
})
it('resolves responsibility metadata without adding the foreman to members or worker count', async () => {
  const { data } = await getTeamsRequest()
  expect(data[0].foreman.id).toBe('foreman')
  expect(data[0].workers_count).toBe(1)
  expect(data[0].workers.map((worker) => worker.id)).toEqual(['worker'])
})
it('updates only teams and preserves a foreman link when toggling team status', async () => {
  await updateTeamRequest('paint', { name: 'Paint', is_active: true, foreman_worker_id: 'foreman' })
  expect(mocks.updated).toHaveBeenLastCalledWith({ name: 'Paint', is_active: true, supervisor_id: null, foreman_worker_id: 'foreman' })
  expect(mocks.from.mock.calls.every(([table]) => table === 'teams')).toBe(true)
  await updateTeamRequest('paint', { name: 'Paint', is_active: false })
  expect(mocks.updated).toHaveBeenLastCalledWith({ name: 'Paint', is_active: false, supervisor_id: null })
})
