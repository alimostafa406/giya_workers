-- Shared canonical checkout, exact-second lower bound and production parity.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.admins where is_active limit 1),true);
do $$
declare a public.attendance;w public.workers;sample record;proof timestamptz;threshold_at timestamptz;d jsonb;r jsonb;item jsonb;match_row jsonb;team uuid;
begin
 a.attendance_date:='2026-11-13';a.attendance_source:='biometric';a.status:='present';a.manual_override:=false;w.attendance_shift:='day';
 threshold_at:=(private.extra_day_end_threshold(a.attendance_date,'00:00:00',30)->>'qualifying_threshold')::timestamptz;
 for sample in select * from(values ('23:29:59'::time,false),('23:30:00',true),('23:45:12',true),('23:59:59',true),('00:00:00',true),('00:31:44',true)) x(clock,expected) loop
   a.check_out:=sample.clock;
   proof:=(a.attendance_date+sample.clock+case when sample.clock<time '06:30' then interval '1 day' else interval '0' end) at time zone 'Africa/Kinshasa';
   a.biometric_sync_metadata:=jsonb_build_object('check_out_event_timestamp',proof);
   assert (private.canonical_overtime_checkout(a,w)>=threshold_at)=sample.expected,'Lower bound/date boundary failed';
 end loop;
 a.check_out:='00:31:44';a.biometric_sync_metadata:='{}';a.review_approved_check_out_at:=null;
 assert private.canonical_overtime_checkout(a,w) is null,'Ambiguous midnight assigned without proof';
 a.biometric_sync_metadata:=jsonb_build_object('check_out_event_timestamp','2026-11-13 00:31:44 Africa/Kinshasa'::timestamptz);
 assert private.canonical_overtime_checkout(a,w) is null,'Previous midnight accepted';
 a.check_out:='02:00:01';a.biometric_sync_metadata:=jsonb_build_object('check_out_event_timestamp','2026-11-14 02:00:01 Africa/Kinshasa'::timestamptz);
 assert private.canonical_overtime_checkout(a,w) is null,'Operational bound broadened';
 select id into strict team from public.teams where name='Peinture Raghibe';
 d:=public.admin_get_biometric_overtime_review('2026-11-13','2026-11-13');
 r:=public.admin_get_extra_day_end_reviews('2026-11-13',team,'00:00:00',30);
 assert jsonb_array_length(r)>0,'No real candidates';
 for item in select value from jsonb_array_elements(d) where value->'worker'->>'team_id'=team::text
   and (value->'attendance'->>'canonical_final_checkout_at')::timestamptz>=threshold_at loop
   select value into strict match_row from jsonb_array_elements(r) where value->>'worker_id'=item->'worker'->>'id';
   assert (match_row->'source'->>'end')::timestamptz=(item->'attendance'->>'canonical_final_checkout_at')::timestamptz,'Daily/Double checkout mismatch';
   assert match_row->'source'->>'qualified'='true','Late canonical checkout excluded';
 end loop;
end $$;
rollback;
select 'PASS: >= exact seconds, next-day proof, bounded canonical window, shared Daily/Double production checkout parity' verification;
