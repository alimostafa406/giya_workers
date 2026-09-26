# Independent report publication, version 1

Main-app admin route: `/reports/publication`.

Storage: `operational_report_publication`, unique Monday `period_start`, Saturday
`period_end`, versioned frozen `days`. No client table grants; RLS enabled.
No payroll publication state or attendance data is written.

Admin RPCs (authenticated active admin only):

- `get_current_report_publication_admin()` — status.
- `get_current_report_publication_source_admin()` — consistent canonical source
  and revision for the existing main-app `dailyReportData` builder.
- `publish_current_report_publication_admin(p_source_revision text, p_days jsonb)`
  — rejects changed sources, validates roster/scope/team settings, strips arbitrary
  fields, derives counts, replaces this week's snapshot and increments version.
- `stop_current_report_publication_admin()` — hides this week's snapshot.

The publisher uses existing JS classification/overtime helpers, not new formulas.
Published data does not update automatically: use Update published snapshot.
Current-day rows require the latest morning verification to be complete. Future
days are never published. Earlier days remain available. Availability expires
on the next Monday; Sunday retains the preceding Monday–Saturday scope.

## Future public viewer integration

Call Supabase RPC `get_published_operational_reports` with:

```json
{"p_session_token":"<existing valid monitoring session token>","p_date":null,"p_report_type":null}
```

Null date/type returns the reports hub plus all published days. Set `p_date` to
a published date and `p_report_type` to `daily_attendance` or `daily_overtime`
for one report. Unknown types fail; invalid/revoked/expired sessions fail. An
out-of-week date returns unavailable. An unpublished/future/withheld day has no
rows. Use `available_dates` before rendering any counts/exports.

Unpublished:

```json
{"schema_version":1,"published":false,"period_start":"2026-09-21","period_end":"2026-09-26","published_at":null,"publication_id":null,"version":0,"available_report_types":[],"available_dates":[],"days":[]}
```

Published (illustrative; worker identifiers abbreviated):

```json
{"schema_version":1,"published":true,"period_start":"2026-09-21","period_end":"2026-09-26","published_at":"2026-09-26T12:00:00Z","publication_id":"<uuid>","version":1,"available_report_types":["daily_attendance","daily_overtime"],"available_dates":["2026-09-21"],"days":[{"date":"2026-09-21","attendance":[{"worker_id":"<uuid>","worker_name":"Worker","employee_code":"123","biometric_id":"73","team_id":"<uuid>","team_name":"Zarour","status":"present","check_in":"08:00:00","check_out":"23:06:19","last_punch":"23:06:19"}],"overtime":[{"worker_id":"<uuid>","worker_name":"Worker","employee_code":"123","biometric_id":"73","team_id":"<uuid>","team_name":"Zarour","check_in":"08:00:00","check_out":"23:06:19","overtime_minutes":360}],"counts":{"total_workers":1,"present":1,"half_day":0,"absent":0,"not_recorded":0,"overtime_workers":1,"overtime_minutes":360}}]}
```

Display/export/print must use returned snapshot arrays and counts only.
No raw metadata, worker profiles, phone numbers or payroll amounts are exposed.
The second Windows machine must migrate its report pages to this new RPC.
Legacy viewer RPCs are unchanged for compatibility; they are **not** the new
independent report contract. Payroll RPCs and publication controls are unchanged.
