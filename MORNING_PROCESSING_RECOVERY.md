# Morning processing orphan recovery

Processing-state bookkeeping only; attendance and report eligibility rules are unchanged.

## Ownership and liveness
New operations record process execution UUID, host, PID and Windows process creation FILETIME.
A daemon refreshes active operation heartbeats every 30 seconds, including while work waits on
a device lock. The in-process active registry and registration/finish use the same lock.
Terminal outcomes are retried after network failures; failed work never becomes successful.

A heartbeat older than two minutes only makes a row a candidate. Recovery additionally needs
a trusted service-role observation of one of:
- the owner process exited (or the PID now has a different process creation token);
- the exact originating execution confirms the operation is no longer in its active registry.
Unreachable hosts, access denied, live processes with old heartbeats and unknown ownership
fail closed. One host never attests another host's process state.

Recovery also requires a genuinely completed, later operation with identical operation name,
date range and identity-dependency flag. Without that retry, the old row keeps blocking.
This is intentional: process death alone cannot certify that unfinished writes were replayed.
The same rule handles missing terminal acknowledgements after process death without a timer
ever fabricating success. The next matching successful cycle permits canonical recovery.

## Audit and legacy records
Recovered rows remain under their original ID/start time, become failed, and are linked via
resolved_by to the actual successful retry. stale_detected_at, resolution_reason and
resolution_evidence preserve the previous status, error, heartbeat, observed process identity,
replacement ID and completion time. Existing barrier logic already excludes resolved failures;
there is no attendance-rule or readiness-gate bypass.

Legacy rows have no PID/owner identity, so automatic recovery never guesses ownership. The
service-only agent_recover_morning_processing RPC has an explicit legacy_terminal_failure
path requiring log-based terminal-failure attestation, original start/failure times, terminal
write error, an actual later same-scope retry, and current full cutoff verification. It is
idempotent and cannot resolve incomplete coverage, changed versions, or unresolved verification.

## Verification
Run:
- Python unittest modules test_morning_processing_lifecycle and test_morning_report_completion
- Existing attendance verification and agent tests
- supabase/tests/morning_processing_orphan_recovery.sql (transactional fixtures, rollback)
- npm run lint and npm run build

The SQL fixtures verify the real unchanged gate, audit history, process evidence, fresh
heartbeats, same-scope retries, historical scoping and persisted FINAL snapshot creation.
They do not modify attendance, biometric events, worker data, mappings, reviews or payroll.

## 2026-10-23 production rollout
Applied migration: 20261023133001_morning_processing_orphan_recovery.
Recovered job: 685a3593-924d-4c9e-90de-1f1ef31e586c through agent_recover_morning_processing.
Original start: 10:20:08.762980 Africa/Kinshasa; actual failure: 10:22:08.954.
The stored legacy log attestation records both the ReadTimeout and failed DNS terminal write.
Recovered status: failed, resolution_reason=stale_orphaned_processing_record.
Actual successful retry: 2b6ec3a4-115f-4492-b818-fc6121cb629c (completed 14:31:38.761915 Kinshasa).
No record was deleted or falsely marked successful.

The normal agent_finalize_morning_report gate persisted FINAL at 14:32:08.921017 Kinshasa,
using verification run a54d10d9-9c48-4062-a785-a35202f70082. Snapshot source:
morning_verification_complete; 42 frozen workers; cutoff 11:00 Kinshasa.
The report payload returned reportAvailable=true, finalized=true and state=FINAL.
Pending relevant jobs were zero after recovery. All attendance and early-review row fingerprints
were asserted unchanged inside the locked recovery/finalization transaction.
The two existing needs_review events were not changed.

Verification: 200 Python tests, 15 relevant Node tests, rollback-only SQL lifecycle/finalization
assertions, lint (pre-existing warnings), and production build passed.
An additional unrelated pre-existing test_early_morning_review.test.mjs cannot load its missing
src/utils/earlyMorningReview.js dependency; neither file was changed in this task.
Both scheduled tasks were restarted while no processing or verification jobs were active:
attendance agent PID 19416 -> 24400; face helper PID 18356 -> 41096.
