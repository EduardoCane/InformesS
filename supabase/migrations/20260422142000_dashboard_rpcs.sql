DROP FUNCTION IF EXISTS public.dashboard_inspections(TEXT, UUID);
DROP FUNCTION IF EXISTS public.dashboard_users();
DROP FUNCTION IF EXISTS public.get_inspections_dashboard(TEXT, UUID);
DROP FUNCTION IF EXISTS public.get_users_for_filter();

CREATE OR REPLACE FUNCTION public.get_inspections_dashboard(
  p_filter TEXT DEFAULT 'mine',
  p_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  contract_type VARCHAR,
  inspection_date DATE,
  subject VARCHAR,
  status VARCHAR,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  creator_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_filter TEXT := LOWER(COALESCE(NULLIF(BTRIM(p_filter), ''), 'mine'));
  v_user_id UUID := auth.uid();
  v_role TEXT := COALESCE(auth.role(), '');
BEGIN
  IF v_role NOT IN ('authenticated', 'service_role') THEN
    RETURN;
  END IF;

  IF v_filter NOT IN ('mine', 'all', 'by_user') THEN
    RAISE EXCEPTION 'Filtro no valido: %', p_filter
      USING ERRCODE = '22023';
  END IF;

  IF v_filter = 'by_user' AND p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id es obligatorio cuando p_filter = by_user'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    i.id,
    i.user_id,
    i.contract_type,
    i.inspection_date,
    i.subject,
    i.status,
    i.created_at,
    i.updated_at,
    COALESCE(
      NULLIF(BTRIM(up.full_name), ''),
      NULLIF(BTRIM(up.email), ''),
      i.user_id::TEXT
    ) AS creator_name
  FROM public.inspections AS i
  LEFT JOIN public.users_profile AS up
    ON up.id = i.user_id
  WHERE i.status <> 'archived'
    AND (
      (v_filter = 'mine' AND v_user_id IS NOT NULL AND i.user_id = v_user_id)
      OR v_filter = 'all'
      OR (v_filter = 'by_user' AND i.user_id = p_user_id)
    )
  ORDER BY i.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_users_for_filter()
RETURNS TABLE (
  id UUID,
  full_name VARCHAR,
  email VARCHAR
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT := COALESCE(auth.role(), '');
BEGIN
  IF v_role NOT IN ('authenticated', 'service_role') THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    up.id,
    up.full_name,
    up.email
  FROM public.users_profile AS up
  WHERE EXISTS (
    SELECT 1
    FROM public.inspections AS i
    WHERE i.user_id = up.id
      AND i.status <> 'archived'
  )
  ORDER BY COALESCE(
    NULLIF(BTRIM(up.full_name), ''),
    NULLIF(BTRIM(up.email), ''),
    up.id::TEXT
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_inspections(
  p_scope TEXT DEFAULT 'mine',
  p_target_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  contract_type VARCHAR,
  inspection_date DATE,
  subject VARCHAR,
  status VARCHAR,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  creator_name TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.get_inspections_dashboard(
    CASE
      WHEN LOWER(COALESCE(NULLIF(BTRIM(p_scope), ''), 'mine')) = 'user' THEN 'by_user'
      ELSE LOWER(COALESCE(NULLIF(BTRIM(p_scope), ''), 'mine'))
    END,
    p_target_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.dashboard_users()
RETURNS TABLE (
  id UUID,
  display_name TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.id,
    COALESCE(
      NULLIF(BTRIM(u.full_name), ''),
      NULLIF(BTRIM(u.email), ''),
      u.id::TEXT
    ) AS display_name
  FROM public.get_users_for_filter() AS u;
$$;

REVOKE ALL ON FUNCTION public.get_inspections_dashboard(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_users_for_filter() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dashboard_inspections(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dashboard_users() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_inspections_dashboard(TEXT, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_users_for_filter() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_inspections(TEXT, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_users() TO authenticated, service_role;

COMMENT ON FUNCTION public.get_inspections_dashboard(TEXT, UUID) IS
  'Devuelve inspecciones del dashboard con filtro mine/all/by_user para usuarios autenticados.';

COMMENT ON FUNCTION public.get_users_for_filter() IS
  'Devuelve usuarios con inspecciones activas para poblar el filtro del dashboard.';

COMMENT ON FUNCTION public.dashboard_inspections(TEXT, UUID) IS
  'Wrapper compatible para dashboards antiguos que usan p_scope mine/all/user.';

COMMENT ON FUNCTION public.dashboard_users() IS
  'Wrapper compatible para dashboards antiguos que esperan display_name.';

NOTIFY pgrst, 'reload schema';
