import assert from 'node:assert/strict'
import test from 'node:test'
import { attendanceAgentHealth } from './src/utils/attendanceAgentHealth.js'
import { morningVerificationDiagnostics, morningVerificationReasonKey } from './src/utils/morningVerificationDiagnostics.js'

const afterVerificationStart = new Date('2026-09-21T09:30:00+01:00')

test('returns a structured device-read reason rather than display text', () => {
  const diagnostics = morningVerificationDiagnostics({
    verification: { latestAttempt: { status: 'incomplete', unresolved_worker_count: 7, device_failure_summary: { failures: [{ reason: 'device_query_incomplete', queries: [{ device_id: 'office-secondary', state: 'partial', error: 'read timeout' }] }] } } },
    now: afterVerificationStart,
  })
  assert.equal(diagnostics.isIncomplete, true)
  assert.deepEqual(diagnostics.reasons[0], { code: 'device_read_failed', params: { deviceId: ' (office-secondary)', error: ': read timeout' } })
  assert.equal(morningVerificationReasonKey(diagnostics.reasons[0]), 'agentStatus.reasons.device_read_failed')
  assert.equal(diagnostics.unresolvedWorkers, 7)
})

test('returns each known failure as a diagnostic code', () => {
  const diagnostics = morningVerificationDiagnostics({
    verification: { latestAttempt: { status: 'incomplete', device_failure_summary: { failures: [
      { reason: 'no_safe_confirmed_mapping' }, { reason: 'attendance_apply_failed' }, { reason: 'unknown_biometric_participation' }, { reason: 'verification_state_changed' },
    ] } } }, now: afterVerificationStart,
  })
  assert.deepEqual(diagnostics.reasons.map((item) => item.code), [
    'no_safe_confirmed_mapping', 'attendance_apply_failed', 'unknown_biometric_participation', 'verification_state_changed',
  ])
})

test('preserves backend diagnostic detail as a parameter, not a display string', () => {
  const diagnostics = morningVerificationDiagnostics({
    verification: { latestAttempt: { status: 'failed', device_failure_summary: { error: 'RuntimeError: RPC unavailable' } } }, now: afterVerificationStart,
  })
  assert.deepEqual(diagnostics.reasons, [{ code: 'verification_error', params: { error: 'RuntimeError: RPC unavailable' } }])
})

test('uses a code when final verification has not run after its scheduled start', () => {
  const diagnostics = morningVerificationDiagnostics({ verification: { latestAttempt: null, lastSuccessfulAttempt: null }, now: afterVerificationStart })
  assert.equal(diagnostics.isIncomplete, true)
  assert.deepEqual(diagnostics.reasons, [{ code: 'verification_not_run', params: {} }])
})

test('does not warn before schedule and recognizes a complete run', () => {
  const beforeSchedule = morningVerificationDiagnostics({ verification: { latestAttempt: null }, now: new Date('2026-09-21T09:00:00+01:00') })
  const complete = morningVerificationDiagnostics({ verification: { latestAttempt: { status: 'complete', completed_at: '2026-09-21T09:18:00+01:00' }, lastSuccessfulAttempt: { status: 'complete', completed_at: '2026-09-21T09:18:00+01:00' } }, now: afterVerificationStart })
  assert.equal(beforeSchedule.isIncomplete, false)
  assert.equal(complete.isIncomplete, false)
  assert.equal(complete.lastSuccessfulAt, '2026-09-21T09:18:00+01:00')
})

test('an in-progress verification with a fresh heartbeat is busy, online, and not an error', () => {
  const health = attendanceAgentHealth({ status: { last_seen_at: '2026-09-21T10:29:30+01:00', last_attendance_sync_at: '2026-09-21T10:15:00+01:00', last_error: 'Final morning verification is incomplete.' }, verification: { latestAttempt: { status: 'running', started_at: '2026-09-21T10:26:00+01:00' } }, now: Date.parse('2026-09-21T10:30:00+01:00') })
  assert.deepEqual(health, { state: 'busy', online: true, processingRecent: false, verificationInProgress: true, verificationStuck: false })
})

test('completed failure is error, old heartbeat is offline, and old running attempt is stuck', () => {
  const now = Date.parse('2026-09-21T10:30:00+01:00')
  const failed = attendanceAgentHealth({ status: { last_seen_at: '2026-09-21T10:29:30+01:00', last_attendance_sync_at: '2026-09-21T10:29:00+01:00' }, verification: { latestAttempt: { status: 'failed', started_at: '2026-09-21T10:20:00+01:00' } }, now })
  const offline = attendanceAgentHealth({ status: { last_seen_at: '2026-09-21T10:26:59+01:00', last_attendance_sync_at: '2026-09-21T10:29:00+01:00' }, verification: { latestAttempt: { status: 'complete' } }, now })
  const stuck = attendanceAgentHealth({ status: { last_seen_at: '2026-09-21T10:30:00+01:00', last_attendance_sync_at: '2026-09-21T10:29:00+01:00' }, verification: { latestAttempt: { status: 'running', started_at: '2026-09-21T10:19:59+01:00' } }, now })
  assert.equal(failed.state, 'error')
  assert.equal(offline.state, 'offline')
  assert.equal(stuck.state, 'warning')
  assert.equal(stuck.verificationStuck, true)
})
