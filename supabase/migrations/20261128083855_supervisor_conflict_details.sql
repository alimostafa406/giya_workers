-- Diagnostics only: reuse canonical semantic compatibility and conflict predicates.
create function private.supervisor_conflict_detail(a public.attendance, choice text, kind text)
returns jsonb language sql stable security definer set search_path=public,private,pg_temp as $$
 select jsonb_build_object('worker_id',a.worker_id,'worker_name',w.full_name,'employee_code',w.employee_code,
  'attendance_date',a.attendance_date,'protected_choice',coalesce(
    (select c from unnest(array['A','M','P','O']) c where private.supervisor_manual_attendance_matches(a,c) limit 1),
    case when a.attendance_source='outside_work' and a.status='present' then 'O' end),
  'supervisor_choice',choice,'conflict_type',kind,'attendance_status',a.status,
  'attendance_source',a.attendance_source,'manual_override',a.manual_override,'check_in',a.check_in,'check_out',a.check_out,
  'outside_work_final',cardinality(private.outside_work_evidence_ids(a.worker_id,a.attendance_date))>0)
 from public.workers w where w.id=a.worker_id;
$$;
revoke all on function private.supervisor_conflict_detail(public.attendance,text,text) from public,anon,authenticated;

create function private.supervisor_review_conflicts(p_date date) returns jsonb
language sql stable security definer set search_path=public,private,pg_temp as $$
 select coalesce(jsonb_agg(private.supervisor_conflict_detail(a, d.results->>a.worker_id::text,
   case when coalesce(e.conflict,false) and cardinality(e.movement_ids)>0 then 'outside_work' else 'manual' end) order by w.full_name,a.worker_id),'[]'::jsonb)
 from public.attendance a join public.workers w on w.id=a.worker_id
 left join private.supervisor_review_draft d on d.attendance_date=a.attendance_date
 left join private.outside_work_attendance_evidence e on e.worker_id=a.worker_id and e.attendance_date=a.attendance_date
 where a.attendance_date=p_date and (
  (coalesce(e.conflict,false) and cardinality(private.outside_work_evidence_ids(a.worker_id,p_date))>0)
  or (d.results->>a.worker_id::text in ('A','P','O','M')
    and a.biometric_sync_metadata->'supervisor_morning_review'->>'source' is distinct from 'supervisor_sheet'
    and (a.manual_override is true or a.attendance_source<>'biometric' or a.emergency_overtime_mode is not null)
    and not private.supervisor_manual_attendance_matches(a,d.results->>a.worker_id::text)));
$$;
revoke all on function private.supervisor_review_conflicts(date) from public,anon,authenticated;

do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('public.admin_supervisor_review_draft(date,text,text,bigint,text,jsonb)'::regprocedure);
 if position('return response||jsonb_build_object(''applied'',applied);' in definition)=0 then raise exception 'Unexpected draft response'; end if;
 definition:=replace(definition,'return response||jsonb_build_object(''applied'',applied);',
   'return response||jsonb_build_object(''applied'',applied,''conflicts'',private.supervisor_review_conflicts(p_date));');
 execute definition;
 definition:=pg_get_functiondef('public.admin_save_supervisor_morning_review(date,uuid[],jsonb)'::regprocedure);
 definition:=replace(definition,E'\r\n',E'\n');
 definition:=replace(definition,
  $old$raise exception 'Worker % has protected manual attendance; review it separately', v_worker_id
        using errcode = '23514';$old$,
  $new$raise exception 'Worker % has protected manual attendance; review it separately', v_worker_id
        using errcode = '23514', detail=private.supervisor_conflict_detail(v_old,v_choice,'manual')::text;$new$);
 definition:=replace(definition,
  $old$raise exception 'Worker % has protected outside-work attendance; review it separately', v_worker_id
        using errcode = '23514';$old$,
  $new$raise exception 'Worker % has protected outside-work attendance; review it separately', v_worker_id
        using errcode = '23514', detail=private.supervisor_conflict_detail(v_old,v_choice,'outside_work')::text;$new$);
 execute definition;
end;
$migration$;
notify pgrst,'reload schema';
