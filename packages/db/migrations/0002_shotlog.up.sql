-- Shot log and target inventory for laser campaigns.
CREATE TABLE public.campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  title text NOT NULL,
  facility text NOT NULL,
  entity text NOT NULL CHECK (entity IN ('DE', 'US')),
  classification text NOT NULL CHECK (classification IN ('internal', 'restricted')),
  lead_id uuid NOT NULL REFERENCES public.people (id),
  starts_on date NOT NULL,
  ends_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on IS NULL OR ends_on >= starts_on)
);

CREATE TABLE public.campaign_members (
  campaign_id uuid NOT NULL REFERENCES public.campaigns (id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES public.people (id),
  role text NOT NULL CHECK (role IN ('lead', 'operator', 'observer')),
  PRIMARY KEY (campaign_id, person_id)
);

CREATE TABLE public.targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  serial text NOT NULL UNIQUE,
  batch text NOT NULL,
  design text NOT NULL,
  status text NOT NULL CHECK (status IN ('fabricated', 'characterized', 'allocated', 'shot', 'scrapped')),
  campaign_id uuid REFERENCES public.campaigns (id),
  characterization jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'allocated') = (campaign_id IS NOT NULL) OR status = 'shot')
);
CREATE INDEX targets_by_status ON public.targets (status, design);

CREATE TABLE public.target_events (
  id bigserial PRIMARY KEY,
  target_id uuid NOT NULL REFERENCES public.targets (id),
  from_status text,
  to_status text NOT NULL,
  by_person uuid NOT NULL REFERENCES public.people (id),
  at timestamptz NOT NULL DEFAULT now(),
  note text NOT NULL DEFAULT ''
);

CREATE TABLE public.shots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns (id),
  shot_no integer NOT NULL CHECK (shot_no > 0),
  fired_at timestamptz NOT NULL,
  target_id uuid REFERENCES public.targets (id),
  energy_j numeric(10, 2) CHECK (energy_j >= 0),
  pulse_ns numeric(8, 3) CHECK (pulse_ns > 0),
  outcome text NOT NULL CHECK (outcome IN ('nominal', 'partial', 'misfire', 'aborted')),
  notes text NOT NULL DEFAULT '',
  classification text NOT NULL CHECK (classification IN ('internal', 'restricted')),
  logged_by uuid NOT NULL REFERENCES public.people (id),
  logged_at timestamptz NOT NULL DEFAULT now(),
  corrects uuid REFERENCES public.shots (id),
  search tsvector GENERATED ALWAYS AS (to_tsvector('english', notes || ' ' || outcome)) STORED
);
-- One entry per shot number; corrections share the number and point at what they correct.
CREATE UNIQUE INDEX shots_number ON public.shots (campaign_id, shot_no) WHERE corrects IS NULL;
-- A target is destroyed by its shot: it can be shot once.
CREATE UNIQUE INDEX shots_target_once ON public.shots (target_id) WHERE corrects IS NULL AND target_id IS NOT NULL;
CREATE INDEX shots_search ON public.shots USING gin (search);
CREATE INDEX shots_by_campaign ON public.shots (campaign_id, shot_no DESC);

-- Runs as the owner so that it sees the campaign and target whatever the caller may read; row security
-- then decides whether the caller may insert at all.
CREATE FUNCTION app.shots_before_insert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public AS $$
DECLARE
  c record;
  t record;
  orig record;
BEGIN
  SELECT classification INTO c FROM public.campaigns WHERE id = NEW.campaign_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign not found' USING ERRCODE = 'foreign_key_violation'; END IF;
  -- A restricted campaign's shots are restricted too; otherwise the shot would leak what the campaign hides.
  IF c.classification = 'restricted' AND NEW.classification <> 'restricted' THEN
    RAISE EXCEPTION 'shots of a restricted campaign must be restricted' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.corrects IS NOT NULL THEN
    SELECT * INTO orig FROM public.shots WHERE id = NEW.corrects;
    IF NOT FOUND OR orig.campaign_id <> NEW.campaign_id OR orig.shot_no <> NEW.shot_no OR orig.corrects IS NOT NULL THEN
      RAISE EXCEPTION 'a correction must name an original entry of the same campaign and shot number'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.target_id IS DISTINCT FROM orig.target_id THEN
      RAISE EXCEPTION 'a correction cannot change the target' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.target_id IS NOT NULL THEN
    SELECT status, campaign_id INTO t FROM public.targets WHERE id = NEW.target_id;
    IF NOT FOUND OR t.status <> 'allocated' OR t.campaign_id <> NEW.campaign_id THEN
      RAISE EXCEPTION 'the target is not allocated to this campaign' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER shots_before_insert BEFORE INSERT ON public.shots
  FOR EACH ROW EXECUTE FUNCTION app.shots_before_insert();

CREATE FUNCTION app.shots_after_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.corrects IS NULL AND NEW.target_id IS NOT NULL THEN
    UPDATE public.targets SET status = 'shot' WHERE id = NEW.target_id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER shots_after_insert AFTER INSERT ON public.shots
  FOR EACH ROW EXECUTE FUNCTION app.shots_after_insert();

CREATE FUNCTION app.append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: record a correction instead', TG_TABLE_NAME USING ERRCODE = 'object_not_in_prerequisite_state';
END $$;
CREATE TRIGGER shots_append_only BEFORE UPDATE OR DELETE ON public.shots
  FOR EACH ROW EXECUTE FUNCTION app.append_only();
CREATE TRIGGER target_events_append_only BEFORE UPDATE OR DELETE ON public.target_events
  FOR EACH ROW EXECUTE FUNCTION app.append_only();

-- The life of a target: fabricated -> characterized -> allocated -> shot, or scrapped on the way.
CREATE FUNCTION app.targets_lifecycle() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public AS $$
DECLARE
  allowed text[];
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    allowed := CASE OLD.status
      WHEN 'fabricated' THEN ARRAY['characterized', 'scrapped']
      WHEN 'characterized' THEN ARRAY['allocated', 'scrapped']
      WHEN 'allocated' THEN ARRAY['characterized', 'shot', 'scrapped']
      ELSE ARRAY[]::text[] END;
    IF NOT NEW.status = ANY (allowed) THEN
      RAISE EXCEPTION 'a target cannot go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'shot' AND NOT EXISTS (SELECT 1 FROM public.shots WHERE target_id = NEW.id AND corrects IS NULL) THEN
      RAISE EXCEPTION 'a target becomes shot only by logging its shot' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status IN ('characterized', 'scrapped') THEN NEW.campaign_id := NULL; END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('shot', 'scrapped') AND (NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'a % target cannot change', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER targets_lifecycle BEFORE UPDATE ON public.targets
  FOR EACH ROW EXECUTE FUNCTION app.targets_lifecycle();

-- The event log is written by the system, never by a person directly.
CREATE FUNCTION app.targets_log() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.target_events (target_id, from_status, to_status, by_person)
    VALUES (NEW.id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, NEW.status, app.person_id());
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER targets_log AFTER INSERT OR UPDATE ON public.targets
  FOR EACH ROW EXECUTE FUNCTION app.targets_log();

CREATE TRIGGER shots_audit AFTER INSERT ON public.shots FOR EACH ROW EXECUTE FUNCTION app.audit();
CREATE TRIGGER campaigns_audit AFTER INSERT OR UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION app.audit();
