-- REVIEW ONLY — do not execute automatically.
-- Biometric rows are system-generated and therefore have no human recorder.
-- Existing values and all other attendance constraints/policies remain unchanged.
alter table public.attendance
  alter column recorded_by drop not null;
