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
