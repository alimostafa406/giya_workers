import { describe, expect, it } from 'vitest'
import { canonicalWorkDate, isNonFutureKinshasaWorkDate, requireCanonicalWorkDate } from './workDate.js'

describe('canonical work dates', () => {
 const now = new Date('2026-11-27T10:00:00Z')
 it.each(['2026-11-22', '2026-11-23', '2026-11-27', '22/11/2026', '23/11/2026'])('%s is a valid non-future calendar date', value => {
  expect(isNonFutureKinshasaWorkDate(value, now)).toBe(true)
 })
 it('blocks tomorrow by date, independently of display format', () => {
  expect(isNonFutureKinshasaWorkDate('2026-11-28', now)).toBe(false)
  expect(isNonFutureKinshasaWorkDate('28/11/2026', now)).toBe(false)
 })
 it('maps displayed DD/MM/YYYY exactly to ISO without interpreting an instant', () => {
  expect(canonicalWorkDate('22/11/2026')).toBe('2026-11-22')
  expect(canonicalWorkDate('02/12/2026')).toBe('2026-12-02')
  expect(canonicalWorkDate('2026-11-22')).toBe('2026-11-22')
 })
 it.each(['31/11/2026', '2026-02-29', '2026-13-01', '22/11', '2026-11-22T00:00:00Z', ''])('rejects malformed/impossible dates: %s', value => {
  expect(canonicalWorkDate(value)).toBeNull()
  expect(() => requireCanonicalWorkDate(value)).toThrow('Invalid work date')
 })
 it('uses the Kinshasa calendar day at UTC midnight boundaries', () => {
  expect(isNonFutureKinshasaWorkDate('2026-11-27', new Date('2026-11-26T23:30:00Z'))).toBe(true)
  expect(isNonFutureKinshasaWorkDate('2026-11-28', new Date('2026-11-26T23:30:00Z'))).toBe(false)
  expect(canonicalWorkDate('29/02/2028')).toBe('2028-02-29')
 })
})
