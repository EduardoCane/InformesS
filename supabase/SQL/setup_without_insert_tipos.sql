-- Setup completo sin InsertTipos.sql
-- Ejecuta InsertTipos.sql aparte solo si necesitas insertar los formatos base.
-- Generado desde las migraciones existentes en orden cronologico.


-- =====================================================
-- .\supabase\migrations\20260422140000_base_schema.sql
-- =====================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_email TEXT;
  normalized_full_name TEXT;
BEGIN
  normalized_email := NULLIF(BTRIM(COALESCE(NEW.email, '')), '');
  normalized_full_name := NULLIF(
    BTRIM(
      COALESCE(
        NEW.raw_user_meta_data ->> 'full_name',
        NEW.raw_user_meta_data ->> 'name',
        ''
      )
    ),
    ''
  );

  INSERT INTO public.users_profile (
    id,
    email,
    full_name,
    role
  )
  VALUES (
    NEW.id,
    COALESCE(normalized_email, NEW.id::TEXT || '@placeholder.local'),
    normalized_full_name,
    'inspector'
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email = COALESCE(normalized_email, users_profile.email),
    full_name = COALESCE(normalized_full_name, users_profile.full_name),
    updated_at = CURRENT_TIMESTAMP;

  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.users_profile (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL UNIQUE,
  full_name VARCHAR(255),
  role VARCHAR(50) NOT NULL DEFAULT 'inspector',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE IF EXISTS public.users_profile
  ADD COLUMN IF NOT EXISTS full_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS role VARCHAR(50) NOT NULL DEFAULT 'inspector',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS public.report_formats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  schema_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT report_formats_schema_json_is_array CHECK (jsonb_typeof(schema_json) = 'array')
);

ALTER TABLE IF EXISTS public.report_formats
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS schema_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'report_formats_schema_json_is_array'
  ) THEN
    ALTER TABLE public.report_formats
      ADD CONSTRAINT report_formats_schema_json_is_array
      CHECK (jsonb_typeof(schema_json) = 'array');
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.contract_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon_name VARCHAR(100) NOT NULL DEFAULT 'security',
  default_format_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT contract_templates_user_name_key UNIQUE (user_id, name),
  CONSTRAINT contract_templates_default_format_id_fkey
    FOREIGN KEY (default_format_id)
    REFERENCES public.report_formats(id)
    ON DELETE SET NULL
);

ALTER TABLE IF EXISTS public.contract_templates
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS icon_name VARCHAR(100) NOT NULL DEFAULT 'security',
  ADD COLUMN IF NOT EXISTS default_format_id UUID,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contract_templates_user_name_key'
  ) THEN
    ALTER TABLE public.contract_templates
      ADD CONSTRAINT contract_templates_user_name_key
      UNIQUE (user_id, name);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contract_templates_default_format_id_fkey'
  ) THEN
    ALTER TABLE public.contract_templates
      ADD CONSTRAINT contract_templates_default_format_id_fkey
      FOREIGN KEY (default_format_id)
      REFERENCES public.report_formats(id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.inspections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contract_type VARCHAR(255),
  template_id UUID REFERENCES public.contract_templates(id) ON DELETE SET NULL,
  format_id UUID REFERENCES public.report_formats(id) ON DELETE SET NULL,
  title VARCHAR(500),
  inspection_date DATE,
  subject VARCHAR(500),
  dynamic_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(50) NOT NULL DEFAULT 'completed',
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT inspections_dynamic_fields_is_object CHECK (jsonb_typeof(dynamic_fields) = 'object'),
  CONSTRAINT inspections_status_check CHECK (status IN ('draft', 'completed', 'archived'))
);

ALTER TABLE IF EXISTS public.inspections
  ADD COLUMN IF NOT EXISTS contract_type VARCHAR(255),
  ADD COLUMN IF NOT EXISTS template_id UUID,
  ADD COLUMN IF NOT EXISTS format_id UUID,
  ADD COLUMN IF NOT EXISTS title VARCHAR(500),
  ADD COLUMN IF NOT EXISTS inspection_date DATE,
  ADD COLUMN IF NOT EXISTS subject VARCHAR(500),
  ADD COLUMN IF NOT EXISTS dynamic_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'inspections_dynamic_fields_is_object'
  ) THEN
    ALTER TABLE public.inspections
      ADD CONSTRAINT inspections_dynamic_fields_is_object
      CHECK (jsonb_typeof(dynamic_fields) = 'object');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'inspections_status_check'
  ) THEN
    ALTER TABLE public.inspections
      ADD CONSTRAINT inspections_status_check
      CHECK (status IN ('draft', 'completed', 'archived'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'inspections_template_id_fkey'
  ) THEN
    ALTER TABLE public.inspections
      ADD CONSTRAINT inspections_template_id_fkey
      FOREIGN KEY (template_id)
      REFERENCES public.contract_templates(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'inspections_format_id_fkey'
  ) THEN
    ALTER TABLE public.inspections
      ADD CONSTRAINT inspections_format_id_fkey
      FOREIGN KEY (format_id)
      REFERENCES public.report_formats(id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id UUID NOT NULL REFERENCES public.inspections(id) ON DELETE CASCADE,
  image_data TEXT,
  image_url VARCHAR(500),
  field_id VARCHAR(255),
  block_index INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT evidence_has_image_check CHECK (
    COALESCE(NULLIF(image_data, ''), NULLIF(image_url, '')) IS NOT NULL
  )
);

ALTER TABLE IF EXISTS public.evidence
  ADD COLUMN IF NOT EXISTS image_data TEXT,
  ADD COLUMN IF NOT EXISTS image_url VARCHAR(500),
  ADD COLUMN IF NOT EXISTS field_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS block_index INTEGER,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'evidence_has_image_check'
  ) THEN
    ALTER TABLE public.evidence
      ADD CONSTRAINT evidence_has_image_check
      CHECK (COALESCE(NULLIF(image_data, ''), NULLIF(image_url, '')) IS NOT NULL);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_users_profile_email ON public.users_profile(email);
CREATE INDEX IF NOT EXISTS idx_contract_templates_user_id ON public.contract_templates(user_id);
CREATE INDEX IF NOT EXISTS idx_inspections_user_id ON public.inspections(user_id);
CREATE INDEX IF NOT EXISTS idx_inspections_status ON public.inspections(status);
CREATE INDEX IF NOT EXISTS idx_inspections_date ON public.inspections(inspection_date DESC);
CREATE INDEX IF NOT EXISTS idx_inspections_template_id ON public.inspections(template_id);
CREATE INDEX IF NOT EXISTS idx_inspections_format_id ON public.inspections(format_id);
CREATE INDEX IF NOT EXISTS idx_inspections_dynamic_fields ON public.inspections USING GIN (dynamic_fields);
CREATE INDEX IF NOT EXISTS idx_report_formats_schema_json ON public.report_formats USING GIN (schema_json);
CREATE INDEX IF NOT EXISTS idx_evidence_inspection_id ON public.evidence(inspection_id);

GRANT USAGE ON SCHEMA public TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;


-- =====================================================
-- .\supabase\migrations\20260422141000_rls_and_triggers.sql
-- =====================================================

ALTER TABLE public.users_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_formats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users own profile" ON public.users_profile;
DROP POLICY IF EXISTS "Formats public read" ON public.report_formats;
DROP POLICY IF EXISTS "Formats create" ON public.report_formats;
DROP POLICY IF EXISTS "Formats update" ON public.report_formats;
DROP POLICY IF EXISTS "Formats delete" ON public.report_formats;
DROP POLICY IF EXISTS "Users own templates" ON public.contract_templates;
DROP POLICY IF EXISTS "Users own inspections" ON public.inspections;
DROP POLICY IF EXISTS "Users own evidence" ON public.evidence;

CREATE POLICY "Users own profile"
ON public.users_profile
FOR ALL
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

CREATE POLICY "Formats public read"
ON public.report_formats
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Formats create"
ON public.report_formats
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Formats update"
ON public.report_formats
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "Formats delete"
ON public.report_formats
FOR DELETE
TO authenticated
USING (true);

CREATE POLICY "Users own templates"
ON public.contract_templates
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users own inspections"
ON public.inspections
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users own evidence"
ON public.evidence
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.inspections AS i
    WHERE i.id = inspection_id
      AND i.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.inspections AS i
    WHERE i.id = inspection_id
      AND i.user_id = auth.uid()
  )
);

INSERT INTO public.users_profile (
  id,
  email,
  full_name,
  role
)
SELECT
  au.id,
  COALESCE(
    NULLIF(BTRIM(au.email), ''),
    au.id::TEXT || '@placeholder.local'
  ) AS email,
  NULLIF(
    BTRIM(
      COALESCE(
        au.raw_user_meta_data ->> 'full_name',
        au.raw_user_meta_data ->> 'name',
        ''
      )
    ),
    ''
  ) AS full_name,
  'inspector' AS role
FROM auth.users AS au
ON CONFLICT (id) DO UPDATE
SET
  email = EXCLUDED.email,
  full_name = COALESCE(EXCLUDED.full_name, public.users_profile.full_name),
  updated_at = CURRENT_TIMESTAMP;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS update_users_profile_updated_at ON public.users_profile;
DROP TRIGGER IF EXISTS update_contract_templates_updated_at ON public.contract_templates;
DROP TRIGGER IF EXISTS update_report_formats_updated_at ON public.report_formats;
DROP TRIGGER IF EXISTS update_inspections_updated_at ON public.inspections;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER update_users_profile_updated_at
BEFORE UPDATE ON public.users_profile
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_contract_templates_updated_at
BEFORE UPDATE ON public.contract_templates
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_report_formats_updated_at
BEFORE UPDATE ON public.report_formats
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_inspections_updated_at
BEFORE UPDATE ON public.inspections
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();


-- =====================================================
-- .\supabase\migrations\20260422142000_dashboard_rpcs.sql
-- =====================================================

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


-- =====================================================
-- .\supabase\migrations\20260428123000_share_contract_templates.sql
-- =====================================================

DROP POLICY IF EXISTS "Templates public read" ON public.contract_templates;

CREATE POLICY "Templates public read"
ON public.contract_templates
FOR SELECT
TO authenticated
USING (true);


-- =====================================================
-- .\supabase\migrations\20260428124500_share_inspection_reads.sql
-- =====================================================

DROP POLICY IF EXISTS "Inspections public read" ON public.inspections;
DROP POLICY IF EXISTS "Evidence public read" ON public.evidence;
DROP POLICY IF EXISTS "Profiles public read" ON public.users_profile;

CREATE POLICY "Inspections public read"
ON public.inspections
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Evidence public read"
ON public.evidence
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.inspections AS i
    WHERE i.id = inspection_id
  )
);

CREATE POLICY "Profiles public read"
ON public.users_profile
FOR SELECT
TO authenticated
USING (true);

NOTIFY pgrst, 'reload schema';


-- =====================================================
-- .\supabase\migrations\20260428130000_share_inspection_deletes.sql
-- =====================================================

DROP POLICY IF EXISTS "Inspections public delete" ON public.inspections;

CREATE POLICY "Inspections public delete"
ON public.inspections
FOR DELETE
TO authenticated
USING (true);

NOTIFY pgrst, 'reload schema';

