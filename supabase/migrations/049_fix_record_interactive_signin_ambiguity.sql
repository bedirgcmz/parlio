-- ============================================================
-- Migration 049: Fix ambiguous reference in record_interactive_sign_in
--
-- Problem:
--   The RETURNS TABLE output column `interactive_sign_in_count` becomes a
--   PL/pgSQL variable name inside the function body. The previous UPDATE ...
--   RETURNING expression referenced `interactive_sign_in_count` unqualified,
--   which PostgreSQL treated as ambiguous between the output variable and the
--   table column.
--
-- Fix:
--   Qualify the target table with an alias and qualify RETURNING columns.
-- ============================================================

CREATE OR REPLACE FUNCTION public.record_interactive_sign_in(p_install_id text DEFAULT NULL)
RETURNS TABLE (
  interactive_sign_in_count integer,
  show_returning_welcome boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_previous_count integer;
  v_new_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'record_interactive_sign_in requires an authenticated user';
  END IF;

  UPDATE public.profiles AS p
  SET interactive_sign_in_count = COALESCE(p.interactive_sign_in_count, 0) + 1,
      last_interactive_sign_in_at = now(),
      last_interactive_sign_in_install_id = p_install_id
  WHERE p.id = auth.uid()
  RETURNING p.interactive_sign_in_count - 1, p.interactive_sign_in_count
  INTO v_previous_count, v_new_count;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found for authenticated user %', auth.uid();
  END IF;

  interactive_sign_in_count := v_new_count;
  show_returning_welcome := v_previous_count >= 1;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.record_interactive_sign_in(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_interactive_sign_in(text) TO authenticated;
