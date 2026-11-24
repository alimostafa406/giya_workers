import {expect,it} from 'vitest'
import {sundayEvidenceTimestamp,suggestedSundayMinutes} from './sundayApprovedEvidence'
it('keeps seconds, local work date, next-day window, and strict OT threshold',()=>{
 expect(sundayEvidenceTimestamp('2026-11-22','08:00')).toBe('2026-11-22T08:00:00+01:00')
 expect(sundayEvidenceTimestamp('2026-11-22','00:31:44')).toBe('2026-11-23T00:31:44+01:00')
 expect(sundayEvidenceTimestamp('2026-11-22','25:00')).toBeNull()
 expect(suggestedSundayMinutes('2026-11-22','08:00','18:30')).toBe(270)
 expect(suggestedSundayMinutes('2026-11-22','08:00','14:30')).toBe(0)
 expect(suggestedSundayMinutes('2026-11-22','08:00','14:30:01')).toBe(30)
 expect(suggestedSundayMinutes('2026-11-22','08:00','00:31:44')).toBe(631)
 expect(suggestedSundayMinutes('2026-11-22','08:00','18:30','15:00')).toBe(210)
 expect(suggestedSundayMinutes('2026-11-22','19:00','18:30')).toBeNull()
})
