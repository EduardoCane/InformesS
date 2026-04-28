DROP POLICY IF EXISTS "Templates public read" ON public.contract_templates;

CREATE POLICY "Templates public read"
ON public.contract_templates
FOR SELECT
TO authenticated
USING (true);
