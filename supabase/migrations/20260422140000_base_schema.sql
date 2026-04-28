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
