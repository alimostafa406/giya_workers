-- Keep the latest already-approved real event when reviewing an earlier one.
-- Do not alter clock fields, raw events or any other review behavior.
do $migration$
declare definition text;
begin
  definition:=pg_get_functiondef('public.resolve_early_morning_biometric_review(uuid,text)'::regprocedure);
  if position('set review_approved_check_out_at = v_event.event_timestamp,' in definition)=0 then
    raise exception 'Previous-day checkout assignment changed; inspect before migration';
  end if;
  execute replace(definition,'set review_approved_check_out_at = v_event.event_timestamp,',
    'set review_approved_check_out_at = greatest(v_attendance.review_approved_check_out_at, v_event.event_timestamp),');
end $migration$;
