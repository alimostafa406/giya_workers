# Work date validation

The reported error originated in private.final_supervisor_review_before_completion_gate. PostgreSQL already received a typed ISO DATE; there was no DD/MM string comparison in that path. The same condition rejected null dates, future dates and every Sunday under a single misleading message. November 22, 2026 is Sunday, not a future day.

The migration splits required-date, future-date and Sunday-policy errors. It keeps the existing Monday-Saturday supervisor rule and existing Sunday payroll workflow. No attendance/payroll/snapshot rules are broadened.

The supervisor frontend and RPC adapter now use validated calendar-date normalization. DD/MM/YYYY maps exactly to YYYY-MM-DD; impossible dates are rejected, and future selection compares numeric calendar keys against the Africa/Kinshasa day. Selected dates are never parsed as midnight instants. Existing UI localization remains presentation only.

Regression checks on operational date 2026-11-27: November 22 is accepted as non-future, Sunday payroll reads it successfully; supervisor review returns its explicit Sunday restriction. November 23 and 27 pass supervisor date validation. November 28 returns the distinct future-date error. Production workflow checks ran in a rollback-only transaction; no production data was changed.
