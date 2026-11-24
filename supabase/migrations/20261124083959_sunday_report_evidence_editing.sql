-- Broaden only the evidence-edit context, using the SAME date/window, exact
-- identity mapping, staff classification and protected-attendance resolver.
-- Raw OT eligibility remains separate from evidence display/edit eligibility.
do $$ declare d text;begin
 d:=pg_get_functiondef('private.sunday_hourly_sources_raw(date)'::regprocedure);
 d:=replace(d,'FUNCTION private.sunday_hourly_sources_raw(', 'FUNCTION private.sunday_evidence_sources_raw(');
 if strpos(d,'and e.punches>=2')=0 then raise exception 'Unexpected raw Sunday source';end if;
 d:=regexp_replace(d,'and e[.]punches>=2.*>1800','','s');
 d:=replace(d,'''raw_minutes'',c.minutes','''raw_minutes'',greatest(c.minutes,0)');
 execute d;
 d:=pg_get_functiondef('private.sunday_hourly_sources(date)'::regprocedure);
 d:=replace(d,'FUNCTION private.sunday_hourly_sources(', 'FUNCTION private.sunday_evidence_edit_sources(');
 d:=replace(d,'private.sunday_hourly_sources_raw(p_date)','private.sunday_evidence_sources_raw(p_date)');
 execute d;
 d:=pg_get_functiondef('public.admin_save_sunday_evidence(uuid,date,timestamptz,timestamptz,integer,boolean,text,integer,text)'::regprocedure);
 d:=replace(d,'private.sunday_hourly_sources(p_date)','private.sunday_evidence_edit_sources(p_date)');
 d:=replace(d,'private.sunday_hourly_sources_raw(p_date)','private.sunday_evidence_sources_raw(p_date)');
 d:=replace(d,'No canonical Sunday overtime evidence','No canonical Sunday attendance evidence');
 execute d;
 d:=pg_get_functiondef('public.admin_get_sunday_payroll(date)'::regprocedure);
 d:=replace(d,'''date'',p_date,','''date'',p_date,''sundayEvidenceEditSources'',private.sunday_evidence_edit_sources(p_date),');
 execute d;
 -- A manually corrected Sunday can have no qualifying RAW overtime. Accept its
 -- exact raw reference (including zero) only on Sunday; weekday rules stay put.
 d:=pg_get_functiondef('public.admin_decide_biometric_overtime(date,jsonb)'::regprocedure);
 d:=replace(d,'not between 30 and 1440','not between case when extract(isodow from p_date)=7 then 0 else 30 end and 1440');
 execute d;
end $$;
revoke all on function private.sunday_evidence_sources_raw(date),private.sunday_evidence_edit_sources(date) from public,anon,authenticated,service_role;

create or replace function private.sunday_hourly_sources(p_date date) returns jsonb
language sql stable security definer set search_path='' as $$
 with originals as materialized(select value from jsonb_array_elements(private.sunday_hourly_sources_raw(p_date)))
 select coalesce(jsonb_agg(s order by s->'worker'->>'full_name'),'[]')
 from jsonb_array_elements(private.sunday_evidence_edit_sources(p_date)) s
 where exists(select 1 from originals r where r.value->'worker'->>'id'=s->'worker'->>'id')
  or(coalesce((s->>'approved_evidence_valid')::boolean,false)
   and s->'approved_evidence'->>'approved_first_punch' is not null
   and(s->>'suggested_approved_minutes')::integer>0);
$$;
revoke all on function private.sunday_hourly_sources(date) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
