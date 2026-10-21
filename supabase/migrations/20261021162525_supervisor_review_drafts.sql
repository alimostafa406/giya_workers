-- Applied production version 20261021162525.
-- Drafts never write attendance. One date/snapshot with worker-ID keyed choices.
create table private.supervisor_review_draft (
  attendance_date date primary key references private.supervisor_review_daily_snapshot(attendance_date) on delete restrict,
  snapshot_token text not null, official_token text not null,
  results jsonb not null check(jsonb_typeof(results)='object'),
  revision bigint not null check(revision>0),
  status text not null check(status in ('draft','finalized')),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null references public.admins(id) on delete restrict,
  finalized_at timestamptz
);
alter table private.supervisor_review_draft enable row level security;
revoke all on private.supervisor_review_draft from public,anon,authenticated;

create function private.supervisor_official_decision_token(p_date date,p_ids uuid[]) returns text
language sql stable security definer set search_path=public,private,pg_temp as $$
  select md5(coalesce(jsonb_agg(jsonb_build_array(worker_id,biometric_sync_metadata->'supervisor_morning_review') order by worker_id)::text,'[]'))
  from public.attendance where attendance_date=p_date and worker_id=any(p_ids)
    and manual_override is true and biometric_sync_metadata->'supervisor_morning_review'->>'source'='supervisor_sheet';
$$;
revoke all on function private.supervisor_official_decision_token(date,uuid[]) from public,anon,authenticated;

create function public.admin_supervisor_review_draft(p_date date,p_action text default 'load',
  p_snapshot_token text default null,p_revision bigint default null,p_official_token text default null,p_results jsonb default null)
returns jsonb language plpgsql volatile security definer set search_path=public,private,auth,pg_temp as $$
declare review jsonb; ids uuid[]; token text; official text; draft private.supervisor_review_draft%rowtype;
  response jsonb; applied jsonb; current_revision bigint;
begin
  if auth.uid() is null or not public.is_admin() or not exists(select 1 from public.admins where id=auth.uid() and is_active is true) then
    raise exception 'Active admin access required' using errcode='42501';
  end if;
  if p_action not in ('load','save','submit') or p_action is null then raise exception 'Invalid draft action' using errcode='22023'; end if;
  -- Same ordering as the shared finalizer. Two admins cannot silently overwrite
  -- a newer draft or submit different choices for the same revision.
  perform pg_advisory_xact_lock(hashtextextended('supervisor_review_final:'||p_date::text,0));
  perform pg_advisory_xact_lock(hashtextextended('supervisor_review_draft:'||p_date::text,0));
  if p_action<>'load' then lock table public.payroll_run in share mode; end if;
  review:=private.final_supervisor_review(p_date,false);
  if coalesce((review->>'available')::boolean,false) is not true or coalesce((review->>'exact_population')::boolean,false) is not true then
    raise exception 'An authoritative finalized review population is required' using errcode='23514';
  end if;
  select coalesce(array_agg((w->>'id')::uuid order by w->>'id'),'{}'::uuid[]) into ids from jsonb_array_elements(review->'workers') w;
  token:=md5(jsonb_build_array(p_date,review->'version',review->'finalized_at',to_jsonb(ids))::text);
  official:=private.supervisor_official_decision_token(p_date,ids);
  select * into draft from private.supervisor_review_draft where attendance_date=p_date for update;
  current_revision:=coalesce(draft.revision,0);
  if p_action<>'load' then
    if coalesce((review->>'read_only')::boolean,true) then raise exception 'Review is read-only for finalized/paid payroll' using errcode='23514'; end if;
    if p_snapshot_token is distinct from token or p_revision is distinct from current_revision or p_official_token is distinct from official then
      raise exception 'Review population, decisions or draft changed; reload the latest review before saving' using errcode='40001';
    end if;
  end if;
  if p_action='save' then
    if cardinality(ids) not between 1 and 500 or p_results is null or jsonb_typeof(p_results)<>'object' then
      raise exception 'Invalid draft decisions' using errcode='22023';
    end if;
    if (select count(*) from jsonb_each(p_results))<>cardinality(ids) or exists(select 1 from jsonb_each(p_results) e where e.key<>all(ids::text[])) then
      raise exception 'Review population changed; reload before saving' using errcode='40001';
    end if;
    if exists(select 1 from jsonb_each_text(p_results) e where e.value not in ('A','P','O','M') or e.value is null) then
      raise exception 'Exactly one A/P/O/M choice is required for each finalized population worker' using errcode='22023';
    end if;
    insert into private.supervisor_review_draft(attendance_date,snapshot_token,official_token,results,revision,status,updated_by)
      values(p_date,token,official,p_results,1,'draft',auth.uid())
      on conflict(attendance_date) do update set snapshot_token=excluded.snapshot_token,official_token=excluded.official_token,
        results=excluded.results,revision=private.supervisor_review_draft.revision+1,status='draft',updated_at=clock_timestamp(),updated_by=auth.uid(),finalized_at=null
      returning * into draft;
  elsif p_action='submit' then
    if draft.attendance_date is null or draft.snapshot_token is distinct from token or draft.official_token is distinct from official then
      raise exception 'Save the current review draft before final submission' using errcode='40001';
    end if;
    if draft.status='draft' then
      -- Existing protected writer: same A/P/O/M meanings, manual protection,
      -- real-time preservation and payroll locks. Any exception rolls back ALL
      -- attendance updates and leaves the separately committed draft intact.
      applied:=public.admin_save_supervisor_morning_review(p_date,ids,draft.results);
      official:=private.supervisor_official_decision_token(p_date,ids);
      update private.supervisor_review_draft set status='finalized',revision=revision+1,
        official_token=official,updated_at=clock_timestamp(),updated_by=auth.uid(),finalized_at=clock_timestamp()
        where attendance_date=p_date returning * into draft;
    end if;
  end if;
  response:=jsonb_build_object('date',p_date,'snapshot_token',token,'official_token',official,
    'revision',coalesce(draft.revision,0),'status',coalesce(draft.status,'unsaved'),
    'results',coalesce(draft.results,'{}'::jsonb),'updated_at',draft.updated_at,'updated_by',draft.updated_by,
    'finalized_at',draft.finalized_at,'read_only',review->'read_only',
    'snapshot_changed',draft.attendance_date is not null and draft.snapshot_token is distinct from token);
  return response||jsonb_build_object('applied',applied);
end $$;
revoke all on function public.admin_supervisor_review_draft(date,text,text,bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.admin_supervisor_review_draft(date,text,text,bigint,text,jsonb) to authenticated;
notify pgrst,'reload schema';
