-- Separate approved evidence, never physical device events or attendance.
create table public.worker_sunday_evidence_override (
 worker_id uuid not null references public.workers(id),work_date date not null,
 approved_first_punch timestamptz,approved_last_punch timestamptz,approved_overtime_minutes integer,
 raw_source_fingerprint text not null,raw_work_fingerprint text not null,
 updated_by uuid not null references public.admins(id),updated_at timestamptz not null default now(),
 version integer not null default 1,history jsonb not null default '[]',
 primary key(worker_id,work_date),check(extract(isodow from work_date)=7),
 check(approved_overtime_minutes between 0 and 1440),check(version>0),check(jsonb_typeof(history)='array'),
 check(approved_first_punch is null or approved_last_punch>approved_first_punch)
);
alter table public.worker_sunday_evidence_override enable row level security;
revoke all on public.worker_sunday_evidence_override from public,anon,authenticated;
grant select on public.worker_sunday_evidence_override to authenticated;
create policy sunday_evidence_admin_read on public.worker_sunday_evidence_override for select to authenticated
 using((select public.is_admin()) and exists(select 1 from public.admins a where a.id=(select auth.uid()) and a.is_active));

-- Preserve the exact current canonical raw resolvers, including device mapping,
-- protected attendance, schedule, rate and payroll-lock rules.
do $$ declare d text;begin
 d:=pg_get_functiondef('private.sunday_work_evidence(uuid,date)'::regprocedure);
 execute replace(d,'FUNCTION private.sunday_work_evidence(', 'FUNCTION private.sunday_work_evidence_raw(');
 d:=pg_get_functiondef('private.sunday_hourly_sources(date)'::regprocedure);
 execute replace(d,'FUNCTION private.sunday_hourly_sources(', 'FUNCTION private.sunday_hourly_sources_raw(');
end $$;
revoke all on function private.sunday_work_evidence_raw(uuid,date),private.sunday_hourly_sources_raw(date) from public,anon,authenticated,service_role;

create or replace function private.sunday_work_evidence(p_worker uuid,p_date date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare raw jsonb:=private.sunday_work_evidence_raw(p_worker,p_date);o public.worker_sunday_evidence_override;
 first_local timestamp;last_local timestamp;cfg jsonb:=raw->'sunday_settings';eligible boolean;
begin
 select * into o from public.worker_sunday_evidence_override where worker_id=p_worker and work_date=p_date;
 if o.worker_id is null or o.approved_first_punch is null or o.raw_work_fingerprint<>md5(raw::text) then return raw;end if;
 first_local:=o.approved_first_punch at time zone 'Africa/Kinshasa';last_local:=o.approved_last_punch at time zone 'Africa/Kinshasa';
 -- Explicit protected manual attendance always remains authoritative.
 eligible:=case when (raw->>'manual')::boolean then (raw->>'eligible')::boolean else
  (cfg->>'enabled')::boolean and first_local between p_date+time '06:30' and p_date+(cfg->>'checkin_cutoff')::time
  and last_local>=p_date+(cfg->>'checkout_threshold')::time end;
 return raw||jsonb_build_object('raw_first_punch',raw->'first_punch','raw_last_punch',raw->'last_punch',
  'approved_first_punch',o.approved_first_punch,'approved_last_punch',o.approved_last_punch,'admin_evidence_override',true,
  'eligible',eligible,'morning',to_char(first_local,'HH24:MI:SS'),'checkout',to_char(last_local,'HH24:MI:SS'),
  'display_check_in',to_char(first_local,'HH24:MI:SS'),'display_check_out',to_char(last_local,'HH24:MI:SS'));
end $$;

create or replace function private.sunday_hourly_sources(p_date date) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(s.value||jsonb_build_object('approved_evidence',to_jsonb(o)-'history',
  'evidence',(s.value->'evidence')||case when o.worker_id is null then '{}'::jsonb else jsonb_build_object('approved_evidence',to_jsonb(o)-'history') end,
  'approved_evidence_valid',o.raw_source_fingerprint=s.value->>'source_fingerprint',
  'suggested_approved_minutes',case when o.raw_source_fingerprint=s.value->>'source_fingerprint' and o.approved_last_punch is not null
    then coalesce(o.approved_overtime_minutes,case when extract(epoch from(o.approved_last_punch-((p_date+(s.value->'sunday_settings'->>'overtime_start')::time) at time zone 'Africa/Kinshasa')))>1800
      then floor(extract(epoch from(o.approved_last_punch-((p_date+(s.value->'sunday_settings'->>'overtime_start')::time) at time zone 'Africa/Kinshasa')))/60)::integer else 0 end)
    else (s.value->>'raw_minutes')::integer end,
  'source_fingerprint',case when o.worker_id is null then s.value->>'source_fingerprint' else md5((s.value->>'source_fingerprint')||':'||o.version::text) end) order by s.value->'worker'->>'full_name'),'[]')
 from jsonb_array_elements(private.sunday_hourly_sources_raw(p_date)) s(value)
 left join public.worker_sunday_evidence_override o on o.worker_id=(s.value->'worker'->>'id')::uuid and o.work_date=p_date;
$$;

create function public.admin_save_sunday_evidence(p_worker uuid,p_date date,p_first timestamptz,p_last timestamptz,
 p_minutes integer,p_reset boolean,p_note text,p_expected_version integer,p_source_fingerprint text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();s jsonb;raw jsonb;old public.worker_sunday_evidence_override;next_version integer;
 pay public.worker_sunday_payment;components jsonb;e jsonb;audit jsonb;raw_source jsonb;
begin
 if actor is null or not public.is_admin() or not exists(select 1 from public.admins where id=actor and is_active) then raise exception 'Active admin required' using errcode='42501';end if;
 if p_date is null or extract(isodow from p_date)<>7 or p_date>(now() at time zone 'Africa/Kinshasa')::date
   or p_reset is null or p_note is null or length(p_note)>1000 then raise exception 'Invalid Sunday evidence';end if;
 lock table public.payroll_run in share mode;
 perform pg_advisory_xact_lock(hashtextextended(p_worker::text||':'||p_date::text||':biometric_ot',0));
 perform pg_advisory_xact_lock(hashtextextended('automatic_sunday_base:'||p_date::text,0));
 select value into s from jsonb_array_elements(private.sunday_hourly_sources(p_date)) where value->'worker'->>'id'=p_worker::text;
 if s is null then raise exception 'No canonical Sunday overtime evidence';end if;
 if (s->>'locked')::boolean then raise exception 'Payroll locked';end if;
 if p_source_fingerprint is distinct from s->>'source_fingerprint' then raise exception 'Biometric evidence changed; reload';end if;
 select * into old from public.worker_sunday_evidence_override where worker_id=p_worker and work_date=p_date for update;
 if p_expected_version is distinct from coalesce(old.version,0) then raise exception 'Evidence override changed; reload';end if;
 select * into pay from public.worker_sunday_payment where worker_id=p_worker and work_date=p_date for update;
 if pay.worker_id is not null and (pay.payment_status<>'unpaid' or pay.settled_payroll_run_id is not null) then raise exception 'Sunday payroll already reserved or paid';end if;
 if not p_reset and(p_first is null or p_last is null or p_first>=p_last
   or p_first<(p_date+time '06:30') at time zone 'Africa/Kinshasa'
   or p_last>((p_date+1)+time '02:00') at time zone 'Africa/Kinshasa'
   or p_minutes is null or p_minutes not between 0 and 1440) then raise exception 'Invalid approved Sunday times/minutes';end if;
 raw:=private.sunday_work_evidence_raw(p_worker,p_date);
 select value into raw_source from jsonb_array_elements(private.sunday_hourly_sources_raw(p_date)) where value->'worker'->>'id'=p_worker::text;
 next_version:=coalesce(old.version,0)+1;
 audit:=jsonb_build_object('worker_id',p_worker,'work_date',p_date,'raw_first_punch',s->'evidence'->'first_at',
  'raw_last_punch',s->'evidence'->'last_at','raw_overtime_minutes',s->'raw_minutes',
  'previous_approved_first_punch',old.approved_first_punch,'new_approved_first_punch',case when p_reset then null else p_first end,
  'previous_approved_last_punch',old.approved_last_punch,'new_approved_last_punch',case when p_reset then null else p_last end,
  'previous_approved_overtime_minutes',coalesce(old.approved_overtime_minutes,(s->'review'->>'minutes')::integer),
  'new_approved_overtime_minutes',case when p_reset then null else p_minutes end,'previous_override',to_jsonb(old)-'history',
  'previous_review',s->'review','previous_sunday_payment',to_jsonb(pay),'actor',actor,'at',now(),'note',p_note,'reset',p_reset);
 insert into public.worker_sunday_evidence_override(worker_id,work_date,approved_first_punch,approved_last_punch,approved_overtime_minutes,
  raw_source_fingerprint,raw_work_fingerprint,updated_by,version,history)
 values(p_worker,p_date,case when p_reset then null else p_first end,case when p_reset then null else p_last end,
  case when p_reset then null else p_minutes end,raw_source->>'source_fingerprint',md5(raw::text),actor,next_version,coalesce(old.history,'[]')||jsonb_build_array(audit))
 on conflict(worker_id,work_date) do update set approved_first_punch=excluded.approved_first_punch,approved_last_punch=excluded.approved_last_punch,
  approved_overtime_minutes=excluded.approved_overtime_minutes,raw_source_fingerprint=excluded.raw_source_fingerprint,raw_work_fingerprint=excluded.raw_work_fingerprint,
  updated_by=actor,updated_at=now(),version=next_version,history=excluded.history;
 -- Only this explicitly edited OPEN Sunday may be recalculated. No attendance,
 -- physical events, other workers, reserved or finalized snapshots are written.
 e:=private.sunday_work_evidence(p_worker,p_date);components:=private.sunday_pay_components(p_worker,p_date);
 if pay.worker_id is not null then
  if components->>'currency' is distinct from pay.currency_code then raise exception 'Sunday currency changed; review compensation separately';end if;
  if (e->>'eligible')::boolean and components->>'base_amount' is null then raise exception 'Sunday base configuration required';end if;
  update public.worker_sunday_payment set compensation_term_id=(components->>'compensation_term_id')::uuid,rule_set_id=(components->>'rule_set_id')::uuid,
   daily_value=case when (e->>'eligible')::boolean then (components->>'daily_value')::numeric else 0 end,
   multiplier=(components->>'multiplier')::numeric,base_amount=case when (e->>'eligible')::boolean then (components->>'base_amount')::numeric else 0 end,
   transport_amount=case when (e->>'eligible')::boolean then (components->>'transport_amount')::numeric else 0 end,
   amount=case when (e->>'eligible')::boolean then round((components->>'base_amount')::numeric+(components->>'transport_amount')::numeric,2) else 0 end
  where worker_id=p_worker and work_date=p_date;
 end if;
 update public.worker_sunday_evidence_override set history=jsonb_set(history,array[(jsonb_array_length(history)-1)::text],
  (history->-1)||jsonb_build_object('approved_base_eligible',e->'eligible','pay_components',components,
    'new_sunday_payment',(select to_jsonb(p) from public.worker_sunday_payment p where p.worker_id=p_worker and p.work_date=p_date)))
 where worker_id=p_worker and work_date=p_date;
 return jsonb_build_object('worker_id',p_worker,'version',next_version,'requires_review',true);
end $$;
revoke all on function public.admin_save_sunday_evidence(uuid,date,timestamptz,timestamptz,integer,boolean,text,integer,text) from public,anon;
grant execute on function public.admin_save_sunday_evidence(uuid,date,timestamptz,timestamptz,integer,boolean,text,integer,text) to authenticated;
revoke all on function private.sunday_work_evidence(uuid,date),private.sunday_hourly_sources(date) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
