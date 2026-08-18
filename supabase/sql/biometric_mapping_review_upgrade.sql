-- Additive production upgrade for the already-existing biometric_worker_mapping table.
-- Review and execute manually. Do not rerun biometric_worker_mapping.sql.

alter table public.biometric_worker_mapping
  add column if not exists mapping_review_state text;

-- Existing mappings are deliberately not trusted for future attendance until reviewed.
update public.biometric_worker_mapping
set mapping_review_state = 'needs_review'
where mapping_review_state is null
   or mapping_review_state not in ('confirmed', 'needs_review');

alter table public.biometric_worker_mapping
  alter column mapping_review_state set default 'needs_review',
  alter column mapping_review_state set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'biometric_worker_mapping_review_state_valid'
      and conrelid = 'public.biometric_worker_mapping'::regclass
  ) then
    alter table public.biometric_worker_mapping
      add constraint biometric_worker_mapping_review_state_valid
      check (mapping_review_state in ('confirmed', 'needs_review'));
  end if;
end;
$$;

-- Separate operational classification; it does not alter worker/team records.
create table if not exists public.worker_staff_classification (
  worker_id uuid primary key references public.workers(id) on delete restrict,
  classification text not null default 'normal',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint worker_staff_classification_valid
    check (classification in ('normal', 'special_staff'))
);

create or replace function public.set_worker_staff_classification_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists worker_staff_classification_set_updated_at on public.worker_staff_classification;
create trigger worker_staff_classification_set_updated_at
before update on public.worker_staff_classification
for each row
execute function public.set_worker_staff_classification_updated_at();

alter table public.worker_staff_classification enable row level security;

drop policy if exists worker_staff_classification_admin_select on public.worker_staff_classification;
create policy worker_staff_classification_admin_select
on public.worker_staff_classification
for select
to authenticated
using (public.is_admin());

drop policy if exists worker_staff_classification_admin_insert on public.worker_staff_classification;
create policy worker_staff_classification_admin_insert
on public.worker_staff_classification
for insert
to authenticated
with check (public.is_admin());

drop policy if exists worker_staff_classification_admin_update on public.worker_staff_classification;
create policy worker_staff_classification_admin_update
on public.worker_staff_classification
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());
