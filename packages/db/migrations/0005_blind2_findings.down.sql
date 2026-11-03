CREATE OR REPLACE FUNCTION app.time_entries_before() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public AS $$
DECLARE
  g record;
  me uuid := app.person_id();
  window_days numeric := app.setting_int('contemporaneous_days');
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.grant_id IS NOT NULL AND app.period_closed(OLD.grant_id, OLD.work_date) THEN
    RAISE EXCEPTION 'the cost period % of this entry is closed', to_char(OLD.work_date, 'YYYY-MM')
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  IF TG_OP = 'UPDATE' AND NEW.person_id <> OLD.person_id THEN
    RAISE EXCEPTION 'an entry cannot move to another person' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.person_id IS DISTINCT FROM me THEN
    -- Someone else (a grant lead) may decide on a submitted entry and change nothing else; a return
    -- carries the lead's reason on the entry itself, so the person sees why.
    IF (NEW.work_date, NEW.work_package_id, NEW.activity, NEW.hours, NEW.note)
       IS DISTINCT FROM (OLD.work_date, OLD.work_package_id, OLD.activity, OLD.hours, OLD.note) THEN
      RAISE EXCEPTION 'only the person who recorded an entry can change it' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.status = 'returned' AND length(btrim(coalesce(NEW.return_reason, ''))) < 3 THEN
      RAISE EXCEPTION 'returning an entry needs a reason' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> 'returned' THEN NEW.return_reason := NULL; END IF;
    NEW.approved_by := CASE WHEN NEW.status = 'approved' THEN me END;
    NEW.approved_at := CASE WHEN NEW.status = 'approved' THEN now() END;
    RETURN NEW;
  END IF;

  -- The owner's own changes. The trigger stamps an approval whoever makes it; row security decides who may.
  -- The lead's reason stays until the entry is decided again; the owner cannot write or erase it.
  NEW.return_reason := CASE WHEN TG_OP = 'UPDATE' THEN OLD.return_reason END;
  NEW.approved_by := CASE WHEN NEW.status = 'approved' THEN me END;
  NEW.approved_at := CASE WHEN NEW.status = 'approved' THEN now() END;
  IF NEW.work_date > current_date THEN
    RAISE EXCEPTION 'hours cannot be recorded for a future date' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.work_package_id IS NULL THEN
    NEW.grant_id := NULL;
  ELSE
    SELECT gr.id, gr.starts_on, gr.ends_on INTO g
      FROM public.work_packages wp JOIN public.grants gr ON gr.id = wp.grant_id WHERE wp.id = NEW.work_package_id;
    NEW.grant_id := g.id;
    IF NEW.work_date NOT BETWEEN g.starts_on AND g.ends_on THEN
      RAISE EXCEPTION 'the date is outside the grant''s duration' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.grant_members WHERE grant_id = g.id AND person_id = NEW.person_id) THEN
      RAISE EXCEPTION 'hours can only be booked to a grant the person works on' USING ERRCODE = 'check_violation';
    END IF;
    IF app.period_closed(g.id, NEW.work_date) THEN
      RAISE EXCEPTION 'the cost period % is closed', to_char(NEW.work_date, 'YYYY-MM')
        USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' OR (NEW.work_date, NEW.work_package_id, NEW.hours)
       IS DISTINCT FROM (OLD.work_date, OLD.work_package_id, OLD.hours) THEN
    -- Hours count as recorded when they were last written: an edit long after the day is a late record.
    NEW.recorded_at := now();
    NEW.late := (current_date - NEW.work_date) > window_days;
  END IF;
  -- Serialise writers of the same person and day, so the daily limit holds under concurrency.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.person_id::text || NEW.work_date::text, 0));
  RETURN NEW;
END $$;
