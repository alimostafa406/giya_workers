-- Read-only production verification; transaction rolled back.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.admins where is_active limit 1),true);
do $$
declare wid uuid:='d5a3617f-0b81-448c-82af-2e0925380698'; d date:='2026-11-26';
 review jsonb; context jsonb; before_attendance jsonb; before_draft jsonb; before_snapshot jsonb; admin_conflict jsonb;
begin
 select to_jsonb(a) into before_attendance from public.attendance a where worker_id=wid and attendance_date=d;
 select to_jsonb(x) into before_draft from private.supervisor_review_draft x where attendance_date=d;
 select to_jsonb(s) into before_snapshot from private.supervisor_review_daily_snapshot s where attendance_date=d;
 assert before_attendance->>'status'='absent' and before_attendance->>'manual_override'='true';
 assert before_draft->>'status'='finalized' and before_draft->'results'->>wid::text='A';
 assert cardinality(private.outside_work_evidence_ids(wid,d))>0;
 review:=public.admin_get_final_supervisor_review(d,false);
 assert not exists(select 1 from jsonb_array_elements(review->'workers') w where w->>'id'=wid::text),'FINAL outside worker remained in active roster';
 assert review->'outside_work_excluded_worker_ids' ? wid::text;
 context:=public.admin_supervisor_review_draft(d);
 assert not exists(select 1 from jsonb_array_elements(context->'conflicts') c where c->>'worker_id'=wid::text),'Admin conflict exposed to supervisor';
 assert context->>'revision'=before_draft->>'revision' and context->'results'=before_draft->'results','Historical revision rewritten';
 select c into admin_conflict from jsonb_array_elements(private.supervisor_review_conflicts(d)) c where c->>'worker_id'=wid::text;
 assert admin_conflict->>'protected_choice'='A' and admin_conflict->>'conflict_type'='outside_work';
 assert exists(select 1 from public.admin_get_outside_work_attendance_conflicts(d,d) c where c.worker_id=wid),'Admin review lost conflict';
 assert before_attendance=(select to_jsonb(a) from public.attendance a where worker_id=wid and attendance_date=d);
 assert before_draft=(select to_jsonb(x) from private.supervisor_review_draft x where attendance_date=d);
 assert before_snapshot=(select to_jsonb(s) from private.supervisor_review_daily_snapshot s where attendance_date=d);
end $$;
rollback;
