ALTER TABLE public.inspections
  ADD COLUMN IF NOT EXISTS employer_business_name TEXT,
  ADD COLUMN IF NOT EXISTS employer_ruc TEXT,
  ADD COLUMN IF NOT EXISTS employer_address TEXT,
  ADD COLUMN IF NOT EXISTS employer_location TEXT,
  ADD COLUMN IF NOT EXISTS employer_economic_activity TEXT,
  ADD COLUMN IF NOT EXISTS employer_worker_count TEXT;

NOTIFY pgrst, 'reload schema';
