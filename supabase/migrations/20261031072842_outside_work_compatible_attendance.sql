-- FINAL movements are independent evidence; agreeing full-day attendance is not a conflict.
-- Keep negative/partial manual decisions and emergency overrides protected, even
-- when old rows have no supervisor metadata. Absence of an audit is not consent.
create or replace function private.outside_work_attendance_conflicts(a public.attendance)
returns boolean language sql immutable
set search_path = public, private, pg_temp
as $$
 select coalesce(
   a.emergency_overtime_mode is not null
   or ((a.manual_override is true or a.attendance_source = 'manual')
       and (a.status is distinct from 'present'
         or coalesce(a.biometric_sync_metadata #>> '{supervisor_morning_review,choice}','') in ('A','M'))),
   false);
$$;
revoke all on function private.outside_work_attendance_conflicts(public.attendance) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION private.overlay_outside_work_attendance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare ids uuid[]; protected boolean;
begin
  if current_setting('app.outside_work_reconcile',true)='on' then return new; end if;
  ids:=private.outside_work_evidence_ids(new.worker_id,new.attendance_date);
  if cardinality(ids)=0 then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.worker_id::text||':'||new.attendance_date::text,0));
  protected:=private.outside_work_attendance_conflicts(new);
  insert into private.outside_work_attendance_evidence(worker_id,attendance_date,baseline,movement_ids,conflict)
    values(new.worker_id,new.attendance_date,to_jsonb(new),ids,protected)
    on conflict(worker_id,attendance_date) do update set
      baseline=case when new.attendance_source<>'outside_work' then to_jsonb(new) else private.outside_work_attendance_evidence.baseline end,
      movement_ids=ids,conflict=protected,updated_at=now();
  if protected then return new; end if;
  new.status:='present'; new.attendance_day_fraction:=1;
  new.attendance_source:='outside_work'; new.note:=coalesce(new.note,'working_outside');
  new.biometric_sync_metadata:=coalesce(new.biometric_sync_metadata,'{}')||jsonb_build_object('outside_work',jsonb_build_object('movement_ids',ids,'reason','working_outside'));
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.reconcile_outside_work_attendance(p_worker uuid, p_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  ids uuid[]; a public.attendance%rowtype; b public.attendance%rowtype;
  e private.outside_work_attendance_evidence%rowtype; previous_flag text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_worker::text||':'||p_date::text,0));
  ids:=private.outside_work_evidence_ids(p_worker,p_date);
  select * into a from public.attendance where worker_id=p_worker and attendance_date=p_date for update;
  select * into e from private.outside_work_attendance_evidence where worker_id=p_worker and attendance_date=p_date for update;
  if cardinality(ids)=0 and e.worker_id is null then return; end if;
  if e.worker_id is null then
    insert into private.outside_work_attendance_evidence(worker_id,attendance_date,baseline,audit)
      values(p_worker,p_date,case when a.id is not null then to_jsonb(a) end,
        jsonb_build_array(jsonb_build_object('at',now(),'action','initial_evidence','previous',case when a.id is not null then to_jsonb(a) end)));
    select * into e from private.outside_work_attendance_evidence where worker_id=p_worker and attendance_date=p_date;
  elsif cardinality(e.movement_ids)=0 and cardinality(ids)>0 then
    update private.outside_work_attendance_evidence set baseline=case when a.id is not null then to_jsonb(a) end
      where worker_id=p_worker and attendance_date=p_date;
    e.baseline:=case when a.id is not null then to_jsonb(a) end;
  end if;
  -- Only incompatible protected decisions block FINAL movement evidence.
  if a.id is not null and private.outside_work_attendance_conflicts(a) then
    update private.outside_work_attendance_evidence set movement_ids=ids,conflict=cardinality(ids)>0,
      baseline=to_jsonb(a),updated_at=now() where worker_id=p_worker and attendance_date=p_date;
    return;
  end if;
  previous_flag:=current_setting('app.outside_work_reconcile',true);
  perform set_config('app.outside_work_reconcile','on',true);
  if cardinality(ids)>0 then
    if a.id is null then
      insert into public.attendance(worker_id,attendance_date,status,attendance_source,manual_override,note,biometric_sync_metadata)
        values(p_worker,p_date,'present','outside_work',false,'working_outside',jsonb_build_object('outside_work',jsonb_build_object('movement_ids',ids,'reason','working_outside')));
    else
      update public.attendance set status='present',attendance_day_fraction=1,
        attendance_source='outside_work',note=coalesce(a.note,'working_outside'),
        biometric_sync_metadata=coalesce(a.biometric_sync_metadata,'{}')||jsonb_build_object('outside_work',jsonb_build_object('movement_ids',ids,'reason','working_outside'))
        where id=a.id;
    end if;
  elsif a.attendance_source='outside_work' then
    if e.baseline is null then
      delete from public.attendance where id=a.id;
    else
      b:=jsonb_populate_record(null::public.attendance,e.baseline);
      update public.attendance set status=b.status,check_in=b.check_in,check_out=b.check_out,
        attendance_source=b.attendance_source,manual_override=b.manual_override,note=b.note,
        biometric_sync_key=b.biometric_sync_key,biometric_sync_metadata=b.biometric_sync_metadata,
        review_approved_check_out_at=b.review_approved_check_out_at,attendance_day_fraction=b.attendance_day_fraction
        where id=a.id;
    end if;
  end if;
  perform set_config('app.outside_work_reconcile',coalesce(previous_flag,''),true);
  update private.outside_work_attendance_evidence set movement_ids=ids,conflict=false,updated_at=now()
    ,audit=audit||case when movement_ids is distinct from ids then jsonb_build_array(jsonb_build_object('at',now(),'action','evidence_changed','previous_movement_ids',movement_ids,'movement_ids',ids)) else '[]'::jsonb end
    where worker_id=p_worker and attendance_date=p_date;
end;
$function$;
