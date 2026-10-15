import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getOutsideWorkMovements, saveOutsideWorkMovement } from './outsideWorkApi'

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), query: null }))
vi.mock('../lib/supabase', () => ({ getSupabaseClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }))
beforeEach(() => {
  const query = { select: vi.fn(() => query), or: vi.fn(() => query), order: vi.fn(() => query), range: vi.fn(async () => ({ data: [], error: null })) }
  mocks.query = query
  mocks.from.mockReset().mockReturnValue(query)
  mocks.rpc.mockReset().mockResolvedValue({ data: 'draft-id', error: null })
})
describe('outside-work draft API', () => {
  it('sends a null primary team and every worker for foreman-led movements', async () => {
    await saveOutsideWorkMovement({ status: 'final', work_date: '2026-10-15', foreman_worker_id: 'foreman-id', team_id: '',
      workers: [{ worker_id: 'team-a-worker', start_time: '08:00', end_time: '17:00' }, { worker_id: 'team-b-worker', start_time: '08:00', end_time: '17:00' }] })
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_outside_work_movement', { p_movement: expect.objectContaining({
      team_id: null, foreman_worker_id: 'foreman-id', workers: [
        { worker_id: 'team-a-worker', start_time: '08:00', end_time: '17:00' },
        { worker_id: 'team-b-worker', start_time: '08:00', end_time: '17:00' },
      ],
    }) })
  })
  it('serializes every selected worker ID without primary-team filtering on create and update, and reloads children', async () => {
    const children = [
      { worker_id: 'same-team-id', start_time: '08:00', end_time: '17:00' },
      { worker_id: 'other-team-id', start_time: '08:00', end_time: '17:00' },
    ]
    const values = { status: 'final', team_id: 'primary-team', workers: children }
    for (const id of [null, 'existing-movement']) {
      await saveOutsideWorkMovement({ ...values, id })
      expect(mocks.rpc).toHaveBeenLastCalledWith('admin_save_outside_work_movement', {
        p_movement: expect.objectContaining({ id, team_id: 'primary-team', workers: children }),
      })
    }
    mocks.query.range.mockResolvedValueOnce({ data: [{ id: 'existing-movement', outside_work_movement_workers: children }], error: null })
    expect((await getOutsideWorkMovements('2026-10-12', '2026-10-18'))[0].outside_work_movement_workers).toEqual(children)
    expect(values.workers).toEqual(children)
  })
  it('loads every draft including undated drafts alongside the selected final week', async () => {
    await getOutsideWorkMovements('2026-10-12', '2026-10-18')
    expect(mocks.query.or).toHaveBeenCalledWith('status.eq.draft,and(work_date.gte.2026-10-12,work_date.lte.2026-10-18)')
    expect(mocks.from).toHaveBeenCalledWith('outside_work_movements')
  })
  it('saves incomplete fields and reminder text using worker IDs in the one admin RPC', async () => {
    await saveOutsideWorkMovement({ status: 'draft', workers: [{ worker_id: 'worker-id', worker_name: 'UI NAME', team_id: 'other-team', start_time: '', end_time: '' }],
      missing_worker_note: 'WhatsApp name', entry_state: { otherSearch: 'search' } })
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_outside_work_movement', { p_movement: expect.objectContaining({
      status: 'draft', work_date: null, start_time: null, missing_worker_note: 'WhatsApp name',
      entry_state: { otherSearch: 'search' }, workers: [{ worker_id: 'worker-id', start_time: null, end_time: null }],
    }) })
    expect(mocks.from).not.toHaveBeenCalled()
  })
})
