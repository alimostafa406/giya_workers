import assert from 'node:assert/strict'
import test from 'node:test'
import { morningVerificationDiagnostics } from './src/utils/morningVerificationDiagnostics.js'

const afterVerificationStart = new Date('2026-09-21T09:30:00+01:00')

test('reports every stored device failure instead of the generic incomplete message', () => {
  const diagnostics = morningVerificationDiagnostics({
    verification: {
      latestAttempt: {
        status: 'incomplete',
        started_at: '2026-09-21T09:15:00+01:00',
        unresolved_worker_count: 7,
        device_failure_summary: {
          failures: [{
            reason: 'device_query_incomplete',
            queries: [{ device_id: 'office-secondary', state: 'partial', error: 'read timeout' }],
          }],
        },
      },
      lastSuccessfulAttempt: { status: 'complete', completed_at: '2026-09-20T09:20:00+01:00' },
    },
    now: afterVerificationStart,
  })

  assert.equal(diagnostics.isIncomplete, true)
  assert.match(diagnostics.reasons[0], /office-secondary/)
  assert.match(diagnostics.reasons[0], /read timeout/)
  assert.equal(diagnostics.unresolvedWorkers, 7)
  assert.equal(diagnostics.lastSuccessfulAt, '2026-09-20T09:20:00+01:00')
})

test('reports the actual unresolved mapping and application failure reasons', () => {
  const diagnostics = morningVerificationDiagnostics({
    verification: {
      latestAttempt: {
        status: 'incomplete',
        device_failure_summary: {
          failures: [
            { reason: 'no_safe_confirmed_mapping' },
            { reason: 'attendance_apply_failed' },
            { reason: 'unknown_biometric_participation' },
            { reason: 'verification_state_changed' },
          ],
        },
      },
    },
    now: afterVerificationStart,
  })

  assert.equal(diagnostics.reasons.length, 4)
  assert.match(diagnostics.reasons.join(' '), /ربط بصمة/)
  assert.match(diagnostics.reasons.join(' '), /سجل الحضور/)
  assert.match(diagnostics.reasons.join(' '), /غير مرتبطة/)
  assert.match(diagnostics.reasons.join(' '), /تغيرت حالة الحضور/)
})

test('reports a database or RPC failure recorded by the agent', () => {
  const diagnostics = morningVerificationDiagnostics({
    verification: { latestAttempt: { status: 'failed', device_failure_summary: { error: 'RuntimeError: RPC unavailable' } } },
    now: afterVerificationStart,
  })

  assert.equal(diagnostics.isIncomplete, true)
  assert.match(diagnostics.reasons.join(' '), /RPC unavailable/)
})

test('reports that final verification has not run after its scheduled start', () => {
  const diagnostics = morningVerificationDiagnostics({ verification: { latestAttempt: null, lastSuccessfulAttempt: null }, now: afterVerificationStart })

  assert.equal(diagnostics.isIncomplete, true)
  assert.match(diagnostics.reasons[0], /لم تُنفذ/)
})

test('does not warn before the final morning verification schedule and recognizes a complete run', () => {
  const beforeSchedule = morningVerificationDiagnostics({ verification: { latestAttempt: null }, now: new Date('2026-09-21T09:00:00+01:00') })
  const complete = morningVerificationDiagnostics({
    verification: { latestAttempt: { status: 'complete', completed_at: '2026-09-21T09:18:00+01:00' }, lastSuccessfulAttempt: { status: 'complete', completed_at: '2026-09-21T09:18:00+01:00' } },
    now: afterVerificationStart,
  })

  assert.equal(beforeSchedule.isIncomplete, false)
  assert.equal(complete.isIncomplete, false)
  assert.equal(complete.lastSuccessfulAt, '2026-09-21T09:18:00+01:00')
})
