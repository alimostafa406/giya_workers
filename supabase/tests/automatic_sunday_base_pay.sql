-- Uses real November 22 evidence; all accrual checks roll back.
begin;
do $$
declare first_rows jsonb;second_rows jsonb;actor uuid;
begin
 actor:=auth.uid();
 if actor is null then raise exception 'Run with a real authenticated source admin JWT subject';end if;
 first_rows:=public.admin_get_sunday_payroll('2026-11-22')->'payments';
 second_rows:=public.admin_get_sunday_payroll('2026-11-22')->'payments';
 assert (select count(*)=count(distinct (p->>'worker_id')) from jsonb_array_elements(second_rows)p),'Duplicate Sunday entitlement';
 assert (select jsonb_agg(p order by p->>'id') from jsonb_array_elements(first_rows)p)
   = (select jsonb_agg(p order by p->>'id') from jsonb_array_elements(second_rows)p),'Repeated load changed Sunday ledger';
 assert exists(select 1 from jsonb_array_elements(second_rows)p join public.workers w on w.id=(p->>'worker_id')::uuid
   where w.employee_code='179' and (p->>'daily_value')::numeric=25000 and (p->>'amount')::numeric=50000
   and (p->>'payroll_eligible')::boolean),'NIOKA automatic Sunday base missing';
 assert not exists(select 1 from jsonb_array_elements(second_rows)p where p->>'payment_status'='paid'
   and (p->>'note')::jsonb->>'source'='automatic_sunday_attendance'),'Accrual must not mark cash paid';
end $$;
rollback;
