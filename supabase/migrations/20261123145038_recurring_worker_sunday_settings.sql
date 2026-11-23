create table public.worker_sunday_settings(
 worker_id uuid primary key references public.workers(id),enabled boolean not null default true,
 checkin_cutoff time not null default '08:20',shift_end time not null default '14:00',
 checkout_threshold time not null default '13:30',pay_multiplier numeric(6,3) not null default 2 check(pay_multiplier>0 and pay_multiplier<=10),
 overtime_start time not null default '14:00',overtime_requires_approval boolean not null default true,note text,
 effective_from date not null,updated_by uuid not null references public.admins(id),updated_at timestamptz not null default now(),
 version integer not null default 1,history jsonb not null default '[]',
 check(checkin_cutoff>='06:30' and checkin_cutoff<checkout_threshold and checkout_threshold<=shift_end and shift_end<=overtime_start and overtime_start<time '24:00'),
 check(extract(isodow from effective_from)=7),check(version>0),check(jsonb_typeof(history)='array'),check(length(note)<=1000)
);
alter table public.worker_sunday_settings enable row level security;
revoke all on public.worker_sunday_settings from public,anon,authenticated;
grant select on public.worker_sunday_settings to authenticated;
create policy sunday_settings_admin_read on public.worker_sunday_settings for select to authenticated
 using((select public.is_admin()) and exists(select 1 from public.admins a where a.id=(select auth.uid()) and a.is_active));

create function private.worker_sunday_settings_for_date(p_worker uuid,p_date date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare current_row public.worker_sunday_settings;selected jsonb;
begin
 select * into current_row from public.worker_sunday_settings where worker_id=p_worker;
 if current_row.worker_id is not null then
  if current_row.effective_from<=p_date then selected:=to_jsonb(current_row)-'history';
  else select h into selected from jsonb_array_elements(current_row.history)h where (h->>'effective_from')::date<=p_date order by (h->>'effective_from')::date desc,(h->>'version')::integer desc limit 1;end if;
 end if;
 return coalesce(selected||jsonb_build_object('custom',true),jsonb_build_object('worker_id',p_worker,'enabled',true,'checkin_cutoff','08:20:00','shift_end','14:00:00','checkout_threshold','13:30:00','pay_multiplier',2,'overtime_start','14:00:00','overtime_requires_approval',true,'note',null,'version',0,'custom',false));
end $$;
revoke all on function private.worker_sunday_settings_for_date(uuid,date) from public,anon,authenticated,service_role;

create function public.admin_get_worker_sunday_settings(p_worker uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare settings jsonb;
begin
 if auth.uid() is null or not public.is_admin() or not exists(select 1 from public.admins where id=auth.uid() and is_active) then raise exception 'Active admin required' using errcode='42501';end if;
 if not exists(select 1 from public.workers where id=p_worker) then raise exception 'Worker not found';end if;
 select to_jsonb(s)-'history' into settings from public.worker_sunday_settings s where worker_id=p_worker;
 return coalesce(settings||jsonb_build_object('custom',true),private.worker_sunday_settings_for_date(p_worker,current_date));
end $$;
create function public.admin_save_worker_sunday_settings(p_worker uuid,p_settings jsonb,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare old public.worker_sunday_settings;saved public.worker_sunday_settings;today date:=(now() at time zone 'Africa/Kinshasa')::date;
begin
 if auth.uid() is null or not public.is_admin() or not exists(select 1 from public.admins where id=auth.uid() and is_active) then raise exception 'Active admin required' using errcode='42501';end if;
 if jsonb_typeof(p_settings) is distinct from 'object' or jsonb_typeof(p_settings->'enabled') is distinct from 'boolean' or jsonb_typeof(p_settings->'overtime_requires_approval') is distinct from 'boolean' then raise exception 'Invalid Sunday settings';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_worker::text||':sunday_settings',0));
 select * into old from public.worker_sunday_settings where worker_id=p_worker for update;
 if p_expected_version is distinct from coalesce(old.version,0) then raise exception 'Sunday settings changed; reload';end if;
 insert into public.worker_sunday_settings(worker_id,enabled,checkin_cutoff,shift_end,checkout_threshold,pay_multiplier,overtime_start,overtime_requires_approval,note,effective_from,updated_by,version,history)
 values(p_worker,(p_settings->>'enabled')::boolean,(p_settings->>'checkin_cutoff')::time,(p_settings->>'shift_end')::time,(p_settings->>'checkout_threshold')::time,
  (p_settings->>'pay_multiplier')::numeric,(p_settings->>'overtime_start')::time,(p_settings->>'overtime_requires_approval')::boolean,nullif(btrim(p_settings->>'note'),''),today+(7-extract(dow from today)::integer),auth.uid(),1,'[]')
 on conflict(worker_id) do update set enabled=excluded.enabled,checkin_cutoff=excluded.checkin_cutoff,shift_end=excluded.shift_end,checkout_threshold=excluded.checkout_threshold,
 pay_multiplier=excluded.pay_multiplier,overtime_start=excluded.overtime_start,overtime_requires_approval=excluded.overtime_requires_approval,note=excluded.note,
 effective_from=excluded.effective_from,updated_by=auth.uid(),updated_at=now(),version=old.version+1,history=old.history||jsonb_build_array(to_jsonb(old)-'history') returning * into saved;
 return (to_jsonb(saved)-'history')||jsonb_build_object('custom',true);
end $$;
revoke all on function public.admin_get_worker_sunday_settings(uuid),public.admin_save_worker_sunday_settings(uuid,jsonb,integer) from public,anon,authenticated;
grant execute on function public.admin_get_worker_sunday_settings(uuid),public.admin_save_worker_sunday_settings(uuid,jsonb,integer) to authenticated;

alter table public.worker_sunday_payment drop constraint worker_sunday_payment_multiplier_check;
alter table public.worker_sunday_payment add constraint worker_sunday_payment_multiplier_check check(multiplier>0 and multiplier<=10);

-- Adapt only canonical Sunday paths. Historical dates resolve their prior
-- settings version, and existing ledger amounts are never rewritten here.
do $$
declare definition text;
begin
 definition:=pg_get_functiondef('private.sunday_work_evidence(uuid,date)'::regprocedure);
 definition:=replace(definition,'declare a public.attendance;', 'declare cfg jsonb:=private.worker_sunday_settings_for_date(p_worker,p_date);a public.attendance;');
 definition:=replace(definition,'p_date+time ''08:20''','p_date+(cfg->>''checkin_cutoff'')::time');
 definition:=replace(definition,'p_date+time ''13:30''','p_date+(cfg->>''checkout_threshold'')::time');
 definition:=replace(definition,'return answer||jsonb_build_object(', 'answer:=answer||jsonb_build_object(''eligible'',eligible and (cfg->>''enabled'')::boolean,''sunday_settings'',cfg);'||chr(10)||' return answer||jsonb_build_object(');
 execute definition;
 definition:=pg_get_functiondef('private.accrue_automatic_sunday_base(date)'::regprocedure);
 definition:=replace(definition,'end,2),2,','end,2),(e.evidence->''sunday_settings''->>''pay_multiplier'')::numeric,');
 definition:=replace(definition,'end,2)*2,2)','end,2)*(e.evidence->''sunday_settings''->>''pay_multiplier'')::numeric,2)');
 execute definition;
 definition:=pg_get_functiondef('private.viewer_confirm_sunday_core(uuid,date,text,uuid,uuid,uuid)'::regprocedure);
 definition:=replace(definition,'v_daily_value * 2','v_daily_value * (private.worker_sunday_settings_for_date(p_worker_id,p_work_date)->>''pay_multiplier'')::numeric');
 definition:=replace(definition,'multiplier = 2,','multiplier = (private.worker_sunday_settings_for_date(p_worker_id,p_work_date)->>''pay_multiplier'')::numeric,');
 definition:=replace(definition,'v_daily_value, 2,','v_daily_value, (private.worker_sunday_settings_for_date(p_worker_id,p_work_date)->>''pay_multiplier'')::numeric,');
 execute definition;
 definition:=pg_get_functiondef('private.sunday_hourly_sources(date)'::regprocedure);
 definition:=replace(definition,'t.name team_name,e.*,','t.name team_name,e.*,settings.cfg sunday_settings,');
 definition:=replace(definition,'left join public.worker_staff_classification sc on sc.worker_id=w.id', 'left join public.worker_staff_classification sc on sc.worker_id=w.id cross join lateral(select private.worker_sunday_settings_for_date(w.id,p_date) cfg)settings');
 definition:=replace(definition,'p_date+time ''14:00''','p_date+(settings.cfg->>''overtime_start'')::time');
 definition:=replace(definition,'''payment_type'',p.payment_type) source','''payment_type'',p.payment_type,''sunday_settings'',settings.cfg) source');
 definition:=replace(definition,'''raw_minutes'',c.minutes,','''sunday_settings'',c.sunday_settings,''raw_minutes'',c.minutes,');
 execute definition;
 definition:=pg_get_functiondef('public.admin_get_sunday_payroll(date)'::regprocedure);
 definition:=replace(definition,'''payroll_compensation_terms'',','''sunday_settings_custom'',exists(select 1 from public.worker_sunday_settings ss where ss.worker_id=w.id),''payroll_compensation_terms'',');
 execute definition;
end $$;
notify pgrst,'reload schema';
