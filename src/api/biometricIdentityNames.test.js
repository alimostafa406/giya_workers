import { beforeEach, describe, expect, it, vi } from 'vitest'

const { from, query } = vi.hoisted(() => {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    then: (resolve, reject) => Promise.resolve({ data: [
      { device_id: 'office-main', device_employee_no: '85', device_name: 'bevindo chadrack', is_current: true },
    ], error: null }).then(resolve, reject),
  }
  return { from: vi.fn(() => query), query }
})

vi.mock('../lib/supabase', () => ({ getSupabaseClient: () => ({ from }) }))

import { getCurrentBiometricIdentityNamesRequest } from './biometricMappingApi.js'

describe('current biometric identity display names', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    query.select.mockReturnValue(query)
    query.eq.mockReturnValue(query)
    query.in.mockReturnValue(query)
  })

  it('reads current structured names for exact recent devices and number strings', async () => {
    const result = await getCurrentBiometricIdentityNamesRequest([
      { devices_seen: ['office-main'], device_employee_no: '85' },
      { devices_seen: ['office-main'], device_employee_no: '064' },
    ])
    expect(from).toHaveBeenCalledWith('biometric_device_identity_presence')
    expect(query.select).toHaveBeenCalledWith('device_id,device_employee_no,device_name,is_current')
    expect(query.eq).toHaveBeenCalledWith('is_current', true)
    expect(query.in).toHaveBeenCalledWith('device_id', ['office-main'])
    expect(query.in).toHaveBeenCalledWith('device_employee_no', ['85', '064'])
    expect(result.data[0].device_name).toBe('bevindo chadrack')
  })

  it('does not query when no unresolved device identities exist', async () => {
    expect(await getCurrentBiometricIdentityNamesRequest([])).toEqual({ data: [] })
    expect(from).not.toHaveBeenCalled()
  })
})
