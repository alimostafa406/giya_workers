-- Keep the immutable population as evidence; expose only actionable workers.
create function private.supervisor_actionable_review(p_date date, review jsonb)
returns jsonb language plpgsql stable security definer
set search_path=public,private,pg_temp as $$
declare draft private.supervisor_review_draft%rowtype; workers jsonb; teams jsonb; attendance jsonb;
 ids uuid[]; excluded uuid[]; has_draft boolean;
begin
 select * into draft from private.supervisor_review_draft where attendance_date=p_date;
 has_draft:=found;
 -- Paid/finalized payroll and pre-draft completed historical sheets retain their view.
 if coalesce((review->>'read_only')::boolean,false) or
   (not has_draft and jsonb_array_length(coalesce(review->'workers','[]'))>0 and not exists(
    select 1 from jsonb_array_elements(review->'workers') w where not exists(
     select 1 from public.attendance a where a.worker_id=(w->>'id')::uuid and a.attendance_date=p_date
      and a.biometric_sync_metadata->'supervisor_morning_review'->>'source'='supervisor_sheet'
      and a.biometric_sync_metadata->'supervisor_morning_review'->>'choice' in ('A','P','O','M')))) then
   return review;
 end if;
 select coalesce(jsonb_agg(w order by ord),'[]'::jsonb) into workers
 from jsonb_array_elements(coalesce(review->'workers','[]')) with ordinality x(w,ord)
 where case when draft.status='finalized' then draft.results ? (w->>'id')
   else cardinality(private.outside_work_evidence_ids((w->>'id')::uuid,p_date))=0 end;
 select coalesce(array_agg((w->>'id')::uuid),'{}'::uuid[]) into ids from jsonb_array_elements(workers) w;
 select coalesce(array_agg((w->>'id')::uuid),'{}'::uuid[]) into excluded
 from jsonb_array_elements(coalesce(review->'workers','[]')) w where (w->>'id')::uuid<>all(ids);
 select coalesce(jsonb_agg(t),'[]'::jsonb) into teams from jsonb_array_elements(coalesce(review->'teams','[]')) t
 where exists(select 1 from jsonb_array_elements(workers) w where w->>'team_id'=t->>'id');
 select coalesce(jsonb_agg(a),'[]'::jsonb) into attendance from jsonb_array_elements(coalesce(review->'attendance','[]')) a
 where (a->>'worker_id')::uuid=any(ids);
 return review||jsonb_build_object('workers',workers,'teams',teams,'attendance',attendance,
   'outside_work_excluded_worker_ids',to_jsonb(excluded));
end $$;
revoke all on function private.supervisor_actionable_review(date,jsonb) from public,anon,authenticated;

-- Amend canonical entrypoints instead of introducing a parallel write workflow.
do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('private.final_supervisor_review(date,boolean)'::regprocedure);
 if position('private.supervisor_actionable_review' in definition)>0 then raise exception 'Already patched'; end if;
 if position('return private.final_supervisor_review_before_completion_gate(p_date,false)' in definition)=0 then raise exception 'Unexpected final review definition'; end if;
 definition:=replace(definition,
  'return private.final_supervisor_review_before_completion_gate(p_date,false)||coalesce(state,''{}''::jsonb);',
  'return private.supervisor_actionable_review(p_date,private.final_supervisor_review_before_completion_gate(p_date,false)||coalesce(state,''{}''::jsonb));');
 execute definition;

 definition:=pg_get_functiondef('public.admin_supervisor_review_draft(date,text,text,bigint,text,jsonb)'::regprocedure);
 definition:=replace(definition, 'review:=private.final_supervisor_review(p_date,false);',
  $patch$-- Serialize movement finalization against the actionable roster/token.
  if p_action<>'load' then lock table public.outside_work_movements,public.outside_work_movement_workers in share mode; end if;
  review:=private.final_supervisor_review(p_date,false);$patch$);
 definition:=replace(definition, 'if p_action=''save'' then',
  $patch$if p_action='save' and draft.status='finalized' then
    raise exception 'Final supervisor decisions are immutable' using errcode='23514';
  end if;
  if p_action='save' then$patch$);
 definition:=replace(definition,'cardinality(ids) not between 1 and 500','cardinality(ids) not between 0 and 500');
 definition:=replace(definition,'applied:=public.admin_save_supervisor_morning_review(p_date,ids,draft.results);',
  $patch$if cardinality(ids)>0 then
        applied:=public.admin_save_supervisor_morning_review(p_date,ids,
          (select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(draft.results) where key=any(ids::text[])));
      else applied:=jsonb_build_object('worker_count',0,'applied',0); end if;$patch$);
 definition:=replace(definition, 'official_token=official,updated_at=clock_timestamp(),updated_by=auth.uid(),finalized_at=clock_timestamp()',
  $patch$official_token=official,results=(select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(draft.results) where key=any(ids::text[])),
        updated_at=clock_timestamp(),updated_by=auth.uid(),finalized_at=clock_timestamp()$patch$);
 definition:=replace(definition, '''results'',coalesce(draft.results,''{}''::jsonb)',
  $patch$'results',case when draft.status='finalized' then coalesce(draft.results,'{}'::jsonb)
      else (select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(coalesce(draft.results,'{}'::jsonb)) where key=any(ids::text[])) end$patch$);
 execute definition;

 definition:=pg_get_functiondef('public.admin_save_supervisor_morning_review(date,uuid[],jsonb)'::regprocedure);
 definition:=replace(definition,'lock table public.payroll_run in share mode;',
  $patch$lock table public.payroll_run in share mode;
  lock table public.outside_work_movements,public.outside_work_movement_workers in share mode;
  if exists(select 1 from private.supervisor_review_draft where attendance_date=p_date and status='finalized') then
    raise exception 'Final supervisor decisions are immutable' using errcode='23514';
  end if;$patch$);
 definition:=replace(definition,'select w.is_active, w.operational_start_date, t.name,',
  $patch$-- A stale client may still send an old choice: never apply it over FINAL Outside Work.
    if cardinality(private.outside_work_evidence_ids(v_worker_id,p_date))>0 then continue; end if;
    select w.is_active, w.operational_start_date, t.name,$patch$);
 execute definition;
end;
$migration$;
notify pgrst,'reload schema';
