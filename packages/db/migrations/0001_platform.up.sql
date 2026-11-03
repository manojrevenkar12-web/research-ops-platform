-- Platform: session helpers for row-level security, settings, people, audit and the outbox.
CREATE SCHEMA app;

-- The API sets these per transaction (SET LOCAL), so they can never leak to the next request on a pooled connection.
CREATE FUNCTION app.person_id() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.person_id', true), '')::uuid $$;
CREATE FUNCTION app.roles() RETURNS text[] LANGUAGE sql STABLE AS
  $$ SELECT coalesce(string_to_array(nullif(current_setting('app.roles', true), ''), ','), '{}'::text[]) $$;
CREATE FUNCTION app.has_role(r text) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT r = ANY (app.roles()) $$;
CREATE FUNCTION app.has_any_role(rs text[]) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT app.roles() && rs $$;
CREATE FUNCTION app.entity() RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.entity', true), '') $$;

-- Settings are copied from config/*.yaml by the migration runner; the database never invents a threshold.
CREATE TABLE public.settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);
CREATE FUNCTION app.setting_int(k text) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public AS
  $$ SELECT (value #>> '{}')::numeric FROM public.settings WHERE key = k $$;

CREATE TABLE public.people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entra_oid uuid NOT NULL UNIQUE,
  display_name text NOT NULL,
  email text NOT NULL UNIQUE,
  entity text NOT NULL CHECK (entity IN ('DE', 'US')),
  team text NOT NULL,
  active boolean NOT NULL DEFAULT true
);

-- Append-only: the runtime role may read it (by policy) but never write it directly.
CREATE TABLE public.audit_events (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor uuid,
  table_name text NOT NULL,
  row_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  change jsonb NOT NULL
);

CREATE FUNCTION app.audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public AS $$
DECLARE
  old_j jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  new_j jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  keys text[];
  diff jsonb := '{}'::jsonb;
  k text;
  rid text;
BEGIN
  rid := coalesce(new_j, old_j) ->> coalesce(TG_ARGV[0], 'id');
  IF TG_ARGV[1] IS NOT NULL THEN rid := rid || '/' || (coalesce(new_j, old_j) ->> TG_ARGV[1]); END IF;
  SELECT array_agg(key) INTO keys FROM (
    SELECT key FROM jsonb_each(coalesce(new_j, '{}'::jsonb))
    UNION SELECT key FROM jsonb_each(coalesce(old_j, '{}'::jsonb))) k0
  WHERE coalesce(new_j -> key, 'null') IS DISTINCT FROM coalesce(old_j -> key, 'null') AND key <> 'search';
  IF TG_TABLE_NAME = 'salary_costs' THEN
    -- Pay is confidential: the audit records who changed which fields, not the amounts.
    diff := jsonb_build_object('fields', to_jsonb(coalesce(keys, '{}')));
  ELSE
    FOREACH k IN ARRAY coalesce(keys, '{}') LOOP
      diff := diff || jsonb_build_object(k, jsonb_build_object('old', old_j -> k, 'new', new_j -> k));
    END LOOP;
  END IF;
  INSERT INTO public.audit_events (actor, table_name, row_id, action, change)
  VALUES (app.person_id(), TG_TABLE_NAME, rid, lower(TG_OP), diff);
  RETURN NULL;
END $$;

-- Events are written in the same transaction as the change that causes them and dispatched later.
CREATE TABLE public.outbox (
  id bigserial PRIMARY KEY,
  topic text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz
);
CREATE INDEX outbox_pending ON public.outbox (id) WHERE dispatched_at IS NULL;
