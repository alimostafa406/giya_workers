# Live monitoring report reads (viewer integration)

These reads are independent of `operational_report_publication` and
`weekly_payroll_publication`. They do not replace either frozen-publication
contract. No viewer table grants or mutation methods are added.

Call `get_live_operational_reports(p_session_token, p_date)` through Supabase
RPC with the existing monitoring-session token. `p_date = null` returns the
current Kinshasa Monday–Saturday hub; a date returns that day's report. The
function validates the session before reading data. An invalid, expired, or
revoked session fails with `42501`.

The response has `schema_version: 1`, `publication_required: false`,
`source: "live_canonical"`, `period_start`, `period_end`, and `days`. Each day
contains `date`, `available`, `attendance`, `exceptions`, `overtime`,
`monitoring_counts`, and `counts`. The row arrays contain only display fields:
worker identity/code, team, confirmed biometric ID, canonical times/status,
derived exception status, last real mapped punch, and reportable overtime
minutes. No phone number, raw event, payroll amount, or write capability is
returned. Overtime uses the selected report teams, a 120-minute minimum, and
excludes Chauffeur. An unavailable future/Sunday day has empty arrays.
Today remains unavailable until morning verification completes; this is a
verification safety gate, not a manual publication dependency. Historical days
are read live. The viewer must use the returned rows/counts for display, print,
and export rather than independently classifying workers or overtime.

For the existing normal-worker weekly attendance screen, call
`get_normal_worker_attendance_report(p_date_from, p_date_to, p_session_token)`.
The response retains the requested bounds. Historical days come from the
canonical read payload, and only today's portion comes from today's frozen
morning snapshot. If today is not verified, historical days still return and
`withheldCurrentDay` is true. Future dates have no attendance rows.

The existing `get_normal_worker_attendance(p_attendance_date,p_session_token)`
team-selector flow is unchanged. The public viewer must still be updated on
its own Windows machine to call the new live report RPC; no viewer files are
changed here.

## Current-week payroll limitation

The main Weekly Payroll screen constructs an unsaved current-week preview in
JavaScript from attendance, worker compensation terms, rules, holidays,
adjustments, and Sunday payments. Draft lines can also be recalculated before
display. The existing monitoring RPC `get_published_weekly_payroll` exposes
only finalized/paid, manually published runs. As of 2026-10-01, production has
no saved payroll run for the current 2026-09-28–2026-10-03 week. Reading
`payroll_line` would therefore return no current-week preview and would not
mirror the main screen. No misleading partial payroll RPC is introduced.
Making that preview available requires moving the authoritative calculation
to a shared backend read service or creating a consistent, read-only preview
snapshot; it must not be approximated from stale stored lines.
