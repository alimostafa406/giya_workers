# Authorized PUATI #143 historical salary correction

Three existing approved Double OT dates: 2026-11-23, 2026-11-25 and 2026-11-26. Historical monthly salary was incorrectly CDF 0; Admin explicitly confirmed CDF 650000 retroactively for these dates. Canonical effective monthly divisor is 26, so each additional full day is CDF 25000.

A locked atomic correction inserted three one-day compensation terms copied from each dated term, changing only salary basis. Original zero salary terms remain intact; current/future compensation is unchanged. Existing approval rows were corrected in place from CDF 0 to CDF 25000 through the same dated source resolver and fingerprint model. Decisions, dates, original approving actors and approval timestamps were retained; versions increased and full before/after correction history was appended with explicit database-maintenance provenance. No new approval or payment was created.

Preflight confirmed no payroll run/line for the selected week. The correction also locks financial tables and rejects reviewed/finalized/paid periods, verifies exactly three approved zero-value sources, and aborts if evidence or eligibility changes beyond the wage fields. Replaying the correction is a no-op after its audit markers exist.

Canonical main weekly payout and team report verified against PUATI production inputs: monthly weekly base 0, regular OT 187 minutes / CDF 10908.33, Double OT 3 days / CDF 75000, transport CDF 20000, net CDF 105908.33. Attendance and biometric-event checksums were unchanged. Temporary production fixture remains untracked; only the migration, regression tests and this audit note are committed.
