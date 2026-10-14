-- Run as database owner. Test rows roll back; sequence gaps are intentional.
begin;
select set_config('request.jwt.claim.sub', (select id::text from public.admins where is_active limit 1), true);
set local role authenticated;
do $$
declare first_id uuid; second_id uuid; first_code text; second_code text; original_codes jsonb;
begin
  select jsonb_object_agg(id, employee_code) into original_codes from public.workers;
  insert into public.workers(full_name,is_active) values ('__auto_code_test_a__',false)
    returning id,employee_code into first_id,first_code;
  insert into public.workers(full_name,is_active) values ('__auto_code_test_b__',false)
    returning id,employee_code into second_id,second_code;
  if second_code::bigint <> first_code::bigint + 1 then raise exception 'Codes are not sequential'; end if;
  begin
    insert into public.workers(full_name,is_active,employee_code)
      values ('__duplicate_code_test__',false,first_code);
    raise exception 'Duplicate employee code accepted';
  exception when unique_violation then null;
  end;
  if original_codes is distinct from (select jsonb_object_agg(id,employee_code)
    from public.workers where id not in (first_id,second_id)) then
    raise exception 'Existing employee codes changed';
  end if;
end;
$$;
rollback;
