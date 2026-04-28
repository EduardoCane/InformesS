DROP POLICY IF EXISTS "Inspections public delete" ON public.inspections;

CREATE POLICY "Inspections public delete"
ON public.inspections
FOR DELETE
TO authenticated
USING (true);

NOTIFY pgrst, 'reload schema';
