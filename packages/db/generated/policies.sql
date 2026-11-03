-- Generated from config/access.yaml by packages/access. Do not edit.

GRANT USAGE ON SCHEMA app TO rop_app;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO rop_app;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rop_app;

-- people
ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE p record; BEGIN FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'people' LOOP EXECUTE format('DROP POLICY %I ON public.people', p.policyname); END LOOP; END $$;
CREATE POLICY people__select__1 ON public.people FOR SELECT TO rop_app USING ((app.has_any_role(ARRAY['Staff']::text[])));
REVOKE ALL ON public.people FROM rop_app;
GRANT SELECT ON public.people TO rop_app;

-- campaigns
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE p record; BEGIN FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'campaigns' LOOP EXECUTE format('DROP POLICY %I ON public.campaigns', p.policyname); END LOOP; END $$;
CREATE POLICY campaigns__select__1 ON public.campaigns FOR SELECT TO rop_app USING ((app.has_any_role(ARRAY['Scientist']::text[])) AND ((campaigns.classification = 'internal' OR app.has_role('RestrictedTechnical'))));
CREATE POLICY campaigns__select__2 ON public.campaigns FOR SELECT TO rop_app USING ((app.has_any_role(ARRAY['Staff']::text[])) AND (campaigns.lead_id = app.person_id()) AND ((campaigns.classification = 'internal' OR app.has_role('RestrictedTechnical'))));
CREATE POLICY campaigns__insert__1 ON public.campaigns FOR INSERT TO rop_app WITH CHECK ((app.has_any_role(ARRAY['Scientist']::text[])) AND (campaigns.lead_id = app.person_id()) AND ((campaigns.classification = 'internal' OR app.has_role('RestrictedTechnical'))));
CREATE POLICY campaigns__update__1 ON public.campaigns FOR UPDATE TO rop_app USING ((app.has_any_role(ARRAY['Scientist']::text[])) AND (campaigns.lead_id = app.person_id()) AND ((campaigns.classification = 'internal' OR app.has_role('RestrictedTechnical')))) WITH CHECK ((app.has_any_role(ARRAY['Scientist']::text[])) AND (campaigns.lead_id = app.person_id()) AND ((campaigns.classification = 'internal' OR app.has_role('RestrictedTechnical'))));
REVOKE ALL ON public.campaigns FROM rop_app;
GRANT SELECT, INSERT, UPDATE ON public.campaigns TO rop_app;

-- campaign_members
ALTER TABLE public.campaign_members ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE p record; BEGIN FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'campaign_members' LOOP EXECUTE format('DROP POLICY %I ON public.campaign_members', p.policyname); END LOOP; END $$;
CREATE POLICY campaign_members__select__1 ON public.campaign_members FOR SELECT TO rop_app USING ((app.has_any_role(ARRAY['Staff']::text[])));
CREATE POLICY campaign_members__insert__1 ON public.campaign_members FOR INSERT TO rop_app WITH CHECK ((app.has_any_role(ARRAY['Scientist']::text[])) AND (EXISTS (SELECT 1 FROM public.campaigns m WHERE m.id = campaign_members.campaign_id AND m.lead_id = app.person_id())));
CREATE POLICY campaign_members__delete__1 ON public.campaign_members FOR DELETE TO rop_app USING ((app.has_any_role(ARRAY['Scientist']::text[])) AND (EXISTS (SELECT 1 FROM public.campaigns m WHERE m.id = campaign_members.campaign_id AND m.lead_id = app.person_id())));
REVOKE ALL ON public.campaign_members FROM rop_app;
GRANT SELECT, INSERT, DELETE ON public.campaign_members TO rop_app;

-- shots
ALTER TABLE public.shots ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE p record; BEGIN FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'shots' LOOP EXECUTE format('DROP POLICY %I ON public.shots', p.policyname); END LOOP; END $$;
CREATE POLICY shots__select__1 ON public.shots FOR SELECT TO rop_app USING ((app.has_any_role(ARRAY['Scientist']::text[])) AND ((shots.classification = 'internal' OR app.has_role('RestrictedTechnical'))));
CREATE POLICY shots__insert__1 ON public.shots FOR INSERT TO rop_app WITH CHECK ((app.has_any_role(ARRAY['Scientist']::text[])) AND (shots.logged_by = app.person_id()) AND ((shots.classification = 'internal' OR app.has_role('RestrictedTechnical'))) AND (EXISTS (SELECT 1 FROM public.campaign_members m WHERE m.campaign_id = shots.campaign_id AND m.person_id = app.person_id() AND m.role = ANY (ARRAY['lead', 'operator']::text[]))));
REVOKE ALL ON public.shots FROM rop_app;
GRANT SELECT, INSERT ON public.shots TO rop_app;

-- targets
ALTER TABLE public.targets ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE p record; BEGIN FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'targets' LOOP EXECUTE format('DROP POLICY %I ON public.targets', p.policyname); END LOOP; END $$;
CREATE POLICY targets__select__1 ON public.targets FOR SELECT TO rop_app USING ((app.has_any_role(ARRAY['Staff']::text[])));
CREATE POLICY targets__insert__1 ON public.targets FOR INSERT TO rop_app WITH CHECK ((app.has_any_role(ARRAY['Scientist']::text[])) AND (targets.status = ANY (ARRAY['fabricated']::text[])));
CREATE POLICY targets__update__1 ON public.targets FOR UPDATE TO rop_app USING ((app.has_any_role(ARRAY['Scientist']::text[])));
REVOKE ALL ON public.targets FROM rop_app;
GRANT SELECT, INSERT, UPDATE ON public.targets TO rop_app;

-- target_events
ALTER TABLE public.target_events ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE p record; BEGIN FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'target_events' LOOP EXECUTE format('DROP POLICY %I ON public.target_events', p.policyname); END LOOP; END $$;
CREATE POLICY target_events__select__1 ON public.target_events FOR SELECT TO rop_app USING ((app.has_any_role(ARRAY['Staff']::text[])));
REVOKE ALL ON public.target_events FROM rop_app;
GRANT SELECT ON public.target_events TO rop_app;

-- grants
ALTER TABLE public.grants ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE p record; BEGIN FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'grants' LOOP EXECUTE format('DROP POLICY %I ON public.grants', p.policyname); END LOOP; END $$;
CREATE POLICY grants__select__1 ON public.grants FOR SELECT TO rop_app USING ((app.has_any_role(ARRAY['Staff']::text[])));
CREATE POLICY grants__insert__1 ON public.grants FOR INSERT TO rop_app WITH CHECK ((app.has_any_role(ARRAY['Finance']::text[])));
CREATE POLICY grants__update__1 ON public.grants FOR UPDATE TO rop_app USING ((app.has_any_role(ARRAY['Finance']::text[])));
REVOKE ALL ON public.grants FROM rop_app;
GRANT SELECT, INSERT, UPDATE ON public.grants TO rop_app;

-- work_packages
ALTER TABLE public.work_packages ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE p record; BEGIN FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'work_packages' LOOP EXECUTE format('DROP POLICY %I ON public.work_packages', p.policyname); END LOOP; END $$;
CREATE POLICY work_packages__select__1 ON public.work_packages FOR SELECT TO rop_app USING ((app.has_any_role(ARRAY['Staff']::text[])));
CREATE POLICY work_packages__insert__1 ON public.work_packages FOR INSERT TO rop_app WITH CHECK ((app.has_any_role(ARRAY['Finance']::text[])));
REVOKE ALL ON public.work_packages FROM rop_app;
GRANT SELECT, INSERT ON public.work_packages TO rop_app;

-- grant_members
ALTER TABLE public.grant_members ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE p record; BEGIN FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'grant_members' LOOP EXECUTE format('DROP POLICY %I ON public.grant_members', p.policyname); END LOOP; END $$;
CREATE POLICY grant_members__select__1 ON public.grant_members FOR SELECT TO rop_app USING ((app.has_any_role(ARRAY['Staff']::text[])));
CREATE POLICY grant_members__insert__1 ON public.grant_members FOR INSERT TO rop_app WITH CHECK ((app.has_any_role(ARRAY['Finance']::text[])));
CREATE POLICY grant_members__delete__1 ON public.grant_members FOR DELETE TO rop_app USING ((app.has_any_role(ARRAY['Finance']::text[])));
REVOKE ALL ON public.grant_members FROM rop_app;
GRANT SELECT, INSERT, DELETE ON public.grant_members TO rop_app;

-- time_entries
ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE p record; BEGIN FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'time_entries' LOOP EXECUTE format('DROP POLICY %I ON public.time_entries', p.policyname); END LOOP; END $$;
CREATE POLICY time_entries__select__1 ON public.time_entries FOR SELECT TO rop_app USING ((app.has_any_role(ARRAY['Staff']::text[])) AND (time_entries.person_id = app.person_id()));
CREATE POLICY time_entries__select__2 ON public.time_entries FOR SELECT TO rop_app USING ((app.has_any_role(ARRAY['Staff']::text[])) AND (EXISTS (SELECT 1 FROM public.grant_members m WHERE m.grant_id = time_entries.grant_id AND m.person_id = app.person_id() AND m.role = ANY (ARRAY['lead']::text[]))));
CREATE POLICY time_entries__select__3 ON public.time_entries FOR SELECT TO rop_app USING ((app.has_any_role(ARRAY['Finance']::text[])));
CREATE POLICY time_entries__insert__1 ON public.time_entries FOR INSERT TO rop_app WITH CHECK ((app.has_any_role(ARRAY['Staff']::text[])) AND (time_entries.person_id = app.person_id()) AND (time_entries.status = ANY (ARRAY['draft', 'submitted']::text[])));
CREATE POLICY time_entries__update__1 ON public.time_entries FOR UPDATE TO rop_app USING ((app.has_any_role(ARRAY['Staff']::text[])) AND (time_entries.person_id = app.person_id()) AND (time_entries.status = ANY (ARRAY['draft', 'returned']::text[]))) WITH CHECK ((app.has_any_role(ARRAY['Staff']::text[])) AND (time_entries.person_id = app.person_id()) AND (time_entries.status = ANY (ARRAY['draft', 'submitted']::text[])));
CREATE POLICY time_entries__update__2 ON public.time_entries FOR UPDATE TO rop_app USING ((app.has_any_role(ARRAY['Staff']::text[])) AND (time_entries.person_id <> app.person_id()) AND (time_entries.status = ANY (ARRAY['submitted']::text[])) AND (EXISTS (SELECT 1 FROM public.grant_members m WHERE m.grant_id = time_entries.grant_id AND m.person_id = app.person_id() AND m.role = ANY (ARRAY['lead']::text[])))) WITH CHECK ((app.has_any_role(ARRAY['Staff']::text[])) AND (time_entries.person_id <> app.person_id()) AND (time_entries.status = ANY (ARRAY['approved', 'returned']::text[])) AND (EXISTS (SELECT 1 FROM public.grant_members m WHERE m.grant_id = time_entries.grant_id AND m.person_id = app.person_id() AND m.role = ANY (ARRAY['lead']::text[]))));
CREATE POLICY time_entries__delete__1 ON public.time_entries FOR DELETE TO rop_app USING ((app.has_any_role(ARRAY['Staff']::text[])) AND (time_entries.person_id = app.person_id()) AND (time_entries.status = ANY (ARRAY['draft']::text[])));
REVOKE ALL ON public.time_entries FROM rop_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.time_entries TO rop_app;

-- salary_costs
ALTER TABLE public.salary_costs ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE p record; BEGIN FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'salary_costs' LOOP EXECUTE format('DROP POLICY %I ON public.salary_costs', p.policyname); END LOOP; END $$;
CREATE POLICY salary_costs__select__1 ON public.salary_costs FOR SELECT TO rop_app USING ((app.has_any_role(ARRAY['PeopleOps']::text[])) AND (salary_costs.entity = app.entity()));
CREATE POLICY salary_costs__select__2 ON public.salary_costs FOR SELECT TO rop_app USING ((app.has_any_role(ARRAY['Finance']::text[])) AND (salary_costs.entity = app.entity()));
CREATE POLICY salary_costs__insert__1 ON public.salary_costs FOR INSERT TO rop_app WITH CHECK ((app.has_any_role(ARRAY['PeopleOps']::text[])) AND (salary_costs.entity = app.entity()));
CREATE POLICY salary_costs__update__1 ON public.salary_costs FOR UPDATE TO rop_app USING ((app.has_any_role(ARRAY['PeopleOps']::text[])) AND (salary_costs.entity = app.entity())) WITH CHECK ((app.has_any_role(ARRAY['PeopleOps']::text[])) AND (salary_costs.entity = app.entity()));
REVOKE ALL ON public.salary_costs FROM rop_app;
GRANT SELECT, INSERT, UPDATE ON public.salary_costs TO rop_app;

-- cost_periods
ALTER TABLE public.cost_periods ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE p record; BEGIN FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cost_periods' LOOP EXECUTE format('DROP POLICY %I ON public.cost_periods', p.policyname); END LOOP; END $$;
CREATE POLICY cost_periods__select__1 ON public.cost_periods FOR SELECT TO rop_app USING ((app.has_any_role(ARRAY['Staff']::text[])));
CREATE POLICY cost_periods__insert__1 ON public.cost_periods FOR INSERT TO rop_app WITH CHECK ((app.has_any_role(ARRAY['Finance']::text[])));
CREATE POLICY cost_periods__update__1 ON public.cost_periods FOR UPDATE TO rop_app USING ((app.has_any_role(ARRAY['Finance']::text[])));
REVOKE ALL ON public.cost_periods FROM rop_app;
GRANT SELECT, INSERT, UPDATE ON public.cost_periods TO rop_app;

-- grant_cost_snapshots
ALTER TABLE public.grant_cost_snapshots ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE p record; BEGIN FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'grant_cost_snapshots' LOOP EXECUTE format('DROP POLICY %I ON public.grant_cost_snapshots', p.policyname); END LOOP; END $$;
CREATE POLICY grant_cost_snapshots__select__1 ON public.grant_cost_snapshots FOR SELECT TO rop_app USING ((app.has_any_role(ARRAY['Finance']::text[])));
CREATE POLICY grant_cost_snapshots__select__2 ON public.grant_cost_snapshots FOR SELECT TO rop_app USING ((app.has_any_role(ARRAY['Executive']::text[])) AND (grant_cost_snapshots.contributors >= app.setting_int('min_group_size')));
CREATE POLICY grant_cost_snapshots__insert__1 ON public.grant_cost_snapshots FOR INSERT TO rop_app WITH CHECK ((app.has_any_role(ARRAY['Finance']::text[])));
CREATE POLICY grant_cost_snapshots__update__1 ON public.grant_cost_snapshots FOR UPDATE TO rop_app USING ((app.has_any_role(ARRAY['Finance']::text[])));
REVOKE ALL ON public.grant_cost_snapshots FROM rop_app;
GRANT SELECT, INSERT, UPDATE ON public.grant_cost_snapshots TO rop_app;

-- audit_events
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE p record; BEGIN FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'audit_events' LOOP EXECUTE format('DROP POLICY %I ON public.audit_events', p.policyname); END LOOP; END $$;
CREATE POLICY audit_events__select__1 ON public.audit_events FOR SELECT TO rop_app USING ((app.has_any_role(ARRAY['Finance']::text[])));
REVOKE ALL ON public.audit_events FROM rop_app;
GRANT SELECT ON public.audit_events TO rop_app;

-- outbox
ALTER TABLE public.outbox ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE p record; BEGIN FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'outbox' LOOP EXECUTE format('DROP POLICY %I ON public.outbox', p.policyname); END LOOP; END $$;
CREATE POLICY outbox__select__1 ON public.outbox FOR SELECT TO rop_app USING ((app.has_any_role(ARRAY['Platform']::text[])));
CREATE POLICY outbox__insert__1 ON public.outbox FOR INSERT TO rop_app WITH CHECK ((app.has_any_role(ARRAY['Staff', 'Platform']::text[])));
CREATE POLICY outbox__update__1 ON public.outbox FOR UPDATE TO rop_app USING ((app.has_any_role(ARRAY['Platform']::text[])));
REVOKE ALL ON public.outbox FROM rop_app;
GRANT SELECT, INSERT, UPDATE ON public.outbox TO rop_app;

-- settings
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE p record; BEGIN FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'settings' LOOP EXECUTE format('DROP POLICY %I ON public.settings', p.policyname); END LOOP; END $$;
CREATE POLICY settings__select__1 ON public.settings FOR SELECT TO rop_app USING ((app.has_any_role(ARRAY['Staff']::text[])));
REVOKE ALL ON public.settings FROM rop_app;
GRANT SELECT ON public.settings TO rop_app;
