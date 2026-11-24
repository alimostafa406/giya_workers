-- A subsequent manual duration approval may differ from the original evidence
-- suggestion. Record that most recent decision before falling back to a draft.
do $$ declare d text;needle text:='coalesce(old.approved_overtime_minutes,(s->''review''->>''minutes'')::integer)';begin
 d:=pg_get_functiondef('public.admin_save_sunday_evidence(uuid,date,timestamptz,timestamptz,integer,boolean,text,integer,text)'::regprocedure);
 if strpos(d,needle)=0 then raise exception 'Unexpected evidence audit definition';end if;
 execute replace(d,needle,'coalesce((s->''review''->>''minutes'')::integer,old.approved_overtime_minutes)');
end $$;
