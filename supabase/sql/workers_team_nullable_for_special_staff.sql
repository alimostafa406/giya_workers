-- Additive production upgrade: permits explicitly classified Special Staff
-- to exist without assignment to a normal worker team.
-- This does not alter any worker row, team assignment, RLS policy, or data.
-- Do not execute automatically; apply only through the approved Supabase migration process.

alter table public.workers
  alter column team_id drop not null;
