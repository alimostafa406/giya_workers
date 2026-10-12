import { describe, expect, it } from 'vitest'
import { safeBiometricDisplayName } from './biometricDisplayName.js'

describe('biometric display names', () => {
  it('preserves an ordinary structured device name', () => {
    expect(safeBiometricDisplayName(' bevindo chadrack ')).toBe('bevindo chadrack')
  })

  it('rejects JSON fragments already persisted as device-name metadata', () => {
    expect(safeBiometricDisplayName('bevindo chadrack1989", "doorRight": "1", "RightPlan": []')).toBe('')
    expect(safeBiometricDisplayName('bevindo chadrack\t"NGANZI",\n"userType": "normal"')).toBe('')
  })

  it('rejects non-string names without changing biometric identity values', () => {
    expect(safeBiometricDisplayName({ name: '85' })).toBe('')
  })
})
