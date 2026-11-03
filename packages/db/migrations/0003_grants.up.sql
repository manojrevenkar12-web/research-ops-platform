-- Grant time recording and personnel-cost reporting.
CREATE TABLE public.grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  title text NOT NULL,
  funder text NOT NULL,
  method text NOT NULL CHECK (method IN ('eu_daily', 'de_hourly')),
  entity text NOT NULL CHECK (entity IN ('DE', 'US')),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  funding_rate numeric(5, 4) NOT NULL CHECK (funding_rate > 0 AND funding_rate <= 1),
  indirect_rate numeric(5, 4) NOT NULL CHECK (indirect_rate >= 0 AND indirect_rate <= 2),
  CHECK (ends_on >= starts_on)
);

CREATE TABLE public.work_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id uuid NOT NULL REFERENCES public.grants (id),
  code text NOT NULL,
  title text NOT NULL,
  UNIQUE (grant_id, code)
);

CREATE TABLE public.grant_members (
  grant_id uuid NOT NULL REFERENCES public.grants (id),
  person_id uuid NOT NULL REFERENCES public.people (id),
  role text NOT NULL CHECK (role IN ('lead', 'member')),
  PRIMARY KEY (grant_id, person_id)
);

CREATE TABLE public.time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES public.people (id),
  work_date date NOT NULL,
  work_package_id uuid REFERENCES public.work_packages (id),
  grant_id uuid REFERENCES public.grants (id),
  activity text NOT NULL CHECK (length(activity) BETWEEN 1 AND 500),
  hours numeric(4, 2) NOT NULL CHECK (hours > 0 AND hours <= 24),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'returned')),
  approved_by uuid REFERENCES public.people (id),
  approved_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  late boolean NOT NULL DEFAULT false,
  note text NOT NULL DEFAULT '',
  CHECK ((status = 'approved') = (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE INDEX time_entries_person_day ON public.time_entries (person_id, work_date);
CREATE INDEX time_entries_grant_status ON public.time_entries (grant_id, status, work_date);

CREATE TABLE public.salary_costs (
  person_id uuid NOT NULL REFERENCES public.people (id),
  entity text NOT NULL,
  year integer NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  annual_cost_eur numeric(12, 2) NOT NULL CHECK (annual_cost_eur > 0),
  contract_hours numeric(7, 2) NOT NULL CHECK (contract_hours > 0),
  managing_director boolean NOT NULL DEFAULT false,
  PRIMARY KEY (person_id, year)
);

CREATE TABLE public.cost_periods (
  grant_id uuid NOT NULL REFERENCES public.grants (id),
  period text NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_at timestamptz,
  closed_by uuid REFERENCES public.people (id),
  PRIMARY KEY (grant_id, period)
);

CREATE TABLE public.grant_cost_snapshots (
  grant_id uuid NOT NULL REFERENCES public.grants (id),
  period text NOT NULL,
  direct_eur numeric(14, 2) NOT NULL,
  indirect_eur numeric(14, 2) NOT NULL,
  funded_eur numeric(14, 2) NOT NULL,
  ineligible_hours numeric(9, 2) NOT NULL DEFAULT 0,
  contributors integer NOT NULL CHECK (contributors >= 0),
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (grant_id, period)
);

CREATE FUNCTION app.period_closed(g uuid, d date) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public AS
  $$ SELECT EXISTS (SELECT 1 FROM public.cost_periods WHERE grant_id = g AND period = to_char(d, 'YYYY-MM') AND status = 'closed') $$;

-- Time entries: the rules a funding audit relies on, enforced whoever writes.
CREATE FUNCTION app.time_entries_before() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
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
    -- Someone else (a grant lead) may decide on a submitted entry and change nothing else.
    IF (NEW.work_date, NEW.work_package_id, NEW.activity, NEW.hours, NEW.note)
       IS DISTINCT FROM (OLD.work_date, OLD.work_package_id, OLD.activity, OLD.hours, OLD.note) THEN
      RAISE EXCEPTION 'only the person who recorded an entry can change it' USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.approved_by := CASE WHEN NEW.status = 'approved' THEN me END;
    NEW.approved_at := CASE WHEN NEW.status = 'approved' THEN now() END;
    RETURN NEW;
  END IF;

  -- The owner's own changes. The trigger stamps an approval whoever makes it; row security decides who may.
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
CREATE TRIGGER time_entries_before BEFORE INSERT OR UPDATE OR DELETE ON public.time_entries
  FOR EACH ROW EXECUTE FUNCTION app.time_entries_before();

-- VOLATILE, so that under READ COMMITTED it sees entries another transaction committed while we waited.
CREATE FUNCTION app.time_entries_daily_limit() RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, public AS $$
DECLARE
  total numeric;
  cap numeric := app.setting_int('max_hours_per_day');
BEGIN
  SELECT coalesce(sum(hours), 0) INTO total FROM public.time_entries
   WHERE person_id = NEW.person_id AND work_date = NEW.work_date;
  IF total > cap THEN
    RAISE EXCEPTION 'more than % hours on %', cap, NEW.work_date USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER time_entries_daily_limit AFTER INSERT OR UPDATE OF hours, work_date ON public.time_entries
  FOR EACH ROW EXECUTE FUNCTION app.time_entries_daily_limit();

CREATE FUNCTION app.salary_costs_entity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public AS $$
BEGIN
  -- The entity is the person's employer when the record is made; a later transfer does not move old costs.
  IF TG_OP = 'INSERT' THEN
    SELECT entity INTO NEW.entity FROM public.people WHERE id = NEW.person_id;
  ELSE
    NEW.entity := OLD.entity;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER salary_costs_entity BEFORE INSERT OR UPDATE ON public.salary_costs
  FOR EACH ROW EXECUTE FUNCTION app.salary_costs_entity();

CREATE FUNCTION app.cost_periods_final() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'closed' THEN
    RAISE EXCEPTION 'a closed cost period is final; corrections land in the next period'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF NEW.status = 'closed' THEN NEW.closed_at := now(); NEW.closed_by := app.person_id(); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cost_periods_final BEFORE UPDATE ON public.cost_periods
  FOR EACH ROW EXECUTE FUNCTION app.cost_periods_final();

CREATE FUNCTION app.snapshots_frozen() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.cost_periods WHERE grant_id = NEW.grant_id AND period = NEW.period AND status = 'closed') THEN
    RAISE EXCEPTION 'the snapshot of a closed period cannot change' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  NEW.computed_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER snapshots_frozen BEFORE INSERT OR UPDATE ON public.grant_cost_snapshots
  FOR EACH ROW EXECUTE FUNCTION app.snapshots_frozen();

CREATE TRIGGER time_entries_audit AFTER INSERT OR UPDATE OR DELETE ON public.time_entries
  FOR EACH ROW EXECUTE FUNCTION app.audit();
CREATE TRIGGER salary_costs_audit AFTER INSERT OR UPDATE ON public.salary_costs
  FOR EACH ROW EXECUTE FUNCTION app.audit('person_id', 'year');
CREATE TRIGGER cost_periods_audit AFTER INSERT OR UPDATE ON public.cost_periods
  FOR EACH ROW EXECUTE FUNCTION app.audit('grant_id', 'period');
CREATE TRIGGER grant_cost_snapshots_audit AFTER INSERT OR UPDATE ON public.grant_cost_snapshots
  FOR EACH ROW EXECUTE FUNCTION app.audit('grant_id', 'period');
