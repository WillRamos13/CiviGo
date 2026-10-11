-- CiviGo accesses these tables through its backend connection. The Supabase
-- browser roles must never bypass the API's per-user/district authorization.
DO $$
DECLARE table_name TEXT; api_role TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['User','Session','Verification','Category','IncidentType','Report','Incident','Attachment','Vote','ChatMessage','Notification','Flag','Review','Appeal','Recovery','PointEvent','RankingSettlement','Reward','Redemption','Business','MapAnnouncement','ExternalTrafficModeration','ExternalApiUsage','AdImpression','RouteFavorite','RouteHistory','AuditLog','AppConfig','UsageCounter']
  LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC', table_name);
      FOREACH api_role IN ARRAY ARRAY['anon','authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
          EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I', table_name, api_role);
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END $$;
