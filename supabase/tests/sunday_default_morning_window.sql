begin;
do $$ declare cfg jsonb;w record;e jsonb;expected boolean;begin
 for w in select id,employee_code from public.workers where employee_code in('30','35','343','340','32','33') loop
  cfg:=private.worker_sunday_settings_for_date(w.id,'2026-11-22');
  assert cfg->>'checkin_start'='08:00:00' and cfg->>'checkin_cutoff'='08:35:00','Default morning window mismatch';
  assert cfg->>'checkout_threshold'='13:30:00','Checkout threshold changed';
  e:=private.sunday_work_evidence(w.id,'2026-11-22');expected:=w.employee_code in('30','35','343','340');
  assert (e->>'eligible')::boolean=expected,'Livraison eligibility mismatch: '||w.employee_code;
 end loop;
 for w in select * from public.worker_sunday_settings loop
  cfg:=private.worker_sunday_settings_for_date(w.worker_id,w.effective_from);
  assert (cfg->>'checkin_cutoff')::time=w.checkin_cutoff,'Custom cutoff lost';
  assert (cfg->>'checkout_threshold')::time=w.checkout_threshold,'Custom checkout lost';
 end loop;
 for w in select * from public.worker_sunday_evidence_override loop
  -- Policy rebasing must not change the approved values or the raw source key.
  if w.raw_work_fingerprint=md5(private.sunday_work_evidence_raw(w.worker_id,w.work_date)::text) and w.approved_first_punch is not null then
   e:=private.sunday_work_evidence(w.worker_id,w.work_date);
   assert (e->>'approved_first_punch')::timestamptz=w.approved_first_punch,'Explicit first-punch override discarded';
   assert (e->>'approved_last_punch')::timestamptz=w.approved_last_punch,'Explicit last-punch override discarded';
  end if;
 end loop;
end $$;
rollback;
