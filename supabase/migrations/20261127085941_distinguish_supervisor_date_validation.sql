-- Dates are already Postgres DATE values. Sunday was incorrectly reported with
-- the same error as a future date. Preserve the existing Mon-Sat sheet rule.
do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('private.final_supervisor_review_before_completion_gate(date,boolean)'::regprocedure);
 definition:=replace(definition,E'\r\n',E'\n');
 if position('if p_date is null or p_date>v_today or extract(isodow from p_date)=7 then' in definition)=0 then
   raise exception 'Unexpected supervisor date validation definition';
 end if;
 definition:=replace(definition,
  $old$if p_date is null or p_date>v_today or extract(isodow from p_date)=7 then
    raise exception 'Select a non-future operational workday' using errcode='22023';
  end if;$old$,
  $new$if p_date is null then
    raise exception 'Work date is required' using errcode='22023';
  end if;
  if p_date>v_today then
    raise exception 'Future work dates are not allowed (Africa/Kinshasa)' using errcode='22023';
  end if;
  if extract(isodow from p_date)=7 then
    raise exception 'Supervisor review is Monday-Saturday; use the Sunday payroll workflow for Sunday dates' using errcode='22023';
  end if;$new$);
 if position('Select a non-future operational workday' in definition)>0 then raise exception 'Date validation replacement failed'; end if;
 execute definition;
end;
$migration$;
