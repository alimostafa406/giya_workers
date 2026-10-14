-- Initialization is protected against concurrent worker inserts. Existing codes are untouched.
lock table public.workers in share row exclusive mode;
create sequence public.worker_employee_code_seq as bigint;
select setval('public.worker_employee_code_seq',
  greatest(coalesce(max(case when employee_code ~ '^[0-9]+$'
    then employee_code::numeric end), 0) + 1, 1)::bigint, false)
from public.workers;
revoke all on sequence public.worker_employee_code_seq from public, anon, authenticated;

create function public.assign_worker_employee_code()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.employee_code is null or btrim(new.employee_code) = '' then
    loop
      new.employee_code := nextval('public.worker_employee_code_seq'::regclass)::text;
      exit when not exists (select 1 from public.workers w where w.employee_code = new.employee_code);
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function public.assign_worker_employee_code() from public, anon, authenticated;
create trigger workers_assign_employee_code before insert on public.workers
  for each row execute function public.assign_worker_employee_code();
comment on sequence public.worker_employee_code_seq is
  'Internal worker codes only; unrelated to biometric device identity. Gaps are allowed.';
notify pgrst, 'reload schema';
