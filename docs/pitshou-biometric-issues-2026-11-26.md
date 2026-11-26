# PITSHOU #70 / biometric 094 audit, 2026-11-26

Confirmed active NULL-device mapping resolves office-main and office-secondary to worker 284336c1-6cee-42b0-b038-6872f9d5ac65. No conflicting owner. BENI 033 remains unmapped; no name-based resolution.

PITSHOU is configured attendance_shift=night (updated November 19). Canonical night window: 17:00-06:30 next day, overriding Chauffeur legacy window. Eight real local punches today, 07:33:08 through 07:53:44, are outside both neighboring night windows. Canonical persisted-event dry run: outside_night_window=8, raw_events_used=0, no check-in/check-out, status pending. No attendance row exists November 23-26. Recovery is BLOCKED pending authorized schedule review; changing mapping or fabricating attendance would be wrong.

Diagnostic RPC previously inferred application failure from absent calendar-date attendance. It now explains night-window exclusions and joins valid early night evidence to previous work date. Existing attendance remains resolved. Attendance, protected decisions, shift settings, payroll and raw events are not changed.

Confirmed-worker issues group by worker/date/type across devices; PITSHOU has one expandable card with eight punches. Unmapped identities remain exact device + string scoped: BENI has two unproven device identities, never merged by name. Current urgent population: three groups from ten raw events, plus inactive events in their separate view.

Validation: four focused React tests, one grouped-identity Node test, fourteen monitoring Python tests pass. Build/lint/diff check pass. Local dashboard restarted; HTTP and health 200, new production asset served. Browser visual verification not performed. Older broad unresolved UI test has two existing stale assertions against current Inactive Workers implementation; that unrelated page was untouched.

Unchanged before/after checksums: ten events 4de4a0f8e84c13d1526123db3f5f616e; mapping f5a678054986edcfdc4ac5838bdb9e77; 83 PITSHOU attendance rows 5f524858ea3d253bcc6fea984f0b3bba.
