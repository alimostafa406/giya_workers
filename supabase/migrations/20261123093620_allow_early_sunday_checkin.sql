-- Reuse the existing Sunday evidence-window lower bound. Only the arrival
-- lower bound changes; the inclusive 08:20 and 13:30 checkout gates remain.
do $$
declare definition text;
begin
 definition:=pg_get_functiondef('private.sunday_work_evidence(uuid,date)'::regprocedure);
 if position('p_date+time ''08:00''' in definition)=0 then raise exception 'Unexpected Sunday evidence definition';end if;
 definition:=replace(definition,'p_date+time ''08:00''','p_date+time ''06:30''');
 execute definition;
 definition:=pg_get_functiondef('private.accrue_automatic_sunday_base(date)'::regprocedure);
 definition:=replace(definition,'first_0800_0820_checkout_1330','first_0630_0820_checkout_1330');
 execute definition;
end $$;
notify pgrst,'reload schema';
