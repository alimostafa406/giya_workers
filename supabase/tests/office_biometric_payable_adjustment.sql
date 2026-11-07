-- Production-safe: every approval/audit mutation in this regression rolls back.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.admins where is_active limit 1),true);
do $$
declare source jsonb; e jsonb; saved public.worker_biometric_overtime_review; d date; original integer;
 before_att text; before_events text; before_pay text; actor_id text:=auth.uid()::text;
begin
 select s into strict source from jsonb_array_elements(public.admin_get_biometric_overtime_review(current_date-31,current_date)) s
 where not (s->>'locked')::boolean and s->'worker'->>'is_active'='true'
 and extract(isodow from (s->'attendance'->>'attendance_date')::date) between 1 and 5
 and (s->'attendance'->>'check_out')::time>time '17:30' limit 1;
 d:=(source->'attendance'->>'attendance_date')::date;
 original:=floor(extract(epoch from ((source->'attendance'->>'check_out')::time-time '17:00'))/60)::integer;
 select md5(coalesce(jsonb_agg(to_jsonb(a) order by a.id)::text,'')) into before_att from public.attendance a where attendance_date=d;
 select md5(coalesce(jsonb_agg(to_jsonb(b) order by b.id)::text,'')) into before_events from public.biometric_attendance_events b where event_timestamp>=d::timestamp at time zone 'Africa/Kinshasa' and event_timestamp<(d+1)::timestamp at time zone 'Africa/Kinshasa';
 select md5(coalesce(jsonb_agg(to_jsonb(p) order by p.id)::text,'')) into before_pay from public.payroll_line p;
 e:=jsonb_build_object('worker_id',source->'worker'->>'id','minutes',60,'original_biometric_minutes',original,'note','rollback-only approved duration regression',
 'decision','approved','source_fingerprint',source->>'source_fingerprint','expected_version',coalesce((source->'review'->>'version')::integer,0));
 perform public.admin_decide_biometric_overtime(d,jsonb_build_array(e));
 select * into strict saved from public.worker_biometric_overtime_review where worker_id=(e->>'worker_id')::uuid and attendance_date=d;
 assert saved.minutes=60 and saved.decision='approved' and saved.actor=auth.uid() and saved.actor_viewer_id is null,'Wrong approved value/actor';
 assert (saved.history->-1->>'original_biometric_minutes')::integer=original and saved.history->-1->>'note'=e->>'note','Raw/audit lost';
 begin
   perform public.admin_decide_biometric_overtime(d,jsonb_build_array(e));
   raise exception 'Stale version accepted';
 exception when raise_exception then if sqlerrm<>'Review changed; reload' then raise; end if; end;
 e:=e||jsonb_build_object('expected_version',saved.version,'source_fingerprint','changed');
 begin
   perform public.admin_decide_biometric_overtime(d,jsonb_build_array(e));
   raise exception 'Stale evidence accepted';
 exception when raise_exception then if sqlerrm<>'Biometric evidence changed; reload and review again' then raise; end if; end;
 e:=e||jsonb_build_object('source_fingerprint',source->>'source_fingerprint','decision','rejected','minutes',45);
 perform public.admin_decide_biometric_overtime(d,jsonb_build_array(e));
 assert exists(select 1 from public.worker_biometric_overtime_review where worker_id=(e->>'worker_id')::uuid and attendance_date=d and decision='rejected' and minutes=45),'Reject failed';
 perform set_config('request.jwt.claim.sub','',true);
 begin
   perform public.admin_decide_biometric_overtime(d,jsonb_build_array(e));
   raise exception 'Unauthenticated approval accepted';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub',actor_id,true);
 assert before_att=(select md5(coalesce(jsonb_agg(to_jsonb(a) order by a.id)::text,'')) from public.attendance a where attendance_date=d),'Attendance changed';
 assert before_events=(select md5(coalesce(jsonb_agg(to_jsonb(b) order by b.id)::text,'')) from public.biometric_attendance_events b where event_timestamp>=d::timestamp at time zone 'Africa/Kinshasa' and event_timestamp<(d+1)::timestamp at time zone 'Africa/Kinshasa'),'Biometric events changed';
 assert before_pay=(select md5(coalesce(jsonb_agg(to_jsonb(p) order by p.id)::text,'')) from public.payroll_line p),'Payroll snapshots changed';
end;
$$;
rollback;
select 'office adjustment/audit, stale version/evidence, Auth and no biometric/attendance/payroll mutations: PASS' verification;
