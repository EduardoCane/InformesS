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
