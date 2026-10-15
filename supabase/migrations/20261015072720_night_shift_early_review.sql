-- A confirmed night identity's early punch is normal attendance evidence, not an anomaly.
-- Existing review records are deliberately not rewritten.
create or replace function public.capture_early_morning_biometric_review()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_local_time time;
  v_local_date date;
begin
  v_local_time := (new.event_timestamp at time zone 'Africa/Kinshasa')::time;
  v_local_date := (new.event_timestamp at time zone 'Africa/Kinshasa')::date;
  if exists (
    select 1 from public.workers w left join public.teams t on t.id=w.team_id
    where w.id=new.worker_id and w.attendance_shift='night'
      and lower(btrim(coalesce(t.name,''))) <> 'chauffeur'
  ) then
    return new;
  end if;
  if v_local_time >= time '01:00:00' and v_local_time < time '06:00:00' then
    insert into public.biometric_early_morning_review (
      event_id,worker_id,event_timestamp,device_id,device_employee_no,event_identity,event_local_date
    ) values (
      new.id,new.worker_id,new.event_timestamp,new.device_id,new.device_employee_no,new.event_identity,v_local_date
    ) on conflict(event_id) do nothing;
  end if;
  return new;
end;
$$;
