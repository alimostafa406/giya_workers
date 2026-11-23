-- Transport is separate; the Sunday base must still match its frozen wage
-- snapshot and multiplier. Existing historical rows keep base_amount NULL.
alter table public.worker_sunday_payment add constraint worker_sunday_payment_base_snapshot_valid
 check(base_amount is null or base_amount=round(daily_value*multiplier,2));
