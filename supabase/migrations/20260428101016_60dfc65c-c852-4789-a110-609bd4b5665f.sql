-- Set search_path on remaining functions
ALTER FUNCTION public.set_request_display_id() SET search_path = public;
ALTER FUNCTION public.touch_updated_at() SET search_path = public;

-- Revoke public execute on internal SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.set_request_display_id() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM anon, authenticated, public;

-- has_role must remain callable by authenticated users (used in RLS policies)
-- but is already SECURITY DEFINER and read-only — safe.

-- Tighten the "Anyone can create a request" insert policy:
-- require name + email and ensure status defaults to 'new'.
DROP POLICY IF EXISTS "Anyone can create a request" ON public.requests;

CREATE POLICY "Anyone can create a request"
  ON public.requests FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    customer_name IS NOT NULL
    AND length(trim(customer_name)) BETWEEN 2 AND 100
    AND customer_email IS NOT NULL
    AND customer_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    AND length(customer_email) <= 255
    AND status = 'new'
  );