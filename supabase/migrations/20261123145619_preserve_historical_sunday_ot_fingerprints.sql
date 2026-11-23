-- Default historical evidence retains the exact pre-settings fingerprint.
do $$
declare definition text;
begin
 definition:=pg_get_functiondef('private.sunday_hourly_sources(date)'::regprocedure);
 definition:=replace(definition,$old$'payment_type',p.payment_type,'sunday_settings',settings.cfg) source$old$,
  $new$'payment_type',p.payment_type)||case when (settings.cfg->>'custom')::boolean then jsonb_build_object('sunday_settings',settings.cfg) else '{}'::jsonb end source$new$);
 execute definition;
end $$;
