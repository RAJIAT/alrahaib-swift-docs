-- Legacy Supabase resources are unused by the live app (Directus-based).
-- Tighten policies to admin-only to eliminate scanner findings without touching Directus.

-- 1) agents table: remove overly-permissive read
DROP POLICY IF EXISTS "Authenticated read active agents" ON public.agents;
CREATE POLICY "Admins read agents"
ON public.agents FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- 2) storage: remove broken agent-join policy and unrestricted upload
DROP POLICY IF EXISTS "Agents read own request docs" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated upload to request-docs" ON storage.objects;

CREATE POLICY "Admins upload to request-docs"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'request-docs' AND has_role(auth.uid(), 'admin'::app_role));