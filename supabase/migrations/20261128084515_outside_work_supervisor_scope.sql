-- Participation is independent of historical decision storage and payroll locks.
-- Never update snapshots, finalized revisions, attendance, or movement evidence.
create or replace function private.supervisor_actionable_review(p_date date, review jsonb)
returns jsonb language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare draft private.supervisor_review_draft%rowtype; workers jsonb; teams jsonb; attendance jsonb; ids uuid[]; excluded uuid[];
begin
 select * into draft from private.supervisor_review_draft where attendance_date=p_date;
 select coalesce(jsonb_agg(w order by ord),'[]'::jsonb) into workers
 from jsonb_array_elements(coalesce(review->'workers','[]')) with ordinality x(w,ord)
 where (draft.status is distinct from 'finalized' or draft.results ? (w->>'id'))
   and cardinality(private.outside_work_evidence_ids((w->>'id')::uuid,p_date))=0;
 select coalesce(array_agg((w->>'id')::uuid),'{}'::uuid[]) into ids from jsonb_array_elements(workers) w;
 select coalesce(array_agg((w->>'id')::uuid),'{}'::uuid[]) into excluded
 from jsonb_array_elements(coalesce(review->'workers','[]')) w
 where cardinality(private.outside_work_evidence_ids((w->>'id')::uuid,p_date))>0;
 select coalesce(jsonb_agg(t),'[]'::jsonb) into teams from jsonb_array_elements(coalesce(review->'teams','[]')) t
 where exists(select 1 from jsonb_array_elements(workers) w where w->>'team_id'=t->>'id');
 select coalesce(jsonb_agg(a),'[]'::jsonb) into attendance from jsonb_array_elements(coalesce(review->'attendance','[]')) a
 where (a->>'worker_id')::uuid=any(ids);
 return review||jsonb_build_object('workers',workers,'teams',teams,'attendance',attendance,'outside_work_excluded_worker_ids',to_jsonb(excluded));
end $$;
revoke all on function private.supervisor_actionable_review(date,jsonb) from public,anon,authenticated;

-- Keep the existing complete conflict resolver for ADMIN review. Supervisor
-- responses contain only conflicts for which a supervisor decision is relevant.
do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('public.admin_supervisor_review_draft(date,text,text,bigint,text,jsonb)'::regprocedure);
 if position('''conflicts'',private.supervisor_review_conflicts(p_date)' in definition)=0 then raise exception 'Unexpected conflict response'; end if;
 definition:=replace(definition,'''conflicts'',private.supervisor_review_conflicts(p_date)',
  $patch$'conflicts',(select coalesce(jsonb_agg(c),'[]'::jsonb) from jsonb_array_elements(private.supervisor_review_conflicts(p_date)) c
    where cardinality(private.outside_work_evidence_ids((c->>'worker_id')::uuid,p_date))=0)$patch$);
 execute definition;
end;
$migration$;
notify pgrst,'reload schema';
