import { beforeEach, expect, it, vi } from 'vitest'
const client = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../lib/supabase', () => ({ getSupabaseClient: () => client }))
import { getHistoricalSupervisorReviewRequest, getMorningReportStatusRequest, saveSupervisorDraftRequest, submitSupervisorDraftRequest } from './supervisorMorningReviewApi.js'
beforeEach(() => { client.rpc.mockReset(); client.rpc.mockResolvedValue({ data: {}, error: null }) })
it('sends ISO dates from DD/MM input to reads, draft saves, and final submits', async () => {
 await getHistoricalSupervisorReviewRequest('22/11/2026')
 expect(client.rpc).toHaveBeenLastCalledWith('admin_get_final_supervisor_review', { p_date: '2026-11-22', p_finalize: false })
 await getMorningReportStatusRequest('23/11/2026')
 expect(client.rpc).toHaveBeenLastCalledWith('admin_morning_report_status', { p_date: '2026-11-23' })
 await saveSupervisorDraftRequest({ date: '27/11/2026', context: {}, results: {} })
 expect(client.rpc.mock.calls.at(-1)[1].p_date).toBe('2026-11-27')
 await submitSupervisorDraftRequest({ date: '22/11/2026', context: {} })
 expect(client.rpc.mock.calls.at(-1)[1].p_date).toBe('2026-11-22')
})
it('does not send impossible calendar dates to Supabase', async () => {
 await expect(getHistoricalSupervisorReviewRequest('31/11/2026')).rejects.toThrow('Invalid work date')
 expect(client.rpc).not.toHaveBeenCalled()
})
