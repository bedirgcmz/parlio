-- ============================================================
-- Migration 050: Limit returning welcome to the same trusted install
--
-- Goal:
--   Avoid showing "welcome back / remembered" UX immediately after a fresh
--   install, reinstall, or new-device sign-in. In those cases the user just
--   entered credentials, so implying the local app remembered them can feel
--   surprising.
--
-- Rule:
--   Show the returning welcome only when this is not the first interactive
--   sign-in AND the previous interactive sign-in came from the same install id.
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
  v_previous_install_id text;
  v_new_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'record_interactive_sign_in requires an authenticated user';
  END IF;

  SELECT COALESCE(p.interactive_sign_in_count, 0), p.last_interactive_sign_in_install_id
  INTO v_previous_count, v_previous_install_id
  FROM public.profiles AS p
  WHERE p.id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found for authenticated user %', auth.uid();
  END IF;

  v_new_count := v_previous_count + 1;

  UPDATE public.profiles AS p
  SET interactive_sign_in_count = v_new_count,
      last_interactive_sign_in_at = now(),
      last_interactive_sign_in_install_id = p_install_id
  WHERE p.id = auth.uid();

  interactive_sign_in_count := v_new_count;
  show_returning_welcome :=
    v_previous_count >= 1
    AND p_install_id IS NOT NULL
    AND v_previous_install_id = p_install_id;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.record_interactive_sign_in(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_interactive_sign_in(text) TO authenticated;
