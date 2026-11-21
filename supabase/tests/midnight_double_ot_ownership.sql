-- Read-only synthetic composite inputs: no biometric/attendance rows are inserted.
do $$
declare c record; a public.attendance; w public.workers; final_at timestamptz; qualifies boolean;
begin
 w.attendance_shift:='day';
 for c in select * from (values
   ('23:59:59',0,false),('00:00:00',1,true),('00:05:12',1,true),
   ('00:31:44',1,true),('01:00:00',1,true),('02:00:00',1,true),('02:00:01',1,false)
 ) v(clock,day_offset,expected) loop
   a.attendance_date:='2026-11-20';a.status:='present';a.attendance_source:='biometric';a.manual_override:=false;
   a.check_out:=c.clock::time;
   a.biometric_sync_metadata:=jsonb_build_object('check_out_event_timestamp',((a.attendance_date+c.day_offset)+a.check_out) at time zone 'Africa/Kinshasa');
   final_at:=private.canonical_overtime_checkout(a,w);
   qualifies:=coalesce(final_at>=(a.attendance_date+1)::timestamp at time zone 'Africa/Kinshasa',false);
   if qualifies is distinct from c.expected then raise exception 'Midnight boundary failed: %',c.clock;end if;
 end loop;
end $$;
