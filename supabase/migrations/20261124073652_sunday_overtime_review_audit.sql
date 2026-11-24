-- Enrich the existing canonical decision history; no new approval system or
-- change to authorization, evidence/version checks, locks, or payable logic.
do $migration$
declare definition text; needle text := '''evidence'',source->''evidence'');';
begin
 definition:=pg_get_functiondef('private.decide_sunday_hourly(date,jsonb,uuid,uuid,text)'::regprocedure);
 if strpos(definition,needle)=0 then raise exception 'Unexpected Sunday review definition';end if;
 definition:=replace(definition,needle,$replacement$'evidence',source->'evidence',
   'worker_id',entry->>'worker_id','work_date',p_date,
   'raw_overtime_minutes',(source->>'raw_minutes')::integer,
   'approved_overtime_minutes',minutes,
   'normal_hourly_rate',source->'normal_hourly_rate',
   'sunday_multiplier',coalesce((source->'sunday_settings'->>'overtime_multiplier')::numeric,1),
   'effective_sunday_ot_rate',source->'hourly_rate',
   'approved_amount',case when entry->>'decision'='approved' then round(minutes::numeric*(source->>'hourly_rate')::numeric/60,2) else 0 end,
   'currency',source->'currency','created_at',coalesce(old.decided_at,now()),'updated_at',now());$replacement$);
 execute definition;
end $migration$;
