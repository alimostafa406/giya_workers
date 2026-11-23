-- Sunday uses first valid arrival before the checkout threshold, not a 09:00 arrival cutoff.
create or replace function private.sunday_work_evidence(p_worker uuid,p_date date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a public.attendance;morning timestamp;checkout timestamp;first_at timestamp;last_at timestamp;punches bigint;
 eligible boolean:=false;reason text;display_in timestamp;display_out timestamp;answer jsonb;
begin
 if extract(isodow from p_date)<>7 then return jsonb_build_object('eligible',false,'reason','ineligible','punch_count',0);end if;
 select * into a from public.attendance where worker_id=p_worker and attendance_date=p_date;
 select count(distinct local_time),min(local_time),max(local_time),
   min(local_time) filter(where local_time>=p_date+time '06:30' and local_time<p_date+time '13:30'),
   max(local_time) filter(where local_time>=p_date+time '13:30')
 into punches,first_at,last_at,morning,checkout
 from(select e.event_timestamp at time zone 'Africa/Kinshasa' local_time from public.biometric_attendance_events e
   where e.worker_id=p_worker and e.attendance_date between p_date and p_date+1
   and e.event_timestamp>=(p_date+time '06:30') at time zone 'Africa/Kinshasa'
   and e.event_timestamp<=((p_date+1)+time '02:00') at time zone 'Africa/Kinshasa'
   and private.confirmed_biometric_identity_worker(e.device_id,e.device_employee_no)=p_worker) valid;
 if a.manual_override then
   eligible:=a.status='present' and coalesce(a.attendance_day_fraction,0)>0 and coalesce(a.biometric_sync_metadata#>>'{supervisor_morning_review,choice}','') not in('A','M');
   answer:=jsonb_build_object('eligible',eligible,'reason',case when eligible then 'manual' else 'protected' end,'manual',true,'morning',a.check_in,'checkout',a.check_out);
 else
   eligible:=punches>=2 and morning is not null and checkout is not null;
   reason:=case when eligible then 'eligible' when morning is null and checkout is null then 'ineligible' when morning is null then 'missing_in' else 'missing_out' end;
   answer:=jsonb_build_object('eligible',eligible,'reason',reason,'manual',false,'morning',to_char(morning,'HH24:MI:SS'),'checkout',to_char(checkout,'HH24:MI:SS'));
 end if;
 -- Never display manual clocks as device punches, or repeat one punch as both ends.
 display_in:=coalesce(morning,case when checkout is null then first_at end);
 display_out:=coalesce(checkout,case when punches>1 and last_at is distinct from display_in then last_at end);
 return answer||jsonb_build_object('punch_count',punches,'first_punch',to_char(first_at,'HH24:MI:SS'),'last_punch',to_char(last_at,'HH24:MI:SS'),
   'display_check_in',to_char(display_in,'HH24:MI:SS'),'display_check_out',to_char(display_out,'HH24:MI:SS'));
end $$;
revoke all on function private.sunday_work_evidence(uuid,date) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
