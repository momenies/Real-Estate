-- ===========================================================================
-- Row Level Security: the database-level half of tenant isolation.
--
-- The API connects as the unprivileged role `aqar_app` and, on every request,
-- sets `app.current_office_id` (and `app.is_super_admin` for the platform
-- owner) on the connection. Every tenant table then filters itself, so an
-- application bug cannot leak one office's inventory to another.
--
-- Migrations and the seed keep running as the database owner, which is not
-- subject to these policies.
-- ===========================================================================

CREATE SCHEMA IF NOT EXISTS app;

-- Current tenant for this connection, NULL when unset.
CREATE OR REPLACE FUNCTION app.current_office_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_office_id', true), '')::uuid;
$$;

-- Only the platform super admin may read across offices.
CREATE OR REPLACE FUNCTION app.is_super_admin() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('app.is_super_admin', true), '')::boolean, false);
$$;

DO $$
DECLARE
  app_role text := 'aqar_app';
  t text;
  -- every tenant-owned table carries an "officeId" column
  tenant_tables text[] := ARRAY[
    'office_settings','users','subscriptions','properties','property_media',
    'leads','conversations','messages','broadcasts','broadcast_recipients',
    'property_deliveries','lead_daily_quotas','external_accounts',
    'external_publications','audit_logs'
  ];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN', app_role);
  END IF;

  EXECUTE format('GRANT USAGE ON SCHEMA public, app TO %I', app_role);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', app_role);
  EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', app_role);
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', app_role);
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I', app_role);

  -- The office row itself is keyed by id rather than office_id.
  EXECUTE 'ALTER TABLE public.offices ENABLE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS office_isolation ON public.offices';
  EXECUTE format($p$
    CREATE POLICY office_isolation ON public.offices TO %I
    USING (app.is_super_admin() OR id = app.current_office_id())
    WITH CHECK (app.is_super_admin() OR id = app.current_office_id())
  $p$, app_role);

  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON public.%I TO %I
      USING (app.is_super_admin() OR "officeId" = app.current_office_id())
      WITH CHECK (app.is_super_admin() OR "officeId" = app.current_office_id())
    $p$, t, app_role);
  END LOOP;

  -- Reached through its parent subscription, which is already scoped.
  EXECUTE 'ALTER TABLE public.subscription_events ENABLE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON public.subscription_events';
  EXECUTE format($p$
    CREATE POLICY tenant_isolation ON public.subscription_events TO %I
    USING (
      app.is_super_admin() OR EXISTS (
        SELECT 1 FROM public.subscriptions s
        WHERE s.id = "subscriptionId" AND s."officeId" = app.current_office_id()
      )
    )
    WITH CHECK (
      app.is_super_admin() OR EXISTS (
        SELECT 1 FROM public.subscriptions s
        WHERE s.id = "subscriptionId" AND s."officeId" = app.current_office_id()
      )
    )
  $p$, app_role);

  -- Platform-level ledger: super admin only, no tenant ever reads it.
  EXECUTE 'ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS super_admin_only ON public.webhook_events';
  EXECUTE format($p$
    CREATE POLICY super_admin_only ON public.webhook_events TO %I
    USING (app.is_super_admin()) WITH CHECK (app.is_super_admin())
  $p$, app_role);
END
$$;
